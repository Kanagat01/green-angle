import type { MouseEvent } from "react";

/** Плавная прокрутка к якорю на лендинге (без анимации при prefers-reduced-motion). */
export function scrollToAnchor(e: MouseEvent<HTMLAnchorElement>) {
  e.preventDefault();
  const target = document.getElementById(e.currentTarget.getAttribute("href")!.slice(1));
  target?.scrollIntoView({
    behavior: window.matchMedia("(prefers-reduced-motion:reduce)").matches ? "auto" : "smooth",
    block: "start",
  });
}
