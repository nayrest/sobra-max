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

// Тестовые пользователи для автоматической проверки (вход по X-Test-Token).
// Их проекты и профили не видны реальным пользователям, и наоборот.
const TEST_USERS = { founder: 910000000001, candidate: 910000000002 };
const TEST_ID_MIN = 910000000000;
const TEST_ID_MAX = 910000000999;
const isTestUser = (id) => Number(id) >= TEST_ID_MIN && Number(id) <= TEST_ID_MAX;

// Сколько разных людей должны пожаловаться, чтобы проект или человек скрылся из выдачи
const REPORT_HIDE_THRESHOLD = 3;
const NOT_HIDDEN_STARTUP = (alias) => `
  (SELECT COUNT(DISTINCT r.reporter_id) FROM reports r
    WHERE r.target_type = 'startup' AND r.target_id = ${alias}.id) < ${REPORT_HIDE_THRESHOLD}
  AND (SELECT COUNT(DISTINCT r.reporter_id) FROM reports r
    WHERE r.target_type = 'user' AND r.target_id = ${alias}.founder_id) < ${REPORT_HIDE_THRESHOLD}`;
const NOT_HIDDEN_USER = (column) => `
  (SELECT COUNT(DISTINCT r.reporter_id) FROM reports r
    WHERE r.target_type = 'user' AND r.target_id = ${column}) < ${REPORT_HIDE_THRESHOLD}`;

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

async function ensureUser(userId, name = null, username = null) {
  // Имя и ник обновляем, если пришли новые: человек мог сменить их в MAX
  await pool.query(
    `INSERT INTO users (user_id, name, username) VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE SET
       name = COALESCE(EXCLUDED.name, users.name),
       username = COALESCE(EXCLUDED.username, users.username)`,
    [userId, name, username]
  );
}

// Ссылка на профиль в MAX, указанная вручную (null — очистить)
async function saveMaxLink(userId, link) {
  await pool.query(
    `UPDATE search_profiles SET max_link = $2 WHERE user_id = $1`,
    [userId, link]
  );
}

