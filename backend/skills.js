// skills.js
// Теги навыков (отзыв тестировщика: «нужны теги — #B2B_sales, #Python, #маркетинг»).
// У кандидата — что он умеет, у проекта — какие навыки нужны партнёру.
// Совпадение тегов видно сразу и без ИИ; ИИ получает теги вместе с текстом и сравнивает по смыслу.

const SKILLS_MAX = 10;
const SKILL_MAX_LENGTH = 30;

// Для показа: без «#», пробелы → «_». Буквы, цифры и + # . / - _ (C++, C#, Node.js, UX/UI, 1С).
function cleanSkill(raw) {
  if (typeof raw !== "string") return null;
  const tag = raw.trim().replace(/^#+/, "").trim().replace(/\s+/g, "_");
  if (tag.length < 1 || tag.length > SKILL_MAX_LENGTH) return null;
  if (!/^[\p{L}\p{N}][\p{L}\p{N}_+#./-]*$/u.test(tag)) return null;
  return tag;
}

// Для сравнения: регистр, ё/е, «-» и «_» не важны. #B2B_sales = #b2b-sales
function skillKey(tag) {
  return String(tag).toLowerCase().replace(/ё/g, "е").replace(/[-_]+/g, "_");
}

// Возвращает { skills } или { error } — без зависимости от ApiError
function normalizeSkills(value) {
  if (!Array.isArray(value)) return { error: "Поле \"skills\" должно быть списком тегов" };
  const seen = new Set();
  const skills = [];
  for (const raw of value) {
    const tag = cleanSkill(raw);
    if (!tag) {
      return { error: `Тег «${String(raw).slice(0, 40)}» не подходит: до ${SKILL_MAX_LENGTH} символов, буквы, цифры и _ + # . / -` };
    }
    const key = skillKey(tag);
    if (seen.has(key)) continue;
    seen.add(key);
    skills.push(tag);
  }
  if (skills.length > SKILLS_MAX) return { error: `Не больше ${SKILLS_MAX} тегов` };
  return { skills };
}

function asList(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

// Общие теги — в написании проекта (то, что ищет основатель)
function commonSkills(needed, has) {
  const keys = new Set(asList(has).map(skillKey));
  return asList(needed).filter((tag) => keys.has(skillKey(tag)));
}

module.exports = { SKILLS_MAX, normalizeSkills, commonSkills, skillKey, asList };
