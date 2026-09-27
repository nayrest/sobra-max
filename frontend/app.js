// SOBRA AI — мини-приложение MAX.
// Две роли в одном приложении:
//   основатель: Idea Check → Project Map → Action Plan → Update (цикл) → AI Match → приглашение;
//   кандидат:   профиль → поиск проектов с оценкой ИИ → отклик.
// Отклик, принятый основателем, — это MATCH: оба видят друг друга в «Контактах».

// ======================================================
// АВТОРИЗАЦИЯ И API
// ======================================================

const WebApp = window.WebApp || null;
const initData = WebApp && WebApp.initData ? WebApp.initData : "";

// Отладка в обычном браузере: ?debug_user=123 (работает, только если на сервере API_DEBUG_AUTH=true)
const debugUserId = new URLSearchParams(location.search).get("debug_user");

class ApiError extends Error {
  constructor(status, message, code = null) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function api(method, path, body) {
  const headers = { "Content-Type": "application/json" };
  if (initData) headers.Authorization = `Bearer ${initData}`;
  else if (debugUserId) headers["X-Debug-User-Id"] = debugUserId;

  let response;
  try {
    response = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError(0, "Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.");
  }

  if (response.status === 204) return null;

  let data = null;
  try {
    data = await response.json();
  } catch {
    // тело не JSON — обработаем по статусу
  }

  if (!response.ok) {
    throw new ApiError(response.status, (data && data.error) || `Ошибка сервера (${response.status})`, data && data.code);
  }
  return data;
}

// ======================================================
// СПРАВОЧНИКИ
// ======================================================

const BLOCKS = [
  { id: "audience", field: "customer", title: "Целевая аудитория", q: "Кто ваш клиент?", hint: "Кто будет пользоваться продуктом? Возраст, занятость, ситуация, в которой возникает потребность.", required: true },
  { id: "problem", field: "problem", title: "Проблема клиента", q: "Какую проблему решаете?", hint: "Что мешает клиенту сейчас и почему это для него важно.", required: true },
  { id: "solution", field: "solution", title: "Решение", q: "Как вы её решаете?", hint: "Что именно вы предлагаете и чем это лучше текущего способа.", required: true },
  { id: "competitors", field: "competitors", title: "Конкуренты", q: "Кто конкуренты?", hint: "Кто уже решает эту проблему и чем вы отличаетесь." },
  { id: "demand", field: "traction", title: "Проверка спроса", q: "Как проверяли спрос?", hint: "Интервью, опросы, заявки, продажи, пилоты. С цифрами, если есть." },
  { id: "model", field: "business_model", title: "Бизнес-модель", q: "Как будете зарабатывать?", hint: "Кто платит, за что и сколько." },
  { id: "economics", field: "economics", title: "Экономика", q: "Считали ли экономику?", hint: "Средний чек, себестоимость, маржа, срок окупаемости — если уже считали." },
];

const PARTNER_QUESTION = {
  field: "partner_needed",
  q: "Какого партнёра ищете?",
  hint: "Какие компетенции, опыт и зоны ответственности вам нужны. Например: операционный партнёр — персонал, поставщики, смены.",
};

const STATUS = {
  confirmed: { text: "Подтверждено", tone: "green", icon: "✓" },
  hypothesis: { text: "Гипотеза", tone: "amber", icon: "~" },
  missing: { text: "Не проработано", tone: "red", icon: "✗" },
};

const GOALS = {
  team: "Войти в команду",
  partner: "Партнёрство",
  own: "Развивает свою идею",
};

const CATEGORY_ICON = {
  "Ресторан / кафе / кофейня": "☕", "Магазин / E-commerce": "🛒", Услуги: "🛠️", Производство: "🏭",
  Образование: "🎓", Финансы: "💳", "Технологии / IT / SaaS": "💻", "AI / ИИ": "🤖",
  "Маркетинг / медиа": "📣", "Логистика / доставка": "🚚", Другое: "💡",
};
// Старые названия сфер (до 28.09.2026) — для черновиков, сохранённых в браузере
const LEGACY_CATEGORY = {
  AI: "AI / ИИ", SaaS: "Технологии / IT / SaaS", FoodTech: "Ресторан / кафе / кофейня",
  FinTech: "Финансы", EdTech: "Образование", "E-commerce": "Магазин / E-commerce",
};

const OFFER_STATUS = {
  new: { text: "Новый", tone: "blue" },
  accepted: { text: "Принят", tone: "green" },
  rejected: { text: "Отклонён", tone: "gray" },
};

const AI_VERDICTS = {
  strong: { text: "Сильное соответствие", cls: "ai-strong" },
  partial: { text: "Частичное соответствие", cls: "ai-partial" },
  weak: { text: "Слабое соответствие", cls: "ai-weak" },
};

const state = {
  user: null,
  profile: null,
  currentProjectId: null,
  offerStartupId: null,
  lastSearchGoal: null,
  lastUpdate: null, // результат последнего шага Update: показываем баннер «было → стало»
};

// ======================================================
// ОБЩИЕ ПОМОЩНИКИ
// ======================================================

const $ = (id) => document.getElementById(id);

function esc(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const badge = (text, tone = "blue") => `<span class="badge ${tone}">${esc(text)}</span>`;

function initialsOf(name) {
  return (
    String(name || "")
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "·"
  );
}

// Отметка «телефон подтверждён через MAX»
const verifiedBadge = (flag, text = "✓ Телефон подтверждён") => (flag ? badge(text, "green") : "");

// Демо-данные (demo-data.sql): вымышленные основатели и кандидаты. Сервер отвечает за них сам.
const isDemoId = (id) => Number(id) >= 900000000000 && Number(id) <= 900000000999;
const demoBadge = (id) => (isDemoId(id) ? badge("Демо", "gray") : "");
const demoContactsNote = (who) =>
  `<p class="muted demo-note">Это ${who} из демо-данных — настоящих контактов у него нет. У реального человека здесь будут «Написать в MAX», телефон и e-mail.</p>`;

// Кнопка жалобы. type: startup | user
const reportButton = (type, id, label) =>
  `<button class="text-btn report-btn" type="button" data-report="${type}" data-target="${id}" data-label="${esc(label)}">⚑ Пожаловаться</button>`;

// Кружок с фото или инициалами
function avatarHtml(url, name, extra = "") {
  const inner = url ? `<img src="${esc(url)}" alt="" loading="lazy">` : esc(initialsOf(name));
  return `<span class="avatar ${extra}" aria-hidden="true">${inner}</span>`;
}

function money(value) {
  return value ? Number(value).toLocaleString("ru-RU") + " ₽" : "";
}

function parseMoney(text) {
  const digits = String(text || "").replace(/[^\d]/g, "");
  return digits ? Number(digits) : null;
}

function dateText(value) {
  return value ? new Date(value).toLocaleDateString("ru-RU", { day: "numeric", month: "long" }) : "";
}

// Окно подтверждения в стиле приложения. В MAX на ПК мини-приложение работает внутри
// движка браузера, и системный confirm() выглядит как окно браузера — поэтому свой диалог.
// Возвращает Promise<boolean>.
function confirmDialog(text, { title = "Подтвердите действие", ok = "Да", danger = true } = {}) {
  return new Promise((resolve) => {
    const sheet = $("confirm-sheet");
    const okBtn = $("confirm-ok");
    const cancelBtn = $("confirm-cancel");
    $("confirm-title").textContent = title;
    $("confirm-text").textContent = text;
    okBtn.textContent = ok;
    okBtn.className = `btn ${danger ? "danger" : "primary"}`;
    const previousFocus = document.activeElement;
    sheet.hidden = false;
    cancelBtn.focus(); // по умолчанию безопасный вариант

    const close = (result) => {
      sheet.hidden = true;
      okBtn.removeEventListener("click", onOk);
      cancelBtn.removeEventListener("click", onCancel);
      sheet.removeEventListener("click", onBackdrop);
      document.removeEventListener("keydown", onKey);
      if (previousFocus && typeof previousFocus.focus === "function") previousFocus.focus();
      resolve(result);
    };
    const onOk = () => close(true);
    const onCancel = () => close(false);
    const onBackdrop = (e) => { if (e.target === sheet) close(false); };
    const onKey = (e) => { if (e.key === "Escape") close(false); };

    okBtn.addEventListener("click", onOk);
    cancelBtn.addEventListener("click", onCancel);
    sheet.addEventListener("click", onBackdrop);
    document.addEventListener("keydown", onKey);
  });
}

let toastTimer = null;
function toast(message, kind = "ok") {
  const el = $("toast");
  el.textContent = message;
  el.className = `toast ${kind}`;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 3500);
}

function loading(container, text = "Загружаем…") {
  container.innerHTML = `<div class="state"><span class="spinner" aria-hidden="true"></span>${esc(text)}</div>`;
}

function empty(container, text) {
  container.innerHTML = `<div class="state">${esc(text)}</div>`;
}

function failed(container, error, retry) {
  container.innerHTML = `<div class="state error"><p>${esc(error.message)}</p>
    <button class="btn secondary small" type="button">Повторить</button></div>`;
  container.querySelector("button").addEventListener("click", retry);
}

function formError(id, error) {
  const el = $(id);
  el.hidden = !error;
  el.textContent = error ? error.message || String(error) : "";
}

async function busy(button, text, action) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = text;
  try {
    return await action();
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

function seekingText(s) {
  return s.seeking || "Не указано";
}

// ======================================================
// НАВИГАЦИЯ
// ======================================================

// view → вкладка нижнего меню, к которой он относится
const VIEW_TAB = {
  projects: "projects", idea: "projects", project: "projects", match: "projects",
  search: "search", responses: "responses", contacts: "contacts", profile: "profile",
};

const VIEW_LOAD = {
  projects: loadProjects,
  project: () => loadProject(state.currentProjectId),
  match: () => loadCandidates(state.currentProjectId),
  search: prepareSearch,
  responses: loadResponses,
  contacts: loadContacts,
  profile: loadProfile,
};

// ПК: меню сбоку. От 1200px оно закреплено открытым, от 900 до 1199 — выезжает (off-canvas).
const desktopMq = window.matchMedia("(min-width: 900px)");
const dockMq = window.matchMedia("(min-width: 1200px)");

function setNav(open) {
  const isOpen = Boolean(open && desktopMq.matches);
  document.body.classList.toggle("nav-open", isOpen);
  $("menu-toggle").setAttribute("aria-expanded", String(isOpen));
  $("nav-backdrop").hidden = !(isOpen && !dockMq.matches);
}

function setupSideMenu() {
  $("menu-toggle").addEventListener("click", () => setNav(!document.body.classList.contains("nav-open")));
  $("nav-backdrop").addEventListener("click", () => setNav(false));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !dockMq.matches) setNav(false);
  });
  const reset = () => setNav(dockMq.matches);
  dockMq.addEventListener("change", reset);
  desktopMq.addEventListener("change", reset);
  reset();
}

