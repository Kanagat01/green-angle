import {
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { AttachmentKind } from '../generated/prisma/client.js';

const MB = 1024 * 1024;

interface UploadRule {
  /** Допустимые mime-типы → расширение в ключе объекта */
  mimes: Record<string, string>;
  maxSize: number;
}

/** Ограничения по видам вложений (PLAN.md §4, §5). */
export const UPLOAD_RULES: Record<AttachmentKind, UploadRule> = {
  PHOTO: {
    mimes: {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/heic': 'heic',
    },
    maxSize: 20 * MB,
  },
  VIDEO: {
    mimes: {
      'video/mp4': 'mp4',
      'video/quicktime': 'mov',
      'video/webm': 'webm',
    },
    maxSize: 500 * MB,
  },
  FILE: {
    mimes: {
      'application/pdf': 'pdf',
      'application/msword': 'doc',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
        'docx',
      'application/vnd.ms-excel': 'xls',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
        'xlsx',
      'application/zip': 'zip',
    },
    maxSize: 50 * MB,
  },
  AUDIO: {
    mimes: {
      'audio/webm': 'webm',
      'audio/ogg': 'ogg',
      'audio/mp4': 'm4a',
      'audio/mpeg': 'mp3',
      'audio/wav': 'wav',
    },
    maxSize: 10 * MB,
  },
};

/** Убирает параметры и регистр: `audio/webm;codecs=opus` → `audio/webm`. */
export function normalizeMime(mime: string): string {
  return mime.split(';')[0].trim().toLowerCase();
}

/**
 * Проверяет mime и размер для вида вложения.
 * @returns нормализованный mime и расширение для ключа объекта
 */
export function validateUpload(
  kind: AttachmentKind,
  mime: string,
  size: number,
): { mime: string; ext: string } {
  const rule = UPLOAD_RULES[kind];
  const normalized = normalizeMime(mime);
  const ext = rule.mimes[normalized];
  if (!ext) {
    throw new UnsupportedMediaTypeException(
      `Mime type "${normalized}" is not allowed for ${kind}`,
    );
  }
  if (!Number.isInteger(size) || size <= 0 || size > rule.maxSize) {
    throw new PayloadTooLargeException(
      `${kind} size must be between 1 and ${rule.maxSize} bytes`,
    );
  }
  return { mime: normalized, ext };
}
