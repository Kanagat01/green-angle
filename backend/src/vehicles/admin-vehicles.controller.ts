import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
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
import { AddStepAttachmentDto } from './dto/add-step-attachment.dto.js';
import { AdminListVehiclesQueryDto } from './dto/admin-list-vehicles-query.dto.js';
import { ChangeStatusDto } from './dto/change-status.dto.js';
import { CreateVehicleDto } from './dto/create-vehicle.dto.js';
import { UpdateVehicleDto } from './dto/update-vehicle.dto.js';
import {
  StepAttachmentDto,
  VehicleCardDto,
  VehicleListDto,
} from './dto/vehicle-views.dto.js';
import { VehiclesAdminService } from './vehicles-admin.service.js';
import { VehiclesService } from './vehicles.service.js';

/** Супер ЛК: только ADMIN. */
@ApiTags('admin / vehicles')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('admin/vehicles')
export class AdminVehiclesController {
  constructor(
    private readonly vehicles: VehiclesService,
    private readonly admin: VehiclesAdminService,
  ) {}

  @Get()
  @ApiOkResponse({ type: VehicleListDto })
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: AdminListVehiclesQueryDto,
  ) {
    return this.vehicles.list(user, query);
  }

  @Post()
  @ApiCreatedResponse({ type: VehicleCardDto })
  @ApiConflictResponse({ description: 'VIN уже существует' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateVehicleDto) {
    return this.admin.create(user, dto);
  }

  @Patch(':id')
  @ApiOkResponse({ type: VehicleCardDto })
  @ApiConflictResponse({ description: 'VIN уже существует' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVehicleDto,
  ) {
    return this.admin.update(user, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({
    description:
      'Машина удалена: пропадает у владельца вместе с вложениями шагов, VIN освобождается',
  })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.remove(id);
  }

  @Post(':id/status')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: VehicleCardDto })
  changeStatus(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeStatusDto,
  ) {
    return this.admin.changeStatus(user, id, dto);
  }

  @Post(':id/steps/:step/attachments')
  @ApiCreatedResponse({ type: StepAttachmentDto })
  addAttachment(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('step', ParseIntPipe) step: number,
    @Body() dto: AddStepAttachmentDto,
  ) {
    return this.admin.addStepAttachment(user, id, step, dto);
  }
}
