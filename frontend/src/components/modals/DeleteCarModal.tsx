"use client";

import { Modal } from "@/components/ui/Modal";
import { useGo } from "@/lib/nav";
import { carById, deleteCar, toast, useApp } from "@/lib/store";

export function DeleteCarModal({ carId }: { carId: string }) {
  const { db } = useApp();
  const go = useGo();
  const car = carById(db, carId);

  const submit = () => {
    deleteCar(carId);
    go("scars");
    toast("Машина удалена.");
  };

  return (
    <Modal title="Удалить машину?" submitLabel="Удалить" danger onSubmit={submit}>
      <p className="callout">{`${car?.title} пропадёт у владельца вместе со всеми вложениями. Отменить это нельзя.`}</p>
    </Modal>
  );
}
