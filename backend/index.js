require("dotenv").config();

const { Bot } = require("@maxhub/max-bot-api");
const db = require("./db");
const { createApi, publishEvent } = require("./api");
const aiMatching = require("./ai-matching");

const TOKEN = process.env.BOT_TOKEN;

if (!TOKEN) {
  console.error("❌ BOT_TOKEN не найден в .env");
  process.exit(1);
}

const bot = new Bot(TOKEN);

// ======================================================
// РОЛЬ БОТА
// ======================================================
// Вся работа с проектами идёт в мини-приложении SOBRA.
// Бот — точка входа и канал уведомлений:
//   • /start и первый запуск — инструкция;
//   • любое другое сообщение — короткая подсказка;
//   • уведомления о новых предложениях и решениях по ним.

const INSTRUCTION =
  "👋 Добро пожаловать в SOBRA!\n\n" +
  "SOBRA помогает проверить бизнес-идею и найти людей, с которыми её запускать.\n\n" +
  "Откройте мини-приложение кнопкой в этом чате. Регистрироваться не нужно — выберите свой путь:\n\n" +
  "💡 Проверить идею\n" +
  "«Проекты» → «Проверить новую идею». За 10 минут SOBRA покажет, что в идее подтверждено, а что пока догадка, и даст план следующих шагов.\n\n" +
  "🤝 Проверить идею и найти партнёра\n" +
  "То же самое, потом «Опубликовать» → «Подобрать партнёра»: ИИ найдёт людей с нужными навыками и объяснит почему.\n\n" +
  "🚀 Присоединиться к чужому проекту\n" +
  "«Поиск» → найдите проект → «Откликнуться».\n\n" +
  "Контакты приложение спросит, только когда вы публикуете проект или откликаетесь. Их увидит лишь тот, с кем случится MATCH.\n\n" +
  "🔔 О новых откликах и решениях по ним я сообщу здесь.";

const HINT =
  "Я не веду диалог в чате: вся работа с проектами — в мини-приложении SOBRA.\n\n" +
  "Откройте его в этом чате. Инструкция — по команде /start.\n\n" +
  "💬 Чтобы после MATCH у собеседника появилась кнопка «Написать в MAX», перешлите сюда ссылку на свой профиль: " +
  "профиль MAX → «Пригласить в друзья» → «Поделиться» → этот чат.";

async function sendInstruction(ctx) {
  const userId = ctx.user?.user_id;
  if (userId) await db.ensureUser(userId);
  await ctx.reply(INSTRUCTION);
}

bot.command("start", async (ctx) => {
  try {
    await sendInstruction(ctx);
  } catch (error) {
    console.error("❌ Ошибка /start:", error.message);
  }
});

// Пользователь впервые нажал «Начать» в чате с ботом
bot.on("bot_started", async (ctx) => {
  try {
    await sendInstruction(ctx);
  } catch (error) {
    console.error("❌ Ошибка bot_started:", error.message);
  }
});

// Ссылка на профиль MAX: https://max.ru/<ник> или https://max.ru/u/<код приглашения>.
// Её нельзя получить через API, поэтому человек пересылает боту приглашение из своего профиля
// («Пригласить в друзья» → «Поделиться» → чат с ботом). Ищем ссылку в тексте и во вложениях.
const MAX_LINK_RE = /https:\/\/(?:www\.)?max\.ru\/[A-Za-z0-9_.\-\/]+/;

function findMaxLink(message) {
  const body = message?.body || {};
  const haystack = [body.text || "", JSON.stringify(body.attachments || []), JSON.stringify(body.markup || [])].join(" ");
  const match = haystack.match(MAX_LINK_RE);
  if (!match) return null;
  const link = match[0].replace(/[.\-\/]+$/, "");
  // Ссылку на самого бота или на мини-приложение сохранять незачем
  if (/max\.ru\/[^/]*_bot\b/i.test(link)) return null;
  return link.length <= 300 ? link : null;
}

