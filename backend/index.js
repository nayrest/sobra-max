require("dotenv").config();

const { Bot, Keyboard } = require("@maxhub/max-bot-api");
const db = require("./db");
const { createApi } = require("./api");

const TOKEN = process.env.BOT_TOKEN;

if (!TOKEN) {
  console.error("❌ BOT_TOKEN не найден в .env");
  process.exit(1);
}

const bot = new Bot(TOKEN);

// ======================================================
// DATABASE
// ======================================================
// Схема и подключение к PostgreSQL теперь находятся в db.js.
// db.init() создаёт таблицы (если их ещё нет) при старте.

// ======================================================
// STATE
// ======================================================

const userStates = new Map();

function getUserId(ctx) {
  return ctx.user?.user_id;
}

function setState(userId, step, data = {}) {
  userStates.set(userId, { step, data });
}

function getState(userId) {
  return userStates.get(userId);
}

function clearState(userId) {
  userStates.delete(userId);
}

function parseMoney(text) {
  const cleaned = text.replace(/[^\d]/g, "");
  const amount = Number(cleaned);

  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  return Math.round(amount);
}

// ======================================================
// KEYBOARDS
// ======================================================

function mainMenu() {
  return Keyboard.inlineKeyboard([
    [
      Keyboard.button.callback(
        "🔎 Найти стартап",
        "find_startup"
      ),
    ],
    [
      Keyboard.button.callback(
        "🚀 Разместить стартап",
        "create_startup"
      ),
    ],
    [
      Keyboard.button.callback(
        "👤 Мой профиль",
        "my_profile"
      ),
    ],
  ]);
}

function backMenu() {
  return Keyboard.inlineKeyboard([
    [
      Keyboard.button.callback(
        "⬅️ Главное меню",
        "main_menu"
      ),
    ],
  ]);
}

function cancelCreation() {
  return Keyboard.inlineKeyboard([
    [
      Keyboard.button.callback(
        "❌ Отменить",
        "cancel_creation"
      ),
    ],
  ]);
}

function cancelSearch() {
  return Keyboard.inlineKeyboard([
    [
      Keyboard.button.callback(
        "❌ Отменить поиск",
        "cancel_search"
      ),
    ],
  ]);
}

function categoryKeyboard() {
  return Keyboard.inlineKeyboard([
    [
      Keyboard.button.callback("🤖 AI", "category_ai"),
      Keyboard.button.callback("💻 SaaS", "category_saas"),
    ],
    [
      Keyboard.button.callback("🍔 FoodTech", "category_foodtech"),
      Keyboard.button.callback("💳 FinTech", "category_fintech"),
    ],
    [
      Keyboard.button.callback("🎓 EdTech", "category_edtech"),
      Keyboard.button.callback("📦 E-commerce", "category_ecommerce"),
    ],
    [
      Keyboard.button.callback("➕ Другое", "category_other"),
    ],
    [
      Keyboard.button.callback("❌ Отменить", "cancel_creation"),
    ],
  ]);
}

function marketKeyboard() {
  return Keyboard.inlineKeyboard([
    [
      Keyboard.button.callback("🏢 B2B", "market_b2b"),
      Keyboard.button.callback("👤 B2C", "market_b2c"),
    ],
    [
      Keyboard.button.callback("🔄 B2B2C", "market_b2b2c"),
    ],
    [
      Keyboard.button.callback("❌ Отменить", "cancel_creation"),
    ],
  ]);
}

function stageKeyboard() {
  return Keyboard.inlineKeyboard([
    [Keyboard.button.callback("💡 Идея", "stage_idea")],
    [Keyboard.button.callback("🛠 Прототип", "stage_prototype")],
    [Keyboard.button.callback("🚀 MVP", "stage_mvp")],
    [Keyboard.button.callback("💰 Первые продажи", "stage_sales")],
    [Keyboard.button.callback("📈 Масштабирование", "stage_scaling")],
    [Keyboard.button.callback("❌ Отменить", "cancel_creation")],
  ]);
}

function seekingKeyboard() {
  return Keyboard.inlineKeyboard([
    [
      Keyboard.button.callback(
        "💰 Инвестиции",
        "seeking_investment"
      ),
    ],
    [
      Keyboard.button.callback(
        "🧪 Пилот / клиент",
        "seeking_pilot"
      ),
    ],
    [
      Keyboard.button.callback(
        "👥 Команда / co-founder",
        "seeking_team"
      ),
    ],
    [
      Keyboard.button.callback(
        "🤝 Партнёрство",
        "seeking_partner"
      ),
    ],
    [
      Keyboard.button.callback(
        "❌ Отменить",
        "cancel_creation"
      ),
    ],
  ]);
}

function publishKeyboard() {
  return Keyboard.inlineKeyboard([
    [
      Keyboard.button.callback(
        "🚀 Опубликовать",
        "publish_startup"
      ),
    ],
    [
      Keyboard.button.callback(
        "❌ Отменить",
        "cancel_creation"
      ),
    ],
  ]);
}

