import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import axios from 'axios';
import qrcode from 'qrcode-terminal';

let isRestarting = false;
let reconnectCount = 0;

async function startWhatsappListener() {
  const { state, saveCreds } = await useMultiFileAuthState('./whatsapp_auth');

  const { version, isLatest } = await fetchLatestBaileysVersion();

  process.on('uncaughtException', (err) => {
    console.error('❗ Uncaught Exception:', err);
  });

  process.on('unhandledRejection', (reason) => {
    console.error('❗ Unhandled Rejection:', reason);
  });
  console.log(`WhatsApp version: ${version.join('.')} latest=${isLatest}`);
  const sock = makeWASocket({
    auth: state,
    version,
    logger: pino({ level: 'silent' }),
    browser: ['Ubuntu', 'Chrome', '120.0.0'],
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { qr, connection, lastDisconnect } = update;

    if (sock.user) {
      console.log('🤖 واتساپ بات لاگین شد با شماره:', sock.user.id);
    }

    if (qr) {
      console.log('⬛ QR واتساپ آماده:');
      qrcode.generate(qr, { small: true }, (q) => console.log(q));
    }

    if (connection === 'close') {
      const reason =
        lastDisconnect?.error?.output?.statusCode ||
        lastDisconnect?.error?.code ||
        lastDisconnect?.error?.message ||
        'unknown';

      console.log('❗ اتصال بسته شد — دلیل:', reason);

      if (reason === 401 || reason === 'loggedOut') {
        console.log('⚠️ لاگ‌اوت شدی. auth رو پاک کن و دوباره QR بخون.');
        return;
      }

      if (!isRestarting) {
        isRestarting = true;
        reconnectCount++;
        const delay = Math.min(5000 * reconnectCount, 60000);
        console.log(
          `🔄 reconnect در ${delay / 1000} ثانیه (تلاش ${reconnectCount})...`,
        );
        setTimeout(() => {
          isRestarting = false;
          startWhatsappListener();
        }, delay);
      }
    }

    if (connection === 'open') {
      console.log('✅ واتساپ کانکت شد');
      reconnectCount = 0;
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || !msg.key.remoteJid) return;
    const API_URL = process.env.API_URL || 'http://localhost:5000';
    const sender = msg.key.remoteJid;
    const text =
      msg.message.conversation || msg.message.extendedTextMessage?.text || '';

    console.log('📩 پیام جدید دریافت شد:', sender, text);

    try {
      await axios.post(
        `${API_URL}/auth/register/whatsapp/webhook`,
        { sender, text },
        { timeout: 5000 },
      );
      console.log('✔ پیام ارسال شد به backend');
    } catch (err) {
      console.error(
        '❌ خطا در ارسال پیام:',
        err.message,
        err.response?.status,
        err.response?.data,
      );
    }
  });
}

startWhatsappListener();
