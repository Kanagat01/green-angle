import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import webpush from 'web-push';

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushPayload {
  title: string;
  body: string;
  /** Куда ведёт клик по уведомлению (абсолютный адрес фронтенда) */
  url: string;
  requestId: string;
  /** Уведомления с одним тегом браузер заменяет, а не копит */
  tag: string;
}

/** sent — доставлено пушевому сервису; gone — подписка недействительна (её нужно удалить); failed — сбой, подписка может ещё работать */
export type PushResult = 'sent' | 'gone' | 'failed';

/** Отправитель push. Реализация выбирается по настройкам: настоящая (VAPID) или заглушка. */
export abstract class PushSender {
  /** false — ключей VAPID нет и push на самом деле не уходит */
  abstract readonly enabled: boolean;
  abstract readonly publicKey: string | null;
  abstract send(target: PushTarget, payload: PushPayload): Promise<PushResult>;
}

export class WebPushSender extends PushSender {
  private readonly logger = new Logger(WebPushSender.name);
  readonly enabled = true;
  readonly publicKey: string;
  private readonly details: webpush.VapidKeys & { subject: string };

  constructor(config: ConfigService) {
    super();
    this.publicKey = config.getOrThrow<string>('VAPID_PUBLIC_KEY');
    this.details = {
      publicKey: this.publicKey,
      privateKey: config.getOrThrow<string>('VAPID_PRIVATE_KEY'),
      subject: config.getOrThrow<string>('VAPID_SUBJECT'),
    };
  }

  async send(target: PushTarget, payload: PushPayload): Promise<PushResult> {
    try {
      await webpush.sendNotification(
        {
          endpoint: target.endpoint,
          keys: { p256dh: target.p256dh, auth: target.auth },
        },
        JSON.stringify(payload),
        {
          vapidDetails: this.details,
          // Устройство было выключено — доставим в течение суток, потом смысла нет
          TTL: 24 * 60 * 60,
          urgency: 'normal',
          timeout: 10_000,
        },
      );
      return 'sent';
    } catch (err) {
      const status = (err as { statusCode?: number } | null)?.statusCode;
      if (status === 404 || status === 410) return 'gone';
      this.logger.warn(
        `Push failed (${status ?? 'no status'}): ${err instanceof Error ? err.message : String(err)}`,
      );
      return 'failed';
    }
  }
}

/** Без ключей VAPID: ничего не отправляет, а запоминает и пишет в лог — для разработки и тестов. */
export class LogPushSender extends PushSender {
  private readonly logger = new Logger(LogPushSender.name);
  readonly enabled = false;
  readonly publicKey = null;
  /** Последние «отправленные» уведомления */
  readonly sent: { target: PushTarget; payload: PushPayload }[] = [];
  /** Что вернуть из send: тесты имитируют недействительные подписки */
  result: (target: PushTarget) => PushResult = () => 'sent';

  send(target: PushTarget, payload: PushPayload): Promise<PushResult> {
    this.sent.push({ target, payload });
    if (this.sent.length > 500) this.sent.shift();
    this.logger.log(
      `Push to ${target.endpoint.slice(0, 40)}…: ${payload.body}`,
    );
    return Promise.resolve(this.result(target));
  }
}
