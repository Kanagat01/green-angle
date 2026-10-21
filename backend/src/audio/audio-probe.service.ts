import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { StorageService } from '../storage/storage.service.js';

const execFileAsync = promisify(execFile);

const PROBE_TIMEOUT_MS = 15_000;
const MAX_CONCURRENT_PROBES = 4;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

/**
 * Демуксер ffprobe задаётся принудительно по заявленному mime. Без этого ffprobe определяет
 * формат по содержимому и «послушно» разбирает плейлисты (HLS/concat), которые ссылаются на
 * другие файлы и URL, — это чтение файлов сервера и запросы в сеть от лица API.
 */
const DEMUXER_BY_MIME: Record<string, string> = {
  'audio/webm': 'matroska',
  'audio/ogg': 'ogg',
  'audio/mp4': 'mov',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
};

export type AudioProbeFailure = 'INVALID_AUDIO' | 'UNAVAILABLE';

export class AudioProbeError extends Error {
  constructor(
    readonly reason: AudioProbeFailure,
    message: string,
  ) {
    super(message);
  }
}

interface ProbeJson {
  streams?: { codec_type?: string; duration?: string }[];
  format?: { duration?: string };
}

/**
 * Измеряет реальную длительность аудио по самому файлу (ffprobe), а не по словам клиента.
 * Включается переменной FFPROBE_PATH; без неё длительность голосовых не проверяется.
 */
@Injectable()
export class AudioProbeService implements OnModuleInit {
  private readonly logger = new Logger(AudioProbeService.name);
  private readonly ffprobe: string | undefined;
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(
    config: ConfigService,
    private readonly storage: StorageService,
  ) {
    this.ffprobe = config.get<string | undefined>('FFPROBE_PATH');
  }

  get enabled(): boolean {
    return Boolean(this.ffprobe);
  }

  /** Неработающий ffprobe — ошибка конфигурации: лучше упасть на старте, чем молча не проверять. */
  async onModuleInit() {
    if (!this.ffprobe) {
      this.logger.warn(
        'FFPROBE_PATH is not set: the duration of voice messages is not verified',
      );
      return;
    }
    try {
      await execFileAsync(this.ffprobe, ['-version'], { timeout: 5000 });
    } catch (err) {
      throw new Error(
        `FFPROBE_PATH is set to "${this.ffprobe}", but ffprobe cannot be run: ${
          err instanceof Error ? err.message : String(err)
        }`,
        { cause: err },
      );
    }
  }

  /** Копирует объект из хранилища во временный файл и измеряет длительность (секунды, дробные). */
  async measureObject(key: string, mime: string): Promise<number> {
    const dir = await mkdtemp(join(tmpdir(), 'voice-'));
    try {
      const file = join(dir, 'audio');
      await this.storage.downloadToFile(key, file);
      return await this.measureFile(file, mime);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  async measureFile(file: string, mime: string): Promise<number> {
    const demuxer = DEMUXER_BY_MIME[mime];
    if (!this.ffprobe || !demuxer) {
      throw new AudioProbeError(
        'INVALID_AUDIO',
        `Unsupported audio type "${mime}"`,
      );
    }
    return this.limited(async () => {
      const base = [
        '-v',
        'error',
        '-hide_banner',
        // только локальный файл: никаких http/tcp/concat из содержимого
        '-protocol_whitelist',
        'file',
        '-f',
        demuxer,
      ];

      const info = JSON.parse(
        await this.run([
          ...base,
          '-print_format',
          'json',
          '-show_entries',
          'format=duration:stream=codec_type,duration',
          '-i',
          file,
        ]),
      ) as ProbeJson;

      const streams = info.streams ?? [];
      // голосовое — только звук: видео, обложки и прочие дорожки недопустимы
      if (
        streams.length === 0 ||
        streams.some((s) => s.codec_type !== 'audio')
      ) {
        throw new AudioProbeError(
          'INVALID_AUDIO',
          'File is not a pure audio recording',
        );
      }

      const fromHeaders = [
        info.format?.duration,
        ...streams.map((s) => s.duration),
      ]
        .map((v) => Number(v))
        .find((v) => Number.isFinite(v) && v > 0);
      if (fromHeaders !== undefined) return fromHeaders;

      // Записи MediaRecorder (webm из браузера) не содержат длительность в заголовке:
      // считаем по меткам пакетов (файл ≤ 10 МБ, это быстро)
      return this.durationFromPackets(base, file);
    });
  }

  private async durationFromPackets(
    base: string[],
    file: string,
  ): Promise<number> {
    const out = await this.run([
      ...base,
      '-select_streams',
      'a:0',
      '-show_entries',
      'packet=pts_time,duration_time',
      '-of',
      'csv=p=0',
      '-i',
      file,
    ]);
    let end = 0;
    for (const line of out.split('\n')) {
      const [pts, dur] = line.trim().split(',');
      const start = Number(pts);
      if (!Number.isFinite(start)) continue;
      const length = Number.isFinite(Number(dur)) ? Number(dur) : 0;
      end = Math.max(end, start + length);
    }
    if (end <= 0)
      throw new AudioProbeError(
        'INVALID_AUDIO',
        'Cannot determine audio duration',
      );
    return end;
  }

  private async run(args: string[]): Promise<string> {
    try {
      const { stdout } = await execFileAsync(this.ffprobe!, args, {
        timeout: PROBE_TIMEOUT_MS,
        killSignal: 'SIGKILL',
        maxBuffer: MAX_OUTPUT_BYTES,
        windowsHide: true,
      });
      return stdout;
    } catch (err) {
      const e = err as NodeJS.ErrnoException & {
        killed?: boolean;
        code?: string | number;
      };
      // Не удалось запустить сам ffprobe — проблема сервера, а не файла
      if (e.code === 'ENOENT' || e.code === 'EACCES') {
        throw new AudioProbeError('UNAVAILABLE', 'ffprobe cannot be executed');
      }
      throw new AudioProbeError(
        'INVALID_AUDIO',
        e.killed
          ? 'Audio analysis timed out'
          : 'File is not a valid audio recording',
      );
    }
  }

  /** Не больше MAX_CONCURRENT_PROBES одновременных запусков: ffprobe — отдельные процессы. */
  private async limited<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= MAX_CONCURRENT_PROBES) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    this.active++;
    try {
      return await task();
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }
}
