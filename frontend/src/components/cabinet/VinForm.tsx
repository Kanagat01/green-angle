"use client";

import type { FormEvent } from "react";
import { Field, fieldValue, useForm, vinInput } from "@/components/ui/Field";
import { setCarVin, toast } from "@/lib/store";

export function VinForm({ carId }: { carId: string }) {
  const form = useForm({ fVin2: "0 из 17" });

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const v = fieldValue(e.currentTarget, "fVin2");
    if (v.length !== 17) {
      form.setErr("fVin2", "VIN должен содержать 17 символов, сейчас " + v.length);
      return;
    }
    setCarVin(carId, v);
    toast("VIN сохранён.");
  };

  return (
    <form className="card panel" id="vinForm" onSubmit={submit}>
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
      <button type="submit" className="btn btn-tinted">
        Сохранить VIN
      </button>
    </form>
  );
}
