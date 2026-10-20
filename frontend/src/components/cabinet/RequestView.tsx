"use client";

import { useLayoutEffect, useRef, type FormEvent } from "react";
import { Chip } from "@/components/ui/Chip";
import { Icon } from "@/components/ui/Icon";
import { NotFoundCard } from "@/components/ui/NotFoundCard";
import { ownerKindLabel, reqTitle } from "@/lib/format";
import { NavLink, useRedirectWhen } from "@/lib/nav";
import {
  addPending,
  approveRequest,
  carById,
  isClient,
  reqById,
  rejectRequest,
  removePending,
  sameOwner,
  sendMessage,
  toast,
  useApp,
} from "@/lib/store";
import { ReqBadge } from "./ReqBadge";

export function RequestView({ id }: { id: string }) {
  const { db, role, ready, pending } = useApp();
  const r = reqById(db, id);
  const mgr = !isClient(role);
  const denied = ready && !mgr && (!r || !sameOwner(role, r.owner));
  useRedirectWhen(denied, "/requests");

  const threadRef = useRef<HTMLDivElement>(null);
  const draftRef = useRef<HTMLInputElement>(null);
  const count = r ? r.messages.length : 0;
  useLayoutEffect(() => {
    const th = threadRef.current;
    if (th) th.scrollTop = th.scrollHeight;
  }, [count, id, denied]);

  if (denied) return null;
  if (!r) return <NotFoundCard />;

  const car = r.carId ? carById(db, r.carId) : undefined;
  const closed = r.status === "approved" || r.status === "rejected";

  const send = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const draft = draftRef.current!;
    const text = draft.value.trim();
    if (!text && !pending.length) return;
    sendMessage(r.id, text, mgr);
    draft.value = "";
    draft.focus();
  };

  return (
    <>
      <NavLink route={mgr ? "sreqs" : "requests"} className="back">
        <Icon name="back" />
        {mgr ? "Входящие заявки" : "Заявки"}
      </NavLink>
      <section className="card">
        <div className="chat-head">
          <div className="stack" style={{ gap: "4px" }}>
            <div className="t">
              <h1 className="title-1">{reqTitle(r)}</h1>
              <ReqBadge req={r} />
            </div>
            <span className="sub muted">
              {`Бюджет ${r.budget} · ${ownerKindLabel(r.owner.type)} · ${r.owner.name} · заявка от ${r.created}`}
            </span>
          </div>
          {mgr && !closed && (
            <div className="actions" style={{ padding: 0 }}>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => {
                  rejectRequest(r.id);
                  toast("Заявка отклонена.");
                }}
              >
                Отклонить
              </button>
              <button
                type="button"
                className="btn btn-filled"
                onClick={() => {
                  approveRequest(r.id);
                  toast("Заказ создан. Машина появилась у клиента.");
                }}
              >
                Одобрить и создать заказ
              </button>
            </div>
          )}
        </div>
      </section>
      {r.status === "approved" && car && (
        <div className="banner ok" role="status">
          <span>
            {`Заявка закрыта. Машина в разделе «${mgr ? "Все машины" : "Заказанные машины"}»${car.vin ? "" : " — осталось заполнить VIN"}.`}
          </span>
          <NavLink route={mgr ? "scar" : "car"} id={car.id}>
            Открыть заказ
          </NavLink>
        </div>
      )}
      {r.status === "rejected" && (
        <div className="banner warn" role="status">
          <span>Заявка отклонена менеджером.</span>
        </div>
      )}
      {!mgr && !closed && (
        <p className="foot muted" style={{ padding: "0 4px" }}>
          Переключитесь на «Супер ЛК» слева, чтобы ответить как менеджер и одобрить заявку.
        </p>
      )}
      <section className="card">
        <div className="thread" id="thread" aria-label="Переписка" aria-live="polite" ref={threadRef}>
          {r.messages.length ? (
            r.messages.map((m, i) => {
              if (m.who === "system") {
                return (
                  <div className="sysmsg" key={i}>
                    {m.text}
                  </div>
                );
              }
              const mine = mgr ? m.who === "manager" : m.who === "client";
              return (
                <div className={"msg" + (mine ? " mine" : "")} key={i}>
                  <span className="who">
                    {`${m.who === "manager" ? "Менеджер" : r.owner.name} · ${m.time}`}
                  </span>
                  {m.text && <div className="bubble">{m.text}</div>}
                  {m.files.length > 0 && (
                    <div className="chips">
                      {m.files.map((f, j) => (
                        <Chip key={j} file={f} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          ) : (
            <div className="sysmsg">Сообщений пока нет.</div>
          )}
        </div>
      </section>
      {!closed && (
        <form className="stack" style={{ gap: "8px" }} id="composer" onSubmit={send}>
          <div className="pending" id="pending">
            {pending.map((f, i) => (
              <span className="chip acc" key={i}>
                <Icon name={f[0]} />
                {f[1]}
                <button
                  type="button"
                  aria-label="Убрать вложение"
                  style={{ border: 0, background: "none", color: "inherit", cursor: "pointer", padding: "0 0 0 4px", display: "grid" }}
                  onClick={() => removePending(i)}
                >
                  <Icon name="close" />
                </button>
              </span>
            ))}
          </div>
          <div className="composer">
            <button type="button" className="icon-btn" aria-label="Прикрепить фото или ссылку" onClick={() => addPending(mgr)}>
              <Icon name="clip" />
            </button>
            <label style={{ flex: 1 }}>
              <span className="sr">Сообщение</span>
              <input className="input" id="draft" placeholder="Написать сообщение…" autoComplete="off" ref={draftRef} />
            </label>
            <button type="submit" className="btn btn-filled">
              Отправить
            </button>
          </div>
        </form>
      )}
    </>
  );
}
