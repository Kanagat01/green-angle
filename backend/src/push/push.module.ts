import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LogPushSender, PushSender, WebPushSender } from './push-sender.js';
import { PushController } from './push.controller.js';
import { PushService } from './push.service.js';

@Module({
  controllers: [PushController],
  providers: [
    {
      // Есть ключи VAPID — настоящий Web Push, иначе заглушка, которая только пишет в лог
      provide: PushSender,
      inject: [ConfigService],
      useFactory: (config: ConfigService): PushSender =>
        config.get<string>('VAPID_PUBLIC_KEY') &&
        config.get<string>('VAPID_PRIVATE_KEY') &&
        config.get<string>('VAPID_SUBJECT')
          ? new WebPushSender(config)
          : new LogPushSender(),
    },
    PushService,
  ],
  exports: [PushService, PushSender],
})
export class PushModule {}
