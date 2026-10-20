"use client";

import { Seg } from "@/components/ui/Seg";
import { isWaiting, reqTitle } from "@/lib/format";
import { NavLink } from "@/lib/nav";
import { setUi, useApp } from "@/lib/store";
import { ReqBadge } from "./ReqBadge";

export function SReqsView() {
  const { db, reqFilter } = useApp();
  const all = db.requests.slice().sort((a, b) => (isWaiting(b) ? 1 : 0) - (isWaiting(a) ? 1 : 0));
  const rows = reqFilter === "all" ? all : all.filter(isWaiting);
  return (
    <>
      <header className="head">
        <div>
          <h1 className="large-title">Входящие заявки</h1>
          <p className="sub muted">Единая очередь от компаний по привозу и физ.лиц. Сверху — кто ждёт ответа.</p>
        </div>
      </header>
      <Seg
        name="reqFilter"
        value={reqFilter}
        onSelect={(v) => setUi({ reqFilter: v })}
        items={[
          { v: "waiting", l: "Ждут ответа", n: all.filter(isWaiting).length },
          { v: "all", l: "Все", n: all.length },
        ]}
      />
      <div className="tablewrap">
        <div className="tbl" role="table" aria-label="Заявки">
          <div className="tr th req-cols" role="row">
            <span role="columnheader">Клиент</span>
            <span role="columnheader">Авто</span>
            <span role="columnheader">Бюджет</span>
            <span role="columnheader">Статус</span>
            <span role="columnheader">Последнее сообщение</span>
          </div>
          {rows.length ? (
            rows.map((r) => {
              const m = r.messages[r.messages.length - 1];
              return (
                <NavLink key={r.id} route="request" id={r.id} className="tr req-cols" ariaRole="row">
                  <span role="cell" className="stack">
                    <span className="headline">{r.owner.name}</span>
                    <span className="cap muted">{r.owner.type === "picker" ? "Компания по привозу · юр.лицо" : "Физ.лицо"}</span>
                  </span>
                  <span role="cell" className="sub">
                    {reqTitle(r)}
                  </span>
                  <span role="cell" className="sub">
                    {r.budget}
                  </span>
                  <span role="cell">
                    <ReqBadge req={r} />
                  </span>
                  <span role="cell" style={{ display: "flex", alignItems: "center", gap: "12px", minWidth: 0 }}>
                    <span className="stack" style={{ flex: 1 }}>
                      <span className="sub ellip">{m ? m.text || "Вложения" : ""}</span>
                      <span className="cap muted">
                        {m ? (m.who === "manager" ? "Менеджер" : m.who === "system" ? "Система" : "Клиент") + " · " + m.time : ""}
                      </span>
                    </span>
                    {isWaiting(r) && <span className="waiting">Ждёт ответа</span>}
                  </span>
                </NavLink>
              );
            })
          ) : (
            <div className="sub muted" style={{ padding: "32px 20px", textAlign: "center" }}>
              Все ответили. Новых заявок нет.
            </div>
          )}
        </div>
      </div>
    </>
  );
}
