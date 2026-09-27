#!/usr/bin/env bash
# Восстановление дампа (формат custom, из dump_db.sh) в базу PostgreSQL в
# docker-контейнере — локально или на сервере по SSH. Файл передаётся через
# stdin: копировать его на сервер или в каталог данных Postgres не нужно.
#
#   ./restore_dump_db.sh --container wg-admin-postgres-1 --user postgres --db postgres \
#     --file ./prod.dump
#   ./restore_dump_db.sh --host root@203.0.113.10 --container app-postgres-1 --user postgres \
#     --db postgres
#
# Параметры (или переменные окружения):
#   --host       SSH-адрес сервера; пусто — локальный docker          (DB_HOST)
#   --container  контейнер Postgres                                     (DB_CONTAINER)
#   --user       пользователь Postgres                                  (DB_USER)
#   --db         целевая база; заменяется целиком, нет — создаётся    (DB_NAME)
#   --file       дамп; по умолчанию — самый свежий ./db_backup_*.dump  (DB_DUMP_FILE)
#   --yes        не спрашивать подтверждение
#
# Дамп сначала восстанавливается во временную базу <db>__restore. Только если
# это удалось, целевая база удаляется (подключения к ней рвутся) и временная
# получает её имя — при ошибке целевая база не меняется. Владелец и права не
# переносятся: всё принадлежит --user.
set -euo pipefail

HOST="${DB_HOST:-}"
CONTAINER="${DB_CONTAINER:-}"
PG_USER="${DB_USER:-}"
PG_DB="${DB_NAME:-}"
FILE="${DB_DUMP_FILE:-}"
YES=0

usage() { sed -n '2,23p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --host) HOST="$2"; shift 2 ;;
    --container) CONTAINER="$2"; shift 2 ;;
    --user) PG_USER="$2"; shift 2 ;;
    --db) PG_DB="$2"; shift 2 ;;
    --file) FILE="$2"; shift 2 ;;
    --yes|-y) YES=1; shift ;;
    -h|--help) usage ;;
    *) echo "Неизвестный параметр: $1" >&2; usage 1 ;;
  esac
done

if [ -z "$CONTAINER" ] || [ -z "$PG_USER" ] || [ -z "$PG_DB" ]; then
  echo "Нужны --container, --user и --db" >&2
  usage 1
fi

if [ -z "$FILE" ]; then
  # Самый свежий дамп: имена файлов — из dump_db.sh, без пробелов.
  # shellcheck disable=SC2012
  FILE=$(ls -t ./db_backup_*.dump 2>/dev/null | head -n 1 || true)
fi
if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
  echo "Файл дампа не найден: ${FILE:-./db_backup_*.dump}" >&2
  exit 1
fi

in_container() {
  if [ -n "$HOST" ]; then
    # ssh склеивает аргументы в строку для оболочки сервера — экранируем их.
    # shellcheck disable=SC2029 # экранированная строка собирается на клиенте намеренно
    ssh "$HOST" "$(printf '%q ' docker exec -i "$CONTAINER" "$@")"
  else
    docker exec -i "$CONTAINER" "$@"
  fi
}

# Служебные запросы — из базы postgres: к целевой подключаться нельзя, её удаляют.
admin_sql() {
  in_container psql -U "$PG_USER" -d postgres -v ON_ERROR_STOP=1 -qAt \
    -c "SET client_min_messages = warning" -c "$1"
}

TARGET="${PG_DB} в ${CONTAINER}${HOST:+ на $HOST}"
TMP_DB="${PG_DB}__restore"

if [ "$YES" != 1 ]; then
  printf 'Дамп %s → %s (база будет заменена целиком). Продолжить? [y/N] ' "$FILE" "$TARGET"
  read -r answer
  case "$answer" in y|Y|yes|д|Д|да) ;; *) echo "Отменено"; exit 1 ;; esac
fi

admin_sql "DROP DATABASE IF EXISTS \"${TMP_DB}\""
admin_sql "CREATE DATABASE \"${TMP_DB}\""

echo "Восстанавливаю ${FILE} во временную ${TMP_DB}"
if ! in_container pg_restore -U "$PG_USER" -d "$TMP_DB" \
  --no-owner --no-privileges --single-transaction --exit-on-error < "$FILE"; then
  admin_sql "DROP DATABASE IF EXISTS \"${TMP_DB}\""
  echo "Ошибка восстановления — ${PG_DB} не изменена" >&2
  exit 1
fi

echo "Заменяю ${PG_DB} (подключения к ней будут разорваны)"
admin_sql "DROP DATABASE IF EXISTS \"${PG_DB}\" WITH (FORCE)"
admin_sql "ALTER DATABASE \"${TMP_DB}\" RENAME TO \"${PG_DB}\""

TABLES=$(in_container psql -U "$PG_USER" -d "$PG_DB" -qAtc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'")
echo "Готово: таблиц в public — $TABLES"
