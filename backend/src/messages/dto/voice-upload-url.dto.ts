import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, Max, MaxLength, Min } from 'class-validator';

export class VoiceUploadUrlDto {
  @ApiProperty({
    example: 'audio/webm;codecs=opus',
    description:
      'audio/webm, audio/ogg, audio/mp4 (iOS Safari), audio/mpeg или audio/wav; параметры (codecs=…) отбрасываются',
  })
  @IsString()
  @MaxLength(200)
  mime: string;

  @ApiProperty({
    description: 'Размер файла в байтах, до 10 МБ',
    example: 204800,
  })
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  size: number;
}
