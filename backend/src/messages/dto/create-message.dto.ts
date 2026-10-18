import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { AttachmentKind, MessageType } from '../../generated/prisma/client.js';

/** Голосовое — до 5 минут (PLAN.md §5); размер ограничен правилами AUDIO (10 МБ) */
export const MAX_VOICE_SECONDS = 5 * 60;
export const MAX_TEXT_LENGTH = 5000;
export const MAX_LINKS = 10;
export const MAX_MESSAGE_ATTACHMENTS = 10;

/** Вложения-варианты в диалоге: фото, видео, файлы. Голосовые идут отдельным потоком. */
export const MESSAGE_ATTACHMENT_KINDS = [
  AttachmentKind.PHOTO,
  AttachmentKind.VIDEO,
  AttachmentKind.FILE,
] as const;

export class MessageAttachmentDto {
  @ApiProperty({
    description:
      'Ключ объекта из POST /uploads/presign после успешной загрузки',
  })
  @IsString()
  @MaxLength(300)
  key: string;

  @ApiProperty({ enum: MESSAGE_ATTACHMENT_KINDS })
  @IsIn(MESSAGE_ATTACHMENT_KINDS)
  kind: AttachmentKind;
}

export class CreateMessageDto {
  @ApiPropertyOptional({ enum: MessageType, default: MessageType.TEXT })
  @IsOptional()
  @IsEnum(MessageType)
  type: MessageType = MessageType.TEXT;

  @ApiPropertyOptional({
    description:
      'Только для VOICE (обязательно): ключ аудиообъекта из POST /requests/:id/voice-upload-url после загрузки',
  })
  @ValidateIf((o: CreateMessageDto) => o.type === MessageType.VOICE)
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  attachmentKey?: string;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: MAX_VOICE_SECONDS,
    description: 'Только для VOICE (обязательно): длительность записи, секунды',
  })
  @ValidateIf((o: CreateMessageDto) => o.type === MessageType.VOICE)
  @IsInt()
  @Min(1)
  @Max(MAX_VOICE_SECONDS)
  durationSec?: number;

  @ApiPropertyOptional({ maxLength: MAX_TEXT_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_TEXT_LENGTH)
  text?: string;

  @ApiPropertyOptional({
    type: [String],
    maxItems: MAX_LINKS,
    description: 'Ссылки на объявления (http/https)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_LINKS)
  @IsUrl(
    { protocols: ['http', 'https'], require_protocol: true },
    { each: true },
  )
  @MaxLength(2000, { each: true })
  links?: string[];

  @ApiPropertyOptional({
    type: [MessageAttachmentDto],
    maxItems: MAX_MESSAGE_ATTACHMENTS,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_MESSAGE_ATTACHMENTS)
  @ValidateNested({ each: true })
  @Type(() => MessageAttachmentDto)
  attachments?: MessageAttachmentDto[];
}
