import { ApiProperty } from '@nestjs/swagger';
import {
  ClientType,
  MessageType,
  RequestStatus,
} from '../../generated/prisma/client.js';
import { VehicleCardDto } from '../../vehicles/dto/vehicle-views.dto.js';

export class RequestClientDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: ClientType })
  type: ClientType;

  @ApiProperty({ example: 'ООО АвтоПодбор Плюс' })
  name: string;
}

export const LAST_MESSAGE_AUTHORS = ['CLIENT', 'MANAGER', 'SYSTEM'] as const;
export type LastMessageAuthor = (typeof LAST_MESSAGE_AUTHORS)[number];

/** Последнее сообщение диалога — для строки списка и очереди. */
export class LastMessageDto {
  @ApiProperty({ enum: MessageType })
  type: MessageType;

  @ApiProperty({
    nullable: true,
    type: String,
    description:
      'Начало текста (до 200 символов); null, если текста нет — тогда смотрите hasAttachments',
  })
  text: string | null;

  @ApiProperty({
    description: 'У сообщения есть вложения (фото, видео, файлы, голосовое)',
  })
  hasAttachments: boolean;

  @ApiProperty({
    enum: LAST_MESSAGE_AUTHORS,
    description:
      'CLIENT — владелец заявки, MANAGER — сотрудник (ADMIN), SYSTEM — служебная строка',
  })
  author: LastMessageAuthor;

  @ApiProperty()
  createdAt: Date;
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

  @ApiProperty({
    description:
      'Ждёт ответа менеджера: заявка открыта и последнее сообщение написал клиент',
  })
  awaitingReply: boolean;

  @ApiProperty({ type: LastMessageDto, nullable: true })
  lastMessage: LastMessageDto | null;

  @ApiProperty()
  createdAt: Date;
}

export class RequestListDto {
  @ApiProperty({ type: [RequestViewDto] })
  items: RequestViewDto[];

  @ApiProperty({ description: 'Всего записей по фильтру' })
  total: number;
}

export class RequestCountsDto {
  @ApiProperty({ description: 'Заявки, ожидающие ответа менеджера' })
  awaitingReply: number;

  @ApiProperty({ description: 'Все заявки' })
  total: number;
}

export class ApproveRequestResultDto {
  @ApiProperty({
    type: RequestViewDto,
    description: 'Заявка в статусе APPROVED со ссылкой на машину',
  })
  request: RequestViewDto;

  @ApiProperty({
    type: VehicleCardDto,
    description: 'Созданная машина: шаг 1, VIN пустой, клиент заявки',
  })
  vehicle: VehicleCardDto;
}
