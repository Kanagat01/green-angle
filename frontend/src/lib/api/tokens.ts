/** Пара токенов в localStorage: API работает по CORS без cookie. Без доступа к хранилищу сессия живёт до перезагрузки. */
const KEY = "ga-tokens";

export type Tokens = { accessToken: string; refreshToken: string };

let memory: Tokens | null = null;

export function readTokens(): Tokens | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return memory;
    const parsed = JSON.parse(raw) as Partial<Tokens>;
    if (typeof parsed.accessToken === "string" && typeof parsed.refreshToken === "string") {
      return { accessToken: parsed.accessToken, refreshToken: parsed.refreshToken };
    }
  } catch {
    // хранилище недоступно или повреждено — берём из памяти
  }
  return memory;
}

export function writeTokens(tokens: Tokens): void {
  memory = tokens;
  try {
    localStorage.setItem(KEY, JSON.stringify(tokens));
  } catch {
    // сессия останется только в памяти вкладки
  }
}

export function clearTokens(): void {
  memory = null;
  try {
    localStorage.removeItem(KEY);
  } catch {
    // нечего очищать
  }
}
