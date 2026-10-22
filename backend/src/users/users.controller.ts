import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth-user.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { MeDto } from './dto/me.dto.js';
import { UpdateMeDto } from './dto/update-me.dto.js';
import { UsersService } from './users.service.js';

@ApiTags('me')
@ApiBearerAuth()
@Controller('me')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @ApiOkResponse({ type: MeDto })
  me(@CurrentUser() user: AuthUser) {
    return this.users.getProfile(user.id);
  }

  /** Личные настройки (уведомления). */
  @Patch()
  @ApiOkResponse({ type: MeDto })
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdateMeDto) {
    return this.users.updateProfile(user.id, dto);
  }
}
