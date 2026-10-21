import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { AddStepAttachmentDto } from './add-step-attachment.dto.js';

export class ChangeStatusDto {
  @ApiProperty({
    minimum: 1,
    maximum: 13,
    description:
      'Целевой шаг; можно двигать вперёд и назад (исправление ошибок)',
  })
  @IsInt()
  @Min(1)
  @Max(13)
  step: number;

  @ApiPropertyOptional({
    example: '10702070/181024/5012345',
    description:
      'Номер декларации; применим при переходе на шаг 10 и далее. На шаге 10 обязателен, если ещё не указан',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  declarationNumber?: string;

  @ApiPropertyOptional({
    type: [AddStepAttachmentDto],
    maxItems: 10,
    description:
      'Вложения шага (ключи из POST /uploads/presign после загрузки). Если шаг ждёт фото, видео или файл, нужно хотя бы одно вложение этого вида (либо оно уже прикреплено к шагу); при откате назад не требуется. Вид вложений должен совпадать с ожидаемым видом шага',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => AddStepAttachmentDto)
  attachments?: AddStepAttachmentDto[];

  @ApiPropertyOptional({
    maxLength: 2000,
    description:
      'Комментарий для клиента: уходит в диалог по заявке сообщением менеджера вместе с вложениями; если у машины нет заявки — игнорируется',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}
