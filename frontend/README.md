# Green Angle — фронтенд

Личный кабинет HUATECH: лендинг, кабинеты компании по привозу и физ.лица, Супер ЛК менеджера.
Работает с API из `../backend`. Дизайн живёт в `src/styles` (источник правды — эти файлы).

## Стек

Next.js 16 (App Router, `src/`), React 19, TypeScript, SCSS (`sass`), TanStack Query, Socket.IO, ESLint, Vitest.
Пакетный менеджер — pnpm.

## Команды

```bash
pnpm install
cp .env.example .env.local   # NEXT_PUBLIC_API_URL — адрес API с префиксом /api/v1
pnpm dev                     # http://localhost:3000 (API — http://localhost:4000)
pnpm build && pnpm start
pnpm lint
pnpm test                    # Vitest: клиент API, загрузка файлов, realtime, форматирование
pnpm gen:api                 # обновить src/lib/api/schema.d.ts по запущенному API (localhost:4000)
```

Docker-образ — `Dockerfile` (standalone-сборка). `NEXT_PUBLIC_API_URL` вшивается при сборке: `--build-arg NEXT_PUBLIC_API_URL=https://api.example.com/api/v1`.

## Структура

```
public/sw.js              service worker: показывает push и открывает диалог по клику
src/
  app/                    маршруты
    page.tsx              главная (лендинг; вошедший пользователь уходит в свой кабинет)
    verify-email/         подтверждение почты по ссылке из письма
    (cabinet)/            каркас кабинета (меню слева + main), доступ только после входа
      cars, cars/[id]               клиент: машины
      requests, requests/[id]       клиент: заявки и диалог
      admin/cars, admin/cars/[id]   Супер ЛК: все машины, смена статуса
      admin/requests, admin/requests/[id]  Супер ЛК: очередь заявок и диалог
  components/
    ui/                   Icon, Badge, Progress, Chip, Seg, Field (+ useForm), Modal, Toast, QueryState
    modals/               вход, регистрация, «проверьте почту», новая заявка, добавление машины
    landing/              секции лендинга
    cabinet/              меню, списки, карточки, диалог, форма смены статуса, Realtime
  lib/
    api/                  client.ts (fetch + обновление токена), tokens.ts, queries.ts (TanStack Query),
                          uploads.ts (загрузка файлов), schema.d.ts (типы из OpenAPI, генерируется)
    session.ts            сессия: токены + профиль GET /me, вход, выход
    realtime.ts           Socket.IO: события помечают данные устаревшими
    push.ts               подписка браузера на push
    store.ts              только состояние интерфейса (фильтры, окно, уведомление)
    attachments.ts, format.ts, constants.ts, nav.tsx, hooks.ts
  styles/
    tokens.scss           дизайн-токены, светлая и тёмная тема
    app.scss              стили
```

## Данные и состояние

- Данные — на сервере. Кэш и перезапросы — TanStack Query; в `store.ts` только то, что относится к экрану
  (фильтры, поиск, открытое окно, уведомление).
- Токены (access и refresh) лежат в `localStorage`: API работает по CORS без cookie. Клиент (`api/client.ts`) при 401
  один раз обновляет пару (один запрос на все параллельные вызовы, refresh-токен одноразовый) и повторяет запрос;
  если обновить не удалось — сессия заканчивается и открывается главная.
- Роль и клиента определяет сервер (`GET /me`), а не браузер; права и перенаправления строятся по ней.
- Живые обновления: соединение Socket.IO держит `components/cabinet/Realtime.tsx`. Событие только помечает нужные
  запросы устаревшими, данные перечитываются из API; после каждого подключения перечитывается всё.
- Файлы грузятся напрямую: подписанная ссылка от API (`POST /uploads/presign`), затем `PUT`; ключ регистрируется в сообщении
  или в смене статуса. Ссылки на скачивание могут быть относительными к адресу API (`resolveApiUrl`).

## Маршруты и доступ

Гость видит лендинг на любом адресе и не попадает в кабинет; клиент не попадает в `/admin/*`, Супер ЛК — в `/cars` и
`/requests` (уводит на стартовый раздел роли); чужая машина или заявка у клиента ведёт обратно в список (сервер отвечает 404,
существование чужих записей не раскрывается).

## Пока не подключено

Удаление машины, публичная проверка этапа по VIN на главной, восстановление пароля, голосовые сообщения (в макете нет экрана)
показывают «пока недоступно» или отсутствуют — см. бэклог в `../PLAN.md`.
