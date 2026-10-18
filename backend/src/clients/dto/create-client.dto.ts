import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsString, MaxLength, MinLength } from 'class-validator';
import { ClientType } from '../../generated/prisma/client.js';

export const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateClientDto {
  @ApiProperty({
    enum: ClientType,
    description: 'COMPANY — подборщик-юрлицо, PERSON — физлицо',
  })
  @IsEnum(ClientType)
  type: ClientType;

  @ApiProperty({ example: 'ООО АвтоПодбор Плюс' })
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name: string;
}
