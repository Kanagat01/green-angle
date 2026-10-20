"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { closeModal, enter, getState, logout, setRole, toast, useApp } from "./store";
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
  return (route: Route, id?: string) => {
    router.push(routePath(route, id, getState().role));
    afterNavigate();
  };
}

/** Вход в кабинет роли: открывает её стартовый раздел. */
export function useEnter() {
  const router = useRouter();
  return (role: Role, message?: string) => {
    enter(role);
    closeModal();
    router.push(routePath(defaultRoute(role), undefined, role));
    window.scrollTo(0, 0);
    if (message) toast(message);
  };
}

export function useLogout() {
  const router = useRouter();
  return () => {
    logout();
    closeModal();
    router.push("/");
    window.scrollTo(0, 0);
  };
}

/**
 * Раздел, куда нужно прийти после смены роли. Открытая страница с чужими для новой роли данными
 * успеет запросить свой редирект, но в макете побеждает стартовый раздел роли.
 */
let forcedPath: string | null = null;

export function settleNavigation(pathname: string) {
  if (forcedPath === pathname) forcedPath = null;
}

export function useSwitchRole() {
  const router = useRouter();
  return (role: Role) => {
    setRole(role);
    const target = routePath(defaultRoute(role), undefined, role);
    forcedPath = target === window.location.pathname ? null : target;
    router.push(target);
  };
}

/** Если условие выполнено, уводит на другой раздел (замена ui.route в render() прототипа). */
export function useRedirectWhen(when: boolean, path: string) {
  const router = useRouter();
  useEffect(() => {
    if (when) router.replace(forcedPath ?? path);
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
  const { role } = useApp();
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
