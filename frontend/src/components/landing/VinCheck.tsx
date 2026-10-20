"use client";

import { useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/Badge";
import { Progress } from "@/components/ui/Progress";
import { SHORT } from "@/lib/constants";
import { carTone } from "@/lib/format";
import { setUi, useApp } from "@/lib/store";

const SAMPLE = "LVSHCAMB5RE077734";
const clean = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, "");

function VinResult() {
  const { lp, db } = useApp();
  if (!lp.checked) return null;
  const v = lp.vin.trim().toUpperCase();
  const c = db.cars.find((x) => x.vin && x.vin === v);
  if (!c) {
    return (
      <div className="res" role="status">
        <span className="headline">Машины с таким VIN у нас нет</span>
        <span className="sub muted">Проверьте 17 символов или попробуйте пример.</span>
      </div>
    );
  }
  return (
    <div className="res" role="status">
      <div className="top">
        <span className="headline">{c.title}</span>
        <Badge text={SHORT[c.step - 1]} tone={carTone(c)} />
      </div>
      <Progress step={c.step} caption={"Обновлено " + c.updated} />
      <span className="foot muted">Вложения и полная история доступны владельцу в личном кабинете.</span>
    </div>
  );
}

export function VinCheck() {
  const { lp } = useApp();
  const [text, setText] = useState(lp.vin);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setUi({ lp: { ...lp, vin: text.trim(), checked: true } });
  };

  return (
    <div className="vinbox">
      <span>Уже ждёте машину? Проверьте этап по VIN</span>
      <form id="vinCheck" noValidate onSubmit={submit}>
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
        <button type="submit" className="btn btn-white">
          Проверить
        </button>
      </form>
      <div id="vinRes">
        <VinResult />
      </div>
      <span>
        {"Пример для демо: "}
        <button
          type="button"
          className="linkbtn mono"
          onClick={() => {
            setText(SAMPLE);
            setUi({ lp: { ...lp, vin: SAMPLE, checked: true } });
          }}
        >
          {SAMPLE}
        </button>
      </span>
    </div>
  );
}
