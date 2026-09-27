#!/usr/bin/env bash
# Дамп базы PostgreSQL из docker-контейнера (локально или на сервере по SSH)
# в файл формата custom (-Fc) — его читает restore_dump_db.sh.
#
#   ./dump_db.sh --container wg-admin-postgres-1 --user postgres --db postgres
#   ./dump_db.sh --host root@203.0.113.10 --container app-postgres-1 --user postgres --db postgres \
#     --out ./prod.dump
#
# Параметры (или переменные окружения):
#   --host       SSH-адрес сервера; пусто — локальный docker          (DB_HOST)
#   --container  контейнер Postgres                                     (DB_CONTAINER)
#   --user       пользователь Postgres                                  (DB_USER)
#   --db         база                                                   (DB_NAME)
#   --out        файл дампа; по умолчанию ./db_backup_<db>_<время>.dump (DB_DUMP_FILE)
set -euo pipefail

HOST="${DB_HOST:-}"
CONTAINER="${DB_CONTAINER:-}"
PG_USER="${DB_USER:-}"
PG_DB="${DB_NAME:-}"
OUT="${DB_DUMP_FILE:-}"

usage() { sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --host) HOST="$2"; shift 2 ;;
    --container) CONTAINER="$2"; shift 2 ;;
    --user) PG_USER="$2"; shift 2 ;;
    --db) PG_DB="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    -h|--help) usage ;;
    *) echo "Неизвестный параметр: $1" >&2; usage 1 ;;
  esac
done

if [ -z "$CONTAINER" ] || [ -z "$PG_USER" ] || [ -z "$PG_DB" ]; then
  echo "Нужны --container, --user и --db" >&2
  usage 1
fi

OUT="${OUT:-./db_backup_${PG_DB}_$(date +%Y%m%d-%H%M%S).dump}"

# Команда выполняется в контейнере — локально или на сервере по SSH.
in_container() {
  if [ -n "$HOST" ]; then
    # ssh склеивает аргументы в строку для оболочки сервера — экранируем их.
    # shellcheck disable=SC2029 # экранированная строка собирается на клиенте намеренно
    ssh "$HOST" "$(printf '%q ' docker exec -i "$CONTAINER" "$@")"
  else
    docker exec -i "$CONTAINER" "$@"
  fi
}

echo "Дамп ${PG_DB} из ${CONTAINER}${HOST:+ на $HOST} → $OUT"

# Пишем во временный файл: оборванный дамп не должен выглядеть готовым.
in_container pg_dump -U "$PG_USER" -d "$PG_DB" -Fc > "$OUT.part"
mv "$OUT.part" "$OUT"

# Проверка: файл читается и в нём есть данные таблиц.
TABLES=$(in_container pg_restore -l < "$OUT" | grep -c "TABLE DATA" || true)
echo "Готово: $(du -h "$OUT" | cut -f1), таблиц с данными: $TABLES"
