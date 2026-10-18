import {
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
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth-user.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { Role } from '../generated/prisma/client.js';
import { AdminListRequestsQueryDto } from './dto/admin-list-requests-query.dto.js';
import {
  ApproveRequestResultDto,
  RequestListDto,
} from './dto/request-views.dto.js';
import { RequestsService } from './requests.service.js';

/** Единая очередь заявок и одобрение для супер ЛК. */
@ApiTags('admin / requests')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('admin/requests')
export class AdminRequestsController {
  constructor(private readonly requests: RequestsService) {}

  @Get()
  @ApiOkResponse({ type: RequestListDto })
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: AdminListRequestsQueryDto,
  ) {
    return this.requests.list(user, query);
  }

  /**
   * Одобрить заявку: создаёт машину (шаг 1, без VIN) и закрывает диалог для записи.
   * Идемпотентно — повторный вызов возвращает ту же машину.
   */
  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: ApproveRequestResultDto })
  @ApiNotFoundResponse({ description: 'Заявка не найдена' })
  approve(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.requests.approve(user, id);
  }
}
