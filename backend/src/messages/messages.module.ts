import { Module } from '@nestjs/common';
import { AudioModule } from '../audio/audio.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { MessagesController } from './messages.controller.js';
import { MessagesService } from './messages.service.js';

@Module({
  imports: [StorageModule, AudioModule],
  controllers: [MessagesController],
  providers: [MessagesService],
  exports: [MessagesService],
})
export class MessagesModule {}
