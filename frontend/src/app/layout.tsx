import type { Metadata, Viewport } from "next";
import { ModalHost } from "@/components/modals/ModalHost";
import { StoreHydrator } from "@/components/StoreHydrator";
import { Toast } from "@/components/ui/Toast";
import "@/styles/tokens.scss";
import "@/styles/app.scss";

export const metadata: Metadata = {
  title: "HUATECH ЛК",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ru">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* Шрифты подключены так же, как в макете; правило относится к pages router, а этот layout общий для всех страниц */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap"
        />
      </head>
      <body>
        <StoreHydrator />
        {children}
        <ModalHost />
        <Toast />
      </body>
    </html>
  );
}
