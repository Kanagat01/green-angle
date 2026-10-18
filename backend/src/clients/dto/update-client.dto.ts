import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ClientType } from '../../generated/prisma/client.js';
import { trimString } from './create-client.dto.js';

export class UpdateClientDto {
  @ApiPropertyOptional({ example: 'ООО АвтоПодбор Плюс' })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({
    enum: ClientType,
    description: 'Тип можно менять, только пока у клиента нет пользователей',
  })
  @IsOptional()
  @IsEnum(ClientType)
  type?: ClientType;
}
