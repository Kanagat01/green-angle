#!/bin/sh
# Резервное копирование Postgres: pg_dump в сжатом custom-формате.
#
#   backup.sh        — бесконечный цикл: копия раз в BACKUP_INTERVAL_SEC (по умолчанию сутки)
#   backup.sh once   — одна копия и выход (для cron / ручного запуска)
#
# Параметры подключения — стандартные переменные libpq: PGHOST, PGUSER, PGPASSWORD, PGDATABASE.
set -eu

: "${PGHOST:?PGHOST is required}"
: "${PGUSER:?PGUSER is required}"
: "${PGPASSWORD:?PGPASSWORD is required}"
: "${PGDATABASE:?PGDATABASE is required}"

BACKUP_DIR="${BACKUP_DIR:-/backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
INTERVAL="${BACKUP_INTERVAL_SEC:-86400}"

mkdir -p "$BACKUP_DIR"

backup_once() {
  ts="$(date -u +%Y%m%dT%H%M%SZ)"
  tmp="$BACKUP_DIR/.tmp_${PGDATABASE}_$ts.dump"
  out="$BACKUP_DIR/${PGDATABASE}_$ts.dump"

  # Пишем во временный файл, чтобы оборванная копия не выглядела готовой
  if ! pg_dump --format=custom --no-owner --file="$tmp"; then
    rm -f "$tmp"
    echo "backup FAILED: pg_dump error" >&2
    return 1
  fi
  # Архив должен читаться: пустой или битый файл — это не резервная копия
  if ! pg_restore --list "$tmp" > /dev/null; then
    rm -f "$tmp"
    echo "backup FAILED: archive is not readable" >&2
    return 1
  fi
  mv "$tmp" "$out"

  # Ротация: удаляем копии старше KEEP_DAYS суток (только готовые файлы этой базы)
  find "$BACKUP_DIR" -maxdepth 1 -name "${PGDATABASE}_*.dump" -mtime +"$KEEP_DAYS" -delete

  echo "backup ok: $out ($(wc -c < "$out") bytes)"
}

if [ "${1:-loop}" = "once" ]; then
  backup_once
  exit $?
fi

while true; do
  backup_once || true
  sleep "$INTERVAL"
done
