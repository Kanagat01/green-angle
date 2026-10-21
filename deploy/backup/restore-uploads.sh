#!/bin/sh
# Восстановление каталога с файлами клиентов из архива, сделанного backup.sh.
#
#   CONFIRM=yes UPLOADS_DIR=/data/uploads restore-uploads.sh /backups/uploads_20261019T030000Z.tar.gz
#
# ВНИМАНИЕ: содержимое UPLOADS_DIR ЗАМЕНЯЕТСЯ содержимым архива (лишние файлы удаляются).
# Для проверки копии распакуйте в другой каталог: UPLOADS_DIR=/tmp/uploads_check.
set -eu

FILE="${1:?usage: CONFIRM=yes UPLOADS_DIR=<dir> restore-uploads.sh <uploads.tar.gz>}"
: "${UPLOADS_DIR:?UPLOADS_DIR is required}"

if [ ! -r "$FILE" ]; then
  echo "restore FAILED: cannot read $FILE" >&2
  exit 1
fi
if ! tar -tzf "$FILE" > /dev/null; then
  echo "restore FAILED: $FILE is not a readable archive" >&2
  exit 1
fi
if [ "${CONFIRM:-}" != "yes" ]; then
  echo "This will REPLACE the contents of '$UPLOADS_DIR' with $FILE." >&2
  echo "Re-run with CONFIRM=yes to proceed." >&2
  exit 1
fi

mkdir -p "$UPLOADS_DIR"
# Каталог (том) не удаляем — только его содержимое
find "$UPLOADS_DIR" -mindepth 1 -delete
tar -xzf "$FILE" -C "$UPLOADS_DIR"
echo "restore ok: $FILE -> $UPLOADS_DIR"
