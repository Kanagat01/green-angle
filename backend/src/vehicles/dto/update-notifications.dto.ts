import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsOptional, MaxLength } from 'class-validator';
import { normalizeEmail } from '../../users/dto/create-user.dto.js';

export class UpdateVehicleNotificationsDto {
  @ApiPropertyOptional({
    example: 'client@mail.ru',
    description:
      'Email конечного клиента подборщика, на который идут письма о статусе',
  })
  @IsOptional()
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @ApiPropertyOptional({
    description:
      'Включить или выключить письма о смене статуса этой машины. Включить можно, только если email указан',
  })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
