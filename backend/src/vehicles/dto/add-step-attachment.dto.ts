import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsString, MaxLength, MinLength } from 'class-validator';
import { AttachmentKind } from '../../generated/prisma/client.js';

export class AddStepAttachmentDto {
  @ApiProperty({
    description:
      'Ключ объекта из POST /uploads/presign после успешной загрузки',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  key: string;

  @ApiProperty({ enum: AttachmentKind })
  @IsEnum(AttachmentKind)
  kind: AttachmentKind;
}
