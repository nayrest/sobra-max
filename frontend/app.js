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

async function api(method, path, body, { keepalive = false } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (initData) headers.Authorization = `Bearer ${initData}`;
  else if (debugUserId) headers["X-Debug-User-Id"] = debugUserId;

  let response;
  try {
    // keepalive — запрос дойдёт, даже если пользователь в этот момент закрывает приложение
    response = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined, keepalive });
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
  { id: "legal", field: "legal", title: "Учёт, налоги и документы", q: "Как будете оформлять бизнес и вести учёт?", hint: "Самозанятость, ИП или ООО, налоговый режим, кто ведёт учёт, какие нужны договоры и разрешения. Если ещё не думали — так и напишите." },
];


// Иконки блоков карты (24×24, контуры наследуют цвет статуса)
const BLOCK_ICONS = {
  audience: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="8" r="3.2"/><path d="M2.8 19.5c0-3.2 2.8-5.4 6.2-5.4s6.2 2.2 6.2 5.4z"/><circle cx="17" cy="9" r="2.5"/><path d="M16.4 14.3c2.9-.3 4.8 1.5 4.8 4.2h-4.3c0-1.7-.2-3.2-.5-4.2z"/></svg>',
  problem: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><circle cx="9" cy="10" r=".6" fill="currentColor"/><circle cx="15" cy="10" r=".6" fill="currentColor"/><path d="M8.6 16c1-1.3 2.2-1.9 3.4-1.9s2.4.6 3.4 1.9"/></svg>',
  solution: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 18h5M10.5 21h3"/><path d="M12 3.2a6 6 0 0 0-3.6 10.8c.6.5 1 1.1 1 1.9V16h5.2v-.1c0-.8.4-1.4 1-1.9A6 6 0 0 0 12 3.2z"/></svg>',
  competitors: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 9.5 5 4.5h14l1.5 5"/><path d="M3.5 9.5a2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 2 0"/><path d="M5 12v7.5h14V12M10 19.5v-4.5h4v4.5"/></svg>',
  demand: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="3.5" y="12" width="4.2" height="8" rx="1.1"/><rect x="9.9" y="7" width="4.2" height="13" rx="1.1"/><rect x="16.3" y="3.5" width="4.2" height="16.5" rx="1.1"/></svg>',
  model: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 3.5h6l-1.4 2.6h-3.2z"/><path d="M12 7c-4.2 2.6-6.5 5.4-6.5 8.7 0 2.6 2.2 4.3 6.5 4.3s6.5-1.700 6.500-4.300C18.500 12.400 16.200 9.600 12 7zm-.8 4.300h1.600v.7c.9.100 1.500.5 1.700 1.200h-1.400c-.1-.3-.4-.4-.9-.4-.6 0-.9.200-.9.5 0 .3.300.4 1.100.6 1.300.3 2.100.7 2.100 1.700 0 .8-.6 1.400-1.600 1.600v.7h-1.600v-.7c-1-.2-1.700-.7-1.800-1.500h1.500c.1.300.4.500 1 .5s.9-.2.900-.5-.3-.4-1.200-.6c-1.100-.3-2-.7-2-1.700 0-.8.600-1.400 1.600-1.600z" fill-rule="evenodd"/></svg>',
  economics: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><ellipse cx="9" cy="7" rx="5.5" ry="2.5"/><path d="M3.5 7v4c0 1.400 2.500 2.500 5.500 2.500s5.500-1.100 5.500-2.500V7"/><path d="M3.5 11v4c0 1.400 2.500 2.500 5.500 2.500"/><ellipse cx="16" cy="15" rx="5" ry="2.300"/><path d="M11 15v4c0 1.300 2.200 2.300 5 2.300s5-1 5-2.300v-4"/></svg>',
  legal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M6.500 3h7.500l4.500 4.500V20a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v4.500h4.500M8.500 12.500h7M8.500 16h7"/></svg>',
};

// Какая компетенция закрывает непроработанный блок карты
const COMPETENCE = {
  audience: "исследование аудитории", problem: "интервью с клиентами", solution: "продукт",
  competitors: "анализ рынка", demand: "маркетинг и продажи", model: "монетизация",
  economics: "финансы и юнит-экономика", legal: "учёт, налоги и право (бухгалтер, юрист)",
};

// Формат участия, который ИИ предлагает для кандидата
const PARTICIPATION = {
  cofounder: "Сооснователь", partner: "Партнёр на часть времени",
  specialist: "Внешний специалист", consult: "Разовая консультация",
};

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
  intent: null, // с чем пришёл: idea — только проверить идею, partner — найти партнёра, join — присоединиться
  pro: { clicked: false, dismissed: false }, // SOBRA AI Premium: нажал «Оформить Premium» / закрыл предложение
  premiumSheetShown: false, // всплывающая панель Premium уже была в этой сессии
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
// checkbox — подпись необязательной галочки; тогда результат { ok, checked }, иначе true/false
function confirmDialog(text, { title = "Подтвердите действие", ok = "Да", danger = true, checkbox = null } = {}) {
  return new Promise((resolve) => {
    const sheet = $("confirm-sheet");
    const okBtn = $("confirm-ok");
    const cancelBtn = $("confirm-cancel");
    $("confirm-title").textContent = title;
    $("confirm-text").textContent = text;
    okBtn.textContent = ok;
    okBtn.className = `btn ${danger ? "danger" : "primary"}`;
    $("confirm-check-wrap").hidden = !checkbox;
    $("confirm-check").checked = false; // по умолчанию — безопасный вариант
    $("confirm-check-text").textContent = checkbox || "";
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
    const result = (ok) => (checkbox ? { ok, checked: ok && $("confirm-check").checked } : ok);
    const onOk = () => close(result(true));
    const onCancel = () => close(result(false));
    const onBackdrop = (e) => { if (e.target === sheet) close(result(false)); };
    const onKey = (e) => { if (e.key === "Escape") close(result(false)); };

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
  return s.seeking || "Только проверка идеи";
}

// ======================================================
// НАВИГАЦИЯ
// ======================================================

// view → вкладка нижнего меню, к которой он относится
const VIEW_TAB = {
  projects: "projects", idea: "projects", project: "projects", match: "projects",
  search: "search", responses: "responses", contacts: "contacts", profile: "profile", plans: "profile",
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
    renderBotBanner(counters);
  } catch {
    // счётчики не критичны — при ошибке просто не показываем
  }
}

// Пилот: 6 из 10 откликов ждали ответа — основатели не нажимали «Начать», и бот не мог им написать.
// Сервер помечает таких людей, когда уведомление не дошло; после «Начать» плашка исчезает сама.
function renderBotBanner({ bot_unreachable, pending } = {}) {
  const banner = $("bot-banner");
  if (!banner) return;
  banner.hidden = !bot_unreachable;
  $("bot-banner-pending").textContent = bot_unreachable && pending > 0
    ? ` Откликов на ваши проекты ждут ответа: ${pending} — они во вкладке «Отклики».`
    : "";
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
  if (view !== "match") closePremiumSheet();
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
              ${s.status === "published" ? badge("Опубликован", "green") : s.seeking ? badge("Черновик", "amber") : badge("Проверка идеи", "blue")}
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
// Пилот показал: в webview MAX localStorage сохраняется не всегда, и ответы пропадали.
// Поэтому черновик пишется и на устройство, и на сервер (через секунду после ввода
// и при сворачивании приложения). При открытии формы берётся более свежий из двух.
// ======================================================

const IDEA_FORM_FIELDS = ["name", "category", "market_type", "stage", "seeking", ...BLOCKS.map((b) => b.field), PARTNER_QUESTION.field, "skills"];
const DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1000; // черновик старше 30 дней не восстанавливаем

// Ключ на сервере: «idea-draft» или «task-draft:15». На устройстве — с номером пользователя.
const draftKey = (kind, id = "") => `${kind}${id ? ":" + id : ""}`;
const localDraftKey = (key) => {
  const [kind, id] = key.split(":");
  return `sobra:${kind}:${state.user?.user_id || "anon"}${id ? ":" + id : ""}`;
};
const draftHasText = (data) => Object.values(data || {}).some((v) => typeof v === "string" && v.trim());

const draftQueue = new Map(); // key → данные (null — удалить), ещё не отправленные на сервер
let draftTimer = null;

function flushDrafts(keepalive = false) {
  clearTimeout(draftTimer);
  for (const [key, data] of draftQueue) {
    draftQueue.delete(key);
    const path = `/api/drafts/${encodeURIComponent(key)}`;
    const request = data ? api("PUT", path, { data }, { keepalive }) : api("DELETE", path, null, { keepalive });
    request.catch(() => {
      // нет связи — повторим при следующем сохранении, если новых данных ещё не было
      if (!draftQueue.has(key)) draftQueue.set(key, data);
    });
  }
}

// Приложение сворачивают или закрывают — отправляем несохранённое сразу
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushDrafts(true);
});
window.addEventListener("pagehide", () => flushDrafts(true));

