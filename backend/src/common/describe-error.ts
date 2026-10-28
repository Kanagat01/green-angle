import { inspect } from 'node:util';

/**
 * Текст ошибки для лога вместе с причинами и кодом. Суть сбоя БД лежит не в самом сообщении
 * (у Prisma это только заголовок вызова, иногда пустой): код (`ECONNREFUSED`, `P2002`) — в `code`,
 * вложенная ошибка — в `cause`.
 */
export function describeError(err: unknown): string {
  const parts: string[] = [];
  let current: unknown = err;
  for (
    let depth = 0;
    current !== undefined && current !== null && depth < 4;
    depth++
  ) {
    const text =
      current instanceof Error
        ? current.message
        : typeof current === 'string'
          ? current
          : inspect(current, { depth: 1, breakLength: Infinity });
    const { code, cause } = current as { code?: unknown; cause?: unknown };
    // Пустые строки и повторы не добавляем: так лог остаётся одной читаемой строкой
    const message = text.replace(/\s+/g, ' ').trim();
    const withCode =
      typeof code === 'string' || typeof code === 'number'
        ? [message, `[${code}]`].filter(Boolean).join(' ')
        : message;
    if (withCode && !parts.includes(withCode)) parts.push(withCode);
    current = cause;
  }
  return parts.join(' ← ') || 'unknown error';
}
