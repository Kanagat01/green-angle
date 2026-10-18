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
