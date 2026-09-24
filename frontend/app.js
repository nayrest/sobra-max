// SOBRA — мини-приложение MAX.
// Повторяет все сценарии чат-бота через REST API (/api/*), описанный в API-CONTRACT.md.

// ======================================================
// ИНИЦИАЛИЗАЦИЯ MAX И АВТОРИЗАЦИЯ
// ======================================================

const WebApp = window.WebApp || null;

// Подписанная строка запуска от MAX. Бэкенд проверяет её подпись.
const initData = WebApp && WebApp.initData ? WebApp.initData : "";

// Отладка в обычном браузере: ?debug_user=123
// Работает, только если на сервере включён API_DEBUG_AUTH=true.
const debugUserId = new URLSearchParams(location.search).get("debug_user");

const state = {
  user: null,
  lastSearchGoal: null,
  offerStartupId: null,
};

// ======================================================
// API
// ======================================================

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function api(method, path, body) {
  const headers = { "Content-Type": "application/json" };

  if (initData) headers.Authorization = `Bearer ${initData}`;
  else if (debugUserId) headers["X-Debug-User-Id"] = debugUserId;

  let response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, "Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.");
  }

  if (response.status === 204) return null;

  let data = null;
  try {
    data = await response.json();
  } catch {
    // тело не JSON — обработаем ниже по статусу
  }

  if (!response.ok) {
    throw new ApiError(response.status, (data && data.error) || `Ошибка сервера (${response.status})`);
  }

  return data;
}

// ======================================================
// ОБЩИЕ ПОМОЩНИКИ
// ======================================================

const $ = (id) => document.getElementById(id);

