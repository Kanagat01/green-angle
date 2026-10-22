"use client";

import { useQuery } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import { Icon, type IconName } from "@/components/ui/Icon";
import { api, type Schemas } from "@/lib/api/client";
import { useRequestCounts, useUnreadTotal } from "@/lib/api/queries";
import { NavLink, type Route } from "@/lib/nav";
import { useLogout, useSession, type Me } from "@/lib/session";
import type { Role } from "@/lib/types";

const CAB_TITLE: Record<Role, string> = {
  picker: "ЛК компании по привозу",
  person: "Личный кабинет",
  super: "Супер ЛК",
};

const LEGAL_FORMS = /^(ООО|ЗАО|ПАО|АО|ИП|ОАО)$/i;

/** Две буквы для аватарки: первые буквы первых двух слов названия без правовой формы. */
function initials(name: string): string {
  const words = name
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter((w) => w && !LEGAL_FORMS.test(w));
  return words
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}

function who(me: Me): [string, string, string] {
  if (me.role === "ADMIN") return ["МН", "Менеджер", me.email];
  const name = me.client?.name ?? me.email;
  return [initials(name), name, me.role === "BROKER" ? "Юр.лицо · компания по привозу" : "Физ.лицо"];
}

type Item = { r: Route; l: string; i: IconName; n: number; hot?: boolean; hideZero?: boolean; prefix: string };

/** Сколько машин у пользователя (для счётчика в меню): берём счётчики списка, сами машины не нужны. */
function useVehicleTotal(admin: boolean) {
  return useQuery({
    queryKey: ["vehicles", "total", admin],
    queryFn: () => api<Schemas["VehicleListDto"]>(admin ? "/admin/vehicles" : "/vehicles", { query: { limit: 1 } }),
    select: (d) => d.counts.all,
  });
}

export function Sidebar() {
  const session = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const logout = useLogout();
  const admin = session.status === "authed" && session.role === "super";
  const vehicles = useVehicleTotal(admin);
  const unread = useUnreadTotal();
  const counts = useRequestCounts(admin);
  if (session.status !== "authed") return null;
  const { role, me } = session;

  let items: Item[];
  if (!admin) {
    const u = unread.data?.unreadCount ?? 0;
    items = [
      { r: "cars", l: role === "person" ? "Мои машины" : "Заказанные машины", i: "car", n: vehicles.data ?? 0, prefix: "/cars" },
      { r: "requests", l: "Заявки", i: "chat", n: u, hot: u > 0, hideZero: true, prefix: "/requests" },
    ];
  } else {
    const w = counts.data?.awaitingReply ?? 0;
    items = [
      { r: "scars", l: "Все машины", i: "car", n: vehicles.data ?? 0, prefix: "/admin/cars" },
      { r: "sreqs", l: "Входящие заявки", i: "chat", n: w, hot: w > 0, prefix: "/admin/requests" },
    ];
  }
  const [initialsText, title, sub] = who(me);

  const leave = async () => {
    await logout();
    router.push("/");
    window.scrollTo(0, 0);
  };

  return (
    <aside className="side" aria-label="Кабинет">
      <div className="brand">
        <div className="mark" aria-hidden="true">
          H
        </div>
        <div className="stack">
          <span className="wordmark" style={{ fontSize: "16px" }}>
            HUATECH
          </span>
          <span className="cap muted" id="cabTitle">
            {CAB_TITLE[role]}
          </span>
        </div>
      </div>
      <button
        type="button"
        className="logout-m"
        aria-label="Выйти"
        style={{ border: 0, cursor: "pointer", placeItems: "center", justifySelf: "end" }}
        onClick={() => void leave()}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10" />
        </svg>
      </button>
      <nav className="nav" id="nav" aria-label="Разделы">
        {items.map((it) => (
          <NavLink key={it.r} route={it.r} current={pathname === it.prefix || pathname.startsWith(it.prefix + "/")}>
            <Icon name={it.i} />
            <span>{it.l}</span>
            {(!it.hideZero || it.n > 0) && <span className={"cnt" + (it.hot ? " hot" : "")}>{it.n}</span>}
          </NavLink>
        ))}
      </nav>
      <div className="side-tools" style={{ flexDirection: "column", alignItems: "flex-start", gap: 0 }}>
        <button type="button" className="btn btn-plain btn-sm" onClick={() => void leave()}>
          Выйти
        </button>
      </div>
      <div className="me" id="me">
        <div className="avatar" aria-hidden="true">
          {initialsText}
        </div>
        <div className="stack">
          <span className="sub" style={{ fontWeight: 600 }}>
            {title}
          </span>
          <span className="cap muted">{sub}</span>
        </div>
      </div>
    </aside>
  );
}