// ======================================================
// СЧЁТЧИКИ НОВЫХ СОБЫТИЙ
// ======================================================

const BADGE_SECTIONS = { responses: "badge-responses", contacts: "badge-contacts" };
let counterTimer = null;

function setBadge(section, count) {
  const el = $(BADGE_SECTIONS[section]);
  el.hidden = !count;
  el.textContent = count > 99 ? "99+" : String(count || "");
  const button = el.closest("button");
  const title = button.querySelector("span:last-child").textContent;
  if (count) button.setAttribute("aria-label", `${title}: новых ${count}`);
  else button.removeAttribute("aria-label");
}

async function refreshCounters() {
  if (!state.user || state.onboarding) return;
  try {
    const counters = await api("GET", "/api/counters");
    // Вкладку, которая сейчас открыта, не подсвечиваем — пользователь и так её видит
    for (const section of Object.keys(BADGE_SECTIONS)) {
      const open = !$(`view-${section}`).hidden;
      if (open && counters[section]) markSeen(section);
      setBadge(section, open ? 0 : counters[section]);
    }
  } catch {
    // счётчики не критичны — при ошибке просто не показываем
  }
}

function markSeen(section) {
  setBadge(section, 0);
  api("POST", "/api/counters/seen", { section }).catch(() => {});
}

// Когда пришло событие: обновляем кружки, а если нужная вкладка открыта — и сам список
function onServerEvent() {
  refreshCounters();
  if (!$("view-responses").hidden) loadResponses();
  if (!$("view-contacts").hidden) loadContacts();
}

// Соединение с сервером в реальном времени (Server-Sent Events).
// Если оно недоступно, продолжает работать проверка раз в минуту.
let eventSource = null;
let eventRetryTimer = null;

async function connectEvents() {
  if (typeof EventSource !== "function" || !state.user) return;
  clearTimeout(eventRetryTimer);
  if (eventSource) eventSource.close();
  try {
    const { ticket } = await api("GET", "/api/events/ticket");
    eventSource = new EventSource(`/api/events?ticket=${encodeURIComponent(ticket)}`);
    eventSource.addEventListener("counters", onServerEvent);
    eventSource.addEventListener("profile", onProfileEvent);
    eventSource.addEventListener("ready", refreshCounters);
    eventSource.onerror = () => {
      // Пропуск живёт 5 минут: при обрыве берём новый и переподключаемся
      eventSource.close();
      eventSource = null;
      eventRetryTimer = setTimeout(connectEvents, 5000);
    };
  } catch {
    eventRetryTimer = setTimeout(connectEvents, 30000);
  }
}

function startCounters() {
  clearInterval(counterTimer);
  refreshCounters();
  connectEvents();
  counterTimer = setInterval(() => {
    if (document.visibilityState === "visible") refreshCounters();
  }, 60 * 1000);
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  refreshCounters();
  // Телефон мог усыпить соединение, пока приложение было свёрнуто
  if (state.user && !state.onboarding && (!eventSource || eventSource.readyState === 2)) connectEvents();
});

function show(view) {
  if (!dockMq.matches) setNav(false);
  // Ушли с профиля, не сохранив, — отложенное действие (публикация, отклик) отменяется
  if (view !== "profile") {
    state.afterProfile = null;
    state.profileReason = null;
  }
  if (BADGE_SECTIONS[view]) markSeen(view);
  else refreshCounters();
  document.querySelectorAll(".view").forEach((v) => (v.hidden = true));
  $(`view-${view}`).hidden = false;

  document.querySelectorAll("#tabbar button").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === VIEW_TAB[view]);
  });

  window.scrollTo(0, 0);
  if (VIEW_LOAD[view]) VIEW_LOAD[view]();
}

function setupNavigation() {
  document.querySelectorAll("#tabbar button").forEach((b) =>
    b.addEventListener("click", () => {
      show(b.dataset.tab);
    })
  );
  document.querySelectorAll("[data-back]").forEach((b) => b.addEventListener("click", () => show(b.dataset.back)));
  $("match-back").addEventListener("click", () => show("project"));
}

// ======================================================
// ИИ: общий блок объяснения
// ======================================================

function aiList(icon, title, items) {
  if (!items || items.length === 0) return "";
  return `<div class="ai-group"><p class="ai-title">${icon} ${title}</p>
    <ul>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul></div>`;
}

function renderAi(ai, whyTitle = "Почему подходит") {
  if (!ai) return "";
  const v = AI_VERDICTS[ai.verdict] || AI_VERDICTS.partial;
  return `<section class="ai-block ${v.cls}">
    <div class="ai-head"><b>${v.text}</b><span class="score">${ai.score}%</span></div>
    ${aiList("✅", whyTitle, ai.reasons)}
    ${aiList("⚠️", "Чего не хватает", ai.missing)}
    ${aiList("❓", "Что уточнить перед знакомством", ai.clarify)}
    <p class="ai-note">Оценка ИИ по текстам профиля и проекта. Проверьте детали при знакомстве.</p>
  </section>`;
}

function aiNotice(ai, noProfileText) {
  if (!ai) return "";
  if (ai.status === "no_profile") return `<p class="notice">${esc(noProfileText)}</p>`;
  if (ai.status === "disabled") return `<p class="notice">ИИ-оценка сейчас выключена, показаны результаты по фильтрам.</p>`;
  if (ai.message) return `<p class="notice">${esc(ai.message)}</p>`;
  return "";
}

// ======================================================
// ОСНОВАТЕЛЬ: МОИ ПРОЕКТЫ
// ======================================================

function readinessBar(value) {
  const v = Number(value) || 0;
  return `<div class="readiness"><span>Готовность проекта</span><b>${v}%</b></div>
    <div class="progress"><i style="width:${v}%"></i></div>`;
}

async function loadProjects() {
  const list = $("projects-list");
  loading(list);
  try {
    const { startups } = await api("GET", "/api/startups/my");
    if (startups.length === 0) {
      empty(list, "Проектов пока нет. Пройдите проверку идеи — SOBRA покажет, что уже проработано, и поможет найти партнёра.");
      return;
    }
    list.innerHTML = startups.map((s) => {
      const total = (s.tasks_open || 0) + (s.tasks_done || 0);
      return `
      <article class="card project-card" data-open="${s.id}">
        <div class="project-row">
          <span class="project-icon">${CATEGORY_ICON[s.category] || "💡"}</span>
          <div class="grow">
            <h3>${esc(s.name)}</h3>
            <div class="chips">
              ${s.status === "published" ? badge("Опубликован", "green") : badge("Черновик", "amber")}
              ${badge(s.stage)} ${badge(s.category, "violet")}
            </div>
          </div>
        </div>
        ${s.readiness !== null && s.readiness !== undefined ? readinessBar(s.readiness) : ""}
        ${total ? `<p class="muted plan-mini">План действий: выполнено ${s.tasks_done || 0}, осталось ${s.tasks_open || 0}</p>` : ""}
        <div class="actions"><button class="btn secondary small" type="button" data-open="${s.id}">Открыть карту проекта →</button></div>
      </article>`;
    }).join("");
  } catch (error) {
    failed(list, error, loadProjects);
  }
}

function openProject(id) {
  state.currentProjectId = Number(id);
  show("project");
}

// ======================================================
// ОСНОВАТЕЛЬ: ПРОВЕРКА ИДЕИ
// ======================================================

function questionField({ field, q, hint, required }) {
  return `<label class="field wide"><span>${esc(q)}${required ? ' <b class="required">*</b>' : ""}</span>
    <textarea class="input textarea" name="${field}" maxlength="1000" placeholder="${esc(hint)}"></textarea></label>`;
}

// ======================================================
// ЧЕРНОВИКИ: введённое не теряется при переходе на другую вкладку или закрытии приложения.
// Хранятся только на устройстве пользователя (localStorage), на сервер не уходят.
// ======================================================

const IDEA_FORM_FIELDS = ["name", "category", "market_type", "stage", "seeking", ...BLOCKS.map((b) => b.field), PARTNER_QUESTION.field];
const DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1000; // черновик старше 30 дней не восстанавливаем

const draftKey = (kind, id = "") => `sobra:${kind}:${state.user?.user_id || "anon"}${id ? ":" + id : ""}`;

function draftSave(key, data) {
  try {
    const hasText = Object.values(data).some((v) => typeof v === "string" && v.trim());
    if (hasText) localStorage.setItem(key, JSON.stringify({ data, at: Date.now() }));
    else localStorage.removeItem(key);
  } catch {
    // хранилище недоступно (приватный режим и т.п.) — просто работаем без черновика
  }
}

function draftLoad(key) {
  try {
    const raw = JSON.parse(localStorage.getItem(key) || "null");
    if (!raw || !raw.data || Date.now() - raw.at > DRAFT_TTL_MS) return null;
    return raw.data;
  } catch {
    return null;
  }
}