function draftSave(key, data) {
  const hasText = draftHasText(data);
  try {
    if (hasText) localStorage.setItem(localDraftKey(key), JSON.stringify({ data, at: Date.now() }));
    else localStorage.removeItem(localDraftKey(key));
  } catch {
    // хранилище устройства недоступно — останется копия на сервере
  }
  draftQueue.set(key, hasText ? data : null);
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => flushDrafts(), 1000);
}

function draftLoadLocal(key) {
  try {
    const raw = JSON.parse(localStorage.getItem(localDraftKey(key)) || "null");
    if (!raw || !raw.data || Date.now() - raw.at > DRAFT_TTL_MS) return null;
    return raw;
  } catch {
    return null;
  }
}

// Более свежий из двух черновиков: на устройстве и на сервере
async function draftLoad(key) {
  const local = draftLoadLocal(key);
  if (draftQueue.has(key)) return local?.data || null; // локальный ещё не успел уйти на сервер — он новее
  try {
    const remote = await api("GET", `/api/drafts/${encodeURIComponent(key)}`);
    if (!local || new Date(remote.updated_at).getTime() >= local.at) return remote.data;
    return local.data;
  } catch {
    return local?.data || null; // 404 — черновика на сервере нет; или нет связи
  }
}

function draftClear(key) {
  try {
    localStorage.removeItem(localDraftKey(key));
  } catch {
    /* ignore */
  }
  draftQueue.set(key, null);
  flushDrafts();
}

function ideaDraftData(form) {
  const data = {};
  for (const name of IDEA_FORM_FIELDS) data[name] = form.elements[name].value;
  data.autofill_text = $("autofill-text").value; // «Быстрый старт» тоже не должен теряться
  data.want_partner = $("want-partner").checked ? "yes" : "no";
  return data;
}

// Режим «только проверить идею» (отзыв экспертов): без вопросов о партнёре.
// Партнёра можно включить позже — из карты проекта.
function wantsPartner() {
  return $("want-partner").checked;
}

function applyPartnerMode() {
  const want = wantsPartner();
  $("seeking-field").hidden = !want;
  const partnerField = $("idea-form").elements.partner_needed.closest(".field");
  if (partnerField) partnerField.hidden = !want;
  if ($("idea-skills-field")) $("idea-skills-field").hidden = !want;
  renderWizard(); // шаг «Кого ищете» появляется или исчезает
}

// ======================================================
// ПОШАГОВЫЙ РЕЖИМ ПРОВЕРКИ ИДЕИ
// Отзыв тестировщика: «очень много текста — пугает; хочется интерактив».
// Та же форма, но по одному вопросу на экран: прогресс, «Назад», «Дальше», «Пропустить».
// Первый шаг — «Быстрый старт»: пара предложений, остальное заполнит ИИ.
// Можно переключиться на всю форму сразу — выбор запоминается на устройстве.
// ======================================================

const WIZARD_OFF_KEY = "sobra:wizard-off";
const wizard = { on: true, i: 0, ready: false };

function wizardSteps() {
  const steps = [
    { id: "quick", title: "Быстрый старт", next: "Дальше без ИИ →" },
    { id: "about", title: "О проекте", required: ["name", "category", "market_type", "stage"] },
    ...BLOCKS.map((b) => ({ id: b.id, title: b.title, required: b.required ? [b.field] : [], fields: [b.field], optional: !b.required })),
  ];
  if (wantsPartner()) steps.push({ id: "partner", title: "Кого ищете", required: ["seeking", "partner_needed"] });
  return steps;
}

function setupWizard() {
  const form = $("idea-form");
  const view = $("view-idea");
  // Помечаем, какие поля к какому шагу относятся
  view.querySelector(".autofill-card").dataset.wstep = "quick";
  for (const name of ["name", "category", "market_type", "stage"]) form.elements[name].closest(".field").dataset.wstep = "about";
  form.querySelector(".switch-field").dataset.wstep = "about";
  for (const b of BLOCKS) form.elements[b.field].closest(".field").dataset.wstep = b.id;
  const partnerField = form.elements.partner_needed.closest(".field");
  partnerField.dataset.wstep = "partner";
  partnerField.before($("seeking-field")); // «Кого ищете» — рядом с вопросом о партнёре, на одном шаге
  $("seeking-field").dataset.wstep = "partner";
  $("idea-skills-field").dataset.wstep = "partner";

  try {
    wizard.on = localStorage.getItem(WIZARD_OFF_KEY) !== "1";
  } catch {
    /* хранилище недоступно — по умолчанию пошагово */
  }

  $("wizard-next").addEventListener("click", wizardNext);
  $("wizard-back").addEventListener("click", () => wizardGo(wizard.i - 1));
  $("wizard-skip").addEventListener("click", () => wizardGo(wizard.i + 1));
  $("wizard-toggle").addEventListener("click", () => {
    wizard.on = !wizard.on;
    try {
      if (wizard.on) localStorage.removeItem(WIZARD_OFF_KEY);
      else localStorage.setItem(WIZARD_OFF_KEY, "1");
    } catch {
      /* не запомним — не страшно */
    }
    renderWizard();
  });
  // Начал отвечать — подсказку «ответьте на вопрос» убираем
  form.addEventListener("input", () => { if (wizard.on) formError("idea-error", null); });
  // Enter в однострочном поле — «Дальше», а не отправка всей формы
  form.addEventListener("keydown", (e) => {
    if (wizard.on && e.key === "Enter" && e.target.tagName === "INPUT") {
      e.preventDefault();
      wizardNext();
    }
  });
  wizard.ready = true;
  renderWizard();
}

function wizardGo(index, focus = true) {
  const steps = wizardSteps();
  wizard.i = Math.max(0, Math.min(index, steps.length - 1));
  formError("idea-error", null);
  renderWizard(focus);
  if (wizard.on) window.scrollTo({ top: 0, behavior: "smooth" });
}

// Перейти к шагу, где находится поле (например, обязательное и пустое)
function wizardGoToField(name) {
  const index = wizardSteps().findIndex((st) => (st.required || []).includes(name));
  if (index >= 0) wizardGo(index);
}

function wizardNext() {
  const form = $("idea-form");
  const steps = wizardSteps();
  const step = steps[wizard.i];
  const empty = (step.required || []).find((name) => !form.elements[name].value.trim());
  if (empty) {
    form.elements[empty].focus();
    formError("idea-error", new Error("Ответьте на этот вопрос — без него карта не построится. Можно коротко, потом уточните."));
    return;
  }
  if (wizard.i === steps.length - 1) {
    form.requestSubmit(); // последний шаг — строим карту
    return;
  }
  wizardGo(wizard.i + 1);
}

// Необязательный шаг: пока поле пустое — одна кнопка «Пропустить →», когда ответ есть — «Дальше →».
// Две кнопки, которые делают одно и то же, только путают. На последнем шаге всегда «Построить карту».
function updateWizardButtons() {
  if (!wizard.ready || !wizard.on) return;
  const form = $("idea-form");
  const steps = wizardSteps();
  const step = steps[wizard.i];
  if (!step) return;
  const last = wizard.i === steps.length - 1;
  const filled = (step.fields || []).some((name) => form.elements[name].value.trim());
  const skipOnly = step.optional && !last && !filled;
  $("wizard-skip").hidden = !skipOnly;
  $("wizard-next").hidden = skipOnly;
}

function renderWizard(focus = false) {
  if (!wizard.ready) return;
  const view = $("view-idea");
  const form = $("idea-form");
  view.classList.toggle("wizard-on", wizard.on);
  $("wizard-toggle").textContent = wizard.on ? "Показать все вопросы сразу" : "Отвечать по одному вопросу";
  $("wizard-nav").hidden = !wizard.on;

  if (!wizard.on) {
    view.querySelectorAll(".wstep-hide").forEach((el) => el.classList.remove("wstep-hide"));
    return;
  }

  const steps = wizardSteps();
  wizard.i = Math.max(0, Math.min(wizard.i, steps.length - 1));
  const step = steps[wizard.i];
  const last = wizard.i === steps.length - 1;

  view.querySelectorAll("[data-wstep]").forEach((el) => el.classList.toggle("wstep-hide", el.dataset.wstep !== step.id));
  // Карточки формы показываем, только если в них есть поля текущего шага
  form.querySelectorAll(":scope > .card").forEach((card) =>
    card.classList.toggle("wstep-hide", !card.querySelector(`[data-wstep="${step.id}"]`))
  );

  $("wizard-count").textContent = `Шаг ${wizard.i + 1} из ${steps.length} · ${step.title}`;
  $("wizard-bar").style.width = `${Math.round(((wizard.i + 1) / steps.length) * 100)}%`;
  $("wizard-back").hidden = wizard.i === 0;
  $("wizard-next").textContent = last ? "Построить карту проекта →" : step.next || "Дальше →";
  updateWizardButtons();

  if (focus) {
    const target = step.id === "quick"
      ? $("autofill-text")
      : view.querySelector(`[data-wstep="${step.id}"]:not(.switch-field) .input`);
    if (target) setTimeout(() => target.focus({ preventScroll: true }), 50);
  }
}

