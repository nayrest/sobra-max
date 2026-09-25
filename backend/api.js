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

// ======================================================
// СПРАВОЧНИКИ (совпадают со значениями, которые пишет бот)
// ======================================================

const STAGES = ["Идея", "Прототип", "MVP", "Первые продажи", "Масштабирование"];
const MARKET_TYPES = ["B2B", "B2C", "B2B2C"];
const CATEGORIES = ["AI", "SaaS", "FoodTech", "FinTech", "EdTech", "E-commerce", "Другое"];

const SEEKING = {
  investment: "Инвестиции",
  pilot: "Пилот / клиент",
  team: "Команда / co-founder",
  partner: "Партнёрство",
};

// Бот сохраняет тип предложения текстом — API пишет тот же текст,
// чтобы данные из бота и из мини-аппа не расходились.
const OFFER_TYPES = {
  investment: "💰 Инвестиции",
  pilot: "🧪 Пилот / сотрудничество",
  team: "👥 Присоединиться к команде",
  partner: "🤝 Партнёрство",
};

// ======================================================
// ОШИБКИ
// ======================================================

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
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

  return { userId: Number(user.id), name };
}

function extractInitData(req) {
  const header = req.get("authorization") || "";
  if (header.startsWith("Bearer ")) return header.slice("Bearer ".length).trim();
  return req.get("x-max-init-data") || null;
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
    let user = validateInitData(extractInitData(req), botToken);

    if (!user && debugAuth && req.get("x-debug-user-id")) {
      user = { userId: parseId(req.get("x-debug-user-id")), name: "Debug User" };
    }

    if (!user) {
      throw new ApiError(401, "Требуется авторизация через MAX (initData отсутствует, устарел или подпись неверна)");
    }

    req.user = user;
    await db.ensureUser(user.userId, user.name);
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
  app.use(express.json({ limit: "100kb" }));

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

  // ---------- health (без авторизации, для проверки деплоя) ----------

  app.get("/api/health", wrap(async (req, res) => {
    await db.pool.query("SELECT 1");
    res.json({ status: "ok" });
  }));

  // ---------- auth ----------

  app.post("/api/auth", wrap(async (req, res) => {
    const user = validateInitData(req.body?.init_data, botToken);
    if (!user) throw new ApiError(401, "initData отсутствует, устарел или подпись неверна");

    await db.ensureUser(user.userId, user.name);
    res.json({ user_id: user.userId, name: user.name });
  }));

  // Всё ниже требует авторизации
  app.use("/api", authMiddleware(botToken));

  // ---------- startups (founder) ----------

  // Idea Check: обязательные блоки описывают суть, остальные можно заполнить позже —
  // незаполненные честно попадут в карту проекта как «не проработано».
  const REQUIRED_IDEA = ["customer", "problem", "solution", "partner_needed"];
  const OPTIONAL_IDEA = ["competitors", "traction", "business_model", "economics"];

  async function withIdeaMap(startup) {
    const { map, readiness } = await ideaCheck.buildIdeaMap(startup);
    return db.saveIdeaMap(startup.id, map, readiness);
  }

  app.post("/api/startups", wrap(async (req, res) => {
    const body = req.body || {};
    const seeking = requireOneOf(body.seeking, Object.values(SEEKING), "seeking");

    const data = {
      name: requireText(body, "name", 100),
      category: requireOneOf(body.category, CATEGORIES, "category"),
      market_type: requireOneOf(body.market_type, MARKET_TYPES, "market_type"),
      stage: requireOneOf(body.stage, STAGES, "stage"),
      seeking,
      investment_amount:
        seeking === SEEKING.investment ? optionalMoney(body.investment_amount, "investment_amount") : null,
    };
    for (const field of REQUIRED_IDEA) data[field] = requireText(body, field);
    for (const field of OPTIONAL_IDEA) data[field] = optionalText(body, field);

    const startup = await db.saveStartupDraft(req.user.userId, data);
    res.status(201).json(await withIdeaMap(startup));
  }));

  // Обновить отдельные блоки Idea Check без повторного прохождения всей формы
  app.patch("/api/startups/:id", wrap(async (req, res) => {
    const startup = await getOwnStartup(req);
    const body = req.body || {};
    const fields = {};

    for (const field of REQUIRED_IDEA) {
      if (field in body) fields[field] = requireText(body, field);
    }
    for (const field of OPTIONAL_IDEA) {
      if (field in body) fields[field] = optionalText(body, field);
    }
    if (Object.keys(fields).length === 0) throw new ApiError(400, "Нет полей для обновления");

    const updated = await db.updateIdeaFields(startup.id, req.user.userId, fields);
    res.json(await withIdeaMap(updated));
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
    if (!startup || Number(startup.founder_id) !== req.user.userId) {
      throw new ApiError(404, "Проект не найден");
    }
    return startup;
  }

  app.get("/api/startups/:id", wrap(async (req, res) => {
    res.json(await getOwnStartup(req));
  }));

  app.post("/api/startups/:id/publish", wrap(async (req, res) => {
    const startup = await getOwnStartup(req);
    if (startup.status === "published") return res.json(startup);

    const published = await db.publishStartup(startup.id, req.user.userId);
    res.json(published);
  }));

  app.delete("/api/startups/:id", wrap(async (req, res) => {
    const startup = await getOwnStartup(req);
    if (startup.status !== "draft") {
      throw new ApiError(409, "Удалить можно только черновик");
    }

    await db.deleteDraft(startup.id, req.user.userId);
    res.status(204).end();
  }));

  // ---------- search ----------

  app.post("/api/search", wrap(async (req, res) => {
    const body = req.body || {};
    const goal = requireOneOf(body.goal, Object.keys(SEEKING), "goal");

    const criteria = {
      goal,
      category: requireOneOf(body.category, [...CATEGORIES, "Любая"], "category"),
      min_stage: requireOneOf(body.min_stage, STAGES, "min_stage"),
      max_investment: goal === "investment" ? optionalMoney(body.max_investment, "max_investment") : null,
    };

    // «О себе» для AI Matching: из запроса, а если не передано — из профиля кандидата
    let about = optionalText(body, "about", 1500);
    if (!about) {
      const profile = await db.getSearchProfile(req.user.userId);
      about = profile?.about || null;
    }

    await db.saveSearchProfile(req.user.userId, { ...criteria, about });
    const found = await db.findMatches(criteria);

    // ИИ оценивает только то, что прошло фильтры. При сбое ИИ поиск всё равно отвечает.
    const { matches, ai } = await aiMatching.enrichMatches(about, criteria, found);
    res.json({ matches, ai });
  }));

  app.get("/api/search/profile", wrap(async (req, res) => {
    res.json(await db.getSearchProfile(req.user.userId));
  }));

  // ---------- профиль кандидата ----------

  app.get("/api/profile", wrap(async (req, res) => {
    const profile = await db.getSearchProfile(req.user.userId);
    res.json({
      name: req.user.name,
      goal: profile?.goal || null,
      category: profile?.category || "Любая",
      about: profile?.about || "",
      visible: Boolean(profile?.visible),
    });
  }));

  app.put("/api/profile", wrap(async (req, res) => {
    const body = req.body || {};
    const current = await db.getSearchProfile(req.user.userId);

    const goal = requireOneOf(body.goal, Object.keys(SEEKING), "goal");
    const about = requireText(body, "about", 1500);
    const visible = body.visible === true;

    await db.saveSearchProfile(req.user.userId, {
      goal,
      category: requireOneOf(body.category || "Любая", [...CATEGORIES, "Любая"], "category"),
      min_stage: current?.min_stage || "Идея",
      max_investment: current?.max_investment || null,
      about,
      visible,
    });

    res.json({ name: req.user.name, goal, category: body.category || "Любая", about, visible });
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
    const invited = new Set(await db.getInvitedUserIds(startup.id));

    res.json({
      ai,
      candidates: candidates.map((c) => ({
        user_id: Number(c.user_id),
        name: c.name || "Пользователь MAX",
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

    const invite = await db.createInvite(startup.id, userId);
    if (!invite) throw new ApiError(409, "Этот кандидат уже приглашён");

    await safeNotify(notify.invite, startup, userId);
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

    // Имя берём из проверенного initData, а не из тела запроса — его нельзя подделать
    const offer = await db.createOffer(
      startup.id,
      req.user.userId,
      req.user.name,
      OFFER_TYPES[typeKey],
      message
    );

    await safeNotify(notify.newOffer, startup, offer);
    res.status(201).json(offer);
  }));

  app.get("/api/offers/received", wrap(async (req, res) => {
    const offers = await db.getReceivedOffers(req.user.userId);
    res.json({ offers });
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

    await db.updateOfferStatus(offerId, status);
    const updated = { ...offer, status };

    await safeNotify(notifyFn, updated);
    res.json(updated);
  }

  app.post("/api/offers/:id/accept", wrap((req, res) =>
    decideOffer(req, res, "accepted", notify.offerAccepted)
  ));

  app.post("/api/offers/:id/reject", wrap((req, res) =>
    decideOffer(req, res, "rejected", notify.offerRejected)
  ));

  // ---------- contacts (после MATCH) ----------

  app.get("/api/contacts", wrap(async (req, res) => {
    const contacts = await db.getContactsForFounder(req.user.userId);
    res.json({ contacts });
  }));

  app.get("/api/matches", wrap(async (req, res) => {
    const matches = await db.getContactsForCandidate(req.user.userId);
    res.json({ matches });
  }));

  // ---------- 404 и общий обработчик ошибок ----------

  app.use("/api", (req, res) => {
    res.status(404).json({ error: "Эндпоинт не найден" });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof ApiError) {
      return res.status(err.status).json({ error: err.message });
    }
    if (err.type === "entity.parse.failed") {
      return res.status(400).json({ error: "Некорректный JSON в теле запроса" });
    }

    console.error("❌ Ошибка API:", err);
    res.status(500).json({ error: "Внутренняя ошибка сервера" });
  });

  return app;
}

module.exports = { createApi, validateInitData };
