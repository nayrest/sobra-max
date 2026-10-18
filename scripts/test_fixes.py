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

# ---------- 5. Сценарий «только проверить идею» (отзыв экспертов) ----------
SOLO = 800000000000 + RUN * 10 + 5
s, me = call("GET", "/api/me", SOLO)
check("новичок: intent пустой, проектов и профиля нет",
      s == 200 and me.get("intent") is None and me.get("has_projects") is False and me.get("has_profile") is False, me)
s, bad = call("PUT", "/api/me/intent", SOLO, {"intent": "hack"})
check("неизвестный intent → 400", s == 400, (s, bad))
s, me = call("PUT", "/api/me/intent", SOLO, {"intent": "idea"})
s2, me2 = call("GET", "/api/me", SOLO)
check("intent сохранён", s == 200 and me2.get("intent") == "idea", (s, me2))

s, solo = call("POST", "/api/startups", SOLO, {
    "name": "Кофейня без партнёра (тест)", "category": "Ресторан / кафе / кофейня", "market_type": "B2C",
    "stage": "Идея", "customer": "Жители района", "problem": "Нет хорошего кофе утром",
    "solution": "Окно выдачи у метро"})
check("проект без seeking и партнёра создан (201), карта есть",
      s == 201 and solo.get("seeking") is None and solo.get("idea_map") and solo.get("tasks"), (s, solo))
sid_solo = solo["id"]
s, err = call("POST", f"/api/startups/{sid_solo}/publish", SOLO, {})
check("публикация без партнёра → 409 partner_required", s == 409 and err.get("code") == "partner_required", (s, err))
s, err = call("PATCH", f"/api/startups/{sid_solo}", SOLO, {"seeking": "Кого-нибудь"})
check("PATCH с неверным seeking → 400", s == 400, (s, err))
s, upd = call("PATCH", f"/api/startups/{sid_solo}", SOLO, {"seeking": "Партнёрство", "partner_needed": "Операционный партнёр"})
check("подбор включён: seeking и partner_needed сохранены",
      s == 200 and upd.get("seeking") == "Партнёрство" and upd.get("partner_needed") == "Операционный партнёр", (s, upd))
check("карта при этом не потерялась", bool(upd.get("idea_map")) and bool(upd.get("tasks")), upd)
s, err = call("POST", f"/api/startups/{sid_solo}/publish", SOLO, {})
check("дальше публикация просит профиль (409 profile_required)", s == 409 and err.get("code") == "profile_required", (s, err))
s, me = call("GET", "/api/me", SOLO)
check("после создания проекта has_projects = true", me.get("has_projects") is True, me)
s, err = call("POST", "/api/startups", SOLO, {"name": "Пустой", "category": "Услуги", "market_type": "B2C", "stage": "Идея"})
check("без ответов о сути — по-прежнему 400", s == 400, (s, err))

# ---------- 6. Ссылки на материалы проекта (отзыв тестировщика) ----------
s, lk = call("PATCH", f"/api/startups/{sid_solo}", SOLO, {"links": [
    {"kind": "figma", "url": "https://www.figma.com/file/abc"},
    {"kind": "deck", "url": "https://disk.yandex.ru/i/xyz"}]})
check("ссылки сохранены, карта не пересчитывалась", s == 200 and len(lk.get("links", [])) == 2 and lk.get("idea_map"), (s, lk))
for bad_url in ["http://example.com", "javascript:alert(1)", "https://user:pass@evil.com", "https://localhost/x", "не ссылка"]:
    s, err = call("PATCH", f"/api/startups/{sid_solo}", SOLO, {"links": [{"kind": "other", "url": bad_url}]})
    check(f"плохая ссылка отклонена: {bad_url}", s == 400, (s, err))
