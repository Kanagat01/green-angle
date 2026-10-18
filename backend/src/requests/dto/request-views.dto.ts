import { ApiProperty } from '@nestjs/swagger';
import { ClientType, RequestStatus } from '../../generated/prisma/client.js';

export class RequestClientDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: ClientType })
  type: ClientType;

  @ApiProperty({ example: 'ООО АвтоПодбор Плюс' })
  name: string;
}

export class RequestViewDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ example: 'Chery Tiggo 8 Pro' })
  title: string;

  @ApiProperty({ nullable: true, type: Number })
  yearFrom: number | null;

  @ApiProperty({ nullable: true, type: Number, example: 3200000 })
  budget: number | null;

  @ApiProperty({ nullable: true, type: String })
  comment: string | null;

  @ApiProperty({ enum: RequestStatus })
  status: RequestStatus;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Машина, созданная при одобрении заявки',
  })
  vehicleId: string | null;

  @ApiProperty({ type: RequestClientDto })
  client: RequestClientDto;

  @ApiProperty({
    description: 'Непрочитанные сообщения диалога для текущего пользователя',
  })
  unreadCount: number;

  @ApiProperty()
  createdAt: Date;
}

export class RequestListDto {
  @ApiProperty({ type: [RequestViewDto] })
  items: RequestViewDto[];

  @ApiProperty({ description: 'Всего записей по фильтру' })
  total: number;
}
