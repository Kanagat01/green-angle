import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { normalizeVin, VIN_REGEX } from './create-vehicle.dto.js';

export class UpdateVehicleDto {
  @ApiPropertyOptional({ example: 'Geely Monjaro, 2024' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({
    description: 'Заполнение VIN у машины, созданной из заявки',
  })
  @IsOptional()
  @Transform(normalizeVin)
  @Matches(VIN_REGEX, { message: 'vin must be a valid 17-character VIN' })
  vin?: string;
}
