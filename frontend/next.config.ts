import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cache Components (и связанный с ним partialPrefetching) здесь отключены: все данные пока
  // клиентские (localStorage), серверного кэширования нет, а Activity сохраняла бы в DOM
  // предыдущие страницы, чего в макете нет — каждый экран там перерисовывается с нуля.
  cacheComponents: false,
  partialPrefetching: false,
};

export default nextConfig;
