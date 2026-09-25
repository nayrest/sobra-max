// db.js
// Обёртка над PostgreSQL (pg) для Startup Discovery / SOBRA bot.
// Заменяет прямые вызовы better-sqlite3 в index.js.
//
// Установка: npm install pg
//
// Использование в index.js:
//   const db = require("./db");
//   await db.init();
//   ...
//   const startup = await db.saveStartupDraft(userId, data);
//   ...

const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Пример DATABASE_URL:
  // postgres://user:password@postgres:5432/startup_discovery
});

// ======================================================
// INIT
// ======================================================

async function init() {
  const schemaPath = path.join(__dirname, "schema.sql");
  const schema = fs.readFileSync(schemaPath, "utf8");
  await pool.query(schema);
  console.log("💾 PostgreSQL: схема проверена/создана");
}

// ======================================================
// USERS
// ======================================================

async function ensureUser(userId, name = null) {
  // Имя обновляем, если пришло новое: человек мог сменить его в MAX
  await pool.query(
    `INSERT INTO users (user_id, name) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET name = COALESCE(EXCLUDED.name, users.name)`,
    [userId, name]
  );
}

// ======================================================
// STARTUPS
// ======================================================

// Поля Idea Check, которые можно редактировать по отдельности
const IDEA_FIELDS = [
  "customer", "problem", "solution", "competitors",
  "traction", "business_model", "economics", "partner_needed",
];

async function saveStartupDraft(founderId, data) {
  const { rows } = await pool.query(
    `INSERT INTO startups (
       founder_id, name, category, market_type, stage, seeking, investment_amount,
       customer, problem, solution, competitors, traction, business_model, economics, partner_needed,
       status
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'draft')
     RETURNING *`,
    [
      founderId, data.name, data.category, data.market_type, data.stage, data.seeking,
      data.investment_amount || null,
      data.customer || null, data.problem || null, data.solution || null, data.competitors || null,
      data.traction || null, data.business_model || null, data.economics || null, data.partner_needed || null,
    ]
  );

  return rows[0];
}

// Обновляет один или несколько блоков Idea Check у своего проекта
async function updateIdeaFields(startupId, founderId, fields) {
  const keys = Object.keys(fields).filter((key) => IDEA_FIELDS.includes(key));
  if (keys.length === 0) return getStartupById(startupId);

  const sets = keys.map((key, index) => `${key} = $${index + 3}`).join(", ");
  await pool.query(
    `UPDATE startups SET ${sets} WHERE id = $1 AND founder_id = $2`,
    [startupId, founderId, ...keys.map((key) => fields[key] || null)]
  );

  return getStartupById(startupId);
}

async function saveIdeaMap(startupId, ideaMap, readiness) {
  const { rows } = await pool.query(
    `UPDATE startups SET idea_map = $2, readiness = $3 WHERE id = $1 RETURNING *`,
    [startupId, JSON.stringify(ideaMap), readiness]
  );
  return rows[0] || null;
}

async function getStartupById(startupId) {
  const { rows } = await pool.query(
    `SELECT * FROM startups WHERE id = $1`,
    [startupId]
  );

  return rows[0] || null;
}

async function getPublishedStartupById(startupId) {
  const { rows } = await pool.query(
    `SELECT * FROM startups WHERE id = $1 AND status = 'published'`,
    [startupId]
  );

  return rows[0] || null;
}

// Заменяет UPDATE в publish_startup + последующий SELECT
async function publishStartup(startupId, founderId) {
  await pool.query(
    `UPDATE startups SET status = 'published'
     WHERE id = $1 AND founder_id = $2`,
    [startupId, founderId]
  );

  return getStartupById(startupId);
}

// Заменяет DELETE в cancel_creation (удаление незавершённого черновика)
async function deleteDraft(startupId, founderId) {
  await pool.query(
    `DELETE FROM startups
     WHERE id = $1 AND founder_id = $2 AND status = 'draft'`,
    [startupId, founderId]
  );
}

async function getFounderStartups(founderId) {
  const { rows } = await pool.query(
    `SELECT * FROM startups WHERE founder_id = $1 ORDER BY id DESC`,
    [founderId]
  );

  return rows;
}

// ======================================================
// MATCHING
// ======================================================

