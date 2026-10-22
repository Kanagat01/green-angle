import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '../generated/prisma/client.js';
import { MessageType, Role } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PushPayload, PushSender } from './push-sender.js';
import { SubscribePushDto } from './dto/push.dto.js';

/** Подписок на пользователя: старые (по времени создания) вытесняются новыми */
const MAX_SUBSCRIPTIONS_PER_USER = 20;
/** Как часто проверяем, не пора ли повторно разослать сообщение без ответа */
const ESCALATION_SCAN_MS = 60_000;

/**
 * Push-уведомления о сообщениях в диалоге заявки. Получатель — вторая сторона, автору не идёт:
 * - написал сотрудник — устройствам владельца заявки (подборщик или физлицо);
 * - написал владелец заявки — сотруднику, ответившему в заявке последним (ответственному);
 *   пока ответственного нет, то есть на заявку ещё никто не отвечал, — всем сотрудникам;
 *   если ответственный не ответил за `PUSH_FALLBACK_MINUTES`, сообщение один раз уходит всем.
 * Служебные строки не уведомляют. Отправка идёт в фоне и никогда не ломает запрос.
 */
@Injectable()
export class PushService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PushService.name);
  private readonly appUrl: string;
  private readonly fallbackMs: number;
  private readonly scanEnabled: boolean;
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly pending = new Set<Promise<unknown>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly sender: PushSender,
    config: ConfigService,
  ) {
    this.appUrl = config.get<string>('APP_URL') ?? 'http://localhost:3001';
    this.fallbackMs =
      config.getOrThrow<number>('PUSH_FALLBACK_MINUTES') * 60_000;
    // В тестах проверку запускают вручную: фоновый таймер сделал бы их недетерминированными
    this.scanEnabled = config.get<string>('NODE_ENV') !== 'test';
  }

  onModuleInit() {
    if (!this.scanEnabled) return;
    this.timer = setInterval(() => {
      this.track(this.escalate());
    }, ESCALATION_SCAN_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  /** Публичный ключ для подписки в браузере; `enabled: false` — на сервере push не настроен. */
  config(): { enabled: boolean; publicKey: string | null } {
    return { enabled: this.sender.enabled, publicKey: this.sender.publicKey };
  }

  /** Сохраняет подписку устройства; та же подписка у другого пользователя переходит к текущему. */
  async subscribe(
    userId: string,
    dto: SubscribePushDto,
    userAgent?: string,
  ): Promise<void> {
    const data = {
      userId,
      p256dh: dto.keys.p256dh,
      auth: dto.keys.auth,
      userAgent: userAgent?.slice(0, 300) ?? null,
    };
    await this.prisma.pushSubscription.upsert({
      where: { endpoint: dto.endpoint },
      create: { endpoint: dto.endpoint, ...data },
      update: data,
    });

    const stale = await this.prisma.pushSubscription.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      skip: MAX_SUBSCRIPTIONS_PER_USER,
      select: { id: true },
    });
    if (stale.length > 0) {
      await this.prisma.pushSubscription.deleteMany({
        where: { id: { in: stale.map((s) => s.id) } },
      });
    }
  }

  /** Отписывает устройство; чужую подписку по адресу не удалить. */
  async unsubscribe(userId: string, endpoint: string): Promise<void> {
    await this.prisma.pushSubscription.deleteMany({
      where: { userId, endpoint },
    });
  }

  /** Уведомляет о новом сообщении диалога (в фоне). */
  notifyMessage(messageId: string): void {
    this.track(this.deliverMessage(messageId));
  }

  /** Ждёт завершения всех отправок, запущенных в фоне (нужно тестам и остановке сервера). */
  async idle(): Promise<void> {
    while (this.pending.size > 0) await Promise.allSettled([...this.pending]);
  }

  /**
   * Повторная рассылка: сообщение клиента без ответа дольше порога, у заявки есть ответственный
   * — уведомляем остальных сотрудников. Метка `escalatedAt` ставится атомарно, поэтому
   * несколько экземпляров API не продублируют уведомление. Возвращает число заявок.
   */
  async escalate(now = new Date()): Promise<number> {
    const threshold = new Date(now.getTime() - this.fallbackMs);
    const rows = await this.prisma.$queryRaw<
      { id: string; title: string; assigneeId: string }[]
    >`UPDATE "Request" SET "escalatedAt" = ${now}
       WHERE "awaitingReply" = true
         AND "assigneeId" IS NOT NULL
         AND "lastMessageAt" <= ${threshold}
         AND ("escalatedAt" IS NULL OR "escalatedAt" < "lastMessageAt")
      RETURNING "id", "title", "assigneeId"`;

    for (const request of rows) {
      const managers = await this.activeUsers({
        role: Role.ADMIN,
        id: { not: request.assigneeId },
      });
      await this.sendToUsers(managers, {
        title: 'HUATECH',
        body: `Заявка «${request.title}» ждёт ответа`,
        url: `${this.appUrl}/admin/requests/${request.id}`,
        requestId: request.id,
        tag: `request-${request.id}`,
      });
    }
    return rows.length;
  }

  private async deliverMessage(messageId: string): Promise<void> {
    try {
      const message = await this.prisma.message.findUnique({
        where: { id: messageId },
        select: {
          type: true,
          authorId: true,
          author: { select: { role: true } },
          request: {
            select: { id: true, title: true, clientId: true, assigneeId: true },
          },
        },
      });
      if (
        !message ||
        message.type === MessageType.SYSTEM ||
        !message.authorId ||
        !message.author
      ) {
        return;
      }
      const { request } = message;
      const base = {
        title: 'HUATECH',
        requestId: request.id,
        tag: `request-${request.id}`,
      };

      if (message.author.role === Role.ADMIN) {
        const owners = await this.activeUsers({
          clientId: request.clientId,
          id: { not: message.authorId },
        });
        await this.sendToUsers(owners, {
          ...base,
          body: `Новое сообщение по заявке «${request.title}»`,
          url: `${this.appUrl}/requests/${request.id}`,
        });
        return;
      }

      // Ответственный, если он ещё работает; иначе (или если его нет) — все сотрудники
      const assignee = request.assigneeId
        ? await this.activeUsers({ id: request.assigneeId, role: Role.ADMIN })
        : [];
      const managers =
        assignee.length > 0
          ? assignee
          : await this.activeUsers({ role: Role.ADMIN });
      await this.sendToUsers(managers, {
        ...base,
        body: `Новое сообщение по заявке «${request.title}»`,
        url: `${this.appUrl}/admin/requests/${request.id}`,
      });
    } catch (err) {
      this.logger.error(
        `Push for message ${messageId} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async activeUsers(where: Prisma.UserWhereInput): Promise<string[]> {
    const users = await this.prisma.user.findMany({
      where: { isActive: true, ...where },
      select: { id: true },
    });
    return users.map((u) => u.id);
  }

  /** Всем устройствам пользователей; недействительные подписки удаляются. */
  private async sendToUsers(
    userIds: string[],
    payload: PushPayload,
  ): Promise<void> {
    if (userIds.length === 0) return;
    const subscriptions = await this.prisma.pushSubscription.findMany({
      where: { userId: { in: userIds } },
    });
    const results = await Promise.all(
      subscriptions.map(async (s) => ({
        endpoint: s.endpoint,
        result: await this.sender.send(s, payload),
      })),
    );
    const gone = results
      .filter((r) => r.result === 'gone')
      .map((r) => r.endpoint);
    if (gone.length > 0) {
      await this.prisma.pushSubscription.deleteMany({
        where: { endpoint: { in: gone } },
      });
    }
  }

  private track(promise: Promise<unknown>): void {
    const tracked = promise
      .catch((err: unknown) =>
        this.logger.error(
          `Background push failed: ${err instanceof Error ? err.message : String(err)}`,
        ),
      )
      .finally(() => this.pending.delete(tracked));
    this.pending.add(tracked);
  }
}
