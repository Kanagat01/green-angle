"use client";

import { openModal } from "@/lib/store";
import { scrollToAnchor } from "./scroll";

export function LandingNav() {
  return (
    <div className="lp-nav">
      <div className="in">
        <div className="brand" style={{ padding: 0 }}>
          <div className="mark" aria-hidden="true">
            H
          </div>
          <span className="wordmark">HUATECH</span>
        </div>
        <nav className="links" aria-label="Разделы сайта">
          <a href="#how" onClick={scrollToAnchor}>
            Как это работает
          </a>
          <a href="#route" onClick={scrollToAnchor}>
            Путь машины
          </a>
          <a href="#cars" onClick={scrollToAnchor}>
            Привезённые машины
          </a>
          <a href="#about" onClick={scrollToAnchor}>
            О компании
          </a>
        </nav>
        <div className="auth">
          <button type="button" className="btn btn-gray" onClick={() => openModal({ kind: "login", staff: false })}>
            Войти
          </button>
          <button type="button" className="btn btn-filled" onClick={() => openModal({ kind: "register", type: "picker" })}>
            Регистрация
          </button>
        </div>
      </div>
    </div>
  );
}
