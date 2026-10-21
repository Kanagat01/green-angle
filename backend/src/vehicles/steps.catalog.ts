/** Справочник 13 статусов перегона (PLAN.md §4). Список один для всех ролей. */
export const TOTAL_STEPS = 13;
/** Шаг, на котором указывается номер декларации */
export const DECLARATION_STEP = 10;

export type ExpectedAttachment =
  'PHOTO' | 'VIDEO' | 'FILE' | 'DECLARATION_NUMBER';

export interface StepDefinition {
  step: number;
  title: string;
  /** Обязательное вложение: без него нельзя перейти на этот шаг вперёд (откат назад — можно) */
  expectedAttachment: ExpectedAttachment | null;
}

export const STEPS: readonly StepDefinition[] = [
  { step: 1, title: 'Ожидает оплату', expectedAttachment: null },
  { step: 2, title: 'Получена оплата', expectedAttachment: 'FILE' },
  {
    step: 3,
    title: 'Выкуплен, ожидает погрузки у продавца',
    expectedAttachment: 'PHOTO',
  },
  {
    step: 4,
    title: 'В транспортной компании в Китае',
    expectedAttachment: 'VIDEO',
  },
  { step: 5, title: 'В пути по Китаю', expectedAttachment: null },
  {
    step: 6,
    title: 'Прибыла в конечную точку, экспортные документы',
    expectedAttachment: 'PHOTO',
  },
  { step: 7, title: 'Отправка в Россию', expectedAttachment: 'PHOTO' },
  { step: 8, title: 'Прибыла на территорию РФ', expectedAttachment: 'FILE' },
  {
    step: 9,
    title: 'Прибыла на СВХ, ожидает тамож. оформление',
    expectedAttachment: 'PHOTO',
  },
  {
    step: 10,
    title: 'Декларация подана',
    expectedAttachment: 'DECLARATION_NUMBER',
  },
  { step: 11, title: 'Машина выпущена', expectedAttachment: null },
  { step: 12, title: 'Получение ЭПТС и СБКТС', expectedAttachment: 'PHOTO' },
  {
    step: 13,
    title: 'Готова к выдаче (СБКТС, ЭПТС)',
    expectedAttachment: 'PHOTO',
  },
];

/** Шаги новой машины: всё до стартового — завершено (для 13 — и он сам). */
export function initialSteps(currentStep: number, now: Date) {
  return Array.from({ length: TOTAL_STEPS }, (_, i) => {
    const step = i + 1;
    const completed =
      step < currentStep ||
      (step === TOTAL_STEPS && currentStep === TOTAL_STEPS);
    return { step, completedAt: completed ? now : null };
  });
}

export function stepTitle(step: number): string {
  return STEPS[step - 1].title;
}
