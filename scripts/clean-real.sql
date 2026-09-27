-- Удаляет всех реальных пользователей и всё, что с ними связано.
-- Не трогает демо-данные (id 900000000001–900000000199) и тестовых пользователей жюри (910000000001–002).
BEGIN;

DELETE FROM contact_clicks WHERE user_id NOT BETWEEN 900000000000 AND 910000000999
   OR offer_id IN (SELECT o.id FROM offers o JOIN startups s ON s.id = o.startup_id
                   WHERE s.founder_id NOT BETWEEN 900000000000 AND 910000000999
                      OR o.sender_id NOT BETWEEN 900000000000 AND 910000000999);
DELETE FROM offers o USING startups s WHERE s.id = o.startup_id
   AND (s.founder_id NOT BETWEEN 900000000000 AND 910000000999
        OR o.sender_id NOT BETWEEN 900000000000 AND 910000000999);
DELETE FROM invites i USING startups s WHERE s.id = i.startup_id
   AND (s.founder_id NOT BETWEEN 900000000000 AND 910000000999
        OR i.user_id NOT BETWEEN 900000000000 AND 910000000999);
DELETE FROM ai_match_log WHERE founder_id NOT BETWEEN 900000000000 AND 910000000999
   OR candidate_id NOT BETWEEN 900000000000 AND 910000000999;
DELETE FROM reports WHERE reporter_id NOT BETWEEN 900000000000 AND 910000000999;
DELETE FROM startups WHERE founder_id NOT BETWEEN 900000000000 AND 910000000999;  -- задачи плана удалятся вместе с проектом
DELETE FROM search_profiles WHERE user_id NOT BETWEEN 900000000000 AND 910000000999;
DELETE FROM users WHERE user_id NOT BETWEEN 900000000000 AND 910000000999;

SELECT (SELECT COUNT(*) FROM users) AS users_left, (SELECT COUNT(*) FROM startups) AS startups_left,
       (SELECT COUNT(*) FROM offers) AS offers_left;
COMMIT;
