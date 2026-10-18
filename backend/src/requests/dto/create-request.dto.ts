import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export const MIN_YEAR = 1990;
export const MAX_BUDGET = 999_999_999_999;

export class CreateRequestDto {
  @ApiProperty({ example: 'Chery Tiggo 8 Pro', description: 'Марка и модель' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title: string;

  @ApiPropertyOptional({ example: 2023, description: 'Год выпуска от' })
  @IsOptional()
  @IsInt()
  @Min(MIN_YEAR)
  @Max(new Date().getFullYear() + 1)
  yearFrom?: number;

  @ApiPropertyOptional({
    example: 3200000,
    description: 'Бюджет, до 2 знаков после запятой',
  })
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  @Min(0)
  @Max(MAX_BUDGET)
  budget?: number;

  @ApiPropertyOptional({ example: 'Чёрный салон, без панорамы' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}
