import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { Matches } from 'class-validator';

export class PublicVehicleStatusQueryDto {
  @ApiProperty({
    description: 'VIN из 17 символов: латинские буквы и цифры',
    example: 'LVSHCAMB5RE077734',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(/^[A-Z0-9]{17}$/, {
    message: 'vin must be 17 Latin letters and digits',
  })
  vin: string;
}

/** Только то, что можно показать без входа: модель, этап и прогресс. Ни владельца, ни вложений. */
export class PublicVehicleStatusDto {
  @ApiProperty({ example: 'Geely Monjaro, 2024' })
  title: string;

  @ApiProperty()
  currentStep: number;

  @ApiProperty({ example: 'Прибыла на СВХ, ожидает тамож. оформление' })
  currentStepTitle: string;

  @ApiProperty({ example: 13 })
  totalSteps: number;

  @ApiProperty({ description: 'currentStep / totalSteps', example: 0.69 })
  progress: number;

  @ApiProperty({ description: 'Последнее обновление' })
  updatedAt: Date;
}
