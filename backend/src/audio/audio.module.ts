import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module.js';
import { AudioProbeService } from './audio-probe.service.js';

@Module({
  imports: [StorageModule],
  providers: [AudioProbeService],
  exports: [AudioProbeService],
})
export class AudioModule {}
