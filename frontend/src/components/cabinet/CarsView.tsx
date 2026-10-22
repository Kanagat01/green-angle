"use client";

import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import { Progress } from "@/components/ui/Progress";
import { LoadError, Loading } from "@/components/ui/QueryState";
import { Seg } from "@/components/ui/Seg";
import { useVehicles, type VehicleItem } from "@/lib/api/queries";
import { SHORT } from "@/lib/constants";
import { dateShort, vehicleTone } from "@/lib/format";
import { useDebounced } from "@/lib/hooks";
import { NavLink, useGo } from "@/lib/nav";
import { useRole, useSession, useSetEmailNotifications } from "@/lib/session";
import { setUi, toast, useApp } from "@/lib/store";

function CarList({ cars, empty }: { cars: VehicleItem[]; empty: "none" | "filtered" }) {
  const go = useGo();
  if (!cars.length) {
    return (
      <div className="card empty">
        <span className="headline">{empty === "filtered" ? "Ничего не нашлось" : "Здесь пока пусто"}</span>
        <span className="sub muted">
          {empty === "filtered" ? "Попробуйте другой VIN или сбросьте фильтр." : "Машины появятся, когда менеджер оформит заказ по вашей заявке."}
        </span>
        {empty === "none" && (
          <button type="button" className="btn btn-tinted" onClick={() => go("requests")}>
            Перейти к заявкам
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="cars">
      {cars.map((c) => (
        <NavLink key={c.id} route="car" id={c.id} className="card carcard">
          <div className="top">
            <div>
              <span className="title-3">{c.title}</span>
              <span className="mono foot muted">{c.vin ? "VIN " + c.vin : "VIN ещё не заполнен"}</span>
            </div>
            <Badge text={SHORT[c.currentStep - 1]} tone={vehicleTone(c)} />
          </div>
          <Progress step={c.currentStep} caption={"Обновлено " + dateShort(c.updatedAt)} />
        </NavLink>
      ))}
    </div>
  );
}

/** Физлицо: письма о смене статуса его машин (по умолчанию включены). */
function EmailNotifyRow() {
  const session = useSession();
  const set = useSetEmailNotifications();
  if (session.status !== "authed" || session.role !== "person") return null;
  const { me } = session;
  const change = (on: boolean) =>
    set.mutate(on, {
      onSuccess: () => toast(on ? "Письма о статусе включены." : "Письма о статусе выключены."),
      onError: (err) => toast(err instanceof Error ? err.message : "Не удалось сохранить."),
    });
  return (
    <section className="group">
      <label className="row">
        <div className="main">
          <span>Письма о смене статуса</span>
          <span className="sub muted">{`Пишем на ${me.email}, когда меняется этап вашей машины`}</span>
        </div>
        <input
          type="checkbox"
          checked={me.emailNotifications}
          disabled={set.isPending}
          onChange={(e) => change(e.target.checked)}
          style={{ width: "20px", height: "20px", accentColor: "var(--accent)" }}
        />
      </label>
    </section>
  );
}

export function CarsView() {
  const app = useApp();
  const person = useRole() === "person";
  const search = useDebounced(app.carQ.trim());
  const state = app.carFilter === "all" ? undefined : app.carFilter;
  const { data, error, refetch } = useVehicles({ search: search || undefined, state });

  return (
    <>
      <header className="head">
        <div>
          <h1 className="large-title">{person ? "Мои машины" : "Заказанные машины"}</h1>
          <p className="sub muted">
            {person
              ? "Здесь видно, на каком этапе ваша машина и что уже подтверждено фото или документом."
              : "Машины, которые компания везёт под ваших клиентов. Карточки заводит менеджер — вы следите за этапами."}
          </p>
        </div>
        <label className="search">
          <span className="sr">Поиск по VIN или модели</span>
          <Icon name="search" />
          <input
            className="input"
            type="search"
            id="carQ"
            placeholder="VIN или модель"
            value={app.carQ}
            onChange={(e) => setUi({ carQ: e.target.value })}
          />
        </label>
      </header>
      <EmailNotifyRow />
      <Seg
        name="carFilter"
        value={app.carFilter}
        onSelect={(v) => setUi({ carFilter: v })}
        items={[
          { v: "all", l: "Все", n: data?.counts.all },
          { v: "active", l: "В пути", n: data?.counts.active },
          { v: "ready", l: "Готовы к выдаче", n: data?.counts.ready },
        ]}
      />
      <div id="carList">
        {error && !data ? (
          <LoadError error={error} retry={() => void refetch()} />
        ) : !data ? (
          <Loading />
        ) : (
          <>
            <CarList cars={data.items} empty={data.counts.all ? "filtered" : "none"} />
            {data.total > data.items.length && (
              <span className="foot muted" style={{ padding: "0 16px" }}>
                {`Показаны первые ${data.items.length} из ${data.total}. Уточните поиск.`}
              </span>
            )}
          </>
        )}
      </div>
    </>
  );
}
