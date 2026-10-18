import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsInt, IsString, Max, MaxLength, Min } from 'class-validator';
import { AttachmentKind } from '../../generated/prisma/client.js';

export class PresignUploadDto {
  @ApiProperty({ enum: AttachmentKind })
  @IsEnum(AttachmentKind)
  kind: AttachmentKind;

  @ApiProperty({
    example: 'audio/webm',
    description: 'Mime-тип файла; параметры (codecs=…) отбрасываются',
  })
  @IsString()
  @MaxLength(200)
  mime: string;

  @ApiProperty({ description: 'Размер файла в байтах', example: 204800 })
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  size: number;
}
