# Green Angle — личный кабинет для перегона авто из Китая

Платформа вместо переписки и таблиц. Три роли с одинаковой структурой экранов:

| Роль | Кто | Что делает |
| --- | --- | --- |
| `BROKER` | Юрлицо-подборщик (один логин на компанию) | Видит машины под своих клиентов, подаёт заявки на подбор, ведёт диалог по заявке |
| `INDIVIDUAL` | Физлицо | То же, но на одного человека; данные изолированы от компаний |
| `ADMIN` | Сотрудники компании | Видит всё: заводит машины и клиентов, двигает статусы (13 шагов), отвечает на заявки и одобряет их |

Подробный план, принятые решения и итоги каждого этапа — в [PLAN.md](PLAN.md). Правила работы над проектом — в [CLAUDE.md](CLAUDE.md).

## Стек

Node.js 24 LTS · NestJS 12 (Fastify, ESM) · TypeScript 6 · PostgreSQL 16 + Prisma 7 · Redis 7 (общие счётчики rate limit) · S3-совместимое хранилище (MinIO локально, Yandex Object Storage / Selectel в проде) · ffprobe (проверка длительности голосовых) · Socket.IO · JWT (access 15 мин + refresh 30 дней с ротацией), пароли — argon2id · Vitest · ESLint + Prettier · Docker Compose · Caddy (HTTPS) · GitHub Actions.

## Структура репозитория

```
backend/                  NestJS API (pnpm, свой package.json и lock-файл)
  prisma/                 схема БД, миграции, seed, create-admin
  src/                    модули: auth, users, clients, vehicles, requests, messages,
                          storage, uploads, realtime, rate-limit, health, config
  test/                   e2e-тесты на реальных Postgres и S3
frontend/                 Next.js — кабинет и лендинг (пока без связки с API)
deploy/                   Caddyfile, скрипты резервного копирования и восстановления
docker-compose.yml        разработка: Postgres + MinIO + миграции + API
docker-compose.prod.yml   боевой запуск: Caddy + API + Postgres + миграции + бэкапы
```

## Быстрый старт (разработка)

Нужны: Node.js ≥ 22.22 (рекомендуется 24 LTS), pnpm 11, Docker.

### Всё в контейнерах

```bash
docker compose up -d --build        # Postgres, Redis, MinIO, миграции, API на :3000
```

### API на хосте с горячей перезагрузкой

```bash
docker compose up -d postgres redis minio
cd backend
cp .env.example .env                # значения по умолчанию подходят для локальной работы
                                    # (для проверки длительности голосовых укажите FFPROBE_PATH, см. ниже)
pnpm install
pnpm prisma generate                # клиент Prisma → src/generated/prisma
pnpm prisma migrate deploy          # применить миграции
pnpm prisma db seed                 # демо-данные (только для разработки!)
pnpm start:dev
```

- API: `http://localhost:3000/api/v1`
- Swagger (OpenAPI): `http://localhost:3000/api/docs` — по нему фронт генерирует типизированный клиент
- Проверка: `GET /api/v1/health` (живость), `GET /api/v1/health/ready` (база и S3)
- MinIO-консоль: `http://localhost:9001` (`minio` / `minio12345`)

Демо-пользователи после `db seed` (пароли можно переопределить `SEED_*_PASSWORD`):

| Роль | Email | Пароль |
| --- | --- | --- |
| ADMIN | `admin@greenangle.local` | `admin12345` |
| BROKER (ООО АвтоПодбор Плюс) | `broker@autopodbor.local` | `broker12345` |
| INDIVIDUAL (Смирнов А. В.) | `smirnov@example.local` | `individual12345` |

## Тесты

```bash
docker compose up -d postgres redis minio   # e2e работают с реальными БД, Redis и S3
cd backend
pnpm lint
pnpm build
pnpm test                               # unit
pnpm test:e2e                           # интеграционные: HTTP, WebSocket, S3, БД
```

Тестовые данные создаются с уникальным суффиксом и удаляются после прогона. Если S3 или Redis недоступны, их тесты локально пропускаются; в CI (`CI=true`) недоступность считается ошибкой. Для проверки голосовых тесты используют бинарники ffmpeg/ffprobe из devDependencies, ставить их в систему не нужно. CI (`.github/workflows/ci.yml`) поднимает Postgres, Redis и MinIO, гоняет линт, сборку и все тесты, а также собирает боевые Docker-образы.

