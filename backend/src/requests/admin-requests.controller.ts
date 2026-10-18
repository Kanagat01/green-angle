import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth-user.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { Role } from '../generated/prisma/client.js';
import { AdminListRequestsQueryDto } from './dto/admin-list-requests-query.dto.js';
import { RequestListDto } from './dto/request-views.dto.js';
import { RequestsService } from './requests.service.js';

/** Единая очередь заявок для супер ЛК. */
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
}
