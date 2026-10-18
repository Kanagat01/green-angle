import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class ChangeStatusDto {
  @ApiProperty({
    minimum: 1,
    maximum: 13,
    description:
      'Целевой шаг; можно двигать вперёд и назад (исправление ошибок)',
  })
  @IsInt()
  @Min(1)
  @Max(13)
  step: number;

  @ApiPropertyOptional({
    example: '10702070/181024/5012345',
    description: 'Номер декларации; применим при переходе на шаг 10 и далее',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  declarationNumber?: string;
}
