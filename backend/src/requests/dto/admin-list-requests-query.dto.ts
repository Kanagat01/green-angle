import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import { ListRequestsQueryDto } from './list-requests-query.dto.js';

export class AdminListRequestsQueryDto extends ListRequestsQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  clientId?: string;
}
