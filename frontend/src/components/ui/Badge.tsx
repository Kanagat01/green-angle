import type { Tone } from "@/lib/types";

export function Badge({ text, tone }: { text: string; tone: Tone }) {
  return <span className={"badge t-" + tone}>{text}</span>;
}
