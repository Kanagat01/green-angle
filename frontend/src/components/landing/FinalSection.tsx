"use client";

import { openModal } from "@/lib/store";

export function FinalSection() {
  return (
    <section className="final">
      <div className="in">
        <div className="stack" style={{ gap: "6px" }}>
          <h2>Начните с заявки</h2>
          <p className="lead">Нужны только контакты и пароль.</p>
        </div>
        <button type="button" className="btn btn-filled" onClick={() => openModal({ kind: "register", type: "COMPANY" })}>
          Зарегистрироваться
        </button>
      </div>
    </section>
  );
}
