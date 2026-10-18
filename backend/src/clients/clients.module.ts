import { Module } from '@nestjs/common';
import { AdminClientsController } from './admin-clients.controller.js';
import { ClientsService } from './clients.service.js';

@Module({
  controllers: [AdminClientsController],
  providers: [ClientsService],
})
export class ClientsModule {}
