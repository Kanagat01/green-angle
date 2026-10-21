# Green Angle — личный кабинет для перегона авто из Китая

Платформа вместо переписки и таблиц. Три роли с одинаковой структурой экранов:

| Роль | Кто | Что делает |
| --- | --- | --- |
| `BROKER` | Юрлицо-подборщик (один логин на компанию) | Видит машины под своих клиентов, подаёт заявки на подбор, ведёт диалог по заявке |
| `INDIVIDUAL` | Физлицо | То же, но на одного человека; данные изолированы от компаний |
| `ADMIN` | Сотрудники компании | Видит всё: заводит машины и клиентов, двигает статусы (13 шагов), отвечает на заявки и одобряет их |

Подробный план, принятые решения и итоги каждого этапа — в [PLAN.md](PLAN.md). Правила работы над проектом — в [CLAUDE.md](CLAUDE.md).

## Стек

Node.js 24 LTS · NestJS 12 (Fastify, ESM) · TypeScript 6 · PostgreSQL 16 + Prisma 7 · Redis 7 (общие счётчики rate limit) · хранилище файлов: диск сервера или S3-совместимое (сменный драйвер) · ffprobe (проверка длительности голосовых) · Socket.IO · JWT (access 15 мин + refresh 30 дней с ротацией), пароли — argon2id · Vitest · ESLint + Prettier · Docker Compose · Caddy (HTTPS) · GitHub Actions.

## Структура репозитория

```
backend/                  NestJS API (pnpm, свой package.json и lock-файл)
  prisma/                 схема БД, миграции, seed, create-admin
  src/                    модули: auth, users, clients, vehicles, requests, messages,
                          storage, uploads, realtime, rate-limit, health, config
  test/                   e2e-тесты на реальных Postgres и хранилище файлов
frontend/                 Next.js — кабинет и лендинг (пока без связки с API)
deploy/                   Caddyfile, скрипты резервного копирования и восстановления
docker-compose.yml        разработка: Postgres + Redis + миграции + API (MinIO — профилем s3)
docker-compose.prod.yml   боевой запуск: Caddy + API + Postgres + миграции + бэкапы
```

## Быстрый старт (разработка)

Нужны: Node.js ≥ 22.22 (рекомендуется 24 LTS), pnpm 11, Docker.

### Всё в контейнерах

```bash
docker compose up -d --build        # Postgres, Redis, миграции, API на :3000 (файлы — в томе uploads)
```

Драйвер S3 вместо диска: `docker compose --profile s3 up -d` и `STORAGE_DRIVER=s3` у API.

### API на хосте с горячей перезагрузкой

```bash
docker compose up -d postgres redis
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
- Проверка: `GET /api/v1/health` (живость), `GET /api/v1/health/ready` (база, хранилище файлов, Redis)
- Загруженные файлы при локальном запуске лежат в `backend/data/uploads` (`UPLOAD_DIR`); при драйвере S3 консоль MinIO — `http://localhost:9001` (`minio` / `minio12345`)

Демо-пользователи после `db seed` (пароли можно переопределить `SEED_*_PASSWORD`):

| Роль | Email | Пароль |
| --- | --- | --- |
| ADMIN | `admin@greenangle.local` | `admin12345` |
| BROKER (ООО АвтоПодбор Плюс) | `broker@autopodbor.local` | `broker12345` |
| INDIVIDUAL (Смирнов А. В.) | `smirnov@example.local` | `individual12345` |

## Тесты

```bash
docker compose up -d postgres redis         # e2e работают с реальными БД и Redis
cd backend
pnpm lint
pnpm build
pnpm test                               # unit
pnpm test:e2e                           # интеграционные: HTTP, WebSocket, файлы на диске, БД
STORAGE_DRIVER=s3 pnpm test:e2e         # то же на драйвере S3 (нужен MinIO: docker compose --profile s3 up -d minio)
```

Тестовые данные создаются с уникальным суффиксом и удаляются после прогона; файлы в тестах лежат во временном каталоге. Если Redis недоступен, его тесты локально пропускаются; в CI (`CI=true`) недоступность считается ошибкой. Для проверки голосовых тесты используют бинарники ffmpeg/ffprobe из devDependencies, ставить их в систему не нужно. CI (`.github/workflows/ci.yml`) поднимает Postgres, Redis и MinIO, гоняет линт, сборку и все тесты (в том числе контракт хранилища на драйвере S3), а также собирает боевые Docker-образы.

## API в двух словах

Префикс `/api/v1`. Полная схема — в Swagger.

