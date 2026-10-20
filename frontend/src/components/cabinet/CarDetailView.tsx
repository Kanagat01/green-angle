"use client";

import { Progress } from "@/components/ui/Progress";
import { FULL, KIND, KIND_WORD, SHORT } from "@/lib/constants";
import { NavLink, useRedirectWhen } from "@/lib/nav";
import { carById, reqById, sameOwner, useApp } from "@/lib/store";
import { CarHead } from "./CarHead";
import { Timeline } from "./Timeline";

export function CarDetailView({ id }: { id: string }) {
  const { db, role, ready } = useApp();
  const c = carById(db, id);
  const denied = ready && (!c || !sameOwner(role, c.owner));
  useRedirectWhen(denied, "/cars");
  if (!c || denied) return null;

  const nfiles = Object.keys(c.files).reduce((a, k) => a + c.files[Number(k)].length, 0);
  const k = KIND[c.step - 1];
  const waitingWord = k !== "none" && !(c.files[c.step] || []).length && c.step < 13 ? KIND_WORD[k] : null;
  const req = c.reqId ? reqById(db, c.reqId) : undefined;

  return (
    <>
      <CarHead car={c} backRoute="cars" backLabel={role === "person" ? "Мои машины" : "Заказанные машины"} />
      <div className="split">
        <section className="card grow">
          <Timeline car={c} />
        </section>
        <aside>
          <section className="card panel">
            <h2 className="title-3">Прогресс</h2>
            <Progress step={c.step} caption={SHORT[c.step - 1]} />
            <p className="sub muted">
              {c.step === 13
                ? "Машина готова к выдаче. Документы СБКТС и ЭПТС получены."
                : waitingWord
                  ? "Менеджер прикрепит " + waitingWord + " по текущему этапу — вы увидите его здесь."
                  : "Следующий этап — «" + FULL[c.step] + "»."}
            </p>
          </section>
          <section className="group">
            <div className="row">
              <div className="main">Заказ создан</div>
              <span className="val">{c.created}</span>
            </div>
            <div className="row">
              <div className="main">Обновлено</div>
              <span className="val">{c.updated}</span>
            </div>
            <div className="row">
              <div className="main">Вложений</div>
              <span className="val">{nfiles}</span>
            </div>
            {req && (
              <NavLink route="request" id={req.id} className="row">
                <div className="main">
                  <span>Диалог по заявке</span>
                  <span className="sub muted">{`Заявка от ${req.created}`}</span>
                </div>
                <span className="chev" aria-hidden="true"></span>
              </NavLink>
            )}
          </section>
        </aside>
      </div>
    </>
  );
}
