import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Readable } from 'node:stream';
import { Public } from '../auth/decorators/public.decorator.js';
import { DiskStorageService } from './disk-storage.service.js';
import { StorageService } from './storage.service.js';
import { normalizeMime } from './upload-rules.js';

type RawQuery = Record<string, unknown>;

/** Типы, которые браузер может показать прямо на странице; остальное отдаётся как вложение */
const INLINE_MIME = /^(image|video|audio)\/|^application\/pdf$/;

/**
 * Загрузка и скачивание файлов для драйвера `disk`. Маршруты открыты без JWT: доступ даёт
 * подписанная короткоживущая ссылка, которую выдаёт API (`/uploads/presign`, `attachments[].url`).
 * При драйвере S3 этих маршрутов нет (404): ссылки ведут прямо в S3.
 */
@ApiTags('files')
@Public()
@Controller('files')
export class FilesController {
  constructor(private readonly storage: StorageService) {}

  private get disk(): DiskStorageService {
    if (!(this.storage instanceof DiskStorageService)) {
      throw new NotFoundException();
    }
    return this.storage;
  }

  @Put('upload')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiExcludeEndpoint()
  async upload(@Query() query: RawQuery, @Req() req: FastifyRequest) {
    const disk = this.disk;
    const key = str(query.key);
    const type = str(query.type);
    const exp = int(query.exp);
    const size = int(query.size);
    disk.assertSignature('PUT', { key, exp, sig: str(query.sig), type, size });

    // Подписаны тип и размер: другой Content-Type или Content-Length — как в S3, отказ
    const contentType = normalizeMime(
      String(req.headers['content-type'] ?? ''),
    );
    const length = req.headers['content-length'];
    if (
      contentType !== type ||
      (length !== undefined && Number(length) !== size)
    ) {
      throw new ForbiddenException('Request differs from the signed one');
    }
    await disk.store(key, req.body as Readable, type, size);
  }

  @Get('download')
  @ApiExcludeEndpoint()
  async download(
    @Query() query: RawQuery,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const disk = this.disk;
    const key = str(query.key);
    disk.assertSignature('GET', {
      key,
      exp: int(query.exp),
      sig: str(query.sig),
    });

    const meta = await disk.head(key);
    if (!meta) throw new NotFoundException();

    const range = parseRange(req.headers.range, meta.size);
    if (range === 'invalid') {
      return reply
        .status(HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
        .header('Content-Range', `bytes */${meta.size}`)
        .send();
    }

    const opened = await disk.open(key, range ?? undefined);
    if (!opened) throw new NotFoundException();

    void reply
      .header('Content-Type', meta.contentType)
      .header('Accept-Ranges', 'bytes')
      .header(
        'Content-Disposition',
        INLINE_MIME.test(meta.contentType) ? 'inline' : 'attachment',
      )
      .header('Cache-Control', 'private, max-age=300')
      // Фронтенд на другом origin показывает файлы в <img>/<audio>/<video>
      .header('Cross-Origin-Resource-Policy', 'cross-origin');
    if (range) {
      void reply
        .status(HttpStatus.PARTIAL_CONTENT)
        .header(
          'Content-Range',
          `bytes ${range.start}-${range.end}/${meta.size}`,
        )
        .header('Content-Length', range.end - range.start + 1);
    } else {
      void reply.header('Content-Length', meta.size);
    }
    return reply.send(opened.stream);
  }
}

function str(value: unknown): string {
  if (typeof value !== 'string' || value === '') {
    throw new BadRequestException('Invalid link');
  }
  return value;
}

function int(value: unknown): number {
  const n = Number(str(value));
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new BadRequestException('Invalid link');
  }
  return n;
}

/** Один диапазон `bytes=a-b`, `bytes=a-`, `bytes=-n`; null — заголовка нет, 'invalid' — 416. */
function parseRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | 'invalid' | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === '' && match[2] === '')) return 'invalid';
  let start: number;
  let end: number;
  if (match[1] === '') {
    const suffix = Number(match[2]);
    if (suffix === 0) return 'invalid';
    start = Math.max(size - suffix, 0);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
  }
  return start >= size || start > end ? 'invalid' : { start, end };
}
