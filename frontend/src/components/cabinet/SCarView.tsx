"use client";

import { LoadError, Loading } from "@/components/ui/QueryState";
import { useRequest, useVehicle } from "@/lib/api/queries";
import { dateFull } from "@/lib/format";
import { NavLink } from "@/lib/nav";
import { openModal } from "@/lib/store";
import { CarHead } from "./CarHead";
import { StatusForm } from "./StatusForm";
import { Timeline } from "./Timeline";
import { VinForm } from "./VinForm";

function RequestLink({ requestId, owner }: { requestId: string; owner: string }) {
  const { data } = useRequest(requestId);
  return (
    <NavLink route="request" id={requestId} className="row">
      <div className="main">
        <span>Диалог по заявке</span>
        <span className="sub muted">{data ? data.client.name : owner}</span>
      </div>
      <span className="chev" aria-hidden="true"></span>
    </NavLink>
  );
}

export function SCarView({ id }: { id: string }) {
  const { data: c, error, refetch } = useVehicle(id);
  if (error && !c) return <LoadError error={error} retry={() => void refetch()} />;
  if (!c) return <Loading />;

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
          <StatusForm key={c.currentStep} car={c} />
          <section className="group">
            <div className="row">
              <div className="main">Заказ создан</div>
              <span className="val">{dateFull(c.createdAt)}</span>
            </div>
            {c.requestId && <RequestLink requestId={c.requestId} owner={c.client.name} />}
            <button type="button" className="row" style={{ color: "var(--danger)" }} onClick={() => openModal({ kind: "delCar", carId: c.id, title: c.title })}>
              <div className="main">Удалить машину</div>
            </button>
          </section>
        </aside>
      </div>
    </>
  );
}