function setupIdeaForm() {
  const form = $("idea-form");
  $("idea-questions").innerHTML = [...BLOCKS, { ...PARTNER_QUESTION, required: true }].map(questionField).join("") +
    `<div class="field wide" id="idea-skills-field"><span>Какие навыки нужны <span class="field-hint">— по тегам ИИ быстрее найдёт людей</span></span>${skillPickerHtml()}</div>`;
  setupSkillPicker($("idea-skills-field").querySelector("[data-skill-picker]"));

  let saveTimer = null;
  const saveNow = () => {
    clearTimeout(saveTimer);
    saveTimer = null;
    const data = ideaDraftData(form);
    draftSave(draftKey("idea-draft"), data);
    $("idea-draft-note").hidden = !draftHasText(data);
  };
  const saveDraft = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 300);
  };
  form.addEventListener("input", saveDraft);
  form.addEventListener("change", saveDraft);
  // Свернули приложение сразу после ввода — сохраняем, не дожидаясь паузы
  const saveOnHide = () => {
    if (!saveTimer) return;
    saveNow();
    flushDrafts(true);
  };
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && saveOnHide());
  window.addEventListener("pagehide", saveOnHide);
  $("autofill-text").addEventListener("input", saveDraft); // поле «Быстрого старта» стоит вне формы
  form.addEventListener("input", updateWizardButtons); // «Пропустить» ↔ «Дальше» по мере ввода
  $("want-partner").addEventListener("change", applyPartnerMode);
  setupWizard();

  $("open-idea").addEventListener("click", async () => {
    formError("idea-error", null);
    form.reset();
    $("autofill-text").value = "";
    formError("autofill-error", null);
    $("idea-draft-note").hidden = true;
    // Пришёл «только проверить идею» — вопросов о партнёре по умолчанию нет
    $("want-partner").checked = state.intent !== "idea";
    wizard.i = 0; // пошаговый режим начинается с «Быстрого старта»
    applyPartnerMode();
    refreshSkillPickers(form);
    show("idea");

    // Черновик может прийти с сервера не мгновенно — подставляем, только если человек ещё ничего не начал вводить
    const draft = await draftLoad(draftKey("idea-draft"));
    const untouched = !$("autofill-text").value.trim() && IDEA_FORM_FIELDS.every((name) => !form.elements[name].value.trim());
    if (draft && draftHasText(draft) && untouched) {
      if (LEGACY_CATEGORY[draft.category]) draft.category = LEGACY_CATEGORY[draft.category];
      for (const name of IDEA_FORM_FIELDS) if (typeof draft[name] === "string") form.elements[name].value = draft[name];
      if (typeof draft.autofill_text === "string") $("autofill-text").value = draft.autofill_text;
      if (draft.want_partner === "yes" || draft.want_partner === "no") {
        $("want-partner").checked = draft.want_partner === "yes";
      }
      // Черновик с ответами — продолжаем с первого незаполненного обязательного шага
      const steps = wizardSteps();
      const firstEmpty = steps.findIndex((st, i) => i > 0 && (st.required || []).some((n) => !form.elements[n].value.trim()));
      wizard.i = firstEmpty > 0 ? firstEmpty : 1;
      applyPartnerMode();
      refreshSkillPickers(form);
      $("idea-draft-note").hidden = false;
      toast("Восстановили незаконченную проверку идеи");
    }
  });

  // Быстрый старт: ИИ раскладывает описание по полям. Поля, которые ИИ заполнил, ненадолго подсвечиваются.
  $("autofill-btn").addEventListener("click", async (e) => {
    const button = e.currentTarget;
    formError("autofill-error", null);
    const description = $("autofill-text").value.trim();
    if (description.length < 15) {
      $("autofill-text").focus();
      formError("autofill-error", new Error("Опишите идею хотя бы в одном-двух предложениях: что делаете, для кого и кого ищете."));
      return;
    }
    const hasAnswers = IDEA_FORM_FIELDS.some((name) => form.elements[name].value.trim());
    if (hasAnswers && !(await confirmDialog("Ответы в форме заменятся предложениями ИИ. Потом их можно поправить.", { title: "Заполнить форму заново?", ok: "Заполнить", danger: false }))) return;
    try {
      const { fields } = await busy(button, "ИИ заполняет форму…", () => api("POST", "/api/startups/autofill", { description }));
      // В описании сказано «ищу co-founder'а / людей в команду» — включаем вопросы о партнёре сами.
      // Обратно не выключаем: галочку мог поставить сам человек или выбранный сценарий.
      const partnerTurnedOn = fields.wants_partner === true && !wantsPartner();
      if (partnerTurnedOn) {
        $("want-partner").checked = true;
        applyPartnerMode();
        const sw = $("want-partner").closest(".switch-field");
        sw.classList.add("autofilled");
        setTimeout(() => sw.classList.remove("autofilled"), 2500);
      }
      for (const name of IDEA_FORM_FIELDS) {
        const el = form.elements[name];
        if (typeof fields[name] !== "string") continue;
        el.value = fields[name];
        const wrapper = el.closest(".field");
        if (wrapper && fields[name]) {
          wrapper.classList.add("autofilled");
          setTimeout(() => wrapper.classList.remove("autofilled"), 2500);
        }
      }
      // Теги нужных навыков из фразы «ищу …» — только если человек ещё не выбрал свои
      const picker = $("idea-skills-field")?.querySelector("[data-skill-picker]");
      if (picker && Array.isArray(fields.skills) && fields.skills.length && !pickerValue(picker).length) {
        setSkills(picker, fields.skills);
        $("idea-skills-field").classList.add("autofilled");
        setTimeout(() => $("idea-skills-field").classList.remove("autofilled"), 2500);
      }
      saveDraft();
      if (wizard.on) {
        toast(partnerTurnedOn
          ? "ИИ заполнил ответы и включил поиск партнёра — вы пишете, что ищете людей в команду. Проверьте каждый шаг."
          : "ИИ заполнил ответы. Проверьте каждый шаг и нажимайте «Дальше».");
        wizardGo(1);
      } else {
        toast(partnerTurnedOn
          ? "Черновик готов, поиск партнёра включён. Проверьте ответы и поправьте, где ИИ ошибся."
          : "Черновик готов. Проверьте ответы и поправьте, где ИИ ошибся.");
        form.querySelector(".card").scrollIntoView({ behavior: "smooth", block: "start" });
      }
    } catch (error) {
      formError("autofill-error", error);
    }
  });

  $("idea-draft-clear").addEventListener("click", async () => {
    if (!(await confirmDialog("Все ответы в форме будут удалены.", { title: "Очистить форму?", ok: "Очистить" }))) return;
    form.reset();
    $("autofill-text").value = "";
    $("want-partner").checked = state.intent !== "idea";
    wizard.i = 0;
    applyPartnerMode();
    refreshSkillPickers(form);
    draftClear(draftKey("idea-draft"));
    $("idea-draft-note").hidden = true;
    formError("idea-error", null);
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    formError("idea-error", null);
    const f = form.elements;

    const want = wantsPartner();
    const required = ["name", "category", "market_type", "stage", "customer", "problem", "solution",
      ...(want ? ["seeking", "partner_needed"] : [])];
    const emptyField = required.find((name) => !f[name].value.trim());
    if (emptyField) {
      if (wizard.on) wizardGoToField(emptyField);
      f[emptyField].focus();
      formError("idea-error", new Error("Заполните поля со звёздочкой. Остальные можно дописать позже — они попадут в карту как «не проработано»."));
      return;
    }

    const body = {
      name: f.name.value.trim(),
      category: f.category.value,
      market_type: f.market_type.value,
      stage: f.stage.value,
      investment_amount: null,
    };
    for (const { field } of BLOCKS) body[field] = f[field].value.trim();
    // Без партнёра поле «Кого ищете» не отправляем — сервер создаст проект «только проверка идеи»
    if (want) {
      body.seeking = f.seeking.value;
      body.partner_needed = f.partner_needed.value.trim();
      body.skills = pickerValue(form.querySelector("[data-skill-picker]"));
    }

    // В пошаговом режиме нажимают «Построить карту» — блокируем именно её, а не скрытую кнопку формы.
    // Флаг защищает от двойного нажатия: иначе создавались бы два одинаковых проекта.
    if (state.ideaSubmitting) return;
    state.ideaSubmitting = true;
    const button = wizard.on ? $("wizard-next") : form.querySelector("button[type=submit]");
    $("wizard-back").disabled = true;
    try {
      const startup = await busy(button, "SOBRA строит карту…", () => api("POST", "/api/startups", body));
      draftClear(draftKey("idea-draft"));
      $("idea-draft-note").hidden = true;
      form.reset();
      refreshSkillPickers(form);
      toast("Карта проекта готова");
      openProject(startup.id);
    } catch (error) {
      formError("idea-error", error);
    } finally {
      state.ideaSubmitting = false;
      $("wizard-back").disabled = false;
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
      text: !s.seeking ? "По желанию" : published ? "Подобрать партнёра" : "Сначала опубликуйте",
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
  // Сначала то, что совсем не проработано, потом гипотезы
  const gapRank = (b) => ((map[b.id]?.status || "missing") === "missing" ? 0 : 1);
  const competences = BLOCKS.filter((b) => (map[b.id]?.status || (s[b.field] ? "hypothesis" : "missing")) !== "confirmed")
    .sort((a, b) => gapRank(a) - gapRank(b)).map((b) => COMPETENCE[b.id]).filter(Boolean);

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
            ${published ? badge("Опубликован", "green") : s.seeking ? badge("Черновик", "amber") : badge("Проверка идеи", "blue")}
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

    ${linksCard(s)}

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

    ${!s.seeking ? soloMatchCard(s, missingTitles) : `<section class="card insight" id="match-card">
      <p class="eyebrow">Шаг 5 · AI Match</p>
      <h3>${esc(seekingText(s))}</h3>
      <p>${esc(s.partner_needed || "Не указано")}</p>
      ${projectSkillsBlock(s)}
      ${competences.length ? `<div class="need-skills"><p class="cand-col-title">Каких компетенций не хватает по карте</p>
        <p class="muted">${esc(competences.slice(0, 4).join(" · "))}</p>
        <p class="muted small">ИИ учитывает это при подборе. Не всегда нужен сооснователь: для договора хватит разовой консультации юриста, для учёта — внешнего бухгалтера.</p></div>` : ""}
      ${published
        ? `<button class="btn primary block" type="button" id="go-match">Подобрать партнёра →</button>
           <div class="actions"><button class="btn danger small" type="button" id="delete-project">Удалить проект</button></div>`
        : `<p class="muted">Опубликуйте проект, чтобы кандидаты могли откликаться, а ИИ — подбирать людей.</p>
           <div class="actions">
             <button class="btn danger small" type="button" id="delete-project">Удалить черновик</button>
             <button class="btn primary" type="button" id="publish-project">Опубликовать</button>
           </div>`}
    </section>`}
  `;

  const box = $("project-detail");
  box.querySelectorAll("[data-edit]").forEach((btn) => btn.addEventListener("click", () => editBlock(s, btn.dataset.edit)));
  box.querySelectorAll("[data-scroll]").forEach((btn) =>
    btn.addEventListener("click", () => $(btn.dataset.scroll)?.scrollIntoView({ behavior: "smooth", block: "start" }))
  );
  setupTasks(s);
  setupLinks(s);
  setupProjectSkills(s);

  $("delete-project").addEventListener("click", async (e) => {
    const button = e.currentTarget; // после await currentTarget уже пустой
    // С кем по этому проекту уже был MATCH — им можно оставить контакты или убрать их
    let matches = 0;
    if (published) {
      try {
        const { contacts } = await api("GET", "/api/contacts");
        matches = contacts.filter((c) => Number(c.startup_id) === Number(s.id)).length;
      } catch {
        /* не узнали — просто не предлагаем галочку */
      }
    }
    const text = !published
      ? "Проект и его карта будут удалены. Это действие нельзя отменить."
      : matches
        ? `Проект пропадёт из поиска и подбора, а отклики на него — из «Откликов» (ожидающие будут отклонены). MATCH с участниками: ${matches}. Если не отмечать галочку, контакты останутся в «Контактах» у вас и у них. Действие нельзя отменить.`
        : "Проект пропадёт из поиска и подбора, а отклики на него — из «Откликов» (ожидающие будут отклонены). Действие нельзя отменить.";
    const answer = await confirmDialog(text, {
      title: published ? "Удалить проект?" : "Удалить черновик?",
      ok: "Удалить",
      checkbox: matches ? `Удалить и контакты с участниками (${matches}) — они получат уведомление` : null,
    });
    const confirmed = typeof answer === "object" ? answer.ok : answer;
    const dropContacts = typeof answer === "object" && answer.checked;
    if (!confirmed) return;
    try {
      await busy(button, "Удаляем…", () => api("DELETE", `/api/startups/${s.id}${dropContacts ? "?drop_contacts=1" : ""}`));
      toast(!published ? "Черновик удалён" : dropContacts ? "Проект и контакты по нему удалены" : "Проект удалён");
      show("projects");
    } catch (error) {
      toast(error.message, "error");
    }
  });

  if (!s.seeking) {
    setupSoloMatch(s);
  } else if (published) {
    $("go-match").addEventListener("click", () => show("match"));
  } else {
    $("publish-project").addEventListener("click", async (e) => {
      const button = e.currentTarget;
      const again = () => { state.currentProjectId = s.id; show("project"); };
      if (!(await requireProfile("Чтобы опубликовать проект, заполните профиль.", again))) return;
      try {
        await busy(button, "Публикуем…", () => api("POST", `/api/startups/${s.id}/publish`));
        toast("Проект опубликован. Теперь подберите партнёра ↓");
        // После перерисовки карта прыгает наверх — возвращаем человека к следующему шагу
        // и подсвечиваем кнопку (отзыв пилота: кнопку «Подобрать партнёра» не находили)
        await loadProject(s.id);
        const next = $("go-match");
        if (next) {
          next.scrollIntoView({ behavior: "smooth", block: "center" });
          next.classList.add("pulse");
          setTimeout(() => next.classList.remove("pulse"), 4000);
        }
      } catch (error) {
        toast(error.message, "error");
      }
    });
  }
}

// Теги нужных навыков у проекта: показать и поправить без пересчёта карты
function projectSkillsBlock(s) {
  const tags = Array.isArray(s.skills) ? s.skills : [];
  return `<div id="project-skills">
    ${tags.length ? skillTags(tags) : `<p class="muted small">Добавьте теги навыков — по ним видно совпадения с кандидатами, и ИИ точнее подбирает людей.</p>`}
    <button class="text-btn" type="button" id="skills-edit">${tags.length ? "Изменить теги" : "+ Добавить теги навыков"}</button>
    <form id="skills-form" class="skill-edit" hidden novalidate>
      ${skillPickerHtml()}
      <p class="form-error" id="skills-error" hidden></p>
      <div class="actions">
        <button class="btn secondary small" type="button" id="skills-cancel">Отмена</button>
        <button class="btn primary small" type="submit">Сохранить теги</button>
      </div>
    </form>
  </div>`;
}

function setupProjectSkills(s) {
  const form = $("skills-form");
  if (!form) return;
  const picker = form.querySelector("[data-skill-picker]");
  setupSkillPicker(picker);
  const toggle = (open) => {
    form.hidden = !open;
    $("skills-edit").hidden = open;
    if (open) setSkills(picker, s.skills || []);
  };
  $("skills-edit").addEventListener("click", () => toggle(true));
  $("skills-cancel").addEventListener("click", () => toggle(false));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    formError("skills-error", null);
    try {
      const updated = await busy(form.querySelector("button[type=submit]"), "Сохраняем…", () =>
        api("PATCH", `/api/startups/${s.id}`, { skills: pickerValue(picker) })
      );
      renderProject(updated);
      $("match-card")?.scrollIntoView({ block: "center" });
      toast("Теги сохранены");
    } catch (error) {
      formError("skills-error", error);
    }
  });
}

// Проект «только проверка идеи»: карта и план уже есть, партнёр — по желанию.
// Включить подбор = указать, кого ищем; дальше обычный путь: публикация → AI Match.
function soloMatchCard(s, missingTitles) {
  return `<section class="card insight" id="match-card">
    <p class="eyebrow">Шаг 5 · AI Match · по желанию</p>
    <h3>Партнёр сейчас не нужен</h3>
    <p class="muted">Карта и план уже ваши. Продолжайте проверять идею — SOBRA будет пересчитывать карту по вашим результатам.</p>
    ${missingTitles.length ? `<p class="muted">Если не хватает рук или опыта (пока не подтверждено: ${esc(missingTitles.slice(0, 3).join(", "))}) — включите подбор, и ИИ найдёт людей с нужными навыками.</p>` : ""}
    <form id="solo-partner-form" class="solo-partner" hidden novalidate>
      <label class="field"><span>Кого ищете <b class="required">*</b></span>
        <select class="input" name="seeking">
          <option value="">Выберите</option><option>Команда / co-founder</option><option>Партнёрство</option>
        </select></label>
      <label class="field"><span>${esc(PARTNER_QUESTION.q)} <b class="required">*</b></span>
        <textarea class="input textarea" name="partner_needed" maxlength="1000" placeholder="${esc(PARTNER_QUESTION.hint)}"></textarea></label>
      <div class="field"><span>Какие навыки нужны</span>${skillPickerHtml()}</div>
      <p class="form-error" id="solo-partner-error" hidden></p>
      <div class="actions">
        <button class="btn secondary small" type="button" id="solo-partner-cancel">Отмена</button>
        <button class="btn primary small" type="submit">Сохранить</button>
      </div>
    </form>
    <div class="actions" id="solo-actions">
      <button class="btn danger small" type="button" id="delete-project">Удалить проект</button>
      <button class="btn secondary" type="button" id="solo-enable">🤝 Найти партнёра</button>
    </div>
  </section>`;
}

function setupSoloMatch(s) {
  const form = $("solo-partner-form");
  setupSkillPicker(form.querySelector("[data-skill-picker]"));
  const toggle = (open) => {
    form.hidden = !open;
    $("solo-enable").hidden = open;
    if (open) form.elements.seeking.focus();
  };
  $("solo-enable").addEventListener("click", () => toggle(true));
  $("solo-partner-cancel").addEventListener("click", () => toggle(false));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    formError("solo-partner-error", null);
    const seeking = form.elements.seeking.value;
    const partner = form.elements.partner_needed.value.trim();
    if (!seeking || !partner) {
      formError("solo-partner-error", new Error("Выберите, кого ищете, и опишите, какие навыки нужны."));
      return;
    }
    try {
      const updated = await busy(form.querySelector("button[type=submit]"), "Сохраняем…", () =>
        api("PATCH", `/api/startups/${s.id}`, { seeking, partner_needed: partner, skills: pickerValue(form.querySelector("[data-skill-picker]")) })
      );
      renderProject(updated);
      toast("Готово. Опубликуйте проект — и ИИ подберёт людей");
      const next = $("publish-project");
      if (next) {
        next.scrollIntoView({ behavior: "smooth", block: "center" });
        next.classList.add("pulse");
        setTimeout(() => next.classList.remove("pulse"), 4000);
      }
    } catch (error) {
      formError("solo-partner-error", error);
    }
  });
}

// ======================================================
// МАТЕРИАЛЫ ПРОЕКТА: Figma, презентация, лендинг, финмодель
// Отзыв тестировщика: «текст — хорошо, но партнёры хотят видеть, что уже сделано руками».
// ======================================================

const LINK_KINDS = {
  figma: { icon: "🎨", text: "Прототип" },
  deck: { icon: "📊", text: "Презентация" },
  landing: { icon: "🌐", text: "Сайт" },
  finmodel: { icon: "📈", text: "Финмодель" },
  other: { icon: "📎", text: "Материал" },
};
const LINKS_MAX = 4;

const linkHost = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

function linkChips(links) {
  if (!Array.isArray(links) || links.length === 0) return "";
  return `<div class="link-chips">${links.map((l) => {
    const k = LINK_KINDS[l.kind] || LINK_KINDS.other;
    return `<button type="button" class="link-chip" data-ext-link="${esc(l.url)}" title="${esc(l.url)}">${k.icon} ${esc(k.text)}</button>`;
  }).join("")}</div>`;
}

function linksCard(s) {
  const links = Array.isArray(s.links) ? s.links : [];
  return `<section class="card" id="links-card">
    <p class="eyebrow">Материалы проекта</p>
    <h3>Что уже сделано руками</h3>
    <p class="muted">Прототип, презентация, сайт или финмодель — кандидаты увидят ссылки в карточке проекта.</p>
    ${links.length ? `<ul class="link-list">${links.map((l, i) => {
      const k = LINK_KINDS[l.kind] || LINK_KINDS.other;
      return `<li><button type="button" class="link-chip" data-ext-link="${esc(l.url)}">${k.icon} ${esc(k.text)}</button>
        <span class="muted small link-host">${esc(linkHost(l.url))}</span>
        <button type="button" class="text-btn danger-text" data-link-remove="${i}" aria-label="Удалить ссылку">Удалить</button></li>`;
    }).join("")}</ul>` : ""}
    <form id="link-form" class="link-form" hidden novalidate>
      <label class="field"><span>Что это</span>
        <select class="input" name="kind">
          ${Object.entries(LINK_KINDS).map(([v, k]) => `<option value="${v}">${k.icon} ${k.text}</option>`).join("")}
        </select></label>
      <label class="field"><span>Ссылка</span>
        <input class="input" name="url" type="url" inputmode="url" maxlength="500" placeholder="https://www.figma.com/..."></label>
      <p class="hint">Проверьте, что доступ открыт по ссылке. Видят только пользователи SOBRA, которые смотрят ваш проект.</p>
      <p class="form-error" id="link-error" hidden></p>
      <div class="actions">
        <button class="btn secondary small" type="button" id="link-cancel">Отмена</button>
        <button class="btn primary small" type="submit">Добавить</button>
      </div>
    </form>
    ${links.length < LINKS_MAX ? `<div class="actions" id="link-add-row"><button class="btn secondary small" type="button" id="link-add">+ Добавить ссылку</button></div>` : ""}
  </section>`;
}

function setupLinks(s) {
  const links = Array.isArray(s.links) ? s.links : [];
  const form = $("link-form");
  const save = async (next, button, text) => {
    const updated = await busy(button, text, () => api("PATCH", `/api/startups/${s.id}`, { links: next }));
    renderProject(updated);
    $("links-card")?.scrollIntoView({ block: "center" });
  };
  $("link-add")?.addEventListener("click", () => {
    form.hidden = false;
    $("link-add-row").hidden = true;
    form.elements.url.focus();
  });
  $("link-cancel").addEventListener("click", () => {
    form.hidden = true;
    if ($("link-add-row")) $("link-add-row").hidden = false;
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    formError("link-error", null);
    let url = form.elements.url.value.trim();
    if (url && !/^[a-z]+:\/\//i.test(url)) url = "https://" + url; // «figma.com/…» без протокола — тоже примем
    if (!/^https:\/\/[^\s/]+\.[^\s]+$/i.test(url)) {
      formError("link-error", new Error("Вставьте ссылку вида https://…"));
      return;
    }
    try {
      await save([...links, { kind: form.elements.kind.value, url }], form.querySelector("button[type=submit]"), "Сохраняем…");
      toast("Ссылка добавлена — кандидаты увидят её в карточке проекта");
    } catch (error) {
      formError("link-error", error);
    }
  });
  document.querySelectorAll("[data-link-remove]").forEach((button) =>
    button.addEventListener("click", async () => {
      const index = Number(button.dataset.linkRemove);
      try {
        await save(links.filter((_, i) => i !== index), button, "…");
        toast("Ссылка удалена");
      } catch (error) {
        toast(error.message, "error");
      }
    })
  );
}

// ======================================================
// ТЕГИ НАВЫКОВ
// Отзыв тестировщика: «нужны теги — #B2B_sales, #Python, #маркетинг».
// У кандидата — что умеет, у проекта — кого не хватает. Совпадения видны на карточках
// сразу, без ИИ, а ИИ учитывает теги при оценке.
// ======================================================

const SKILLS_MAX = 10;
const SKILL_SUGGESTIONS = [
  "Python", "JavaScript", "Backend", "Frontend", "Мобильная_разработка", "UX/UI", "Дизайн",
  "Data_Science", "ML", "1С", "Маркетинг", "SMM", "Продажи", "B2B_продажи", "Финансы",
  "Юриспруденция", "Операционка", "Управление_проектами", "Аналитика", "Контент",
];

const SKILL_GROUPS = [
  { title: "Разработка", tags: ["Python", "JavaScript", "Backend", "Frontend", "Мобильная разработка", "1С"] },
  { title: "Дизайн", tags: ["UX/UI", "Дизайн"] },
  { title: "Данные и AI", tags: ["Data Science", "ML", "Аналитика"] },
  { title: "Маркетинг и продажи", tags: ["Маркетинг", "SMM", "Продажи", "B2B-продажи", "Контент"] },
  { title: "Управление и финансы", tags: ["Финансы", "Юриспруденция", "Операционка", "Управление проектами"] },
];
const skillLabel = (t) => String(t).replace(/_/g, " ");

const skillKey = (tag) => String(tag).toLowerCase().replace(/ё/g, "е").replace(/[-_]+/g, "_");

function cleanSkill(raw) {
  const tag = String(raw || "").trim().replace(/^#+/, "").trim().replace(/\s+/g, "_");
  if (!tag || tag.length > 30 || !/^[\p{L}\p{N}][\p{L}\p{N}_+#./-]*$/u.test(tag)) return null;
  return tag;
}

// Только показать. common — совпавшие теги подсвечиваются зелёным
function skillTags(tags, common = []) {
  if (!Array.isArray(tags) || tags.length === 0) return "";
  const hit = new Set((common || []).map(skillKey));
  return `<div class="skill-tags">${tags.map((t) =>
    `<span class="skill-tag${hit.has(skillKey(t)) ? " match" : ""}">#${esc(t)}</span>`).join("")}</div>`;
}

// Сами совпавшие теги уже подсвечены — здесь только число
const skillMatchNote = (common, text = "Совпадений по навыкам") =>
  Array.isArray(common) && common.length ? `<p class="skill-match-note">✓ ${text}: ${common.length}</p>` : "";

// Выбор тегов. Значение хранится в скрытом поле name="skills" через запятую —
// так теги попадают в черновик формы вместе с остальными полями.
const SKILL_SUGGEST_SHORT = 8; // сначала — короткий список, остальные по кнопке «Ещё»

function skillPickerHtml(placeholder = "Свой тег") {
  return `<div class="skill-picker" data-skill-picker>
    <input name="skills" hidden>
    <div class="skill-add">
      <input class="skill-input input" type="text" maxlength="30" placeholder="${esc(placeholder)}" aria-label="Добавить свой тег">
      <button class="btn secondary small" type="button" data-skill-add-custom>Добавить</button>
    </div>
    <div class="skill-selected" data-skill-selected hidden></div>
    <div class="skill-groups" data-skill-suggest></div>
    <p class="hint" data-skill-hint>Нажмите на подходящие или впишите свой. До ${SKILLS_MAX} тегов.</p>
  </div>`;
}

const pickerValue = (root) => root.querySelector("input[name=skills]").value.split(",").filter(Boolean);

function setupSkillPicker(root) {
  const hidden = root.querySelector("input[name=skills]");
  const input = root.querySelector(".skill-input");
  const hint = root.querySelector("[data-skill-hint]");

  const set = (list) => {
    hidden.value = list.join(",");
    render();
    hidden.dispatchEvent(new Event("input", { bubbles: true })); // черновик формы сохранится
  };
  const add = (raw) => {
    const list = pickerValue(root);
    const tag = cleanSkill(raw);
    if (!tag) {
      hint.textContent = "Тег — одно слово или слова через «_», до 30 символов. Например: B2B_продажи";
      return false;
    }
    if (list.some((t) => skillKey(t) === skillKey(tag))) return true;
    if (list.length >= SKILLS_MAX) {
      hint.textContent = `Не больше ${SKILLS_MAX} тегов — уберите лишний.`;
      return false;
    }
    set([...list, tag]);
    return true;
  };
  function render() {
    const list = pickerValue(root);
    const full = list.length >= SKILLS_MAX;
    const selected = root.querySelector("[data-skill-selected]");
    selected.hidden = list.length === 0;
    selected.innerHTML = list.length
      ? `<p class="skill-group-title">Выбрано</p><div class="skill-tags skill-selected-box">${list
          .map((t, i) => `<button type="button" class="skill-chip chosen" data-skill-remove="${i}" aria-label="Убрать тег ${esc(skillLabel(t))}">${esc(skillLabel(t))}</button>`)
          .join("")}</div>`
      : "";
    root.querySelector("[data-skill-suggest]").innerHTML = SKILL_GROUPS.map((g) =>
      `<div class="skill-group"><p class="skill-group-title">${esc(g.title)}</p><div class="skill-tags">${g.tags
        .map((label) => {
          const at = list.findIndex((t) => skillKey(t) === skillKey(cleanSkill(label)));
          return at >= 0
            ? `<button type="button" class="skill-chip on" data-skill-remove="${at}">✓ ${esc(label)}</button>`
            : `<button type="button" class="skill-chip" data-skill-add="${esc(label)}" ${full ? "disabled" : ""}>+ ${esc(label)}</button>`;
        })
        .join("")}</div></div>`
    ).join("");
    hint.textContent = `Нажмите на подходящие или впишите свой. До ${SKILLS_MAX} тегов.`;
  }
  const addCustom = () => {
    // Можно вписать несколько через запятую: «Figma, Tilda»
    const parts = input.value.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length && parts.every(add)) input.value = "";
    input.focus();
  };

  root.addEventListener("click", (e) => {
    const plus = e.target.closest("[data-skill-add]");
    const remove = e.target.closest("[data-skill-remove]");
    if (plus) add(plus.dataset.skillAdd);
    else if (remove) set(pickerValue(root).filter((_, i) => i !== Number(remove.dataset.skillRemove)));
    else if (e.target.closest("[data-skill-add-custom]")) addCustom();
    else if (e.target.closest("[data-skill-more]")) {
      root._all = true;
      render();
    }
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      e.stopPropagation(); // не «Дальше» в пошаговом режиме и не отправка формы
      addCustom();
    }
  });
  root._render = render;
  render();
}

// После form.reset() или подстановки черновика — перерисовать выбранные теги
function refreshSkillPickers(scope) {
  scope.querySelectorAll("[data-skill-picker]").forEach((root) => root._render && root._render());
}

function setSkills(root, list) {
  root.querySelector("input[name=skills]").value = (list || []).join(",");
  root._render && root._render();
}

// Внешние ссылки (материалы проекта) — только https. Внутри MAX открываются через MAX Bridge.
function openExternal(event) {
  const button = event.target.closest("[data-ext-link]");
  if (!button) return;
  const url = button.dataset.extLink;
  if (!/^https:\/\//i.test(url)) return;
  try {
    if (WebApp && typeof WebApp.openLink === "function") WebApp.openLink(url);
    else window.open(url, "_blank", "noopener");
  } catch {
    window.open(url, "_blank", "noopener");
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
    draftLoad(draftKey("task-draft", id)).then((draft) => {
      // подставляем, только если поле ещё пустое и карточка не перерисована
      if (draft && draft.result && !textarea.value && textarea.isConnected) {
        textarea.value = draft.result;
        toggle(id, true, false);
      }
    });
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
    <div class="map-head"><div class="map-title"><span class="map-ico" aria-hidden="true">${BLOCK_ICONS[block.id] || ""}</span><h3>${esc(block.title)}</h3></div>${badge(status.text, status.tone)}</div>
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
// SOBRA AI PREMIUM — «Оформить Premium»
// Оплаты пока нет: кнопка честно говорит, что подписка появится после запуска,
// и считает, сколько людей хотят её оформить (POST /api/pro/event). Бесплатное ничем не ограничиваем.
// После бесплатного подбора — человек уже увидел, как работает AI Match, — один раз всплывает панель снизу.
// ======================================================

const PREMIUM_THANKS = "✓ Спасибо! Оформить Premium можно будет после запуска — мы отметили ваш интерес и сообщим первыми. Всё, чем вы пользуетесь сейчас, остаётся бесплатным.";
const PREMIUM_DELAY_MS = 3500;
const CROWN_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8l4.5 3.5L12 5l4.5 6.5L21 8l-2 10H5z"/></svg>`;
let premiumTimer = null;

const proLog = (event, source) => api("POST", "/api/pro/event", { event, source }).catch(() => {}); // статистика не должна мешать

// Кнопка на странице «Тарифы» — под карточкой Premium
function renderPlansPro() {
  const box = $("plans-pro-actions");
  if (!box) return;
  box.innerHTML = state.pro.clicked
    ? `<p class="pro-thanks">${PREMIUM_THANKS}</p>`
    : `<button class="btn premium-btn block" type="button" data-pro-action="click" data-pro-source="plans">Оформить Premium <span aria-hidden="true">→</span></button>`;
}

function closePremiumSheet() {
  clearTimeout(premiumTimer);
  const sheet = $("premium-sheet");
  if (sheet) sheet.remove();
  document.body.classList.remove("premium-open");
}

function schedulePremiumSheet() {
  clearTimeout(premiumTimer);
  if (state.pro.clicked || state.pro.dismissed || state.premiumSheetShown) return;
  premiumTimer = setTimeout(() => {
    if ($("view-match").hidden || state.pro.clicked || state.pro.dismissed) return; // ушёл с подбора — не догоняем
    state.premiumSheetShown = true; // в этой сессии больше не всплывает
    const sheet = document.createElement("section");
    sheet.id = "premium-sheet";
    sheet.className = "premium-sheet";
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-label", "SOBRA AI Premium");
    sheet.innerHTML = `
      <button class="premium-close" type="button" data-pro-action="dismiss" data-pro-source="popup" aria-label="Закрыть">×</button>
      <div class="pro-head">
        <span class="pro-icon">${CROWN_SVG}</span>
        <div class="grow"><p class="eyebrow">SOBRA AI Premium · 1 990 ₽/год</p><h3>Найдите команду быстрее</h3></div>
      </div>
      <p class="muted">Расширенный подбор под роли и задачи проекта, фильтры по навыкам и уведомления о новых подходящих кандидатах.</p>
      <div class="actions pro-actions">
        <button class="btn premium-btn" type="button" data-pro-action="click" data-pro-source="popup">Оформить Premium</button>
        <button class="btn secondary" type="button" data-pro-go="plans">Сравнить тарифы</button>
      </div>
      <button class="text-btn pro-skip" type="button" data-pro-action="dismiss" data-pro-source="popup">Продолжить бесплатно</button>`;
    document.body.appendChild(sheet);
    // Место под панелью, чтобы последнюю карточку можно было докрутить выше неё
    document.body.style.setProperty("--sheet-h", `${sheet.offsetHeight}px`);
    document.body.classList.add("premium-open");
    requestAnimationFrame(() => sheet.classList.add("open"));
    proLog("shown", "popup");
  }, PREMIUM_DELAY_MS);
}

function setupPro() {
  $("plans-back").addEventListener("click", () => show(state.plansFrom && state.plansFrom !== "plans" ? state.plansFrom : "profile"));
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-pro-go]")) {
      // «Тарифы» не в меню: открываются из ИИ-подбора и из профиля, «← Назад» возвращает туда же
      const from = document.querySelector(".view:not([hidden])");
      state.plansFrom = from ? from.id.replace(/^view-/, "") : "profile";
      closePremiumSheet();
      show("plans");
      return;
    }
    const button = e.target.closest("[data-pro-action]");
    if (!button) return;
    const source = button.dataset.proSource || "plans";
    if (button.dataset.proAction === "click") {
      state.pro.clicked = true;
      proLog("click", source);
      const sheet = $("premium-sheet");
      if (sheet) sheet.querySelector(".pro-actions").outerHTML = `<p class="pro-thanks">${PREMIUM_THANKS}</p>`, sheet.querySelector(".pro-skip")?.remove();
      renderPlansPro();
    } else {
      state.pro.dismissed = true;
      proLog("dismiss", source);
      closePremiumSheet();
      if (button.classList.contains("pro-skip")) toast("Продолжаем бесплатно. Тарифы можно посмотреть в профиле.");
    }
  });
}