- **Авторизация:** `POST /auth/login`, `/auth/refresh`, `/auth/logout`, `GET /me`. Вход — по email и паролю. Самостоятельная регистрация: `POST /auth/register` (тип кабинета `COMPANY`/`PERSON`, название или ФИО, ИНН для компании, телефон, email, пароль, согласие) создаёт закрытый аккаунт и шлёт письмо со ссылкой; `POST /auth/verify-email {token}` открывает вход, `POST /auth/resend-verification {email}` присылает ссылку заново. До подтверждения вход отвечает 403 с `code: EMAIL_NOT_VERIFIED`. Аккаунты сотрудников и аккаунты, созданные менеджером через `/admin/users`, подтверждены сразу.
- **Клиент:** `GET /vehicles` (поиск `search`, `state=active|ready`, счётчики `counts`), `GET /vehicles/:id` (13 шагов, вложения, `requestId`, `updatedAt`), `GET/POST /requests` (создание сразу пишет первое сообщение; у заявок `awaitingReply` и `lastMessage`), `GET /requests/:id`, диалог `GET/POST /requests/:id/messages` (текст, ссылки, фото/видео/файлы, голосовые; сервер сам добавляет служебные строки `type: SYSTEM` без автора — об одобрении, отклонении и смене статуса машины), `POST /requests/:id/read`, `GET /requests/unread-count`.
- **Файлы:** `POST /uploads/presign` и `POST /requests/:id/voice-upload-url` выдают подписанную ссылку на загрузку: клиент отправляет файл `PUT` по ней (с указанными `headers`), затем регистрирует `key` в сообщении или шаге. Скачивание — по короткоживущей ссылке `attachments[].url`. Протокол одинаков для обоих драйверов: при `STORAGE_DRIVER=disk` ссылки ведут на `/api/v1/files/upload|download` самого API (подписанные, без JWT; поддерживают `Range` для аудио и видео), при `s3` — прямо в S3. Ссылка может быть относительной (если `FILES_PUBLIC_URL` не задан) — разрешайте её относительно адреса API.
- **Супер ЛК (только ADMIN):** `/admin/vehicles` (создание, VIN, вложения шагов; `POST …/status` — смена статуса вместе с обязательным вложением шага и комментарием клиенту: `{step, declarationNumber?, attachments?[], comment?}`, откат назад без вложения), `/admin/requests` (очередь: ждущие ответа сверху, фильтр `awaiting`, счётчики `GET …/counts`; `POST …/approve`, `POST …/reject`; статусы заявки `NEW → IN_DIALOG → APPROVED | REJECTED`, в закрытой заявке диалог только для чтения), `/admin/clients`, `/admin/users` (создание логинов, деактивация, сброс пароля).
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
| `STORAGE_DRIVER` | `disk` | Где лежат файлы: `disk` (диск сервера) или `s3` |
| `UPLOAD_DIR` | `./data/uploads` | Каталог файлов (драйвер `disk`); в Docker — том `uploads`, его бэкапит сервис `backup` |
| `FILES_SIGNING_SECRET` | — | Секрет подписи ссылок, ≥ 16 символов (драйвер `disk`; в production заглушки `change-me*` запрещены) |
| `FILES_PUBLIC_URL` | пусто | Адрес API для браузера в ссылках на файлы (`https://api.example.com/api/v1`); пусто — относительные ссылки |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` | — | Драйвер `s3`; бакет создаётся при старте, если его нет |
| `S3_PUBLIC_ENDPOINT` | = `S3_ENDPOINT` | Адрес S3 в presigned URL для браузера |
| `UPLOAD_URL_TTL_SEC`, `DOWNLOAD_URL_TTL_SEC` | `900`, `3600` | Срок жизни ссылок загрузки / скачивания (оба драйвера) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` | пусто, `587` | Исходящая почта (подтверждение email, уведомления). Без `SMTP_HOST` письма пишутся только в лог API. **`SMTP_HOST` обязателен в production** |
| `MAIL_FROM` | `Green Angle <noreply@localhost>` | Отправитель писем |
| `APP_URL` | `http://localhost:3001` в разработке | Адрес фронтенда для ссылок в письмах. **Обязателен в production** |
| `EMAIL_VERIFICATION_TTL_HOURS` | `24` | Срок действия ссылки подтверждения |
| `REDIS_URL` | пусто | `redis://host:6379`. Общие счётчики rate limit между экземплярами API; пусто — счётчики в памяти процесса. **Обязателен в production** |
| `FFPROBE_PATH` | пусто | Путь к ffprobe: длительность голосовых и лимит 5 минут проверяются по самому файлу; пусто — проверка выключена. **Обязателен в production** (в Docker-образе ffprobe уже есть, `FFPROBE_PATH=ffprobe`) |
| `CORS_ORIGINS` | пусто | Разрешённые Origin через запятую для CORS и Socket.IO; пусто — кросс-доменные запросы запрещены |
| `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_SEC` | `600`, `60` | Общий лимит запросов на IP |
| `RATE_LIMIT_LOGIN_ACCOUNT_MAX` | `5` | Попыток входа на связку IP + email за окно |
| `RATE_LIMIT_LOGIN_IP_MAX` | `30` | Попыток входа с одного IP за окно |
| `RATE_LIMIT_LOGIN_WINDOW_SEC` | `60` | Окно лимитов входа |

