import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @ApiPropertyOptional({
    minLength: 8,
    maxLength: 128,
    description:
      'Новый пароль. Если не указан, сервер сгенерирует временный и вернёт его один раз',
  })
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password?: string;
}