// ======================================================
// ОСНОВАТЕЛЬ: ПОДБОР ПАРТНЁРА
// ======================================================

// Карточка кандидата (макет Артемия): процент в углу, «Рекомендации ИИ», «Сильные стороны / Что уточнить».
// Отдельного текста рекомендации ИИ не пишет — берём главный довод, остальные идут в «Сильные стороны».
const TECH_TAGS = new Set(["Разработка", "Данные и AI"].flatMap((t) => (SKILL_GROUPS.find((g) => g.title === t) || { tags: [] }).tags).map((t) => skillKey(cleanSkill(t))));
const MARKETING_TAGS = new Set(((SKILL_GROUPS.find((g) => g.title === "Маркетинг и продажи") || { tags: [] }).tags).map((t) => skillKey(cleanSkill(t))));
const hasTagFrom = (skills, set) => (Array.isArray(skills) ? skills : []).some((t) => set.has(skillKey(t)));

const MATCH_FILTERS = [
  { id: "all", label: "Все", test: () => true },
  { id: "strong", label: "Сильные соответствия", dot: "green", test: (c) => c.ai?.verdict === "strong" },
  { id: "partial", label: "Частичное", dot: "amber", test: (c) => c.ai?.verdict === "partial" },
  { id: "tech", label: "Технические", test: (c) => hasTagFrom(c.skills, TECH_TAGS) },
  { id: "marketing", label: "Маркетинг", test: (c) => hasTagFrom(c.skills, MARKETING_TAGS) },
];

