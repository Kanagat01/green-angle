import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator.js';
import {
  PublicVehicleStatusDto,
  PublicVehicleStatusQueryDto,
} from './dto/public-status.dto.js';
import { VehiclesService } from './vehicles.service.js';

/** Проверка этапа по VIN на главной сайте, без входа. Частота запросов ограничена по IP. */
@ApiTags('public')
@Public()
@Controller('public')
export class PublicVehiclesController {
  constructor(private readonly vehicles: VehiclesService) {}

  @Get('vehicle-status')
  @ApiOkResponse({ type: PublicVehicleStatusDto })
  @ApiNotFoundResponse({ description: 'Машины с таким VIN нет' })
  @ApiTooManyRequestsResponse({
    description: 'Слишком много проверок с одного IP',
  })
  status(@Query() query: PublicVehicleStatusQueryDto) {
    return this.vehicles.publicStatus(query.vin);
  }
}