function escapeHtml(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatMoney(value) {
  if (!value) return "";
  return Number(value).toLocaleString("ru-RU") + " ₽";
}

function parseMoney(text) {
  const digits = String(text || "").replace(/[^\d]/g, "");
  return digits ? Number(digits) : null;
}

function formatDate(value) {
  if (!value) return "";
  return new Date(value).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

let toastTimer = null;
function toast(message, kind = "ok") {
  const el = $("toast");
  el.textContent = message;
  el.className = `toast toast-${kind}`;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 3000);
}

function showLoading(container, text = "Загружаем…") {
  container.innerHTML = `<div class="state"><span class="spinner" aria-hidden="true"></span>${escapeHtml(text)}</div>`;
}

function showEmpty(container, text) {
  container.innerHTML = `<div class="state">${escapeHtml(text)}</div>`;
}

function showListError(container, error, retry) {
  container.innerHTML = `
    <div class="state state-error">
      <p>${escapeHtml(error.message)}</p>
      <button class="btn btn-secondary btn-small" type="button">Повторить</button>
    </div>`;
  container.querySelector("button").addEventListener("click", retry);
}

function showFormError(id, error) {
  const el = $(id);
  if (!error) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  el.textContent = error.message || String(error);
  el.hidden = false;
}

// Блокирует кнопку на время запроса, чтобы не было двойных отправок
async function withBusy(button, busyText, action) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = busyText;
  try {
    return await action();
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

// ======================================================
// НАВИГАЦИЯ
// ======================================================

const tabLoaders = {
  "my-startups": loadMyStartups,
  search: loadSearchProfile,
  offers: loadOffers,
  contacts: loadContacts,
};

function openTab(name) {
  document.querySelectorAll(".tab-content").forEach((t) => t.classList.remove("active"));
  $(`tab-${name}`).classList.add("active");

  document.querySelectorAll(".nav-item").forEach((n) => {
    n.classList.toggle("active", n.dataset.tab === name || (name === "create" && n.dataset.tab === "my-startups"));
  });

  window.scrollTo(0, 0);
  if (tabLoaders[name]) tabLoaders[name]();
}

function setupNavigation() {
  document.querySelectorAll(".nav-item").forEach((item) => {
    item.addEventListener("click", () => openTab(item.dataset.tab));
  });
}

// ======================================================
// МОИ ПРОЕКТЫ
// ======================================================

const STATUS_LABELS = {
  draft: { text: "Черновик", cls: "badge-draft" },
  published: { text: "Опубликован", cls: "badge-published" },
};

function seekingText(startup) {
  let text = startup.seeking || "Не указано";
  if (startup.seeking === "Инвестиции" && startup.investment_amount) {
    text += `, ${formatMoney(startup.investment_amount)}`;
  }
  return text;
}

async function loadMyStartups() {
  const container = $("my-startups-list");
  showLoading(container);

  try {
    const { startups } = await api("GET", "/api/startups/my");

    if (startups.length === 0) {
      showEmpty(container, "У вас пока нет проектов. Создайте первый — его увидят инвесторы, партнёры и будущая команда.");
      return;
    }

    container.innerHTML = startups.map(renderMyStartup).join("");
  } catch (error) {
    showListError(container, error, loadMyStartups);
  }
}

function renderMyStartup(s) {
  const status = STATUS_LABELS[s.status] || { text: s.status, cls: "" };
  const actions =
    s.status === "draft"
      ? `<button class="btn btn-outline btn-small" data-action="publish" data-id="${s.id}">Опубликовать</button>
         <button class="btn btn-danger btn-small" data-action="delete" data-id="${s.id}">Удалить</button>`
      : "";

  return `
    <article class="card">
      <div class="card-tags">
        <span class="badge ${status.cls}">${status.text}</span>
        <span class="badge badge-muted">${escapeHtml(s.category)}</span>
        <span class="badge badge-muted">${escapeHtml(s.market_type)}</span>
      </div>
      <h3>${escapeHtml(s.name)}</h3>
      <dl class="facts">
        <div><dt>Стадия</dt><dd>${escapeHtml(s.stage)}</dd></div>
        <div><dt>Ищет</dt><dd>${escapeHtml(seekingText(s))}</dd></div>
      </dl>
      ${actions ? `<div class="card-actions">${actions}</div>` : ""}
    </article>`;
}

async function handleMyStartupAction(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const id = button.dataset.id;

  if (button.dataset.action === "publish") {
    try {
      await withBusy(button, "Публикуем…", () => api("POST", `/api/startups/${id}/publish`));
      toast("Проект опубликован. Теперь его находят в поиске.");
      loadMyStartups();
    } catch (error) {
      toast(error.message, "error");
    }
  }

  if (button.dataset.action === "delete") {
    if (!confirm("Удалить черновик? Это действие нельзя отменить.")) return;
    try {
      await withBusy(button, "Удаляем…", () => api("DELETE", `/api/startups/${id}`));
      toast("Черновик удалён");
      loadMyStartups();
    } catch (error) {
      toast(error.message, "error");
    }
  }
}

// ======================================================
// НОВЫЙ СТАРТАП
// ======================================================

function setupCreateForm() {
  const form = $("create-form");

  $("open-create").addEventListener("click", () => {
    form.reset();
    $("investment-field").hidden = true;
    showFormError("create-error", null);
    openTab("create");
  });

  $("cancel-create").addEventListener("click", () => openTab("my-startups"));

  form.seeking.addEventListener("change", () => {
    $("investment-field").hidden = form.seeking.value !== "Инвестиции";
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    showFormError("create-error", null);

    const required = ["name", "category", "market_type", "stage", "seeking", "problem", "solution", "traction"];
    const empty = required.find((field) => !form.elements[field].value.trim());
    if (empty) {
      form.elements[empty].focus();
      showFormError("create-error", new Error("Заполните все поля, чтобы сохранить проект."));
      return;
    }

    const body = {
      name: form.elements.name.value.trim(),
      category: form.category.value,
      market_type: form.market_type.value,
      stage: form.stage.value,
      seeking: form.seeking.value,
      problem: form.problem.value.trim(),
      solution: form.solution.value.trim(),
      traction: form.traction.value.trim(),
      investment_amount: form.seeking.value === "Инвестиции" ? parseMoney(form.investment_amount.value) : null,
    };

    const button = form.querySelector("button[type=submit]");
    try {
      await withBusy(button, "Сохраняем…", () => api("POST", "/api/startups", body));
      toast("Черновик сохранён. Опубликуйте его, когда будете готовы.");
      openTab("my-startups");
    } catch (error) {
      showFormError("create-error", error);
    }
  });
}

// ======================================================
// ПОИСК
// ======================================================

// Цель поиска → подходящий тип отклика
const GOAL_TO_OFFER = { investment: "investment", pilot: "pilot", team: "team", partner: "partner" };

let searchProfileLoaded = false;

async function loadSearchProfile() {
  if (searchProfileLoaded) return;
  searchProfileLoaded = true;

  try {
    const profile = await api("GET", "/api/search/profile");
    if (!profile) return;

    const form = $("search-form");
    form.goal.value = profile.goal || "";
    form.category.value = profile.category || "Любая";
    form.min_stage.value = profile.min_stage || "Идея";
    if (profile.max_investment) {
      form.max_investment.value = Number(profile.max_investment).toLocaleString("ru-RU");
    }
    if (profile.about) form.about.value = profile.about;
    $("max-investment-field").hidden = form.goal.value !== "investment";
  } catch {
    // Сохранённых фильтров нет или сервер недоступен — просто начинаем с пустой формы
  }
}

function setupSearchForm() {
  const form = $("search-form");

  form.goal.addEventListener("change", () => {
    $("max-investment-field").hidden = form.goal.value !== "investment";
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    showFormError("search-error", null);

    if (!form.goal.value) {
      form.goal.focus();
      showFormError("search-error", new Error("Выберите цель поиска."));
      return;
    }

    const body = {
      goal: form.goal.value,
      category: form.category.value,
      min_stage: form.min_stage.value,
      max_investment: form.goal.value === "investment" ? parseMoney(form.max_investment.value) : null,
      about: form.about.value.trim() || null,
    };

    state.lastSearchGoal = body.goal;

    const container = $("search-results");
    const button = form.querySelector("button[type=submit]");
    showLoading(container, body.about ? "Подбираем проекты и сравниваем их с вашим опытом. Это займёт несколько секунд…" : undefined);

    try {
      const { matches, ai } = await withBusy(button, "Ищем…", () => api("POST", "/api/search", body));

      if (matches.length === 0) {
        showEmpty(container, "Под эти фильтры проектов пока нет. Попробуйте категорию «Любая» или стадию пониже.");
        return;
      }

      container.innerHTML = renderAiNotice(ai) + matches.map(renderMatch).join("");
    } catch (error) {
      showListError(container, error, () => form.requestSubmit());
    }
  });

  $("search-results").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action=respond]");
    if (button) openOfferSheet(button.dataset.id, button.dataset.name);
  });
}

