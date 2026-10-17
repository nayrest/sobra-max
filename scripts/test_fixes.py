"""Регрессионные тесты доработок после пилота (октябрь 2026).

Нужен запущенный API с API_DEBUG_AUTH=true — только локально или в CI, НЕ на сервере.
    python3 scripts/test_fixes.py --base-url http://localhost:3000
Код возврата 1, если хоть одна проверка упала.
"""
import argparse, json, sys, time, urllib.request

parser = argparse.ArgumentParser()
parser.add_argument("--base-url", default="http://localhost:3000")
B = parser.parse_args().base_url.rstrip("/")
RUN = int(time.time()) % 100000  # свои id на каждый прогон — тесты можно гонять повторно
FOUNDER, CAND = 800000000000 + RUN * 10 + 1, 800000000000 + RUN * 10 + 2
ok_count = fail_count = 0


def call(method, path, uid=None, body=None):
    headers = {"Content-Type": "application/json"}
    if uid:
        headers["X-Debug-User-Id"] = str(uid)
    req = urllib.request.Request(B + path, method=method, headers=headers,
                                 data=json.dumps(body).encode() if body is not None else None)
    try:
        with urllib.request.urlopen(req) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read()
        return e.code, (json.loads(raw) if raw else None)


def check(name, cond, extra=""):
    global ok_count, fail_count
    if cond:
        ok_count += 1
        print(f"OK   {name}")
    else:
        fail_count += 1
        print(f"FAIL {name} {extra}")


def profile(uid, goal, about, visible):
    return call("PUT", "/api/profile", uid, {
        "last_name": "Тестов", "first_name": f"Юзер{uid % 10}", "email": f"u{uid}@example.com",
        "phone": "+7 900 000-00-0" + str(uid % 10), "goal": goal, "about": about,
        "visible": visible, "consent": True, "category": "Любая"})


for uid in (FOUNDER, CAND):
    call("POST", "/api/auth", uid, {})  # не обязательно, ensureUser случится при запросах
s, _ = profile(FOUNDER, "own", "", False)
check("профиль основателя", s == 200, s)
s, _ = profile(CAND, "Команда / co-founder" if False else "team", "Backend на Python и JS, базы данных, хочу в студенческий стартап", True)
check("профиль кандидата", s == 200, s)

s, st = call("POST", "/api/startups", FOUNDER, {
    "name": "ЗаПарту (тест)", "category": "Образование", "market_type": "B2C", "stage": "Идея",
    "seeking": "Команда / co-founder", "customer": "Студенты одного вуза",
    "problem": "Учебники дорогие, а у старшекурсников лежат без дела",
    "solution": "Сервис обмена и продажи б/у учебников внутри вуза",
    "partner_needed": "Backend-разработчик для MVP"})
check("создан проект", s == 201, (s, st))
sid = st["id"]
s, _ = call("POST", f"/api/startups/{sid}/publish", FOUNDER, {})
check("проект опубликован", s in (200, 201), s)

# ---------- 1. Приглашения: после отклика проект уходит ----------
s, _ = call("POST", f"/api/startups/{sid}/invite", FOUNDER, {"user_id": CAND})
check("основатель пригласил кандидата", s == 201, s)
s, inv = call("GET", "/api/invites", CAND)
check("приглашение видно до отклика", s == 200 and any(i["id"] == sid for i in inv["invites"]), inv)
s, cnt = call("GET", "/api/counters", CAND)
check("счётчик откликов у кандидата = 1 (приглашение)", cnt["responses"] == 1, cnt)

# ---------- 2. Повторный отклик ----------
s, off = call("POST", "/api/offers", CAND, {"startup_id": sid, "type": "team", "message": "Готов сделать MVP"})
check("первый отклик создан (201)", s == 201, (s, off))
s, dup = call("POST", "/api/offers", CAND, {"startup_id": sid, "type": "team", "message": "Ещё раз"})
check("повторный отклик → 409 already_applied", s == 409 and dup.get("code") == "already_applied", (s, dup))
s, rec = call("GET", "/api/offers/received", FOUNDER)
check("у основателя ровно один отклик", s == 200 and len([o for o in rec["offers"] if o["startup_id"] == sid]) == 1, rec)

