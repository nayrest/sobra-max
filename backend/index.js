require("dotenv").config();

const { Bot } = require("@maxhub/max-bot-api");
const db = require("./db");
const { createApi } = require("./api");
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
  "SOBRA помогает найти людей под бизнес-идею: партнёров и команду.\n\n" +
  "Как пользоваться:\n\n" +
  "Откройте мини-приложение SOBRA в этом чате.\n\n" +
  "Если у вас есть идея:\n" +
  "1️⃣ Во вкладке «Проекты» пройдите проверку идеи. SOBRA покажет, что подтверждено, а что стоит проверить.\n" +
  "2️⃣ Опубликуйте проект и откройте «Подбор партнёра»: ИИ найдёт подходящих людей и объяснит почему.\n\n" +
  "Если хотите присоединиться к проекту:\n" +
  "3️⃣ Во вкладке «Профиль» расскажите о себе.\n" +
  "4️⃣ Во вкладке «Поиск» найдите проект и откликнитесь.\n\n" +
  "Когда основатель примет отклик, это MATCH: во вкладке «Контакты» вы увидите телефон и e-mail друг друга.\n\n" +
  "🔔 О новых откликах и решениях по ним я сообщу здесь.";

const HINT =
  "Я не веду диалог в чате: вся работа с проектами — в мини-приложении SOBRA.\n\n" +
  "Откройте его в этом чате. Инструкция — по команде /start.";

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

bot.on("message_created", async (ctx) => {
  const text = ctx.message?.body?.text?.trim();

  // Команды (/start и т.п.) обрабатываются отдельно
  if (!text || text.startsWith("/")) return;

  try {
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
