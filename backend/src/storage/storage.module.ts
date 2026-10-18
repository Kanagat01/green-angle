import { Module } from '@nestjs/common';
import { StorageService } from './storage.service.js';
import { AttachmentsService } from './attachments.service.js';

@Module({
  providers: [StorageService, AttachmentsService],
  exports: [StorageService, AttachmentsService],
})
export class StorageModule {}
