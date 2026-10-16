const AID_TOKEN = process.env.AID_TOKEN;
const TG_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const ITERATIONS = Number(process.env.ITERATIONS || 12); // 12 проверок с шагом 5 минут = 1 час смены
const INTERVAL_MS = Number(process.env.INTERVAL_MS || 5 * 60 * 1000); // 5 минут

if (!AID_TOKEN) {
  console.error('❌ Ошибка: AID_TOKEN не задан в секретах репозитория.');
  process.exit(1);
}

async function sendTelegram(text) {
  if (!TG_BOT_TOKEN || !TG_CHAT_ID) {
    console.log('ℹ️ Telegram уведомления отключены (не задан токен или chat_id).');
    return;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TG_CHAT_ID,
        text,
        parse_mode: 'Markdown',
      }),
    });
    if (!res.ok) {
      console.warn('⚠️ Ошибка отправки в TG:', await res.text());
    }
  } catch (e) {
    console.error('⚠️ Ошибка сети при отправке в TG:', e.message);
  }
}

async function checkOnce() {
  const headers = {
    'Authorization': `Bearer ${AID_TOKEN}`,
    'Accept': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  };

  console.log('🔍 Запрос списка VPN-ключей...');
  const keysRes = await fetch('https://aidapp.gg/app/api/vpn-keys', { headers });
  if (!keysRes.ok) {
    throw new Error(`Ошибка загрузки ключей: HTTP ${keysRes.status}`);
  }
  const keysData = await keysRes.json();
  if (!keysData.success || !Array.isArray(keysData.data)) {
    throw new Error('Некорректный ответ от API: ' + JSON.stringify(keysData));
  }

  console.log(`🔑 Найдено ключей: ${keysData.data.length}`);

  for (const key of keysData.data) {
    const keyName = key.cstname || `#${key.name || key.id}`;
    console.log(`📱 Проверка ключа ${keyName} (ID: ${key.id})...`);

    const devRes = await fetch(`https://aidapp.gg/app/api/vpn-keys/v2/hwid-devices?key_id=${key.id}`, { headers });
    if (!devRes.ok) {
      console.warn(`⚠️ Не удалось получить устройства для ключа ${keyName}: HTTP ${devRes.status}`);
      continue;
    }

    const devData = await devRes.json();
    const count = devData?.data?.devices?.length || 0;
    console.log(`   Подключено устройств: ${count}`);

    if (count >= 3) {
      console.log(`⚠️ Найдено ${count} устройств (>= 3). Запуск сброса...`);

      const clearRes = await fetch('https://aidapp.gg/app/api/vpn-keys/v2/hwid-clear', {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ key_id: key.id }),
      });

      const clearData = await clearRes.json();
      if (clearData.success) {
        console.log(`✅ Привязки для ключа ${keyName} успешно сброшены!`);
        const alertMsg =
          `🤖 *[Автопилот 24/7]*\n\n` +
          `⚠️ На ключе \`${keyName}\` было подключено *${count}* устройств (достигнут лимит).\n` +
          `✅ *Все привязки успешно сброшены!* Теперь можно подключать новые устройства.`;
        await sendTelegram(alertMsg);
      } else {
        console.error(`❌ Ошибка сброса: ${clearData.errorMessage || JSON.stringify(clearData)}`);
      }
    } else {
      console.log(`✅ Лимит не превышен (${count}/3). Сброс не требуется.`);
    }
  }
}

async function runLoop() {
  for (let i = 1; i <= ITERATIONS; i++) {
    const now = new Date().toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow' });
    console.log(`\n⏱ [${now} МСК] Проверка ${i}/${ITERATIONS}...`);
    try {
      await checkOnce();
    } catch (err) {
      console.error(`⚠️ Ошибка при проверке ${i}/${ITERATIONS}:`, err.message);
    }

    if (i < ITERATIONS) {
      console.log(`⏳ Ожидание 5 минут до следующей проверки...`);
      await new Promise((r) => setTimeout(r, INTERVAL_MS));
    }
  }
  console.log('\n🔄 Смена завершена, передаю эстафету следующему запуску...');
}

runLoop().catch((err) => {
  console.error('❌ Критическая ошибка:', err.message);
  process.exit(1);
});
