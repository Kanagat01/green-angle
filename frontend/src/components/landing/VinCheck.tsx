"use client";

import { useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/Badge";
import { Progress } from "@/components/ui/Progress";
import { ApiError } from "@/lib/api/client";
import { checkVin, type PublicVehicleStatus } from "@/lib/api/public";
import { SHORT } from "@/lib/constants";
import { dateShort } from "@/lib/format";

const clean = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, "");

type Result =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "found"; car: PublicVehicleStatus }
  | { kind: "none" }
  | { kind: "message"; title: string; text: string };

function VinResult({ result }: { result: Result }) {
  if (result.kind === "idle" || result.kind === "loading") return null;
  if (result.kind === "found") {
    const { car } = result;
    return (
      <div className="res" role="status">
        <div className="top">
          <span className="headline">{car.title}</span>
          <Badge text={SHORT[car.currentStep - 1]} tone={car.currentStep === 13 ? "success" : "accent"} />
        </div>
        <Progress step={car.currentStep} caption={"Обновлено " + dateShort(car.updatedAt)} />
        <span className="foot muted">Вложения и полная история доступны владельцу в личном кабинете.</span>
      </div>
    );
  }
  const [title, text] =
    result.kind === "none"
      ? ["Машины с таким VIN у нас нет", "Проверьте 17 символов."]
      : [result.title, result.text];
  return (
    <div className="res" role="status">
      <span className="headline">{title}</span>
      <span className="sub muted">{text}</span>
    </div>
  );
}

export function VinCheck() {
  const [text, setText] = useState("");
  const [result, setResult] = useState<Result>({ kind: "idle" });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (result.kind === "loading") return;
    if (text.length !== 17) {
      setResult({ kind: "message", title: "Нужен VIN из 17 символов", text: `Сейчас символов: ${text.length}.` });
      return;
    }
    setResult({ kind: "loading" });
    try {
      const car = await checkVin(text);
      setResult(car ? { kind: "found", car } : { kind: "none" });
    } catch (err) {
      setResult(
        err instanceof ApiError && err.status === 429
          ? { kind: "message", title: "Слишком много проверок", text: "Подождите минуту и попробуйте снова." }
          : { kind: "message", title: "Не удалось проверить", text: "Нет связи с сервером. Попробуйте ещё раз." },
      );
    }
  };

  return (
    <div className="vinbox">
      <span>Уже ждёте машину? Проверьте этап по VIN</span>
      <form id="vinCheck" noValidate onSubmit={(e) => void submit(e)}>
        <div className="field">
          <label htmlFor="lpVin" className="sr">
            VIN
          </label>
          <input
            className="input mono"
            id="lpVin"
            maxLength={17}
            placeholder="VIN, 17 символов"
            autoComplete="off"
            value={text}
            onChange={(e) => setText(clean(e.target.value))}
          />
        </div>
        <button type="submit" className="btn btn-white" disabled={result.kind === "loading"}>
          Проверить
        </button>
      </form>
      <div id="vinRes">
        <VinResult result={result} />
      </div>
    </div>
  );
}
