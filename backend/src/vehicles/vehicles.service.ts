import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user.js';
import { clientScope } from '../common/scope.js';
import type { Prisma } from '../generated/prisma/client.js';
import { ClientType } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AttachmentsService } from '../storage/attachments.service.js';
import {
  DECLARATION_STEP,
  STEPS,
  stepTitle,
  TOTAL_STEPS,
} from './steps.catalog.js';
import type { VehicleState } from './dto/list-vehicles-query.dto.js';
import { PublicVehicleStatusDto } from './dto/public-status.dto.js';
import { UpdateVehicleNotificationsDto } from './dto/update-notifications.dto.js';
import {
  StepState,
  VehicleCardDto,
  VehicleCountsDto,
  VehicleListDto,
  VehicleListItemDto,
} from './dto/vehicle-views.dto.js';

export interface VehicleFilters {
  vin?: string;
  /** Подстрока VIN или названия */
  search?: string;
  /** active — в пути (шаги 1–12), ready — готовы к выдаче (шаг 13) */
  state?: VehicleState;
  clientId?: string;
  ownerType?: ClientType;
  step?: number;
  limit: number;
  offset: number;
}

const listInclude = {
  client: { select: { id: true, type: true, name: true } },
  request: { select: { id: true } },
} satisfies Prisma.VehicleInclude;

