"use client";

import { openModal, resetDemo, toast } from "@/lib/store";

export function LandingFooter() {
  return (
    <footer>
      <div className="in">
        <span>
          HUATECH · <span className="todo">телефон</span> · <span className="todo">email</span> · <span className="todo">адрес</span>
        </span>
        <span>
          <button type="button" className="linkbtn" onClick={() => openModal({ kind: "login", staff: true })}>
            Вход для сотрудников
          </button>
          {" · "}
          <button
            type="button"
            className="linkbtn"
            onClick={() => {
              resetDemo();
              toast("Демо-данные сброшены.");
            }}
          >
            Сбросить демо-данные
          </button>
        </span>
      </div>
    </footer>
  );
}
