import { ApiProperty } from '@nestjs/swagger';
import { AttachmentKind, ClientType } from '../../generated/prisma/client.js';

export class VehicleClientDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: ClientType })
  type: ClientType;

  @ApiProperty({ example: 'ООО АвтоПодбор Плюс' })
  name: string;
}

export class VehicleListItemDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ example: 'Geely Monjaro, 2024' })
  title: string;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'null, пока VIN не заполнен',
  })
  vin: string | null;

  @ApiProperty({ minimum: 1, maximum: 13 })
  currentStep: number;

  @ApiProperty({ example: 'Прибыла на СВХ, ожидает тамож. оформление' })
  currentStepTitle: string;

  @ApiProperty({ example: 13 })
  totalSteps: number;

  @ApiProperty({ description: 'currentStep / totalSteps', example: 0.69 })
  progress: number;

  @ApiProperty({ type: VehicleClientDto })
  client: VehicleClientDto;

  @ApiProperty({
    nullable: true,
    type: String,
    description:
      'Заявка, из которой создана машина («Диалог по заявке»); null — машину завели вручную',
  })
  requestId: string | null;

  @ApiProperty({ description: 'Вложений на всех шагах' })
  attachmentsCount: number;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({
    description:
      'Последняя смена статуса или правка названия / VIN («Обновлено»)',
  })
  updatedAt: Date;
}

/** Счётчики для вкладок и фильтров; считаются по всем доступным машинам, без учёта фильтров списка. */
export class VehicleCountsDto {
  @ApiProperty({ description: 'Все машины' })
  all: number;

  @ApiProperty({ description: 'В пути: шаги 1–12' })
  active: number;

  @ApiProperty({ description: 'Готовы к выдаче: шаг 13' })
  ready: number;

  @ApiProperty({ description: 'Владелец — компания по привозу' })
  company: number;

  @ApiProperty({ description: 'Владелец — физ.лицо' })
  person: number;
}

export class VehicleListDto {
  @ApiProperty({ type: [VehicleListItemDto] })
  items: VehicleListItemDto[];

  @ApiProperty({ description: 'Всего записей по фильтру' })
  total: number;

  @ApiProperty({ type: VehicleCountsDto })
  counts: VehicleCountsDto;
}

export class StepAttachmentDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: AttachmentKind })
  kind: AttachmentKind;

  @ApiProperty()
  mime: string;

  @ApiProperty()
  size: number;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({
    description:
      'Короткоживущая ссылка на скачивание (S3 или API; может быть относительной)',
  })
  url: string;
}

export const STEP_STATES = ['COMPLETED', 'CURRENT', 'PENDING'] as const;
export type StepState = (typeof STEP_STATES)[number];

export class VehicleStepDto {
  @ApiProperty({ minimum: 1, maximum: 13 })
  step: number;

  @ApiProperty()
  title: string;

  @ApiProperty({ enum: STEP_STATES })
  state: StepState;

  @ApiProperty({ nullable: true, type: Date })
  completedAt: Date | null;

  @ApiProperty({
    nullable: true,
    type: String,
    enum: ['PHOTO', 'VIDEO', 'FILE', 'DECLARATION_NUMBER'],
    description: 'Какое вложение ожидается на шаге',
  })
  expectedAttachment: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Только для шага 10',
  })
  declarationNumber: string | null;

  @ApiProperty({ type: [StepAttachmentDto] })
  attachments: StepAttachmentDto[];
}

export class VehicleCardDto extends VehicleListItemDto {
  @ApiProperty({
    type: [VehicleStepDto],
    description: 'Все 13 шагов по порядку',
  })
  steps: VehicleStepDto[];
}
