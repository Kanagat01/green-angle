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

@Module({
  imports: [
    ConfigModule,
    HealthModule,
    PrismaModule,
    AuthModule,
    UsersModule,
    StorageModule,
    UploadsModule,
    VehiclesModule,
    RequestsModule,
    MessagesModule,
    RealtimeModule,
    ClientsModule,
  ],
})
export class AppModule {}