function draftClear(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

function ideaDraftData(form) {
  const data = {};
  for (const name of IDEA_FORM_FIELDS) data[name] = form.elements[name].value;
  return data;
}

function setupIdeaForm() {
  const form = $("idea-form");
  $("idea-questions").innerHTML = [...BLOCKS, { ...PARTNER_QUESTION, required: true }].map(questionField).join("");

  let saveTimer = null;
  const saveDraft = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      draftSave(draftKey("idea-draft"), ideaDraftData(form));
      $("idea-draft-note").hidden = !draftLoad(draftKey("idea-draft"));
    }, 300);
  };
  form.addEventListener("input", saveDraft);
  form.addEventListener("change", saveDraft);

  $("open-idea").addEventListener("click", () => {
    formError("idea-error", null);
    form.reset();
    const draft = draftLoad(draftKey("idea-draft"));
    if (draft) {
      if (LEGACY_CATEGORY[draft.category]) draft.category = LEGACY_CATEGORY[draft.category];
      for (const name of IDEA_FORM_FIELDS) if (typeof draft[name] === "string") form.elements[name].value = draft[name];
      toast("Восстановили незаконченную проверку идеи");
    }
    $("idea-draft-note").hidden = !draft;
    show("idea");
  });

  $("idea-draft-clear").addEventListener("click", async () => {
    if (!(await confirmDialog("Все ответы в форме будут удалены.", { title: "Очистить форму?", ok: "Очистить" }))) return;
    form.reset();
    draftClear(draftKey("idea-draft"));
    $("idea-draft-note").hidden = true;
    formError("idea-error", null);
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    formError("idea-error", null);
    const f = form.elements;

    const required = ["name", "category", "market_type", "stage", "seeking", "customer", "problem", "solution", "partner_needed"];
    const emptyField = required.find((name) => !f[name].value.trim());
    if (emptyField) {
      f[emptyField].focus();
      formError("idea-error", new Error("Заполните поля со звёздочкой. Остальные можно дописать позже — они попадут в карту как «не проработано»."));
      return;
    }

    const body = {
      name: f.name.value.trim(),
      category: f.category.value,
      market_type: f.market_type.value,
      stage: f.stage.value,
      seeking: f.seeking.value,
      investment_amount: null,
    };
    for (const { field } of [...BLOCKS, PARTNER_QUESTION]) body[field] = f[field].value.trim();

    const button = form.querySelector("button[type=submit]");
    try {
      const startup = await busy(button, "SOBRA анализирует ответы…", () => api("POST", "/api/startups", body));
      draftClear(draftKey("idea-draft"));
      $("idea-draft-note").hidden = true;
      form.reset();
      toast("Карта проекта готова");
      openProject(startup.id);
    } catch (error) {
      formError("idea-error", error);
    }
  });
}

// ======================================================
// ОСНОВАТЕЛЬ: КАРТА ПРОЕКТА
// ======================================================

async function loadProject(id) {
  const box = $("project-detail");
  loading(box);
  try {
    renderProject(await api("GET", `/api/startups/${id}`));
  } catch (error) {
    failed(box, error, () => loadProject(id));
  }
}

// Пять шагов SOBRA. 3 и 4 — цикл: план → результат → пересчёт карты → новый план.
function journey(s, openTasks, doneTasks) {
  const published = s.status === "published";
  const updates = doneTasks.filter((t) => t.result).length;
  const steps = [
    { n: "01", title: "Idea Check", text: "Ответы на вопросы", state: "done", target: null },
    { n: "02", title: "Project Map", text: `Готовность ${Number(s.readiness) || 0}%`, state: "done", target: "project-map" },
    {
      n: "03", title: "Action Plan",
      text: openTasks.length ? `Шагов в плане: ${openTasks.length}` : "Все блоки подтверждены",
      state: openTasks.length ? "active" : "done", target: "action-plan",
    },
    {
      n: "04", title: "Update",
      text: updates ? `Обновлений: ${updates}` : "Вернитесь с результатом",
      state: updates ? "done" : "todo", target: updates ? "updates" : "action-plan",
    },
    {
      n: "05", title: "AI Match",
      text: published ? "Подобрать партнёра" : "Сначала опубликуйте",
      state: published ? "active" : "todo", target: "match-card",
    },
  ];
  return `<nav class="journey" aria-label="Шаги SOBRA">
    ${steps.map((st) => `<button type="button" class="journey-step ${st.state}" ${st.target ? `data-scroll="${st.target}"` : "disabled"}>
      <span class="journey-num">${st.state === "done" ? "✓" : st.n}</span>
      <span class="journey-text"><b>${st.title}</b><small>${esc(st.text)}</small></span>
    </button>`).join("")}
  </nav>`;
}

function statusPill(status) {
  const st = STATUS[status] || STATUS.missing;
  return `<span class="badge ${st.tone}">${st.icon} ${esc(st.text)}</span>`;
}

// Баннер после шага Update: что изменилось в карте
function updateBanner(s) {
  const u = state.lastUpdate;
  if (!u || u.projectId !== s.id) return "";
  const confirmed = u.status_after === "confirmed";
  const delta = (u.readiness_after || 0) - (u.readiness_before || 0);
  return `<section class="card update-banner ${confirmed ? "ok" : ""}" id="update-banner">
    <p class="eyebrow">Update · карта пересчитана</p>
    <h3>${esc(u.block_title)}</h3>
    <div class="transition">${statusPill(u.status_before)} <span class="arrow">→</span> ${statusPill(u.status_after)}</div>
    <p class="muted">Готовность: ${u.readiness_before}% → <b>${u.readiness_after}%</b>${delta > 0 ? ` (+${delta})` : ""}</p>
    ${confirmed
      ? `<p class="answer">Блок подтверждён фактами. Он больше не в плане.</p>`
      : `<p class="answer">Пока не хватает фактов, чтобы засчитать блок. SOBRA добавила следующий шаг в план.${u.comment ? ` <b>Совет:</b> ${esc(u.comment)}` : ""}</p>`}
  </section>`;
}

function taskCard(t, map) {
  const comment = map[t.block_id]?.comment;
  return `<article class="task" id="task-${t.id}">
    <div class="task-head">
      <span class="task-box" aria-hidden="true"></span>
      <div class="grow">
        <h3>${esc(t.title)}</h3>
        <div class="chips">${badge(t.block_title, "gray")} ${statusPill(map[t.block_id]?.status)}</div>
      </div>
    </div>
    ${comment ? `<p class="next"><b>Что дальше:</b> ${esc(comment)}</p>` : ""}
    <details class="method" ${t.method_source === "ai" ? "open" : ""}>
      <summary>${t.method_source === "ai" ? "✨ Методика от ИИ под ваш проект" : "Как это сделать"}</summary>
      <ol>${t.method.map((m) => `<li>${esc(m)}</li>`).join("")}</ol>
      ${t.method_source === "ai" ? "" : `<button class="text-btn" type="button" data-method="${t.id}">✨ Попросить ИИ расписать под мой проект</button>`}
    </details>
    <div class="task-result" data-result-box="${t.id}" hidden>
      <label class="field"><span>Что сделали и что узнали?</span>
        <textarea class="input textarea" maxlength="1000" placeholder="${esc(t.result_hint)}"></textarea></label>
      <p class="hint">Цифры и факты (интервью, заявки, продажи) помогут засчитать блок как подтверждённый.</p>
      <p class="form-error" hidden></p>
      <div class="actions">
        <button class="btn secondary small" type="button" data-result-cancel="${t.id}">Отмена</button>
        <button class="btn primary small" type="button" data-result-save="${t.id}">Обновить карту</button>
      </div>
    </div>
    <div class="actions" data-result-open-row="${t.id}">
      <button class="btn primary small" type="button" data-result-open="${t.id}">Внести результат →</button>
    </div>
  </article>`;
}

function historyItem(t) {
  const date = dateText(t.done_at);
  if (!t.result) {
    return `<li class="history-item">
      <span class="history-icon ok">✓</span>
      <div class="grow"><b>${esc(t.block_title)}</b> — подтверждён при редактировании блока <span class="muted">· ${date}</span></div>
    </li>`;
  }
  return `<li class="history-item">
    <span class="history-icon ${t.status_after === "confirmed" ? "ok" : ""}">${t.status_after === "confirmed" ? "✓" : "↻"}</span>
    <div class="grow">
      <b>${esc(t.title)}</b> <span class="muted">· ${date}</span>
      <div class="transition small">${statusPill(t.status_before)} <span class="arrow">→</span> ${statusPill(t.status_after)}
        ${t.readiness_after !== null && t.readiness_after !== undefined ? `<span class="muted">${t.readiness_before}% → ${t.readiness_after}%</span>` : ""}</div>
      <p class="answer">${esc(t.result)}</p>
    </div>
  </li>`;
}