// ======================================================
// AI MATCHING
// ======================================================

const AI_VERDICTS = {
  strong: { text: "Сильное соответствие", cls: "ai-strong" },
  partial: { text: "Частичное соответствие", cls: "ai-partial" },
  weak: { text: "Слабое соответствие", cls: "ai-weak" },
};

function renderAiNotice(ai) {
  if (!ai) return "";
  if (ai.status === "no_profile") {
    return `<p class="ai-notice">Заполните поле «О себе», и ИИ объяснит, насколько вы подходите каждому проекту.</p>`;
  }
  if (ai.message) return `<p class="ai-notice">${escapeHtml(ai.message)}</p>`;
  return "";
}

function renderAiList(icon, title, items) {
  if (!items || items.length === 0) return "";
  return `
    <div class="ai-group">
      <p class="ai-group-title">${icon} ${title}</p>
      <ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    </div>`;
}

function renderAi(ai) {
  if (!ai) return "";
  const verdict = AI_VERDICTS[ai.verdict] || AI_VERDICTS.partial;

  return `
    <section class="ai-block ${verdict.cls}">
      <p class="ai-head"><strong>${verdict.text}</strong> <span>${ai.score} из 100</span></p>
      ${renderAiList("✅", "Почему подходите", ai.reasons)}
      ${renderAiList("⚠️", "Чего не хватает", ai.missing)}
      ${renderAiList("❓", "Что уточнить перед знакомством", ai.clarify)}
      <p class="ai-note">Оценка ИИ по тексту карточки и вашему описанию. Проверьте детали при знакомстве.</p>
    </section>`;
}

