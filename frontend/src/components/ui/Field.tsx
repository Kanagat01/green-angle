"use client";

import { useState, type FormEventHandler, type HTMLAttributes } from "react";
import { flushSync } from "react-dom";

export type HintState = { text: string; err: boolean; hidden: boolean; invalid: boolean };

const EMPTY: HintState = { text: "", err: false, hidden: true, invalid: false };

type Initial = Record<string, string | { err: true }>;

/**
 * Состояние подсказок/ошибок полей формы. Повторяет поведение прототипа:
 * ошибка заменяет подсказку, при следующей отправке она скрывается, а счётчик ввода
 * после этого остаётся скрытым до следующей ошибки.
 */
export function useForm(initial: Initial = {}) {
  const [hints, setHints] = useState<Record<string, HintState>>(() => {
    const h: Record<string, HintState> = {};
    for (const [id, v] of Object.entries(initial)) {
      h[id] = typeof v === "string" ? { text: v, err: false, hidden: false, invalid: false } : { text: "", err: true, hidden: true, invalid: false };
    }
    return h;
  });

  const hint = (id: string): HintState => hints[id] ?? EMPTY;

  /** Сбрасывает прежние ошибки, проставляет новые и фокусирует первое невалидное поле. Возвращает true, если ошибок нет. */
  const apply = (formEl: HTMLFormElement, errors: Record<string, string>): boolean => {
    flushSync(() => {
      setHints((prev) => {
        const next: Record<string, HintState> = {};
        for (const [id, h] of Object.entries(prev)) {
          next[id] = h.err ? { ...h, err: false, hidden: true, invalid: false } : { ...h, invalid: false };
        }
        for (const [id, msg] of Object.entries(errors)) {
          next[id] = { text: msg, err: true, hidden: false, invalid: true };
        }
        return next;
      });
    });
    const failed = Object.keys(errors).length > 0;
    if (failed) formEl.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    return !failed;
  };

  /** Ошибка вне отправки формы (например, форма на странице). */
  const setErr = (id: string, msg: string) =>
    setHints((prev) => ({ ...prev, [id]: { text: msg, err: true, hidden: false, invalid: true } }));

  /** Счётчик вводимых символов: снимает ошибку, видимость подсказки не меняет. */
  const setCounter = (id: string, text: string) =>
    setHints((prev) => {
      const h = prev[id] ?? EMPTY;
      return { ...prev, [id]: { ...h, text, err: false, invalid: false } };
    });

  /** Забыть подсказки перечисленных полей (когда сами поля пересозданы). */
  const forget = (ids: string[]) =>
    setHints((prev) => {
      const next = { ...prev };
      ids.forEach((id) => delete next[id]);
      return next;
    });

  return { hint, apply, setErr, setCounter, forget };
}

type Option = { v: string | number; l: string };

type FieldProps = {
  id: string;
  label: string;
  hint: HintState;
  placeholder?: string;
  defaultValue?: string;
  options?: Option[];
  multiline?: boolean;
  mono?: boolean;
  maxLength?: number;
  inputMode?: HTMLAttributes<HTMLInputElement>["inputMode"];
  type?: string;
  onInput?: FormEventHandler<HTMLInputElement>;
  /** Управляемое значение (для полей вне модальных форм). */
  control?: { value: string; onChange: (v: string) => void };
};

export function Field({
  id,
  label,
  hint,
  placeholder,
  defaultValue,
  options,
  multiline,
  mono,
  maxLength,
  inputMode,
  type,
  onInput,
  control,
}: FieldProps) {
  const invalid = hint.invalid ? "true" : undefined;
  let input;
  if (options) {
    const value = control ? { value: control.value, onChange: (e: { target: { value: string } }) => control.onChange(e.target.value) } : { defaultValue };
    input = (
      <select className="input" id={id} name={id} aria-invalid={invalid} {...value}>
        {options.map((x) => (
          <option key={x.v} value={x.v}>
            {x.l}
          </option>
        ))}
      </select>
    );
  } else if (multiline) {
    input = <textarea className="input" id={id} name={id} placeholder={placeholder || ""} aria-invalid={invalid} defaultValue={defaultValue || ""} />;
  } else {
    input = (
      <input
        className={"input" + (mono ? " mono" : "")}
        id={id}
        name={id}
        type={type}
        placeholder={placeholder || ""}
        defaultValue={defaultValue || ""}
        maxLength={maxLength}
        inputMode={inputMode}
        autoComplete="off"
        aria-invalid={invalid}
        onInput={onInput}
      />
    );
  }
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {input}
      <div className={"hint" + (hint.err ? " err" : "")} id={id + "-hint"} hidden={hint.hidden}>
        {hint.text}
      </div>
    </div>
  );
}

/** Поле VIN: заглавные латинские буквы и цифры, счётчик «N из 17». */
export function vinInput(id: string, setCounter: (id: string, text: string) => void): FormEventHandler<HTMLInputElement> {
  return (e) => {
    const el = e.currentTarget;
    const p = el.selectionStart ?? el.value.length;
    el.value = el.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    el.setSelectionRange(p, p);
    setCounter(id, el.value.length + " из 17");
  };
}

export function fieldValue(form: HTMLFormElement, id: string): string {
  const el = form.elements.namedItem(id) as HTMLInputElement | null;
  return el ? el.value.trim() : "";
}
