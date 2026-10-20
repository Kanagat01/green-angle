"use client";

import type { CSSProperties } from "react";
import { flushSync } from "react-dom";
import { Icon } from "@/components/ui/Icon";
import { FULL, KIND, KIND_LABEL, WHO_SEES } from "@/lib/constants";
import { setUi, useApp } from "@/lib/store";

export function RouteSection() {
  const { lp } = useApp();
  const n = lp.step;
  const k = KIND[n - 1];
  const p = (n - 1) / 12;
  return (
    <section id="route">
      <div className="in">
        <div className="sec-head">
          <span className="eyebrow">Путь машины</span>
          <h2>13 шагов, и на каждом понятно, что происходит</h2>
          <p className="lead">Нажмите на шаг, чтобы увидеть, что на нём происходит и чем он подтверждается.</p>
        </div>
        <div className="card route" id="routeCard">
          {/* key: в макете блок перерисовывается целиком, поэтому полоса прогресса не «доезжает» анимацией */}
          <div className="track" key={n} style={{ "--p": p } as CSSProperties}>
            <div className="ends">
              <span>Китай · оплата и выкуп</span>
              <span>Россия · выдача с ЭПТС</span>
            </div>
            <div className="steps" role="group" aria-label="Этапы">
              {FULL.map((nm, i) => (
                <button
                  key={i}
                  type="button"
                  className={i + 1 < n ? "done" : ""}
                  aria-pressed={n === i + 1}
                  aria-label={"Шаг " + (i + 1) + ": " + nm}
                  onClick={() => {
                    flushSync(() => setUi({ lp: { ...lp, step: i + 1 } }));
                    document
                      .querySelector<HTMLElement>('#routeCard .steps [aria-pressed="true"]')
                      ?.focus({ preventScroll: true });
                  }}
                >
                  {i + 1}
                </button>
              ))}
            </div>
          </div>
          <div className="stepinfo" aria-live="polite">
            <div className="v">
              <span className="k">{`Шаг ${n} из 13`}</span>
              <span className="big">{FULL[n - 1]}</span>
            </div>
            <div className="v">
              <span className="k">Чем подтверждается</span>
              <span>
                {k === "none" ? (
                  "Без вложения"
                ) : (
                  <span className="chip">
                    <Icon name={k} />
                    {KIND_LABEL[k]}
                  </span>
                )}
              </span>
              <span className="sub muted">{WHO_SEES[k]}</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
