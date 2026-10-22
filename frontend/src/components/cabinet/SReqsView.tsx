"use client";

import { LoadError, Loading } from "@/components/ui/QueryState";
import { Seg } from "@/components/ui/Seg";
import { useAdminRequests, useRequestCounts } from "@/lib/api/queries";
import { dateTime, money, ownerKindLong, reqTitle } from "@/lib/format";
import { NavLink } from "@/lib/nav";
import { setUi, useApp } from "@/lib/store";
import { ReqBadge } from "./ReqBadge";
import { lastText } from "./RequestsView";

const AUTHOR = { CLIENT: "Клиент", MANAGER: "Менеджер", SYSTEM: "Система" } as const;

export function SReqsView() {
  const { reqFilter } = useApp();
  const { data, error, refetch } = useAdminRequests(reqFilter === "waiting");
  const counts = useRequestCounts(true);
  const rows = data?.items;
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
          { v: "waiting", l: "Ждут ответа", n: counts.data?.awaitingReply },
          { v: "all", l: "Все", n: counts.data?.total },
        ]}
      />
      {error && !data ? (
        <LoadError error={error} retry={() => void refetch()} />
      ) : !rows ? (
        <Loading />
      ) : (
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
              rows.map((r) => (
                <NavLink key={r.id} route="request" id={r.id} className="tr req-cols" ariaRole="row">
                  <span role="cell" className="stack">
                    <span className="headline">{r.client.name}</span>
                    <span className="cap muted">{ownerKindLong(r.client.type)}</span>
                  </span>
                  <span role="cell" className="sub">
                    {reqTitle(r)}
                  </span>
                  <span role="cell" className="sub">
                    {money(r.budget)}
                  </span>
                  <span role="cell">
                    <ReqBadge status={r.status} />
                  </span>
                  <span role="cell" style={{ display: "flex", alignItems: "center", gap: "12px", minWidth: 0 }}>
                    <span className="stack" style={{ flex: 1 }}>
                      <span className="sub ellip">{r.lastMessage ? lastText(r) : ""}</span>
                      <span className="cap muted">
                        {r.lastMessage ? `${AUTHOR[r.lastMessage.author]} · ${dateTime(r.lastMessage.createdAt)}` : ""}
                      </span>
                    </span>
                    {r.awaitingReply && <span className="waiting">Ждёт ответа</span>}
                  </span>
                </NavLink>
              ))
            ) : (
              <div className="sub muted" style={{ padding: "32px 20px", textAlign: "center" }}>
                Все ответили. Новых заявок нет.
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