function renderProject(s) {
  const map = s.idea_map || {};
  const published = s.status === "published";
  const tasks = s.tasks || [];
  const openTasks = tasks.filter((t) => t.status === "open");
  const doneTasks = tasks.filter((t) => t.status === "done");
  const missingTitles = BLOCKS.filter((b) => map[b.id] && map[b.id].status !== "confirmed").map((b) => b.title.toLowerCase());

  $("project-detail").innerHTML = `
    <div class="page-head">
      <h1>Карта проекта</h1>
      <p>SOBRA не оценивает, хорошая ли идея. Она показывает, что нужно проверить, фиксирует прогресс и помогает найти человека с недостающими компетенциями.</p>
    </div>

    ${journey(s, openTasks, doneTasks)}
    ${updateBanner(s)}

    <section class="card" id="project-map">
      <div class="project-row">
        <span class="project-icon big">${CATEGORY_ICON[s.category] || "💡"}</span>
        <div class="grow">
          <h2>${esc(s.name)}</h2>
          <div class="chips">
            ${published ? badge("Опубликован", "green") : badge("Черновик", "amber")}
            ${badge(s.stage)} ${badge(s.category, "violet")} ${badge(s.market_type, "gray")}
          </div>
        </div>
      </div>
      ${readinessBar(s.readiness)}
      ${map._source === "rules" ? `<p class="ai-note">ИИ был недоступен, карта построена по простым правилам. Обновите любой блок, чтобы пересчитать.</p>` : ""}
    </section>

    <div class="map-grid">
      ${BLOCKS.map((b) => mapCard(b, s, map[b.id])).join("")}
    </div>

    <section class="card plan" id="action-plan">
      <div class="plan-head">
        <div>
          <p class="eyebrow">Шаг 3 · Action Plan</p>
          <h2>Следующие шаги</h2>
        </div>
        ${tasks.length ? `<span class="plan-count">${doneTasks.length} / ${tasks.length}</span>` : ""}
      </div>
      ${openTasks.length
        ? `<p class="muted">Выполните шаг и вернитесь с результатом — SOBRA пересчитает карту (шаг 4 · Update).</p>
           <div class="tasks">${openTasks.map((t) => taskCard(t, map)).join("")}</div>`
        : `<p class="answer">Все блоки карты подтверждены фактами. Если что-то изменится — обновите блок, и план пересоберётся.</p>`}
    </section>

    ${doneTasks.length ? `<section class="card" id="updates">
      <p class="eyebrow">Шаг 4 · Update</p>
      <h2>История обновлений</h2>
      <ul class="history">${doneTasks.map(historyItem).join("")}</ul>
    </section>` : ""}

    <section class="card insight" id="match-card">
      <p class="eyebrow">Шаг 5 · AI Match</p>
      <h3>${esc(seekingText(s))}</h3>
      <p>${esc(s.partner_needed || "Не указано")}</p>
      ${missingTitles.length ? `<p class="muted">Проекту пока не хватает: ${esc(missingTitles.slice(0, 3).join(", "))}. Партнёр с опытом в этом ускорит проверку.</p>` : ""}
      ${published
        ? `<button class="btn primary block" type="button" id="go-match">Подобрать партнёра →</button>
           <div class="actions"><button class="btn danger small" type="button" id="delete-project">Удалить проект</button></div>`
        : `<p class="muted">Опубликуйте проект, чтобы кандидаты могли откликаться, а ИИ — подбирать людей.</p>
           <div class="actions">
             <button class="btn danger small" type="button" id="delete-project">Удалить черновик</button>
             <button class="btn primary" type="button" id="publish-project">Опубликовать</button>
           </div>`}
    </section>
  `;

  const box = $("project-detail");
  box.querySelectorAll("[data-edit]").forEach((btn) => btn.addEventListener("click", () => editBlock(s, btn.dataset.edit)));
  box.querySelectorAll("[data-scroll]").forEach((btn) =>
    btn.addEventListener("click", () => $(btn.dataset.scroll)?.scrollIntoView({ behavior: "smooth", block: "start" }))
  );
  setupTasks(s);

  $("delete-project").addEventListener("click", async (e) => {
    const button = e.currentTarget; // после await currentTarget уже пустой
    const text = published
      ? "Проект пропадёт из поиска и подбора, ожидающие отклики будут отклонены. MATCH и контакты у тех, с кем вы уже договорились, сохранятся. Действие нельзя отменить."
      : "Проект и его карта будут удалены. Это действие нельзя отменить.";
    if (!(await confirmDialog(text, { title: published ? "Удалить проект?" : "Удалить черновик?", ok: "Удалить" }))) return;
    try {
      await busy(button, "Удаляем…", () => api("DELETE", `/api/startups/${s.id}`));
      toast(published ? "Проект удалён" : "Черновик удалён");
      show("projects");
    } catch (error) {
      toast(error.message, "error");
    }
  });

  if (published) {
    $("go-match").addEventListener("click", () => show("match"));
  } else {
    $("publish-project").addEventListener("click", async (e) => {
      const button = e.currentTarget;
      const again = () => { state.currentProjectId = s.id; show("project"); };
      if (!(await requireProfile("Чтобы опубликовать проект, заполните профиль.", again))) return;
      try {
        await busy(button, "Публикуем…", () => api("POST", `/api/startups/${s.id}/publish`));
        toast("Проект опубликован. Теперь можно подобрать партнёра.");
        loadProject(s.id);
      } catch (error) {
        toast(error.message, "error");
      }
    });
  }
}

// Action Plan: методика от ИИ и шаг Update
function setupTasks(s) {
  const box = $("project-detail");

  box.querySelectorAll("[data-method]").forEach((btn) =>
    btn.addEventListener("click", async (e) => {
      const button = e.currentTarget;
      try {
        const { ai } = await busy(button, "ИИ составляет методику…", () =>
          api("POST", `/api/startups/${s.id}/tasks/${button.dataset.method}/method`)
        );
        if (!ai) toast("ИИ сейчас недоступен — оставили базовую методику", "error");
        loadProject(s.id);
      } catch (error) {
        toast(error.message, "error");
      }
    })
  );

  const toggle = (id, open, focus = true) => {
    box.querySelector(`[data-result-box="${id}"]`).hidden = !open;
    box.querySelector(`[data-result-open-row="${id}"]`).hidden = open;
    if (open && focus) box.querySelector(`[data-result-box="${id}"] textarea`).focus();
  };

  // Черновик результата по каждой задаче: если текст уже начат — поле сразу открыто и заполнено
  box.querySelectorAll("[data-result-box]").forEach((resultBox) => {
    const id = resultBox.dataset.resultBox;
    const textarea = resultBox.querySelector("textarea");
    const draft = draftLoad(draftKey("task-draft", id));
    if (draft && draft.result) {
      textarea.value = draft.result;
      toggle(id, true, false);
    }
    textarea.addEventListener("input", () => draftSave(draftKey("task-draft", id), { result: textarea.value }));
  });
  box.querySelectorAll("[data-result-open]").forEach((b) => b.addEventListener("click", () => toggle(b.dataset.resultOpen, true)));
  box.querySelectorAll("[data-result-cancel]").forEach((b) => b.addEventListener("click", () => toggle(b.dataset.resultCancel, false)));

  box.querySelectorAll("[data-result-save]").forEach((b) =>
    b.addEventListener("click", async (e) => {
      const id = b.dataset.resultSave;
      const resultBox = box.querySelector(`[data-result-box="${id}"]`);
      const textarea = resultBox.querySelector("textarea");
      const error = resultBox.querySelector(".form-error");
      const result = textarea.value.trim();
      error.hidden = true;
      if (result.length < 10) {
        error.hidden = false;
        error.textContent = "Опишите результат хотя бы одним предложением.";
        textarea.focus();
        return;
      }
      try {
        const { startup, update } = await busy(e.currentTarget, "SOBRA пересчитывает карту…", () =>
          api("POST", `/api/startups/${s.id}/tasks/${id}/complete`, { result })
        );
        draftClear(draftKey("task-draft", id));
        state.lastUpdate = { ...update, projectId: startup.id };
        renderProject(startup);
        toast(update.status_after === "confirmed" ? `«${update.block_title}» подтверждён ✓` : "Карта обновлена, в плане следующий шаг");
        $("update-banner")?.scrollIntoView({ behavior: "smooth", block: "start" });
      } catch (err) {
        error.hidden = false;
        error.textContent = err.message;
      }
    })
  );
}

function mapCard(block, startup, item) {
  const status = STATUS[item?.status] || STATUS.missing;
  const answer = startup[block.field];
  return `<article class="card map-card ${item?.status || "missing"}" id="block-${block.id}">
    <div class="map-head"><h3><span class="map-icon">${status.icon}</span> ${esc(block.title)}</h3>${badge(status.text, status.tone)}</div>
    <p class="answer">${answer ? esc(answer) : '<span class="muted">Нет ответа</span>'}</p>
    <button class="text-btn" type="button" data-edit="${block.id}">Обновить блок →</button>
  </article>`;
}

function editBlock(startup, blockId) {
  const block = BLOCKS.find((b) => b.id === blockId);
  const card = $(`block-${blockId}`);

  card.innerHTML = `
    <div class="map-head"><h3>${esc(block.title)}</h3></div>
    <label class="field"><span>${esc(block.q)}</span>
      <textarea class="input textarea" maxlength="3000" placeholder="${esc(block.hint)}">${esc(startup[block.field] || "")}</textarea></label>
    <p class="form-error" hidden></p>
    <div class="actions">
      <button class="btn secondary small" type="button" data-cancel>Отмена</button>
      <button class="btn primary small" type="button" data-save>Сохранить</button>
    </div>`;

  const textarea = card.querySelector("textarea");
  const error = card.querySelector(".form-error");
  textarea.focus();

  card.querySelector("[data-cancel]").addEventListener("click", () => renderProject(startup));
  card.querySelector("[data-save]").addEventListener("click", async (e) => {
    const value = textarea.value.trim();
    if (block.required && !value) {
      error.hidden = false;
      error.textContent = "Этот блок обязателен и не может быть пустым.";
      return;
    }
    try {
      const updated = await busy(e.currentTarget, "Пересчитываем…", () =>
        api("PATCH", `/api/startups/${startup.id}`, { [block.field]: value })
      );
      toast("Блок обновлён, карта пересчитана");
      renderProject(updated);
    } catch (err) {
      error.hidden = false;
      error.textContent = err.message;
    }
  });
}

// ======================================================
// ОСНОВАТЕЛЬ: ПОДБОР ПАРТНЁРА
// ======================================================

