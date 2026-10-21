import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module.js';
import { HealthModule } from './health/health.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { AuthModule } from './auth/auth.module.js';
import { UsersModule } from './users/users.module.js';
import { StorageModule } from './storage/storage.module.js';
import { UploadsModule } from './uploads/uploads.module.js';
import { VehiclesModule } from './vehicles/vehicles.module.js';
import { RequestsModule } from './requests/requests.module.js';
import { MessagesModule } from './messages/messages.module.js';
import { RealtimeModule } from './realtime/realtime.module.js';
import { ClientsModule } from './clients/clients.module.js';
import { RateLimitModule } from './rate-limit/rate-limit.module.js';
import { RedisModule } from './redis/redis.module.js';
import { AudioModule } from './audio/audio.module.js';
import { MailModule } from './mail/mail.module.js';

@Module({
  imports: [
    ConfigModule,
    HealthModule,
    PrismaModule,
    // До AuthModule: глобальный throttler-guard должен сработать раньше JWT-guard
    RateLimitModule,
    AuthModule,
    UsersModule,
    StorageModule,
    UploadsModule,
    VehiclesModule,
    RequestsModule,
    MessagesModule,
    RealtimeModule,
    ClientsModule,
    RedisModule,
    AudioModule,
    MailModule,
  ],
})
export class AppModule {}
