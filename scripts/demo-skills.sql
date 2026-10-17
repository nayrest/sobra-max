-- Теги навыков для демо-данных (900000000001–199). Повторный запуск безопасен.
-- Только вымышленные демо-пользователи, настоящих людей скрипт не трогает.
--   docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < scripts/demo-skills.sql

UPDATE search_profiles SET skills = v.skills::jsonb
FROM (VALUES
  (900000000101, '["Операционка", "HoReCa", "Управление_персоналом", "Закупки"]'),
  (900000000102, '["Маркетинг", "SMM", "Бренд", "Локальное_продвижение"]'),
  (900000000103, '["Python", "Go", "Backend", "Highload", "Финтех"]'),
  (900000000104, '["Методология", "EdTech", "Микрообучение", "Аналитика"]'),
  (900000000105, '["B2B_продажи", "SaaS", "Партнёрские_каналы"]'),
  (900000000106, '["Финансы", "Бухгалтерия", "Малый_бизнес"]')
) AS v(user_id, skills)
WHERE search_profiles.user_id = v.user_id;

UPDATE startups SET skills = v.skills::jsonb
FROM (VALUES
  (900000000001, '["Операционка", "Управление_персоналом", "HoReCa"]'),
  (900000000002, '["Backend", "Python", "B2B_продажи"]'),
  (900000000003, '["Python", "ML", "Юриспруденция"]'),
  (900000000004, '["Методология", "EdTech", "Маркетинг"]'),
  (900000000005, '["B2B_продажи", "Финансы"]'),
  (900000000006, '["Логистика", "Маркетинг", "Операционка"]'),
  (900000000007, '["Backend", "Продажи"]')
) AS v(founder_id, skills)
WHERE startups.founder_id = v.founder_id;

SELECT 'профили' AS what, COUNT(*) FROM search_profiles WHERE user_id BETWEEN 900000000101 AND 900000000199 AND skills <> '[]'::jsonb
UNION ALL
SELECT 'проекты', COUNT(*) FROM startups WHERE founder_id BETWEEN 900000000001 AND 900000000099 AND skills <> '[]'::jsonb;