async function loadCandidates(id) {
  const list = $("match-list");
  loading(list, "ИИ сравнивает кандидатов с потребностью проекта. Это займёт несколько секунд…");
  try {
    const { candidates, ai } = await api("GET", `/api/startups/${id}/candidates`);
    if (candidates.length === 0) {
      empty(list, "Пока нет кандидатов, которые открыли профиль под такую потребность. Мы сообщим, когда они появятся — а пока проект видят в поиске.");
      return;
    }
    list.innerHTML = aiNotice(ai, "") + candidates.map((c) => `
      <article class="card">
        <div class="person">
          ${avatarHtml(c.avatar_url, c.name)}
          <div class="grow"><h3>${esc(c.name)}</h3><p class="muted">${esc(GOALS[c.goal] || "")}</p>
            <div class="chips">${demoBadge(c.user_id)} ${verifiedBadge(c.phone_verified)}</div></div>
        </div>
        <p class="answer">${esc(c.about)}</p>
        ${renderAi(c.ai)}
        ${isDemoId(c.user_id) && !c.invited ? `<p class="muted demo-note">Демо-кандидат: на приглашение он откликнется автоматически через несколько секунд.</p>` : ""}
        <div class="actions">
          ${c.invited
            ? `<button class="btn secondary" type="button" disabled>Приглашение отправлено ✓</button>`
            : `<button class="btn primary" type="button" data-invite="${c.user_id}" ${isDemoId(c.user_id) ? "data-demo" : ""}>Пригласить в проект</button>`}
        </div>
        <div class="card-foot">${reportButton("user", c.user_id, c.name)}</div>
      </article>`).join("");
  } catch (error) {
    failed(list, error, () => loadCandidates(id));
  }
}

async function handleInvite(event) {
  const button = event.target.closest("[data-invite]");
  if (!button) return;
  try {
    await busy(button, "Отправляем…", () =>
      api("POST", `/api/startups/${state.currentProjectId}/invite`, { user_id: Number(button.dataset.invite) })
    );
    button.outerHTML = `<button class="btn secondary" type="button" disabled>Приглашение отправлено ✓</button>`;
    toast("demo" in button.dataset
      ? "Приглашение отправлено. Демо-кандидат откликнется через несколько секунд — смотрите «Отклики»."
      : "Приглашение отправлено. Кандидат получит сообщение в MAX.");
  } catch (error) {
    toast(error.message, "error");
  }
}

// ======================================================
// КАНДИДАТ: ПРОФИЛЬ
// ======================================================

async function fetchProfile() {
  state.profile = await api("GET", "/api/profile");
  return state.profile;
}

/**
 * 10 цифр номера без кода страны.
 * Код 7/8 в начале всегда отбрасываем (в т.ч. из маски «+7 …»).
 */
function extractRuPhoneDigits(raw) {
  if (!raw) return "";
  let digits = String(raw).replace(/\D/g, "");
  if (digits[0] === "7" || digits[0] === "8") digits = digits.slice(1);
  return digits.slice(0, 10);
}

/** Нормализация → +7XXXXXXXXXX или null */
function normalizeRuPhone(raw) {
  const digits = extractRuPhoneDigits(raw);
  if (digits.length !== 10) return null;
  return `+7${digits}`;
}

/** Только из цифр: +7 (900) 123-45-67 */
function formatRuPhoneDigits(d) {
  if (!d) return "";
  let out = "+7";
  if (d.length > 0) out += " (" + d.slice(0, Math.min(3, d.length));
  if (d.length >= 3) out += ")";
  if (d.length > 3) out += " " + d.slice(3, Math.min(6, d.length));
  if (d.length > 6) out += "-" + d.slice(6, Math.min(8, d.length));
  if (d.length > 8) out += "-" + d.slice(8, 10);
  return out;
}

function formatRuPhone(raw) {
  return formatRuPhoneDigits(extractRuPhoneDigits(raw));
}

/** Позиция курсора сразу после n-й значащей цифры (не считая код страны в маске) */
function cursorAfterDigits(formatted, n) {
  if (n <= 0) {
    // после «+7 (»
    const i = formatted.indexOf("(");
    return i >= 0 ? i + 1 : formatted.length;
  }
  let seen = 0;
  for (let i = 0; i < formatted.length; i++) {
    if (/\d/.test(formatted[i])) {
      // пропускаем ведущую «7» кода страны в строке «+7 …»
      if (seen === 0 && formatted[i] === "7" && i < 3) continue;
      seen++;
      if (seen >= n) {
        let pos = i + 1;
        while (pos < formatted.length && /[)\s-]/.test(formatted[pos])) pos++;
        return pos;
      }
    }
  }
  return formatted.length;
}

function setupPhoneMask(input) {
  if (!input || input.dataset.phoneMask === "1") return;
  input.dataset.phoneMask = "1";
  input.setAttribute("placeholder", "+7 (900) 123-45-67");
  input.setAttribute("inputmode", "tel");
  input.setAttribute("autocomplete", "tel");
  input.setAttribute("maxlength", "18");

  const setValue = (digits, cursorDigits) => {
    const formatted = formatRuPhoneDigits(digits);
    input.value = formatted;
    const pos = cursorAfterDigits(formatted, cursorDigits);
    requestAnimationFrame(() => {
      try {
        input.setSelectionRange(pos, pos);
      } catch {
        /* ignore */
      }
    });
  };

  input.addEventListener("keydown", (e) => {
    if (e.key !== "Backspace" && e.key !== "Delete") return;
    if (input.selectionStart !== input.selectionEnd) return; // выделение — пусть браузер

    const start = input.selectionStart ?? 0;
    const val = input.value;
    const digits = extractRuPhoneDigits(val);

    if (e.key === "Backspace" && start > 0) {
      // если слева разделитель или «+7 (» — удаляем предыдущую цифру
      const leftChar = val[start - 1];
      if (/\D/.test(leftChar) || start <= 4) {
        e.preventDefault();
        if (!digits.length) {
          input.value = "";
          return;
        }
        const digitsBefore = extractRuPhoneDigits(val.slice(0, start)).length;
        const removeAt = Math.max(0, (digitsBefore || 1) - 1);
        const next = digits.slice(0, removeAt) + digits.slice(removeAt + 1);
        setValue(next, removeAt);
      }
    }

    if (e.key === "Delete" && start < val.length) {
      const rightChar = val[start];
      if (/\D/.test(rightChar)) {
        e.preventDefault();
        const digitsBefore = extractRuPhoneDigits(val.slice(0, start)).length;
        if (digitsBefore >= digits.length) return;
        const next = digits.slice(0, digitsBefore) + digits.slice(digitsBefore + 1);
        setValue(next, digitsBefore);
      }
    }
  });

  input.addEventListener("input", () => {
    const sel = input.selectionStart ?? input.value.length;
    // сколько значащих цифр было слева от курсора до переформатирования
    let digitsBefore = extractRuPhoneDigits(input.value.slice(0, sel)).length;
    const digits = extractRuPhoneDigits(input.value);
    // если стёрли всё до кода страны — очищаем поле
    if (!digits.length && !/\d/.test(input.value.replace(/^\+?7/, ""))) {
      input.value = "";
      return;
    }
    setValue(digits, digitsBefore);
  });

  input.addEventListener("focus", () => {
    if (!input.value.trim()) return;
    const d = extractRuPhoneDigits(input.value);
    if (d.length) setValue(d, d.length);
  });

  input.addEventListener("blur", () => {
    const d = extractRuPhoneDigits(input.value);
    input.value = d.length ? formatRuPhoneDigits(d) : "";
  });
}

/** В шапке: «Иванов И.» (фамилия + инициал имени) */
function displayNameFromProfile(p, fallback) {
  const last = p?.last_name && String(p.last_name).trim();
  const first = p?.first_name && String(p.first_name).trim();
  if (last && first) return `${last} ${first[0].toUpperCase()}.`;
  if (last) return last;
  if (first) return first;
  if (p?.full_name) {
    const parts = String(p.full_name).trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return `${parts[0]} ${parts[1][0].toUpperCase()}.`;
    return parts[0] || "";
  }
  return fallback || "";
}

// Шапка: заполненный профиль — фото и «Фамилия И.», по нажатию открывается профиль.
// Не заполнен — вместо них кнопка «Заполнить профиль». Пока профиль грузится (p === null) — имя из MAX.
function updateUserbox(p) {
  const loaded = p !== null && p !== undefined;
  const complete = loaded && isProfileComplete(p);
  $("userbox").hidden = loaded && !complete;
  $("userbox").disabled = !state.user;
  $("profile-cta").hidden = !loaded || complete;
  const name = displayNameFromProfile(p, state.user?.name || `ID ${state.user?.user_id || ""}`);
  $("user-name").textContent = name || "Вход…";
  const initials = initialsOf([p?.first_name, p?.last_name].filter(Boolean).join(" ") || name);
  const url = p?.avatar_url || null;
  for (const id of ["user-avatar", "profile-avatar"]) {
    $(id).innerHTML = url ? `<img src="${esc(url)}" alt="">` : esc(initials);
  }
  $("avatar-remove").hidden = !url;
  $("avatar-label").textContent = url ? "Сменить фото" : "Загрузить фото";
}

// ======================================================
// ПОДТВЕРЖДЕНИЕ ТЕЛЕФОНА ЧЕРЕЗ MAX
// ======================================================
// WebApp.requestContact() отдаёт номер, привязанный к аккаунту MAX, с подписью.
// Сервер проверяет подпись ключом бота, после этого номер отмечается как подтверждённый.

const canRequestContact = () => Boolean(WebApp && typeof WebApp.requestContact === "function");

function updatePhoneStatus() {
  const input = $("profile-form").elements.phone;
  const verified = Boolean(state.verifiedPhone) && formatRuPhone(input.value) === state.verifiedPhone;
  $("phone-verified").hidden = !verified;
  $("phone-verify").hidden = verified || !canRequestContact();
}

