"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Chip } from "@/components/ui/Chip";
import { Icon, type IconName } from "@/components/ui/Icon";
import { LoadError, Loading } from "@/components/ui/QueryState";
import { ApiError } from "@/lib/api/client";
import {
  useApproveRequest,
  useMarkRead,
  useMessages,
  useRejectRequest,
  useRequest,
  useSendMessage,
  useVehicle,
} from "@/lib/api/queries";
import { ACCEPT_ALL, kindOfFile, uploadFile, type UploadKind } from "@/lib/api/uploads";
import { messageAttachments } from "@/lib/attachments";
import { dateFull, dateTime, money, ownerKindLabel, reqTitle } from "@/lib/format";
import { joinRequestRoom } from "@/lib/realtime";
import { NavLink, useRedirectWhen } from "@/lib/nav";
import { useRole } from "@/lib/session";
import { toast } from "@/lib/store";
import { ReqBadge } from "./ReqBadge";

const MAX_ITEMS = 10;

type Pending = {
  id: number;
  icon: IconName;
  label: string;
  state: "uploading" | "done";
  /** Загруженный файл */
  upload?: { key: string; kind: UploadKind };
  /** Ссылка на объявление */
  link?: string;
};

const ICON: Record<UploadKind, IconName> = { PHOTO: "photo", VIDEO: "video", FILE: "file" };