const shortList = (items, n = 3) => (Array.isArray(items) ? items : []).filter(Boolean).slice(0, n);
const bullets = (items) => `<ul>${items.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>`;

function candidateCard(c) {
  const ai = c.ai;
  const v = ai ? AI_VERDICTS[ai.verdict] || AI_VERDICTS.partial : null;
  const reasons = shortList(ai?.reasons, 4);
  const recommendation = reasons[0] || (ai ? `${v.text} потребности проекта.` : "");
  let strengths = reasons.slice(1, 4);
  if (strengths.length === 0 && Array.isArray(c.skills_common) && c.skills_common.length) {
    strengths = [`Совпадают навыки: ${c.skills_common.map((t) => skillLabel(t)).join(", ")}`];
  }
  const ask = shortList([...(ai?.missing || []), ...(ai?.clarify || [])], 3);
  const hit = new Set((c.skills_common || []).map(skillKey));
  const tags = (Array.isArray(c.skills) ? c.skills : []).slice(0, 5);
  return `<article class="card cand-card" data-filter-tags="${MATCH_FILTERS.filter((f) => f.test(c)).map((f) => f.id).join(" ")}">
    <div class="cand-top">
      ${avatarHtml(c.avatar_url, c.name)}
      <div class="grow">
        <h3>${esc(c.name)}</h3>
        <p class="muted">${esc(GOALS[c.goal] || "")}</p>
      </div>
      ${ai ? `<div class="cand-score ${v.cls}"><b>${ai.score}%</b><span>Совпадение</span></div>` : ""}
    </div>
    ${demoBadge(c.user_id) || verifiedBadge(c.phone_verified) || PARTICIPATION[ai?.format]
      ? `<div class="chips cand-badges">${PARTICIPATION[ai?.format] ? badge(`Формат: ${PARTICIPATION[ai.format]}`, "violet") : ""} ${demoBadge(c.user_id)} ${verifiedBadge(c.phone_verified)}</div>` : ""}
    ${tags.length ? `<div class="cand-tags">${tags.map((t) => `<span class="cand-tag${hit.has(skillKey(t)) ? " match" : ""}">${esc(skillLabel(t))}</span>`).join("")}</div>` : ""}
    ${recommendation ? `<div class="cand-reco"><p class="cand-reco-title">✦ Рекомендации ИИ</p><p>${esc(recommendation)}</p></div>` : ""}
    ${strengths.length || ask.length ? `<div class="cand-cols">
      <div class="cand-col good"><p class="cand-col-title">Сильные стороны</p>${strengths.length ? bullets(strengths) : `<p class="muted">ИИ не выделил отдельно — смотрите описание.</p>`}</div>
      <div class="cand-col ask"><p class="cand-col-title">Что уточнить</p>${ask.length ? bullets(ask) : `<p class="muted">Ничего важного — можно знакомиться.</p>`}</div>
    </div>` : ""}
    <div class="cand-more" hidden>
      <p class="cand-col-title">О себе</p>
      <p class="answer">${esc(c.about)}</p>
      ${ai ? `<p class="ai-note">Оценка ИИ по текстам профиля и проекта. Проверьте детали при знакомстве.</p>` : ""}
    </div>
    ${isDemoId(c.user_id) && !c.invited ? `<p class="muted demo-note">Демо-кандидат: на приглашение он откликнется автоматически через несколько секунд.</p>` : ""}
    <div class="actions cand-actions">
      ${c.invited
        ? `<button class="btn secondary" type="button" disabled>Приглашён ✓</button>`
        : `<button class="btn primary" type="button" data-invite="${c.user_id}" ${isDemoId(c.user_id) ? "data-demo" : ""}>Пригласить</button>`}
      <button class="btn secondary" type="button" data-cand-more>Подробнее ›</button>
    </div>
    <div class="card-foot">${reportButton("user", c.user_id, c.name)}</div>
  </article>`;
}