## API в двух словах

Префикс `/api/v1`. Полная схема — в Swagger.

- **Авторизация:** `POST /auth/login`, `/auth/refresh`, `/auth/logout`, `GET /me`. Публичной регистрации нет — аккаунты создаёт админ.
- **Клиент:** `GET /vehicles`, `GET /vehicles/:id` (13 шагов, вложения), `GET/POST /requests`, `GET /requests/:id`, диалог `GET/POST /requests/:id/messages` (текст, ссылки, фото/видео/файлы, голосовые), `POST /requests/:id/read`, `GET /requests/unread-count`.
- **Файлы:** `POST /uploads/presign` и `POST /requests/:id/voice-upload-url` выдают presigned PUT — файлы идут в S3 напрямую, минуя API.
- **Супер ЛК (только ADMIN):** `/admin/vehicles` (создание, VIN, смена статуса, вложения шагов), `/admin/requests` (очередь, `POST …/approve`), `/admin/clients`, `/admin/users` (создание логинов, деактивация, сброс пароля).
- **Realtime (Socket.IO, тот же порт):** подключение с `auth: { token: <access JWT> }`; события `message.created` (после `request.join {requestId}`), `request.updated`, `vehicle.status_changed`.

Данные клиентов изолированы по `clientId`: подборщик и физлицо видят только своё, чужая запись отвечает 404. Каждая смена статуса машины пишется в неизменяемый журнал `VehicleStatusLog` (кто, когда, с какого шага на какой); наружу журнал пока не отдаётся.

## Настройки (переменные окружения)

Полный список с комментариями — `backend/.env.example`. Приложение проверяет их при старте и не запустится с неверными значениями.

| Переменная | По умолчанию | Назначение |
| --- | --- | --- |
| `NODE_ENV` | `development` | В `production` запрещены заглушки секретов (`change-me*`, `minio12345`) |
| `PORT` | `3000` | Порт API |
| `LOG_LEVEL` | `info` | `fatal` … `trace` |
| `TRUST_PROXY` | `false` | `true` за Caddy/nginx — IP клиента берётся из `X-Forwarded-For` |
| `SWAGGER_ENABLED` | вкл., кроме production | Документация на `/api/docs` |
| `DATABASE_URL` | — | Строка подключения PostgreSQL |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | — | Разные, ≥ 16 символов |
| `JWT_ACCESS_TTL_SEC`, `JWT_REFRESH_TTL_SEC` | `900`, `2592000` | Время жизни токенов |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` | — | S3-хранилище; бакет создаётся при старте, если его нет |
| `S3_PUBLIC_ENDPOINT` | = `S3_ENDPOINT` | Адрес S3 в presigned URL для браузера |
| `S3_PRESIGN_PUT_TTL_SEC`, `S3_PRESIGN_GET_TTL_SEC` | `900`, `3600` | Срок жизни ссылок загрузки / скачивания |
| `STRICT_ATTACHMENTS` | `false` | `true` — нельзя пройти шаг без ожидаемого вложения |
| `REDIS_URL` | пусто | `redis://host:6379`. Общие счётчики rate limit между экземплярами API; пусто — счётчики в памяти процесса. **Обязателен в production** |
| `FFPROBE_PATH` | пусто | Путь к ffprobe: длительность голосовых и лимит 5 минут проверяются по самому файлу; пусто — проверка выключена. **Обязателен в production** (в Docker-образе ffprobe уже есть, `FFPROBE_PATH=ffprobe`) |
| `CORS_ORIGINS` | пусто | Разрешённые Origin через запятую для CORS и Socket.IO; пусто — кросс-доменные запросы запрещены |
| `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_SEC` | `600`, `60` | Общий лимит запросов на IP |
| `RATE_LIMIT_LOGIN_ACCOUNT_MAX` | `5` | Попыток входа на связку IP + email за окно |
| `RATE_LIMIT_LOGIN_IP_MAX` | `30` | Попыток входа с одного IP за окно |
| `RATE_LIMIT_LOGIN_WINDOW_SEC` | `60` | Окно лимитов входа |

## Боевой запуск

Нужен сервер с Docker, домен с A-записью на сервер и внешнее S3-хранилище с заранее созданным бакетом.

