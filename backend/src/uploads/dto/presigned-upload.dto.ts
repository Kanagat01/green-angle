import { ApiProperty } from '@nestjs/swagger';

export class PresignedUploadDto {
  @ApiProperty({
    description:
      'Ключ объекта: его нужно передать при создании вложения/сообщения после загрузки',
  })
  key: string;

  @ApiProperty({ description: 'URL для прямой загрузки файла в S3' })
  uploadUrl: string;

  @ApiProperty({ enum: ['PUT'] })
  method: 'PUT';

  @ApiProperty({
    description: 'Заголовки, обязательные для PUT-запроса',
    example: { 'Content-Type': 'audio/webm' },
  })
  headers: Record<string, string>;

  @ApiProperty({ description: 'Время жизни ссылки, секунды', example: 900 })
  expiresIn: number;
}