// ======================================================
// SEARCH KEYBOARDS
// ======================================================

function searchGoalKeyboard() {
  return Keyboard.inlineKeyboard([
    [
      Keyboard.button.callback(
        "💰 Инвестировать",
        "search_goal_investment"
      ),
    ],
    [
      Keyboard.button.callback(
        "🧪 Запустить пилот",
        "search_goal_pilot"
      ),
    ],
    [
      Keyboard.button.callback(
        "👥 Войти в команду",
        "search_goal_team"
      ),
    ],
    [
      Keyboard.button.callback(
        "🤝 Партнёрство",
        "search_goal_partner"
      ),
    ],
    [
      Keyboard.button.callback(
        "❌ Отменить",
        "cancel_search"
      ),
    ],
  ]);
}

function searchCategoryKeyboard() {
  return Keyboard.inlineKeyboard([
    [
      Keyboard.button.callback(
        "🤖 AI",
        "search_category_ai"
      ),
      Keyboard.button.callback(
        "💻 SaaS",
        "search_category_saas"
      ),
    ],
    [
      Keyboard.button.callback(
        "🍔 FoodTech",
        "search_category_foodtech"
      ),
      Keyboard.button.callback(
        "💳 FinTech",
        "search_category_fintech"
      ),
    ],
    [
      Keyboard.button.callback(
        "🎓 EdTech",
        "search_category_edtech"
      ),
      Keyboard.button.callback(
        "📦 E-commerce",
        "search_category_ecommerce"
      ),
    ],
    [
      Keyboard.button.callback(
        "🌐 Любая",
        "search_category_any"
      ),
    ],
    [
      Keyboard.button.callback(
        "❌ Отменить",
        "cancel_search"
      ),
    ],
  ]);
}

function searchStageKeyboard() {
  return Keyboard.inlineKeyboard([
    [Keyboard.button.callback("💡 Идея+", "search_stage_idea")],
    [Keyboard.button.callback("🛠 Прототип+", "search_stage_prototype")],
    [Keyboard.button.callback("🚀 MVP+", "search_stage_mvp")],
    [Keyboard.button.callback("💰 Первые продажи+", "search_stage_sales")],
    [Keyboard.button.callback("📈 Масштабирование", "search_stage_scaling")],
    [Keyboard.button.callback("❌ Отменить", "cancel_search")],
  ]);
}

function resultKeyboard(startupId) {
  return Keyboard.inlineKeyboard([
    [
      Keyboard.button.callback(
        "🤝 Интересно",
        `interest_${startupId}`
      ),
    ],
    [
      Keyboard.button.callback(
        "➡️ Следующий",
        "next_match"
      ),
    ],
    [
      Keyboard.button.callback(
        "⬅️ Главное меню",
        "main_menu"
      ),
    ],
  ]);
}

// ======================================================
// OFFER KEYBOARDS
// ======================================================

function offerTypeKeyboard() {
  return Keyboard.inlineKeyboard([
    [
      Keyboard.button.callback(
        "💰 Инвестиции",
        "offer_type_investment"
      ),
    ],
    [
      Keyboard.button.callback(
        "🧪 Пилот",
        "offer_type_pilot"
      ),
    ],
    [
      Keyboard.button.callback(
        "👥 Команда",
        "offer_type_team"
      ),
    ],
    [
      Keyboard.button.callback(
        "🤝 Партнёрство",
        "offer_type_partner"
      ),
    ],
    [
      Keyboard.button.callback(
        "❌ Отменить",
        "cancel_offer"
      ),
    ],
  ]);
}

function confirmOfferKeyboard() {
  return Keyboard.inlineKeyboard([
    [
      Keyboard.button.callback(
        "📨 Отправить предложение",
        "confirm_offer"
      ),
    ],
    [
      Keyboard.button.callback(
        "❌ Отменить",
        "cancel_offer"
      ),
    ],
  ]);
}

function founderOfferKeyboard(offerId) {
  return Keyboard.inlineKeyboard([
    [
      Keyboard.button.callback(
        "💬 Принять",
        `accept_offer_${offerId}`
      ),
      Keyboard.button.callback(
        "❌ Отклонить",
        `reject_offer_${offerId}`
      ),
    ],
  ]);
}

// ======================================================
// MAIN MENU
// ======================================================

async function showMainMenu(ctx) {
  await ctx.reply(
    "🚀 Startup Discovery\n\n" +
      "От стартап-питча до делового контакта — внутри MAX.\n\n" +
      "Что вы хотите сделать?",
    {
      attachments: [mainMenu()],
    }
  );
}

// ======================================================
// STARTUP CARD
// ======================================================

function startupCard(startup) {
  let seeking = startup.seeking || "Не указано";

  if (
    startup.seeking === "Инвестиции" &&
    startup.investment_amount
  ) {
    seeking +=
      " — " +
      Number(startup.investment_amount)
        .toLocaleString("ru-RU") +
      " ₽";
  }

  return (
    "🚀 " + startup.name + "\n\n" +
    "🏷 " +
    startup.category +
    " · " +
    startup.market_type +
    " · " +
    startup.stage +
    "\n\n" +
    "❗ Проблема\n" +
    startup.problem +
    "\n\n" +
    "💡 Решение\n" +
    startup.solution +
    "\n\n" +
    "📈 Traction\n" +
    startup.traction +
    "\n\n" +
    "🎯 Ищет\n" +
    seeking
  );
}

