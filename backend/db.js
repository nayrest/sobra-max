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

async function ensureUser(userId) {
  await pool.query(
    `INSERT INTO users (user_id) VALUES ($1)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId]
  );
}

// ======================================================
// STARTUPS
// ======================================================

// Заменяет прямой INSERT в saveStartupPreview() + последующий SELECT
async function saveStartupDraft(founderId, data) {
  const { rows } = await pool.query(
    `INSERT INTO startups (
       founder_id, name, category, market_type, stage,
       problem, solution, traction, seeking, investment_amount, status
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'draft')
     RETURNING *`,
    [
      founderId,
      data.name,
      data.category,
      data.market_type,
      data.stage,
      data.problem,
      data.solution,
      data.traction,
      data.seeking,
      data.investment_amount || null,
    ]
  );

  return rows[0];
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
  investment: "Инвестиции",
  pilot: "Пилот / клиент",
  team: "Команда / co-founder",
  partner: "Партнёрство",
};

// Логика оставлена идентичной текущей (index.js, findMatches):
// в выдачу попадают только стартапы, совпавшие по всем критериям.
// Если захочешь показывать и частичные совпадения — убери
// фильтр `if (matched === total)` ниже и добавь сортировку по matched.
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

    if (criteria.goal === "investment") {
      total++;

      if (
        startup.investment_amount &&
        criteria.max_investment &&
        Number(startup.investment_amount) <= Number(criteria.max_investment)
      ) {
        matched++;
      }
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
  // about приходит только из мини-приложения. Бот его не передаёт,
  // поэтому при поиске из бота сохраняем прежнее значение (COALESCE).
  await pool.query(
    `INSERT INTO search_profiles (user_id, goal, category, min_stage, max_investment, about)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id) DO UPDATE SET
       goal = EXCLUDED.goal,
       category = EXCLUDED.category,
       min_stage = EXCLUDED.min_stage,
       max_investment = EXCLUDED.max_investment,
       about = COALESCE(EXCLUDED.about, search_profiles.about)`,
    [
      userId,
      criteria.goal,
      criteria.category,
      criteria.min_stage,
      criteria.max_investment || null,
      criteria.about || null,
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
};
