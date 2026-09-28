// api.js
// REST API для мини-приложения SOBRA / Startup Discovery.
// Работает поверх той же бизнес-логики (db.js), что и чат-бот.
//
// Подключение в index.js:
//   const { createApi } = require("./api");
//   const app = createApi({ notify });
//   app.listen(PORT);

const crypto = require("crypto");
const express = require("express");
const db = require("./db");
const aiMatching = require("./ai-matching");
const ideaCheck = require("./idea-check");
const actionPlan = require("./action-plan");
const { autofillIdea } = require("./idea-autofill");

// ======================================================
// СПРАВОЧНИКИ (совпадают со значениями, которые пишет бот)
// ======================================================

const STAGES = ["Идея", "Прототип", "MVP", "Первые продажи", "Масштабирование"];
const MARKET_TYPES = ["B2B", "B2C", "B2B2C"];
// Сферы проекта — понятными словами, а не отраслевыми терминами (отзыв пилота 27.09.2026)
const CATEGORIES = [
  "Ресторан / кафе / кофейня", "Магазин / E-commerce", "Услуги", "Производство", "Образование", "Финансы", "Технологии / IT / SaaS", "AI / ИИ", "Маркетинг / медиа", "Логистика / доставка", "Другое",
];
// Старые названия принимаются и переводятся в новые: у кого-то в MAX может быть закэширована старая версия
const LEGACY_CATEGORY = {
  AI: "AI / ИИ",
  SaaS: "Технологии / IT / SaaS",
  FoodTech: "Ресторан / кафе / кофейня",
  FinTech: "Финансы",
  EdTech: "Образование",
  "E-commerce": "Магазин / E-commerce",
};
const normalizeCategory = (value) => (typeof value === "string" && LEGACY_CATEGORY[value]) || value;

const SEEKING = {
  team: "Команда / co-founder",
  partner: "Партнёрство",
};

// Цель в профиле. own — человек развивает свою идею и не ищет чужой проект:
// его не показывают основателям в подборе, «О себе» для него необязательно.
const PROFILE_GOALS = [...Object.keys(SEEKING), "own"];

// Бот сохраняет тип предложения текстом — API пишет тот же текст,
// чтобы данные из бота и из мини-аппа не расходились.
const OFFER_TYPES = {
  team: "👥 Присоединиться к команде",
  partner: "🤝 Партнёрство",
};

// ======================================================
// ОШИБКИ
// ======================================================

class ApiError extends Error {
  constructor(status, message, code = null) {
    super(message);
    this.status = status;
    this.code = code; // машиночитаемая причина, например profile_required
  }
}

// Оборачивает async-обработчик, чтобы ошибки попадали в общий обработчик
const wrap = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

function parseId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ApiError(400, "Некорректный id");
  }
  return id;
}

function requireText(body, field, maxLength = 1000) {
  const value = body[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ApiError(400, `Поле "${field}" обязательно`);
  }
  if (value.length > maxLength) {
    throw new ApiError(400, `Поле "${field}" длиннее ${maxLength} символов`);
  }
  return value.trim();
}

function requireOneOf(value, allowed, field) {
  if (!allowed.includes(value)) {
    throw new ApiError(400, `Поле "${field}" должно быть одним из: ${allowed.join(", ")}`);
  }
  return value;
}

function optionalText(body, field, maxLength = 1000) {
  const value = body[field];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new ApiError(400, `Поле "${field}" должно быть строкой`);
  if (value.length > maxLength) throw new ApiError(400, `Поле "${field}" длиннее ${maxLength} символов`);
  return value.trim() || null;
}

function optionalMoney(value, field) {
  if (value === undefined || value === null || value === "") return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ApiError(400, `Поле "${field}" должно быть положительным числом`);
  }
  return Math.round(amount);
}

// ======================================================
// АВТОРИЗАЦИЯ: проверка initData по алгоритму MAX
// https://dev.max.ru/docs/webapps/validation
// ======================================================

const INIT_DATA_MAX_AGE_SECONDS = 24 * 60 * 60; // сессия мини-аппа действительна сутки

