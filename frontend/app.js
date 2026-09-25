// SOBRA AI — мини-приложение MAX.
// Две роли в одном приложении:
//   основатель: проверка идеи → карта проекта → ИИ-подбор партнёра → приглашение;
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
    throw new ApiError(response.status, (data && data.error) || `Ошибка сервера (${response.status})`);
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
  confirmed: { text: "Подтверждено", tone: "green" },
  hypothesis: { text: "Гипотеза", tone: "amber" },
  missing: { text: "Не проработано", tone: "red" },
};

const GOALS = {
  team: "Войти в команду",
  partner: "Партнёрство",
};

const CATEGORY_ICON = {
  FoodTech: "☕", AI: "🤖", SaaS: "☁️", FinTech: "💳", EdTech: "🎓", "E-commerce": "🛒", Другое: "💡",
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

function show(view) {
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
      if (state.onboarding && b.dataset.tab !== "profile") {
        toast("Сначала заполните профиль");
        show("profile");
        return;
      }
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
    list.innerHTML = startups.map((s) => `
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
        <div class="actions"><button class="btn secondary small" type="button" data-open="${s.id}">Открыть карту проекта →</button></div>
      </article>`).join("");
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

function setupIdeaForm() {
  const form = $("idea-form");
  $("idea-questions").innerHTML = [...BLOCKS, { ...PARTNER_QUESTION, required: true }].map(questionField).join("");

  $("open-idea").addEventListener("click", () => {
    form.reset();
    formError("idea-error", null);
    show("idea");
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

function renderProject(s) {
  const map = s.idea_map || {};
  const published = s.status === "published";
  const nextSteps = BLOCKS.filter((b) => map[b.id] && map[b.id].status !== "confirmed").slice(0, 3);

  $("project-detail").innerHTML = `
    <div class="page-head">
      <h1>Карта проекта</h1>
      <p>Что уже подтверждено, где есть пробелы и какого партнёра не хватает.</p>
    </div>

    <section class="card">
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

    <section class="card insight">
      <p class="eyebrow">Кого ищем</p>
      <h3>${esc(seekingText(s))}</h3>
      <p>${esc(s.partner_needed || "Не указано")}</p>
      ${published
        ? `<button class="btn primary block" type="button" id="go-match">Подобрать партнёра →</button>`
        : `<p class="muted">Опубликуйте проект, чтобы кандидаты могли откликаться, а ИИ — подбирать людей.</p>
           <div class="actions">
             <button class="btn danger small" type="button" id="delete-project">Удалить черновик</button>
             <button class="btn primary" type="button" id="publish-project">Опубликовать</button>
           </div>`}
    </section>

    <div class="map-grid">
      ${BLOCKS.map((b) => mapCard(b, s, map[b.id])).join("")}
    </div>

    ${nextSteps.length ? `<section class="card">
      <h2>Следующие шаги</h2>
      <ol class="steps">${nextSteps.map((b) => `<li><b>${esc(b.title)}.</b> ${esc(map[b.id].comment)}</li>`).join("")}</ol>
    </section>` : ""}
  `;

  const box = $("project-detail");
  box.querySelectorAll("[data-edit]").forEach((btn) => btn.addEventListener("click", () => editBlock(s, btn.dataset.edit)));

  if (published) {
    $("go-match").addEventListener("click", () => show("match"));
  } else {
    $("publish-project").addEventListener("click", async (e) => {
      try {
        await busy(e.currentTarget, "Публикуем…", () => api("POST", `/api/startups/${s.id}/publish`));
        toast("Проект опубликован. Теперь можно подобрать партнёра.");
        loadProject(s.id);
      } catch (error) {
        toast(error.message, "error");
      }
    });
    $("delete-project").addEventListener("click", async (e) => {
      if (!confirm("Удалить черновик? Это действие нельзя отменить.")) return;
      try {
        await busy(e.currentTarget, "Удаляем…", () => api("DELETE", `/api/startups/${s.id}`));
        toast("Черновик удалён");
        show("projects");
      } catch (error) {
        toast(error.message, "error");
      }
    });
  }
}

function mapCard(block, startup, item) {
  const status = STATUS[item?.status] || STATUS.missing;
  const answer = startup[block.field];
  return `<article class="card map-card" id="block-${block.id}">
    <div class="map-head"><h3>${esc(block.title)}</h3>${badge(status.text, status.tone)}</div>
    <p class="answer">${answer ? esc(answer) : '<span class="muted">Нет ответа</span>'}</p>
    ${item?.comment ? `<p class="next"><b>Что дальше:</b> ${esc(item.comment)}</p>` : ""}
    <button class="text-btn" type="button" data-edit="${block.id}">Обновить блок →</button>
  </article>`;
}

function editBlock(startup, blockId) {
  const block = BLOCKS.find((b) => b.id === blockId);
  const card = $(`block-${blockId}`);

  card.innerHTML = `
    <div class="map-head"><h3>${esc(block.title)}</h3></div>
    <label class="field"><span>${esc(block.q)}</span>
      <textarea class="input textarea" maxlength="1000" placeholder="${esc(block.hint)}">${esc(startup[block.field] || "")}</textarea></label>
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
          <span class="avatar">${esc((c.name || "?").split(" ").map((w) => w[0]).join("").slice(0, 2))}</span>
          <div class="grow"><h3>${esc(c.name)}</h3><p class="muted">${esc(GOALS[c.goal] || "")}</p></div>
        </div>
        <p class="answer">${esc(c.about)}</p>
        ${renderAi(c.ai)}
        <div class="actions">
          ${c.invited
            ? `<button class="btn secondary" type="button" disabled>Приглашение отправлено ✓</button>`
            : `<button class="btn primary" type="button" data-invite="${c.user_id}">Пригласить в проект</button>`}
        </div>
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
    toast("Приглашение отправлено. Кандидат получит сообщение в MAX.");
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

function displayNameFromProfile(p, fallback) {
  if (p?.last_name || p?.first_name) {
    return [p.last_name, p.first_name].filter(Boolean).join(" ").trim();
  }
  if (p?.full_name) return String(p.full_name).trim();
  return fallback || "";
}

function updateUserbox(p) {
  const name = displayNameFromProfile(p, state.user?.name || `ID ${state.user?.user_id || ""}`);
  $("user-name").textContent = name || "Вход…";
  const initials = [p?.first_name, p?.last_name]
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  $("user-avatar").textContent =
    initials ||
    name
      .split(/\s+/)
      .map((w) => w[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() ||
    "·";
}

async function loadProfile() {
  const form = $("profile-form");
  formError("profile-error", null);

  const head = document.querySelector("#view-profile .page-head");
  if (head) {
    if (state.onboarding) {
      head.querySelector("h1").textContent = "Создание профиля";
      head.querySelector("p").textContent =
        "При первом входе заполните профиль кандидата. По этим данным ИИ будет подбирать проекты, а основатели — находить вас.";
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
    updateUserbox(p);
  } catch (error) {
    formError("profile-error", error);
  }
}

function setupProfileForm() {
  const form = $("profile-form");
  setupPhoneMask(form.elements.phone);

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
    if (!f.about.value.trim()) {
      f.about.focus();
      formError("profile-error", new Error("Расскажите о себе хотя бы в паре предложений — по этому тексту ИИ подбирает проекты."));
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
          visible: f.visible.checked,
        })
      );
      updateUserbox(state.profile);
      const wasOnboarding = state.onboarding;
      state.onboarding = false;
      toast(
        wasOnboarding
          ? "Профиль создан! Теперь можно искать проекты и публиковать свои идеи."
          : f.visible.checked
            ? "Профиль сохранён. Основатели смогут вас пригласить."
            : "Профиль сохранён."
      );
      if (wasOnboarding) show("projects");
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
    if (!form.elements.goal.value && p.goal) form.elements.goal.value = p.goal;
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
        <div class="chips">${badge(s.stage)} ${badge(s.category, "violet")} ${badge(s.market_type, "gray")}</div>
      </div>
    </div>
    <p class="muted">Ищет: ${esc(seekingText(s))}</p>
    ${rows.map(([k, v]) => `<p class="answer"><b>${k}.</b> ${esc(v)}</p>`).join("")}
    ${renderAi(ai, "Почему вы подходите")}
    ${isOwn
      ? `<p class="muted">Это ваш проект</p>`
      : `<button class="btn primary block" type="button" data-respond="${s.id}" data-name="${esc(s.name)}">Откликнуться</button>`}
  </article>`;
}

// ======================================================
// ОТКЛИК
// ======================================================

function respondClick(event) {
  const button = event.target.closest("[data-respond]");
  if (button) openOfferSheet(button.dataset.respond, button.dataset.name);
}

function openOfferSheet(startupId, name) {
  const form = $("offer-form");
  form.reset();
  formError("offer-error", null);
  state.offerStartupId = Number(startupId);
  $("offer-project").textContent = name;
  const goal = state.lastSearchGoal || state.profile?.goal;
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
      toast("Отклик отправлен. Основатель получит уведомление в MAX.");
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
          <div class="chips">${badge(st.text, st.tone)} ${badge(o.type, "gray")}</div>
          <h3>${esc(o.startup_name)}</h3>
          <p class="muted">От: ${esc(o.sender_name || "пользователь MAX")} · ${dateText(o.created_at)}</p>
          <p class="answer">${esc(o.message)}</p>
          ${o.status === "new" ? `<div class="actions">
            <button class="btn secondary small" type="button" data-decide="reject" data-id="${o.id}">Отклонить</button>
            <button class="btn primary small" type="button" data-decide="accept" data-id="${o.id}">Принять</button>
          </div>` : ""}
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

async function loadContacts() {
  const contactsEl = $("contacts-list");
  const matchesEl = $("matches-list");
  loading(contactsEl);
  loading(matchesEl);

  try {
    const [{ contacts }, { matches }] = await Promise.all([api("GET", "/api/contacts"), api("GET", "/api/matches")]);

    if (contacts.length === 0) empty(contactsEl, "Здесь появятся кандидаты, чьи отклики вы примете.");
    else contactsEl.innerHTML = contacts.map((c) => `<article class="card">
        <div class="chips">${badge("MATCH", "green")} ${badge(c.type, "gray")}</div>
        <h3>${esc(c.candidate_name || "Пользователь MAX")}</h3>
        <p class="muted">Проект: ${esc(c.startup_name)} · ${dateText(c.created_at)}</p>
        <p class="answer">${esc(c.message)}</p>
      </article>`).join("");

    if (matches.length === 0) empty(matchesEl, "Здесь появятся проекты, основатели которых приняли ваш отклик.");
    else matchesEl.innerHTML = matches.map((m) => `<article class="card">
        <div class="chips">${badge("MATCH", "green")} ${badge(m.type, "gray")}</div>
        <h3>${esc(m.startup_name)}</h3>
        <p class="muted">Ваш отклик · ${dateText(m.created_at)}</p>
        <p class="answer">${esc(m.message)}</p>
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
  $("view-auth").hidden = false;
  $("auth-text").textContent = message;
  $("user-name").textContent = "Не авторизован";
}

function needsOnboarding(profile) {
  return (
    !profile ||
    !profile.goal ||
    !profile.about ||
    !String(profile.about).trim() ||
    !profile.last_name ||
    !String(profile.last_name).trim() ||
    !profile.first_name ||
    !String(profile.first_name).trim() ||
    !profile.email ||
    !String(profile.email).trim() ||
    !profile.phone ||
    !String(profile.phone).trim()
  );
}

async function authorize() {
  $("tabbar").hidden = false;

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

    // Первичный вход: если профиль кандидата не заполнен — сразу открываем создание профиля
    try {
      const profile = await fetchProfile();
      updateUserbox(profile);
      if (needsOnboarding(profile)) {
        state.onboarding = true;
        show("profile");
        toast("Заполните профиль, чтобы начать работу");
        return;
      }
    } catch {
      // если профиль недоступен — всё равно пускаем дальше
    }

    state.onboarding = false;
    show("projects");
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

  setupNavigation();
  setupIdeaForm();
  setupProfileForm();
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

  authorize();
});
