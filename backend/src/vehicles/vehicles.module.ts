import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module.js';
import { AdminVehiclesController } from './admin-vehicles.controller.js';
import { VehiclesAdminService } from './vehicles-admin.service.js';
import { VehiclesController } from './vehicles.controller.js';
import { VehiclesService } from './vehicles.service.js';

@Module({
  imports: [StorageModule],
  controllers: [VehiclesController, AdminVehiclesController],
  providers: [VehiclesService, VehiclesAdminService],
  exports: [VehiclesService],
})
export class VehiclesModule {}
