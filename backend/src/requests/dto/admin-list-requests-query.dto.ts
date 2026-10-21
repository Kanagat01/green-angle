import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';
import { ListRequestsQueryDto } from './list-requests-query.dto.js';

export class AdminListRequestsQueryDto extends ListRequestsQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  clientId?: string;

  @ApiPropertyOptional({
    description:
      'true — только ждущие ответа, false — только остальные. Очередь всегда отсортирована: ждущие сверху, дальше по времени последнего сообщения',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  awaiting?: boolean;
}