function setupPhoneVerification() {
  const input = $("profile-form").elements.phone;
  input.addEventListener("input", updatePhoneStatus);

  $("phone-verify").addEventListener("click", async (e) => {
    const button = e.currentTarget;
    try {
      const contact = await busy(button, "Ждём подтверждения в MAX…", () => WebApp.requestContact());
      if (!contact || contact.error || !contact.phone) {
        const code = contact?.error?.code || "";
        toast(code.includes("refused") ? "Вы не поделились номером — можно подтвердить позже" : "MAX не передал номер. Попробуйте ещё раз.", "error");
        return;
      }
      const result = await api("POST", "/api/profile/phone", {
        phone: contact.phone,
        authDate: contact.authDate,
        hash: contact.hash,
      });
      input.value = formatRuPhone(result.phone);
      state.verifiedPhone = formatRuPhone(result.phone);
      state.profile = { ...(state.profile || {}), phone: result.phone, phone_verified: true };
      updatePhoneStatus();
      toast("Номер подтверждён через MAX ✓");
    } catch (error) {
      const code = error?.error?.code || error?.code || "";
      toast(String(code).includes("refused") ? "Вы не поделились номером — можно подтвердить позже" : error.message || "Не удалось подтвердить номер", "error");
    }
  });
}

// ======================================================
// ЖАЛОБЫ
// ======================================================

function setupReports() {
  const sheet = $("report-sheet");
  const form = $("report-form");
  let target = null;

  const close = () => {
    sheet.hidden = true;
    target = null;
  };

  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-report]");
    if (!button) return;
    target = { type: button.dataset.report, id: Number(button.dataset.target) };
    form.reset();
    formError("report-error", null);
    $("report-target").textContent = (target.type === "startup" ? "Проект: " : "Пользователь: ") + (button.dataset.label || "");
    sheet.hidden = false;
  });

  $("report-cancel").addEventListener("click", close);
  sheet.addEventListener("click", (e) => {
    if (e.target === sheet) close();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!target) return;
    const button = form.querySelector("button[type=submit]");
    try {
      const result = await busy(button, "Отправляем…", () =>
        api("POST", "/api/reports", {
          target_type: target.type,
          target_id: target.id,
          reason: form.elements.reason.value,
          comment: form.elements.comment.value.trim(),
        })
      );
      close();
      toast(result.hidden ? "Спасибо. После нескольких жалоб мы скрыли это из поиска до проверки." : "Спасибо, жалоба отправлена");
    } catch (error) {
      formError("report-error", error);
    }
  });
}

// ======================================================
// АВАТАРКА
// ======================================================

// Обрезаем по центру до квадрата 256×256 и сжимаем в JPEG (~20–40 КБ).
// Так на сервер не уходят огромные фото с телефона, а заодно отбрасываются EXIF и геометки.
async function imageToAvatar(file) {
  if (!file.type.startsWith("image/")) throw new Error("Выберите изображение");
  if (file.size > 20 * 1024 * 1024) throw new Error("Файл больше 20 МБ");

  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("Не удалось открыть изображение. Попробуйте JPG или PNG."));
      i.src = url;
    });
    const size = 256;
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
    return canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function setupAvatar() {
  const input = $("avatar-input");
  const label = input.closest("label");

  input.addEventListener("change", async () => {
    const file = input.files && input.files[0];
    input.value = "";
    if (!file) return;
    label.classList.add("disabled");
    $("avatar-label").textContent = "Загружаем…";
    try {
      const image = await imageToAvatar(file);
      const { avatar_url } = await api("PUT", "/api/profile/avatar", { image });
      state.profile = { ...(state.profile || {}), avatar_url };
      toast("Фото обновлено");
    } catch (error) {
      toast(error.message, "error");
    } finally {
      label.classList.remove("disabled");
      updateUserbox(state.profile);
    }
  });

  $("avatar-remove").addEventListener("click", async (e) => {
    const button = e.currentTarget; // после await currentTarget уже пустой
    if (!(await confirmDialog("Вместо фото будут показаны инициалы.", { title: "Удалить фото профиля?", ok: "Удалить" }))) return;
    try {
      await busy(button, "Удаляем…", () => api("DELETE", "/api/profile/avatar"));
      state.profile = { ...(state.profile || {}), avatar_url: null };
      updateUserbox(state.profile);
      toast("Фото удалено");
    } catch (error) {
      toast(error.message, "error");
    }
  });
}

async function loadProfile() {
  const form = $("profile-form");
  formError("profile-error", null);

  const head = document.querySelector("#view-profile .page-head");
  if (head) {
    if (state.profileReason) {
      head.querySelector("h1").textContent = "Заполните профиль";
      head.querySelector("p").textContent =
        `${state.profileReason} Контакты увидит только тот, с кем у вас случится MATCH, — до этого их не видит никто.`;
    } else if (!isProfileComplete(state.profile)) {
      head.querySelector("h1").textContent = "Мой профиль";
      head.querySelector("p").textContent =
        "Профиль понадобится, когда захотите опубликовать проект или откликнуться на чужой. Проверять идеи и искать проекты можно и без него.";
    } else {
      head.querySelector("h1").textContent = "Мой профиль";
      head.querySelector("p").textContent =
        "Контакты и описание. По ним ИИ подбирает проекты, а основатели находят вас сами.";
    }
  }

  try {
    const p = await fetchProfile();
    form.elements.last_name.value = p.last_name || "";
    form.elements.first_name.value = p.first_name || "";
    form.elements.patronymic.value = p.patronymic || "";
    form.elements.email.value = p.email || "";
    form.elements.phone.value = p.phone ? formatRuPhone(p.phone) : "";
    form.elements.goal.value = p.goal || "";
    form.elements.category.value = p.category || "Любая";
    form.elements.about.value = p.about || "";
    form.elements.visible.checked = p.visible;
    form.elements.consent.checked = Boolean(p.consent);
    syncGoalFields();
    renderMaxLink(p);
    state.verifiedPhone = p.phone_verified ? formatRuPhone(p.phone) : null;
    updatePhoneStatus();
    updateUserbox(p);
  } catch (error) {
    formError("profile-error", error);
  }
}

// Кнопка «Написать в MAX» у собеседника после MATCH. Ссылку на профиль MAX нельзя узнать
// через API, поэтому: есть ник — ссылка строится сама; нет — человек пересылает боту
// приглашение из своего профиля, бот сохраняет ссылку, и этот блок обновляется сам (событие profile).
function renderMaxLink(p) {
  const status = $("max-link-status");
  const form = $("profile-form");
  form.elements.max_link.value = p.max_link || "";
  $("max-link-manual").hidden = true;
  $("max-link-toggle").hidden = false;
  if (p.max_link) {
    status.className = "max-link-status ok";
    status.textContent = "✓ Настроена: ссылка на ваш профиль MAX сохранена.";
    $("max-link-toggle").textContent = "Изменить или удалить ссылку";
  } else if (p.max_username) {
    status.className = "max-link-status ok";
    status.textContent = `✓ Настроена автоматически по вашему нику @${p.max_username}.`;
    $("max-link-toggle").textContent = "Указать другую ссылку";
  } else {
    status.className = "max-link-status";
    status.innerHTML =
      "Чтобы после MATCH с вами можно было сразу написать в MAX, перешлите боту ссылку на свой профиль: " +
      "<b>профиль MAX → «Пригласить в друзья» → «Поделиться» → чат с ботом SOBRA</b>. " +
      "Бот сохранит её сам, здесь ничего вставлять не нужно. Без ссылки с вами свяжутся по телефону или e-mail.";
    $("max-link-toggle").textContent = "Указать ссылку вручную";
  }
}

// Бот сохранил ссылку, пока мини-приложение было открыто, — обновляем блок без перезагрузки
async function onProfileEvent() {
  try {
    const p = await fetchProfile();
    if (!$("view-profile").hidden) renderMaxLink(p);
    if (p.max_link) toast("Ссылка на профиль MAX сохранена ✓");
  } catch {
    /* не критично */
  }
}

// Политика обработки персональных данных — поверх экрана, чтобы не терять заполненный профиль.
// Сама страница лежит отдельно (privacy.html): у неё есть и прямой адрес для README и жюри.
function openPrivacy(event) {
  const link = event.target.closest(".privacy-link");
  if (!link) return;
  event.preventDefault(); // ссылка внутри <label> не должна переключать галочку
  const frame = $("privacy-frame");
  if (!frame.getAttribute("src")) frame.setAttribute("src", "privacy.html");
  $("privacy-sheet").hidden = false;
  $("privacy-close").focus();
}

function closePrivacy() {
  $("privacy-sheet").hidden = true;
}

// Для цели «Развиваю свою идею» «О себе» необязательно, а показ профиля основателям не нужен
function syncGoalFields() {
  const own = $("profile-form").elements.goal.value === "own";
  $("about-required").hidden = own;
  $("visible-field").hidden = own;
}

// Контакты нужны только для MATCH, поэтому профиль спрашиваем не на входе, а в момент,
// когда без него не обойтись. reason — зачем он нужен, next — куда вернуться после сохранения.
async function requireProfile(reason, next) {
  const profile = state.profile || (await fetchProfile().catch(() => null));
  if (isProfileComplete(profile)) return true;
  state.profileReason = reason;
  state.afterProfile = next;
  show("profile");
  toast("Сначала заполните профиль — это займёт минуту");
  return false;
}

