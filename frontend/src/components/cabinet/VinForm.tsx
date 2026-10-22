"use client";

import type { FormEvent } from "react";
import { Field, fieldValue, useForm, vinInput } from "@/components/ui/Field";
import { ApiError } from "@/lib/api/client";
import { useSetVin } from "@/lib/api/queries";
import { toast } from "@/lib/store";

export function VinForm({ carId }: { carId: string }) {
  const form = useForm({ fVin2: "0 из 17" });
  const setVin = useSetVin(carId);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const v = fieldValue(e.currentTarget, "fVin2");
    if (v.length !== 17) {
      form.setErr("fVin2", "VIN должен содержать 17 символов, сейчас " + v.length);
      return;
    }
    try {
      await setVin.mutateAsync(v);
      toast("VIN сохранён.");
    } catch (err) {
      if (err instanceof ApiError && (err.status === 400 || err.status === 409)) form.setErr("fVin2", err.message);
      else toast(err instanceof ApiError ? err.message : "Не удалось сохранить VIN.");
    }
  };

  return (
    <form className="card panel" id="vinForm" onSubmit={(e) => void submit(e)}>
      <h2 className="title-3">VIN</h2>
      <Field
        id="fVin2"
        label="VIN"
        placeholder="17 символов"
        maxLength={17}
        mono
        hint={form.hint("fVin2")}
        onInput={vinInput("fVin2", form.setCounter)}
      />
      <button type="submit" className="btn btn-tinted" disabled={setVin.isPending}>
        Сохранить VIN
      </button>
    </form>
  );
}
