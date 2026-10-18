import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsOptional, MaxLength } from 'class-validator';
import { normalizeEmail } from './create-user.dto.js';

export class UpdateUserDto {
  @ApiPropertyOptional({ example: 'new@autopodbor.ru' })
  @IsOptional()
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @ApiPropertyOptional({
    description:
      'false — деактивация: вход и все сессии блокируются сразу; нельзя деактивировать самого себя',
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