async function getUsername(userId) {
  const { rows } = await pool.query(`SELECT username FROM users WHERE user_id = $1`, [userId]);
  return rows[0]?.username || null;
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
    `SELECT s.*, (sp.phone_verified_at IS NOT NULL) AS founder_verified
     FROM startups s
     LEFT JOIN search_profiles sp ON sp.user_id = s.founder_id
     WHERE s.id = $1 AND s.status = 'published' AND ${NOT_HIDDEN_STARTUP("s")}`,
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
    `SELECT startups.*,
       (SELECT COUNT(*)::int FROM action_tasks t WHERE t.startup_id = startups.id AND t.status = 'open') AS tasks_open,
       (SELECT COUNT(*)::int FROM action_tasks t WHERE t.startup_id = startups.id AND t.status = 'done') AS tasks_done
     FROM startups WHERE founder_id = $1 ORDER BY id DESC`,
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
async function findMatches(criteria, viewerId = null) {
  const { rows: startups } = await pool.query(
    `SELECT s.*, (sp.phone_verified_at IS NOT NULL) AS founder_verified
     FROM startups s
     LEFT JOIN search_profiles sp ON sp.user_id = s.founder_id
     WHERE s.status = 'published' AND ${NOT_HIDDEN_STARTUP("s")}
     ORDER BY s.id DESC`
  );

  const minimumStage = stageRanks[criteria.min_stage] || 1;
  const results = [];

  for (const startup of startups) {
    // Тестовые проекты видит только тестовый кандидат
    if (isTestUser(startup.founder_id) !== isTestUser(viewerId)) continue;

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
  const fullName =
    [criteria.last_name, criteria.first_name, criteria.patronymic]
      .filter(Boolean)
      .join(" ")
      .trim() ||
    criteria.full_name ||
    null;

  await pool.query(
    `INSERT INTO search_profiles (
       user_id, goal, category, min_stage, max_investment, about, visible,
       full_name, last_name, first_name, patronymic, email, phone
     )
     VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, FALSE), $8, $9, $10, $11, $12, $13)
     ON CONFLICT (user_id) DO UPDATE SET
       goal = EXCLUDED.goal,
       category = EXCLUDED.category,
       min_stage = EXCLUDED.min_stage,
       max_investment = EXCLUDED.max_investment,
       about = COALESCE($6, search_profiles.about),
       visible = COALESCE($7, search_profiles.visible),
       full_name = COALESCE($8, search_profiles.full_name),
       last_name = COALESCE($9, search_profiles.last_name),
       first_name = COALESCE($10, search_profiles.first_name),
       patronymic = COALESCE($11, search_profiles.patronymic),
       email = COALESCE($12, search_profiles.email),
       phone = COALESCE($13, search_profiles.phone)`,
    [
      userId,
      criteria.goal,
      criteria.category,
      criteria.min_stage,
      criteria.max_investment || null,
      criteria.about || null,
      typeof criteria.visible === "boolean" ? criteria.visible : null,
      fullName,
      criteria.last_name || null,
      criteria.first_name || null,
      criteria.patronymic || null,
      criteria.email || null,
      criteria.phone || null,
    ]
  );
}

// Фиксируем момент согласия один раз; повторное сохранение профиля его не сдвигает
async function saveContactsConsent(userId) {
  await pool.query(
    `UPDATE search_profiles
     SET contacts_consent_at = COALESCE(contacts_consent_at, NOW())
     WHERE user_id = $1`,
    [userId]
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
    `UPDATE offers SET status = $1, decided_at = NOW() WHERE id = $2`,
    [status, offerId]
  );
}

async function getReceivedOffers(founderId) {
  const { rows } = await pool.query(
    `SELECT offers.*, startups.name AS startup_name, sp.avatar_token AS sender_avatar,
       (sp.phone_verified_at IS NOT NULL) AS sender_verified
     FROM offers
     JOIN startups ON startups.id = offers.startup_id
     LEFT JOIN search_profiles sp ON sp.user_id = offers.sender_id
     WHERE startups.founder_id = $1
     ORDER BY offers.id DESC`,
    [founderId]
  );

  return rows;
}

// "Список кандидатов" у предпринимателя — принятые предложения
// по его стартапам (после MATCH можно продолжать общение в MAX).
// Контакты (ФИО, телефон, e-mail) отдаются только по принятому отклику
// и только если человек дал согласие на их показ.
async function getContactsForFounder(founderId) {
  const { rows } = await pool.query(
    `SELECT
       offers.id AS offer_id,
       offers.sender_id AS candidate_id,
       COALESCE(sp.full_name, offers.sender_name) AS candidate_name,
       CASE WHEN sp.contacts_consent_at IS NOT NULL THEN sp.phone END AS candidate_phone,
       CASE WHEN sp.contacts_consent_at IS NOT NULL THEN sp.email END AS candidate_email,
       sp.avatar_token AS candidate_avatar,
       (sp.phone_verified_at IS NOT NULL) AS candidate_phone_verified,
       CASE WHEN sp.contacts_consent_at IS NOT NULL THEN
         COALESCE(sp.max_link, CASE WHEN cu.username IS NOT NULL THEN 'https://max.ru/' || cu.username END)
       END AS candidate_max_link,
       offers.type,
       offers.message,
       offers.created_at,
       startups.id AS startup_id,
       startups.name AS startup_name
     FROM offers
     JOIN startups ON startups.id = offers.startup_id
     LEFT JOIN search_profiles sp ON sp.user_id = offers.sender_id
     LEFT JOIN users cu ON cu.user_id = offers.sender_id
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
       startups.founder_id,
       COALESCE(sp.full_name, u.name) AS founder_name,
       CASE WHEN sp.contacts_consent_at IS NOT NULL THEN sp.phone END AS founder_phone,
       CASE WHEN sp.contacts_consent_at IS NOT NULL THEN sp.email END AS founder_email,
       sp.avatar_token AS founder_avatar,
       (sp.phone_verified_at IS NOT NULL) AS founder_phone_verified,
       CASE WHEN sp.contacts_consent_at IS NOT NULL THEN
         COALESCE(sp.max_link, CASE WHEN u.username IS NOT NULL THEN 'https://max.ru/' || u.username END)
       END AS founder_max_link
     FROM offers
     JOIN startups ON startups.id = offers.startup_id
     LEFT JOIN search_profiles sp ON sp.user_id = startups.founder_id
     LEFT JOIN users u ON u.user_id = startups.founder_id
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
    `SELECT sp.user_id, sp.goal, sp.category, sp.about, sp.max_investment, sp.avatar_token, u.name,
       (sp.phone_verified_at IS NOT NULL) AS phone_verified
     FROM search_profiles sp
     LEFT JOIN users u ON u.user_id = sp.user_id
     WHERE sp.visible = TRUE
       AND sp.about IS NOT NULL AND sp.about <> ''
       AND sp.user_id <> $1
       AND ($2::text IS NULL OR sp.goal = $2)
       AND (sp.category IS NULL OR sp.category = 'Любая' OR sp.category = $3)
       AND ((sp.user_id BETWEEN $5 AND $6) = $7)
       AND ${NOT_HIDDEN_USER("sp.user_id")}
     ORDER BY sp.created_at DESC
     LIMIT $4`,
    [startup.founder_id, goal || null, startup.category, limit, TEST_ID_MIN, TEST_ID_MAX, isTestUser(startup.founder_id)]
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
    `SELECT i.id AS invite_id, i.created_at AS invited_at, s.*,
       (sp.phone_verified_at IS NOT NULL) AS founder_verified
     FROM invites i
     JOIN startups s ON s.id = i.startup_id
     LEFT JOIN search_profiles sp ON sp.user_id = s.founder_id
     WHERE i.user_id = $1 AND s.status = 'published' AND ${NOT_HIDDEN_STARTUP("s")}
     ORDER BY i.id DESC`,
    [userId]
  );
  return rows;
}

// ======================================================
// ACTION PLAN И UPDATE
// ======================================================

const { BLOCKS } = require("./idea-check");
const actionPlan = require("./action-plan");

const BLOCK_ORDER = Object.fromEntries(BLOCKS.map((b, i) => [b.id, i]));

/**
 * Приводит задачи в соответствие с картой проекта:
 * по каждому неподтверждённому блоку — одна открытая задача,
 * открытые задачи по подтверждённым блокам закрываются сами.
 */
async function syncTasks(startupId, ideaMap) {
  const { toOpen, toClose } = actionPlan.planFromMap(ideaMap);

  if (toClose.length) {
    await pool.query(
      `UPDATE action_tasks
       SET status = 'done', status_after = 'confirmed', done_at = NOW()
       WHERE startup_id = $1 AND status = 'open' AND block_id = ANY(string_to_array($2, ','))`,
      [startupId, toClose.join(",")]
    );
  }

  for (const blockId of toOpen) {
    const template = actionPlan.templateFor(blockId);
    await pool.query(
      `INSERT INTO action_tasks (startup_id, block_id, title, method, method_source)
       VALUES ($1, $2, $3, $4, 'template')
       ON CONFLICT (startup_id, block_id) WHERE status = 'open' DO NOTHING`,
      [startupId, blockId, template.title, JSON.stringify(template.method)]
    );
  }
}

// Открытые задачи — в порядке блоков карты, выполненные — от новых к старым
async function getTasks(startupId) {
  const { rows } = await pool.query(
    `SELECT * FROM action_tasks WHERE startup_id = $1 ORDER BY id`,
    [startupId]
  );
  const open = rows
    .filter((t) => t.status === "open")
    .sort((a, b) => (BLOCK_ORDER[a.block_id] ?? 99) - (BLOCK_ORDER[b.block_id] ?? 99));
  const done = rows
    .filter((t) => t.status === "done")
    .sort((a, b) => new Date(b.done_at) - new Date(a.done_at) || b.id - a.id);
  return [...open, ...done];
}

async function getTask(startupId, taskId) {
  const { rows } = await pool.query(
    `SELECT * FROM action_tasks WHERE id = $1 AND startup_id = $2`,
    [taskId, startupId]
  );
  return rows[0] || null;
}

async function saveTaskMethod(taskId, steps, source) {
  const { rows } = await pool.query(
    `UPDATE action_tasks SET method = $2, method_source = $3 WHERE id = $1 RETURNING *`,
    [taskId, JSON.stringify(steps), source]
  );
  return rows[0] || null;
}

// Update, часть 1: закрываем задачу и запоминаем, каким блок был до обновления
async function completeTask(taskId, { result, statusBefore, readinessBefore }) {
  const { rows } = await pool.query(
    `UPDATE action_tasks
     SET status = 'done', result = $2, status_before = $3, readiness_before = $4, done_at = NOW()
     WHERE id = $1 AND status = 'open'
     RETURNING *`,
    [taskId, result, statusBefore, readinessBefore]
  );
  return rows[0] || null;
}

// Update, часть 2: каким блок стал после пересчёта карты
async function saveTaskOutcome(taskId, statusAfter, readinessAfter) {
  const { rows } = await pool.query(
    `UPDATE action_tasks SET status_after = $2, readiness_after = $3 WHERE id = $1 RETURNING *`,
    [taskId, statusAfter, readinessAfter]
  );
  return rows[0] || null;
}

// ======================================================
// АВАТАРКИ
// ======================================================

// data — картинка в base64. Строка профиля может ещё не существовать
// (фото загружают при первом заполнении профиля), поэтому UPSERT.
async function saveAvatar(userId, mimeType, base64, token) {
  await pool.query(
    `INSERT INTO search_profiles (user_id, avatar, avatar_type, avatar_token)
     VALUES ($1, decode($2, 'base64'), $3, $4)
     ON CONFLICT (user_id) DO UPDATE SET
       avatar = EXCLUDED.avatar, avatar_type = EXCLUDED.avatar_type, avatar_token = EXCLUDED.avatar_token`,
    [userId, base64, mimeType, token]
  );
}

async function deleteAvatar(userId) {
  await pool.query(
    `UPDATE search_profiles SET avatar = NULL, avatar_type = NULL, avatar_token = NULL WHERE user_id = $1`,
    [userId]
  );
}

async function getAvatarByToken(token) {
  const { rows } = await pool.query(
    `SELECT avatar_type, encode(avatar, 'base64') AS data
     FROM search_profiles WHERE avatar_token = $1 AND avatar IS NOT NULL`,
    [token]
  );
  if (!rows[0]) return null;
  return { type: rows[0].avatar_type, data: Buffer.from(rows[0].data, "base64") };
}

// ======================================================
// ЖУРНАЛ AI MATCH (для статистики)
// ======================================================

// rows: [{ kind, startup_id, founder_id, candidate_id, score, verdict }]
async function logAiMatches(rows) {
  if (!rows.length) return;
  const values = [];
  const params = [];
  rows.forEach((r, i) => {
    const b = i * 6;
    values.push(`($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6})`);
    params.push(r.kind, r.startup_id, r.founder_id, r.candidate_id, r.score, r.verdict);
  });
  await pool.query(
    `INSERT INTO ai_match_log (kind, startup_id, founder_id, candidate_id, score, verdict)
     VALUES ${values.join(", ")}`,
    params
  );
}

// ======================================================
// БЕЗОПАСНОСТЬ: подтверждённый телефон, жалобы, лимиты
// ======================================================

// Телефон подтверждён через MAX. Строки профиля может ещё не быть (первый вход).
async function saveVerifiedPhone(userId, phone) {
  await pool.query(
    `INSERT INTO search_profiles (user_id, phone, verified_phone, phone_verified_at)
     VALUES ($1, $2, $2, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       phone = EXCLUDED.phone, verified_phone = EXCLUDED.verified_phone, phone_verified_at = NOW()`,
    [userId, phone]
  );
}

// После сохранения профиля: отметка остаётся, только если номер совпадает с подтверждённым
async function syncPhoneVerification(userId) {
  await pool.query(
    `UPDATE search_profiles SET phone_verified_at =
       CASE WHEN verified_phone IS NOT NULL AND phone = verified_phone
            THEN COALESCE(phone_verified_at, NOW()) ELSE NULL END
     WHERE user_id = $1`,
    [userId]
  );
}

async function userExists(userId) {
  const { rows } = await pool.query(`SELECT 1 FROM users WHERE user_id = $1`, [userId]);
  return rows.length > 0;
}

// Возвращает { report, reporters } или null, если этот человек уже жаловался на эту цель
async function createReport(reporterId, targetType, targetId, reason, comment) {
  const { rows } = await pool.query(
    `INSERT INTO reports (reporter_id, target_type, target_id, reason, comment)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (reporter_id, target_type, target_id) DO NOTHING
     RETURNING *`,
    [reporterId, targetType, targetId, reason, comment]
  );
  if (!rows[0]) return null;
  const { rows: counted } = await pool.query(
    `SELECT COUNT(DISTINCT reporter_id)::int AS n FROM reports WHERE target_type = $1 AND target_id = $2`,
    [targetType, targetId]
  );
  return { report: rows[0], reporters: counted[0]?.n || 1, hidden: (counted[0]?.n || 1) >= REPORT_HIDE_THRESHOLD };
}

// Сколько действий пользователь сделал за последние сутки
const RECENT_SQL = {
  startups: `SELECT COUNT(*)::int AS n FROM startups WHERE founder_id = $1 AND created_at > NOW() - INTERVAL '1 day'`,
  offers: `SELECT COUNT(*)::int AS n FROM offers WHERE sender_id = $1 AND created_at > NOW() - INTERVAL '1 day'`,
  invites: `SELECT COUNT(*)::int AS n FROM invites i JOIN startups s ON s.id = i.startup_id
            WHERE s.founder_id = $1 AND i.created_at > NOW() - INTERVAL '1 day'`,
  decisions: `SELECT COUNT(*)::int AS n FROM offers o JOIN startups s ON s.id = o.startup_id
              WHERE s.founder_id = $1 AND o.decided_at > NOW() - INTERVAL '1 day'`,
  reports: `SELECT COUNT(*)::int AS n FROM reports WHERE reporter_id = $1 AND created_at > NOW() - INTERVAL '1 day'`,
};

async function countRecent(kind, userId) {
  const { rows } = await pool.query(RECENT_SQL[kind], [userId]);
  return rows[0]?.n || 0;
}

// ======================================================
// СЧЁТЧИКИ НОВЫХ СОБЫТИЙ (красные кружки на вкладках)
// ======================================================

// responses — новые отклики на мои проекты и новые приглашения мне;
// contacts — новые MATCH: основатель принял мой отклик.
// «Новое» — пришло после того, как пользователь последний раз открывал вкладку.
async function getCounters(userId) {
  const { rows } = await pool.query(
    `SELECT
       (SELECT COUNT(*)::int FROM offers o JOIN startups s ON s.id = o.startup_id
          WHERE s.founder_id = $1 AND o.status = 'new'
            AND o.created_at > COALESCE((SELECT seen_responses_at FROM users WHERE user_id = $1), 'epoch'::timestamptz))
       + (SELECT COUNT(*)::int FROM invites i JOIN startups s ON s.id = i.startup_id
          WHERE i.user_id = $1 AND s.status = 'published'
            AND i.created_at > COALESCE((SELECT seen_responses_at FROM users WHERE user_id = $1), 'epoch'::timestamptz)) AS responses,
       (SELECT COUNT(*)::int FROM offers o
          WHERE o.sender_id = $1 AND o.status = 'accepted'
            AND o.decided_at > COALESCE((SELECT seen_contacts_at FROM users WHERE user_id = $1), 'epoch'::timestamptz)) AS contacts`,
    [userId]
  );
  return { responses: rows[0]?.responses || 0, contacts: rows[0]?.contacts || 0 };
}

async function markSeen(userId, section) {
  const column = section === "contacts" ? "seen_contacts_at" : "seen_responses_at";
  await pool.query(`UPDATE users SET ${column} = NOW() WHERE user_id = $1`, [userId]);
}

module.exports = {
  pool,
  getCounters,
  markSeen,
  saveVerifiedPhone,
  syncPhoneVerification,
  userExists,
  createReport,
  countRecent,
  REPORT_HIDE_THRESHOLD,
  logAiMatches,
  saveMaxLink,
  getUsername,
  TEST_USERS,
  isTestUser,
  syncTasks,
  getTasks,
  getTask,
  saveTaskMethod,
  completeTask,
  saveTaskOutcome,
  saveAvatar,
  deleteAvatar,
  getAvatarByToken,
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
  saveContactsConsent,
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
