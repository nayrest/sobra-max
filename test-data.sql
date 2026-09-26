-- test-data.sql
-- Тестовые учётные записи для автоматической проверки API (см. DATA-API.yaml).
-- Вход: заголовок X-Test-Token со значением API_TEST_TOKEN_FOUNDER или API_TEST_TOKEN_CANDIDATE из .env.
-- Тестовые проекты и профили изолированы: реальные пользователи их не видят.
--
-- Загрузка (повторный запуск безопасен):
--   docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < test-data.sql

INSERT INTO users (user_id, name) VALUES
  (910000000001, 'Тестовый основатель'),
  (910000000002, 'Тестовый кандидат')
ON CONFLICT (user_id) DO UPDATE SET name = EXCLUDED.name;

INSERT INTO search_profiles (
  user_id, goal, category, min_stage, about, visible,
  last_name, first_name, full_name, email, phone, contacts_consent_at
) VALUES
  (910000000001, 'partner', 'Любая', 'Идея',
   'Основатель тестового проекта: кофейня у дома. Ищу операционного партнёра.',
   FALSE, 'Тестов', 'Основатель', 'Тестов Основатель',
   'founder@test.sobra', '+79000000001', NOW()),
  (910000000002, 'team', 'Любая', 'Идея',
   '4 года управлял кофейней: персонал, поставщики, закупки, смены. Готов уделять 30 часов в неделю, ищу роль операционного партнёра.',
   TRUE, 'Тестов', 'Кандидат', 'Тестов Кандидат',
   'candidate@test.sobra', '+79000000002', NOW())
ON CONFLICT (user_id) DO UPDATE SET
  goal = EXCLUDED.goal, category = EXCLUDED.category, about = EXCLUDED.about,
  visible = EXCLUDED.visible, last_name = EXCLUDED.last_name, first_name = EXCLUDED.first_name,
  full_name = EXCLUDED.full_name, email = EXCLUDED.email, phone = EXCLUDED.phone,
  contacts_consent_at = COALESCE(search_profiles.contacts_consent_at, NOW());

-- Очистка накопившихся тестовых проектов (по желанию, перед повторной проверкой):
-- DELETE FROM offers WHERE startup_id IN (SELECT id FROM startups WHERE founder_id BETWEEN 910000000000 AND 910000000999);
-- DELETE FROM startups WHERE founder_id BETWEEN 910000000000 AND 910000000999;
