"use client";

import { LoadError, Loading } from "@/components/ui/QueryState";
import { useRequests, type RequestItem } from "@/lib/api/queries";
import { dateFull, money, reqTitle } from "@/lib/format";
import { NavLink } from "@/lib/nav";
import { openModal } from "@/lib/store";
import { ReqBadge } from "./ReqBadge";

/** Текст под названием заявки: последнее сообщение или комментарий клиента */
export function lastText(r: RequestItem): string {
  const last = r.lastMessage;
  if (!last) return r.comment ?? "";
  return last.text ?? (last.hasAttachments ? "Вложения" : "");
}

export function RequestsView() {
  const { data, error, refetch } = useRequests();
  const newReq = () => openModal({ kind: "newReq" });
  const rs = data?.items;
  return (
    <>
      <header className="head">
        <div>
          <h1 className="large-title">Заявки</h1>
          <p className="sub muted">Нет готовой машины — оставьте заявку. Менеджер подберёт варианты и ответит в диалоге.</p>
        </div>
        <button type="button" className="btn btn-filled" onClick={newReq}>
          Новая заявка
        </button>
      </header>
      {error && !data ? (
        <LoadError error={error} retry={() => void refetch()} />
      ) : !rs ? (
        <Loading />
      ) : rs.length ? (
        <div className="stack" style={{ gap: "8px" }}>
          <span className="foot muted" style={{ padding: "0 16px" }}>
            {`Всего заявок: ${data.total}`}
          </span>
          <div className="group">
            {rs.map((r) => (
              <NavLink key={r.id} route="request" id={r.id} className="row">
                <div className="main">
                  <span className="headline">{reqTitle(r)}</span>
                  <span className="sub muted">
                    {`Бюджет ${money(r.budget)} · ${dateFull(r.createdAt)}`}
                  </span>
                  <span className="foot muted ellip">{lastText(r)}</span>
                </div>
                <ReqBadge status={r.status} />
                <span className="chev" aria-hidden="true"></span>
              </NavLink>
            ))}
          </div>
        </div>
      ) : (
        <div className="card empty">
          <span className="headline">Заявок пока нет</span>
          <span className="sub muted">Укажите марку, год и бюджет — менеджер пришлёт варианты.</span>
          <button type="button" className="btn btn-tinted" onClick={newReq}>
            Новая заявка
          </button>
        </div>
      )}
    </>
  );
}
