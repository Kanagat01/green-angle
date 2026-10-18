import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { hash, verify } from '@node-rs/argon2';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { AccessTokenPayload, RefreshTokenPayload } from './auth-user.js';
import { TokenPairDto } from './dto/token-pair.dto.js';

@Injectable()
export class AuthService {
  // Хеш для выравнивания времени ответа, когда пользователь не найден
  private readonly dummyHash = hash('dummy-password-for-timing');

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async login(email: string, password: string): Promise<TokenPairDto> {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });
    const passwordHash = user?.passwordHash ?? (await this.dummyHash);
    const valid = await verify(passwordHash, password).catch(() => false);
    if (!user || !valid || !user.isActive)
      throw new UnauthorizedException('Invalid credentials');

    return this.issueTokens(user, randomUUID());
  }

  /** Ротация: старый refresh отзывается, выдаётся новая пара в той же family. */
  async refresh(refreshToken: string): Promise<TokenPairDto> {
    const payload = await this.verifyRefresh(refreshToken);

    const stored = await this.prisma.refreshToken.findUnique({
      where: { id: payload.jti },
    });
    if (
      !stored ||
      stored.userId !== payload.sub ||
      stored.expiresAt < new Date()
    ) {
      throw new UnauthorizedException();
    }

    // Атомарный отзыв: при гонке или повторном использовании count === 0
    const { count } = await this.prisma.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (count === 0) {
      // Повторное использование уже отозванного токена — считаем скомпрометированным всю цепочку
      await this.revokeFamily(stored.familyId);
      throw new UnauthorizedException();
    }

    const user = await this.prisma.user.findUnique({
      where: { id: stored.userId },
    });
    if (!user || !user.isActive) {
      await this.revokeFamily(stored.familyId);
      throw new UnauthorizedException();
    }

    return this.issueTokens(user, stored.familyId);
  }

  /** Идемпотентно: отзывает всю цепочку refresh-токенов; неверный токен молча игнорируется. */
  async logout(refreshToken: string): Promise<void> {
    const payload = await this.verifyRefresh(refreshToken).catch(() => null);
    if (!payload) return;
    const stored = await this.prisma.refreshToken.findUnique({
      where: { id: payload.jti },
    });
    if (stored) await this.revokeFamily(stored.familyId);
  }

  /** Отзыв всех refresh-токенов пользователя (деактивация, сброс пароля). */
  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private revokeFamily(familyId: string) {
    return this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async verifyRefresh(token: string): Promise<RefreshTokenPayload> {
    try {
      return await this.jwt.verifyAsync<RefreshTokenPayload>(token, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException();
    }
  }

  private async issueTokens(
    user: {
      id: string;
      role: AccessTokenPayload['role'];
      clientId: string | null;
    },
    familyId: string,
  ): Promise<TokenPairDto> {
    const accessTtl = this.config.getOrThrow<number>('JWT_ACCESS_TTL_SEC');
    const refreshTtl = this.config.getOrThrow<number>('JWT_REFRESH_TTL_SEC');

    const stored = await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        familyId,
        expiresAt: new Date(Date.now() + refreshTtl * 1000),
      },
    });

    const accessPayload: AccessTokenPayload = {
      sub: user.id,
      role: user.role,
      clientId: user.clientId,
    };
    const refreshPayload: RefreshTokenPayload = {
      sub: user.id,
      jti: stored.id,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(accessPayload, {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        expiresIn: accessTtl,
      }),
      this.jwt.signAsync(refreshPayload, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
        expiresIn: refreshTtl,
      }),
    ]);

    return { accessToken, refreshToken, expiresIn: accessTtl };
  }
}
