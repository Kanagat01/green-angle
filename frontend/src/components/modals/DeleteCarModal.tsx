"use client";

import { Modal } from "@/components/ui/Modal";
import { ApiError } from "@/lib/api/client";
import { useDeleteVehicle } from "@/lib/api/queries";
import { useGo } from "@/lib/nav";
import { closeModal, toast } from "@/lib/store";

export function DeleteCarModal({ carId, title }: { carId: string; title: string }) {
  const go = useGo();
  const remove = useDeleteVehicle();

  const submit = async () => {
    try {
      await remove.mutateAsync(carId);
      go("scars");
      toast("Машина удалена.");
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        closeModal();
        go("scars");
        toast("Машины уже нет.");
      } else toast(err instanceof ApiError ? err.message : "Не удалось удалить машину.");
    }
  };

  return (
    <Modal title="Удалить машину?" submitLabel="Удалить" danger busy={remove.isPending} onSubmit={submit}>
      <p className="callout">{`${title} пропадёт у владельца вместе со всеми вложениями. Отменить это нельзя.`}</p>
    </Modal>
  );
}
