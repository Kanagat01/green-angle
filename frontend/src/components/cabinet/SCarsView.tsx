"use client";

import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import { Progress } from "@/components/ui/Progress";
import { Seg } from "@/components/ui/Seg";
import { SHORT } from "@/lib/constants";
import { carTone } from "@/lib/format";
import { NavLink } from "@/lib/nav";
import { openModal, setUi, useApp } from "@/lib/store";

export function SCarsView() {
  const { db, ownerFilter, vinQ } = useApp();
  const all = db.cars;
  const q = vinQ.trim().toUpperCase();
  const cars = all.filter((c) => (ownerFilter === "all" || c.owner.type === ownerFilter) && (!q || (c.vin || "").indexOf(q) >= 0));
  return (
    <>
      <header className="head">
        <div>
          <h1 className="large-title">Все машины</h1>
          <p className="sub muted">
            По всем компаниям по привозу и физ.лицам. Откройте машину, чтобы сменить статус и прикрепить вложения.
          </p>
        </div>
        <button type="button" className="btn btn-filled" onClick={() => openModal({ kind: "addCar" })}>
          Добавить машину
        </button>
      </header>
      <div className="toolbar">
        <Seg
          name="ownerFilter"
          value={ownerFilter}
          onSelect={(v) => setUi({ ownerFilter: v })}
          items={[
            { v: "all", l: "Все", n: all.length },
            { v: "picker", l: "Компании по привозу", n: all.filter((c) => c.owner.type === "picker").length },
            { v: "person", l: "Физ.лица", n: all.filter((c) => c.owner.type === "person").length },
          ]}
        />
        <label className="search">
          <span className="sr">Поиск по VIN</span>
          <Icon name="search" />
          <input
            className="input"
            type="search"
            id="vinQ"
            placeholder="Поиск по VIN"
            value={vinQ}
            onChange={(e) => setUi({ vinQ: e.target.value })}
          />
        </label>
      </div>
      <div id="scarList">
        <div className="tablewrap">
          <div className="tbl" role="table" aria-label="Машины">
            <div className="tr th cars-cols" role="row">
              <span role="columnheader">Машина</span>
              <span role="columnheader">VIN</span>
              <span role="columnheader">Владелец</span>
              <span role="columnheader">Статус</span>
              <span role="columnheader">Обновлено</span>
            </div>
            {cars.length ? (
              cars.map((c) => (
                <NavLink key={c.id} route="scar" id={c.id} className="tr cars-cols" ariaRole="row">
                  <span role="cell" className="headline">
                    {c.title}
                  </span>
                  <span
                    role="cell"
                    className={"mono sub " + (c.vin ? "muted" : "")}
                    style={c.vin ? undefined : { color: "var(--warning)", fontWeight: 600 }}
                  >
                    {c.vin ? c.vin : "Заполните VIN"}
                  </span>
                  <span role="cell" className="stack">
                    <span className="sub">{c.owner.name}</span>
                    <span className="cap muted">{c.owner.type === "picker" ? "Компания по привозу · юр.лицо" : "Физ.лицо"}</span>
                  </span>
                  <span role="cell" className="stack" style={{ gap: "8px", alignItems: "flex-start" }}>
                    <Badge text={SHORT[c.step - 1]} tone={carTone(c)} />
                    <div style={{ width: "100%" }}>
                      <Progress step={c.step} caption={false} />
                    </div>
                  </span>
                  <span role="cell" className="sub muted">
                    {c.updated}
                  </span>
                </NavLink>
              ))
            ) : (
              <div className="sub muted" style={{ padding: "32px 20px", textAlign: "center" }}>
                Машин с таким VIN не найдено.
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
