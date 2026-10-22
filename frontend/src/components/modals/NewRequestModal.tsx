"use client";

import { Field, fieldValue, useForm } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { ApiError } from "@/lib/api/client";
import { useCreateRequest } from "@/lib/api/queries";
import { useGo } from "@/lib/nav";
import { toast } from "@/lib/store";

const YEARS = ["2026", "2025", "2024", "2023", "2022", "2021", "2020"].map((y) => ({ v: y, l: y }));

export function NewRequestModal() {
  const form = useForm();
  const go = useGo();
  const create = useCreateRequest();

  const submit = async (el: HTMLFormElement) => {
    const model = fieldValue(el, "fModel");
    const budget = parseInt(fieldValue(el, "fBudget").replace(/\D/g, ""), 10);
    const errors: Record<string, string> = {};
    if (!model) errors.fModel = "Укажите марку и модель";
    if (!budget) errors.fBudget = "Укажите бюджет";
    if (!form.apply(el, errors)) return;
    try {
      const created = await create.mutateAsync({
        title: model,
        yearFrom: parseInt(fieldValue(el, "fYear"), 10),
        budget,
        comment: fieldValue(el, "fComment") || undefined,
      });
      go("request", created.id);
      toast("Заявка отправлена. Она уже в очереди супер ЛК.");
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) form.apply(el, { fModel: err.message });
      else toast(err instanceof ApiError ? err.message : "Не удалось отправить заявку.");
    }
  };

  return (
    <Modal title="Новая заявка на подбор" submitLabel="Отправить заявку" busy={create.isPending} onSubmit={submit}>
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
