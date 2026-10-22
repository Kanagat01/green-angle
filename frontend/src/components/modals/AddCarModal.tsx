"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Field, fieldValue, useForm, vinInput } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { ApiError, api, type Schemas } from "@/lib/api/client";
import { findClient, PAGE, useCreateVehicle, type ClientType } from "@/lib/api/queries";
import { FULL } from "@/lib/constants";
import { closeModal, toast } from "@/lib/store";

const OWNER_TYPES = [
  { v: "COMPANY", l: "Компания по привозу (юр.лицо)" },
  { v: "PERSON", l: "Физ.лицо" },
];

const STEPS = FULL.map((n, i) => ({ v: i + 1, l: i + 1 + ". " + n }));

export function AddCarModal() {
  const form = useForm({ fVin: "0 из 17" });
  const [ownerType, setOwnerType] = useState<ClientType>("COMPANY");
  const create = useCreateVehicle();
  const clients = useQuery({
    queryKey: ["clients", "names"],
    queryFn: () => api<Schemas["ClientListDto"]>("/admin/clients", { query: { limit: PAGE } }),
    select: (d) => d.items.map((c) => c.name),
  });

  const submit = async (el: HTMLFormElement) => {
    const title = fieldValue(el, "fTitle");
    const vin = fieldValue(el, "fVin").toUpperCase();
    const owner = fieldValue(el, "fOwner");
    const errors: Record<string, string> = {};
    if (!title) errors.fTitle = "Укажите марку, модель и год";
    if (vin.length !== 17) errors.fVin = "VIN должен содержать 17 символов, сейчас " + vin.length;
    if (!owner) errors.fOwner = "Укажите владельца";
    if (!form.apply(el, errors)) return;
    try {
      // Совпадение по имени и типу — тот же владелец, дубль не создаём
      const existing = await findClient(owner, ownerType);
      await create.mutateAsync({
        title,
        vin,
        startStep: parseInt(fieldValue(el, "fStep"), 10),
        ...(existing ? { clientId: existing.id } : { client: { type: ownerType, name: owner } }),
      });
      closeModal();
      toast("Машина добавлена. Владелец видит её в своём кабинете.");
    } catch (err) {
      if (err instanceof ApiError && (err.status === 400 || err.status === 409)) form.apply(el, { fVin: err.message });
      else toast(err instanceof ApiError ? err.message : "Не удалось добавить машину.");
    }
  };

  const known = clients.data ?? [];

  return (
    <Modal title="Добавить машину" submitLabel="Создать" busy={create.isPending} onSubmit={submit}>
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
          control={{ value: ownerType, onChange: (v) => setOwnerType(v as ClientType) }}
          hint={form.hint("fOwnerType")}
        />
        <Field
          id="fOwner"
          label="Имя или название"
          placeholder={ownerType === "COMPANY" ? "ООО «АвтоПривоз Плюс»" : "Смирнов А. В."}
          hint={form.hint("fOwner")}
        />
      </div>
      {known.length > 0 && (
        <p className="foot muted" style={{ padding: "0 16px" }}>
          {`Уже есть в системе: ${known.join(", ")}. Машина появится в кабинете владельца с таким же названием.`}
        </p>
      )}
      <Field id="fStep" label="Стартовый статус" defaultValue="1" options={STEPS} hint={form.hint("fStep")} />
    </Modal>
  );
}
