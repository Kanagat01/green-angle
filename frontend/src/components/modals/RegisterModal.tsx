"use client";

import { useState } from "react";
import { Field, fieldValue, useForm } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { useEnter } from "@/lib/nav";
import { openModal } from "@/lib/store";

type Kind = "picker" | "person";

export function RegisterModal({ type: initialType }: { type: Kind }) {
  const [type, setType] = useState<Kind>(initialType);
  const form = useForm({ aAgree: { err: true } });
  const enter = useEnter();
  const agree = form.hint("aAgree");

  const submit = (el: HTMLFormElement) => {
    const t = (el.querySelector("input[name=aType]:checked") as HTMLInputElement).value as Kind;
    const errors: Record<string, string> = {};
    if (t === "picker") {
      if (!fieldValue(el, "aCompany")) errors.aCompany = "Укажите название компании";
      const inn = fieldValue(el, "aInn").replace(/\D/g, "");
      if (inn.length !== 10 && inn.length !== 12) errors.aInn = "ИНН: 10 или 12 цифр";
    } else if (!fieldValue(el, "aName")) errors.aName = "Укажите ФИО";
    if (fieldValue(el, "aPhone").replace(/\D/g, "").length < 11) errors.aPhone = "Укажите телефон полностью";
    if (!/^\S+@\S+\.\S+$/.test(fieldValue(el, "aEmail"))) errors.aEmail = "Проверьте email";
    if (fieldValue(el, "aPass").length < 6) errors.aPass = "Пароль не короче 6 символов";
    if (!(el.elements.namedItem("aAgree") as HTMLInputElement).checked) {
      errors.aAgree = "Без согласия не получится создать кабинет";
    }
    if (!form.apply(el, errors)) return;
    enter(t, "Кабинет создан. В демо вы вошли в пример с готовыми данными.");
  };

  const pick = (t: Kind) => {
    setType(t);
    form.forget(["aCompany", "aInn", "aName"]);
  };

  return (
    <Modal title="Регистрация" submitLabel="Создать кабинет" onSubmit={submit}>
      <div className="choice" role="radiogroup" aria-label="Тип кабинета">
        <label>
          <input type="radio" name="aType" value="picker" defaultChecked={initialType === "picker"} onChange={() => pick("picker")} />
          <span className="headline">Компания по привозу</span>
          <span className="foot muted">Юр.лицо, машины под клиентов</span>
        </label>
        <label>
          <input type="radio" name="aType" value="person" defaultChecked={initialType === "person"} onChange={() => pick("person")} />
          <span className="headline">Физ.лицо</span>
          <span className="foot muted">Покупаю машину себе</span>
        </label>
      </div>
      <div id="aTypeFields">
        {type === "picker" ? (
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
      <Field id="aPass" label="Пароль" placeholder="Не короче 6 символов" type="password" hint={form.hint("aPass")} />
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
