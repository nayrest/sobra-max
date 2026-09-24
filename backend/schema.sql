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