// stageRanks для matching теперь живёт в db.js (используется там же в findMatches).

// ======================================================
// /start
// ======================================================

bot.command("start", async (ctx) => {
  const userId = getUserId(ctx);

  if (userId) {
    await db.ensureUser(userId);

    clearState(userId);
  }

  await showMainMenu(ctx);
});

// ======================================================
// MAIN MENU CALLBACK
// ======================================================

bot.action("main_menu", async (ctx) => {
  const userId = getUserId(ctx);

  if (userId) {
    clearState(userId);
  }

  await ctx.answerOnCallback({
    notification: "Главное меню",
  });

  await showMainMenu(ctx);
});

// ======================================================
// CREATE STARTUP
// ======================================================

bot.action("create_startup", async (ctx) => {
  const userId = getUserId(ctx);

  await ctx.answerOnCallback({
    notification: "Создание стартапа",
  });

  if (!userId) return;

  setState(userId, "waiting_name", {});

  await ctx.reply(
    "🚀 Создание стартапа\n\n" +
      "Шаг 1 из 8\n\n" +
      "Как называется ваш проект?",
    {
      attachments: [cancelCreation()],
    }
  );
});

// ======================================================
// TEXT INPUT
// ======================================================

bot.on("message_created", async (ctx) => {
  const userId = getUserId(ctx);

  if (!userId) return;

  const state = getState(userId);

  if (!state) return;

  const text =
    ctx.message?.body?.text?.trim();

  if (!text) return;

  // STARTUP NAME

  if (state.step === "waiting_name") {
    if (text.length < 2 || text.length > 80) {
      await ctx.reply(
        "Введите название от 2 до 80 символов."
      );
      return;
    }

    state.data.name = text;

    setState(
      userId,
      "waiting_category",
      state.data
    );

    await ctx.reply(
      "✅ " + text + "\n\n" +
        "Шаг 2 из 8\n\n" +
        "Выберите направление:",
      {
        attachments: [categoryKeyboard()],
      }
    );

    return;
  }

  // PROBLEM

  if (state.step === "waiting_problem") {
    if (text.length < 10) {
      await ctx.reply(
        "Опишите проблему чуть подробнее."
      );
      return;
    }

    state.data.problem = text;

    setState(
      userId,
      "waiting_solution",
      state.data
    );

    await ctx.reply(
      "Шаг 6 из 8\n\n" +
        "💡 Как ваш стартап решает эту проблему?",
      {
        attachments: [cancelCreation()],
      }
    );

    return;
  }

  // SOLUTION

  if (state.step === "waiting_solution") {
    if (text.length < 10) {
      await ctx.reply(
        "Опишите решение чуть подробнее."
      );
      return;
    }

    state.data.solution = text;

    setState(
      userId,
      "waiting_traction",
      state.data
    );

    await ctx.reply(
      "Шаг 7 из 8\n\n" +
        "📈 Какой у проекта traction?\n\n" +
        "Например: 3 пилота, 2 клиента.\n" +
        "Если пока нет — напишите «Пока нет».",
      {
        attachments: [cancelCreation()],
      }
    );

    return;
  }

  // TRACTION

  if (state.step === "waiting_traction") {
    state.data.traction = text;

    setState(
      userId,
      "waiting_seeking",
      state.data
    );

    await ctx.reply(
      "Шаг 8 из 8\n\n" +
        "🎯 Что сейчас нужно проекту?",
      {
        attachments: [seekingKeyboard()],
      }
    );

    return;
  }

  // STARTUP INVESTMENT AMOUNT

  if (
    state.step === "waiting_investment_amount"
  ) {
    const amount = parseMoney(text);

    if (!amount) {
      await ctx.reply(
        "Введите сумму цифрами.\nНапример: 5000000"
      );
      return;
    }

    state.data.investment_amount = amount;

    await saveStartupPreview(
      ctx,
      userId,
      state.data
    );

    return;
  }

  // INVESTOR SEARCH BUDGET

  if (
    state.step === "search_waiting_budget"
  ) {
    const amount = parseMoney(text);

    if (!amount) {
      await ctx.reply(
        "Введите максимальный бюджет цифрами.\n" +
          "Например: 10000000"
      );
      return;
    }

    state.data.max_investment = amount;

    await runSearch(
      ctx,
      userId,
      state.data
    );

    return;
  }

  // OFFER MESSAGE

  if (
    state.step === "waiting_offer_message"
  ) {
    if (text.length < 5) {
      await ctx.reply(
        "Напишите сообщение чуть подробнее."
      );
      return;
    }

    if (text.length > 1000) {
      await ctx.reply(
        "Сообщение слишком длинное. Максимум 1000 символов."
      );
      return;
    }

    state.data.message = text;

    setState(
      userId,
      "waiting_offer_confirmation",
      state.data
    );

    const startup = await db.getStartupById(
      state.data.startupId
    );

    if (!startup) {
      clearState(userId);

      await ctx.reply(
        "❌ Проект больше не найден.",
        {
          attachments: [backMenu()],
        }
      );

      return;
    }

    await ctx.reply(
      "👀 Проверьте предложение\n\n" +
        "🚀 Проект: " +
        startup.name +
        "\n\n" +
        "📌 Тип: " +
        state.data.offerType +
        "\n\n" +
        "💬 Сообщение:\n" +
        state.data.message,
      {
        attachments: [
          confirmOfferKeyboard(),
        ],
      }
    );

    return;
  }
});

