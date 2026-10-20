"use client";

import { useState } from "react";
import { Field, fieldValue, useForm, vinInput } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { FULL } from "@/lib/constants";
import { addCar, closeModal, toast, useApp } from "@/lib/store";
import type { Owner, OwnerType } from "@/lib/types";

const OWNER_TYPES = [
  { v: "picker", l: "Компания по привозу (юр.лицо)" },
  { v: "person", l: "Физ.лицо" },
];

const STEPS = FULL.map((n, i) => ({ v: i + 1, l: i + 1 + ". " + n }));

export function AddCarModal() {
  const { db } = useApp();
  const form = useForm({ fVin: "0 из 17" });
  const [ownerType, setOwnerType] = useState<OwnerType>("picker");

  const seen = new Set<string>();
  const owners: Owner[] = [];
  for (const x of [...db.cars, ...db.requests]) {
    const k = x.owner.type + "|" + x.owner.name;
    if (!seen.has(k)) {
      seen.add(k);
      owners.push(x.owner);
    }
  }

  const submit = (el: HTMLFormElement) => {
    const title = fieldValue(el, "fTitle");
    const vin = fieldValue(el, "fVin").toUpperCase();
    const owner = fieldValue(el, "fOwner");
    const errors: Record<string, string> = {};
    if (!title) errors.fTitle = "Укажите марку, модель и год";
    if (vin.length !== 17) errors.fVin = "VIN должен содержать 17 символов, сейчас " + vin.length;
    if (!owner) errors.fOwner = "Укажите владельца";
    if (!form.apply(el, errors)) return;
    addCar({
      title,
      vin,
      owner: { type: fieldValue(el, "fOwnerType") as OwnerType, name: owner },
      step: parseInt(fieldValue(el, "fStep"), 10),
    });
    closeModal();
    toast("Машина добавлена. Владелец видит её в своём кабинете.");
  };

  return (
    <Modal title="Добавить машину" submitLabel="Создать" onSubmit={submit}>
      <Field id="fTitle" label="Марка, модель, год" placeholder="Geely Monjaro, 2024" hint={form.hint("fTitle")} />
      <Field
        id="fVin"
        label="VIN"
        placeholder="17 символов"
        maxLength={17}
        mono
        hint={form.hint("fVin")}
        onInput={vinInput("fVin", form.setCounter)}
      />
      <div className="grid2">
        <Field
          id="fOwnerType"
          label="Тип владельца"
          options={OWNER_TYPES}
          control={{ value: ownerType, onChange: (v) => setOwnerType(v as OwnerType) }}
          hint={form.hint("fOwnerType")}
        />
        <Field
          id="fOwner"
          label="Имя или название"
          placeholder={ownerType === "picker" ? "ООО «АвтоПривоз Плюс»" : "Смирнов А. В."}
          hint={form.hint("fOwner")}
        />
      </div>
      <p className="foot muted" style={{ padding: "0 16px" }}>
        {`Уже есть в системе: ${owners.map((o) => o.name).join(", ")}. Машина появится в кабинете владельца с таким же названием.`}
      </p>
      <Field id="fStep" label="Стартовый статус" defaultValue="1" options={STEPS} hint={form.hint("fStep")} />
    </Modal>
  );
}