function validateInitData(initData, botToken) {
  if (typeof initData !== "string" || initData.length === 0) return null;

  const pairs = initData.split("&").map((part) => {
    const index = part.indexOf("=");
    return index === -1 ? [part, ""] : [part.slice(0, index), part.slice(index + 1)];
  });

  const hashes = pairs.filter(([key]) => key === "hash");
  if (hashes.length !== 1) return null;
  const originalHash = hashes[0][1];

  let decoded;
  try {
    decoded = pairs
      .filter(([key]) => key !== "hash")
      .map(([key, value]) => [key, decodeURIComponent(value)]);
  } catch {
    return null;
  }

  const launchParams = decoded
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const signature = crypto.createHmac("sha256", secretKey).update(launchParams).digest("hex");

  const a = Buffer.from(signature, "hex");
  const b = Buffer.from(originalHash, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  const params = Object.fromEntries(decoded);

  const authDate = Number(params.auth_date);
  if (!authDate || Date.now() / 1000 - authDate > INIT_DATA_MAX_AGE_SECONDS) return null;

  let user;
  try {
    user = JSON.parse(params.user);
  } catch {
    return null;
  }
  if (!user || !user.id) return null;

  const name = [user.first_name, user.last_name].filter(Boolean).join(" ") || user.username || null;

  // Ник нужен для кнопки «Написать в MAX» после MATCH. Берём только безопасные символы.
  const username =
    typeof user.username === "string" && /^[A-Za-z0-9_.-]{2,64}$/.test(user.username) ? user.username : null;

  return { userId: Number(user.id), name, username };
}

// ======================================================
// ПОДТВЕРЖДЕНИЕ ТЕЛЕФОНА ЧЕРЕЗ MAX (WebApp.requestContact)
// https://dev.max.ru/docs/webapps/bridge
// ======================================================
// MAX подписывает номер, привязанный к аккаунту: HMAC-SHA256(authDate\nphone\nuserId, токен бота),
// номер без «+». Документация не уточняет, пишутся ли имена полей и в каком виде хэш,
// поэтому проверяем варианты. Без токена бота подделать ни один из них нельзя.

const CONTACT_MAX_AGE_SECONDS = 24 * 60 * 60;
let contactVariantLogged = false;

function verifyContact(contact, userId, botToken) {
  if (!contact || typeof contact !== "object" || !botToken) return null;
  const { phone, authDate, hash } = contact;
  if (typeof phone !== "string" || typeof hash !== "string" || authDate === undefined || authDate === null) return null;

  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) return null;

  const ad = String(authDate);
  const t = Number(ad);
  if (!Number.isFinite(t) || t <= 0) return null;
  const seconds = t > 1e12 ? t / 1000 : t; // authDate может прийти в секундах или миллисекундах
  if (Math.abs(Date.now() / 1000 - seconds) > CONTACT_MAX_AGE_SECONDS) return null;

  const strings = {
    values: `${ad}\n${digits}\n${userId}`,
    pairs: `authDate=${ad}\nphone=${digits}\nuserId=${userId}`,
  };
  const keys = {
    token: Buffer.from(botToken),
    webAppData: crypto.createHmac("sha256", "WebAppData").update(botToken).digest(),
  };
  const given = hash.trim();

  for (const [sName, str] of Object.entries(strings)) {
    for (const [kName, key] of Object.entries(keys)) {
      const digest = crypto.createHmac("sha256", key).update(str).digest();
      const candidates = [digest.toString("hex"), digest.toString("base64"), digest.toString("base64url")];
      const matched = candidates.some((c) => {
        const a = Buffer.from(c);
        const b = Buffer.from(c === candidates[0] ? given.toLowerCase() : given);
        return a.length === b.length && crypto.timingSafeEqual(a, b);
      });
      if (matched) {
        if (!contactVariantLogged) {
          console.log(`ℹ️  Телефон через MAX подтверждён (формат подписи: ${sName}/${kName})`);
          contactVariantLogged = true;
        }
        return "+" + digits;
      }
    }
  }
  return null;
}

// ======================================================
// СОБЫТИЯ В РЕАЛЬНОМ ВРЕМЕНИ (Server-Sent Events)
// ======================================================
// Мини-приложение держит открытое соединение GET /api/events. Когда пользователю приходит
// отклик, приглашение или MATCH, сервер шлёт событие, и приложение сразу обновляет счётчики.
// EventSource не умеет передавать заголовок авторизации, поэтому соединение открывается
// по короткоживущему пропуску, который выдаёт авторизованный метод /api/events/ticket.

const EVENT_TICKET_TTL_SECONDS = 5 * 60;
const EVENT_HEARTBEAT_MS = 20 * 1000; // меньше proxy_read_timeout в Nginx (30 с)
const EVENT_MAX_STREAMS_PER_USER = 5;

const eventStreams = new Map(); // userId -> Set(res)

function ticketKey(botToken) {
  return crypto.createHash("sha256").update(`sobra-events:${botToken || ""}`).digest();
}

