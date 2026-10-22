import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
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
import { UpdateVehicleNotificationsDto } from './dto/update-notifications.dto.js';
import { ListVehiclesQueryDto } from './dto/list-vehicles-query.dto.js';
import { VehicleCardDto, VehicleListDto } from './dto/vehicle-views.dto.js';
import { VehiclesService } from './vehicles.service.js';

/** Клиентская часть. BROKER/INDIVIDUAL видят свои машины, ADMIN — все. */
@ApiTags('vehicles')
@ApiBearerAuth()
@Controller('vehicles')
export class VehiclesController {
  constructor(private readonly vehicles: VehiclesService) {}

  @Get()
  @ApiOkResponse({ type: VehicleListDto })
  list(@CurrentUser() user: AuthUser, @Query() query: ListVehiclesQueryDto) {
    return this.vehicles.list(user, query);
  }

  @Get(':id')
  @ApiOkResponse({ type: VehicleCardDto })
  @ApiNotFoundResponse({
    description: 'Машины нет или она принадлежит другому клиенту',
  })
  card(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.vehicles.getCard(user, id);
  }

  /**
   * Письма о статусе машины конечному клиенту подборщика: email и переключатель. Только для
   * подборщика-владельца; физлицо управляет письмами в `PATCH /me`.
   */
  @Patch(':id/notifications')
  @Roles(Role.BROKER)
  @ApiOkResponse({ type: VehicleCardDto })
  @ApiNotFoundResponse({
    description: 'Машины нет или она принадлежит другому клиенту',
  })
  updateNotifications(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVehicleNotificationsDto,
  ) {
    return this.vehicles.updateNotifications(user, id, dto);
  }
}
