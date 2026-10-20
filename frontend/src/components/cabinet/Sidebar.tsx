"use client";

import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/ui/Icon";
import { NavLink, useLogout, useSwitchRole, type Route } from "@/lib/nav";
import { isClient, myCars, myReqs, resetDemo, toast, useApp, waitingCount } from "@/lib/store";
import type { Role } from "@/lib/types";

const CAB_TITLE: Record<Role, string> = {
  picker: "ЛК компании по привозу",
  person: "Личный кабинет",
  super: "Супер ЛК",
};

const WHO: Record<Role, [string, string, string]> = {
  picker: ["АП", "ООО «АвтоПривоз Плюс»", "Юр.лицо · компания по привозу"],
  person: ["СА", "Смирнов А. В.", "Физ.лицо"],
  super: ["МН", "Менеджер", "Сотрудник компании"],
};

type Item = { r: Route; l: string; i: IconName; n: number; hot?: boolean; prefix: string };

export function Sidebar() {
  const app = useApp();
  const { role, db } = app;
  const pathname = usePathname();
  const switchRole = useSwitchRole();
  const logout = useLogout();

  let items: Item[];
  if (isClient(role)) {
    items = [
      { r: "cars", l: role === "person" ? "Мои машины" : "Заказанные машины", i: "car", n: myCars(app).length, prefix: "/cars" },
      { r: "requests", l: "Заявки", i: "chat", n: myReqs(app).length, prefix: "/requests" },
    ];
  } else {
    const w = waitingCount(db);
    items = [
      { r: "scars", l: "Все машины", i: "car", n: db.cars.length, prefix: "/admin/cars" },
      { r: "sreqs", l: "Входящие заявки", i: "chat", n: w, hot: w > 0, prefix: "/admin/requests" },
    ];
  }
  const who = WHO[role];

  const reset = () => {
    resetDemo();
    toast("Демо-данные сброшены.");
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
      <div className="role">
        <span className="foot muted">Смотреть как</span>
        <div className="seg" id="roleSeg" role="group" aria-label="Роль">
          <button type="button" title="Компания по привозу" aria-pressed={role === "picker"} onClick={() => switchRole("picker")}>
            Компания
          </button>
          <button type="button" aria-pressed={role === "person"} onClick={() => switchRole("person")}>
            Физ.лицо
          </button>
          <button type="button" aria-pressed={role === "super"} onClick={() => switchRole("super")}>
            Супер ЛК
          </button>
        </div>
      </div>
      <button
        type="button"
        className="logout-m"
        aria-label="Выйти"
        style={{ border: 0, cursor: "pointer", placeItems: "center" }}
        onClick={logout}
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
            <span className={"cnt" + (it.hot ? " hot" : "")}>{it.n}</span>
          </NavLink>
        ))}
      </nav>
      <div className="side-tools" style={{ flexDirection: "column", alignItems: "flex-start", gap: 0 }}>
        <button type="button" className="btn btn-plain btn-sm" onClick={logout}>
          Выйти на главную
        </button>
        <button type="button" className="btn btn-plain btn-sm" onClick={reset}>
          Сбросить демо-данные
        </button>
      </div>
      <div className="me" id="me">
        <div className="avatar" aria-hidden="true">
          {who[0]}
        </div>
        <div className="stack">
          <span className="sub" style={{ fontWeight: 600 }}>
            {who[1]}
          </span>
          <span className="cap muted">{who[2]}</span>
        </div>
      </div>
    </aside>
  );
}