function createEventTicket(userId, botToken) {
  const exp = Math.floor(Date.now() / 1000) + EVENT_TICKET_TTL_SECONDS;
  const payload = `${userId}.${exp}`;
  const sig = crypto.createHmac("sha256", ticketKey(botToken)).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

function readEventTicket(ticket, botToken) {
  const match = typeof ticket === "string" && ticket.match(/^(\d{1,20})\.(\d{1,12})\.([a-f0-9]{64})$/);
  if (!match) return null;
  const [, userId, exp, sig] = match;
  if (Number(exp) < Date.now() / 1000) return null;
  const expected = crypto.createHmac("sha256", ticketKey(botToken)).update(`${userId}.${exp}`).digest("hex");
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  return Number(userId);
}

// Сообщить пользователю (всем его открытым вкладкам), что счётчики изменились
function publishEvent(userId, type = "counters") {
  const streams = eventStreams.get(Number(userId));
  if (!streams) return;
  for (const res of streams) {
    try {
      res.write(`event: ${type}\ndata: {}\n\n`);
    } catch {
      // соединение уже закрыто — уберётся в обработчике close
    }
  }
}

function avatarUrl(token) {
  return token ? `/api/avatars/${token}` : null;
}

function extractInitData(req) {
  const header = req.get("authorization") || "";
  if (header.startsWith("Bearer ")) return header.slice("Bearer ".length).trim();
  return req.get("x-max-init-data") || null;
}

// ======================================================
// ТЕСТОВЫЕ УЧЁТНЫЕ ЗАПИСИ для автоматической проверки (DATA-API.yaml)
// ======================================================
// Робот платформы проверки не может подписать initData, поэтому ему выдаются
// два токена: X-Test-Token открывает ТОЛЬКО тестовых пользователей с фиксированными id.
// Зайти под реальным пользователем по токену нельзя. Если переменные не заданы — вход выключен.

const TEST_ACCOUNTS = [
  { env: "API_TEST_TOKEN_FOUNDER", userId: db.TEST_USERS.founder, name: "Тестовый основатель" },
  { env: "API_TEST_TOKEN_CANDIDATE", userId: db.TEST_USERS.candidate, name: "Тестовый кандидат" },
];

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function testAccountFromToken(req) {
  const token = req.get("x-test-token");
  if (!token) return null;
  for (const account of TEST_ACCOUNTS) {
    const expected = process.env[account.env];
    // Короткие токены не принимаем: их легко подобрать
    if (expected && expected.length >= 24 && safeEqual(token, expected)) {
      return { userId: account.userId, name: account.name };
    }
  }
  return null;
}

function authMiddleware(botToken) {
  const debugAuth = process.env.API_DEBUG_AUTH === "true";

  if (debugAuth) {
    console.warn(
      "⚠️  API_DEBUG_AUTH=true — принимается заголовок X-Debug-User-Id без проверки подписи. " +
        "Только для локальной отладки, НЕ включать на сервере для сдачи!"
    );
  }

  return wrap(async (req, res, next) => {
    let user = validateInitData(extractInitData(req), botToken) || testAccountFromToken(req);

    if (!user && debugAuth && req.get("x-debug-user-id")) {
      user = { userId: parseId(req.get("x-debug-user-id")), name: "Debug User" };
    }

    if (!user) {
      throw new ApiError(401, "Требуется авторизация через MAX (initData отсутствует, устарел или подпись неверна)");
    }

    req.user = user;
    await db.ensureUser(user.userId, user.name, user.username || null);
    next();
  });
}

// ======================================================
// ПРИЛОЖЕНИЕ
// ======================================================

/**
 * @param {object} options
 * @param {object} options.notify — функции уведомлений через бота (из index.js):
 *   notify.newOffer(startup, offer), notify.offerAccepted(offer), notify.offerRejected(offer)
 */
function createApi({ notify = {} } = {}) {
  const botToken = process.env.BOT_TOKEN;
  const app = express();

  app.disable("x-powered-by");
  // 300 КБ — с запасом под аватарку (в браузере она сжимается до ~20–40 КБ)
  app.use(express.json({ limit: "300kb" }));

  // Уведомления не должны ронять запрос: данные уже сохранены в БД
  const safeNotify = async (fn, ...args) => {
    if (typeof fn !== "function") return;
    try {
      await fn(...args);
    } catch (error) {
      if (/dialog not found/i.test(error.message)) {
        // MAX разрешает писать только тем, кто сам запускал бота.
        // Так бывает с демо-основателями и отладочными пользователями.
        console.warn("ℹ️  Уведомление не отправлено: получатель ещё не запускал бота в MAX");
      } else {
        console.error("❌ Ошибка уведомления через бота:", error.message);
      }
    }
  };

  // Контакты нужны только для MATCH. Поэтому профиль спрашиваем не при входе,
  // а перед публикацией проекта и перед откликом — когда без контактов не обойтись.
  async function requireCompleteProfile(req, message) {
    const p = await db.getSearchProfile(req.user.userId);
    const complete = p && p.contacts_consent_at && p.phone && p.email && p.last_name && p.first_name;
    if (!complete) throw new ApiError(409, message, "profile_required");
  }

  // ---------- демо-автоответы ----------
  // Через несколько секунд после отклика на демо-проект или приглашения демо-кандидата
  // сервер отвечает за вымышленного человека. Раз в минуту — проверка на случай перезапуска.
  let demoRunning = false;
  async function runDemoReplies() {
    if (demoRunning) return;
    demoRunning = true;
    try {
      for (const offer of await db.demoAcceptOffers()) {
        publishEvent(offer.sender_id);
        await safeNotify(notify.offerAccepted, offer);
      }
      for (const offer of await db.demoRespondToInvites(OFFER_TYPES)) {
        const startup = await db.getStartupById(offer.startup_id);
        if (!startup) continue;
        publishEvent(startup.founder_id);
        await safeNotify(notify.newOffer, startup, offer);
      }
    } catch (error) {
      console.error("❌ Ошибка демо-автоответа:", error.message);
    } finally {
      demoRunning = false;
    }
  }
  const scheduleDemoReply = () => setTimeout(runDemoReplies, 4000).unref();
  setInterval(runDemoReplies, 60 * 1000).unref();

  // ---------- суточные лимиты против массового сбора контактов и спама ----------
  // Тестовые учётные записи жюри лимитами не ограничены: автопроверки гоняются много раз.
  const DAILY_LIMITS = {
    startups: { max: 10, text: "Сегодня создано уже 10 проектов — это максимум на сутки" },
    offers: { max: 20, text: "Сегодня отправлено уже 20 откликов — это максимум на сутки" },
    invites: { max: 30, text: "Сегодня отправлено уже 30 приглашений — это максимум на сутки" },
    decisions: { max: 50, text: "Сегодня принято уже 50 решений по откликам — это максимум на сутки" },
    reports: { max: 20, text: "Сегодня отправлено уже 20 жалоб — это максимум на сутки" },
  };

  async function enforceDailyLimit(req, kind) {
    if (db.isTestUser(req.user.userId)) return;
    const limit = DAILY_LIMITS[kind];
    if ((await db.countRecent(kind, req.user.userId)) >= limit.max) {
      throw new ApiError(429, `${limit.text}. Попробуйте завтра.`);
    }
  }

  // ---------- health (без авторизации, для проверки деплоя) ----------

  app.get("/api/health", wrap(async (req, res) => {
    await db.pool.query("SELECT 1");
    res.json({ status: "ok" });
  }));

  // ---------- аватарки (без авторизации: <img> не умеет слать заголовки) ----------
  // Ссылка содержит случайный 128-битный токен и меняется при каждой загрузке фото.
  // Токен выдаётся только через авторизованные ответы API: профиль, подбор, контакты.

  app.get("/api/avatars/:token", wrap(async (req, res) => {
    const token = String(req.params.token || "");
    if (!/^[a-f0-9]{32}$/.test(token)) throw new ApiError(404, "Фото не найдено");

    const avatar = await db.getAvatarByToken(token);
    if (!avatar) throw new ApiError(404, "Фото не найдено");

    res.setHeader("Content-Type", avatar.type);
    res.setHeader("Content-Length", avatar.data.length);
    res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.end(avatar.data);
  }));

  // ---------- события в реальном времени (без заголовка авторизации — по пропуску) ----------

  app.get("/api/events", (req, res) => {
    const url = new URL(req.url, "http://local");
    const userId = readEventTicket(url.searchParams.get("ticket"), botToken);
    if (!userId) {
      res.status(401).json({ error: "Пропуск для событий устарел или неверен" });
      return;
    }

    const streams = eventStreams.get(userId) || new Set();
    if (streams.size >= EVENT_MAX_STREAMS_PER_USER) {
      // Старое соединение закрываем, новое принимаем (например, переоткрыли приложение)
      const oldest = streams.values().next().value;
      streams.delete(oldest);
      try { oldest.end(); } catch { /* уже закрыто */ }
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // Nginx не будет копить ответ в буфере
    if (typeof res.flushHeaders === "function") res.flushHeaders();
    res.write(`retry: 5000\nevent: ready\ndata: {}\n\n`);

    streams.add(res);
    eventStreams.set(userId, streams);

    const heartbeat = setInterval(() => {
      try { res.write(": ping\n\n"); } catch { /* закрыто */ }
    }, EVENT_HEARTBEAT_MS);

    // Именно res, а не req: у запроса «close» в Node срабатывает сразу после чтения тела
    res.on("close", () => {
      clearInterval(heartbeat);
      streams.delete(res);
      if (streams.size === 0) eventStreams.delete(userId);
    });
  });

  // ---------- auth ----------

  app.post("/api/auth", wrap(async (req, res) => {
    const user = validateInitData(req.body?.init_data, botToken);
    if (!user) throw new ApiError(401, "initData отсутствует, устарел или подпись неверна");

    await db.ensureUser(user.userId, user.name, user.username || null);
    res.json({ user_id: user.userId, name: user.name });
  }));

  // Всё ниже требует авторизации
  app.use("/api", authMiddleware(botToken));

  // ---------- startups (founder) ----------

  // Idea Check: обязательные блоки описывают суть, остальные можно заполнить позже —
  // незаполненные честно попадут в карту проекта как «не проработано».
  const REQUIRED_IDEA = ["customer", "problem", "solution", "partner_needed"];
  const OPTIONAL_IDEA = ["competitors", "traction", "business_model", "economics"];
  const IDEA_FIELD_MAX = 3000;

  // Пересчитывает карту и приводит в соответствие Action Plan
  async function withIdeaMap(startup) {
    const { map, readiness } = await ideaCheck.buildIdeaMap(startup);
    const saved = await db.saveIdeaMap(startup.id, map, readiness);
    await db.syncTasks(startup.id, map);
    return saved;
  }

  const BLOCK_TITLES = Object.fromEntries(ideaCheck.BLOCKS.map((b) => [b.id, b.title]));

  function serializeTask(task) {
    const template = actionPlan.templateFor(task.block_id);
    const method = typeof task.method === "string" ? JSON.parse(task.method) : task.method;
    return {
      id: task.id,
      block_id: task.block_id,
      block_title: BLOCK_TITLES[task.block_id] || task.block_id,
      title: task.title,
      method: Array.isArray(method) ? method : template.method,
      method_source: task.method_source,
      result_hint: template.resultHint,
      status: task.status,
      result: task.result,
      status_before: task.status_before,
      status_after: task.status_after,
      readiness_before: task.readiness_before,
      readiness_after: task.readiness_after,
      created_at: task.created_at,
      done_at: task.done_at,
    };
  }

  // Статистика не должна ломать ответ пользователю
  async function logAiMatches(rows) {
    try {
      await db.logAiMatches(rows);
    } catch (error) {
      console.error("❌ Журнал AI Match:", error.message);
    }
  }

  // Проект вместе с Action Plan. Если задач ещё нет (проект создан до появления
  // Action Plan), они создаются по сохранённой карте.
  async function withTasks(startup) {
    let tasks = await db.getTasks(startup.id);
    if (tasks.length === 0 && startup.idea_map) {
      await db.syncTasks(startup.id, startup.idea_map);
      tasks = await db.getTasks(startup.id);
    }
    return { ...startup, tasks: tasks.map(serializeTask) };
  }

  app.post("/api/startups", wrap(async (req, res) => {
    const body = req.body || {};
    const seeking = requireOneOf(body.seeking, Object.values(SEEKING), "seeking");

    const data = {
      name: requireText(body, "name", 100),
      category: requireOneOf(normalizeCategory(body.category), CATEGORIES, "category"),
      market_type: requireOneOf(body.market_type, MARKET_TYPES, "market_type"),
      stage: requireOneOf(body.stage, STAGES, "stage"),
      seeking,
      investment_amount: null,
    };
    for (const field of REQUIRED_IDEA) data[field] = requireText(body, field);
    for (const field of OPTIONAL_IDEA) data[field] = optionalText(body, field);

    await enforceDailyLimit(req, "startups");
    const startup = await db.saveStartupDraft(req.user.userId, data);
    res.status(201).json(await withTasks(await withIdeaMap(startup)));
  }));

  // Быстрый старт: ИИ раскладывает свободное описание идеи по полям формы (черновик, ничего не сохраняет).
  // Лимит в сутки — в памяти процесса: это дешёвая защита от перебора, а не учёт.
  const AUTOFILL_DAILY_MAX = 30;
  const autofillUsage = new Map(); // userId -> { day, count }

  app.post("/api/startups/autofill", wrap(async (req, res) => {
    const description = requireText(req.body || {}, "description", 1500);
    if (description.replace(/\s+/g, " ").trim().length < 15) {
      throw new ApiError(400, "Опишите идею чуть подробнее — хотя бы одно-два предложения");
    }

    const day = new Date().toISOString().slice(0, 10);
    const usage = autofillUsage.get(req.user.userId);
    const count = usage && usage.day === day ? usage.count : 0;
    if (!db.isTestUser(req.user.userId) && count >= AUTOFILL_DAILY_MAX) {
      throw new ApiError(429, "Сегодня автозаполнение использовано уже 30 раз. Заполните форму вручную или попробуйте завтра.");
    }
    autofillUsage.set(req.user.userId, { day, count: count + 1 });

    try {
      const fields = await autofillIdea(description, {
        categories: CATEGORIES,
        stages: STAGES,
        marketTypes: MARKET_TYPES,
        seekingValues: Object.values(SEEKING),
      });
      res.json({ fields });
    } catch (error) {
      if (error.message === "AI_DISABLED") {
        throw new ApiError(503, "ИИ сейчас недоступен. Заполните форму вручную — карта проекта всё равно построится.");
      }
      console.error("❌ Ошибка автозаполнения:", error.message);
      throw new ApiError(502, "ИИ не смог разобрать описание. Попробуйте ещё раз или заполните форму вручную.");
    }
  }));

  // Обновить отдельные блоки Idea Check без повторного прохождения всей формы
  app.patch("/api/startups/:id", wrap(async (req, res) => {
    const startup = await getOwnStartup(req);
    const body = req.body || {};
    const fields = {};

    // 3000 символов: в блок дописываются результаты проверок (шаг Update)
    for (const field of REQUIRED_IDEA) {
      if (field in body) fields[field] = requireText(body, field, IDEA_FIELD_MAX);
    }
    for (const field of OPTIONAL_IDEA) {
      if (field in body) fields[field] = optionalText(body, field, IDEA_FIELD_MAX);
    }
    if (Object.keys(fields).length === 0) throw new ApiError(400, "Нет полей для обновления");

    const updated = await db.updateIdeaFields(startup.id, req.user.userId, fields);
    res.json(await withTasks(await withIdeaMap(updated)));
  }));

  // /my и /public/:id объявлены раньше /:id, чтобы не перехватывались им
  app.get("/api/startups/my", wrap(async (req, res) => {
    const startups = await db.getFounderStartups(req.user.userId);
    res.json({ startups });
  }));

  app.get("/api/startups/public/:id", wrap(async (req, res) => {
    const startup = await db.getPublishedStartupById(parseId(req.params.id));
    if (!startup) throw new ApiError(404, "Проект не найден или не опубликован");
    res.json(startup);
  }));

  async function getOwnStartup(req) {
    const startup = await db.getStartupById(parseId(req.params.id));
    if (!startup || Number(startup.founder_id) !== req.user.userId || startup.status === "deleted") {
      throw new ApiError(404, "Проект не найден");
    }
    return startup;
  }

  app.get("/api/startups/:id", wrap(async (req, res) => {
    let startup = await getOwnStartup(req);
    // Проекты, созданные до Idea Check (например, демо-данные), получают карту при первом открытии
    if (!startup.idea_map) startup = await withIdeaMap(startup);
    res.json(await withTasks(startup));
  }));

  // ---------- Action Plan (шаг 3) и Update (шаг 4) ----------

  async function getOwnOpenTask(req, startup) {
    const task = await db.getTask(startup.id, parseId(req.params.taskId));
    if (!task) throw new ApiError(404, "Задача не найдена");
    if (task.status !== "open") throw new ApiError(409, "Эта задача уже выполнена");
    return task;
  }

  // ИИ расписывает методику под конкретный проект. Если ИИ недоступен — остаётся шаблон.
  app.post("/api/startups/:id/tasks/:taskId/method", wrap(async (req, res) => {
    const startup = await getOwnStartup(req);
    const task = await getOwnOpenTask(req, startup);

    const { steps, source } = await actionPlan.buildMethod(startup, task);
    const saved = source === "ai" ? await db.saveTaskMethod(task.id, steps, source) : task;
    res.json({ task: serializeTask(saved), ai: source === "ai" });
  }));

  // Update: основатель вернулся с результатом. Результат дописывается в блок,
  // карта пересчитывается, в задаче фиксируется «было → стало».
  // Если блок всё ещё не подтверждён, по нему появляется следующая задача.
  app.post("/api/startups/:id/tasks/:taskId/complete", wrap(async (req, res) => {
    const startup = await getOwnStartup(req);
    const task = await getOwnOpenTask(req, startup);
    const result = requireText(req.body || {}, "result", 1000);

    const block = ideaCheck.BLOCKS.find((b) => b.id === task.block_id);
    if (!block) throw new ApiError(400, "Неизвестный блок карты");

    const nextValue = actionPlan.appendResult(startup[block.field], result);
    if (nextValue.length > IDEA_FIELD_MAX) {
      throw new ApiError(400, "В блоке накопилось слишком много текста. Сократите его через «Обновить блок» и попробуйте снова.");
    }

    const statusBefore = startup.idea_map?.[block.id]?.status || "missing";
    const readinessBefore = startup.readiness ?? 0;

    const closed = await db.completeTask(task.id, { result, statusBefore, readinessBefore });
    if (!closed) throw new ApiError(409, "Эта задача уже выполнена");

    const updated = await withIdeaMap(
      await db.updateIdeaFields(startup.id, req.user.userId, { [block.field]: nextValue })
    );
    const statusAfter = updated.idea_map?.[block.id]?.status || "missing";
    await db.saveTaskOutcome(task.id, statusAfter, updated.readiness);

    res.json({
      startup: await withTasks(updated),
      update: {
        task_id: task.id,
        block_id: block.id,
        block_title: block.title,
        status_before: statusBefore,
        status_after: statusAfter,
        readiness_before: readinessBefore,
        readiness_after: updated.readiness,
        comment: updated.idea_map?.[block.id]?.comment || "",
      },
    });
  }));

  app.post("/api/startups/:id/publish", wrap(async (req, res) => {
    const startup = await getOwnStartup(req);
    if (startup.status === "published") return res.json(startup);
    await requireCompleteProfile(req, "Чтобы опубликовать проект, заполните профиль: контакты увидит только тот, с кем случится MATCH.");

    const published = await db.publishStartup(startup.id, req.user.userId);
    res.json(published);
  }));

  app.delete("/api/startups/:id", wrap(async (req, res) => {
    const startup = await getOwnStartup(req);
    const affected = await db.deleteStartup(startup.id, req.user.userId);
    for (const userId of affected) publishEvent(userId);
    res.status(204).end();
  }));

  // ---------- search ----------

  app.post("/api/search", wrap(async (req, res) => {
    const body = req.body || {};
    const goal = requireOneOf(body.goal, Object.keys(SEEKING), "goal");

    const criteria = {
      goal,
      category: requireOneOf(normalizeCategory(body.category), [...CATEGORIES, "Любая"], "category"),
      min_stage: requireOneOf(body.min_stage, STAGES, "min_stage"),
      max_investment: null,
    };

    // «О себе» для AI Matching: из запроса, а если не передано — из профиля кандидата
    const profile = await db.getSearchProfile(req.user.userId);
    const about = optionalText(body, "about", 1500) || profile?.about || null;

    // Цель «развиваю свою идею» поиск не меняет: человек просто смотрит чужие проекты
    const savedGoal = profile?.goal === "own" ? "own" : goal;
    await db.saveSearchProfile(req.user.userId, { ...criteria, goal: savedGoal, about });
    const found = await db.findMatches(criteria, req.user.userId);

    // ИИ оценивает только то, что прошло фильтры. При сбое ИИ поиск всё равно отвечает.
    const { matches, ai } = await aiMatching.enrichMatches(about, criteria, found);
    await logAiMatches(
      matches
        .filter((m) => m.ai && Number.isFinite(m.ai.score))
        .map((m) => ({
          kind: "search",
          startup_id: m.startup.id,
          founder_id: m.startup.founder_id,
          candidate_id: req.user.userId,
          score: Math.round(m.ai.score),
          verdict: m.ai.verdict,
        }))
    );
    res.json({ matches, ai });
  }));

  app.get("/api/search/profile", wrap(async (req, res) => {
    // Байты фото в JSON не нужны: для картинки есть /api/avatars/:token
    const { avatar, ...profile } = (await db.getSearchProfile(req.user.userId)) || {};
    res.json(Object.keys(profile).length ? profile : null);
  }));

  // ---------- профиль кандидата ----------

  // Российский номер: +7 / 8 / без кода, 10 цифр после кода страны.
  // Сохраняем в формате +7XXXXXXXXXX.
  function normalizeRuPhone(raw) {
    if (typeof raw !== "string") return null;
    let digits = raw.replace(/\D/g, "");
    if (digits.length === 11 && (digits[0] === "7" || digits[0] === "8")) {
      digits = digits.slice(1);
    }
    if (digits.length !== 10) return null;
    // Мобильные обычно на 9; городские — другие коды. Разрешаем любые 10 цифр РФ.
    return `+7${digits}`;
  }

  // Ссылка на профиль в MAX: https://max.ru/... или max.me/... (схему можно не писать).
  // Пустая строка — очистить. Возвращает undefined, если поле не передано.
  function parseMaxLink(raw) {
    if (raw === undefined) return undefined;
    if (raw === null) return null;
    if (typeof raw !== "string") throw new ApiError(400, "Ссылка на профиль MAX должна быть строкой");
    let link = raw.trim();
    if (!link) return null;
    if (!/^https?:\/\//i.test(link)) link = "https://" + link;
    link = link.replace(/^http:\/\//i, "https://");
    if (link.length > 300 || !/^https:\/\/(www\.)?(max\.ru|max\.me)\/[A-Za-z0-9_.\-\/?=&%#+~]+$/i.test(link)) {
      throw new ApiError(400, "Укажите ссылку на профиль MAX вида https://max.ru/…");
    }
    return link;
  }

  app.get("/api/profile", wrap(async (req, res) => {
    const profile = await db.getSearchProfile(req.user.userId);
    res.json({
      name: req.user.name,
      last_name: profile?.last_name || "",
      first_name: profile?.first_name || "",
      patronymic: profile?.patronymic || "",
      full_name: profile?.full_name || req.user.name || "",
      email: profile?.email || "",
      phone: profile?.phone || "",
      goal: profile?.goal || null,
      category: profile?.category || "Любая",
      about: profile?.about || "",
      visible: Boolean(profile?.visible),
      consent: Boolean(profile?.contacts_consent_at),
      avatar_url: avatarUrl(profile?.avatar_token),
      phone_verified: Boolean(profile?.phone_verified_at),
      max_link: profile?.max_link || "",
      max_username: req.user.username || (await db.getUsername(req.user.userId)),
    });
  }));

  app.put("/api/profile", wrap(async (req, res) => {
    const body = req.body || {};
    const current = await db.getSearchProfile(req.user.userId);

    const lastName = requireText(body, "last_name", 80);
    const firstName = requireText(body, "first_name", 80);
    const patronymic =
      typeof body.patronymic === "string" ? body.patronymic.trim().slice(0, 80) : "";

    const email = requireText(body, "email", 200);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new ApiError(400, "Укажите корректный e-mail");
    }

    const phone = normalizeRuPhone(body.phone);
    if (!phone) {
      throw new ApiError(400, "Укажите российский номер телефона: +7 XXX XXX-XX-XX");
    }

    const goal = requireOneOf(body.goal, PROFILE_GOALS, "goal");
    const about = goal === "own" ? optionalText(body, "about", 1500) || "" : requireText(body, "about", 1500);
    const visible = goal !== "own" && body.visible === true;

    // Без согласия не сохраняем контакты: их увидит тот, с кем случится MATCH
    if (body.consent !== true) {
      throw new ApiError(400, "Подтвердите согласие на показ контактов после MATCH");
    }
    const fullName = [lastName, firstName, patronymic].filter(Boolean).join(" ");
    const maxLink = parseMaxLink(body.max_link);

    await db.saveSearchProfile(req.user.userId, {
      goal,
      category: requireOneOf(normalizeCategory(body.category) || "Любая", [...CATEGORIES, "Любая"], "category"),
      min_stage: current?.min_stage || "Идея",
      max_investment: current?.max_investment || null,
      about,
      visible,
      last_name: lastName,
      first_name: firstName,
      patronymic: patronymic || null,
      full_name: fullName,
      email,
      phone,
    });
    await db.saveContactsConsent(req.user.userId);
    if (maxLink !== undefined) await db.saveMaxLink(req.user.userId, maxLink);
    // Номер поменяли вручную — отметка «подтверждён через MAX» снимается
    await db.syncPhoneVerification(req.user.userId);
    const saved = await db.getSearchProfile(req.user.userId);

    res.json({
      name: req.user.name,
      last_name: lastName,
      first_name: firstName,
      patronymic,
      full_name: fullName,
      email,
      phone,
      goal,
      category: body.category || "Любая",
      about,
      visible,
      consent: true,
      avatar_url: avatarUrl(current?.avatar_token),
      phone_verified: Boolean(saved?.phone_verified_at),
      max_link: maxLink === undefined ? current?.max_link || "" : maxLink || "",
      max_username: req.user.username || (await db.getUsername(req.user.userId)),
    });
  }));

  // ---------- подтверждение телефона через MAX ----------

  app.post("/api/profile/phone", wrap(async (req, res) => {
    const phone = verifyContact(req.body || {}, req.user.userId, botToken);
    if (!phone) {
      throw new ApiError(400, "Не удалось подтвердить номер: подпись MAX не совпала или устарела. Попробуйте ещё раз.");
    }
    await db.saveVerifiedPhone(req.user.userId, phone);
    res.json({ phone, phone_verified: true });
  }));

  // ---------- жалобы ----------

  const REPORT_REASONS = {
    money: "Просит деньги или предоплату",
    fake: "Фейк или выдаёт себя за другого",
    spam: "Спам или реклама",
    rude: "Оскорбления",
    other: "Другое",
  };

  app.post("/api/reports", wrap(async (req, res) => {
    const body = req.body || {};
    const targetType = requireOneOf(body.target_type, ["startup", "user"], "target_type");
    const targetId = parseId(body.target_id);
    const reason = requireOneOf(body.reason, Object.keys(REPORT_REASONS), "reason");
    const comment = optionalText(body, "comment", 500);

    if (targetType === "startup") {
      const startup = await db.getStartupById(targetId);
      if (!startup) throw new ApiError(404, "Проект не найден");
      if (Number(startup.founder_id) === req.user.userId) throw new ApiError(400, "Нельзя пожаловаться на свой проект");
    } else {
      if (targetId === req.user.userId) throw new ApiError(400, "Нельзя пожаловаться на себя");
      if (!(await db.userExists(targetId))) throw new ApiError(404, "Пользователь не найден");
    }

    await enforceDailyLimit(req, "reports");
    const created = await db.createReport(req.user.userId, targetType, targetId, reason, comment);
    if (!created) throw new ApiError(409, "Вы уже отправляли жалобу на это");

    console.warn(`⚑ Жалоба #${created.report.id}: ${targetType} ${targetId}, причина «${REPORT_REASONS[reason]}», всего жалоб от разных людей: ${created.reporters}`);
    res.status(201).json({ id: created.report.id, hidden: created.hidden });
  }));

  // ---------- аватарка ----------

  // Принимаем data URL. Картинку в браузере заранее обрезаем до квадрата 256×256 и сжимаем.
  const AVATAR_MAX_BYTES = 200 * 1024;
  const AVATAR_SIGNATURES = {
    "image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
    "image/png": (b) => b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    "image/webp": (b) => b.slice(0, 4).toString("latin1") === "RIFF" && b.slice(8, 12).toString("latin1") === "WEBP",
  };

  app.put("/api/profile/avatar", wrap(async (req, res) => {
    const image = req.body?.image;
    const match = typeof image === "string" && image.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
    if (!match) throw new ApiError(400, "Загрузите изображение JPG, PNG или WebP");

    const [, mimeType, base64] = match;
    const bytes = Buffer.from(base64, "base64");
    if (bytes.length === 0 || bytes.length > AVATAR_MAX_BYTES) {
      throw new ApiError(400, "Фото слишком большое: не больше 200 КБ после сжатия");
    }
    // Проверяем содержимое, а не только заявленный тип
    if (!AVATAR_SIGNATURES[mimeType](bytes)) throw new ApiError(400, "Файл не похож на изображение");

    const token = crypto.randomBytes(16).toString("hex");
    await db.saveAvatar(req.user.userId, mimeType, bytes.toString("base64"), token);
    res.json({ avatar_url: avatarUrl(token) });
  }));

  app.delete("/api/profile/avatar", wrap(async (req, res) => {
    await db.deleteAvatar(req.user.userId);
    res.status(204).end();
  }));

  // ---------- подбор людей для основателя и приглашения ----------

  async function getOwnPublishedStartup(req) {
    const startup = await getOwnStartup(req);
    if (startup.status !== "published") {
      throw new ApiError(409, "Сначала опубликуйте проект: кандидаты откликаются только на опубликованные проекты");
    }
    return startup;
  }

  app.get("/api/startups/:id/candidates", wrap(async (req, res) => {
    const startup = await getOwnPublishedStartup(req);
    const found = await db.getCandidatesForStartup(startup);
    const { candidates, ai } = await aiMatching.rankCandidates(startup, found);
    await logAiMatches(
      candidates
        .filter((c) => c.ai && Number.isFinite(c.ai.score))
        .map((c) => ({
          kind: "candidates",
          startup_id: startup.id,
          founder_id: startup.founder_id,
          candidate_id: c.user_id,
          score: Math.round(c.ai.score),
          verdict: c.ai.verdict,
        }))
    );
    const invited = new Set(await db.getInvitedUserIds(startup.id));

    res.json({
      ai,
      candidates: candidates.map((c) => ({
        user_id: Number(c.user_id),
        name: c.name || "Пользователь MAX",
        avatar_url: avatarUrl(c.avatar_token),
        phone_verified: Boolean(c.phone_verified),
        goal: c.goal,
        about: c.about,
        ai: c.ai || null,
        invited: invited.has(Number(c.user_id)),
      })),
    });
  }));

  app.post("/api/startups/:id/invite", wrap(async (req, res) => {
    const startup = await getOwnPublishedStartup(req);
    const userId = parseId(req.body?.user_id);

    if (!(await db.isVisibleCandidate(userId))) {
      throw new ApiError(404, "Кандидат не найден или скрыл свой профиль");
    }

    await enforceDailyLimit(req, "invites");
    const invite = await db.createInvite(startup.id, userId);
    if (!invite) throw new ApiError(409, "Этот кандидат уже приглашён");

    publishEvent(userId);
    if (db.isDemoUser(userId)) scheduleDemoReply();
    else await safeNotify(notify.invite, startup, userId);
    res.status(201).json(invite);
  }));

  app.get("/api/invites", wrap(async (req, res) => {
    const invites = await db.getInvitesForUser(req.user.userId);
    res.json({ invites });
  }));

  // ---------- offers ----------

  app.post("/api/offers", wrap(async (req, res) => {
    const body = req.body || {};
    const startupId = parseId(body.startup_id);
    const typeKey = requireOneOf(body.type, Object.keys(OFFER_TYPES), "type");
    const message = requireText(body, "message", 1000);

    const startup = await db.getPublishedStartupById(startupId);
    if (!startup) throw new ApiError(404, "Проект больше недоступен");
    if (Number(startup.founder_id) === req.user.userId) throw new ApiError(400, "Нельзя откликнуться на свой проект");
    await requireCompleteProfile(req, "Чтобы откликнуться, заполните профиль: контакты увидит только основатель, если примет отклик.");
    await enforceDailyLimit(req, "offers");

    // Имя берём из проверенного initData, а не из тела запроса — его нельзя подделать
    const offer = await db.createOffer(
      startup.id,
      req.user.userId,
      req.user.name,
      OFFER_TYPES[typeKey],
      message
    );

    publishEvent(startup.founder_id);
    if (db.isDemoUser(startup.founder_id)) scheduleDemoReply();
    else await safeNotify(notify.newOffer, startup, offer);
    res.status(201).json(offer);
  }));

  app.get("/api/offers/received", wrap(async (req, res) => {
    const offers = await db.getReceivedOffers(req.user.userId);
    res.json({ offers: offers.map(({ sender_avatar, ...o }) => ({ ...o, sender_avatar_url: avatarUrl(sender_avatar) })) });
  }));

  async function decideOffer(req, res, status, notifyFn) {
    const offerId = parseId(req.params.id);
    const offer = await db.getOfferWithStartup(offerId);

    if (!offer || Number(offer.founder_id) !== req.user.userId) {
      throw new ApiError(403, "Нет доступа к этому предложению");
    }
    if (offer.status !== "new") {
      throw new ApiError(409, "По этому предложению уже принято решение");
    }
    await enforceDailyLimit(req, "decisions");

    await db.updateOfferStatus(offerId, status);
    const updated = { ...offer, status };
    publishEvent(offer.sender_id);

    await safeNotify(notifyFn, updated);
    res.json(updated);
  }

  app.post("/api/offers/:id/accept", wrap((req, res) =>
    decideOffer(req, res, "accepted", notify.offerAccepted)
  ));

  app.post("/api/offers/:id/reject", wrap((req, res) =>
    decideOffer(req, res, "rejected", notify.offerRejected)
  ));

  // ---------- счётчики новых событий ----------

  app.get("/api/events/ticket", wrap(async (req, res) => {
    res.json({ ticket: createEventTicket(req.user.userId, botToken), expires_in: EVENT_TICKET_TTL_SECONDS });
  }));

  app.get("/api/counters", wrap(async (req, res) => {
    res.json(await db.getCounters(req.user.userId));
  }));

  app.post("/api/counters/seen", wrap(async (req, res) => {
    const section = requireOneOf(req.body?.section, ["responses", "contacts"], "section");
    await db.markSeen(req.user.userId, section);
    publishEvent(req.user.userId); // другие устройства пользователя тоже погасят кружок
    res.status(204).end();
  }));

  // ---------- contacts (после MATCH) ----------

  // Статистика: человек нажал «Написать в MAX», телефон или e-mail в карточке MATCH
  app.post("/api/contacts/click", wrap(async (req, res) => {
    const offerId = parseId(req.body?.offer_id);
    const channel = requireOneOf(req.body?.channel, ["max", "phone", "email"], "channel");
    if (!(await db.logContactClick(req.user.userId, offerId, channel))) {
      throw new ApiError(404, "MATCH не найден");
    }
    res.status(204).end();
  }));

  app.get("/api/contacts", wrap(async (req, res) => {
    const contacts = await db.getContactsForFounder(req.user.userId);
    res.json({ contacts: contacts.map(({ candidate_avatar, ...c }) => ({ ...c, candidate_avatar_url: avatarUrl(candidate_avatar) })) });
  }));

  app.get("/api/matches", wrap(async (req, res) => {
    const matches = await db.getContactsForCandidate(req.user.userId);
    res.json({ matches: matches.map(({ founder_avatar, ...m }) => ({ ...m, founder_avatar_url: avatarUrl(founder_avatar) })) });
  }));

  // ---------- 404 и общий обработчик ошибок ----------

  app.use("/api", (req, res) => {
    res.status(404).json({ error: "Эндпоинт не найден" });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof ApiError) {
      return res.status(err.status).json(err.code ? { error: err.message, code: err.code } : { error: err.message });
    }
    if (err.type === "entity.parse.failed") {
      return res.status(400).json({ error: "Некорректный JSON в теле запроса" });
    }

    console.error("❌ Ошибка API:", err);
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  });

  return app;
}

module.exports = { createApi, validateInitData, publishEvent };
