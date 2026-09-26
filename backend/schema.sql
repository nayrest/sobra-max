-- PostgreSQL schema for Startup Discovery (SOBRA) MAX bot
-- Эквивалент SQLite-схемы из index.js, адаптированный под Postgres

CREATE TABLE IF NOT EXISTS users (
  user_id    BIGINT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS startups (
  id                 SERIAL PRIMARY KEY,
  founder_id         BIGINT NOT NULL,
  name               TEXT,
  category           TEXT,
  market_type        TEXT,
  stage              TEXT,
  problem            TEXT,
  solution           TEXT,
  traction           TEXT,
  seeking            TEXT,
  investment_amount  BIGINT,
  video              TEXT,
  status             TEXT NOT NULL DEFAULT 'draft',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_startups_status ON startups (status);
CREATE INDEX IF NOT EXISTS idx_startups_founder ON startups (founder_id);

CREATE TABLE IF NOT EXISTS search_profiles (
  user_id         BIGINT PRIMARY KEY,
  goal            TEXT,
  category        TEXT,
  min_stage       TEXT,
  max_investment  BIGINT,
  about           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS offers (
  id           SERIAL PRIMARY KEY,
  startup_id   INTEGER NOT NULL REFERENCES startups (id),
  sender_id    BIGINT NOT NULL,
  sender_name  TEXT,
  type         TEXT,
  message      TEXT,
  status       TEXT NOT NULL DEFAULT 'new',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_offers_startup ON offers (startup_id);

-- Примечания по переносу типов из SQLite:
--   INTEGER PRIMARY KEY AUTOINCREMENT -> SERIAL PRIMARY KEY
--   user_id / founder_id / sender_id -> BIGINT (id пользователей MAX могут быть большими числами)
--   TEXT DEFAULT CURRENT_TIMESTAMP    -> TIMESTAMPTZ DEFAULT NOW()
--   investment_amount INTEGER         -> BIGINT (суммы в рублях могут превышать INT4)

-- Миграция для уже существующих баз (созданных до появления sender_name):
-- CREATE TABLE IF NOT EXISTS не меняет существующую таблицу, поэтому колонку добавляем явно.
ALTER TABLE offers ADD COLUMN IF NOT EXISTS sender_name TEXT;
ALTER TABLE search_profiles ADD COLUMN IF NOT EXISTS about TEXT;

-- ======================================================
-- Idea Check, карта проекта, профили кандидатов, приглашения
-- ======================================================

-- Имя из профиля MAX (приходит в подписанном initData)
ALTER TABLE users ADD COLUMN IF NOT EXISTS name TEXT;

-- Ответы Idea Check. problem, solution уже есть; traction используется как «проверка спроса».
ALTER TABLE startups ADD COLUMN IF NOT EXISTS customer TEXT;
ALTER TABLE startups ADD COLUMN IF NOT EXISTS competitors TEXT;
ALTER TABLE startups ADD COLUMN IF NOT EXISTS business_model TEXT;
ALTER TABLE startups ADD COLUMN IF NOT EXISTS economics TEXT;
ALTER TABLE startups ADD COLUMN IF NOT EXISTS partner_needed TEXT;

-- Карта проекта: статус каждого блока и готовность в процентах
ALTER TABLE startups ADD COLUMN IF NOT EXISTS idea_map JSONB;
ALTER TABLE startups ADD COLUMN IF NOT EXISTS readiness INTEGER;

-- Кандидат сам разрешает основателям находить его профиль
ALTER TABLE search_profiles ADD COLUMN IF NOT EXISTS visible BOOLEAN NOT NULL DEFAULT FALSE;

-- Контактные данные кандидата (заполняются в мини-приложении)
ALTER TABLE search_profiles ADD COLUMN IF NOT EXISTS full_name TEXT;
ALTER TABLE search_profiles ADD COLUMN IF NOT EXISTS last_name TEXT;
ALTER TABLE search_profiles ADD COLUMN IF NOT EXISTS first_name TEXT;
ALTER TABLE search_profiles ADD COLUMN IF NOT EXISTS patronymic TEXT;
ALTER TABLE search_profiles ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE search_profiles ADD COLUMN IF NOT EXISTS phone TEXT;

-- Когда пользователь согласился показывать ФИО, телефон и e-mail тому, с кем случится MATCH.
-- Без согласия контакты никому не отдаются.
ALTER TABLE search_profiles ADD COLUMN IF NOT EXISTS contacts_consent_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS invites (
  id          SERIAL PRIMARY KEY,
  startup_id  INTEGER NOT NULL REFERENCES startups (id) ON DELETE CASCADE,
  user_id     BIGINT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (startup_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_invites_user ON invites (user_id);
