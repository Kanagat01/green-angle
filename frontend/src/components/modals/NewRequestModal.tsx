"use client";

import { Field, fieldValue, useForm } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { money } from "@/lib/format";
import { useGo } from "@/lib/nav";
import { createRequest, toast } from "@/lib/store";

const YEARS = ["2026", "2025", "2024", "2023", "2022", "2021", "2020"].map((y) => ({ v: y, l: y }));

export function NewRequestModal() {
  const form = useForm();
  const go = useGo();

  const submit = (el: HTMLFormElement) => {
    const model = fieldValue(el, "fModel");
    const budget = fieldValue(el, "fBudget");
    const errors: Record<string, string> = {};
    if (!model) errors.fModel = "Укажите марку и модель";
    if (!budget) errors.fBudget = "Укажите бюджет";
    if (!form.apply(el, errors)) return;
    const id = createRequest({
      model,
      year: fieldValue(el, "fYear"),
      budget: money(budget),
      comment: fieldValue(el, "fComment"),
    });
    go("request", id);
    toast("Заявка отправлена. Она уже в очереди супер ЛК.");
  };

  return (
    <Modal title="Новая заявка на подбор" submitLabel="Отправить заявку" onSubmit={submit}>
      <Field id="fModel" label="Марка и модель" placeholder="Haval Jolion" hint={form.hint("fModel")} />
      <div className="grid2">
        <Field id="fYear" label="Год" defaultValue="2024" options={YEARS} hint={form.hint("fYear")} />
        <Field id="fBudget" label="Бюджет, ₽" placeholder="1 600 000" inputMode="numeric" hint={form.hint("fBudget")} />
      </div>
      <Field
        id="fComment"
        label="Комментарий по комплектации"
        multiline
        placeholder="Цвет, привод, пробег, что точно не подходит"
        hint={form.hint("fComment")}
      />
    </Modal>
  );
}
