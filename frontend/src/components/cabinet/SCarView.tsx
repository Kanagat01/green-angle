"use client";

import { NotFoundCard } from "@/components/ui/NotFoundCard";
import { NavLink } from "@/lib/nav";
import { carById, openModal, reqById, useApp } from "@/lib/store";
import { CarHead } from "./CarHead";
import { StatusForm } from "./StatusForm";
import { Timeline } from "./Timeline";
import { VinForm } from "./VinForm";

export function SCarView({ id }: { id: string }) {
  const { db, edit } = useApp();
  const c = carById(db, id);
  if (!c) return <NotFoundCard />;
  const r = c.reqId ? reqById(db, c.reqId) : undefined;

  return (
    <>
      <CarHead car={c} backRoute="scars" backLabel="Все машины" />
      {!c.vin && (
        <div className="banner warn" role="status">
          <span>Машина создана из заявки. Заполните VIN, чтобы клиент видел его в карточке.</span>
        </div>
      )}
      <div className="split">
        <section className="card grow">
          <Timeline car={c} />
        </section>
        <aside>
          {!c.vin && <VinForm carId={c.id} />}
          <StatusForm key={edit.nonce} car={c} />
          <section className="group">
            <div className="row">
              <div className="main">Заказ создан</div>
              <span className="val">{c.created}</span>
            </div>
            {r && (
              <NavLink route="request" id={r.id} className="row">
                <div className="main">
                  <span>Диалог по заявке</span>
                  <span className="sub muted">{r.owner.name}</span>
                </div>
                <span className="chev" aria-hidden="true"></span>
              </NavLink>
            )}
            <button type="button" className="row" style={{ color: "var(--danger)" }} onClick={() => openModal({ kind: "delCar", carId: c.id })}>
              <div className="main">Удалить машину</div>
            </button>
          </section>
        </aside>
      </div>
    </>
  );
}