function setupProfileForm() {
  const form = $("profile-form");
  setupPhoneMask(form.elements.phone);
  form.elements.goal.addEventListener("change", syncGoalFields);
  // Шапка ведёт в профиль. Если он уже открыт — не перезагружаем, чтобы не стереть введённое.
  const openProfile = () => {
    if ($("view-profile").hidden) show("profile");
    else window.scrollTo({ top: 0, behavior: "smooth" });
  };
  $("userbox").addEventListener("click", openProfile);
  // Логотип — на главную («Проекты»), пока идёт вход — ничего не делает
  $("brand").addEventListener("click", () => { if (state.user) show("projects"); });
  $("profile-cta").addEventListener("click", openProfile);
  form.addEventListener("click", openPrivacy);
  $("privacy-close").addEventListener("click", closePrivacy);
  $("privacy-sheet").addEventListener("click", (e) => { if (e.target.id === "privacy-sheet") closePrivacy(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("privacy-sheet").hidden) closePrivacy(); });
  $("max-link-toggle").addEventListener("click", () => {
    $("max-link-manual").hidden = false;
    $("max-link-toggle").hidden = true;
    form.elements.max_link.focus();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    formError("profile-error", null);
    const f = form.elements;

    if (!f.last_name.value.trim()) {
      f.last_name.focus();
      formError("profile-error", new Error("Укажите фамилию."));
      return;
    }
    if (!f.first_name.value.trim()) {
      f.first_name.focus();
      formError("profile-error", new Error("Укажите имя."));
      return;
    }
    if (!f.email.value.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.value.trim())) {
      f.email.focus();
      formError("profile-error", new Error("Укажите корректный e-mail."));
      return;
    }
    const phone = normalizeRuPhone(f.phone.value);
    if (!phone) {
      f.phone.focus();
      formError("profile-error", new Error("Укажите российский номер: +7 900 123-45-67"));
      return;
    }
    if (!f.goal.value) {
      f.goal.focus();
      formError("profile-error", new Error("Выберите, чего хотите."));
      return;
    }
    if (f.goal.value !== "own" && !f.about.value.trim()) {
      f.about.focus();
      formError("profile-error", new Error("Расскажите о себе хотя бы в паре предложений — по этому тексту ИИ подбирает проекты."));
      return;
    }
    // Ссылку отправляем, только если её правили вручную: иначе можно стереть ту, что прислали боту
    const manual = !$("max-link-manual").hidden;
    const maxLink = f.max_link.value.trim();
    if (manual && maxLink && !/^(https?:\/\/)?(www\.)?(max\.ru|max\.me)\/\S+$/i.test(maxLink)) {
      f.max_link.focus();
      formError("profile-error", new Error("Ссылка на профиль MAX должна начинаться с https://max.ru/"));
      return;
    }
    if (!f.consent.checked) {
      f.consent.focus();
      formError("profile-error", new Error("Отметьте согласие: без него контакты нельзя передать после MATCH."));
      return;
    }

    const button = form.querySelector("button[type=submit]");
    try {
      state.profile = await busy(button, "Сохраняем…", () =>
        api("PUT", "/api/profile", {
          last_name: f.last_name.value.trim(),
          first_name: f.first_name.value.trim(),
          patronymic: f.patronymic.value.trim(),
          email: f.email.value.trim(),
          phone,
          goal: f.goal.value,
          category: f.category.value,
          about: f.about.value.trim(),
          ...(manual ? { max_link: maxLink } : {}),
          visible: f.goal.value !== "own" && f.visible.checked,
          consent: true,
        })
      );
      updateUserbox(state.profile);
      renderMaxLink(state.profile);
      // Профиль заполняли по пути (публикация, отклик) — возвращаем человека туда, где он был
      const next = state.afterProfile;
      state.afterProfile = null;
      state.profileReason = null;
      if (next) {
        toast("Профиль сохранён. Продолжаем.");
        next();
      } else {
        toast(f.visible.checked && f.goal.value !== "own" ? "Профиль сохранён. Основатели смогут вас пригласить." : "Профиль сохранён.");
      }
    } catch (error) {
      formError("profile-error", error);
    }
  });
}

// ======================================================
// КАНДИДАТ: ПОИСК ПРОЕКТОВ
// ======================================================

async function prepareSearch() {
  const form = $("search-form");
  const hint = $("search-ai-hint");
  try {
    const p = state.profile || (await fetchProfile());
    if (!form.elements.goal.value && p.goal && p.goal !== "own") form.elements.goal.value = p.goal;
    hint.innerHTML = p.about
      ? "✨ ИИ сравнит каждый проект с вашим профилем и объяснит, насколько вы подходите."
      : `✨ Заполните <button class="text-btn" type="button" id="to-profile">профиль</button>, и ИИ объяснит, насколько вы подходите каждому проекту.`;
    const link = $("to-profile");
    if (link) link.addEventListener("click", () => show("profile"));
  } catch {
    hint.textContent = "";
  }
}

function setupSearchForm() {
  const form = $("search-form");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    formError("search-error", null);
    const f = form.elements;

    if (!f.goal.value) {
      f.goal.focus();
      formError("search-error", new Error("Выберите цель поиска."));
      return;
    }

    const body = {
      goal: f.goal.value,
      category: f.category.value,
      min_stage: f.min_stage.value,
      max_investment: null,
    };
    state.lastSearchGoal = body.goal;

    const results = $("search-results");
    const button = form.querySelector("button[type=submit]");
    loading(results, state.profile?.about ? "Подбираем проекты и сравниваем их с вашим профилем…" : "Ищем проекты…");

    try {
      const { matches, ai } = await busy(button, "Ищем…", () => api("POST", "/api/search", body));
      if (matches.length === 0) {
        empty(results, "Под эти фильтры проектов пока нет. Попробуйте сферу «Любая» или стадию пониже.");
        return;
      }
      results.innerHTML =
        aiNotice(ai, "Заполните профиль, и ИИ объяснит, насколько вы подходите каждому проекту.") +
        matches.map(({ startup, ai: aiItem }) => projectForCandidate(startup, aiItem)).join("");
    } catch (error) {
      failed(results, error, () => form.requestSubmit());
    }
  });

  $("search-results").addEventListener("click", respondClick);
}

// Карточка чужого проекта (в поиске и в приглашениях)
function projectForCandidate(s, ai) {
  const isOwn = state.user && Number(s.founder_id) === state.user.user_id;
  const rows = [
    ["Клиент", s.customer], ["Проблема", s.problem], ["Решение", s.solution],
    ["Спрос", s.traction], ["Кого ищут", s.partner_needed],
  ].filter(([, v]) => v);

  return `<article class="card">
    <div class="project-row">
      <span class="project-icon">${CATEGORY_ICON[s.category] || "💡"}</span>
      <div class="grow">
        <h3>${esc(s.name)}</h3>
        <div class="chips">${demoBadge(s.founder_id)} ${badge(s.stage)} ${badge(s.category, "violet")} ${badge(s.market_type, "gray")}</div>
      </div>
    </div>
    <p class="muted">Ищет: ${esc(seekingText(s))}</p>
    ${s.founder_verified ? `<div class="chips">${verifiedBadge(true, "✓ Основатель подтвердил телефон")}</div>` : ""}
    ${rows.map(([k, v]) => `<p class="answer"><b>${k}.</b> ${esc(v)}</p>`).join("")}
    ${renderAi(ai, "Почему вы подходите")}
    ${isOwn
      ? `<p class="muted">Это ваш проект</p>`
      : `${isDemoId(s.founder_id) ? `<p class="muted demo-note">Демо-проект: основатель вымышленный и примет отклик автоматически — так можно пройти путь до MATCH.</p>` : ""}
         <button class="btn primary block" type="button" data-respond="${s.id}" data-name="${esc(s.name)}" ${isDemoId(s.founder_id) ? "data-demo" : ""}>Откликнуться</button>
         <div class="card-foot">${reportButton("startup", s.id, s.name)}</div>`}
  </article>`;
}

// ======================================================
// ОТКЛИК
// ======================================================

function respondClick(event) {
  const button = event.target.closest("[data-respond]");
  if (!button) return;
  const open = () => openOfferSheet(button.dataset.respond, button.dataset.name, "demo" in button.dataset);
  const back = button.closest(".view")?.id.replace("view-", "") || "search"; // вернуться на тот же экран
  requireProfile("Чтобы откликнуться на проект, заполните профиль.", () => { show(back); open(); }).then((ok) => ok && open());
}

function openOfferSheet(startupId, name, isDemo = false) {
  const form = $("offer-form");
  form.reset();
  formError("offer-error", null);
  state.offerStartupId = Number(startupId);
  state.offerToDemo = isDemo;
  $("offer-project").textContent = name;
  const goal = state.lastSearchGoal || (state.profile?.goal !== "own" ? state.profile?.goal : null);
  if (goal) form.elements.type.value = goal;
  $("offer-sheet").hidden = false;
  form.elements.message.focus();
}

function closeOfferSheet() {
  $("offer-sheet").hidden = true;
  state.offerStartupId = null;
}

function setupOfferForm() {
  const form = $("offer-form");
  $("offer-cancel").addEventListener("click", closeOfferSheet);
  $("offer-sheet").addEventListener("click", (e) => {
    if (e.target.id === "offer-sheet") closeOfferSheet();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    formError("offer-error", null);
    if (!form.elements.message.value.trim()) {
      form.elements.message.focus();
      formError("offer-error", new Error("Напишите пару слов основателю — без сообщения отклик не отправить."));
      return;
    }
    const button = form.querySelector("button[type=submit]");
    try {
      await busy(button, "Отправляем…", () =>
        api("POST", "/api/offers", {
          startup_id: state.offerStartupId,
          type: form.elements.type.value,
          message: form.elements.message.value.trim(),
        })
      );
      closeOfferSheet();
      toast(state.offerToDemo
        ? "Отклик отправлен. Это демо-проект — основатель примет его через несколько секунд."
        : "Отклик отправлен. Основатель получит уведомление в MAX.");
    } catch (error) {
      formError("offer-error", error);
    }
  });
}

// ======================================================
// ОТКЛИКИ И ПРИГЛАШЕНИЯ
// ======================================================

