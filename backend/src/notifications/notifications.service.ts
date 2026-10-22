import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientType } from '../generated/prisma/client.js';
import { MailService } from '../mail/mail.service.js';
import { statusChangedEmail } from '../mail/templates.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { stepTitle } from '../vehicles/steps.catalog.js';

/**
 * Уведомления клиентам о смене статуса машины по email. Кому:
 * - физлицу — на его email, пока он не отключил письма в настройках (по умолчанию включены);
 * - подборщику — на email его конечного клиента, указанный в карточке машины, если подборщик
 *   включил «уведомлять» (по умолчанию выключено); самому подборщику письмо не идёт.
 * Сбой отправки пишется в лог и никогда не ломает смену статуса.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly appUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    config: ConfigService,
  ) {
    this.appUrl = config.get<string>('APP_URL') ?? 'http://localhost:3000';
  }

  /** Письмо о переходе на этап `step`; вызывать после коммита транзакции. */
  async vehicleStatusChanged(vehicleId: string, step: number): Promise<void> {
    try {
      const vehicle = await this.prisma.vehicle.findUnique({
        where: { id: vehicleId },
        select: {
          id: true,
          title: true,
          vin: true,
          notifyEmail: true,
          notifyEnabled: true,
          client: {
            select: {
              type: true,
              users: {
                where: {
                  isActive: true,
                  emailNotifications: true,
                  emailVerifiedAt: { not: null },
                },
                select: { email: true },
              },
            },
          },
        },
      });
      if (!vehicle) return;

      const title = stepTitle(step);
      const mails =
        vehicle.client.type === ClientType.PERSON
          ? vehicle.client.users.map((u) =>
              statusChangedEmail(
                u.email,
                vehicle,
                title,
                step,
                `${this.appUrl}/cars/${vehicle.id}`,
              ),
            )
          : vehicle.notifyEnabled && vehicle.notifyEmail
            ? // конечный клиент подборщика не пользователь — открыть ему в кабинете нечего
              [
                statusChangedEmail(
                  vehicle.notifyEmail,
                  vehicle,
                  title,
                  step,
                  null,
                ),
              ]
            : [];

      await Promise.all(mails.map((m) => this.mail.send(m)));
    } catch (err) {
      this.logger.error(
        `Status notification for vehicle ${vehicleId} failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
