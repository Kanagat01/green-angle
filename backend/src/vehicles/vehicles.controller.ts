import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth-user.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
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
}
