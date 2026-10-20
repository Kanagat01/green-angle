import { Icon } from "@/components/ui/Icon";
import { Chip } from "@/components/ui/Chip";
import { FULL, KIND, KIND_WORD } from "@/lib/constants";
import type { Car } from "@/lib/types";

export function Timeline({ car }: { car: Car }) {
  return (
    <ol className="timeline" aria-label="История статусов">
      {FULL.map((name, i) => {
        const n = i + 1;
        const st = n < car.step ? "d" : n === car.step ? "c" : "f";
        const files = car.files[n] || [];
        const k = KIND[i];
        let need = "";
        if (st !== "d" && k !== "none" && !files.length) need = (n === car.step ? "Ожидается " : "Нужно: ") + KIND_WORD[k];
        let meta = st === "d" ? "Пройден" : st === "c" ? "Текущий этап" : "Впереди";
        if (st === "c" && car.step === 13) meta = "Готово";
        return (
          <li key={n} className={st === "c" ? "now" : st === "f" ? "fut" : ""}>
            <div className={"dot " + st} aria-hidden="true">
              {st === "d" ? <Icon name="check" /> : st === "f" ? n : null}
            </div>
            <div className="tl-body">
              <span className="tl-name" style={st === "c" ? { fontWeight: 600 } : undefined}>
                {name}
              </span>
              {files.length > 0 && (
                <div className="chips">
                  {files.map((f, j) => (
                    <Chip key={j} file={f} />
                  ))}
                </div>
              )}
              {need && <span className="need">{need}</span>}
            </div>
            <span className="tl-meta">{meta}</span>
          </li>
        );
      })}
    </ol>
  );
}
