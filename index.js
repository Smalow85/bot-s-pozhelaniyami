const { Telegraf, Markup } = require('telegraf');
const admin = require('firebase-admin');
const cron = require('node-cron');
const express = require('express');

// === Конфиг ===
const BOT_TOKEN = '7907396982:AAF-JjqwFBgtcQRiMKvo5RYWxHKkMPEGmNU';
const ADMIN_IDS = [954901711, 410835476];
const PORT = process.env.PORT || 8080;
const WEBHOOK_URL = 'https://telegram-bot-433966661449.us-central1.run.app';

// === Firebase Init ===
const serviceAccount = require('./service_account.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();
// Теперь будем сохранять ID файла изображения
const imageDocRef = db.collection('bot_data').doc('default_image');
const usersCollection = db.collection('all_users');

// === Bot init ===
const bot = new Telegraf(BOT_TOKEN);
const adminState = new Set(); // кто вводит новое сообщение

// === Кнопки ===
const getReplyKeyboard = (userId) => {
  const buttons = [
    ['Получить послание'] // Кнопка теперь "Получить изображение"
  ];
  if (ADMIN_IDS.includes(userId)) {
    buttons.push(
      ['Изменить изображение'] // Кнопка теперь "Изменить изображение"
    );
  }
  return Markup.keyboard(buttons).resize();
};

const getCancelKeyboard = () => {
    return Markup.keyboard([['Отмена']]).resize().oneTime(); // Отдельная клавиатура для отмены
};

const removeReplyKeyboard = () => {
    return Markup.removeKeyboard();
};

// === Хендлеры ===
bot.start(async (ctx) => {
  const userId = String(ctx.from.id); // ID пользователя
  try {
    // Автоматически добавляем пользователя в список всех пользователей при старте
    // Используем set с merge: true, чтобы не перезаписывать существующие данные
    await usersCollection.doc(userId).set({
      username: ctx.from.username || null,
      firstName: ctx.from.first_name || null,
      lastName: ctx.from.last_name || null,
      lastInteraction: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    console.log(`Пользователь ${userId} добавлен/обновлен в all_users.`);
  } catch (error) {
    console.error(`Ошибка при сохранении пользователя ${userId}:`, error);
  }

  ctx.reply(
    `Привет, ${ctx.from.first_name}! Воспользуйся кнопками ниже:`,
    getReplyKeyboard(ctx.from.id)
  );
});

// --- Новый обработчик для получения изображений от пользователя (админа) ---
bot.on('photo', async (ctx) => {
    const userId = ctx.from.id;

    if (adminState.has(userId)) {
        // Получаем самое большое разрешение фото (последний элемент в массиве)
        const photoFileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
        
        await imageDocRef.set({ file_id: photoFileId }); // Сохраняем file_id в Firestore
        adminState.delete(userId); // Выводим админа из состояния "ввода"

        return ctx.reply('Изображение обновлено ✅', getReplyKeyboard(userId));
    }

    // Если фото отправлено не в режиме админа, просто отвечаем клавиатурой
    ctx.reply('Я тебя не понимаю. Воспользуйся кнопками ниже.', getReplyKeyboard(userId));
});


// --- Обновленный обработчик 'text' для кнопок и неизвестных команд ---
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const messageText = ctx.message.text;

  // Если админ находится в состоянии ожидания изображения, но отправил текст
  if (adminState.has(userId)) {
      if (messageText === 'Отмена') {
          adminState.delete(userId);
          return ctx.reply('Действие отменено.', getReplyKeyboard(userId));
      }
      // Можно предупредить, что ожидается фото, а не текст
      return ctx.reply('Ожидаю изображение, а не текст. Пожалуйста, отправь картинку. Если хотите отменить, нажмите "Отмена".');
  }

  switch (messageText) {
    case 'Получить послание': // Изменено с 'Получить сообщение'
      const doc = await imageDocRef.get();
      if (!doc.exists || !doc.data() || !doc.data().file_id) {
        return ctx.reply('Изображение отсутствует.');
      }
      const data = doc.data();
      await ctx.replyWithPhoto(data.file_id); // Отправляем фото по file_id
      // Если клавиатура скрывается после одного использования (.oneTime()),
      // убедитесь, что вы отправляете ее снова здесь.
      // Если .oneTime() удалено, она должна остаться видимой.
      break;

    case 'Изменить изображение': // Изменено с 'Изменить сообщение'
      if (!ADMIN_IDS.includes(userId)) {
        return ctx.reply('Нет доступа.');
      }
      adminState.add(userId);
      await ctx.reply('Отправь новое изображение для сохранения или нажми "Отмена":', getCancelKeyboard());
      break;

    default:
      ctx.reply('Я тебя не понимаю. Воспользуйся кнопками ниже.', getReplyKeyboard(userId));
      break;
  }
});


// === Функция для ежедневной рассылки всем пользователям (использует захардкоженный текст) ===
async function sendDailyBroadcast() {
    console.log('Запуск ежедневной текстовой рассылки всем пользователям...');
    try {
        const textToSend = '💫 Вдохновляющее послание дня уже ждет вас — откройте его сегодня'; // <-- Используем захардкоженный текст напрямую

        const allUsersSnapshot = await usersCollection.get();
        if (allUsersSnapshot.empty) {
            console.log('Нет пользователей для рассылки.');
            return;
        }

        let sentCount = 0;
        let failedCount = 0;

        for (const doc of allUsersSnapshot.docs) {
            const userId = doc.id;
            try {
                // Отправляем ТЕКСТ и клавиатуру
                await bot.telegram.sendMessage(userId, textToSend, {
                    reply_markup: getReplyKeyboard(Number(userId)).reply_markup
                });
                sentCount++;
                await new Promise(resolve => setTimeout(resolve, 50));
            } catch (error) {
                failedCount++;
                console.error(`Не удалось отправить сообщение пользователю ${userId}:`, error.message);
                if (error.code === 403) {
                    console.log(`Пользователь ${userId} заблокировал бота, удаляем из списка.`);
                    await usersCollection.doc(userId).delete();
                }
            }
        }
        console.log(`Ежедневная текстовая рассылка завершена. Отправлено: ${sentCount}, Ошибок: ${failedCount}.`);

    } catch (error) {
        console.error('Критическая ошибка при выполнении ежедневной рассылки:', error);
    }
}

// === Запуск ===
if (WEBHOOK_URL) {
    const app = express();
    app.use(express.json());

    // Уникальный путь для вебхука на основе токена
    const WEBHOOK_SECRET_PATH = `/webhook/${BOT_TOKEN}`; // Теперь BOT_TOKEN используется полностью

    app.use(bot.webhookCallback(WEBHOOK_SECRET_PATH));

    bot.telegram.setWebhook(`${WEBHOOK_URL}${WEBHOOK_SECRET_PATH}`)
        .then(() => {
            return bot.telegram.getMe();
        })
        .then((me) => {
            console.log(`🤖 Бот @${me.username} запущен через вебхуки на порту ${PORT}`);
            console.log(`🌐 Webhook URL для Telegram: ${WEBHOOK_URL}${WEBHOOK_SECRET_PATH}`);

            // Планирование рассылки
            cron.schedule('10 10 * * *', () => { // Каждый день в 10:00 (по времени сервера)
                sendDailyBroadcast();
            }, {
                timezone: "Europe/Moscow" // <-- Обязательно измените на ваш часовой пояс!
            });
            console.log('✅ Ежедневная рассылка запланирована на 10:10.');
        })
        .catch((err) => {
            console.error('❌ Ошибка при запуске бота через вебхуки или установке вебхука:', err);
            console.error('Возможные причины: неверный BOT_TOKEN, WEBHOOK_URL недоступен/неправильный, проблемы с интернетом.');
            process.exit(1);
        });

    app.listen(PORT, () => {});

} else {
    bot.launch()
        .then(() => {
            return bot.telegram.getMe();
        })
        .then((me) => {
            console.log(`🤖 Бот @${me.username} запущен через Long Polling.`);
        })
        .catch((err) => {
            console.error('❌ Ошибка при запуске бота через Long Polling:', err);
            console.error('Возможные причины: неверный BOT_TOKEN, проблемы с интернетом.');
            process.exit(1);
        });
}

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));