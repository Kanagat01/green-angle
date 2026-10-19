import { z } from 'zod';

const positiveInt = (fallback: number) =>
  z.coerce.number().int().positive().default(fallback);

const boolFlag = z.enum(['true', 'false']).transform((v) => v === 'true');

/** Заглушки из .env.example / docker-compose — в production использовать их нельзя. */
const PLACEHOLDER_SECRET = /^change-me/i;
const DEFAULT_S3_SECRET = 'minio12345';

export const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: positiveInt(3000),
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

    S3_ENDPOINT: z.string().url(),
    S3_REGION: z.string().min(1).default('us-east-1'),
    S3_BUCKET: z.string().min(1),
    S3_ACCESS_KEY: z.string().min(1),
    S3_SECRET_KEY: z.string().min(1),
    // Адрес, который видит браузер (в presigned URL). По умолчанию равен S3_ENDPOINT
    S3_PUBLIC_ENDPOINT: z.string().url().optional(),
    S3_PRESIGN_PUT_TTL_SEC: positiveInt(15 * 60),
    S3_PRESIGN_GET_TTL_SEC: positiveInt(60 * 60),

    STRICT_ATTACHMENTS: boolFlag.default(false),

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
  })
  .superRefine((env, ctx) => {
    if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_REFRESH_SECRET'],
        message: 'must differ from JWT_ACCESS_SECRET',
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
    if (env.S3_SECRET_KEY === DEFAULT_S3_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['S3_SECRET_KEY'],
        message: 'default value is not allowed in production',
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
