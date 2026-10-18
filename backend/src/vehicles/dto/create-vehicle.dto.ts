import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ClientType } from '../../generated/prisma/client.js';

/** ISO 3779: 17 символов, без I, O, Q */
export const VIN_REGEX = /^[A-HJ-NPR-Z0-9]{17}$/;

export const normalizeVin = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

export class NewClientDto {
  @ApiProperty({ enum: ClientType })
  @IsEnum(ClientType)
  type: ClientType;

  @ApiProperty({ example: 'ООО АвтоПодбор Плюс' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name: string;
}

export class CreateVehicleDto {
  @ApiProperty({ example: 'Geely Monjaro, 2024' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title: string;

  @ApiProperty({
    example: 'LB37622Z0RX000001',
    description: 'VIN обязателен при ручном создании',
  })
  @Transform(normalizeVin)
  @Matches(VIN_REGEX, { message: 'vin must be a valid 17-character VIN' })
  vin: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Существующий клиент' })
  @IsOptional()
  @IsUUID()
  clientId?: string;

  @ApiPropertyOptional({
    type: NewClientDto,
    description: 'Новый клиент; ровно одно из clientId / client',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => NewClientDto)
  client?: NewClientDto;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 13,
    default: 1,
    description: 'Стартовый статус',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(13)
  startStep: number = 1;
}
