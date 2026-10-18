import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class ListMessagesQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 200, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit: number = 50;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Курсор: id сообщения, до которого (раньше которого) вернуть страницу. Без него — последние сообщения',
  })
  @IsOptional()
  @IsUUID()
  before?: string;
}
