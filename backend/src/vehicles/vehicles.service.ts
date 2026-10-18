import { Injectable, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user.js';
import { clientScope } from '../common/scope.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AttachmentsService } from '../storage/attachments.service.js';
import {
  DECLARATION_STEP,
  STEPS,
  stepTitle,
  TOTAL_STEPS,
} from './steps.catalog.js';
import {
  StepState,
  VehicleCardDto,
  VehicleListDto,
  VehicleListItemDto,
} from './dto/vehicle-views.dto.js';

export interface VehicleFilters {
  vin?: string;
  clientId?: string;
  step?: number;
  limit: number;
  offset: number;
}

const listInclude = {
  client: { select: { id: true, type: true, name: true } },
} satisfies Prisma.VehicleInclude;

const cardInclude = {
  client: { select: { id: true, type: true, name: true } },
  steps: {
    orderBy: { step: 'asc' },
    include: { attachments: { orderBy: { createdAt: 'asc' } } },
  },
} satisfies Prisma.VehicleInclude;

type VehicleWithClient = Prisma.VehicleGetPayload<{
  include: typeof listInclude;
}>;
type VehicleWithSteps = Prisma.VehicleGetPayload<{
  include: typeof cardInclude;
}>;

@Injectable()
export class VehiclesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly attachments: AttachmentsService,
  ) {}

  /**
   * Список машин. Изоляция по клиенту применяется последней, поэтому для BROKER/INDIVIDUAL
   * она перекрывает любой переданный clientId; ADMIN видит всё и может фильтровать.
   */
  async list(user: AuthUser, filters: VehicleFilters): Promise<VehicleListDto> {
    const where: Prisma.VehicleWhereInput = {
      ...(filters.vin
        ? { vin: { contains: filters.vin, mode: 'insensitive' } }
        : {}),
      ...(filters.clientId ? { clientId: filters.clientId } : {}),
      ...(filters.step ? { currentStep: filters.step } : {}),
      ...clientScope(user),
    };

    const [items, total] = await Promise.all([
      this.prisma.vehicle.findMany({
        where,
        include: listInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: filters.limit,
        skip: filters.offset,
      }),
      this.prisma.vehicle.count({ where }),
    ]);

    return { items: items.map((v) => toListItem(v)), total };
  }

  /** Карточка машины: 13 шагов с состоянием, вложениями и номером декларации. */
  async getCard(user: AuthUser, id: string): Promise<VehicleCardDto> {
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id, ...clientScope(user) },
      include: cardInclude,
    });
    // 404, а не 403: не раскрываем существование чужих машин
    if (!vehicle) throw new NotFoundException('Vehicle not found');
    return this.toCard(vehicle);
  }

  private async toCard(vehicle: VehicleWithSteps): Promise<VehicleCardDto> {
    const steps = await Promise.all(
      vehicle.steps.map(async (s) => ({
        step: s.step,
        title: stepTitle(s.step),
        state: stepState(s.step, vehicle.currentStep, s.completedAt),
        completedAt: s.completedAt,
        expectedAttachment: STEPS[s.step - 1].expectedAttachment,
        declarationNumber:
          s.step === DECLARATION_STEP ? s.declarationNumber : null,
        attachments: await Promise.all(
          s.attachments.map((a) => this.attachments.toView(a)),
        ),
      })),
    );
    return { ...toListItem(vehicle), steps };
  }
}

function stepState(
  step: number,
  currentStep: number,
  completedAt: Date | null,
): StepState {
  if (completedAt) return 'COMPLETED';
  return step === currentStep ? 'CURRENT' : 'PENDING';
}

function toListItem(v: VehicleWithClient): VehicleListItemDto {
  return {
    id: v.id,
    title: v.title,
    vin: v.vin,
    currentStep: v.currentStep,
    currentStepTitle: stepTitle(v.currentStep),
    totalSteps: TOTAL_STEPS,
    progress: v.currentStep / TOTAL_STEPS,
    client: v.client,
    createdAt: v.createdAt,
  };
}
