import { api, ApiError, resolveApiUrl, type Schemas } from "./client";

export type UploadKind = Exclude<Schemas["PresignUploadDto"]["kind"], "AUDIO">;

export type Uploaded = { key: string; kind: UploadKind };

/** Что принимает сервер (см. правила загрузки на бэкенде): для `accept` файлового поля */
export const ACCEPT = {
  PHOTO: "image/jpeg,image/png,image/webp,image/heic",
  VIDEO: "video/mp4,video/quicktime,video/webm",
  FILE: ".pdf,.doc,.docx,.xls,.xlsx,.zip",
} satisfies Record<UploadKind, string>;

export const ACCEPT_ALL = Object.values(ACCEPT).join(",");

export function kindOfFile(file: File): UploadKind {
  if (file.type.startsWith("image/")) return "PHOTO";
  if (file.type.startsWith("video/")) return "VIDEO";
  return "FILE";
}

/**
 * Загрузка файла в два шага: подписанная ссылка от API, затем PUT напрямую (на диск сервера или в S3).
 * Возвращает ключ, который регистрируется в сообщении или в смене статуса.
 */
export async function uploadFile(file: File, kind: UploadKind = kindOfFile(file)): Promise<Uploaded> {
  const mime = file.type || "application/octet-stream";
  let target: Schemas["PresignedUploadDto"];
  try {
    target = await api<Schemas["PresignedUploadDto"]>("/uploads/presign", {
      method: "POST",
      body: { kind, mime, size: file.size },
    });
  } catch (err) {
    if (err instanceof ApiError && err.status === 415) throw new ApiError(415, `Файл «${file.name}»: такой тип не принимается`);
    if (err instanceof ApiError && err.status === 413) throw new ApiError(413, `Файл «${file.name}» слишком большой`);
    throw err;
  }
  let res: Response;
  try {
    res = await fetch(resolveApiUrl(target.uploadUrl), {
      method: target.method,
      headers: target.headers as unknown as Record<string, string>,
      body: file,
    });
  } catch {
    throw new ApiError(0, "Не удалось загрузить файл. Проверьте интернет и попробуйте снова");
  }
  if (!res.ok) throw new ApiError(res.status, `Не удалось загрузить файл «${file.name}» (${res.status})`);
  return { key: target.key, kind };
}