function matchFiltersHtml(candidates) {
  return `<div class="cand-filters" role="tablist">${MATCH_FILTERS.map((f) => {
    const n = candidates.filter(f.test).length;
    if (f.id !== "all" && n === 0) return "";
    return `<button type="button" class="cand-filter${f.id === "all" ? " active" : ""}" data-cand-filter="${f.id}">${f.dot ? `<i class="dot ${f.dot}"></i>` : ""}${esc(f.label)} (${n})</button>`;
  }).join("")}</div>`;
}

function setupCandidateCards() {
  $("match-list").addEventListener("click", (e) => {
    const more = e.target.closest("[data-cand-more]");
    if (more) {
      const box = more.closest(".cand-card").querySelector(".cand-more");
      box.hidden = !box.hidden;
      more.textContent = box.hidden ? "Подробнее ›" : "Свернуть";
      return;
    }
    const f = e.target.closest("[data-cand-filter]");
    if (f) {
      const list = $("match-list");
      list.querySelectorAll("[data-cand-filter]").forEach((b) => b.classList.toggle("active", b === f));
      list.querySelectorAll(".cand-card").forEach((card) => {
        card.hidden = !card.dataset.filterTags.split(" ").includes(f.dataset.candFilter);
      });
    }
  });
}

async function loadCandidates(id) {
  const list = $("match-list");
  closePremiumSheet();
  loading(list, "ИИ сравнивает кандидатов с потребностью проекта. Это займёт несколько секунд…");
  try {
    const { candidates, ai } = await api("GET", `/api/startups/${id}/candidates`);
    if (candidates.length === 0) {
      empty(list, "Пока нет кандидатов, которые открыли профиль под такую потребность. Мы сообщим, когда они появятся — а пока проект видят в поиске.");
      return;
    }
    list.innerHTML = aiNotice(ai, "") + matchFiltersHtml(candidates) + candidates.map(candidateCard).join("");
    schedulePremiumSheet();
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
    button.outerHTML = `<button class="btn secondary" type="button" disabled>Приглашён ✓</button>`;
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
    setSkills($("profile-skills-field").querySelector("[data-skill-picker]"), p.skills || []);
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
  $("profile-skills-field").hidden = own;
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
  $("profile-skills-field").insertAdjacentHTML("beforeend", skillPickerHtml("Свой тег, например Excel"));
  setupSkillPicker($("profile-skills-field").querySelector("[data-skill-picker]"));
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
          skills: pickerValue($("profile-skills-field").querySelector("[data-skill-picker]")),
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
        matches.map(({ startup, ai: aiItem, skills_common }) => projectForCandidate(startup, aiItem, skills_common)).join("");
    } catch (error) {
      failed(results, error, () => form.requestSubmit());
    }
  });

  $("search-results").addEventListener("click", respondClick);
}

