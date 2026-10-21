import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';

export const VEHICLE_STATES = ['active', 'ready'] as const;
export type VehicleState = (typeof VEHICLE_STATES)[number];

export class ListVehiclesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Поиск по подстроке VIN или названия (без учёта регистра)',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({
    enum: VEHICLE_STATES,
    description:
      'active — в пути (шаги 1–12), ready — готовы к выдаче (шаг 13)',
  })
  @IsOptional()
  @IsIn(VEHICLE_STATES)
  state?: VehicleState;
}
