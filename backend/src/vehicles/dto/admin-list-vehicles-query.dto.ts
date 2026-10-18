import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
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

  @ApiPropertyOptional({ minimum: 1, maximum: 13, description: 'Текущий шаг' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(13)
  step?: number;
}
