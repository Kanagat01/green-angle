import {
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { AttachmentKind } from '../generated/prisma/client.js';
import { normalizeMime, UPLOAD_RULES, validateUpload } from './upload-rules.js';

describe('normalizeMime', () => {
  it('drops parameters and lowercases', () => {
    expect(normalizeMime('Audio/WebM; codecs=opus')).toBe('audio/webm');
  });
});

describe('validateUpload', () => {
  it('accepts allowed mime and returns extension', () => {
    expect(validateUpload('PHOTO', 'image/jpeg', 1024)).toEqual({
      mime: 'image/jpeg',
      ext: 'jpg',
    });
  });

  it('accepts MediaRecorder mime with codecs for AUDIO', () => {
    expect(validateUpload('AUDIO', 'audio/webm;codecs=opus', 1024)).toEqual({
      mime: 'audio/webm',
      ext: 'webm',
    });
  });

  it.each(['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav'])(
    'allows %s for AUDIO (PLAN.md §5)',
    (mime) => {
      expect(() => validateUpload('AUDIO', mime, 1024)).not.toThrow();
    },
  );

  it('rejects a mime that belongs to another kind', () => {
    expect(() => validateUpload('PHOTO', 'audio/webm', 1024)).toThrow(
      UnsupportedMediaTypeException,
    );
    expect(() => validateUpload('AUDIO', 'image/png', 1024)).toThrow(
      UnsupportedMediaTypeException,
    );
  });

  it('rejects executable and html content', () => {
    expect(() => validateUpload('FILE', 'text/html', 10)).toThrow(
      UnsupportedMediaTypeException,
    );
    expect(() =>
      validateUpload('FILE', 'application/x-msdownload', 10),
    ).toThrow(UnsupportedMediaTypeException);
  });

  it.each(Object.keys(UPLOAD_RULES) as AttachmentKind[])(
    'enforces the max size for %s',
    (kind) => {
      const rule = UPLOAD_RULES[kind];
      const mime = Object.keys(rule.mimes)[0];
      expect(() => validateUpload(kind, mime, rule.maxSize)).not.toThrow();
      expect(() => validateUpload(kind, mime, rule.maxSize + 1)).toThrow(
        PayloadTooLargeException,
      );
    },
  );

  it('limits AUDIO to 10 MB (PLAN.md §5)', () => {
    expect(UPLOAD_RULES.AUDIO.maxSize).toBe(10 * 1024 * 1024);
  });

  it.each([0, -1, 1.5, Number.NaN])('rejects invalid size %s', (size) => {
    expect(() => validateUpload('PHOTO', 'image/png', size)).toThrow(
      PayloadTooLargeException,
    );
  });
});