async function loadResponses() {
  const offersEl = $("offers-list");
  const invitesEl = $("invites-list");
  loading(offersEl);
  loading(invitesEl);

  try {
    const [{ offers }, { invites }] = await Promise.all([api("GET", "/api/offers/received"), api("GET", "/api/invites")]);

    if (offers.length === 0) {
      empty(offersEl, "Откликов пока нет. Они появятся, когда кто-то откликнется на ваш опубликованный проект.");
    } else {
      offersEl.innerHTML = offers.map((o) => {
        const st = OFFER_STATUS[o.status] || { text: o.status, tone: "gray" };
        return `<article class="card">
          <div class="chips">${badge(st.text, st.tone)} ${badge(o.type, "gray")} ${demoBadge(o.sender_id)}</div>
          <h3>${esc(o.startup_name)}</h3>
          <div class="person small">${avatarHtml(o.sender_avatar_url, o.sender_name)}
            <p class="muted">От: ${esc(o.sender_name || "пользователь MAX")} · ${dateText(o.created_at)}</p></div>
          ${o.sender_verified ? `<div class="chips">${verifiedBadge(true)}</div>` : ""}
          <p class="answer">${esc(o.message)}</p>
          ${o.status === "new" ? `<div class="actions">
            <button class="btn secondary small" type="button" data-decide="reject" data-id="${o.id}">Отклонить</button>
            <button class="btn primary small" type="button" data-decide="accept" data-id="${o.id}">Принять</button>
          </div>` : ""}
          <div class="card-foot">${reportButton("user", o.sender_id, o.sender_name || "пользователь MAX")}</div>
        </article>`;
      }).join("");
    }

    if (invites.length === 0) {
      empty(invitesEl, "Приглашений пока нет. Откройте профиль для основателей во вкладке «Профиль», чтобы они могли вас найти.");
    } else {
      invitesEl.innerHTML = invites.map((s) => projectForCandidate(s, null)).join("");
    }
  } catch (error) {
    failed(offersEl, error, loadResponses);
    invitesEl.innerHTML = "";
  }
}

async function handleDecision(event) {
  const button = event.target.closest("[data-decide]");
  if (!button) return;
  const accept = button.dataset.decide === "accept";
  try {
    await busy(button, accept ? "Принимаем…" : "Отклоняем…", () =>
      api("POST", `/api/offers/${button.dataset.id}/${accept ? "accept" : "reject"}`)
    );
    toast(accept ? "Это MATCH! Кандидат появился во вкладке «Контакты»." : "Отклик отклонён");
    loadResponses();
  } catch (error) {
    toast(error.message, "error");
  }
}

// ======================================================
// КОНТАКТЫ
// ======================================================

// Телефон и e-mail приходят с сервера только после MATCH и только при согласии человека
function contactLinks(phone, email, maxLink, offerId) {
  const links = [];
  const track = (channel) => `data-track="${channel}" data-offer="${Number(offerId) || ""}"`;
  if (maxLink) links.push(`<button class="contact-link max" type="button" data-max-link="${esc(maxLink)}" ${track("max")}>💬 Написать в MAX</button>`);
  if (phone) links.push(`<a class="contact-link" href="tel:${esc(phone)}" ${track("phone")}>📞 ${esc(formatRuPhone(phone))}</a>`);
  if (email) links.push(`<a class="contact-link" href="mailto:${esc(email)}" ${track("email")}>✉️ ${esc(email)}</a>`);
  if (links.length === 0) return `<p class="muted">Контакты пока не указаны в профиле.</p>`;
  return `<div class="contact-links">${links.join("")}</div>`;
}

// Статистика нажатий на контакты. keepalive — чтобы запрос ушёл, даже если MAX
// сразу откроет чат и свернёт мини-приложение. Ошибки не мешают пользователю.
function trackContactClick(event) {
  const el = event.target.closest("[data-track]");
  if (!el || !el.dataset.offer) return;
  const headers = { "Content-Type": "application/json" };
  if (initData) headers.Authorization = `Bearer ${initData}`;
  else if (debugUserId) headers["X-Debug-User-Id"] = debugUserId;
  try {
    fetch("/api/contacts/click", {
      method: "POST",
      headers,
      body: JSON.stringify({ offer_id: Number(el.dataset.offer), channel: el.dataset.track }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* статистика не критична */
  }
}

// Открывает профиль собеседника в MAX. Внутри MAX — через MAX Bridge (без выхода из приложения),
// в обычном браузере — в новой вкладке.
function openInMax(event) {
  const button = event.target.closest("[data-max-link]");
  if (!button) return;
  const url = button.dataset.maxLink;
  if (!/^https:\/\/(www\.)?(max\.ru|max\.me)\//i.test(url)) return;
  try {
    if (WebApp && typeof WebApp.openMaxLink === "function" && /^https:\/\/(www\.)?max\.ru\//i.test(url)) {
      WebApp.openMaxLink(url);
    } else if (WebApp && typeof WebApp.openLink === "function") {
      WebApp.openLink(url);
    } else {
      window.open(url, "_blank", "noopener");
    }
  } catch {
    window.open(url, "_blank", "noopener");
  }
}

async function loadContacts() {
  const contactsEl = $("contacts-list");
  const matchesEl = $("matches-list");
  loading(contactsEl);
  loading(matchesEl);

  try {
    const [{ contacts }, { matches }] = await Promise.all([api("GET", "/api/contacts"), api("GET", "/api/matches")]);

    if (contacts.length === 0) empty(contactsEl, "Здесь появятся кандидаты, чьи отклики вы примете.");
    else contactsEl.innerHTML = contacts.map((c) => `<article class="card">
        <div class="chips">${badge("MATCH", "green")} ${badge(c.type, "gray")} ${demoBadge(c.candidate_id)}</div>
        <div class="person">${avatarHtml(c.candidate_avatar_url, c.candidate_name)}
          <div class="grow"><h3>${esc(c.candidate_name || "Пользователь MAX")}</h3>
          <p class="muted">Проект: ${esc(c.startup_name)} · ${dateText(c.created_at)}</p>
          <div class="chips">${verifiedBadge(c.candidate_phone_verified)}</div></div></div>
        ${isDemoId(c.candidate_id) ? demoContactsNote("кандидат") : contactLinks(c.candidate_phone, c.candidate_email, c.candidate_max_link, c.offer_id)}
        <p class="answer">${esc(c.message)}</p>
        <div class="card-foot">${reportButton("user", c.candidate_id, c.candidate_name || "пользователь MAX")}</div>
      </article>`).join("");

    if (matches.length === 0) empty(matchesEl, "Здесь появятся проекты, основатели которых приняли ваш отклик.");
    else matchesEl.innerHTML = matches.map((m) => `<article class="card">
        <div class="chips">${badge("MATCH", "green")} ${badge(m.type, "gray")} ${demoBadge(m.founder_id)}</div>
        <h3>${esc(m.startup_name)}</h3>
        <div class="person small">${avatarHtml(m.founder_avatar_url, m.founder_name)}
          <p class="muted">Основатель: ${esc(m.founder_name || (isDemoId(m.founder_id) ? "демо-основатель" : "пользователь MAX"))} · ${dateText(m.created_at)}</p></div>
        ${m.founder_phone_verified ? `<div class="chips">${verifiedBadge(true)}</div>` : ""}
        ${isDemoId(m.founder_id) ? demoContactsNote("основатель") : contactLinks(m.founder_phone, m.founder_email, m.founder_max_link, m.offer_id)}
        <p class="answer"><b>Ваш отклик.</b> ${esc(m.message)}</p>
        <div class="card-foot">${reportButton("user", m.founder_id, `${m.founder_name || "основатель"} (проект «${m.startup_name}»)`)}</div>
      </article>`).join("");
  } catch (error) {
    failed(contactsEl, error, loadContacts);
    matchesEl.innerHTML = "";
  }
}

// ======================================================
// ЗАПУСК
// ======================================================

function showAuthError(message) {
  document.querySelectorAll(".view").forEach((v) => (v.hidden = true));
  $("tabbar").hidden = true;
  $("menu-toggle").hidden = true;
  setNav(false);
  $("view-auth").hidden = false;
  $("auth-text").textContent = message;
  $("user-name").textContent = "Не авторизован";
}

function isProfileComplete(profile) {
  return !needsProfile(profile);
}

function needsProfile(profile) {
  return (
    !profile ||
    !profile.goal ||
    (profile.goal !== "own" && (!profile.about || !String(profile.about).trim())) ||
    !profile.last_name ||
    !String(profile.last_name).trim() ||
    !profile.first_name ||
    !String(profile.first_name).trim() ||
    !profile.email ||
    !String(profile.email).trim() ||
    !profile.phone ||
    !String(profile.phone).trim() ||
    !profile.consent
  );
}

async function authorize() {
  $("tabbar").hidden = false;
  $("menu-toggle").hidden = false;
  setNav(dockMq.matches);

  if (!initData && !debugUserId) {
    showAuthError("Мини-приложение работает только внутри MAX. Откройте его из чата с ботом SOBRA.");
    return;
  }

  try {
    state.user = initData
      ? await api("POST", "/api/auth", { init_data: initData })
      : { user_id: Number(debugUserId), name: "Отладка" };

    // Сначала имя из MAX; после загрузки профиля — Фамилия + Имя из профиля
    updateUserbox(null);

    // Профиль на входе не требуем: сначала человек видит пользу (Idea Check, поиск),
    // а контакты заполняет, когда публикует проект или откликается.
    try {
      updateUserbox(await fetchProfile());
    } catch {
      // если профиль недоступен — всё равно пускаем дальше
    }

    state.onboarding = false;
    show("projects");
    startCounters();
  } catch (error) {
    showAuthError(
      error.status === 401
        ? "Сессия MAX устарела. Закройте мини-приложение и откройте его снова из чата с ботом."
        : error.message
    );
  }
}

document.addEventListener("DOMContentLoaded", () => {
  if (WebApp && typeof WebApp.ready === "function") WebApp.ready();

  setupSideMenu();
  setupNavigation();
  setupIdeaForm();
  setupProfileForm();
  setupAvatar();
  setupPhoneVerification();
  setupReports();
  setupSearchForm();
  setupOfferForm();

  $("projects-list").addEventListener("click", (e) => {
    const target = e.target.closest("[data-open]");
    if (target) openProject(target.dataset.open);
  });
  $("match-list").addEventListener("click", handleInvite);
  $("offers-list").addEventListener("click", handleDecision);
  $("invites-list").addEventListener("click", respondClick);
  $("auth-retry").addEventListener("click", authorize);
  for (const list of ["contacts-list", "matches-list"]) {
    $(list).addEventListener("click", trackContactClick);
    $(list).addEventListener("click", openInMax);
  }

  authorize();
});