const LINK_SAVED =
  "✅ Ссылка на ваш профиль MAX сохранена.\n\n" +
  "После MATCH у собеседника появится кнопка «Написать в MAX». " +
  "Изменить или удалить ссылку можно в мини-приложении, вкладка «Профиль».";

bot.on("message_created", async (ctx) => {
  const text = ctx.message?.body?.text?.trim() || "";

  // Команды (/start и т.п.) обрабатываются отдельно
  if (text.startsWith("/")) return;

  try {
    const userId = ctx.user?.user_id || ctx.message?.sender?.user_id;
    const link = userId ? findMaxLink(ctx.message) : null;
    if (link) {
      await db.ensureUser(userId);
      await db.saveMaxLink(userId, link);
      publishEvent(userId, "profile"); // открытый профиль в мини-приложении обновится сам
      await ctx.reply(LINK_SAVED);
      return;
    }
    if (!text) {
      // Вложение без ссылки — пишем тип в лог, чтобы понять формат «Поделиться» в живом MAX
      const types = (ctx.message?.body?.attachments || []).map((a) => a.type).join(", ");
      if (types) console.log(`ℹ️  Сообщение боту без ссылки, вложения: ${types}`);
      else return;
    }
    await ctx.reply(HINT);
  } catch (error) {
    console.error("❌ Ошибка ответа на сообщение:", error.message);
  }
});

// ======================================================
// УВЕДОМЛЕНИЯ
// ======================================================
// Действия совершаются в мини-приложении, а второй участник
// узнаёт о них сообщением в чате с ботом.

const notify = {
  async newOffer(startup, offer) {
    await bot.api.sendMessageToUser(
      startup.founder_id,
      "🔔 Новый отклик на проект «" + startup.name + "»\n\n" +
        "📌 " + offer.type + "\n" +
        "👤 " + (offer.sender_name || "Пользователь MAX") + "\n\n" +
        "💬 " + offer.message + "\n\n" +
        "Принять или отклонить можно в мини-приложении SOBRA, вкладка «Отклики»."
    );
  },

  async offerAccepted(offer) {
    await bot.api.sendMessageToUser(
      offer.sender_id,
      "🎉 MATCH! Основатель проекта «" + offer.startup_name + "» принял ваш отклик.\n\n" +
        "Телефон и e-mail основателя — в мини-приложении SOBRA, вкладка «Контакты»."
    );
  },

  async invite(startup, userId) {
    await bot.api.sendMessageToUser(
      userId,
      "✉️ Вас пригласили в проект «" + startup.name + "»\n\n" +
        "Основатель посмотрел ваш профиль и считает, что вы подходите проекту.\n\n" +
        "Откройте мини-приложение SOBRA, вкладка «Отклики»: там можно посмотреть проект и откликнуться."
    );
  },

  async offerRejected(offer) {
    await bot.api.sendMessageToUser(
      offer.sender_id,
      "Спасибо за интерес к проекту «" + offer.startup_name + "».\n\n" +
        "Основатель отклонил отклик. Попробуйте найти другие проекты во вкладке «Поиск»."
    );
  },
};

// ======================================================
// ЗАПУСК
// ======================================================

const API_PORT = Number(process.env.API_PORT) || 3000;

async function main() {
  await db.init();

  console.log(
    aiMatching.isEnabled()
      ? "🤖 AI Matching: YandexGPT подключён"
      : "⚠️  AI Matching выключен: не заданы YANDEX_API_KEY / YANDEX_FOLDER_ID"
  );

  const app = createApi({ notify });

  app.listen(API_PORT, () => {
    console.log(`🌐 API для мини-приложения слушает порт ${API_PORT}`);
  });

  console.log("🚀 Бот SOBRA запускается");
  await bot.start();
}

main().catch((error) => {
  console.error("❌ Ошибка запуска:");
  console.error(error);
  process.exit(1);
});