## Боевой запуск

Нужен сервер с Docker и домен с A-записью на сервер. Файлы клиентов по умолчанию лежат на диске сервера (том `uploads`); вернуться на внешний S3 можно сменой `STORAGE_DRIVER=s3` и заполнением `S3_*` — API для клиентов не меняется.

```bash
cp .env.prod.example .env.prod      # заполнить: домен, пароль БД, секреты JWT и подписи файлов, CORS_ORIGINS
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

Сервис `backup` раз в сутки (`BACKUP_INTERVAL_SEC`) делает `pg_dump` в `./backups/`, проверяет, что архив читается, и удаляет копии старше `BACKUP_KEEP_DAYS` (14). Копия — это сжатый архив формата `custom`, в нём данные, ограничения и триггеры. Рядом кладётся архив `uploads_<время>.tar.gz` с файлами клиентов (фото, видео, голосовые); отключается `BACKUP_UPLOADS=false`, нужен только при драйвере `disk`.

> Копии лежат на том же сервере. Настройте регулярную выгрузку `./backups/` в другое место (другой сервер, облачное хранилище) — иначе при потере диска пропадут и база, и копии. Архив файлов каждый раз полный: при большом объёме (сотни ГБ) используйте снимки диска или инкрементальные средства сервера, а при драйвере `s3` файлы копируются средствами провайдера (включите версионирование бакета).

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

Файлы восстанавливаются отдельным скриптом; он **заменяет** содержимое каталога (нужен `CONFIRM=yes`). Том `uploads` в сервисе `backup` смонтирован только на чтение, поэтому восстановление запускается одноразовым контейнером с этим томом:

```bash
$P stop api
docker run --rm -v "$(pwd)/deploy/backup:/scripts:ro" -v "$(pwd)/backups:/backups:ro" \
  -v green-angle_uploads:/data/uploads -e UPLOADS_DIR=/data/uploads -e CONFIRM=yes \
  alpine /bin/sh /scripts/restore-uploads.sh /backups/uploads_<дата>.tar.gz
$P start api
```

(имя тома — `<папка проекта>_uploads`, проверьте `docker volume ls`.)

## Безопасность

- Пароли — argon2id; access-токен короткий, refresh — с ротацией: повторное использование старого токена отзывает всю цепочку. Деактивация пользователя действует сразу (роль, клиент и `isActive` берутся из БД на каждый запрос; refresh-токены отзываются, сокеты закрываются).
- Ограничение частоты запросов: отдельные лимиты на вход (по связке IP + email и по IP) и общий потолок на IP; ответ `429` с заголовком `Retry-After`. Счётчики общие для всех экземпляров API (Redis, скользящее окно, атомарный Lua-скрипт); в Redis ключи хэшированы, адресов и email там нет. Если Redis недоступен, API не падает: счёт временно идёт в памяти процесса, `GET /health/ready` показывает `degraded`.
- Голосовые проверяются по самому файлу (ffprobe): реальная длительность, лимит 5 минут по факту, только аудиодорожки; формат разбирается принудительно по заявленному mime, а сетевые протоколы запрещены — через «аудиофайл» нельзя заставить сервер читать свои файлы или ходить по URL.
- Заголовки безопасности (helmet), CORS по белому списку (без `*` и без cookie), лимит тела запроса 1 МБ, валидация и обрезка лишних полей во всех входных данных.
- Файлы не проходят через API: presigned URL фиксирует тип и размер, а метаданные вложений берутся из самого хранилища.
- Логи — одна JSON-строка на запрос (метод, путь без query, статус, время, пользователь, `requestId`); заголовки, тела запросов и токены не пишутся. Тот же `X-Request-Id` возвращается в ответе.
- Секреты только в окружении; в production заглушки секретов блокируются при старте.
