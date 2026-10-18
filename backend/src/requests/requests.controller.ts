import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth-user.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { Role } from '../generated/prisma/client.js';
import { UnreadCountDto } from '../messages/dto/message-views.dto.js';
import { MessagesService } from '../messages/messages.service.js';
import { CreateRequestDto } from './dto/create-request.dto.js';
import { ListRequestsQueryDto } from './dto/list-requests-query.dto.js';
import { RequestListDto, RequestViewDto } from './dto/request-views.dto.js';
import { RequestsService } from './requests.service.js';

/** Клиентская часть. BROKER/INDIVIDUAL работают со своими заявками, ADMIN читает все. */
@ApiTags('requests')
@ApiBearerAuth()
@Controller('requests')
export class RequestsController {
  constructor(
    private readonly requests: RequestsService,
    private readonly messages: MessagesService,
  ) {}

  @Get()
  @ApiOkResponse({ type: RequestListDto })
  list(@CurrentUser() user: AuthUser, @Query() query: ListRequestsQueryDto) {
    return this.requests.list(user, query);
  }

  /** Счётчик непрочитанных по всем заявкам пользователя (для бейджа в меню). */
  @Get('unread-count')
  @ApiOkResponse({ type: UnreadCountDto })
  unreadCount(@CurrentUser() user: AuthUser) {
    return this.messages.totalUnread(user);
  }

  @Post()
  @Roles(Role.BROKER, Role.INDIVIDUAL)
  @ApiCreatedResponse({ type: RequestViewDto })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateRequestDto) {
    return this.requests.create(user, dto);
  }

  @Get(':id')
  @ApiOkResponse({ type: RequestViewDto })
  @ApiNotFoundResponse({
    description: 'Заявки нет или она принадлежит другому клиенту',
  })
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.requests.get(user, id);
  }
}