// ======================================================
// FOUNDER CATEGORY
// ======================================================

const founderCategories = {
  category_ai: "AI",
  category_saas: "SaaS",
  category_foodtech: "FoodTech",
  category_fintech: "FinTech",
  category_edtech: "EdTech",
  category_ecommerce: "E-commerce",
  category_other: "Другое",
};

for (
  const [action, category]
  of Object.entries(founderCategories)
) {
  bot.action(action, async (ctx) => {
    const userId = getUserId(ctx);
    const state = getState(userId);

    await ctx.answerOnCallback({
      notification: category,
    });

    if (
      !state ||
      state.step !== "waiting_category"
    ) {
      return;
    }

    state.data.category = category;

    setState(
      userId,
      "waiting_market",
      state.data
    );

    await ctx.reply(
      "Шаг 3 из 8\n\n" +
        "Для кого предназначен продукт?",
      {
        attachments: [marketKeyboard()],
      }
    );
  });
}

// ======================================================
// MARKET
// ======================================================

const markets = {
  market_b2b: "B2B",
  market_b2c: "B2C",
  market_b2b2c: "B2B2C",
};

for (
  const [action, market]
  of Object.entries(markets)
) {
  bot.action(action, async (ctx) => {
    const userId = getUserId(ctx);
    const state = getState(userId);

    await ctx.answerOnCallback({
      notification: market,
    });

    if (
      !state ||
      state.step !== "waiting_market"
    ) {
      return;
    }

    state.data.market_type = market;

    setState(
      userId,
      "waiting_stage",
      state.data
    );

    await ctx.reply(
      "Шаг 4 из 8\n\n" +
        "На какой стадии находится проект?",
      {
        attachments: [stageKeyboard()],
      }
    );
  });
}

// ======================================================
// FOUNDER STAGE
// ======================================================

const founderStages = {
  stage_idea: "Идея",
  stage_prototype: "Прототип",
  stage_mvp: "MVP",
  stage_sales: "Первые продажи",
  stage_scaling: "Масштабирование",
};

for (
  const [action, stage]
  of Object.entries(founderStages)
) {
  bot.action(action, async (ctx) => {
    const userId = getUserId(ctx);
    const state = getState(userId);

    await ctx.answerOnCallback({
      notification: stage,
    });

    if (
      !state ||
      state.step !== "waiting_stage"
    ) {
      return;
    }

    state.data.stage = stage;

    setState(
      userId,
      "waiting_problem",
      state.data
    );

    await ctx.reply(
      "Шаг 5 из 8\n\n" +
        "❗ Какую проблему решает ваш стартап?",
      {
        attachments: [cancelCreation()],
      }
    );
  });
}

// ======================================================
// SEEKING
// ======================================================

const seekingOptions = {
  seeking_pilot: "Пилот / клиент",
  seeking_team: "Команда / co-founder",
  seeking_partner: "Партнёрство",
};

for (
  const [action, seeking]
  of Object.entries(seekingOptions)
) {
  bot.action(action, async (ctx) => {
    const userId = getUserId(ctx);
    const state = getState(userId);

    await ctx.answerOnCallback({
      notification: seeking,
    });

    if (
      !state ||
      state.step !== "waiting_seeking"
    ) {
      return;
    }

    state.data.seeking = seeking;
    state.data.investment_amount = null;

    await saveStartupPreview(
      ctx,
      userId,
      state.data
    );
  });
}

bot.action(
  "seeking_investment",
  async (ctx) => {
    const userId = getUserId(ctx);
    const state = getState(userId);

    await ctx.answerOnCallback({
      notification: "Инвестиции",
    });

    if (
      !state ||
      state.step !== "waiting_seeking"
    ) {
      return;
    }

    state.data.seeking = "Инвестиции";

    setState(
      userId,
      "waiting_investment_amount",
      state.data
    );

    await ctx.reply(
      "💰 Какой объём инвестиций вы привлекаете?\n\n" +
        "Например: 5000000",
      {
        attachments: [cancelCreation()],
      }
    );
  }
);

// ======================================================
// SAVE STARTUP
// ======================================================

