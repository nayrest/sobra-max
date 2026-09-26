-- Статистика SOBRA по реальным пользователям.
-- Демо-пользователи (id 900000000001–900000000199) и тестовые (910000000001–910000000002) не учитываются.

WITH real_users   AS (SELECT * FROM users WHERE user_id NOT BETWEEN 900000000000 AND 910000000999),
     real_profiles AS (SELECT * FROM search_profiles WHERE user_id NOT BETWEEN 900000000000 AND 910000000999),
     real_startups AS (SELECT * FROM startups WHERE founder_id NOT BETWEEN 900000000000 AND 910000000999),
     real_offers   AS (SELECT o.* FROM offers o JOIN startups s ON s.id = o.startup_id
                       WHERE s.founder_id NOT BETWEEN 900000000000 AND 910000000999
                         AND o.sender_id NOT BETWEEN 900000000000 AND 910000000999),
     real_ai       AS (SELECT * FROM ai_match_log
                       WHERE founder_id NOT BETWEEN 900000000000 AND 910000000999
                         AND candidate_id NOT BETWEEN 900000000000 AND 910000000999),
     ai_pairs      AS (SELECT startup_id, candidate_id, MAX(score) AS score FROM real_ai GROUP BY startup_id, candidate_id),
     real_clicks   AS (SELECT c.* FROM contact_clicks c JOIN real_offers o ON o.id = c.offer_id
                       WHERE c.user_id NOT BETWEEN 900000000000 AND 910000000999)
SELECT 'Пользователей (открыли бота или мини-приложение)' AS "Показатель", COUNT(*)::text AS "Значение" FROM real_users
UNION ALL SELECT '  из них за последние 7 дней', COUNT(*)::text FROM real_users WHERE created_at > NOW() - INTERVAL '7 days'
UNION ALL SELECT 'Заполнили профиль полностью (с согласием)', COUNT(*)::text FROM real_profiles
          WHERE contacts_consent_at IS NOT NULL AND about IS NOT NULL AND about <> ''
UNION ALL SELECT '  открыли профиль основателям', COUNT(*)::text FROM real_profiles WHERE visible AND contacts_consent_at IS NOT NULL
UNION ALL SELECT '  загрузили фото', COUNT(*)::text FROM real_profiles WHERE avatar IS NOT NULL
UNION ALL SELECT '  подтвердили телефон через MAX', COUNT(*)::text FROM real_profiles WHERE phone_verified_at IS NOT NULL
UNION ALL SELECT '  цель «команда» / «партнёрство»',
          (COUNT(*) FILTER (WHERE goal = 'team'))::text || ' / ' || (COUNT(*) FILTER (WHERE goal = 'partner'))::text FROM real_profiles
UNION ALL SELECT 'Проектов создано (прошли Idea Check)', COUNT(*)::text FROM real_startups
UNION ALL SELECT '  опубликовано', COUNT(*)::text FROM real_startups WHERE status = 'published'
UNION ALL SELECT '  основателей (разных людей)', COUNT(DISTINCT founder_id)::text FROM real_startups
UNION ALL SELECT '  средняя готовность, %', COALESCE(ROUND(AVG(readiness))::text, '—') FROM real_startups
UNION ALL SELECT 'Update: внесено результатов проверок', COUNT(*)::text FROM action_tasks t JOIN real_startups s ON s.id = t.startup_id
          WHERE t.status = 'done' AND t.result IS NOT NULL
UNION ALL SELECT '  из них блок стал «Подтверждено»', COUNT(*)::text FROM action_tasks t JOIN real_startups s ON s.id = t.startup_id
          WHERE t.result IS NOT NULL AND t.status_after = 'confirmed' AND t.status_before <> 'confirmed'
UNION ALL SELECT 'AI Match: пар «проект — кандидат», оценённых ИИ', COUNT(*)::text FROM ai_pairs
UNION ALL SELECT '  в подборе у основателей / в поиске у кандидатов',
          (SELECT COUNT(DISTINCT (startup_id, candidate_id)) FROM real_ai WHERE kind = 'candidates')::text || ' / ' ||
          (SELECT COUNT(DISTINCT (startup_id, candidate_id)) FROM real_ai WHERE kind = 'search')::text
UNION ALL SELECT '  из них сильное соответствие (80%+)', COUNT(*)::text FROM ai_pairs WHERE score >= 80
UNION ALL SELECT '  средний процент соответствия', COALESCE(ROUND(AVG(score))::text, '—') FROM ai_pairs
UNION ALL SELECT '  всего показов оценок (с повторами)', COUNT(*)::text FROM real_ai
UNION ALL SELECT 'Приглашений от основателей', COUNT(*)::text FROM invites i JOIN real_startups s ON s.id = i.startup_id
          WHERE i.user_id NOT BETWEEN 900000000000 AND 910000000999
UNION ALL SELECT 'Откликов кандидатов', COUNT(*)::text FROM real_offers
UNION ALL SELECT '  ждут решения / отклонено',
          (COUNT(*) FILTER (WHERE status = 'new'))::text || ' / ' || (COUNT(*) FILTER (WHERE status = 'rejected'))::text FROM real_offers
UNION ALL SELECT 'Состыковки — MATCH (отклик принят, обменялись контактами)', COUNT(*)::text FROM real_offers WHERE status = 'accepted'
UNION ALL SELECT '  из них после AI-оценки этой пары', COUNT(*)::text FROM real_offers o
          WHERE o.status = 'accepted' AND EXISTS (SELECT 1 FROM ai_pairs p WHERE p.startup_id = o.startup_id AND p.candidate_id = o.sender_id)
UNION ALL SELECT '  людей, у которых был MATCH',
          (SELECT COUNT(*) FROM (SELECT sender_id AS u FROM real_offers WHERE status = 'accepted'
                                 UNION SELECT s.founder_id FROM real_offers o JOIN startups s ON s.id = o.startup_id
                                       WHERE o.status = 'accepted') x)::text
UNION ALL SELECT 'Нажали «Написать в MAX» (людей)', COUNT(DISTINCT user_id)::text FROM real_clicks WHERE channel = 'max'
UNION ALL SELECT '  нажатий «Написать в MAX» всего', COUNT(*)::text FROM real_clicks WHERE channel = 'max'
UNION ALL SELECT '  MATCH, по которым написали в MAX', COUNT(DISTINCT offer_id)::text FROM real_clicks WHERE channel = 'max'
UNION ALL SELECT 'Нажатия на телефон / e-mail',
          (COUNT(*) FILTER (WHERE channel = 'phone'))::text || ' / ' || (COUNT(*) FILTER (WHERE channel = 'email'))::text FROM real_clicks
UNION ALL SELECT 'MATCH, по которым связались любым способом',
          (SELECT COUNT(DISTINCT offer_id) FROM real_clicks)::text || ' из ' ||
          (SELECT COUNT(*) FROM real_offers WHERE status = 'accepted')::text
UNION ALL SELECT 'Жалоб (всего)', COUNT(*)::text FROM reports WHERE reporter_id NOT BETWEEN 900000000000 AND 910000000999
UNION ALL SELECT '  проектов скрыто после жалоб', COUNT(*)::text FROM (
          SELECT target_id FROM reports WHERE target_type = 'startup'
          GROUP BY target_id HAVING COUNT(DISTINCT reporter_id) >= 3) h
UNION ALL SELECT '  пользователей скрыто после жалоб', COUNT(*)::text FROM (
          SELECT target_id FROM reports WHERE target_type = 'user'
          GROUP BY target_id HAVING COUNT(DISTINCT reporter_id) >= 3) h;
