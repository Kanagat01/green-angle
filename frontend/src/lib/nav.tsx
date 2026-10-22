"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useRole } from "./session";
import { closeModal } from "./store";
import type { Role } from "./types";

export type Route = "cars" | "car" | "requests" | "request" | "scars" | "scar" | "sreqs";

export function routePath(route: Route, id: string | undefined, role: Role): string {
  switch (route) {
    case "cars":
      return "/cars";
    case "car":
      return `/cars/${id}`;
    case "requests":
      return "/requests";
    case "request":
      return role === "super" ? `/admin/requests/${id}` : `/requests/${id}`;
    case "scars":
      return "/admin/cars";
    case "scar":
      return `/admin/cars/${id}`;
    case "sreqs":
      return "/admin/requests";
  }
}

export const defaultRoute = (role: Role): Route => (role === "super" ? "scars" : "cars");

/** После перехода: закрыть окно, прокрутить вверх, вернуть фокус на основное содержимое. */
function afterNavigate() {
  closeModal();
  window.scrollTo(0, 0);
  setTimeout(() => document.getElementById("main")?.focus({ preventScroll: true }), 0);
}

export function useGo() {
  const router = useRouter();
  const role = useRole() ?? "picker";
  return (route: Route, id?: string) => {
    router.push(routePath(route, id, role));
    afterNavigate();
  };
}

/** Если условие выполнено, уводит на другой раздел (замена ui.route в render() прототипа). */
export function useRedirectWhen(when: boolean, path: string) {
  const router = useRouter();
  useEffect(() => {
    if (when) router.replace(path);
  }, [when, path, router]);
}

export function NavLink({
  route,
  id,
  className,
  current,
  ariaRole,
  children,
}: {
  route: Route;
  id?: string;
  className?: string;
  current?: boolean;
  ariaRole?: string;
  children: ReactNode;
}) {
  const role = useRole() ?? "picker";
  return (
    <Link
      href={routePath(route, id, role)}
      className={className}
      role={ariaRole}
      aria-current={current ? "page" : undefined}
      onClick={afterNavigate}
    >
      {children}
    </Link>
  );
}
