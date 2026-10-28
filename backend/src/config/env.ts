import { z } from 'zod';

const positiveInt = (fallback: number) =>
  z.coerce.number().int().positive().default(fallback);

const boolFlag = z.enum(['true', 'false']).transform((v) => v === 'true');

/** В .env и docker-compose необязательные переменные часто остаются пустыми строками. */
const emptyToUndefined = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), schema);

/** Заглушки из .env.example / docker-compose — в production использовать их нельзя. */
const PLACEHOLDER_SECRET = /^change-me/i;
const DEFAULT_S3_SECRET = 'minio12345';

export const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: positiveInt(4000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
      .default('info'),
    /** За обратным прокси (Caddy/nginx) — брать IP клиента из X-Forwarded-For */
    TRUST_PROXY: boolFlag.default(false),
    /** Swagger на /api/docs; по умолчанию включён везде, кроме production */
    SWAGGER_ENABLED: boolFlag.optional(),

    DATABASE_URL: z.string().min(1),

    JWT_ACCESS_SECRET: z.string().min(16),
    JWT_REFRESH_SECRET: z.string().min(16),
    JWT_ACCESS_TTL_SEC: positiveInt(15 * 60),
    JWT_REFRESH_TTL_SEC: positiveInt(30 * 24 * 60 * 60),

    /** Где лежат файлы: на диске сервера или в S3-совместимом хранилище. Интерфейс API один и тот же. */
    STORAGE_DRIVER: z.enum(['disk', 's3']).default('disk'),
    /** Время жизни ссылок на загрузку и скачивание (для обоих драйверов) */
    UPLOAD_URL_TTL_SEC: positiveInt(15 * 60),
    DOWNLOAD_URL_TTL_SEC: positiveInt(60 * 60),

    // --- драйвер disk ---
    /** Каталог с файлами (в Docker — том, его нужно бэкапить вместе с БД) */
    UPLOAD_DIR: z.string().min(1).default('./data/uploads'),
    /** Секрет подписи ссылок загрузки/скачивания; обязателен для драйвера disk */
    FILES_SIGNING_SECRET: emptyToUndefined(z.string().min(16).optional()),
    /**
     * Адрес API, который видит браузер (например https://api.example.com/api/v1), для ссылок
     * загрузки/скачивания. Пусто — ссылки относительные («/api/v1/files/...»).
     */
    FILES_PUBLIC_URL: emptyToUndefined(z.string().url().optional()),

    // --- драйвер s3 ---
    S3_ENDPOINT: emptyToUndefined(z.string().url().optional()),
    S3_REGION: z.string().min(1).default('us-east-1'),
    S3_BUCKET: emptyToUndefined(z.string().min(1).optional()),
    S3_ACCESS_KEY: emptyToUndefined(z.string().min(1).optional()),
    S3_SECRET_KEY: emptyToUndefined(z.string().min(1).optional()),
    // Адрес, который видит браузер (в presigned URL). По умолчанию равен S3_ENDPOINT
    S3_PUBLIC_ENDPOINT: emptyToUndefined(z.string().url().optional()),

    /**
     * Redis для общих счётчиков rate limit между экземплярами API. Без него счётчики
     * хранятся в памяти процесса (годится для одного экземпляра и разработки).
     * Пустая строка равна «не задано».
     */
    REDIS_URL: emptyToUndefined(
      z
        .string()
        .url()
        .refine(
          (u) => /^rediss?:\/\//.test(u),
          'must start with redis:// or rediss://',
        )
        .optional(),
    ),

    /**
     * Путь к ffprobe: если задан, длительность голосовых проверяется по самому файлу.
     * Пустая строка равна «не задано».
     */
    FFPROBE_PATH: emptyToUndefined(z.string().min(1).optional()),

    /**
     * Исходящая почта (подтверждение email, уведомления). Без SMTP_HOST письма не отправляются:
     * они пишутся в лог — удобно для разработки и тестов. В production SMTP обязателен.
     */
    SMTP_HOST: emptyToUndefined(z.string().min(1).optional()),
    SMTP_PORT: positiveInt(587),
    /** true — сразу TLS (обычно порт 465); по умолчанию включается для порта 465 */
    SMTP_SECURE: emptyToUndefined(boolFlag.optional()),
    SMTP_USER: emptyToUndefined(z.string().min(1).optional()),
    SMTP_PASS: emptyToUndefined(z.string().min(1).optional()),
    /** Адрес и имя отправителя, например `Green Angle <noreply@example.com>` */
    MAIL_FROM: z.string().min(3).default('Green Angle <noreply@localhost>'),
    /** Адрес фронтенда: ссылки в письмах и push-уведомлениях. В production обязателен */
    APP_URL: emptyToUndefined(
      z
        .string()
        .url()
        .transform((u) => u.replace(/\/+$/, ''))
        .optional(),
    ),
    /** Срок действия ссылки подтверждения email, часы */
    EMAIL_VERIFICATION_TTL_HOURS: positiveInt(24),
    /**
     * Требовать подтверждение почты после регистрации. Выключено: аккаунт сразу открыт для входа,
     * письмо не отправляется (нужно, пока на сервере нет рабочей почты).
     */
    EMAIL_VERIFICATION_REQUIRED: boolFlag.default(false),

    /**
     * Push-уведомления (Web Push) о сообщениях в диалоге. Ключи VAPID: `pnpm exec web-push
     * generate-vapid-keys`. Без ключей push выключен (уведомления только пишутся в лог);
     * в production обязателен.
     */
    VAPID_PUBLIC_KEY: emptyToUndefined(z.string().min(20).optional()),
    VAPID_PRIVATE_KEY: emptyToUndefined(z.string().min(20).optional()),
    /** `mailto:адрес` или https-адрес сайта: куда пушевые сервисы пишут о проблемах */
    VAPID_SUBJECT: emptyToUndefined(
      z
        .string()
        .refine(
          (s) => /^mailto:.+@.+/.test(s) || /^https:\/\//.test(s),
          'must be mailto:address or an https URL',
        )
        .optional(),
    ),
    /**
     * Через сколько минут сообщение клиента, оставшееся без ответа, повторно уходит всем
     * сотрудникам (если у заявки уже есть ответственный).
     */
    PUSH_FALLBACK_MINUTES: positiveInt(60),

    /** Разрешённые Origin для CORS и Socket.IO через запятую; пусто — кросс-доменные запросы запрещены */
    CORS_ORIGINS: z
      .string()
      .default('')
      .transform((v) =>
        v
          .split(',')
          .map((o) => o.trim())
          .filter(Boolean),
      )
      .pipe(
        z.array(
          z.string().refine((o) => {
            try {
              return new URL(o).origin === o;
            } catch {
              return false;
            }
          }, 'must be an origin like https://app.example.com (no path or trailing slash)'),
        ),
      ),

    /** Общий лимит запросов на IP за окно */
    RATE_LIMIT_WINDOW_SEC: positiveInt(60),
    RATE_LIMIT_MAX: positiveInt(600),
    /** Вход: попыток на связку IP + email и на один IP за окно */
    RATE_LIMIT_LOGIN_WINDOW_SEC: positiveInt(60),
    RATE_LIMIT_LOGIN_ACCOUNT_MAX: positiveInt(5),
    RATE_LIMIT_LOGIN_IP_MAX: positiveInt(30),
    /** Публичная проверка этапа по VIN: запросов с одного IP за общее окно */
    RATE_LIMIT_VIN_CHECK_MAX: positiveInt(10),
  })
  .superRefine((env, ctx) => {
    if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_REFRESH_SECRET'],
        message: 'must differ from JWT_ACCESS_SECRET',
      });
    }
    if (env.STORAGE_DRIVER === 's3') {
      for (const key of [
        'S3_ENDPOINT',
        'S3_BUCKET',
        'S3_ACCESS_KEY',
        'S3_SECRET_KEY',
      ] as const) {
        if (!env[key]) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: 'is required when STORAGE_DRIVER=s3',
          });
        }
      }
    } else if (!env.FILES_SIGNING_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['FILES_SIGNING_SECRET'],
        message: 'is required when STORAGE_DRIVER=disk',
      });
    }
    if (env.NODE_ENV !== 'production') return;

    for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const) {
      if (PLACEHOLDER_SECRET.test(env[key])) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: 'placeholder value is not allowed in production',
        });
      }
    }
    // Без них функции молча отключатся, а ошибка вскроется только под нагрузкой или при споре
    if (!env.REDIS_URL) {
      ctx.addIssue({
        code: 'custom',
        path: ['REDIS_URL'],
        message: 'is required in production (shared rate limit counters)',
      });
    }
    if (!env.SMTP_HOST) {
      ctx.addIssue({
        code: 'custom',
        path: ['SMTP_HOST'],
        message:
          'is required in production (verification and notification emails)',
      });
    }
    if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) {
      ctx.addIssue({
        code: 'custom',
        path: ['VAPID_PUBLIC_KEY'],
        message:
          'VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT are required in production (push notifications)',
      });
    }
    if (!env.APP_URL) {
      ctx.addIssue({
        code: 'custom',
        path: ['APP_URL'],
        message: 'is required in production (links in emails)',
      });
    }
    if (!env.FFPROBE_PATH) {
      ctx.addIssue({
        code: 'custom',
        path: ['FFPROBE_PATH'],
        message: 'is required in production (voice duration verification)',
      });
    }
    if (
      env.FILES_SIGNING_SECRET &&
      PLACEHOLDER_SECRET.test(env.FILES_SIGNING_SECRET)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['FILES_SIGNING_SECRET'],
        message: 'placeholder value is not allowed in production',
      });
    }
    if (
      env.STORAGE_DRIVER === 's3' &&
      env.S3_SECRET_KEY === DEFAULT_S3_SECRET
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['S3_SECRET_KEY'],
        message: 'default value is not allowed in production',
      });
    }
  })
  .superRefine((env, ctx) => {
    // Ключи без пары бесполезны и скрывают ошибку настройки
    const provided = [
      env.VAPID_PUBLIC_KEY,
      env.VAPID_PRIVATE_KEY,
      env.VAPID_SUBJECT,
    ].filter(Boolean).length;
    if (provided > 0 && provided < 3 && env.NODE_ENV !== 'production') {
      ctx.addIssue({
        code: 'custom',
        path: ['VAPID_PUBLIC_KEY'],
        message:
          'set all of VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT, or none',
      });
    }
  })
  .transform((env) => ({
    ...env,
    SWAGGER_ENABLED: env.SWAGGER_ENABLED ?? env.NODE_ENV !== 'production',
  }));

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    const details = result.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid environment: ${details}`);
  }
  return result.data;
}
