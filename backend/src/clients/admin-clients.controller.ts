import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { Role } from '../generated/prisma/client.js';
import { ClientsService } from './clients.service.js';
import { ClientDetailDto, ClientListDto } from './dto/client-views.dto.js';
import { CreateClientDto } from './dto/create-client.dto.js';
import { ListClientsQueryDto } from './dto/list-clients-query.dto.js';
import { UpdateClientDto } from './dto/update-client.dto.js';

/** Управление клиентами (компании-подборщики и физлица) — только ADMIN. */
@ApiTags('admin / clients')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('admin/clients')
export class AdminClientsController {
  constructor(private readonly clients: ClientsService) {}

  @Get()
  @ApiOkResponse({ type: ClientListDto })
  list(@Query() query: ListClientsQueryDto) {
    return this.clients.list(query);
  }

  @Post()
  @ApiCreatedResponse({ type: ClientDetailDto })
  create(@Body() dto: CreateClientDto) {
    return this.clients.create(dto);
  }

  @Get(':id')
  @ApiOkResponse({ type: ClientDetailDto })
  @ApiNotFoundResponse()
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.clients.get(id);
  }

  @Patch(':id')
  @ApiOkResponse({ type: ClientDetailDto })
  @ApiConflictResponse({
    description: 'Нельзя менять тип клиента, у которого есть пользователи',
  })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateClientDto) {
    return this.clients.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  @ApiConflictResponse({
    description: 'У клиента есть пользователи, машины или заявки',
  })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.clients.remove(id);
  }
}
