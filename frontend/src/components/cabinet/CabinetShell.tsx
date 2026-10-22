"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useSession } from "@/lib/session";
import type { Role } from "@/lib/types";
import { Sidebar } from "./Sidebar";

const CLIENT_PREFIXES = ["/cars", "/requests"];
const isUnder = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(prefix + "/");

function redirectFor(role: Role, pathname: string): string | null {
  if (role !== "super" && isUnder(pathname, "/admin")) return "/cars";
  if (role === "super" && CLIENT_PREFIXES.some((p) => isUnder(pathname, p))) return "/admin/cars";
  return null;
}

/**
 * Каркас кабинета. Пока сессия неизвестна, ничего не показываем (совпадает с серверным HTML);
 * без входа возвращаем на главную, чужие разделы роли перенаправляем на её стартовый.
 */
export function CabinetShell({ children }: { children: ReactNode }) {
  const session = useSession();
  const pathname = usePathname();
  const router = useRouter();

  const redirect = session.status === "anon" ? "/" : session.status === "authed" ? redirectFor(session.role, pathname) : null;

  useEffect(() => {
    if (redirect) router.replace(redirect);
  }, [redirect, router]);

  if (session.status === "error") {
    return (
      <main id="main" tabIndex={-1}>
        <div className="card empty" role="alert" style={{ maxWidth: "520px", margin: "12vh auto 0" }}>
          <span className="headline">Не удалось загрузить кабинет</span>
          <span className="sub muted">Нет связи с сервером. Проверьте интернет и повторите.</span>
          <button type="button" className="btn btn-tinted" onClick={session.retry}>
            Повторить
          </button>
        </div>
      </main>
    );
  }
  if (session.status !== "authed") return null;

  return (
    <div className="app" id="app">
      <Sidebar />
      <main id="main" tabIndex={-1}>
        {redirect ? null : children}
      </main>
    </div>
  );
}