function renderMatch({ startup: s, matched, total, ai }) {
  const isOwn = state.user && Number(s.founder_id) === state.user.user_id;

  return `
    <article class="card">
      <div class="card-tags">
        <span class="badge badge-match">Совпадение ${matched} из ${total}</span>
        <span class="badge badge-muted">${escapeHtml(s.category)}</span>
        <span class="badge badge-muted">${escapeHtml(s.market_type)}</span>
      </div>
      <h3>${escapeHtml(s.name)}</h3>
      <dl class="facts">
        <div><dt>Стадия</dt><dd>${escapeHtml(s.stage)}</dd></div>
        <div><dt>Ищет</dt><dd>${escapeHtml(seekingText(s))}</dd></div>
      </dl>
      <p class="card-text"><strong>Проблема.</strong> ${escapeHtml(s.problem)}</p>
      <p class="card-text"><strong>Решение.</strong> ${escapeHtml(s.solution)}</p>
      <p class="card-text"><strong>Трэкшн.</strong> ${escapeHtml(s.traction)}</p>
      ${renderAi(ai)}
      ${
        isOwn
          ? `<p class="hint">Это ваш проект</p>`
          : `<button class="btn btn-primary btn-block" data-action="respond" data-id="${s.id}" data-name="${escapeHtml(s.name)}">Откликнуться</button>`
      }
    </article>`;
}

// ======================================================
// ОТКЛИК (ПРЕДЛОЖЕНИЕ)
// ======================================================

function openOfferSheet(startupId, startupName) {
  const form = $("offer-form");
  form.reset();
  showFormError("offer-error", null);

  state.offerStartupId = Number(startupId);
  $("offer-project").textContent = startupName;
  if (state.lastSearchGoal) form.type.value = GOAL_TO_OFFER[state.lastSearchGoal];

  $("offer-sheet").hidden = false;
  form.message.focus();
}

function closeOfferSheet() {
  $("offer-sheet").hidden = true;
  state.offerStartupId = null;
}

function setupOfferForm() {
  const form = $("offer-form");

  $("offer-cancel").addEventListener("click", closeOfferSheet);
  $("offer-sheet").addEventListener("click", (event) => {
    if (event.target.id === "offer-sheet") closeOfferSheet();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    showFormError("offer-error", null);

    if (!form.message.value.trim()) {
      form.message.focus();
      showFormError("offer-error", new Error("Напишите пару слов основателю — без сообщения отклик не отправить."));
      return;
    }

    const button = form.querySelector("button[type=submit]");
    try {
      await withBusy(button, "Отправляем…", () =>
        api("POST", "/api/offers", {
          startup_id: state.offerStartupId,
          type: form.type.value,
          message: form.message.value.trim(),
        })
      );
      closeOfferSheet();
      toast("Отклик отправлен. Основатель получит уведомление в MAX.");
    } catch (error) {
      showFormError("offer-error", error);
    }
  });
}

// ======================================================
// ПРЕДЛОЖЕНИЯ ПО МОИМ ПРОЕКТАМ
// ======================================================

const OFFER_STATUS = {
  new: { text: "Новое", cls: "badge-new" },
  accepted: { text: "Принято", cls: "badge-published" },
  rejected: { text: "Отклонено", cls: "badge-muted" },
};

async function loadOffers() {
  const container = $("offers-list");
  showLoading(container);

  try {
    const { offers } = await api("GET", "/api/offers/received");

    if (offers.length === 0) {
      showEmpty(container, "Предложений пока нет. Они появятся здесь, когда кто-то откликнется на ваш опубликованный проект.");
      return;
    }

    container.innerHTML = offers.map(renderOffer).join("");
  } catch (error) {
    showListError(container, error, loadOffers);
  }
}

function renderOffer(o) {
  const status = OFFER_STATUS[o.status] || { text: o.status, cls: "" };
  const actions =
    o.status === "new"
      ? `<div class="card-actions">
           <button class="btn btn-primary btn-small" data-action="accept" data-id="${o.id}">Принять</button>
           <button class="btn btn-secondary btn-small" data-action="reject" data-id="${o.id}">Отклонить</button>
         </div>`
      : "";

  return `
    <article class="card">
      <div class="card-tags">
        <span class="badge ${status.cls}">${status.text}</span>
        <span class="badge badge-muted">${escapeHtml(o.type)}</span>
      </div>
      <h3>${escapeHtml(o.startup_name)}</h3>
      <p class="card-sub">От: ${escapeHtml(o.sender_name || "пользователь MAX")} · ${formatDate(o.created_at)}</p>
      <p class="card-text">${escapeHtml(o.message)}</p>
      ${actions}
    </article>`;
}

