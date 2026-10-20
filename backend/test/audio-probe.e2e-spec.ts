import { ConfigService } from '@nestjs/config';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AudioProbeError,
  AudioProbeService,
} from '../src/audio/audio-probe.service.js';
import { StorageService } from '../src/storage/storage.service.js';
import {
  audioFixture,
  AudioFormat,
  MIME_OF,
  videoWithAudioMp4,
  wavBuffer,
} from './audio-fixtures.js';
import { createApp } from './helpers.js';

describe('AudioProbeService (real ffprobe)', () => {
  let app: NestFastifyApplication;
  let probe: AudioProbeService;
  let dir: string;
  let seq = 0;

  beforeAll(async () => {
    app = await createApp();
    probe = app.get(AudioProbeService);
    dir = await mkdtemp(join(tmpdir(), 'probe-test-'));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
    await app.close();
  });

  /** Кладёт содержимое в файл и измеряет под заявленным mime. */
  const measure = async (content: Buffer | string, mime: string) => {
    const file = join(dir, `f${++seq}`);
    await writeFile(file, content);
    return probe.measureFile(file, mime);
  };
  const expectInvalid = async (content: Buffer | string, mime: string) => {
    const error = await measure(content, mime).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(AudioProbeError);
    expect((error as AudioProbeError).reason).toBe('INVALID_AUDIO');
  };

  it('is enabled in tests (FFPROBE_PATH points to the bundled binary)', () => {
    expect(probe.enabled).toBe(true);
  });

  describe('measures the real duration of recordings in every supported format', () => {
    const formats: AudioFormat[] = [
      'webm',
      'webm-with-duration',
      'ogg',
      'mp4',
      'mp4-fragmented',
      'mp3',
      'wav',
    ];

    it.each(formats)('%s (3 s)', async (format) => {
      const audio = await audioFixture(format, 3);
      const seconds = await measure(audio, MIME_OF[format]);
      expect(seconds).toBeGreaterThan(2.6);
      expect(seconds).toBeLessThan(3.4);
    });

    it('browser webm without a duration in the header (MediaRecorder): counted by packets', async () => {
      const audio = await audioFixture('webm', 12);
      // убеждаемся, что в заголовке длительности действительно нет
      const seconds = await measure(audio, 'audio/webm');
      expect(seconds).toBeGreaterThan(11.6);
      expect(seconds).toBeLessThan(12.4);
    });

    it('a 5-minute and a slightly longer wav', async () => {
      expect(await measure(wavBuffer(300), 'audio/wav')).toBeCloseTo(300, 0);
      expect(await measure(wavBuffer(301), 'audio/wav')).toBeCloseTo(301, 0);
    });
  });

  describe('rejects files that are not pure audio recordings', () => {
    it.each(Object.values(MIME_OF).filter((m, i, all) => all.indexOf(m) === i))(
      'random bytes as %s',
      async (mime) => {
        await expectInvalid(randomBytes(4096), mime);
      },
    );

    it('an empty file', async () => {
      await expectInvalid(Buffer.alloc(0), 'audio/mpeg');
    });

    it('a text file posing as audio', async () => {
      await expectInvalid('just some text, not audio at all', 'audio/ogg');
    });

    it('audio whose real format differs from the declared mime', async () => {
      await expectInvalid(wavBuffer(2), 'audio/mpeg');
      await expectInvalid(await audioFixture('mp3', 2), 'audio/wav');
      await expectInvalid(await audioFixture('ogg', 2), 'audio/webm');
    });

    it('a video with a sound track', async () => {
      await expectInvalid(await videoWithAudioMp4(), 'audio/mp4');
    });

    it('an unsupported mime type', async () => {
      await expectInvalid(wavBuffer(1), 'application/octet-stream');
    });
  });

  describe('cannot be used to make the server read files or call URLs', () => {
    let server: Server;
    let hits: string[];
    let origin: string;

    beforeAll(async () => {
      hits = [];
      server = createServer((req, res) => {
        hits.push(req.url ?? '');
        res.writeHead(200).end('x');
      });
      await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve),
      );
      origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    afterAll(
      () => new Promise<void>((resolve) => server.close(() => resolve())),
    );

    it.each(Object.values(MIME_OF).filter((m, i, all) => all.indexOf(m) === i))(
      'an HLS playlist pointing at an internal URL, sent as %s',
      async (mime) => {
        const playlist = `#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXTINF:10,\n${origin}/internal-secret.ts\n#EXT-X-ENDLIST\n`;
        await expectInvalid(playlist, mime);
        expect(hits).toEqual([]);
      },
    );

    it('a concat script referencing local files and URLs', async () => {
      const script = `ffconcat version 1.0\nfile '${origin}/a.wav'\nfile '/etc/passwd'\nfile 'C:/Windows/win.ini'\n`;
      for (const mime of [
        'audio/wav',
        'audio/mpeg',
        'audio/ogg',
        'audio/mp4',
        'audio/webm',
      ]) {
        await expectInvalid(script, mime);
      }
      expect(hits).toEqual([]);
    });
  });

  it('handles many parallel measurements (bounded concurrency)', async () => {
    const audio = await audioFixture('wav', 2);
    const results = await Promise.all(
      Array.from({ length: 14 }, () => measure(audio, 'audio/wav')),
    );
    expect(results.every((s) => Math.abs(s - 2) < 0.2)).toBe(true);
  });

  it('does not leave temporary files behind when measuring an S3 object', async () => {
    const storage = app.get(StorageService);
    const spy = vi
      .spyOn(storage, 'downloadToFile')
      .mockImplementation(async (_key, path) => {
        await writeFile(path, wavBuffer(1));
      });
    let usedPath = '';
    spy.mockImplementationOnce(async (_key, path) => {
      usedPath = path;
      await writeFile(path, wavBuffer(1));
    });

    expect(await probe.measureObject('any/key.wav', 'audio/wav')).toBeCloseTo(
      1,
      0,
    );
    const { access } = await import('node:fs/promises');
    await expect(access(usedPath)).rejects.toThrow();
    await expect(access(join(usedPath, '..'))).rejects.toThrow();

    // и при ошибке тоже
    spy.mockImplementationOnce(async (_key, path) => {
      usedPath = path;
      await writeFile(path, 'garbage');
    });
    await expect(
      probe.measureObject('any/key.wav', 'audio/wav'),
    ).rejects.toBeInstanceOf(AudioProbeError);
    await expect(access(join(usedPath, '..'))).rejects.toThrow();
    spy.mockRestore();
  });

  describe('configuration', () => {
    const make = (path: string | undefined) =>
      new AudioProbeService(
        { get: () => path } as unknown as ConfigService,
        {} as StorageService,
      );

    it('is disabled when FFPROBE_PATH is not set', async () => {
      const service = make(undefined);
      expect(service.enabled).toBe(false);
      await expect(service.onModuleInit()).resolves.toBeUndefined();
    });

    it('fails fast at startup when FFPROBE_PATH points to something that cannot run', async () => {
      const service = make(join(dir, 'no-such-ffprobe'));
      expect(service.enabled).toBe(true);
      await expect(service.onModuleInit()).rejects.toThrow(/FFPROBE_PATH/);
    });

    it('reports UNAVAILABLE (a server problem) if the binary disappears at run time', async () => {
      const service = make(join(dir, 'vanished-ffprobe'));
      const file = join(dir, 'x.wav');
      await writeFile(file, wavBuffer(1));
      await expect(
        service.measureFile(file, 'audio/wav'),
      ).rejects.toMatchObject({
        reason: 'UNAVAILABLE',
      });
    });
  });
});
