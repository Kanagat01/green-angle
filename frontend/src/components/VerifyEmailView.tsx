"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Field, fieldValue, useForm } from "@/components/ui/Field";
import { ApiError, api } from "@/lib/api/client";
import { openModal, toast } from "@/lib/store";

type State = "checking" | "ok" | "invalid" | "error";

const cardStyle = { maxWidth: "520px", margin: "12vh auto 0" } as const;

/** Страница по ссылке из письма: подтверждает почту и ведёт ко входу. */
export function VerifyEmailView({ token }: { token: string }) {
  const [state, setState] = useState<State>(token ? "checking" : "invalid");
  const started = useRef(false);
  const form = useForm();

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    api("/auth/verify-email", { method: "POST", body: { token }, anonymous: true })
      .then(() => setState("ok"))
      .catch((err: unknown) => setState(err instanceof ApiError && err.code === "INVALID_TOKEN" ? "invalid" : "error"));
  }, [token]);

  const resend = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const el = e.currentTarget;
    const email = fieldValue(el, "vEmail");
    if (!form.apply(el, /^\S+@\S+\.\S+$/.test(email) ? {} : { vEmail: "Проверьте email" })) return;
    try {
      await api("/auth/resend-verification", { method: "POST", body: { email }, anonymous: true });
      toast("Если такой кабинет есть, мы отправили новое письмо.");
    } catch (err) {
      toast(err instanceof ApiError && err.status === 429 ? "Слишком часто. Подождите минуту." : "Не удалось отправить письмо.");
    }
  };

  if (state === "checking") {
    return (
      <div className="card empty" style={cardStyle} role="status">
        <span className="headline">Подтверждаем почту…</span>
      </div>
    );
  }

  if (state === "ok") {
    return (
      <div className="card empty" style={cardStyle} role="status">
        <span className="headline">Почта подтверждена</span>
        <span className="sub muted">Кабинет открыт — можно входить.</span>
        <button type="button" className="btn btn-filled" onClick={() => openModal({ kind: "login", staff: false })}>
          Войти
        </button>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="card empty" style={cardStyle} role="alert">
        <span className="headline">Не удалось подтвердить почту</span>
        <span className="sub muted">Нет связи с сервером. Обновите страницу или попробуйте чуть позже.</span>
        <button type="button" className="btn btn-tinted" onClick={() => window.location.reload()}>
          Повторить
        </button>
      </div>
    );
  }

  return (
    <div className="card empty" style={cardStyle} role="alert">
      <span className="headline">Ссылка недействительна</span>
      <span className="sub muted">Она устарела или уже использована. Укажите почту — отправим новое письмо.</span>
      <form className="stack" style={{ width: "100%", gap: "8px" }} noValidate onSubmit={resend}>
        <Field id="vEmail" label="Email" placeholder="name@mail.ru" hint={form.hint("vEmail")} />
        <button type="submit" className="btn btn-filled">
          Отправить письмо ещё раз
        </button>
      </form>
      <Link href="/" className="linkbtn">
        На главную
      </Link>
    </div>
  );
}
