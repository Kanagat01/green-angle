"use client";

import { Modal } from "@/components/ui/Modal";
import { ApiError, api } from "@/lib/api/client";
import { closeModal, toast } from "@/lib/store";

/** После регистрации: куда ушло письмо и как отправить его ещё раз. */
export function CheckMailModal({ email }: { email: string }) {
  const resend = async () => {
    try {
      await api("/auth/resend-verification", { method: "POST", body: { email }, anonymous: true });
      toast("Письмо отправлено ещё раз.");
    } catch (err) {
      toast(err instanceof ApiError && err.status === 429 ? "Слишком часто. Подождите минуту." : "Не удалось отправить письмо.");
    }
  };

  return (
    <Modal title="Проверьте почту" submitLabel="Понятно" hideCancel onSubmit={closeModal}>
      <p className="callout" style={{ padding: "0 16px" }}>
        {`Мы отправили письмо на ${email}. Перейдите по ссылке из письма, чтобы подтвердить адрес, — после этого можно войти.`}
      </p>
      <p className="foot muted" style={{ padding: "0 16px" }}>
        {"Письмо не пришло? Загляните в «Спам» или "}
        <button type="button" className="linkbtn" onClick={() => void resend()}>
          отправьте его ещё раз
        </button>
        {"."}
      </p>
    </Modal>
  );
}
