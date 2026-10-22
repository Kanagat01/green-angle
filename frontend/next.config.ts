import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cache Components (и связанный с ним partialPrefetching) здесь отключены: данные клиентские
  // (TanStack Query в браузере), серверного кэширования нет, а Activity сохраняла бы в DOM
  // предыдущие страницы, чего в макете нет — каждый экран там перерисовывается с нуля.
  cacheComponents: false,
  partialPrefetching: false,
  // Самодостаточная сборка для Docker-образа (frontend/Dockerfile)
  output: "standalone",
};

export default nextConfig;
