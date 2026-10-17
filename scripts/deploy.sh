#!/usr/bin/env bash
# Обновление SOBRA на сервере: бэкап → обновление → проверка → откат при сбое.
#
# Вызывается из GitHub Actions по SSH. Ключ деплоя в ~/.ssh/authorized_keys привязан
# только к этому скрипту, поэтому даже утёкший ключ умеет лишь выкатить коммит из main:
#   command="bash /var/www/sobra/scripts/deploy.sh",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty ssh-ed25519 AAAA... github-deploy
#
# Вручную:  bash scripts/deploy.sh <хэш коммита из main>
#
# Весь код внутри main(): во время деплоя git обновляет и этот файл,
# а bash к этому моменту уже прочитал функцию целиком.

set -Eeuo pipefail

APP_DIR="${APP_DIR:-/var/www/sobra}"
HEALTH_URL="http://127.0.0.1:3000/api/health"

health_ok() {
  for _ in $(seq 1 30); do
    curl -fsS --max-time 3 "$HEALTH_URL" >/dev/null 2>&1 && return 0
    sleep 2
  done
  return 1
}

main() {
  local target="${1:-${SSH_ORIGINAL_COMMAND:-}}"
  if [[ ! "$target" =~ ^[0-9a-f]{7,40}$ ]]; then
    echo "❌ Ожидается хэш коммита, получено: '${target}'"
    exit 2
  fi

  cd "$APP_DIR"

  # Два деплоя одновременно не запускаем
  exec 9>/tmp/sobra-deploy.lock
  flock -n 9 || { echo "❌ Деплой уже идёт"; exit 3; }

  # Правки, сделанные прямо на сервере, не затираем — пусть человек разберётся
  if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
    echo "❌ На сервере есть несохранённые изменения в коде, деплой остановлен:"
    git status --short --untracked-files=no
    exit 4
  fi

  local prev
  prev="$(git rev-parse HEAD)"
  git fetch --quiet origin main

  # Выкатываем только то, что уже есть в main на GitHub
  if ! git merge-base --is-ancestor "$target" origin/main; then
    echo "❌ Коммит $target не найден в main"
    exit 5
  fi

  if [[ "$(git rev-parse "$target")" == "$prev" ]]; then
    echo "ℹ️  Эта версия уже работает: $prev"
    exit 0
  fi

  echo "▶ Сейчас: $(git log -1 --format='%h %s' "$prev")"
  echo "▶ Будет:  $(git log -1 --format='%h %s' "$target")"

  echo "▶ Бэкап базы"
  bash "$APP_DIR/scripts/backup.sh" pre-deploy

  echo "▶ Обновление кода и пересборка"
  git reset --quiet --hard "$target"
  docker compose up -d --build

  if health_ok; then
    echo "✅ Готово: $(git log -1 --format='%h %s')"
    docker image prune -f >/dev/null 2>&1 || true
    exit 0
  fi

  echo "❌ API не ответил за минуту — откат на ${prev:0:7}"
  docker compose logs --tail=50 startup-discovery || true
  git reset --quiet --hard "$prev"
  docker compose up -d --build
  if health_ok; then
    echo "↩️  Откат выполнен, работает прежняя версия ${prev:0:7}"
  else
    echo "🚨 После отката API тоже не отвечает — нужен ручной разбор"
  fi
  exit 1
}

main "$@"; exit $?
