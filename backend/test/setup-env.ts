import 'dotenv/config';

// Локально значения берутся из .env, в CI — из окружения. Тесты работают с реальной БД.
process.env.DATABASE_URL ??=
  'postgresql://green:green@localhost:5432/green_angle?schema=public';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-1234';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-1234';
process.env.S3_ENDPOINT ??= 'http://localhost:9000';
process.env.S3_BUCKET ??= 'test';
process.env.S3_ACCESS_KEY ??= 'k';
process.env.S3_SECRET_KEY ??= 's';

// Лимиты запросов не должны мешать тестам, которые массово логинятся с одного адреса.
// Тесты самих лимитов переопределяют значения через vi.hoisted.
const HIGH = '100000';
process.env.RATE_LIMIT_MAX = HIGH;
process.env.RATE_LIMIT_LOGIN_ACCOUNT_MAX = HIGH;
process.env.RATE_LIMIT_LOGIN_IP_MAX = HIGH;
// Тесты не зависят от CORS/прокси, заданных в локальном .env
process.env.CORS_ORIGINS = '';
process.env.TRUST_PROXY = 'false';
