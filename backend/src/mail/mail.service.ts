import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/** Сколько последних писем держим в памяти (для разработки и тестов) */
const OUTBOX_LIMIT = 200;

/**
 * Исходящая почта. С `SMTP_HOST` письма уходят через SMTP, без него — только в лог (разработка
 * и тесты). Отправка никогда не бросает исключений: сбой почты не должен ронять запрос
 * (регистрацию, смену статуса), он пишется в лог и возвращается как `false`.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transport: Transporter | null;
  private readonly from: string;
  /** Последние отправленные письма: нужны тестам и помогают при разработке без SMTP */
  readonly outbox: MailMessage[] = [];

  constructor(config: ConfigService) {
    this.from = config.getOrThrow<string>('MAIL_FROM');
    const host = config.get<string>('SMTP_HOST');
    if (!host) {
      this.transport = null;
      this.logger.warn('SMTP_HOST is not set: emails are only logged');
      return;
    }
    const port = config.getOrThrow<number>('SMTP_PORT');
    const user = config.get<string>('SMTP_USER');
    const pass = config.get<string>('SMTP_PASS');
    this.transport = createTransport({
      host,
      port,
      secure: config.get<boolean>('SMTP_SECURE') ?? port === 465,
      ...(user && pass ? { auth: { user, pass } } : {}),
      // Зависший SMTP-сервер не должен держать запрос дольше нескольких секунд
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }

  async send(message: MailMessage): Promise<boolean> {
    this.outbox.push(message);
    if (this.outbox.length > OUTBOX_LIMIT) this.outbox.shift();

    if (!this.transport) {
      this.logger.log(
        `Email to ${message.to}: ${message.subject}\n${message.text}`,
      );
      return true;
    }
    try {
      await this.transport.sendMail({ from: this.from, ...message });
      return true;
    } catch (err) {
      this.logger.error(
        `Cannot send email to ${message.to}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return false;
    }
  }
}