const stageRanks = {
  Идея: 1,
  Прототип: 2,
  MVP: 3,
  "Первые продажи": 4,
  Масштабирование: 5,
};

const wantedSeeking = {
  team: "Команда / co-founder",
  partner: "Партнёрство",
};

// Логика: в выдачу попадают только стартапы, совпавшие по всем критериям.
async function findMatches(criteria) {
  const { rows: startups } = await pool.query(
    `SELECT * FROM startups WHERE status = 'published' ORDER BY id DESC`
  );

  const minimumStage = stageRanks[criteria.min_stage] || 1;
  const results = [];

  for (const startup of startups) {
    let matched = 0;
    let total = 3;

    if (startup.seeking === wantedSeeking[criteria.goal]) {
      matched++;
    }

    if (
      criteria.category === "Любая" ||
      startup.category === criteria.category
    ) {
      matched++;
    }

    const startupRank = stageRanks[startup.stage] || 0;

    if (startupRank >= minimumStage) {
      matched++;
    }

    if (matched === total) {
      results.push({ startup, matched, total });
    }
  }

  return results;
}

// ======================================================
// SEARCH PROFILES
// ======================================================

async function saveSearchProfile(userId, criteria) {
  // about, visible и контакты приходят только из мини-приложения. Бот их не передаёт,
  // поэтому при их отсутствии сохраняем прежние значения (COALESCE).
  await pool.query(
    `INSERT INTO search_profiles (user_id, goal, category, min_stage, max_investment, about, visible, full_name, email, phone)
     VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, FALSE), $8, $9, $10)
     ON CONFLICT (user_id) DO UPDATE SET
       goal = EXCLUDED.goal,
       category = EXCLUDED.category,
       min_stage = EXCLUDED.min_stage,
       max_investment = EXCLUDED.max_investment,
       about = COALESCE($6, search_profiles.about),
       visible = COALESCE($7, search_profiles.visible),
       full_name = COALESCE($8, search_profiles.full_name),
       email = COALESCE($9, search_profiles.email),
       phone = COALESCE($10, search_profiles.phone)`,
    [
      userId,
      criteria.goal,
      criteria.category,
      criteria.min_stage,
      criteria.max_investment || null,
      criteria.about || null,
      typeof criteria.visible === "boolean" ? criteria.visible : null,
      criteria.full_name || null,
      criteria.email || null,
      criteria.phone || null,
    ]
  );
}

async function getSearchProfile(userId) {
  const { rows } = await pool.query(
    `SELECT * FROM search_profiles WHERE user_id = $1`,
    [userId]
  );

  return rows[0] || null;
}

// ======================================================
// OFFERS
// ======================================================

async function createOffer(startupId, senderId, senderName, type, message) {
  const { rows } = await pool.query(
    `INSERT INTO offers (startup_id, sender_id, sender_name, type, message, status)
     VALUES ($1, $2, $3, $4, $5, 'new')
     RETURNING *`,
    [startupId, senderId, senderName || null, type, message]
  );

  return rows[0];
}

async function getOfferWithStartup(offerId) {
  const { rows } = await pool.query(
    `SELECT offers.*, startups.name AS startup_name, startups.founder_id
     FROM offers
     JOIN startups ON startups.id = offers.startup_id
     WHERE offers.id = $1`,
    [offerId]
  );

  return rows[0] || null;
}

async function updateOfferStatus(offerId, status) {
  await pool.query(
    `UPDATE offers SET status = $1 WHERE id = $2`,
    [status, offerId]
  );
}

async function getReceivedOffers(founderId) {
  const { rows } = await pool.query(
    `SELECT offers.*, startups.name AS startup_name
     FROM offers
     JOIN startups ON startups.id = offers.startup_id
     WHERE startups.founder_id = $1
     ORDER BY offers.id DESC`,
    [founderId]
  );

  return rows;
}

// "Список кандидатов" у предпринимателя — принятые предложения
// по его стартапам (после MATCH можно продолжать общение в MAX).
async function getContactsForFounder(founderId) {
  const { rows } = await pool.query(
    `SELECT
       offers.id AS offer_id,
       offers.sender_id AS candidate_id,
       offers.sender_name AS candidate_name,
       offers.type,
       offers.message,
       offers.created_at,
       startups.id AS startup_id,
       startups.name AS startup_name
     FROM offers
     JOIN startups ON startups.id = offers.startup_id
     WHERE startups.founder_id = $1
       AND offers.status = 'accepted'
     ORDER BY offers.id DESC`,
    [founderId]
  );

  return rows;
}

