import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

/** Бинарники ffmpeg/ffprobe из devDependencies: тестам не нужны системные установки. */
export const ffmpegPath = (): string =>
  (require('@ffmpeg-installer/ffmpeg') as { path: string }).path;
export const ffprobePath = (): string =>
  (require('@ffprobe-installer/ffprobe') as { path: string }).path;

/**
 * Реальные записи, как их присылают браузеры:
 * - webm: MediaRecorder в Chrome/Firefox пишет в поток — длительности в заголовке нет;
 * - mp4-fragmented: MediaRecorder в Safari (iOS);
 * - mp4: обычный файл, moov в конце.
 */
export type AudioFormat =
  | 'webm'
  | 'webm-with-duration'
  | 'ogg'
  | 'mp4'
  | 'mp4-fragmented'
  | 'mp3'
  | 'wav';

export const MIME_OF: Record<AudioFormat, string> = {
  webm: 'audio/webm',
  'webm-with-duration': 'audio/webm',
  ogg: 'audio/ogg',
  mp4: 'audio/mp4',
  'mp4-fragmented': 'audio/mp4',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
};

const cache = new Map<string, Buffer>();

/** WAV (8 кГц, 8 бит, моно) без внешних программ — быстро даже для 5-минутных записей. */
export function wavBuffer(seconds: number, sampleRate = 8000): Buffer {
  const samples = Math.round(seconds * sampleRate);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + samples, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // размер блока fmt
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // моно
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate, 28); // байт в секунду
  header.writeUInt16LE(1, 32); // байт на сэмпл
  header.writeUInt16LE(8, 34); // бит на сэмпл
  header.write('data', 36);
  header.writeUInt32LE(samples, 40);
  const data = Buffer.alloc(samples);
  for (let i = 0; i < samples; i++) {
    data[i] =
      128 + Math.round(60 * Math.sin((2 * Math.PI * 440 * i) / sampleRate));
  }
  return Buffer.concat([header, data]);
}

/** Тон заданной длительности в нужном формате (кэшируется). */
export async function audioFixture(
  format: AudioFormat,
  seconds: number,
): Promise<Buffer> {
  const cacheKey = `${format}:${seconds}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const buffer =
    format === 'wav' ? wavBuffer(seconds) : await encode(format, seconds);
  cache.set(cacheKey, buffer);
  return buffer;
}

/** Фикстура под mime (формат по умолчанию для типа). */
export function audioFor(mime: string, seconds: number): Promise<Buffer> {
  const format = (Object.keys(MIME_OF) as AudioFormat[]).find(
    (f) => MIME_OF[f] === mime,
  );
  if (!format) throw new Error(`No fixture for ${mime}`);
  return audioFixture(format, seconds);
}

const source = (seconds: number) => [
  '-f',
  'lavfi',
  '-i',
  `sine=frequency=440:duration=${seconds}`,
  '-ac',
  '1',
];

async function encode(
  format: Exclude<AudioFormat, 'wav'>,
  seconds: number,
): Promise<Buffer> {
  const base = ['-hide_banner', '-loglevel', 'error', '-y', ...source(seconds)];
  const run = async (args: string[]) => {
    const { stdout } = await execFileAsync(ffmpegPath(), args, {
      encoding: 'buffer',
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
    });
    return stdout;
  };
  // Форматы, которым нужен перемотываемый вывод, пишем во временный файл
  const viaFile = async (extension: string, codecArgs: string[]) => {
    const dir = await mkdtemp(join(tmpdir(), 'fixture-'));
    try {
      const file = join(dir, `out.${extension}`);
      await run([...base, ...codecArgs, file]);
      return await readFile(file);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };

  switch (format) {
    case 'webm': // в поток: как MediaRecorder, длительности в заголовке нет
      return run([...base, '-c:a', 'libopus', '-f', 'webm', 'pipe:1']);
    case 'webm-with-duration':
      return viaFile('webm', ['-c:a', 'libopus']);
    case 'ogg':
      return viaFile('ogg', ['-c:a', 'libopus']);
    case 'mp4': // moov в конце файла
      return viaFile('mp4', ['-c:a', 'aac']);
    case 'mp4-fragmented': // как Safari: фрагментированный mp4 в поток
      return run([
        ...base,
        '-c:a',
        'aac',
        '-movflags',
        'frag_keyframe+empty_moov',
        '-f',
        'mp4',
        'pipe:1',
      ]);
    case 'mp3':
      return run([...base, '-c:a', 'libmp3lame', '-f', 'mp3', 'pipe:1']);
  }
}

/** mp4 с видеодорожкой и звуком — не является голосовой записью. */
export async function videoWithAudioMp4(seconds = 2): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'fixture-'));
  try {
    const file = join(dir, 'video.mp4');
    await execFileAsync(
      ffmpegPath(),
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-f',
        'lavfi',
        '-i',
        `color=c=black:s=64x64:d=${seconds}`,
        '-f',
        'lavfi',
        '-i',
        `sine=frequency=440:duration=${seconds}`,
        '-c:v',
        'mpeg4',
        '-c:a',
        'aac',
        '-shortest',
        file,
      ],
      { windowsHide: true },
    );
    return await readFile(file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
