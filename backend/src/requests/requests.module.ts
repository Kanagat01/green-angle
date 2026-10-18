import { Module } from '@nestjs/common';
import { MessagesModule } from '../messages/messages.module.js';
import { AdminRequestsController } from './admin-requests.controller.js';
import { RequestsController } from './requests.controller.js';
import { RequestsService } from './requests.service.js';

@Module({
  imports: [MessagesModule],
  controllers: [RequestsController, AdminRequestsController],
  providers: [RequestsService],
  exports: [RequestsService],
})
export class RequestsModule {}
