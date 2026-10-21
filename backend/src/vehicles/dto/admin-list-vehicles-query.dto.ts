import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ClientType } from '../../generated/prisma/client.js';
import { ListVehiclesQueryDto } from './list-vehicles-query.dto.js';

export class AdminListVehiclesQueryDto extends ListVehiclesQueryDto {
  @ApiPropertyOptional({
    description: 'Поиск по подстроке VIN (без учёта регистра)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(17)
  vin?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  clientId?: string;

  @ApiPropertyOptional({
    enum: ClientType,
    description:
      'Тип владельца: COMPANY — компании по привозу, PERSON — физ.лица',
  })
  @IsOptional()
  @IsEnum(ClientType)
  ownerType?: ClientType;

  @ApiPropertyOptional({ minimum: 1, maximum: 13, description: 'Текущий шаг' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(13)
  step?: number;
}