async function saveStartupPreview(
  ctx,
  userId,
  data
) {
  const startup = await db.saveStartupDraft(
    userId,
    data
  );

  setState(
    userId,
    "waiting_publish",
    { startupId: startup.id }
  );

  await ctx.reply(
    "👀 Предпросмотр\n\n" +
      startupCard(startup),
    {
      attachments: [publishKeyboard()],
    }
  );
}

// ======================================================
// PUBLISH
// ======================================================

bot.action(
  "publish_startup",
  async (ctx) => {
    const userId = getUserId(ctx);
    const state = getState(userId);

    await ctx.answerOnCallback({
      notification: "Публикация",
    });

    if (
      !state ||
      state.step !== "waiting_publish"
    ) {
      return;
    }

    const startupId =
      state.data.startupId;

    const startup = await db.publishStartup(
      startupId,
      userId
    );

    clearState(userId);

    await ctx.reply(
      "🎉 Стартап опубликован!\n\n" +
        startupCard(startup),
      {
        attachments: [backMenu()],
      }
    );
  }
);

// ======================================================
// SEARCH START
// ======================================================

bot.action(
  "find_startup",
  async (ctx) => {
    const userId = getUserId(ctx);

    await ctx.answerOnCallback({
      notification: "Поиск стартапов",
    });

    if (!userId) return;

    setState(
      userId,
      "search_waiting_goal",
      {}
    );

    await ctx.reply(
      "🔎 Персональный поиск\n\n" +
        "Шаг 1 из 4\n\n" +
        "🎯 Зачем вы ищете стартап?",
      {
        attachments: [
          searchGoalKeyboard(),
        ],
      }
    );
  }
);

// ======================================================
// SEARCH GOAL
// ======================================================

const searchGoals = {
  search_goal_investment: {
    value: "investment",
    label: "Инвестировать",
  },
  search_goal_pilot: {
    value: "pilot",
    label: "Запустить пилот",
  },
  search_goal_team: {
    value: "team",
    label: "Войти в команду",
  },
  search_goal_partner: {
    value: "partner",
    label: "Партнёрство",
  },
};

for (
  const [action, goal]
  of Object.entries(searchGoals)
) {
  bot.action(action, async (ctx) => {
    const userId = getUserId(ctx);
    const state = getState(userId);

    await ctx.answerOnCallback({
      notification: goal.label,
    });

    if (
      !state ||
      state.step !== "search_waiting_goal"
    ) {
      return;
    }

    state.data.goal = goal.value;

    setState(
      userId,
      "search_waiting_category",
      state.data
    );

    await ctx.reply(
      "✅ Цель: " +
        goal.label +
        "\n\n" +
        "Шаг 2 из 4\n\n" +
        "Какое направление вас интересует?",
      {
        attachments: [
          searchCategoryKeyboard(),
        ],
      }
    );
  });
}

// ======================================================
// SEARCH CATEGORY
// ======================================================

const searchCategories = {
  search_category_ai: "AI",
  search_category_saas: "SaaS",
  search_category_foodtech: "FoodTech",
  search_category_fintech: "FinTech",
  search_category_edtech: "EdTech",
  search_category_ecommerce: "E-commerce",
  search_category_any: "Любая",
};

for (
  const [action, category]
  of Object.entries(searchCategories)
) {
  bot.action(action, async (ctx) => {
    const userId = getUserId(ctx);
    const state = getState(userId);

    await ctx.answerOnCallback({
      notification: category,
    });

    if (
      !state ||
      state.step !== "search_waiting_category"
    ) {
      return;
    }

    state.data.category = category;

    setState(
      userId,
      "search_waiting_stage",
      state.data
    );

    await ctx.reply(
      "Шаг 3 из 4\n\n" +
        "🚀 Какая минимальная стадия проекта?",
      {
        attachments: [
          searchStageKeyboard(),
        ],
      }
    );
  });
}

// ======================================================
// SEARCH STAGE
// ======================================================

const searchStages = {
  search_stage_idea: "Идея",
  search_stage_prototype: "Прототип",
  search_stage_mvp: "MVP",
  search_stage_sales: "Первые продажи",
  search_stage_scaling: "Масштабирование",
};

for (
  const [action, stage]
  of Object.entries(searchStages)
) {
  bot.action(action, async (ctx) => {
    const userId = getUserId(ctx);
    const state = getState(userId);

    await ctx.answerOnCallback({
      notification: stage + "+",
    });

    if (
      !state ||
      state.step !== "search_waiting_stage"
    ) {
      return;
    }

    state.data.min_stage = stage;

    if (
      state.data.goal === "investment"
    ) {
      setState(
        userId,
        "search_waiting_budget",
        state.data
      );

      await ctx.reply(
        "Шаг 4 из 4\n\n" +
          "💰 Какой максимальный объём инвестиций " +
          "вы готовы рассматривать?\n\n" +
          "Например: 10000000",
        {
          attachments: [
            cancelSearch(),
          ],
        }
      );

      return;
    }

    state.data.max_investment = null;

    await runSearch(
      ctx,
      userId,
      state.data
    );
  });
}

// ======================================================
// MATCHING
// ======================================================

// findMatches и saveSearchProfile теперь в db.js —
// логика matching оставлена идентичной (см. db.js).

