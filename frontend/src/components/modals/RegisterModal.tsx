"use client";

import { useState } from "react";
import { Field, fieldValue, useForm } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { ApiError, api } from "@/lib/api/client";
import { openModal, toast } from "@/lib/store";

type Kind = "COMPANY" | "PERSON";

export function RegisterModal({ type: initialType }: { type: Kind }) {
  const [type, setType] = useState<Kind>(initialType);
  const [busy, setBusy] = useState(false);
  const form = useForm({ aAgree: { err: true } });
  const agree = form.hint("aAgree");

  const submit = async (el: HTMLFormElement) => {
    const t = (el.querySelector("input[name=aType]:checked") as HTMLInputElement).value as Kind;
    const errors: Record<string, string> = {};
    const inn = fieldValue(el, "aInn").replace(/\D/g, "");
    if (t === "COMPANY") {
      if (!fieldValue(el, "aCompany")) errors.aCompany = "Укажите название компании";
      if (inn.length !== 10 && inn.length !== 12) errors.aInn = "ИНН: 10 или 12 цифр";
    } else if (!fieldValue(el, "aName")) errors.aName = "Укажите ФИО";
    if (fieldValue(el, "aPhone").replace(/\D/g, "").length < 11) errors.aPhone = "Укажите телефон полностью";
    const email = fieldValue(el, "aEmail");
    if (!/^\S+@\S+\.\S+$/.test(email)) errors.aEmail = "Проверьте email";
    const password = (el.elements.namedItem("aPass") as HTMLInputElement).value;
    if (password.length < 8) errors.aPass = "Пароль не короче 8 символов";
    if (!(el.elements.namedItem("aAgree") as HTMLInputElement).checked) {
      errors.aAgree = "Без согласия не получится создать кабинет";
    }
    if (!form.apply(el, errors)) return;

    setBusy(true);
    try {
      await api("/auth/register", {
        method: "POST",
        anonymous: true,
        body: {
          type: t,
          name: fieldValue(el, t === "COMPANY" ? "aCompany" : "aName"),
          inn: t === "COMPANY" ? inn : undefined,
          phone: fieldValue(el, "aPhone"),
          email,
          password,
          consent: true,
        },
      });
      openModal({ kind: "checkMail", email });
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        toast("Слишком много попыток. Подождите минуту и попробуйте снова.");
      } else if (err instanceof ApiError && err.status === 400) {
        // Сервер перечисляет все нарушенные правила; показываем их у пароля как общую ошибку формы
        form.apply(el, { aPass: err.message });
      } else {
        toast(err instanceof ApiError ? err.message : "Не удалось создать кабинет. Попробуйте ещё раз.");
      }
    } finally {
      setBusy(false);
    }
  };

  const pick = (t: Kind) => {
    setType(t);
    form.forget(["aCompany", "aInn", "aName"]);
  };

  return (
    <Modal title="Регистрация" submitLabel="Создать кабинет" busy={busy} onSubmit={submit}>
      <div className="choice" role="radiogroup" aria-label="Тип кабинета">
        <label>
          <input type="radio" name="aType" value="COMPANY" defaultChecked={initialType === "COMPANY"} onChange={() => pick("COMPANY")} />
          <span className="headline">Компания по привозу</span>
          <span className="foot muted">Юр.лицо, машины под клиентов</span>
        </label>
        <label>
          <input type="radio" name="aType" value="PERSON" defaultChecked={initialType === "PERSON"} onChange={() => pick("PERSON")} />
          <span className="headline">Физ.лицо</span>
          <span className="foot muted">Покупаю машину себе</span>
        </label>
      </div>
      <div id="aTypeFields">
        {type === "COMPANY" ? (
          <div className="grid2">
            <Field id="aCompany" label="Название компании" placeholder="ООО «АвтоПривоз Плюс»" hint={form.hint("aCompany")} />
            <Field id="aInn" label="ИНН" placeholder="10 или 12 цифр" inputMode="numeric" maxLength={12} hint={form.hint("aInn")} />
          </div>
        ) : (
          <Field id="aName" label="ФИО" placeholder="Смирнов Алексей Викторович" hint={form.hint("aName")} />
        )}
      </div>
      <div className="grid2">
        <Field id="aPhone" label="Телефон" placeholder="+7 900 000-00-00" inputMode="tel" hint={form.hint("aPhone")} />
        <Field id="aEmail" label="Email" placeholder="name@mail.ru" hint={form.hint("aEmail")} />
      </div>
      <Field id="aPass" label="Пароль" placeholder="Не короче 8 символов" type="password" hint={form.hint("aPass")} />
      <label className="check">
        <input type="checkbox" id="aAgree" name="aAgree" />
        <span>Согласен на обработку персональных данных</span>
      </label>
      <div className={"hint" + (agree.err ? " err" : "")} id="aAgree-hint" hidden={agree.hidden}>
        {agree.text}
      </div>
      <p className="foot muted" style={{ padding: "0 16px" }}>
        {"Уже есть аккаунт? "}
        <button type="button" className="linkbtn" onClick={() => openModal({ kind: "login", staff: false })}>
          Войти
        </button>
      </p>
    </Modal>
  );
}
