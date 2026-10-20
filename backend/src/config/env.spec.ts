import { validateEnv } from './env.js';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  JWT_ACCESS_SECRET: 'access-secret-aaaaaaaaaaaa',
  JWT_REFRESH_SECRET: 'refresh-secret-bbbbbbbbbbb',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_BUCKET: 'bucket',
  S3_ACCESS_KEY: 'key',
  S3_SECRET_KEY: 'a-real-secret-value',
};

describe('validateEnv', () => {
  it('applies defaults', () => {
    const env = validateEnv(base);
    expect(env).toMatchObject({
      NODE_ENV: 'development',
      PORT: 3000,
      LOG_LEVEL: 'info',
      TRUST_PROXY: false,
      STRICT_ATTACHMENTS: false,
      CORS_ORIGINS: [],
      RATE_LIMIT_LOGIN_ACCOUNT_MAX: 5,
      RATE_LIMIT_LOGIN_IP_MAX: 30,
    });
  });

  it('treats empty REDIS_URL / FFPROBE_PATH as not set outside production', () => {
    const env = validateEnv({ ...base, REDIS_URL: '', FFPROBE_PATH: '' });
    expect(env.REDIS_URL).toBeUndefined();
    expect(env.FFPROBE_PATH).toBeUndefined();
  });

  it('accepts a Redis URL and an ffprobe path', () => {
    const env = validateEnv({
      ...base,
      REDIS_URL: 'redis://localhost:6379',
      FFPROBE_PATH: '/usr/bin/ffprobe',
    });
    expect(env.REDIS_URL).toBe('redis://localhost:6379');
    expect(env.FFPROBE_PATH).toBe('/usr/bin/ffprobe');
  });

  it('rejects a malformed REDIS_URL', () => {
    expect(() => validateEnv({ ...base, REDIS_URL: 'localhost:6379' })).toThrow(
      /REDIS_URL/,
    );
  });

  it('enables Swagger outside production and disables it in production by default', () => {
    const prod = {
      ...base,
      NODE_ENV: 'production',
      REDIS_URL: 'redis://redis:6379',
      FFPROBE_PATH: 'ffprobe',
    };
    expect(validateEnv(base).SWAGGER_ENABLED).toBe(true);
    expect(validateEnv(prod).SWAGGER_ENABLED).toBe(false);
    expect(
      validateEnv({ ...prod, SWAGGER_ENABLED: 'true' }).SWAGGER_ENABLED,
    ).toBe(true);
  });

  it('parses a comma-separated CORS_ORIGINS list', () => {
    const env = validateEnv({
      ...base,
      CORS_ORIGINS: ' https://app.example.com, http://localhost:3001 ,',
    });
    expect(env.CORS_ORIGINS).toEqual([
      'https://app.example.com',
      'http://localhost:3001',
    ]);
  });

  it.each([
    '*',
    'https://app.example.com/',
    'https://app.example.com/path',
    'app.example.com',
  ])('rejects an invalid CORS origin "%s"', (origin) => {
    expect(() => validateEnv({ ...base, CORS_ORIGINS: origin })).toThrow(
      /CORS_ORIGINS/,
    );
  });

  it('rejects identical access and refresh secrets in any environment', () => {
    expect(() =>
      validateEnv({ ...base, JWT_REFRESH_SECRET: base.JWT_ACCESS_SECRET }),
    ).toThrow(/must differ/);
  });

  describe('in production', () => {
    const prod = {
      ...base,
      NODE_ENV: 'production',
      REDIS_URL: 'redis://redis:6379',
      FFPROBE_PATH: 'ffprobe',
    };

    it('requires REDIS_URL (shared rate limit counters)', () => {
      expect(() => validateEnv({ ...prod, REDIS_URL: undefined })).toThrow(
        /REDIS_URL/,
      );
      expect(() => validateEnv({ ...prod, REDIS_URL: '' })).toThrow(
        /REDIS_URL/,
      );
    });

    it('requires FFPROBE_PATH (voice duration verification)', () => {
      expect(() => validateEnv({ ...prod, FFPROBE_PATH: undefined })).toThrow(
        /FFPROBE_PATH/,
      );
      expect(() => validateEnv({ ...prod, FFPROBE_PATH: '' })).toThrow(
        /FFPROBE_PATH/,
      );
    });

    it('accepts real secrets', () => {
      expect(() => validateEnv(prod)).not.toThrow();
    });

    it.each(['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'])(
      'rejects a placeholder %s',
      (key) => {
        expect(() =>
          validateEnv({ ...prod, [key]: 'change-me-secret-min-16-xx' }),
        ).toThrow(/placeholder/);
      },
    );

    it('rejects the default S3 secret', () => {
      expect(() =>
        validateEnv({ ...prod, S3_SECRET_KEY: 'minio12345' }),
      ).toThrow(/S3_SECRET_KEY/);
    });

    it('still allows placeholders in development and test', () => {
      for (const NODE_ENV of ['development', 'test']) {
        expect(() =>
          validateEnv({
            ...base,
            NODE_ENV,
            JWT_ACCESS_SECRET: 'change-me-access-secret-min-16',
            JWT_REFRESH_SECRET: 'change-me-refresh-secret-min-16',
            S3_SECRET_KEY: 'minio12345',
          }),
        ).not.toThrow();
      }
    });
  });

  it('rejects out-of-range numbers and unknown flags', () => {
    expect(() => validateEnv({ ...base, PORT: '0' })).toThrow(/PORT/);
    expect(() => validateEnv({ ...base, RATE_LIMIT_MAX: '-1' })).toThrow(
      /RATE_LIMIT_MAX/,
    );
    expect(() => validateEnv({ ...base, TRUST_PROXY: 'yes' })).toThrow(
      /TRUST_PROXY/,
    );
    expect(() => validateEnv({ ...base, LOG_LEVEL: 'verbose' })).toThrow(
      /LOG_LEVEL/,
    );
  });
});
