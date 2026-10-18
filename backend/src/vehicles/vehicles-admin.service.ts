import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuthUser } from '../auth/auth-user.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AttachmentsService } from '../storage/attachments.service.js';
import { AddStepAttachmentDto } from './dto/add-step-attachment.dto.js';
import { ChangeStatusDto } from './dto/change-status.dto.js';
import { CreateVehicleDto } from './dto/create-vehicle.dto.js';
import { UpdateVehicleDto } from './dto/update-vehicle.dto.js';
import { StepAttachmentDto, VehicleCardDto } from './dto/vehicle-views.dto.js';
import { DECLARATION_STEP, STEPS, TOTAL_STEPS } from './steps.catalog.js';
import { VehiclesService } from './vehicles.service.js';

type Tx = Prisma.TransactionClient;

@Injectable()
export class VehiclesAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly attachments: AttachmentsService,
    private readonly vehicles: VehiclesService,
  ) {}

  /** Ручное создание машины в супер ЛК: VIN обязателен, клиент — существующий или новый. */
  async create(user: AuthUser, dto: CreateVehicleDto): Promise<VehicleCardDto> {
    if (Boolean(dto.clientId) === Boolean(dto.client)) {
      throw new BadRequestException(
        'Provide exactly one of clientId or client',
      );
    }

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        let clientId = dto.clientId;
        if (clientId) {
          const exists = await tx.client.findUnique({
            where: { id: clientId },
            select: { id: true },
          });
          if (!exists) throw new NotFoundException('Client not found');
        } else {
          clientId = (await tx.client.create({ data: dto.client! })).id;
        }

        const now = new Date();
        return tx.vehicle.create({
          data: {
            clientId,
            title: dto.title,
            vin: dto.vin,
            currentStep: dto.startStep,
            steps: { create: initialSteps(dto.startStep, now) },
            statusLogs: {
              create: {
                fromStep: null,
                toStep: dto.startStep,
                changedById: user.id,
              },
            },
          },
          select: { id: true },
        });
      });
      return this.vehicles.getCard(user, created.id);
    } catch (err) {
      throw translateDbError(err);
    }
  }

  /** Правка названия / заполнение VIN. */
  async update(
    user: AuthUser,
    id: string,
    dto: UpdateVehicleDto,
  ): Promise<VehicleCardDto> {
    const data: Prisma.VehicleUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.vin !== undefined) data.vin = dto.vin;
    if (Object.keys(data).length === 0) {
      throw new BadRequestException('Nothing to update');
    }

    try {
      await this.prisma.vehicle.update({ where: { id }, data });
    } catch (err) {
      throw translateDbError(err);
    }
    return this.vehicles.getCard(user, id);
  }

  /**
   * Смена статуса: вперёд и назад. Всё в одной транзакции вместе с записью в журнал
   * VehicleStatusLog (кто, когда, с какого шага на какой).
   */
  async changeStatus(
    user: AuthUser,
    id: string,
    dto: ChangeStatusDto,
  ): Promise<VehicleCardDto> {
    const to = dto.step;
    const declaration = dto.declarationNumber;
    if (declaration !== undefined && to < DECLARATION_STEP) {
      throw new BadRequestException(
        `declarationNumber is applicable from step ${DECLARATION_STEP}`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      const vehicle = await tx.vehicle.findUnique({
        where: { id },
        select: { currentStep: true },
      });
      if (!vehicle) throw new NotFoundException('Vehicle not found');
      const from = vehicle.currentStep;

      // Тот же шаг допустим только чтобы дополнить номер декларации
      if (to === from && declaration === undefined) {
        throw new BadRequestException('Vehicle is already at this step');
      }

      if (this.config.get<boolean>('STRICT_ATTACHMENTS')) {
        await assertExpectedAttachments(tx, id, to, declaration);
      }

      // Условное обновление защищает от гонки двух администраторов
      const moved = await tx.vehicle.updateMany({
        where: { id, currentStep: from },
        data: { currentStep: to },
      });
      if (moved.count === 0) {
        throw new ConflictException(
          'Vehicle status was changed concurrently, retry',
        );
      }

      const now = new Date();
      await tx.vehicleStep.updateMany({
        where: { vehicleId: id, step: { gte: to } },
        data: { completedAt: null },
      });
      await tx.vehicleStep.updateMany({
        where: { vehicleId: id, step: { lt: to }, completedAt: null },
        data: { completedAt: now },
      });
      if (to === TOTAL_STEPS) {
        await tx.vehicleStep.updateMany({
          where: { vehicleId: id, step: TOTAL_STEPS },
          data: { completedAt: now },
        });
      }
      if (declaration !== undefined) {
        await tx.vehicleStep.updateMany({
          where: { vehicleId: id, step: DECLARATION_STEP },
          data: { declarationNumber: declaration },
        });
      }

      await tx.vehicleStatusLog.create({
        data: {
          vehicleId: id,
          fromStep: from,
          toStep: to,
          declarationNumber: declaration,
          changedById: user.id,
        },
      });
    });

    return this.vehicles.getCard(user, id);
  }

  /** Прикрепляет к шагу файл, ранее загруженный в S3 по presigned URL. */
  async addStepAttachment(
    user: AuthUser,
    vehicleId: string,
    step: number,
    dto: AddStepAttachmentDto,
  ): Promise<StepAttachmentDto> {
    if (step < 1 || step > TOTAL_STEPS) {
      throw new BadRequestException(
        `step must be between 1 and ${TOTAL_STEPS}`,
      );
    }
    const row = await this.prisma.vehicleStep.findUnique({
      where: { vehicleId_step: { vehicleId, step } },
      select: { id: true },
    });
    if (!row) throw new NotFoundException('Vehicle not found');

    const attachment = await this.attachments.createFromUpload(user, {
      key: dto.key,
      kind: dto.kind,
      vehicleStepId: row.id,
    });
    return this.attachments.toView(attachment);
  }
}

/** Шаги новой машины: всё до стартового — завершено (для 13 — и он сам). */
function initialSteps(currentStep: number, now: Date) {
  return Array.from({ length: TOTAL_STEPS }, (_, i) => {
    const step = i + 1;
    const completed =
      step < currentStep ||
      (step === TOTAL_STEPS && currentStep === TOTAL_STEPS);
    return { step, completedAt: completed ? now : null };
  });
}

/** Строгий режим (STRICT_ATTACHMENTS): пройденные шаги должны иметь ожидаемое вложение. */
async function assertExpectedAttachments(
  tx: Tx,
  vehicleId: string,
  to: number,
  newDeclaration: string | undefined,
): Promise<void> {
  const passed = await tx.vehicleStep.findMany({
    where: { vehicleId, step: { lt: to } },
    orderBy: { step: 'asc' },
    include: { _count: { select: { attachments: true } } },
  });

  const missing = passed
    .filter((s) => {
      const expected = STEPS[s.step - 1].expectedAttachment;
      if (!expected) return false;
      if (expected === 'DECLARATION_NUMBER') {
        return !(s.declarationNumber ?? newDeclaration);
      }
      return s._count.attachments === 0;
    })
    .map((s) => s.step);

  if (missing.length > 0) {
    throw new BadRequestException(
      `Expected attachments are missing for steps: ${missing.join(', ')}`,
    );
  }
}

function translateDbError(err: unknown): unknown {
  const code = (err as { code?: string } | null)?.code;
  if (code === 'P2002') {
    return new ConflictException('Vehicle with this VIN already exists');
  }
  if (code === 'P2025') return new NotFoundException('Vehicle not found');
  return err;
}
