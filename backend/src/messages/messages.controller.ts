import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth-user.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { CreateMessageDto } from './dto/create-message.dto.js';
import { ListMessagesQueryDto } from './dto/list-messages-query.dto.js';
import {
  MessageListDto,
  MessageViewDto,
  UnreadCountDto,
} from './dto/message-views.dto.js';
import { MessagesService } from './messages.service.js';

/** Диалог по заявке. Доступ — у клиента-владельца заявки и у ADMIN. */
@ApiTags('messages')
@ApiBearerAuth()
@ApiNotFoundResponse({
  description: 'Заявки нет или она принадлежит другому клиенту',
})
@Controller('requests/:id')
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Get('messages')
  @ApiOkResponse({ type: MessageListDto })
  list(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListMessagesQueryDto,
  ) {
    return this.messages.list(user, id, query);
  }

  @Post('messages')
  @ApiCreatedResponse({ type: MessageViewDto })
  @ApiConflictResponse({
    description: 'Заявка одобрена — диалог только для чтения',
  })
  create(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateMessageDto,
  ) {
    return this.messages.create(user, id, dto);
  }

  @Post('read')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: UnreadCountDto })
  markRead(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.messages.markRead(user, id);
  }
}