async function runSearch(
  ctx,
  userId,
  criteria
) {
  await db.saveSearchProfile(
    userId,
    criteria
  );

  const matches =
    await db.findMatches(criteria);

  if (matches.length === 0) {
    clearState(userId);

    await ctx.reply(
      "😕 Точных совпадений пока нет.\n\n" +
        "Попробуйте изменить категорию, " +
        "стадию или бюджет.",
      {
        attachments: [backMenu()],
      }
    );

    return;
  }

  setState(
    userId,
    "viewing_matches",
    {
      matches,
      currentIndex: 0,
      criteria,
    }
  );

  await ctx.reply(
    "✅ Поиск завершён!\n\n" +
      "Найдено подходящих проектов: " +
      matches.length
  );

  await showMatch(
    ctx,
    userId
  );
}

async function showMatch(
  ctx,
  userId
) {
  const state = getState(userId);

  if (
    !state ||
    state.step !== "viewing_matches"
  ) {
    return;
  }

  const matches =
    state.data.matches;

  const index =
    state.data.currentIndex;

  if (index >= matches.length) {
    clearState(userId);

    await ctx.reply(
      "🏁 Вы посмотрели все подходящие проекты.",
      {
        attachments: [backMenu()],
      }
    );

    return;
  }

  const result =
    matches[index];

  await ctx.reply(
    "🎯 Совпадение " +
      result.matched +
      " из " +
      result.total +
      " критериев\n\n" +
      "Проект " +
      (index + 1) +
      " из " +
      matches.length +
      "\n\n" +
      startupCard(result.startup),
    {
      attachments: [
        resultKeyboard(
          result.startup.id
        ),
      ],
    }
  );
}

// ======================================================
// NEXT MATCH
// ======================================================

bot.action(
  "next_match",
  async (ctx) => {
    const userId = getUserId(ctx);
    const state = getState(userId);

    await ctx.answerOnCallback({
      notification: "Следующий проект",
    });

    if (
      !state ||
      state.step !== "viewing_matches"
    ) {
      return;
    }

    state.data.currentIndex++;

    setState(
      userId,
      "viewing_matches",
      state.data
    );

    await showMatch(
      ctx,
      userId
    );
  }
);

// ======================================================
// INTEREST -> START OFFER
// ======================================================

bot.action(
  /^interest_(\d+)$/,
  async (ctx) => {
    const userId = getUserId(ctx);

    await ctx.answerOnCallback({
      notification:
        "Создаём предложение",
    });

    if (!userId) return;

    const payload =
      ctx.callback?.payload;

    const match =
      payload?.match(
        /^interest_(\d+)$/
      );

    if (!match) {
      await ctx.reply(
        "❌ Не удалось определить проект."
      );
      return;
    }

    const startupId =
      Number(match[1]);

    const startup =
      await db.getPublishedStartupById(startupId);

    if (!startup) {
      await ctx.reply(
        "❌ Проект больше недоступен.",
        {
          attachments: [backMenu()],
        }
      );

      return;
    }

    setState(
      userId,
      "waiting_offer_type",
      {
        startupId,
      }
    );

    await ctx.reply(
      "🤝 Предложение для " +
        startup.name +
        "\n\n" +
        "Что именно вы хотите предложить founder'у?",
      {
        attachments: [
          offerTypeKeyboard(),
        ],
      }
    );
  }
);

// ======================================================
// OFFER TYPE
// ======================================================

const offerTypes = {
  offer_type_investment:
    "💰 Инвестиции",

  offer_type_pilot:
    "🧪 Пилот / сотрудничество",

  offer_type_team:
    "👥 Присоединиться к команде",

  offer_type_partner:
    "🤝 Партнёрство",
};

for (
  const [action, type]
  of Object.entries(offerTypes)
) {
  bot.action(
    action,
    async (ctx) => {
      const userId =
        getUserId(ctx);

      const state =
        getState(userId);

      await ctx.answerOnCallback({
        notification: type,
      });

      if (
        !state ||
        state.step !==
          "waiting_offer_type"
      ) {
        return;
      }

      state.data.offerType =
        type;

      setState(
        userId,
        "waiting_offer_message",
        state.data
      );

      await ctx.reply(
        "💬 Напишите короткое сообщение founder'у.\n\n" +
          "Например:\n" +
          "«Интересен ваш проект. Хотел бы обсудить " +
          "инвестиции и узнать подробнее о текущих метриках.»"
      );
    }
  );
}

// ======================================================
// CONFIRM OFFER
// ======================================================