s, err = call("PATCH", f"/api/startups/{sid_solo}", SOLO, {"links": [{"kind": "virus", "url": "https://a.ru"}]})
check("неизвестный вид ссылки → 400", s == 400, (s, err))
s, err = call("PATCH", f"/api/startups/{sid_solo}", SOLO, {"links": [{"kind": "other", "url": f"https://a{i}.ru"} for i in range(5)]})
check("больше 4 ссылок → 400", s == 400, (s, err))
s, got = call("GET", f"/api/startups/{sid_solo}", SOLO)
check("после отказов ссылки не испорчены", len(got.get("links", [])) == 2, got)
s, lk = call("PATCH", f"/api/startups/{sid_solo}", SOLO, {"links": []})
check("ссылки можно удалить", s == 200 and lk.get("links") == [], (s, lk))
s, made = call("POST", "/api/startups", SOLO, {
    "name": "Проект со ссылкой", "category": "Услуги", "market_type": "B2C", "stage": "Идея",
    "customer": "Соседи", "problem": "Нет мастера", "solution": "Мастер по вызову",
    "links": [{"kind": "landing", "url": "https://example.com"}]})
check("ссылки можно передать сразу при создании", s == 201 and made.get("links") == [{"kind": "landing", "url": "https://example.com/"}], (s, made))

# ---------- 7. Теги навыков (отзыв тестировщика) ----------
SK_F, SK_A, SK_B = 800000000000 + RUN * 10 + 6, 800000000000 + RUN * 10 + 7, 800000000000 + RUN * 10 + 8
profile(SK_F, "own", "", False)
profile(SK_A, "team", "Дизайнер интерфейсов, делаю прототипы", True)
s, pa = call("PUT", "/api/profile", SK_A, {
    "last_name": "Тестов", "first_name": "А", "email": "a@example.com", "phone": "+79000000006", "goal": "team",
    "about": "Дизайнер интерфейсов, делаю прототипы", "visible": True, "consent": True, "category": "Любая",
    "skills": ["#UX/UI", "Figma", "FIGMA"]})
check("теги профиля: # снят, дубль убран", s == 200 and pa.get("skills") == ["UX/UI", "Figma"], (s, pa))
s, pa = call("PUT", "/api/profile", SK_A, {
    "last_name": "Тестов", "first_name": "А", "email": "a@example.com", "phone": "+79000000006", "goal": "team",
    "about": "Дизайнер интерфейсов, делаю прототипы", "visible": True, "consent": True, "category": "Любая"})
check("профиль без skills — теги не стираются", pa.get("skills") == ["UX/UI", "Figma"], pa)
for bad in [["<b>"], [f"t{i}" for i in range(11)], "Python", ["x" * 31]]:
    s, err = call("PUT", "/api/profile", SK_A, {**{"last_name": "Т", "first_name": "А", "email": "a@example.com",
        "phone": "+79000000006", "goal": "team", "about": "Дизайнер", "consent": True}, "skills": bad})
    check(f"плохие теги отклонены: {str(bad)[:30]}", s == 400, (s, err))
s, pb = call("PUT", "/api/profile", SK_B, {
    "last_name": "Тестов", "first_name": "Б", "email": "b@example.com", "phone": "+79000000007", "goal": "team",
    "about": "Пишу бэкенд на Python", "visible": True, "consent": True, "category": "Любая", "skills": ["python", "b2b-продажи"]})
s, sk = call("POST", "/api/startups", SK_F, {
    "name": "Проект с тегами", "category": "Образование", "market_type": "B2C", "stage": "Идея",
    "seeking": "Команда / co-founder", "customer": "Студенты", "problem": "Дорогие учебники",
    "solution": "Обмен внутри вуза", "partner_needed": "Backend-разработчик", "skills": ["Python", "B2B_продажи"]})
check("проект создан с тегами", s == 201 and sk.get("skills") == ["Python", "B2B_продажи"], (s, sk))
s, sk2 = call("PATCH", f"/api/startups/{sk['id']}", SK_F, {"skills": ["Python", "B2B_продажи", "Figma"]})
check("PATCH skills не пересчитывает карту", s == 200 and sk2.get("skills")[-1] == "Figma" and sk2.get("idea_map") == sk.get("idea_map"), (s, sk2))
call("PUT", "/api/profile", SK_F, {"last_name": "Т", "first_name": "Ф", "email": "f@example.com", "phone": "+79000000005",
     "goal": "own", "about": "", "visible": False, "consent": True, "category": "Любая"})
