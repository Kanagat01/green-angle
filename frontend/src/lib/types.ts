/** Роль в интерфейсе: BROKER — компания по привозу, INDIVIDUAL — физ.лицо, ADMIN — Супер ЛК */
export type Role = "picker" | "person" | "super";

export type StepKind = "none" | "file" | "photo" | "video" | "number";
export type AttachmentKind = Exclude<StepKind, "none"> | "link" | "audio";

/** Вложение для показа: чип с иконкой; `href` — ссылка на файл (или адрес объявления) */
export type Attachment = { kind: AttachmentKind; label: string; href?: string };

export type Tone = "neutral" | "accent" | "success" | "warning" | "danger";
