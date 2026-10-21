import 'dotenv/config';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Локально значения берутся из .env, в CI — из окружения. Тесты работают с реальной БД.
process.env.DATABASE_URL ??=
  'postgresql://green:green@localhost:5432/green_angle?schema=public';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-1234';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-1234';
// Файлы по умолчанию лежат на диске во временном каталоге. Драйвер S3 проверяется отдельным
// запуском: STORAGE_DRIVER=s3 pnpm test:e2e (нужен MinIO из docker compose).
process.env.STORAGE_DRIVER ??= 'disk';
process.env.UPLOAD_DIR = join(
  tmpdir(),
  `green-angle-test-uploads-${process.pid}`,
);
process.env.FILES_SIGNING_SECRET = 'test-files-signing-secret-1234';
// Ссылки на файлы относительные: тесты ходят по ним через app.inject без открытого порта
process.env.FILES_PUBLIC_URL = '';
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
// По умолчанию лимиты считаются в памяти; Redis подключают только его собственные тесты
process.env.REDIS_URL = '';
// Длительность голосовых проверяется настоящим ffprobe из devDependencies (системный не нужен)
process.env.FFPROBE_PATH = (
  createRequire(import.meta.url)('@ffprobe-installer/ffprobe') as {
    path: string;
  }
).path;
// Тесты не зависят от CORS/прокси, заданных в локальном .env
process.env.CORS_ORIGINS = '';
process.env.TRUST_PROXY = 'false';
