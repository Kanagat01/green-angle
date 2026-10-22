"use client";

import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import { Progress } from "@/components/ui/Progress";
import { LoadError, Loading } from "@/components/ui/QueryState";
import { Seg } from "@/components/ui/Seg";
import { useAdminVehicles } from "@/lib/api/queries";
import { SHORT } from "@/lib/constants";
import { dateShort, ownerKindLong, vehicleTone } from "@/lib/format";
import { useDebounced } from "@/lib/hooks";
import { NavLink } from "@/lib/nav";
import { openModal, setUi, useApp } from "@/lib/store";

export function SCarsView() {
  const { ownerFilter, vinQ } = useApp();
  const vin = useDebounced(vinQ.trim().toUpperCase());
  const { data, error, refetch } = useAdminVehicles({
    vin: vin || undefined,
    ownerType: ownerFilter === "all" ? undefined : ownerFilter,
  });
  const cars = data?.items;
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
            { v: "all", l: "Все", n: data?.counts.all },
            { v: "COMPANY", l: "Компании по привозу", n: data?.counts.company },
            { v: "PERSON", l: "Физ.лица", n: data?.counts.person },
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
        {error && !data ? (
          <LoadError error={error} retry={() => void refetch()} />
        ) : !cars ? (
          <Loading />
        ) : (
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
                      <span className="sub">{c.client.name}</span>
                      <span className="cap muted">{ownerKindLong(c.client.type)}</span>
                    </span>
                    <span role="cell" className="stack" style={{ gap: "8px", alignItems: "flex-start" }}>
                      <Badge text={SHORT[c.currentStep - 1]} tone={vehicleTone(c)} />
                      <div style={{ width: "100%" }}>
                        <Progress step={c.currentStep} caption={false} />
                      </div>
                    </span>
                    <span role="cell" className="sub muted">
                      {dateShort(c.updatedAt)}
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
        )}
        {data && data.total > data.items.length && (
          <span className="foot muted" style={{ padding: "0 16px" }}>
            {`Показаны первые ${data.items.length} из ${data.total}. Уточните поиск по VIN.`}
          </span>
        )}
      </div>
    </>
  );
}