// Карточка чужого проекта (в поиске и в приглашениях)
// Вместо повторного отклика — статус уже отправленного
const MY_OFFER_NOTE = {
  new: "✓ Вы откликнулись — ждём ответа основателя. Он придёт в чат с ботом.",
  accepted: "🎉 MATCH — основатель принял ваш отклик. Контакты во вкладке «Контакты».",
  rejected: "Основатель уже ответил на ваш отклик.",
};
const myOfferNote = (status) => `<p class="my-offer-note" data-my-offer="${esc(status)}">${MY_OFFER_NOTE[status] || MY_OFFER_NOTE.new}</p>`;

function projectForCandidate(s, ai, skillsCommon = []) {
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
    ${skillTags(s.skills, skillsCommon)}
    ${skillMatchNote(skillsCommon, "Совпадений с вашими навыками")}
    ${linkChips(s.links)}
    ${renderAi(ai, "Почему вы подходите")}
    ${isOwn
      ? `<p class="muted">Это ваш проект</p>`
      : `${isDemoId(s.founder_id) ? `<p class="muted demo-note">Демо-проект: основатель вымышленный и примет отклик автоматически — так можно пройти путь до MATCH.</p>` : ""}
         ${s.my_offer
           ? myOfferNote(s.my_offer)
           : `<button class="btn primary block" type="button" data-respond="${s.id}" data-name="${esc(s.name)}" ${isDemoId(s.founder_id) ? "data-demo" : ""}>Откликнуться</button>`}
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
    const startupId = state.offerStartupId;
    // Кнопки «Откликнуться» этого проекта на всех экранах меняем на статус — повторно не откликнуться
    const markApplied = () => {
      document.querySelectorAll(`[data-respond="${startupId}"]`).forEach((b) => b.outerHTML = myOfferNote("new"));
      if ($("invites-list")?.innerHTML.trim()) loadResponses(); // проект уходит из «Приглашений»
    };
    try {
      await busy(button, "Отправляем…", () =>
        api("POST", "/api/offers", {
          startup_id: startupId,
          type: form.elements.type.value,
          message: form.elements.message.value.trim(),
        })
      );
      closeOfferSheet();
      markApplied();
      toast(state.offerToDemo
        ? "Отклик отправлен. Это демо-проект — основатель примет его через несколько секунд."
        : "Отклик отправлен. Основатель получит уведомление в MAX.");
    } catch (error) {
      if (error.code === "already_applied") {
        closeOfferSheet();
        markApplied();
        toast(error.message);
        return;
      }
      formError("offer-error", error);
    }
  });
}

// ======================================================
// ОТКЛИКИ И ПРИГЛАШЕНИЯ
// ======================================================

// ---------- Вкладки и пустые состояния («Отклики», «Контакты») ----------
const EMPTY_ART = {
  chat: `<svg viewBox="0 0 132 110"><circle cx="66" cy="55" r="46" fill="#ece9ff"/><circle cx="30" cy="30" r="4" fill="#4b7bff"/><circle cx="106" cy="34" r="6" fill="#ffc53d"/><circle cx="26" cy="76" r="6" fill="#2fc277"/><path d="M50 36h32a9 9 0 0 1 9 9v20a9 9 0 0 1-9 9H68l-11 10V74h-7a9 9 0 0 1-9-9V45a9 9 0 0 1 9-9z" fill="#fff" stroke="#6a3df0" stroke-width="3.5" stroke-linejoin="round"/><circle cx="55" cy="55" r="3" fill="#6a3df0"/><circle cx="66" cy="55" r="3" fill="#6a3df0"/><circle cx="77" cy="55" r="3" fill="#6a3df0"/></svg>`,
  user: `<svg viewBox="0 0 132 110"><circle cx="66" cy="55" r="46" fill="#ece9ff"/><circle cx="28" cy="38" r="5" fill="#ffc53d"/><circle cx="36" cy="86" r="3.5" fill="#4b7bff"/><circle cx="104" cy="80" r="6" fill="#2fc277"/><circle cx="66" cy="46" r="11" fill="#fff" stroke="#6a3df0" stroke-width="3.5"/><path d="M45 80c0-12 9-19 21-19s21 7 21 19" fill="none" stroke="#6a3df0" stroke-width="3.5" stroke-linecap="round"/><circle cx="88" cy="38" r="10" fill="#6a3df0"/><path d="M83.5 38l3.2 3.2 5-6" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
};

const EMPTY_STATES = {
  offers: { art: "chat", title: "Откликов пока нет", text: "Они появятся здесь, когда кто-то откликнется на ваш опубликованный проект.", label: "Опубликовать проект", go: "projects" },
  invites: { art: "chat", title: "Приглашений пока нет", text: "Откройте профиль для основателей во вкладке «Профиль», чтобы они могли вас найти.", label: "Открыть профиль", go: "profile" },
  contacts: { art: "user", title: "Кандидатов пока нет", text: "Здесь появятся кандидаты, чьи отклики вы примете.", label: "Перейти к откликам", go: "responses" },
  matches: { art: "user", title: "Пока нет принявших проектов", text: "Здесь появятся проекты, основатели которых приняли ваш отклик.", label: "Найти проекты", go: "search" },
};

function emptyCard(container, s) {
  container.innerHTML = `<div class="empty-card">
    <div class="empty-art" aria-hidden="true">${EMPTY_ART[s.art]}</div>
    <h3>${esc(s.title)}</h3>
    <p class="muted">${esc(s.text)}</p>
    <button class="btn primary" type="button" data-empty-go="${s.go}">${esc(s.label)}</button>
  </div>`;
}

function setSegCount(name, n) {
  const el = $(`count-${name}`);
  if (el) el.textContent = String(n);
}

// Пустая первая вкладка, а во второй что-то есть (кандидат с MATCH, приглашения без откликов) —
// открываем вторую. Если человек уже сам переключал вкладки, его выбор не трогаем.
function autoPickSeg(first, firstCount, second, secondCount) {
  const btn = document.querySelector(`[data-seg="${second}"]`);
  const seg = btn && btn.closest(".seg");
  if (!seg || seg.dataset.touched) return;
  const want = firstCount === 0 && secondCount > 0 ? second : first;
  const target = seg.querySelector(`[data-seg="${want}"]`);
  if (target && !target.classList.contains("active")) target.click();
}

function setupNewUi() {
  document.querySelectorAll(".seg").forEach((seg) => {
    seg.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-seg]");
      if (!btn) return;
      if (e.isTrusted) seg.dataset.touched = "1"; // переключил сам человек, а не autoPickSeg
      seg.querySelectorAll("[data-seg]").forEach((b) => {
        b.classList.toggle("active", b === btn);
        b.setAttribute("aria-selected", String(b === btn));
      });
      seg.closest(".view").querySelectorAll("[data-seg-panel]").forEach((p) => {
        p.hidden = p.dataset.segPanel !== btn.dataset.seg;
      });
    });
  });
  document.addEventListener("click", (e) => {
    const go = e.target.closest("[data-empty-go]");
    if (go) show(go.dataset.emptyGo);
    const more = e.target.closest("[data-scam-more]");
    if (more) {
      const full = more.closest(".view").querySelector(".scam-full");
      full.hidden = !full.hidden;
      more.textContent = full.hidden ? "Подробнее" : "Скрыть";
    }
  });
}

