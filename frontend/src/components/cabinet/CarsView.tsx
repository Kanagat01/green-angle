"use client";

import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import { Progress } from "@/components/ui/Progress";
import { Seg } from "@/components/ui/Seg";
import { SHORT } from "@/lib/constants";
import { carTone } from "@/lib/format";
import { NavLink, useGo } from "@/lib/nav";
import { myCars, setUi, useApp, type CarFilter } from "@/lib/store";
import type { Car } from "@/lib/types";

function CarList({ all, q, filter }: { all: Car[]; q: string; filter: CarFilter }) {
  const go = useGo();
  const cars = all.filter(
    (c) =>
      (filter === "all" || (filter === "active" && c.step < 13) || (filter === "ready" && c.step === 13)) &&
      (!q || (c.vin || "").toLowerCase().indexOf(q) >= 0 || c.title.toLowerCase().indexOf(q) >= 0),
  );
  if (!cars.length) {
    return (
      <div className="card empty">
        <span className="headline">{all.length ? "Ничего не нашлось" : "Здесь пока пусто"}</span>
        <span className="sub muted">
          {all.length ? "Попробуйте другой VIN или сбросьте фильтр." : "Машины появятся, когда менеджер оформит заказ по вашей заявке."}
        </span>
        {!all.length && (
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
            <Badge text={SHORT[c.step - 1]} tone={carTone(c)} />
          </div>
          <Progress step={c.step} caption={"Обновлено " + c.updated} />
        </NavLink>
      ))}
    </div>
  );
}

export function CarsView() {
  const app = useApp();
  const all = myCars(app);
  const person = app.role === "person";
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
      <Seg
        name="carFilter"
        value={app.carFilter}
        onSelect={(v) => setUi({ carFilter: v })}
        items={[
          { v: "all", l: "Все", n: all.length },
          { v: "active", l: "В пути", n: all.filter((c) => c.step < 13).length },
          { v: "ready", l: "Готовы к выдаче", n: all.filter((c) => c.step === 13).length },
        ]}
      />
      <div id="carList">
        <CarList all={all} q={app.carQ.trim().toLowerCase()} filter={app.carFilter} />
      </div>
    </>
  );
}
