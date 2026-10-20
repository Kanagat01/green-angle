"use client";

import { reqTitle } from "@/lib/format";
import { NavLink } from "@/lib/nav";
import { myReqs, openModal, useApp } from "@/lib/store";
import { ReqBadge } from "./ReqBadge";

export function RequestsView() {
  const app = useApp();
  const rs = myReqs(app)
    .slice()
    .sort((a, b) => (b.seqn || 0) - (a.seqn || 0));
  const newReq = () => openModal({ kind: "newReq" });
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
      {rs.length ? (
        <div className="stack" style={{ gap: "8px" }}>
          <span className="foot muted" style={{ padding: "0 16px" }}>
            {`Всего заявок: ${rs.length}`}
          </span>
          <div className="group">
            {rs.map((r) => {
              const last = r.messages[r.messages.length - 1];
              return (
                <NavLink key={r.id} route="request" id={r.id} className="row">
                  <div className="main">
                    <span className="headline">{reqTitle(r)}</span>
                    <span className="sub muted">
                      {`Бюджет ${r.budget} · ${r.created}`}
                    </span>
                    <span className="foot muted ellip">{last ? last.text : r.comment}</span>
                  </div>
                  <ReqBadge req={r} />
                  <span className="chev" aria-hidden="true"></span>
                </NavLink>
              );
            })}
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
