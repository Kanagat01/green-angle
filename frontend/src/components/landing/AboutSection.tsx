"use client";

import { LandingIcon } from "@/components/ui/Icon";
import { openModal } from "@/lib/store";

export function AboutSection() {
  return (
    <section id="about" className="about band">
      <div className="in">
        <div className="txt">
          <span className="eyebrow">О компании</span>
          <h2>HUATECH сопровождает перегон автомобилей из Китая</h2>
          <p>
            Выкуп у продавца, доставка, таможенное оформление и получение документов. Работаем с компаниями по привозу и с частными
            покупателями.
          </p>
          <p className="muted">
            <span className="todo">Текст о компании</span> Два-три предложения: кто вы, откуда возите, чем отличаетесь.
          </p>
          <div className="facts">
            <div style={{ background: "var(--bg)" }}>
              <b>
                <span className="todo">год</span>
              </b>
              <span className="sub muted">работаем с этого года</span>
            </div>
            <div style={{ background: "var(--bg)" }}>
              <b>
                <span className="todo">число</span>
              </b>
              <span className="sub muted">машин привезли</span>
            </div>
            <div style={{ background: "var(--bg)" }}>
              <b>
                <span className="todo">срок</span>
              </b>
              <span className="sub muted">средняя доставка</span>
            </div>
          </div>
        </div>
        <div className="aud">
          <div className="card" style={{ background: "var(--bg)" }}>
            <span className="ic">
              <LandingIcon name="org" />
            </span>
            <div className="b">
              <span className="title-3">Компаниям по привозу</span>
              <span className="sub muted">Один кабинет на компанию: все машины ваших клиентов, заявки и переписка в одном месте.</span>
              <button type="button" className="btn btn-tinted" onClick={() => openModal({ kind: "register", type: "COMPANY" })}>
                Подключить компанию
              </button>
            </div>
          </div>
          <div className="card" style={{ background: "var(--bg)" }}>
            <span className="ic">
              <LandingIcon name="user" />
            </span>
            <div className="b">
              <span className="title-3">Частным покупателям</span>
              <span className="sub muted">Тот же кабинет на одного человека: ваши заявки и ваша машина.</span>
              <button type="button" className="btn btn-tinted" onClick={() => openModal({ kind: "register", type: "PERSON" })}>
                Создать кабинет
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
