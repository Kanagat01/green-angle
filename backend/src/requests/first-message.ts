/** Сумма в рублях с пробелами между разрядами: 1600000 → «1 600 000 ₽», копейки — только если они есть. */
export function formatRubles(amount: number): string {
  const [whole, fraction] = amount.toFixed(2).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${grouped}${fraction === '00' ? '' : `,${fraction}`} ₽`;
}

/**
 * Текст первого сообщения диалога, которое создаётся вместе с заявкой:
 * «Новая заявка: Haval Jolion, 2023. Бюджет 1 600 000 ₽.» и комментарий с новой строки.
 */
export function firstMessageText(request: {
  title: string;
  yearFrom?: number | null;
  budget?: number | null;
  comment?: string | null;
}): string {
  let text = `Новая заявка: ${request.title}${
    request.yearFrom ? `, ${request.yearFrom}` : ''
  }.`;
  if (request.budget !== undefined && request.budget !== null) {
    text += ` Бюджет ${formatRubles(request.budget)}.`;
  }
  const comment = request.comment?.trim();
  if (comment) text += `\n${comment}`;
  return text;
}