bot.action(
  "confirm_offer",
  async (ctx) => {
    const senderId =
      getUserId(ctx);

    const state =
      getState(senderId);

    await ctx.answerOnCallback({
      notification:
        "Отправляем предложение",
    });

    if (
      !state ||
      state.step !==
        "waiting_offer_confirmation"
    ) {
      return;
    }

    const startup =
      await db.getPublishedStartupById(
        state.data.startupId
      );

    if (!startup) {
      clearState(senderId);

      await ctx.reply(
        "❌ Проект больше недоступен.",
        {
          attachments: [backMenu()],
        }
      );

      return;
    }

    // SAVE OFFER

    // TODO: проверить в докуменации @maxhub/max-bot-api реальное
    // название поля с именем пользователя (сейчас пробуем несколько
    // вероятных вариантов с фолбэком на null, если ни одного нет).
    const senderName =
      ctx.user?.name ||
      ctx.user?.first_name ||
      ctx.user?.username ||
      null;

    const offer =
      await db.createOffer(
        startup.id,
        senderId,
        senderName,
        state.data.offerType,
        state.data.message
      );

    const offerId = offer.id;

    // NOTIFY FOUNDER

    try {
      await bot.api.sendMessageToUser(
        startup.founder_id,
        "🔔 Новое предложение!\n\n" +
          "🚀 Проект: " +
          startup.name +
          "\n\n" +
          "📌 Тип предложения:\n" +
          state.data.offerType +
          "\n\n" +
          "💬 Сообщение:\n" +
          state.data.message +
          "\n\n" +
          "ID предложения: #" +
          offerId,
        {
          attachments: [
            founderOfferKeyboard(
              offerId
            ),
          ],
        }
      );

      console.log(
        `📨 Offer #${offerId} отправлен founder ${startup.founder_id}`
      );
    } catch (error) {
      console.error(
        "❌ Ошибка уведомления founder:",
        error
      );

      // Сам offer уже сохранён.
      // Поэтому не теряем данные.
    }

    clearState(senderId);

    await ctx.reply(
      "✅ Предложение отправлено!\n\n" +
        "🚀 " +
        startup.name +
        "\n\n" +
        "Founder получил уведомление в MAX.\n\n" +
        "Предложение #" +
        offerId,
      {
        attachments: [backMenu()],
      }
    );
  }
);

// ======================================================
// ACCEPT OFFER
// ======================================================

bot.action(
  /^accept_offer_(\d+)$/,
  async (ctx) => {
    const founderId =
      getUserId(ctx);

    const payload =
      ctx.callback?.payload;

    const match =
      payload?.match(
        /^accept_offer_(\d+)$/
      );

    if (!match) return;

    const offerId =
      Number(match[1]);

    const offer =
      await db.getOfferWithStartup(offerId);

    if (
      !offer ||
      Number(offer.founder_id) !==
        Number(founderId)
    ) {
      await ctx.answerOnCallback({
        notification:
          "Нет доступа",
      });

      return;
    }

    await db.updateOfferStatus(
      offerId,
      "accepted"
    );

    await ctx.answerOnCallback({
      notification:
        "Предложение принято",
    });

    // Уведомляем отправителя

    try {
      await bot.api.sendMessageToUser(
        offer.sender_id,
        "🎉 Ваше предложение принято!\n\n" +
          "🚀 Проект: " +
          offer.startup_name +
          "\n\n" +
          "Founder заинтересован в продолжении общения."
      );
    } catch (error) {
      console.error(
        "❌ Не удалось уведомить отправителя:",
        error
      );
    }

    await ctx.reply(
      "✅ Вы приняли предложение #" +
        offerId +
        ".\n\n" +
        "Отправитель получил уведомление."
    );
  }
);

// ======================================================
// REJECT OFFER
// ======================================================

bot.action(
  /^reject_offer_(\d+)$/,
  async (ctx) => {
    const founderId =
      getUserId(ctx);

    const payload =
      ctx.callback?.payload;

    const match =
      payload?.match(
        /^reject_offer_(\d+)$/
      );

    if (!match) return;

    const offerId =
      Number(match[1]);

    const offer =
      await db.getOfferWithStartup(offerId);

    if (
      !offer ||
      Number(offer.founder_id) !==
        Number(founderId)
    ) {
      await ctx.answerOnCallback({
        notification:
          "Нет доступа",
      });

      return;
    }

    await db.updateOfferStatus(
      offerId,
      "rejected"
    );

    await ctx.answerOnCallback({
      notification:
        "Предложение отклонено",
    });

    try {
      await bot.api.sendMessageToUser(
        offer.sender_id,
        "Спасибо за интерес к проекту " +
          offer.startup_name +
          ".\n\n" +
          "Founder отклонил предложение #" +
          offerId +
          "."
      );
    } catch (error) {
      console.error(
        "❌ Не удалось уведомить отправителя:",
        error
      );
    }

    await ctx.reply(
      "Предложение #" +
        offerId +
        " отклонено."
    );
  }
);

// ======================================================
// CANCEL OFFER
// ======================================================

bot.action(
  "cancel_offer",
  async (ctx) => {
    const userId =
      getUserId(ctx);

    if (userId) {
      clearState(userId);
    }

    await ctx.answerOnCallback({
      notification:
        "Предложение отменено",
    });

    await showMainMenu(ctx);
  }
);

// ======================================================
// CANCEL SEARCH
// ======================================================

