import {
  Controller,
  Get,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../auth/decorators/public.decorator.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';

type CheckState = 'up' | 'down';

@ApiTags('health')
@Public()
@SkipThrottle()
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /** Живость процесса: не обращается к зависимостям. */
  @Get()
  @ApiOkResponse({ schema: { example: { status: 'ok' } } })
  check() {
    return { status: 'ok' };
  }

  /** Готовность принимать трафик: база данных и S3 доступны. Для проверок оркестратора. */
  @Get('ready')
  @ApiOkResponse({
    schema: {
      example: { status: 'ok', checks: { database: 'up', storage: 'up' } },
    },
  })
  @ApiServiceUnavailableResponse({
    description: 'Одна из зависимостей недоступна',
  })
  async ready() {
    const [database, storage] = await Promise.all([
      this.probe('database', async () => {
        await this.prisma.$queryRaw`SELECT 1`;
      }),
      this.probe('storage', () => this.storage.ping()),
    ]);
    const checks = { database, storage };
    if (database === 'down' || storage === 'down') {
      // Подробности ошибок — только в лог, наружу только up/down
      throw new ServiceUnavailableException({ status: 'unavailable', checks });
    }
    return { status: 'ok', checks };
  }

  private async probe(
    name: string,
    fn: () => Promise<unknown>,
  ): Promise<CheckState> {
    try {
      await fn();
      return 'up';
    } catch (err) {
      this.logger.warn(
        `Readiness check "${name}" failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return 'down';
    }
  }
}
