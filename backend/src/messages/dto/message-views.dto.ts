import { ApiProperty } from '@nestjs/swagger';
import { MessageType, Role } from '../../generated/prisma/client.js';
import { StepAttachmentDto } from '../../vehicles/dto/vehicle-views.dto.js';

export class MessageAuthorDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: Role })
  role: Role;
}

export class MessageViewDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  requestId: string;

  @ApiProperty({ enum: MessageType })
  type: MessageType;

  @ApiProperty({ nullable: true, type: String })
  text: string | null;

  @ApiProperty({ type: [String] })
  links: string[];

  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'Длительность голосового, секунды',
  })
  durationSec: number | null;

  @ApiProperty({
    type: [StepAttachmentDto],
    description:
      'Фото/видео/файлы (и аудио для голосовых) со свежими presigned-ссылками',
  })
  attachments: StepAttachmentDto[];

  @ApiProperty({ type: MessageAuthorDto })
  author: MessageAuthorDto;

  @ApiProperty({ description: 'Сообщение написано текущим пользователем' })
  isMine: boolean;

  @ApiProperty()
  createdAt: Date;
}

export class MessageListDto {
  @ApiProperty({
    type: [MessageViewDto],
    description: 'От старых к новым',
  })
  items: MessageViewDto[];

  @ApiProperty({ description: 'Есть ли более ранние сообщения' })
  hasMore: boolean;
}

export class UnreadCountDto {
  @ApiProperty({
    description: 'Непрочитанные сообщения (чужие, без отметки о прочтении)',
  })
  unreadCount: number;
}