function parseLink(raw: string): URL | null {
  try {
    const url = new URL(raw.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

export function RequestView({ id }: { id: string }) {
  const role = useRole();
  const mgr = role === "super";
  const { data: r, error, refetch } = useRequest(id);
  const messages = useMessages(id);
  const vehicle = useVehicle(r?.vehicleId ?? "");
  const send = useSendMessage(id);
  const markRead = useMarkRead(id);
  const approve = useApproveRequest(id);
  const reject = useRejectRequest(id);

  const denied = !mgr && error instanceof ApiError && (error.status === 404 || error.status === 403);
  useRedirectWhen(denied, "/requests");

  // Пока диалог открыт, сервер присылает его новые сообщения сразу
  useEffect(() => joinRequestRoom(id), [id]);

  const threadRef = useRef<HTMLDivElement>(null);
  const draftRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const seq = useRef(0);
  const [pending, setPending] = useState<Pending[]>([]);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkError, setLinkError] = useState("");
  const linkRef = useRef<HTMLInputElement>(null);

  const items = messages.items;
  const lastId = items?.[items.length - 1]?.id;
  useLayoutEffect(() => {
    const th = threadRef.current;
    if (th) th.scrollTop = th.scrollHeight;
  }, [lastId, id]);

  // Всё, что пришло, пока диалог открыт, считается прочитанным
  const unread = r?.unreadCount ?? 0;
  const loaded = Boolean(items);
  useEffect(() => {
    if (loaded && unread > 0 && !markRead.isPending) markRead.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, unread]);

  if (denied) return null;
  if (error && !r) return <LoadError error={error} retry={() => void refetch()} />;
  if (!r) return <Loading />;

  const closed = r.status === "APPROVED" || r.status === "REJECTED";
  const uploading = pending.some((p) => p.state === "uploading");

  const attach = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    for (const file of files) {
      if (pending.length + 1 > MAX_ITEMS) {
        toast(`В одном сообщении не больше ${MAX_ITEMS} вложений.`);
        break;
      }
      const pid = ++seq.current;
      const kind = kindOfFile(file);
      setPending((p) => [...p, { id: pid, icon: ICON[kind], label: file.name, state: "uploading" }]);
      uploadFile(file, kind)
        .then((upload) => setPending((p) => p.map((x) => (x.id === pid ? { ...x, state: "done", upload } : x))))
        .catch((err: unknown) => {
          setPending((p) => p.filter((x) => x.id !== pid));
          toast(err instanceof ApiError ? err.message : "Не удалось загрузить файл.");
        });
    }
  };

  const addLink = () => {
    const url = parseLink(linkRef.current?.value ?? "");
    if (!url) {
      setLinkError("Нужна ссылка, начинающаяся с http:// или https://");
      return;
    }
    if (url.href.length > 2000) {
      setLinkError("Ссылка слишком длинная");
      return;
    }
    if (pending.length + 1 > MAX_ITEMS) {
      setLinkError(`В одном сообщении не больше ${MAX_ITEMS} вложений`);
      return;
    }
    setPending((p) => [...p, { id: ++seq.current, icon: "link", label: url.hostname, state: "done", link: url.href }]);
    if (linkRef.current) linkRef.current.value = "";
    setLinkError("");
    setLinkOpen(false);
  };

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const draft = draftRef.current!;
    const text = draft.value.trim();
    if ((!text && !pending.length) || uploading || send.isPending) return;
    try {
      await send.mutateAsync({
        type: "TEXT",
        text: text || undefined,
        links: pending.flatMap((p) => (p.link ? [p.link] : [])),
        attachments: pending.flatMap((p) => (p.upload ? [p.upload] : [])),
      });
      draft.value = "";
      setPending([]);
      draft.focus();
    } catch (err) {
      toast(
        err instanceof ApiError && err.status === 409
          ? "Заявка закрыта — писать в диалог больше нельзя."
          : err instanceof ApiError
            ? err.message
            : "Не удалось отправить сообщение.",
      );
    }
  };

  const decide = (action: "approve" | "reject") => {
    const mutation = action === "approve" ? approve : reject;
    mutation.mutate(undefined, {
      onSuccess: () => toast(action === "approve" ? "Заказ создан. Машина появилась у клиента." : "Заявка отклонена."),
      onError: (err) => toast(err instanceof ApiError && err.status === 409 ? "Заявка уже закрыта." : "Не удалось выполнить действие."),
    });
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
              <ReqBadge status={r.status} />
            </div>
            <span className="sub muted">
              {`Бюджет ${money(r.budget)} · ${ownerKindLabel(r.client.type)} · ${r.client.name} · заявка от ${dateFull(r.createdAt)}`}
            </span>
          </div>
          {mgr && !closed && (
            <div className="actions" style={{ padding: 0 }}>
              <button type="button" className="btn btn-danger" disabled={reject.isPending || approve.isPending} onClick={() => decide("reject")}>
                Отклонить
              </button>
              <button type="button" className="btn btn-filled" disabled={reject.isPending || approve.isPending} onClick={() => decide("approve")}>
                Одобрить и создать заказ
              </button>
            </div>
          )}
        </div>
      </section>
      {r.status === "APPROVED" && r.vehicleId && (
        <div className="banner ok" role="status">
          <span>
            {`Заявка закрыта. Машина в разделе «${mgr ? "Все машины" : "Заказанные машины"}»${vehicle.data && !vehicle.data.vin ? " — осталось заполнить VIN" : ""}.`}
          </span>
          <NavLink route={mgr ? "scar" : "car"} id={r.vehicleId}>
            Открыть заказ
          </NavLink>
        </div>
      )}
      {r.status === "REJECTED" && (
        <div className="banner warn" role="status">
          <span>Заявка отклонена менеджером.</span>
        </div>
      )}
      <section className="card">
        <div className="thread" id="thread" aria-label="Переписка" aria-live="polite" ref={threadRef}>
          {messages.hasNextPage && (
            <button
              type="button"
              className="linkbtn"
              style={{ alignSelf: "center" }}
              disabled={messages.isFetchingNextPage}
              onClick={() => void messages.fetchNextPage()}
            >
              Показать ранние сообщения
            </button>
          )}
          {messages.error && !items ? (
            <LoadError error={messages.error} retry={() => void messages.refetch()} />
          ) : !items ? (
            <div className="sysmsg">Загружаем переписку…</div>
          ) : items.length ? (
            items.map((m) => {
              if (m.type === "SYSTEM") {
                return (
                  <div className="sysmsg" key={m.id}>
                    {m.text}
                  </div>
                );
              }
              const files = messageAttachments(m);
              return (
                <div className={"msg" + (m.isMine ? " mine" : "")} key={m.id}>
                  <span className="who">
                    {`${m.author?.role === "ADMIN" ? "Менеджер" : r.client.name} · ${dateTime(m.createdAt)}`}
                  </span>
                  {m.text && <div className="bubble">{m.text}</div>}
                  {files.length > 0 && (
                    <div className="chips">
                      {files.map((f, j) => (
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
        <form className="stack" style={{ gap: "8px" }} id="composer" onSubmit={(e) => void submit(e)}>
          <div className="pending" id="pending">
            {pending.map((p) => (
              <span className="chip acc" key={p.id}>
                <Icon name={p.icon} />
                {p.state === "uploading" ? `${p.label} · загрузка…` : p.label}
                <button
                  type="button"
                  aria-label="Убрать вложение"
                  style={{ border: 0, background: "none", color: "inherit", cursor: "pointer", padding: "0 0 0 4px", display: "grid" }}
                  onClick={() => setPending((list) => list.filter((x) => x.id !== p.id))}
                >
                  <Icon name="close" />
                </button>
              </span>
            ))}
          </div>
          {linkOpen && (
            <div className="stack" style={{ gap: "4px" }}>
              <div className="composer">
                <label style={{ flex: 1 }}>
                  <span className="sr">Ссылка на объявление</span>
                  <input
                    className="input"
                    id="linkDraft"
                    placeholder="Ссылка на объявление, https://…"
                    autoComplete="off"
                    ref={linkRef}
                    aria-invalid={linkError ? "true" : undefined}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addLink();
                      }
                    }}
                  />
                </label>
                <button type="button" className="btn btn-tinted" onClick={addLink}>
                  Добавить
                </button>
              </div>
              {linkError && <span className="hint err">{linkError}</span>}
            </div>
          )}
          <div className="composer">
            <input ref={fileRef} type="file" multiple hidden accept={ACCEPT_ALL} onChange={attach} />
            <button type="button" className="icon-btn" aria-label="Прикрепить файл" onClick={() => fileRef.current?.click()}>
              <Icon name="clip" />
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label="Добавить ссылку на объявление"
              aria-pressed={linkOpen}
              onClick={() => {
                setLinkOpen((v) => !v);
                setLinkError("");
              }}
            >
              <Icon name="link" />
            </button>
            <label style={{ flex: 1 }}>
              <span className="sr">Сообщение</span>
              <input className="input" id="draft" placeholder="Написать сообщение…" autoComplete="off" maxLength={5000} ref={draftRef} />
            </label>
            <button type="submit" className="btn btn-filled" disabled={uploading || send.isPending}>
              Отправить
            </button>
          </div>
        </form>
      )}
    </>
  );
}
