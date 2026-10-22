import type { Schemas } from "./api/client";
import type { Attachment, AttachmentKind } from "./types";

type Stored = Schemas["StepAttachmentDto"];

const KIND_OF: Record<Stored["kind"], AttachmentKind> = { PHOTO: "photo", VIDEO: "video", FILE: "file", AUDIO: "audio" };
const WORD: Record<AttachmentKind, string> = {
  photo: "Фото",
  video: "Видео",
  file: "Файл",
  audio: "Голосовое",
  number: "№",
  link: "Ссылка на объявление",
};

/** Чипы для загруженных файлов; файлов одного вида несколько — нумеруем («Фото 1», «Фото 2»). */
export function storedAttachments(items: Stored[]): Attachment[] {
  const total: Partial<Record<AttachmentKind, number>> = {};
  for (const a of items) total[KIND_OF[a.kind]] = (total[KIND_OF[a.kind]] ?? 0) + 1;
  const seen: Partial<Record<AttachmentKind, number>> = {};
  return items.map((a) => {
    const kind = KIND_OF[a.kind];
    const n = (seen[kind] = (seen[kind] ?? 0) + 1);
    return { kind, label: (total[kind] ?? 0) > 1 ? `${WORD[kind]} ${n}` : WORD[kind], href: a.url };
  });
}

export function stepAttachments(step: Schemas["VehicleStepDto"]): Attachment[] {
  const files = storedAttachments(step.attachments);
  return step.declarationNumber ? [{ kind: "number", label: `№ ${step.declarationNumber}` }, ...files] : files;
}

export function messageAttachments(m: Schemas["MessageViewDto"]): Attachment[] {
  const files = storedAttachments(m.attachments);
  const links = m.links.map((href, i): Attachment => ({
    kind: "link",
    label: m.links.length > 1 ? `${WORD.link} ${i + 1}` : WORD.link,
    href,
  }));
  return [...files, ...links];
}