async function handleOfferAction(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const id = button.dataset.id;
  const accept = button.dataset.action === "accept";

  try {
    await withBusy(button, accept ? "Принимаем…" : "Отклоняем…", () =>
      api("POST", `/api/offers/${id}/${accept ? "accept" : "reject"}`)
    );
    toast(accept ? "Предложение принято — это MATCH. Контакт появился во вкладке «Контакты»." : "Предложение отклонено");
    loadOffers();
  } catch (error) {
    toast(error.message, "error");
  }
}

// ======================================================
// КОНТАКТЫ / MATCH
// ======================================================

async function loadContacts() {
  const contactsEl = $("contacts-list");
  const matchesEl = $("matches-list");
  showLoading(contactsEl);
  showLoading(matchesEl);

  try {
    const [{ contacts }, { matches }] = await Promise.all([
      api("GET", "/api/contacts"),
      api("GET", "/api/matches"),
    ]);

    if (contacts.length === 0) {
      showEmpty(contactsEl, "Здесь появятся кандидаты, чьи предложения вы примете.");
    } else {
      contactsEl.innerHTML = contacts
        .map(
          (c) => `
        <article class="card">
          <div class="card-tags"><span class="badge badge-muted">${escapeHtml(c.type)}</span></div>
          <h3>${escapeHtml(c.candidate_name || "Пользователь MAX")}</h3>
          <p class="card-sub">Проект: ${escapeHtml(c.startup_name)} · ${formatDate(c.created_at)}</p>
          <p class="card-text">${escapeHtml(c.message)}</p>
        </article>`
        )
        .join("");
    }

    if (matches.length === 0) {
      showEmpty(matchesEl, "Здесь появятся проекты, основатели которых приняли ваш отклик.");
    } else {
      matchesEl.innerHTML = matches
        .map(
          (m) => `
        <article class="card">
          <div class="card-tags"><span class="badge badge-published">MATCH</span></div>
          <h3>${escapeHtml(m.startup_name)}</h3>
          <p class="card-sub">Ваш отклик: ${escapeHtml(m.type)} · ${formatDate(m.created_at)}</p>
          <p class="card-text">${escapeHtml(m.message)}</p>
        </article>`
        )
        .join("");
    }
  } catch (error) {
    showListError(contactsEl, error, loadContacts);
    matchesEl.innerHTML = "";
  }
}

// ======================================================
// ЗАПУСК
// ======================================================

function showAuthError(message) {
  document.querySelectorAll(".tab-content").forEach((t) => t.classList.remove("active"));
  $("app-nav").hidden = true;
  $("auth-error").hidden = false;
  $("auth-error-text").textContent = message;
  $("user-info").textContent = "Не авторизован";
}

async function authorize() {
  $("auth-error").hidden = true;
  $("app-nav").hidden = false;

  if (!initData && !debugUserId) {
    showAuthError("Мини-приложение работает только внутри MAX. Откройте его из чата с ботом SOBRA.");
    return;
  }

  try {
    if (initData) {
      state.user = await api("POST", "/api/auth", { init_data: initData });
    } else {
      // Режим отладки в браузере: /api/auth требует initData, поэтому берём id из параметра
      state.user = { user_id: Number(debugUserId), name: "Отладка" };
    }

    $("user-info").textContent = state.user.name || `ID: ${state.user.user_id}`;
    openTab("my-startups");
  } catch (error) {
    showAuthError(
      error.status === 401
        ? "Сессия MAX устарела или недействительна. Закройте мини-приложение и откройте его снова из чата с ботом."
        : error.message
    );
  }
}

document.addEventListener("DOMContentLoaded", () => {
  if (WebApp && typeof WebApp.ready === "function") WebApp.ready();

  setupNavigation();
  setupCreateForm();
  setupSearchForm();
  setupOfferForm();

  $("my-startups-list").addEventListener("click", handleMyStartupAction);
  $("offers-list").addEventListener("click", handleOfferAction);
  $("auth-retry").addEventListener("click", authorize);

  authorize();
});