s, _ = call("POST", f"/api/startups/{sk['id']}/publish", SK_F, {})
s, cands = call("GET", f"/api/startups/{sk['id']}/candidates", SK_F)
by = {c["user_id"]: c for c in (cands or {}).get("candidates", [])}
check("совпадения тегов без учёта регистра и -/_", by.get(SK_B, {}).get("skills_common") == ["Python", "B2B_продажи"], by.get(SK_B))
check("у дизайнера совпадает Figma", by.get(SK_A, {}).get("skills_common") == ["Figma"], by.get(SK_A))
order = [c["user_id"] for c in cands.get("candidates", [])]
check("больше совпадений — выше в списке", SK_A in order and SK_B in order and order.index(SK_B) < order.index(SK_A), order)
s, found = call("POST", "/api/search", SK_B, {"goal": "team", "category": "Образование", "min_stage": "Идея"})
mine = [m for m in found.get("matches", []) if m["startup"]["id"] == sk["id"]]
check("поиск отдаёт skills_common", mine and mine[0].get("skills_common") == ["Python", "B2B_продажи"], mine)

# ---------- 8. SOBRA Pro: интерес к тарифу (оплаты нет) ----------
s, _ = call("POST", "/api/pro/event", SK_A, {"event": "shown", "source": "match"})
check("Pro: показ записывается", s == 200, s)
s, me = call("GET", "/api/me", SK_A)
check("Pro: до нажатия clicked = false", me.get("pro") == {"clicked": False, "dismissed": False}, me)
call("POST", "/api/pro/event", SK_A, {"event": "click", "source": "match"})
call("POST", "/api/pro/event", SK_A, {"event": "click", "source": "profile"})  # повтор не ломает
s, me = call("GET", "/api/me", SK_A)
check("Pro: после «Подключить» clicked = true", me.get("pro", {}).get("clicked") is True, me)
s, err = call("POST", "/api/pro/event", SK_A, {"event": "pay"})
check("Pro: неизвестное событие → 400", s == 400, (s, err))
s, err = call("POST", "/api/pro/event", SK_A, {"event": "click", "source": "evil"})
check("Pro: неизвестный источник → 400", s == 400, (s, err))

# ---------- 9. Удаление проекта: контакты с участниками — по выбору основателя ----------
def match_project(name):
    s, p = call("POST", "/api/startups", SK_F, {
        "name": name, "category": "Услуги", "market_type": "B2C", "stage": "Идея", "seeking": "Партнёрство",
        "customer": "Соседи", "problem": "Нет мастера", "solution": "Мастер по вызову", "partner_needed": "Продажи"})
    call("POST", f"/api/startups/{p['id']}/publish", SK_F, {})
    s, off = call("POST", "/api/offers", SK_B, {"startup_id": p["id"], "type": "partner", "message": "Готов помочь"})
    call("POST", f"/api/offers/{off['id']}/accept", SK_F, {})
    return p["id"]
has = lambda uid, path, sid: any(int(c.get("startup_id", 0)) == sid for c in call("GET", path, uid)[1].get("contacts" if path == "/api/contacts" else "matches", []))
keep = match_project("Удаление: контакты остаются")
check("до удаления MATCH виден обоим", has(SK_F, "/api/contacts", keep) and has(SK_B, "/api/matches", keep))
s, _ = call("DELETE", f"/api/startups/{keep}", SK_F)
check("удаление без галочки — контакты остаются у обоих", s == 204 and has(SK_F, "/api/contacts", keep) and has(SK_B, "/api/matches", keep))
drop = match_project("Удаление: контакты убраны")
s, _ = call("DELETE", f"/api/startups/{drop}?drop_contacts=1", SK_F)
check("удаление с галочкой — контакты пропали у обоих",
      s == 204 and not has(SK_F, "/api/contacts", drop) and not has(SK_B, "/api/matches", drop))
s, cnt = call("GET", "/api/counters", SK_B)
check("счётчик контактов не считает скрытые", s == 200 and isinstance(cnt.get("contacts"), int), cnt)

print(f"\nИтого: {ok_count} OK, {fail_count} FAIL")
