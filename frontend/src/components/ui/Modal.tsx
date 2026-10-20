"use client";

import { useEffect, useLayoutEffect, useRef, type FormEvent, type ReactNode } from "react";
import { closeModal } from "@/lib/store";
import { Icon } from "./Icon";

export function Modal({
  title,
  submitLabel,
  danger,
  onSubmit,
  children,
}: {
  title: string;
  submitLabel: string;
  danger?: boolean;
  onSubmit: (form: HTMLFormElement) => void;
  children: ReactNode;
}) {
  const formRef = useRef<HTMLFormElement>(null);

  useLayoutEffect(() => {
    formRef.current?.querySelector<HTMLElement>("input,select,textarea")?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeModal();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    onSubmit(e.currentTarget);
  };

  return (
    <div
      className="scrim"
      onClick={(e) => {
        if (e.target === e.currentTarget) closeModal();
      }}
    >
      <form
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mTitle"
        id="mForm"
        noValidate
        ref={formRef}
        onSubmit={submit}
      >
        <div className="sheet-head">
          <h2 className="title-3" id="mTitle">
            {title}
          </h2>
          <button type="button" className="icon-btn sm" aria-label="Закрыть" onClick={closeModal}>
            <Icon name="close" />
          </button>
        </div>
        {children}
        <div className="actions">
          <button type="button" className="btn btn-gray" onClick={closeModal}>
            Отмена
          </button>
          <button type="submit" className={danger ? "btn btn-danger" : "btn btn-filled"}>
            {submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
