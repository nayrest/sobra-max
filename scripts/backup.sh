#!/usr/bin/env bash
# Бэкап базы SOBRA: сжатый pg_dump с проверкой целостности, хранятся последние KEEP копий каждого вида.
#
#   bash scripts/backup.sh            — ежедневный (из cron)
#   bash scripts/backup.sh pre-deploy — перед деплоем (его вызывает deploy.sh)
#
# Cron (crontab -e у пользователя, который запускает docker), каждый день в 03:15 по времени сервера:
#   15 3 * * * bash /var/www/sobra/scripts/backup.sh >> $HOME/backups/backup.log 2>&1
#
# Восстановление:
#   gunzip -c ~/backups/<файл>.sql.gz | docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
#
# В бэкапах персональные данные пользователей: папка доступна только владельцу, никуда их не выкладывать.

set -Eeuo pipefail
umask 077

APP_DIR="${APP_DIR:-/var/www/sobra}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/backups}"
KEEP="${KEEP:-7}"
KIND="${1:-daily}"

if [[ ! "$KIND" =~ ^[a-z-]{1,20}$ ]]; then
  echo "❌ Вид бэкапа: только латиница и дефис"; exit 2
fi

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
cd "$APP_DIR"

file="$BACKUP_DIR/sobra-$(date +%F-%H%M%S)-$KIND.sql.gz"
tmp="$file.part"
trap 'rm -f "$tmp"' EXIT

docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"' | gzip -9 > "$tmp"

# pg_dump дописывает эту строку только в конце успешного дампа
if ! gzip -cd "$tmp" | tail -n 20 | grep -q "PostgreSQL database dump complete"; then
  echo "❌ $(date '+%F %T') бэкап неполный, файл не сохранён"
  exit 1
fi

mv "$tmp" "$file"
echo "✅ $(date '+%F %T') $file ($(du -h "$file" | cut -f1))"

# Ротация: оставляем последние KEEP файлов этого вида
ls -1t "$BACKUP_DIR"/sobra-*-"$KIND".sql.gz 2>/dev/null | tail -n +"$((KEEP + 1))" | xargs -r rm -f