const cardInclude = {
  client: { select: { id: true, type: true, name: true } },
  request: { select: { id: true } },
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
      deletedAt: null,
      ...(filters.vin
        ? { vin: { contains: filters.vin, mode: 'insensitive' } }
        : {}),
      ...(filters.search
        ? {
            OR: [
              { vin: { contains: filters.search, mode: 'insensitive' } },
              { title: { contains: filters.search, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(filters.state === 'active'
        ? { currentStep: { lt: TOTAL_STEPS } }
        : filters.state === 'ready'
          ? { currentStep: TOTAL_STEPS }
          : {}),
      ...(filters.clientId ? { clientId: filters.clientId } : {}),
      ...(filters.ownerType ? { client: { type: filters.ownerType } } : {}),
      ...(filters.step ? { currentStep: filters.step } : {}),
      ...clientScope(user),
    };

    const [items, total, counts] = await Promise.all([
      this.prisma.vehicle.findMany({
        where,
        include: listInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: filters.limit,
        skip: filters.offset,
      }),
      this.prisma.vehicle.count({ where }),
      this.counts(user),
    ]);
    const ids = items.map((v) => v.id);
    const [attachments, awaiting] = await Promise.all([
      this.attachmentCounts(ids),
      this.awaitingAttachment(items),
    ]);

    return {
      items: items.map((v) =>
        toListItem(v, attachments.get(v.id) ?? 0, awaiting.has(v.id)),
      ),
      total,
      counts,
    };
  }

  /** Этап машины по VIN для всех желающих: без владельца и вложений. Удалённые не находятся. */
  async publicStatus(vin: string): Promise<PublicVehicleStatusDto> {
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { vin, deletedAt: null },
      select: { title: true, currentStep: true, updatedAt: true },
    });
    if (!vehicle) throw new NotFoundException('Vehicle not found');
    return {
      title: vehicle.title,
      currentStep: vehicle.currentStep,
      currentStepTitle: stepTitle(vehicle.currentStep),
      totalSteps: TOTAL_STEPS,
      progress: vehicle.currentStep / TOTAL_STEPS,
      updatedAt: vehicle.updatedAt,
    };
  }

  /**
   * Письма о статусе для конечного клиента подборщика. Меняет только владелец-подборщик
   * (чужая машина — 404). Включить можно только при указанном email; смена email не включает
   * и не выключает письма сама.
   */
  async updateNotifications(
    user: AuthUser,
    id: string,
    dto: UpdateVehicleNotificationsDto,
  ): Promise<VehicleCardDto> {
    if (dto.email === undefined && dto.enabled === undefined) {
      throw new BadRequestException('Nothing to update');
    }
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id, deletedAt: null, ...clientScope(user) },
      select: { notifyEmail: true },
    });
    if (!vehicle) throw new NotFoundException('Vehicle not found');

    const email = dto.email ?? vehicle.notifyEmail;
    if (dto.enabled === true && !email) {
      throw new BadRequestException('Provide an email to enable notifications');
    }
    await this.prisma.vehicle.update({
      where: { id },
      data: {
        ...(dto.email === undefined ? {} : { notifyEmail: dto.email }),
        ...(dto.enabled === undefined ? {} : { notifyEnabled: dto.enabled }),
      },
    });
    return this.getCard(user, id);
  }

  /** Счётчики для вкладок: по всем доступным пользователю машинам, без учёта фильтров списка. */
  private async counts(user: AuthUser): Promise<VehicleCountsDto> {
    const scope = { deletedAt: null, ...clientScope(user) };
    const [all, ready, company, person] = await Promise.all([
      this.prisma.vehicle.count({ where: scope }),
      this.prisma.vehicle.count({
        where: { ...scope, currentStep: TOTAL_STEPS },
      }),
      this.prisma.vehicle.count({
        where: { ...scope, client: { type: ClientType.COMPANY } },
      }),
      this.prisma.vehicle.count({
        where: { ...scope, client: { type: ClientType.PERSON } },
      }),
    ]);
    return { all, active: all - ready, ready, company, person };
  }

  /**
   * Машины из списка, у которых текущий шаг требует вложение (или номер декларации),
   * а его ещё нет: по ним менеджеру нужно что-то приложить.
   */
  private async awaitingAttachment(
    vehicles: { id: string; currentStep: number }[],
  ): Promise<Set<string>> {
    const expecting = vehicles.filter(
      (v) => STEPS[v.currentStep - 1].expectedAttachment !== null,
    );
    if (expecting.length === 0) return new Set();
    const rows = await this.prisma.$queryRaw<
      { vehicleId: string; count: number; declarationNumber: string | null }[]
    >`SELECT v."id" AS "vehicleId", count(a."id")::int AS count, s."declarationNumber"
        FROM "Vehicle" v
        JOIN "VehicleStep" s ON s."vehicleId" = v."id" AND s."step" = v."currentStep"
        LEFT JOIN "Attachment" a ON a."vehicleStepId" = s."id"
       WHERE v."id" = ANY(${expecting.map((v) => v.id)}::uuid[])
       GROUP BY v."id", s."declarationNumber"`;
    const byId = new Map(rows.map((r) => [r.vehicleId, r]));
    return new Set(
      expecting
        .filter((v) => {
          const row = byId.get(v.id);
          if (!row) return true;
          return STEPS[v.currentStep - 1].expectedAttachment ===
            'DECLARATION_NUMBER'
            ? !row.declarationNumber
            : row.count === 0;
        })
        .map((v) => v.id),
    );
  }

  /** Число вложений на шагах: vehicleId → количество (машины без вложений не включаются). */
  private async attachmentCounts(
    vehicleIds: string[],
  ): Promise<Map<string, number>> {
    if (vehicleIds.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<
      { vehicleId: string; count: number }[]
    >`SELECT s."vehicleId", count(a."id")::int AS count
        FROM "Attachment" a
        JOIN "VehicleStep" s ON s."id" = a."vehicleStepId"
       WHERE s."vehicleId" = ANY(${vehicleIds}::uuid[])
       GROUP BY s."vehicleId"`;
    return new Map(rows.map((r) => [r.vehicleId, r.count]));
  }

  /** Карточка машины: 13 шагов с состоянием, вложениями и номером декларации. */
  async getCard(user: AuthUser, id: string): Promise<VehicleCardDto> {
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id, deletedAt: null, ...clientScope(user) },
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
    const attachmentsCount = steps.reduce(
      (n, s) => n + s.attachments.length,
      0,
    );
    const current = steps[vehicle.currentStep - 1];
    const awaiting =
      current.expectedAttachment === 'DECLARATION_NUMBER'
        ? !current.declarationNumber
        : current.expectedAttachment !== null &&
          current.attachments.length === 0;
    return { ...toListItem(vehicle, attachmentsCount, awaiting), steps };
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

function toListItem(
  v: VehicleWithClient,
  attachmentsCount: number,
  awaitingAttachment: boolean,
): VehicleListItemDto {
  return {
    id: v.id,
    title: v.title,
    vin: v.vin,
    currentStep: v.currentStep,
    currentStepTitle: stepTitle(v.currentStep),
    totalSteps: TOTAL_STEPS,
    progress: v.currentStep / TOTAL_STEPS,
    client: v.client,
    requestId: v.request?.id ?? null,
    attachmentsCount,
    awaitingAttachment,
    notifyEmail: v.notifyEmail,
    notifyEnabled: v.notifyEnabled,
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
  };
}