s, inv = call("GET", "/api/invites", CAND)
check("после отклика проект ушёл из «Приглашений»", s == 200 and not any(i["id"] == sid for i in inv["invites"]), inv)
s, cnt = call("GET", "/api/counters", CAND)
check("приглашение больше не считается в счётчике", cnt["responses"] == 0, cnt)

s, pub = call("GET", f"/api/startups/public/{sid}", CAND)
check("в карточке проекта my_offer = new", s == 200 and pub.get("my_offer") == "new", pub)
s, srch = call("POST", "/api/search", CAND, {"goal": "team", "category": "Любая", "min_stage": "Идея"})
mine = [m for m in srch.get("matches", []) if m["startup"]["id"] == sid]
check("в поиске my_offer = new", s == 200 and mine and mine[0]["startup"].get("my_offer") == "new", (s, mine))

# ---------- 3. «Начать»: счётчики для плашки ----------
s, cnt = call("GET", "/api/counters", FOUNDER)
check("в счётчиках есть pending и bot_unreachable", s == 200 and cnt.get("pending") == 1 and cnt.get("bot_unreachable") is False, cnt)

# MATCH: принятый отклик, повтор по-прежнему нельзя
s, _ = call("POST", f"/api/offers/{off['id']}/accept", FOUNDER, {})
check("основатель принял отклик — MATCH", s == 200, s)
s, pub = call("GET", f"/api/startups/public/{sid}", CAND)
check("после MATCH my_offer = accepted", pub.get("my_offer") == "accepted", pub)
s, dup = call("POST", "/api/offers", CAND, {"startup_id": sid, "type": "team", "message": "Снова"})
check("после MATCH повторный отклик тоже 409", s == 409, (s, dup))

# ---------- 4. Черновики на сервере ----------
s, _ = call("GET", "/api/drafts/idea-draft", FOUNDER)
check("черновика ещё нет → 404", s == 404, s)
draft = {"name": "Черновик", "problem": "Текст проблемы", "autofill_text": "Описание для ИИ", "evil": 5}
s, _ = call("PUT", "/api/drafts/idea-draft", FOUNDER, {"data": draft})
check("черновик сохранён → 204", s == 204, s)
s, got = call("GET", "/api/drafts/idea-draft", FOUNDER)
check("черновик читается, нестроковые поля отброшены",
      s == 200 and got["data"].get("autofill_text") == "Описание для ИИ" and "evil" not in got["data"], got)
s, other = call("GET", "/api/drafts/idea-draft", CAND)
check("чужой черновик не виден", s == 404, (s, other))
s, _ = call("PUT", "/api/drafts/task-draft:15", FOUNDER, {"data": {"result": "Опросил 10 человек"}})
check("черновик задачи task-draft:15", s == 204, s)
s, _ = call("GET", "/api/drafts/..%2Fetc", FOUNDER)
check("кривой ключ → 400", s == 400, s)
s, _ = call("PUT", "/api/drafts/idea-draft", FOUNDER, {"data": {"name": "x" * 50000}})
check("слишком большой черновик → 413", s == 413, s)
s, _ = call("PUT", "/api/drafts/idea-draft", FOUNDER, {"data": {"name": "  "}})
s2, _ = call("GET", "/api/drafts/idea-draft", FOUNDER)
check("пустой черновик удаляет сохранённый", s == 204 and s2 == 404, (s, s2))
s, _ = call("DELETE", "/api/drafts/task-draft:15", FOUNDER)
s2, _ = call("GET", "/api/drafts/task-draft:15", FOUNDER)
check("DELETE черновика", s == 204 and s2 == 404, (s, s2))
s, _ = call("GET", "/api/drafts/idea-draft")
check("без авторизации → 401", s == 401, s)

print(f"\nИтого: {ok_count} OK, {fail_count} FAIL")
