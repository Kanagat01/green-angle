"use client";

import { Field, fieldValue, useForm } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { useEnter } from "@/lib/nav";
import { openModal, toast, useApp } from "@/lib/store";

export function LoginModal({ staff }: { staff: boolean }) {
  const { role } = useApp();
  const form = useForm();
  const enter = useEnter();

  const submit = (el: HTMLFormElement) => {
    const errors: Record<string, string> = {};
    if (!fieldValue(el, "aLogin")) errors.aLogin = "Укажите email или телефон";
    if (fieldValue(el, "aPass").length < 6) errors.aPass = "Пароль не короче 6 символов";
    if (!form.apply(el, errors)) return;
    enter(staff ? "super" : role === "person" ? "person" : "picker", "Вы вошли. В демо подходит любой логин и пароль.");
  };

  return (
    <Modal title={staff ? "Вход для сотрудников" : "Вход в кабинет"} submitLabel="Войти" onSubmit={submit}>
      <Field
        id="aLogin"
        label={staff ? "Рабочий email" : "Email или телефон"}
        placeholder={staff ? "manager@company.ru" : "name@mail.ru"}
        hint={form.hint("aLogin")}
      />
      <Field id="aPass" label="Пароль" placeholder="Не короче 6 символов" type="password" hint={form.hint("aPass")} />
      {!staff && (
        <p className="foot muted" style={{ padding: "0 16px" }}>
          {"Нет аккаунта? "}
          <button type="button" className="linkbtn" onClick={() => openModal({ kind: "register", type: "picker" })}>
            Зарегистрироваться
          </button>
          {" · "}
          <button type="button" className="linkbtn" onClick={() => toast("В демо восстановление пароля не работает.")}>
            Забыли пароль?
          </button>
        </p>
      )}
    </Modal>
  );
}
