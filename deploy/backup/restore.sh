#!/bin/sh
# Восстановление Postgres из копии, сделанной backup.sh.
#
#   CONFIRM=yes restore.sh /backups/green_angle_20261019T030000Z.dump
#
# ВНИМАНИЕ: восстановление ПЕРЕЗАПИСЫВАЕТ данные в базе PGDATABASE (удаляет таблицы и создаёт заново).
# Для проверки копии восстанавливайте в отдельную пустую базу: PGDATABASE=restore_check.
# Параметры подключения — стандартные переменные libpq: PGHOST, PGUSER, PGPASSWORD, PGDATABASE.
set -eu

FILE="${1:?usage: CONFIRM=yes restore.sh <backup.dump>}"
: "${PGHOST:?PGHOST is required}"
: "${PGUSER:?PGUSER is required}"
: "${PGPASSWORD:?PGPASSWORD is required}"
: "${PGDATABASE:?PGDATABASE is required}"

if [ ! -r "$FILE" ]; then
  echo "restore FAILED: cannot read $FILE" >&2
  exit 1
fi
if [ "${CONFIRM:-}" != "yes" ]; then
  echo "This will OVERWRITE database '$PGDATABASE' on '$PGHOST' with $FILE." >&2
  echo "Re-run with CONFIRM=yes to proceed." >&2
  exit 1
fi

# --clean --if-exists: безопасно и для пустой базы, и для существующей
pg_restore --clean --if-exists --no-owner --exit-on-error --dbname="$PGDATABASE" "$FILE"
echo "restore ok: $FILE -> $PGDATABASE"
