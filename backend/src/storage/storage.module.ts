import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AttachmentsService } from './attachments.service.js';
import { DiskStorageService } from './disk-storage.service.js';
import { FilesController } from './files.controller.js';
import { S3StorageService } from './s3-storage.service.js';
import { StorageService } from './storage.service.js';

@Module({
  controllers: [FilesController],
  providers: [
    {
      // Драйвер выбирается переменной STORAGE_DRIVER; остальной код видит только StorageService
      provide: StorageService,
      inject: [ConfigService],
      useFactory: (config: ConfigService): StorageService =>
        config.get<string>('STORAGE_DRIVER') === 's3'
          ? new S3StorageService(config)
          : new DiskStorageService(config),
    },
    AttachmentsService,
  ],
  exports: [StorageService, AttachmentsService],
})
export class StorageModule {}
