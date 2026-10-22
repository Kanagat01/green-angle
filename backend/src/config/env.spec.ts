import { validateEnv } from './env.js';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  JWT_ACCESS_SECRET: 'access-secret-aaaaaaaaaaaa',
  JWT_REFRESH_SECRET: 'refresh-secret-bbbbbbbbbbb',
  FILES_SIGNING_SECRET: 'files-secret-cccccccccccc',
};

/** Почта и push, обязательные в production */
const mail = {
  SMTP_HOST: 'smtp.example.com',
  APP_URL: 'https://app.example.com',
};

const vapid = {
  VAPID_PUBLIC_KEY: 'public-key-public-key-public-key',
  VAPID_PRIVATE_KEY: 'private-key-private-key-private-key',
  VAPID_SUBJECT: 'mailto:ops@example.com',
};

const s3 = {
  STORAGE_DRIVER: 's3',
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
      CORS_ORIGINS: [],
      RATE_LIMIT_LOGIN_ACCOUNT_MAX: 5,
      RATE_LIMIT_LOGIN_IP_MAX: 30,
      STORAGE_DRIVER: 'disk',
      UPLOAD_DIR: './data/uploads',
    });
  });

  describe('file storage', () => {
    it('stores files on disk by default and then needs a signing secret', () => {
      expect(() =>
        validateEnv({ ...base, FILES_SIGNING_SECRET: undefined }),
      ).toThrow(/FILES_SIGNING_SECRET/);
      expect(() =>
        validateEnv({ ...base, FILES_SIGNING_SECRET: 'short' }),
      ).toThrow(/FILES_SIGNING_SECRET/);
    });

    it('does not need S3 settings for the disk driver', () => {
      expect(() => validateEnv({ ...base, S3_ENDPOINT: '' })).not.toThrow();
    });

    it('needs the S3 settings, but not the signing secret, for the s3 driver', () => {
      const rest = { ...base, FILES_SIGNING_SECRET: undefined };
      expect(() => validateEnv({ ...rest, ...s3 })).not.toThrow();
      expect(() => validateEnv({ ...rest, ...s3, S3_BUCKET: '' })).toThrow(
        /S3_BUCKET/,
      );
      expect(() => validateEnv({ ...rest, STORAGE_DRIVER: 's3' })).toThrow(
        /S3_ENDPOINT/,
      );
    });

    it('rejects an unknown driver and a malformed public URL', () => {
      expect(() => validateEnv({ ...base, STORAGE_DRIVER: 'ftp' })).toThrow(
        /STORAGE_DRIVER/,
      );
      expect(() => validateEnv({ ...base, FILES_PUBLIC_URL: 'api' })).toThrow(
        /FILES_PUBLIC_URL/,
      );
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
      ...mail,
      ...vapid,
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

  describe('mail', () => {
    it('has working defaults outside production and treats blanks as not set', () => {
      const env = validateEnv({
        ...base,
        SMTP_HOST: '',
        SMTP_USER: '',
        SMTP_SECURE: '',
      });
      expect(env).toMatchObject({
        SMTP_PORT: 587,
        MAIL_FROM: 'Green Angle <noreply@localhost>',
        EMAIL_VERIFICATION_TTL_HOURS: 24,
      });
      expect(env.SMTP_HOST).toBeUndefined();
      expect(env.SMTP_SECURE).toBeUndefined();
      expect(env.APP_URL).toBeUndefined();
    });

    it('reads the SMTP settings and removes the trailing slash of APP_URL', () => {
      const env = validateEnv({
        ...base,
        SMTP_HOST: 'smtp.gmail.com',
        SMTP_PORT: '465',
        SMTP_SECURE: 'true',
        SMTP_USER: 'user@gmail.com',
        SMTP_PASS: 'app password',
        APP_URL: 'https://app.example.com/',
      });
      expect(env).toMatchObject({
        SMTP_HOST: 'smtp.gmail.com',
        SMTP_PORT: 465,
        SMTP_SECURE: true,
        SMTP_USER: 'user@gmail.com',
        SMTP_PASS: 'app password',
        APP_URL: 'https://app.example.com',
      });
    });

    it('rejects a malformed APP_URL, port or secure flag', () => {
      expect(() =>
        validateEnv({ ...base, APP_URL: 'app.example.com' }),
      ).toThrow(/APP_URL/);
      expect(() => validateEnv({ ...base, SMTP_PORT: '0' })).toThrow(
        /SMTP_PORT/,
      );
      expect(() => validateEnv({ ...base, SMTP_SECURE: 'yes' })).toThrow(
        /SMTP_SECURE/,
      );
    });
  });

  describe('push', () => {
    it('is off by default and falls back after an hour', () => {
      const env = validateEnv({ ...base, VAPID_PUBLIC_KEY: '' });
      expect(env.VAPID_PUBLIC_KEY).toBeUndefined();
      expect(env.PUSH_FALLBACK_MINUTES).toBe(60);
    });

    it('reads the VAPID keys and the fallback delay', () => {
      const env = validateEnv({
        ...base,
        ...vapid,
        PUSH_FALLBACK_MINUTES: '15',
      });
      expect(env).toMatchObject({ ...vapid, PUSH_FALLBACK_MINUTES: 15 });
      expect(
        validateEnv({ ...base, ...vapid, VAPID_SUBJECT: 'https://example.com' })
          .VAPID_SUBJECT,
      ).toBe('https://example.com');
    });

    it('rejects a partial set of keys', () => {
      expect(() =>
        validateEnv({ ...base, VAPID_PUBLIC_KEY: vapid.VAPID_PUBLIC_KEY }),
      ).toThrow(/all of VAPID_PUBLIC_KEY/);
      expect(() =>
        validateEnv({ ...base, ...vapid, VAPID_PRIVATE_KEY: '' }),
      ).toThrow(/all of VAPID_PUBLIC_KEY/);
    });

    it('rejects a subject that is neither mailto: nor https', () => {
      expect(() =>
        validateEnv({ ...base, ...vapid, VAPID_SUBJECT: 'ops@example.com' }),
      ).toThrow(/VAPID_SUBJECT/);
      expect(() =>
        validateEnv({ ...base, ...vapid, PUSH_FALLBACK_MINUTES: '0' }),
      ).toThrow(/PUSH_FALLBACK_MINUTES/);
    });
  });

  describe('in production', () => {
    const prod = {
      ...base,
      ...mail,
      ...vapid,
      NODE_ENV: 'production',
      REDIS_URL: 'redis://redis:6379',
      FFPROBE_PATH: 'ffprobe',
    };

    it('requires all three VAPID settings (push notifications)', () => {
      for (const key of Object.keys(vapid)) {
        expect(() => validateEnv({ ...prod, [key]: undefined })).toThrow(
          /VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT are required/,
        );
      }
    });

    it('requires SMTP_HOST and APP_URL (verification emails and their links)', () => {
      expect(() => validateEnv({ ...prod, SMTP_HOST: undefined })).toThrow(
        /SMTP_HOST/,
      );
      expect(() => validateEnv({ ...prod, SMTP_HOST: '' })).toThrow(
        /SMTP_HOST/,
      );
      expect(() => validateEnv({ ...prod, APP_URL: undefined })).toThrow(
        /APP_URL/,
      );
      expect(() => validateEnv({ ...prod, APP_URL: '' })).toThrow(/APP_URL/);
    });

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

    it('rejects a placeholder file signing secret', () => {
      expect(() =>
        validateEnv({
          ...prod,
          FILES_SIGNING_SECRET: 'change-me-files-secret',
        }),
      ).toThrow(/FILES_SIGNING_SECRET/);
    });

    it('rejects the default S3 secret for the s3 driver', () => {
      expect(() =>
        validateEnv({ ...prod, ...s3, S3_SECRET_KEY: 'minio12345' }),
      ).toThrow(/S3_SECRET_KEY/);
      expect(() => validateEnv({ ...prod, ...s3 })).not.toThrow();
    });

    it('still allows placeholders in development and test', () => {
      for (const NODE_ENV of ['development', 'test']) {
        expect(() =>
          validateEnv({
            ...base,
            NODE_ENV,
            JWT_ACCESS_SECRET: 'change-me-access-secret-min-16',
            JWT_REFRESH_SECRET: 'change-me-refresh-secret-min-16',
            FILES_SIGNING_SECRET: 'change-me-files-secret-min-16',
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
