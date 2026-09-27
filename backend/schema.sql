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

-- ======================================================
-- Action Plan и Update: задачи по непроработанным блокам карты
-- ======================================================
-- Для каждого блока, который ещё не подтверждён, есть одна открытая задача.
-- Основатель выполняет её и возвращается с результатом (Update):
-- результат дописывается в блок, карта пересчитывается, задача закрывается
-- с отметкой «было → стало». Если блок всё ещё не подтверждён,
-- появляется следующая задача по нему — так замыкается цикл.

CREATE TABLE IF NOT EXISTS action_tasks (
  id                SERIAL PRIMARY KEY,
  startup_id        INTEGER NOT NULL REFERENCES startups (id) ON DELETE CASCADE,
  block_id          TEXT NOT NULL,
  title             TEXT NOT NULL,
  method            JSONB,                         -- шаги методики: ["...", "..."]
  method_source     TEXT NOT NULL DEFAULT 'template', -- template | ai
  status            TEXT NOT NULL DEFAULT 'open',  -- open | done
  result            TEXT,                          -- что основатель узнал / сделал
  status_before     TEXT,                          -- статус блока до обновления
  status_after      TEXT,                          -- статус блока после пересчёта
  readiness_before  INTEGER,
  readiness_after   INTEGER,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  done_at           TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_action_tasks_startup ON action_tasks (startup_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_action_tasks_open ON action_tasks (startup_id, block_id) WHERE status = 'open';

-- ======================================================
-- Аватарка профиля
-- ======================================================
-- Картинка хранится в БД (после сжатия в браузере — около 20–40 КБ).
-- Отдаётся по случайному токену: /api/avatars/<token>. Токен меняется
-- при каждой загрузке, поэтому кэш браузера не показывает старое фото.

ALTER TABLE search_profiles ADD COLUMN IF NOT EXISTS avatar BYTEA;
ALTER TABLE search_profiles ADD COLUMN IF NOT EXISTS avatar_type TEXT;
ALTER TABLE search_profiles ADD COLUMN IF NOT EXISTS avatar_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_search_profiles_avatar_token ON search_profiles (avatar_token);

-- ======================================================
-- Журнал AI Match — для статистики
-- ======================================================
-- Каждая оценка ИИ «проект ↔ кандидат» (в подборе у основателя и в поиске у кандидата).
-- Повторный показ той же пары тоже пишется: уникальные пары считаются через DISTINCT.

CREATE TABLE IF NOT EXISTS ai_match_log (
  id            SERIAL PRIMARY KEY,
  kind          TEXT NOT NULL,              -- candidates (подбор у основателя) | search (поиск у кандидата)
  startup_id    INTEGER NOT NULL,
  founder_id    BIGINT NOT NULL,
  candidate_id  BIGINT NOT NULL,
  score         INTEGER NOT NULL,
  verdict       TEXT NOT NULL,              -- strong | partial | weak
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_match_log_pair ON ai_match_log (startup_id, candidate_id);

-- ======================================================
-- Связь в MAX после MATCH
-- ======================================================
-- username — ник из подписанных данных MAX (есть, если пользователь его задал).
-- max_link — ссылка на профиль, которую пользователь указал сам (если ника нет).
-- Показываются только после MATCH и только при согласии на показ контактов.

ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT;
ALTER TABLE search_profiles ADD COLUMN IF NOT EXISTS max_link TEXT;

-- ======================================================
-- Безопасность: подтверждённый телефон, жалобы, лимиты
-- ======================================================

-- Телефон, подтверждённый через MAX (WebApp.requestContact, подпись проверяется на сервере).
-- Если пользователь потом вписал другой номер, отметка снимается.
ALTER TABLE search_profiles ADD COLUMN IF NOT EXISTS verified_phone TEXT;
ALTER TABLE search_profiles ADD COLUMN IF NOT EXISTS phone_verified_at TIMESTAMPTZ;

-- Когда основатель принял или отклонил отклик — для суточного лимита решений
ALTER TABLE offers ADD COLUMN IF NOT EXISTS decided_at TIMESTAMPTZ;

-- Жалобы. Проект или человек, на которого пожаловались 3 разных пользователя,
-- скрывается из поиска и подбора до ручной проверки.
CREATE TABLE IF NOT EXISTS reports (
  id           SERIAL PRIMARY KEY,
  reporter_id  BIGINT NOT NULL,
  target_type  TEXT NOT NULL,          -- startup | user
  target_id    BIGINT NOT NULL,
  reason       TEXT NOT NULL,          -- money | fake | spam | rude | other
  comment      TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (reporter_id, target_type, target_id)
);

CREATE INDEX IF NOT EXISTS idx_reports_target ON reports (target_type, target_id);

-- ======================================================
-- Счётчики новых событий на вкладках «Отклики» и «Контакты»
-- ======================================================
-- Когда пользователь последний раз открывал вкладку. Всё, что пришло позже, — «новое».
ALTER TABLE users ADD COLUMN IF NOT EXISTS seen_responses_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS seen_contacts_at TIMESTAMPTZ;

-- ======================================================
-- Нажатия на контакты после MATCH (для статистики)
-- ======================================================
-- channel: max — «Написать в MAX», phone — звонок, email — письмо
CREATE TABLE IF NOT EXISTS contact_clicks (
  id          SERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL,
  offer_id    INTEGER NOT NULL,
  channel     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contact_clicks_offer ON contact_clicks (offer_id);

-- Сферы переименованы понятными словами (отзыв пилота 27.09.2026). Идемпотентно: трогает только старые значения.
UPDATE startups SET category = CASE category
  WHEN 'AI' THEN 'AI / ИИ'
  WHEN 'SaaS' THEN 'Технологии / IT / SaaS'
  WHEN 'FoodTech' THEN 'Ресторан / кафе / кофейня'
  WHEN 'FinTech' THEN 'Финансы'
  WHEN 'EdTech' THEN 'Образование'
  WHEN 'E-commerce' THEN 'Магазин / E-commerce'
END WHERE category IN ('AI', 'SaaS', 'FoodTech', 'FinTech', 'EdTech', 'E-commerce');
UPDATE search_profiles SET category = CASE category
  WHEN 'AI' THEN 'AI / ИИ'
  WHEN 'SaaS' THEN 'Технологии / IT / SaaS'
  WHEN 'FoodTech' THEN 'Ресторан / кафе / кофейня'
  WHEN 'FinTech' THEN 'Финансы'
  WHEN 'EdTech' THEN 'Образование'
  WHEN 'E-commerce' THEN 'Магазин / E-commerce'
END WHERE category IN ('AI', 'SaaS', 'FoodTech', 'FinTech', 'EdTech', 'E-commerce');
