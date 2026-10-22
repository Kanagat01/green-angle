"use client";

import { useState, type FormEvent } from "react";
import { setUi, useApp } from "@/lib/store";

const clean = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Публичной проверки по VIN на сервере пока нет (бэклог), поэтому честно говорим об этом. */
function VinResult() {
  const { lp } = useApp();
  if (!lp.checked) return null;
  return (
    <div className="res" role="status">
      <span className="headline">Проверка по VIN пока недоступна</span>
      <span className="sub muted">Этап машины видно в личном кабинете — войдите или зарегистрируйтесь.</span>
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
    </div>
  );
}
