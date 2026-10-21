#!/bin/sh
# Резервное копирование Postgres: pg_dump в сжатом custom-формате.
#
#   backup.sh        — бесконечный цикл: копия раз в BACKUP_INTERVAL_SEC (по умолчанию сутки)
#   backup.sh once   — одна копия и выход (для cron / ручного запуска)
#
# Параметры подключения — стандартные переменные libpq: PGHOST, PGUSER, PGPASSWORD, PGDATABASE.
#
# Если задан UPLOADS_DIR (каталог с файлами клиентов, драйвер disk) и BACKUP_UPLOADS не равен false,
# рядом с дампом базы кладётся архив uploads_<время>.tar.gz. Это полная копия: для больших объёмов
# файлов используйте снимки диска или инкрементальные средства сервера.
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

  if [ -n "${UPLOADS_DIR:-}" ] && [ "${BACKUP_UPLOADS:-true}" != "false" ]; then
    uploads_out="$BACKUP_DIR/uploads_$ts.tar.gz"
    uploads_tmp="$BACKUP_DIR/.tmp_uploads_$ts.tar.gz"
    # Архив читается и содержит каталог целиком; оборванная копия не остаётся
    if ! tar -czf "$uploads_tmp" -C "$UPLOADS_DIR" . || ! tar -tzf "$uploads_tmp" > /dev/null; then
      rm -f "$uploads_tmp"
      echo "backup FAILED: uploads archive error (database dump $out is kept)" >&2
      return 1
    fi
    mv "$uploads_tmp" "$uploads_out"
    find "$BACKUP_DIR" -maxdepth 1 -name "uploads_*.tar.gz" -mtime +"$KEEP_DAYS" -delete
    echo "backup ok: $uploads_out ($(wc -c < "$uploads_out") bytes)"
  fi

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
