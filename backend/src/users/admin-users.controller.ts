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
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth-user.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { Role } from '../generated/prisma/client.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { ListUsersQueryDto } from './dto/list-users-query.dto.js';
import { ResetPasswordDto } from './dto/reset-password.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import {
  AdminUserDto,
  AdminUserListDto,
  ResetPasswordResultDto,
} from './dto/user-views.dto.js';
import { UsersAdminService } from './users-admin.service.js';

/** Управление пользователями (логины подборщиков, физлиц и сотрудников) — только ADMIN. */
@ApiTags('admin / users')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly users: UsersAdminService) {}

  @Get()
  @ApiOkResponse({ type: AdminUserListDto })
  list(@Query() query: ListUsersQueryDto) {
    return this.users.list(query);
  }

  @Post()
  @ApiCreatedResponse({ type: AdminUserDto })
  @ApiConflictResponse({ description: 'Email уже занят' })
  create(@Body() dto: CreateUserDto) {
    return this.users.create(dto);
  }

  @Get(':id')
  @ApiOkResponse({ type: AdminUserDto })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.users.get(id);
  }

  @Patch(':id')
  @ApiOkResponse({ type: AdminUserDto })
  @ApiConflictResponse({
    description: 'Email занят или попытка деактивировать себя',
  })
  update(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.users.update(actor, id, dto);
  }

  @Post(':id/reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: ResetPasswordResultDto })
  resetPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResetPasswordDto,
  ) {
    return this.users.resetPassword(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  @ApiConflictResponse({
    description: 'Нельзя удалить себя или пользователя с историей',
  })
  remove(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.users.remove(actor, id);
  }
}