```bash
cp .env.prod.example .env.prod      # заполнить: домен, пароль БД, секреты JWT, S3, CORS_ORIGINS
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

Что поднимается: **Caddy** (автоматический HTTPS, WebSocket) → **API** (не от root, healthcheck, с ffprobe) → **Postgres** и **Redis** (порты наружу не публикуются); отдельно **migrate** применяет миграции перед стартом API, а **backup** делает копии БД. Swagger в production выключен. Лимиты запросов считаются в общем Redis, поэтому API можно запускать в нескольких экземплярах (распределение трафика между ними настраивается на прокси; в `deploy/Caddyfile` сейчас один upstream).

Первого администратора создаёт отдельная команда (seed в production не используется — у него известные пароли):

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod run --rm \
  -e ADMIN_EMAIL=boss@company.ru -e ADMIN_PASSWORD='пароль не короче 12 символов' \
  migrate pnpm create-admin
```

Остальные аккаунты (подборщики, физлица, сотрудники) админ заводит через `POST /admin/users`.

Обновление версии: `git pull`, затем та же команда `up -d --build` — миграции применятся автоматически.

## Резервные копии и восстановление

Сервис `backup` раз в сутки (`BACKUP_INTERVAL_SEC`) делает `pg_dump` в `./backups/`, проверяет, что архив читается, и удаляет копии старше `BACKUP_KEEP_DAYS` (14). Копия — это сжатый архив формата `custom`, в нём данные, ограничения и триггеры.

> Копии лежат на том же сервере. Настройте регулярную выгрузку `./backups/` в другое место (другой сервер, облачное хранилище) — иначе при потере диска пропадут и база, и копии. Файлы клиентов (фото, видео, голосовые) лежат в S3 и копируются средствами провайдера (включите версионирование бакета).

Разовая копия вручную:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod exec backup /bin/sh /scripts/backup.sh once
```

Восстановление — **перезаписывает** данные в базе, поэтому требует явного `CONFIRM=yes`. Сначала проверьте копию на пустой временной базе:

```bash
P="docker compose -f docker-compose.prod.yml --env-file .env.prod"
$P exec postgres psql -U green -d postgres -c 'CREATE DATABASE restore_check'
$P exec -e PGDATABASE=restore_check -e CONFIRM=yes backup \
   /bin/sh /scripts/restore.sh /backups/green_angle_<дата>.dump
$P exec postgres psql -U green -d restore_check -c 'SELECT count(*) FROM "User"'
$P exec postgres psql -U green -d postgres -c 'DROP DATABASE restore_check'
```

Для настоящего восстановления остановите API (`$P stop api`), выполните ту же команду `restore.sh` с `-e PGDATABASE=green_angle`, затем `$P start api`.

## Безопасность

- Пароли — argon2id; access-токен короткий, refresh — с ротацией: повторное использование старого токена отзывает всю цепочку. Деактивация пользователя действует сразу (роль, клиент и `isActive` берутся из БД на каждый запрос; refresh-токены отзываются, сокеты закрываются).
- Ограничение частоты запросов: отдельные лимиты на вход (по связке IP + email и по IP) и общий потолок на IP; ответ `429` с заголовком `Retry-After`. Счётчики общие для всех экземпляров API (Redis, скользящее окно, атомарный Lua-скрипт); в Redis ключи хэшированы, адресов и email там нет. Если Redis недоступен, API не падает: счёт временно идёт в памяти процесса, `GET /health/ready` показывает `degraded`.
- Голосовые проверяются по самому файлу (ffprobe): реальная длительность, лимит 5 минут по факту, только аудиодорожки; формат разбирается принудительно по заявленному mime, а сетевые протоколы запрещены — через «аудиофайл» нельзя заставить сервер читать свои файлы или ходить по URL.
- Заголовки безопасности (helmet), CORS по белому списку (без `*` и без cookie), лимит тела запроса 1 МБ, валидация и обрезка лишних полей во всех входных данных.
- Файлы не проходят через API: presigned URL фиксирует тип и размер, а метаданные вложений берутся из самого хранилища.
- Логи — одна JSON-строка на запрос (метод, путь без query, статус, время, пользователь, `requestId`); заголовки, тела запросов и токены не пишутся. Тот же `X-Request-Id` возвращается в ответе.
- Секреты только в окружении; в production заглушки секретов блокируются при старте.
