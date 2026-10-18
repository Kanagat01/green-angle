import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiPayloadTooLargeResponse,
  ApiTags,
  ApiUnsupportedMediaTypeResponse,
} from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth-user.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { StorageService } from '../storage/storage.service.js';
import { PresignUploadDto } from './dto/presign-upload.dto.js';
import { PresignedUploadDto } from './dto/presigned-upload.dto.js';

@ApiTags('uploads')
@ApiBearerAuth()
@Controller('uploads')
export class UploadsController {
  constructor(private readonly storage: StorageService) {}

  /** Универсальная выдача presigned PUT: файлы идут напрямую в S3, минуя API. */
  @Post('presign')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: PresignedUploadDto })
  @ApiUnsupportedMediaTypeResponse({
    description: 'Mime-тип не разрешён для этого вида вложения',
  })
  @ApiPayloadTooLargeResponse({ description: 'Размер вне допустимых пределов' })
  presign(@CurrentUser() user: AuthUser, @Body() dto: PresignUploadDto) {
    return this.storage.createUploadTicket(
      user.id,
      dto.kind,
      dto.mime,
      dto.size,
    );
  }
}
