import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';
import { ClientType } from '../../generated/prisma/client.js';

export class ListClientsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Поиск по подстроке названия (без учёта регистра)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({ enum: ClientType })
  @IsOptional()
  @IsEnum(ClientType)
  type?: ClientType;
}
