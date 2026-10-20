"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { settleNavigation } from "@/lib/nav";
import { isClient, useApp } from "@/lib/store";
import { Sidebar } from "./Sidebar";

const CLIENT_PREFIXES = ["/cars", "/requests"];
const isUnder = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(prefix + "/");

/**
 * Каркас кабинета. До чтения localStorage ничего не показываем (совпадает с серверным HTML),
 * без входа возвращаем на главную, чужие разделы роли перенаправляем на её стартовый.
 */
export function CabinetShell({ children }: { children: ReactNode }) {
  const { ready, authed, role } = useApp();
  const pathname = usePathname();
  const router = useRouter();

  let redirect: string | null = null;
  if (ready) {
    if (!authed) redirect = "/";
    else if (isClient(role) && isUnder(pathname, "/admin")) redirect = "/cars";
    else if (!isClient(role) && CLIENT_PREFIXES.some((p) => isUnder(pathname, p))) redirect = "/admin/cars";
  }

  useEffect(() => {
    if (redirect) router.replace(redirect);
  }, [redirect, router]);

  useEffect(() => settleNavigation(pathname), [pathname]);

  if (!ready || !authed) return null;

  return (
    <div className="app" id="app">
      <Sidebar />
      <main id="main" tabIndex={-1}>
        {redirect ? null : children}
      </main>
    </div>
  );
}
