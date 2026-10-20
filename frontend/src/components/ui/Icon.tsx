import type { ReactNode } from "react";

type IconDef = { size: number; sw: number; join: boolean; paths: ReactNode };

const ICONS = {
  car: {
    size: 20, sw: 1.75, join: true,
    paths: (
      <>
        <path d="M5 17h14M3 13l2-6a2 2 0 0 1 1.9-1.4h10.2A2 2 0 0 1 19 7l2 6v4a1 1 0 0 1-1 1h-1M3 13v4a1 1 0 0 0 1 1h1M3 13h18" />
        <circle cx="7" cy="17" r="2" />
        <circle cx="17" cy="17" r="2" />
      </>
    ),
  },
  chat: { size: 20, sw: 1.75, join: true, paths: <path d="M21 12a8 8 0 0 1-11.8 7L4 20l1.2-4.4A8 8 0 1 1 21 12z" /> },
  back: { size: 18, sw: 2, join: true, paths: <path d="m15 18-6-6 6-6" /> },
  search: {
    size: 18, sw: 1.75, join: false,
    paths: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </>
    ),
  },
  close: { size: 14, sw: 2.5, join: false, paths: <path d="M6 6l12 12M18 6 6 18" /> },
  clip: {
    size: 20, sw: 1.75, join: true,
    paths: <path d="m21 11-8.5 8.5a5 5 0 0 1-7-7L14 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 7" />,
  },
  check: { size: 16, sw: 3, join: true, paths: <path d="M20 6 9 17l-5-5" /> },
  upload: { size: 22, sw: 1.75, join: true, paths: <path d="M12 16V4M6 10l6-6 6 6M4 20h16" /> },
  photo: {
    size: 14, sw: 2, join: true,
    paths: (
      <>
        <path d="M4 7h3l2-2h6l2 2h3v12H4z" />
        <circle cx="12" cy="13" r="4" />
      </>
    ),
  },
  file: { size: 14, sw: 2, join: true, paths: <path d="M14 3H6v18h12V7zM14 3v4h4M9 13h6M9 17h6" /> },
  video: { size: 14, sw: 2, join: true, paths: <path d="M3 6h12v12H3zM15 10l6-3v10l-6-3" /> },
  number: { size: 14, sw: 2, join: false, paths: <path d="M5 9h14M5 15h14M10 4 8 20M16 4l-2 16" /> },
  link: {
    size: 14, sw: 2, join: true,
    paths: (
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
    ),
  },
} satisfies Record<string, IconDef>;

export type IconName = keyof typeof ICONS;

export function Icon({ name }: { name: IconName }) {
  const d: IconDef = ICONS[name];
  return (
    <svg
      width={d.size}
      height={d.size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={d.sw}
      strokeLinecap="round"
      strokeLinejoin={d.join ? "round" : undefined}
      aria-hidden="true"
    >
      {d.paths}
    </svg>
  );
}

/** Иконки лендинга: без width/height, размер задаёт CSS контейнера. */
const LANDING_ICONS = {
  doc: { sw: 1.75, paths: <path d="M14 3H6v18h12V7zM14 3v4h4M9 13h6M9 17h6" /> },
  ok: { sw: 2, paths: <path d="M20 6 9 17l-5-5" /> },
  org: {
    sw: 1.75,
    paths: <path d="M4 21V5l8-2v18M12 9h8v12M3 21h18M7 8h2M7 12h2M7 16h2M15 13h2M15 17h2" />,
  },
  user: {
    sw: 1.75,
    paths: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21a8 8 0 0 1 16 0" />
      </>
    ),
  },
};

export function LandingIcon({ name }: { name: keyof typeof LANDING_ICONS }) {
  const d = LANDING_ICONS[name];
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={d.sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {d.paths}
    </svg>
  );
}
