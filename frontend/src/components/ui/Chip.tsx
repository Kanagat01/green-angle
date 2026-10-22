import type { Attachment } from "@/lib/types";
import { resolveApiUrl } from "@/lib/api/client";
import { Icon } from "./Icon";

/** Вложение-чип; если есть ссылка, чип открывает файл (или объявление) в новой вкладке. */
export function Chip({ file, cls }: { file: Attachment; cls?: string }) {
  const className = "chip" + (cls ? " " + cls : "");
  const body = (
    <>
      <Icon name={file.kind} />
      {file.label}
    </>
  );
  const href = file.href ? resolveApiUrl(file.href) : null;
  // Ссылки приходят от пользователей: открываем только http(s)
  if (!href || !/^https?:\/\//.test(href)) return <span className={className}>{body}</span>;
  return (
    <a className={className} href={href} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}>
      {body}
    </a>
  );
}
