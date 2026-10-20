import type { Attachment } from "@/lib/types";
import { Icon } from "./Icon";

export function Chip({ file, cls }: { file: Attachment; cls?: string }) {
  return (
    <span className={"chip" + (cls ? " " + cls : "")}>
      <Icon name={file[0]} />
      {file[1]}
    </span>
  );
}
