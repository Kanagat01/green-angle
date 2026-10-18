import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Role } from '../../generated/prisma/client.js';

export const normalizeEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class CreateUserDto {
  @ApiProperty({ example: 'broker@autopodbor.ru' })
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(254)
  email: string;

  @ApiProperty({
    minLength: 8,
    maxLength: 128,
    description: 'Начальный пароль; пользователю передаёт менеджер',
  })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password: string;

  @ApiProperty({ enum: Role })
  @IsEnum(Role)
  role: Role;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Обязателен для BROKER (клиент-компания) и INDIVIDUAL (клиент-физлицо); у ADMIN не указывается',
  })
  @IsOptional()
  @IsUUID()
  clientId?: string;
}