// "Список стартапов от предпринимателей" у кандидата — стартапы,
// на которые я откликался и founder принял моё предложение.
async function getContactsForCandidate(senderId) {
  const { rows } = await pool.query(
    `SELECT
       offers.id AS offer_id,
       offers.type,
       offers.message,
       offers.created_at,
       startups.id AS startup_id,
       startups.name AS startup_name,
       startups.founder_id
     FROM offers
     JOIN startups ON startups.id = offers.startup_id
     WHERE offers.sender_id = $1
       AND offers.status = 'accepted'
     ORDER BY offers.id DESC`,
    [senderId]
  );

  return rows;
}

// ======================================================
// КАНДИДАТЫ ДЛЯ ОСНОВАТЕЛЯ
// ======================================================
// Кандидат — пользователь, который заполнил «О себе» и разрешил
// основателям находить его профиль (visible = TRUE).

const SEEKING_TO_GOAL = {
  "Команда / co-founder": "team",
  "Партнёрство": "partner",
};

async function getCandidatesForStartup(startup, limit = 20) {
  const goal = SEEKING_TO_GOAL[startup.seeking];

  const { rows } = await pool.query(
    `SELECT sp.user_id, sp.goal, sp.category, sp.about, sp.max_investment, u.name
     FROM search_profiles sp
     LEFT JOIN users u ON u.user_id = sp.user_id
     WHERE sp.visible = TRUE
       AND sp.about IS NOT NULL AND sp.about <> ''
       AND sp.user_id <> $1
       AND ($2::text IS NULL OR sp.goal = $2)
       AND (sp.category IS NULL OR sp.category = 'Любая' OR sp.category = $3)
     ORDER BY sp.created_at DESC
     LIMIT $4`,
    [startup.founder_id, goal || null, startup.category, limit]
  );

  return rows;
}

async function isVisibleCandidate(userId) {
  const { rows } = await pool.query(
    `SELECT 1 FROM search_profiles WHERE user_id = $1 AND visible = TRUE AND about IS NOT NULL`,
    [userId]
  );
  return rows.length > 0;
}

// ======================================================
// ПРИГЛАШЕНИЯ
// ======================================================

// Возвращает созданное приглашение или null, если оно уже было
async function createInvite(startupId, userId) {
  const { rows } = await pool.query(
    `INSERT INTO invites (startup_id, user_id) VALUES ($1, $2)
     ON CONFLICT (startup_id, user_id) DO NOTHING
     RETURNING *`,
    [startupId, userId]
  );
  return rows[0] || null;
}

async function getInvitedUserIds(startupId) {
  const { rows } = await pool.query(
    `SELECT user_id FROM invites WHERE startup_id = $1`,
    [startupId]
  );
  return rows.map((row) => Number(row.user_id));
}

// Приглашения, которые получил пользователь, по опубликованным проектам
async function getInvitesForUser(userId) {
  const { rows } = await pool.query(
    `SELECT i.id AS invite_id, i.created_at AS invited_at, s.*
     FROM invites i
     JOIN startups s ON s.id = i.startup_id
     WHERE i.user_id = $1 AND s.status = 'published'
     ORDER BY i.id DESC`,
    [userId]
  );
  return rows;
}

module.exports = {
  pool,
  init,
  ensureUser,
  saveStartupDraft,
  getStartupById,
  getPublishedStartupById,
  publishStartup,
  deleteDraft,
  getFounderStartups,
  findMatches,
  saveSearchProfile,
  getSearchProfile,
  createOffer,
  getOfferWithStartup,
  updateOfferStatus,
  getReceivedOffers,
  getContactsForFounder,
  getContactsForCandidate,
  updateIdeaFields,
  saveIdeaMap,
  getCandidatesForStartup,
  isVisibleCandidate,
  createInvite,
  getInvitedUserIds,
  getInvitesForUser,
  IDEA_FIELDS,
};
