"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Field, fieldValue, useForm } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { ApiError, api } from "@/lib/api/client";
import { defaultRoute, routePath } from "@/lib/nav";
import { roleOf, useLogin } from "@/lib/session";
import { closeModal, openModal, toast } from "@/lib/store";

const EMAIL = /^\S+@\S+\.\S+$/;

export function LoginModal({ staff }: { staff: boolean }) {
  const form = useForm();
  const router = useRouter();
  const login = useLogin();
  const [busy, setBusy] = useState(false);
  const [unverified, setUnverified] = useState<string | null>(null);

  const submit = async (el: HTMLFormElement) => {
    const email = fieldValue(el, "aLogin");
    const errors: Record<string, string> = {};
    if (!EMAIL.test(email)) errors.aLogin = "Проверьте email";
    const password = (el.elements.namedItem("aPass") as HTMLInputElement).value;
    if (password.length < 8) errors.aPass = "Пароль не короче 8 символов";
    if (!form.apply(el, errors)) return;

    setBusy(true);
    setUnverified(null);
    try {
      const me = await login(email, password);
      closeModal();
      router.push(routePath(defaultRoute(roleOf(me)), undefined, roleOf(me)));
      window.scrollTo(0, 0);
    } catch (err) {
      if (err instanceof ApiError && err.code === "EMAIL_NOT_VERIFIED") {
        setUnverified(email);
      } else if (err instanceof ApiError && err.status === 401) {
        form.apply(el, { aPass: "Неверный email или пароль" });
      } else if (err instanceof ApiError && err.status === 429) {
        form.apply(el, { aPass: "Слишком много попыток. Подождите минуту и попробуйте снова" });
      } else {
        toast(err instanceof ApiError ? err.message : "Не удалось войти. Попробуйте ещё раз");
      }
    } finally {
      setBusy(false);
    }
  };

  const resend = async (email: string) => {
    try {
      await api("/auth/resend-verification", { method: "POST", body: { email }, anonymous: true });
      toast("Письмо отправлено. Проверьте почту.");
    } catch (err) {
      toast(err instanceof ApiError && err.status === 429 ? "Слишком часто. Подождите минуту." : "Не удалось отправить письмо.");
    }
  };

  return (
    <Modal title={staff ? "Вход для сотрудников" : "Вход в кабинет"} submitLabel="Войти" busy={busy} onSubmit={submit}>
      <Field
        id="aLogin"
        label={staff ? "Рабочий email" : "Email"}
        placeholder={staff ? "manager@company.ru" : "name@mail.ru"}
        hint={form.hint("aLogin")}
      />
      <Field id="aPass" label="Пароль" placeholder="Не короче 8 символов" type="password" hint={form.hint("aPass")} />
      {unverified && (
        <div className="banner warn" role="alert" style={{ margin: "0 16px" }}>
          <span>Почта не подтверждена. Перейдите по ссылке из письма.</span>
          <button type="button" className="linkbtn" onClick={() => void resend(unverified)}>
            Отправить письмо ещё раз
          </button>
        </div>
      )}
      {!staff && (
        <p className="foot muted" style={{ padding: "0 16px" }}>
          {"Нет аккаунта? "}
          <button type="button" className="linkbtn" onClick={() => openModal({ kind: "register", type: "COMPANY" })}>
            Зарегистрироваться
          </button>
          {" · "}
          <button type="button" className="linkbtn" onClick={() => toast("Восстановление пароля пока недоступно.")}>
            Забыли пароль?
          </button>
        </p>
      )}
    </Modal>
  );
}
