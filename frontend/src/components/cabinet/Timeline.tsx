import { Icon } from "@/components/ui/Icon";
import { Chip } from "@/components/ui/Chip";
import type { VehicleCard } from "@/lib/api/queries";
import { stepAttachments } from "@/lib/attachments";
import { FULL, KIND, KIND_WORD } from "@/lib/constants";

export function Timeline({ car }: { car: VehicleCard }) {
  const current = car.currentStep;
  return (
    <ol className="timeline" aria-label="История статусов">
      {FULL.map((name, i) => {
        const n = i + 1;
        const st = n < current ? "d" : n === current ? "c" : "f";
        const files = stepAttachments(car.steps[i]);
        const k = KIND[i];
        let need = "";
        if (st !== "d" && k !== "none" && !files.length) need = (n === current ? "Ожидается " : "Нужно: ") + KIND_WORD[k];
        let meta = st === "d" ? "Пройден" : st === "c" ? "Текущий этап" : "Впереди";
        if (st === "c" && current === 13) meta = "Готово";
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
