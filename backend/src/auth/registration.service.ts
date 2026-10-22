import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { hash } from '@node-rs/argon2';
import { createHash, randomBytes } from 'node:crypto';
import { ClientType, Role } from '../generated/prisma/client.js';
import { MailService } from '../mail/mail.service.js';
import { verificationEmail } from '../mail/templates.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RegisterDto } from './dto/register.dto.js';

const hashToken = (token: string) =>
  createHash('sha256').update(token).digest('hex');

/** Самостоятельная регистрация: аккаунт создаётся закрытым, вход открывает письмо со ссылкой. */
@Injectable()
export class RegistrationService {
  private readonly logger = new Logger(RegistrationService.name);
  private readonly ttlMs: number;
  private readonly appUrl: string;
  private readonly ttlHours: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    config: ConfigService,
  ) {
    this.ttlHours = config.getOrThrow<number>('EMAIL_VERIFICATION_TTL_HOURS');
    this.ttlMs = this.ttlHours * 60 * 60 * 1000;
    this.appUrl = config.get<string>('APP_URL') ?? 'http://localhost:3000';
  }

  /**
   * Создаёт клиента и пользователя и отправляет письмо. Занятый адрес не раскрывается: ответ
   * тот же, а хеш пароля считается до проверки, чтобы по времени ответа адрес тоже не угадывался.
   */
  async register(dto: RegisterDto): Promise<void> {
    const passwordHash = await hash(dto.password);

    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: { id: true },
    });
    if (existing) {
      this.logger.log('Registration skipped: the email is already registered');
      return;
    }

    const isCompany = dto.type === ClientType.COMPANY;
    const token = this.newToken();
    try {
      await this.prisma.$transaction(async (tx) => {
        const client = await tx.client.create({
          data: {
            type: dto.type,
            name: dto.name,
            inn: isCompany ? dto.inn : null,
            phone: dto.phone,
            consentAt: new Date(),
          },
        });
        const user = await tx.user.create({
          data: {
            email: dto.email,
            passwordHash,
            role: isCompany ? Role.BROKER : Role.INDIVIDUAL,
            clientId: client.id,
          },
        });
        await tx.emailToken.create({
          data: {
            userId: user.id,
            tokenHash: hashToken(token),
            expiresAt: new Date(Date.now() + this.ttlMs),
          },
        });
      });
    } catch (err) {
      // Два одинаковых запроса одновременно: второй упёрся в уникальный email — это не ошибка
      if ((err as { code?: string } | null)?.code === 'P2002') return;
      throw err;
    }

    await this.sendVerification(dto.email, dto.name, token);
  }

  /** Подтверждает почту по токену из письма. Повторный переход по той же ссылке не ошибка. */
  async verify(token: string): Promise<void> {
    const stored = await this.prisma.emailToken.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: { select: { id: true, emailVerifiedAt: true } } },
    });
    if (!stored) throw invalidToken();

    if (stored.usedAt) {
      // Ссылка уже сработала: если почта подтверждена, пользователь просто открыл её ещё раз
      if (stored.user.emailVerifiedAt) return;
      throw invalidToken();
    }
    if (stored.expiresAt < new Date()) throw invalidToken();

    await this.prisma.$transaction(async (tx) => {
      // Атомарно «занимаем» токен: из двух параллельных переходов сработает один
      const claimed = await tx.emailToken.updateMany({
        where: { id: stored.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (claimed.count === 0) return;
      await tx.user.updateMany({
        where: { id: stored.userId, emailVerifiedAt: null },
        data: { emailVerifiedAt: new Date() },
      });
    });
  }

  /** Новое письмо для неподтверждённого аккаунта; старые ссылки перестают работать. */
  async resend(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        isActive: true,
        emailVerifiedAt: true,
        client: { select: { name: true } },
      },
    });
    if (!user || user.emailVerifiedAt || !user.isActive) return;

    const token = this.newToken();
    await this.prisma.$transaction([
      this.prisma.emailToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      }),
      this.prisma.emailToken.create({
        data: {
          userId: user.id,
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + this.ttlMs),
        },
      }),
    ]);
    await this.sendVerification(email, user.client?.name ?? email, token);
  }

  private newToken(): string {
    return randomBytes(32).toString('base64url');
  }

  private async sendVerification(
    email: string,
    name: string,
    token: string,
  ): Promise<void> {
    const url = `${this.appUrl}/verify-email?token=${token}`;
    await this.mail.send(verificationEmail(email, name, url, this.ttlHours));
  }
}

function invalidToken() {
  return new BadRequestException({
    statusCode: 400,
    message: 'The link is invalid or has expired',
    code: 'INVALID_TOKEN',
  });
}