bot.action(
  "cancel_search",
  async (ctx) => {
    const userId =
      getUserId(ctx);

    if (userId) {
      clearState(userId);
    }

    await ctx.answerOnCallback({
      notification:
        "Поиск отменён",
    });

    await showMainMenu(ctx);
  }
);

// ======================================================
// CANCEL CREATION
// ======================================================

bot.action(
  "cancel_creation",
  async (ctx) => {
    const userId =
      getUserId(ctx);

    const state =
      getState(userId);

    if (
      state &&
      state.step ===
        "waiting_publish" &&
      state.data.startupId
    ) {
      await db.deleteDraft(
        state.data.startupId,
        userId
      );
    }

    if (userId) {
      clearState(userId);
    }

    await ctx.answerOnCallback({
      notification: "Отменено",
    });

    await showMainMenu(ctx);
  }
);

// ======================================================
// PROFILE
// ======================================================

bot.action(
  "my_profile",
  async (ctx) => {
    const userId =
      getUserId(ctx);

    await ctx.answerOnCallback({
      notification: "Профиль",
    });

    if (!userId) return;

    const startups =
      await db.getFounderStartups(userId);

    const search =
      await db.getSearchProfile(userId);

    const receivedOffers =
      await db.getReceivedOffers(userId);

    let message =
      "👤 Мой профиль\n\n";

    if (
      startups.length === 0
    ) {
      message +=
        "🚀 Стартапов пока нет.\n\n";
    } else {
      message +=
        "🚀 Ваши стартапы:\n\n";

      for (
        const startup
        of startups
      ) {
        message +=
          "#" +
          startup.id +
          " — " +
          startup.name +
          "\n" +
          startup.category +
          " · " +
          startup.market_type +
          " · " +
          startup.stage +
          "\n" +
          (
            startup.status ===
            "published"
              ? "🟢 опубликован"
              : "🟡 черновик"
          ) +
          "\n\n";
      }
    }

    if (search) {
      message +=
        "🎯 Последний поиск:\n" +
        "Категория: " +
        search.category +
        "\n" +
        "Минимальная стадия: " +
        search.min_stage +
        "\n";

      if (
        search.max_investment
      ) {
        message +=
          "Бюджет: до " +
          Number(
            search.max_investment
          ).toLocaleString(
            "ru-RU"
          ) +
          " ₽\n";
      }

      message += "\n";
    }

    if (
      receivedOffers.length > 0
    ) {
      message +=
        "📨 Полученные предложения: " +
        receivedOffers.length +
        "\n\n";

      for (
        const offer
        of receivedOffers.slice(
          0,
          5
        )
      ) {
        const statusEmoji =
          offer.status ===
          "accepted"
            ? "✅"
            : offer.status ===
              "rejected"
            ? "❌"
            : "🆕";

        message +=
          statusEmoji +
          " #" +
          offer.id +
          " · " +
          offer.startup_name +
          "\n" +
          offer.type +
          "\n\n";
      }
    }

    await ctx.reply(
      message,
      {
        attachments: [
          backMenu(),
        ],
      }
    );
  }
);

// ======================================================
// START
// ======================================================

// ======================================================
// УВЕДОМЛЕНИЯ ДЛЯ MINI APP
// ======================================================
// Когда действие совершено в мини-приложении, бот всё равно
// уведомляет второго участника в чате MAX.

const notify = {
  async newOffer(startup, offer) {
    await bot.api.sendMessageToUser(
      startup.founder_id,
      "🔔 Новое предложение!\n\n" +
        "🚀 Проект: " + startup.name + "\n\n" +
        "📌 Тип предложения:\n" + offer.type + "\n\n" +
        "💬 Сообщение:\n" + offer.message + "\n\n" +
        "ID предложения: #" + offer.id,
      {
        attachments: [founderOfferKeyboard(offer.id)],
      }
    );
  },

  async offerAccepted(offer) {
    await bot.api.sendMessageToUser(
      offer.sender_id,
      "🎉 Ваше предложение принято!\n\n" +
        "🚀 Проект: " + offer.startup_name + "\n\n" +
        "Founder заинтересован в продолжении общения."
    );
  },

  async offerRejected(offer) {
    await bot.api.sendMessageToUser(
      offer.sender_id,
      "Спасибо за интерес к проекту " + offer.startup_name + ".\n\n" +
        "Founder отклонил предложение #" + offer.id + "."
    );
  },
};

const API_PORT = Number(process.env.API_PORT) || 3000;

async function main() {
  await db.init();

  const app = createApi({ notify });

  console.log(
    require("./ai-matching").isEnabled()
      ? "🤖 AI Matching: YandexGPT подключён"
      : "⚠️  AI Matching выключен: не заданы YANDEX_API_KEY / YANDEX_FOLDER_ID"
  );

  app.listen(API_PORT, () => {
    console.log(`🌐 API для мини-приложения слушает порт ${API_PORT}`);
  });

  await bot.start();

  console.log(
    "🚀 Startup Discovery запущен"
  );
}

main().catch((error) => {
  console.error(
    "❌ Ошибка запуска бота:"
  );

  console.error(error);

  process.exit(1);
});