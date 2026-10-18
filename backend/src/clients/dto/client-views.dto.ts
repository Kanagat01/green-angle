import { ApiProperty } from '@nestjs/swagger';
import { ClientType, Role } from '../../generated/prisma/client.js';

export class ClientListItemDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: ClientType })
  type: ClientType;

  @ApiProperty({ example: 'ООО АвтоПодбор Плюс' })
  name: string;

  @ApiProperty()
  usersCount: number;

  @ApiProperty()
  vehiclesCount: number;

  @ApiProperty()
  requestsCount: number;

  @ApiProperty()
  createdAt: Date;
}

export class ClientUserDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  email: string;

  @ApiProperty({ enum: Role })
  role: Role;

  @ApiProperty()
  isActive: boolean;
}

export class ClientDetailDto extends ClientListItemDto {
  @ApiProperty({ type: [ClientUserDto] })
  users: ClientUserDto[];
}

export class ClientListDto {
  @ApiProperty({ type: [ClientListItemDto] })
  items: ClientListItemDto[];

  @ApiProperty({ description: 'Всего записей по фильтру' })
  total: number;
}