async function loadResponses() {
  const offersEl = $("offers-list");
  const invitesEl = $("invites-list");
  loading(offersEl);
  loading(invitesEl);

  try {
    const [{ offers = [] }, { invites = [] }] = await Promise.all([api("GET", "/api/offers/received"), api("GET", "/api/invites")]);
    setSegCount("offers", offers.length);
    setSegCount("invites", invites.length);
    autoPickSeg("offers", offers.length, "invites", invites.length);

    if (offers.length === 0) {
      emptyCard(offersEl, EMPTY_STATES.offers);
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
      emptyCard(invitesEl, EMPTY_STATES.invites);
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
    const [{ contacts = [] }, { matches = [] }] = await Promise.all([api("GET", "/api/contacts"), api("GET", "/api/matches")]);
    setSegCount("contacts", contacts.length);
    setSegCount("matches", matches.length);
    autoPickSeg("contacts", contacts.length, "matches", matches.length);

    if (contacts.length === 0) emptyCard(contactsEl, EMPTY_STATES.contacts);
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

    if (matches.length === 0) emptyCard(matchesEl, EMPTY_STATES.matches);
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

// ======================================================
// ПЕРВЫЙ ВХОД: «Что хотите сделать?» (отзыв экспертов онлайн-этапа)
// ======================================================

const INTENT_START = {
  idea: () => { show("projects"); $("open-idea").click(); }, // сразу к проверке идеи, без вопросов о партнёре
  partner: () => { show("projects"); $("open-idea").click(); },
  join: () => show("search"),
};

function setupStart() {
  document.querySelectorAll("[data-intent]").forEach((button) =>
    button.addEventListener("click", () => {
      const intent = button.dataset.intent;
      state.intent = intent;
      api("PUT", "/api/me/intent", { intent }).catch(() => {}); // выбор не критичен — путь откроется и без сохранения
      INTENT_START[intent]();
    })
  );
  $("start-skip").addEventListener("click", () => show("projects"));
  // «Передумать можно в любой момент»: тот же экран выбора из вкладки «Проекты»
  $("change-intent").addEventListener("click", () => {
    $("start-skip").textContent = "← Вернуться к проектам";
    show("start");
  });
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

    // Новичку — экран «Что хотите сделать?». Тем, у кого уже есть проекты или профиль, — сразу «Проекты».
    let me = null;
    try {
      me = await api("GET", "/api/me");
      state.intent = me.intent;
      if (me.pro) state.pro = me.pro;
      renderPlansPro();
    } catch {
      // не критично — просто без экрана выбора
    }
    if (me && !me.intent && !me.has_projects && !me.has_profile) show("start");
    else show("projects");
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
  setupStart();
  document.addEventListener("click", openExternal);
  setupIdeaForm();
  setupProfileForm();
  setupAvatar();
  setupPhoneVerification();
  setupReports();
  setupSearchForm();
  setupOfferForm();
  setupNewUi();
  setupPro();
  setupCandidateCards();

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
