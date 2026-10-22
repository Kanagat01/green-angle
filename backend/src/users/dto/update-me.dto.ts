import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateMeDto {
  @ApiPropertyOptional({
    description:
      'Письма о смене статуса машины на email пользователя. Нужны физлицу (по умолчанию включены); у подборщика письма идут на email клиента, указанный в карточке машины',
  })
  @IsOptional()
  @IsBoolean()
  emailNotifications?: boolean;
}
