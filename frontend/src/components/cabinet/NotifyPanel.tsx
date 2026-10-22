"use client";

import { useState, type FormEvent } from "react";
import { Field, fieldValue, useForm } from "@/components/ui/Field";
import { ApiError } from "@/lib/api/client";
import { useUpdateVehicleNotifications, type VehicleCard } from "@/lib/api/queries";
import { toast } from "@/lib/store";

/** Подборщик: письма о смене статуса уходят на email его конечного клиента. */
export function NotifyPanel({ car }: { car: VehicleCard }) {
  const form = useForm();
  const [enabled, setEnabled] = useState(car.notifyEnabled);
  const update = useUpdateVehicleNotifications(car.id);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const el = e.currentTarget;
    const email = fieldValue(el, "nEmail");
    const errors: Record<string, string> = {};
    if (email && !/^\S+@\S+\.\S+$/.test(email)) errors.nEmail = "Проверьте email";
    if (enabled && !email) errors.nEmail = "Укажите email клиента, чтобы включить письма";
    if (!form.apply(el, errors)) return;
    try {
      await update.mutateAsync({ ...(email ? { email } : {}), enabled });
      toast(enabled ? "Письма клиенту включены." : "Письма клиенту выключены.");
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Не удалось сохранить.");
    }
  };

  return (
    <form className="card panel" id="notifyForm" noValidate onSubmit={(e) => void submit(e)}>
      <h2 className="title-3">Уведомлять клиента</h2>
      <p className="sub muted">При смене статуса машины письмо уйдёт на этот адрес. Ссылки на кабинет в нём нет.</p>
      <Field id="nEmail" label="Email клиента" placeholder="client@mail.ru" defaultValue={car.notifyEmail ?? ""} hint={form.hint("nEmail")} />
      <label className="check">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        <span>Присылать клиенту письма о смене статуса</span>
      </label>
      <button type="submit" className="btn btn-tinted" disabled={update.isPending}>
        Сохранить
      </button>
    </form>
  );
}
