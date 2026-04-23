'use strict';

// ╔══════════════════════════════════════════════════════════════════════╗
// ║              💨 KANZANBOT v2 — MAIN / CONEXIÓN 💨                   ║
// ╚══════════════════════════════════════════════════════════════════════╝

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  jidNormalizedUser,
} = require('@whiskeysockets/baileys');

const { Boom }   = require('@hapi/boom');
const pino       = require('pino');
const chalk      = require('chalk');
const qrcode     = require('qrcode-terminal');
const path       = require('path');
const fs         = require('fs');

const config              = require('./config');
const db                  = require('./lib/database');
const { messageHandler }  = require('./handler');
const { setStore, sleep } = require('./lib/utils');
const { logMessage, logOutgoing } = require('./lib/logger');

const { handleWelcome }                                     = require('./plugins/welcome');
const { handleGroupParticipantsUpdate, handleGroupsUpdate } = require('./plugins/events');

// ── Store en memoria ──────────────────────────────────────────────────
const store = { contacts: {}, messages: {} };

const SESSION_DIR = path.resolve(process.cwd(), config.sessionPath);
if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });

// ── Guardas para evitar doble-init ────────────────────────────────────
let dbInitialized      = false;
let processHooked      = false;
let isReconnecting     = false;   // previene bucle de reconexiones simultáneas

// ══════════════════════════════════════════════════════════════════════
//   INICIO DEL BOT
//   opts: { method: 'qr' | 'code' | 'saved', phone: string | null }
// ══════════════════════════════════════════════════════════════════════

async function startBot(opts = {}) {
  // Evitar reconexiones simultáneas
  if (isReconnecting) return;
  isReconnecting = true;

  const useCode  = opts.method === 'code';
  const phoneNum = opts.phone  || null;

  // Inicializar DB solo una vez
  if (!dbInitialized) {
    await db.init();
    dbInitialized = true;
  }

  // Registrar handlers de proceso solo una vez
  if (!processHooked) {
    process.on('uncaughtException',  err => console.error(chalk.red('[ERROR]'),  err.message));
    process.on('unhandledRejection', err => console.error(chalk.red('[REJECT]'), String(err)));
    processHooked = true;
  }

  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
  const { version, isLatest } = await fetchLatestBaileysVersion();
  console.log(chalk.gray(
    `  [MAIN] WA Web v${version.join('.')}${isLatest ? '' : ' ⚠️ hay actualización'}`
  ));

  const sock = makeWASocket({
    version,
    logger                        : pino({ level: 'silent' }),
    browser                       : useCode
      ? ['Ubuntu', 'Chrome', '20.0.04']
      : ['KanzanBot', 'Safari', '2.0.0'],
    auth: {
      creds: state.creds,
      keys : makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
    },
    generateHighQualityLinkPreview: true,
    syncFullHistory               : false,
    markOnlineOnConnect           : false,
    connectTimeoutMs              : 60_000,
    keepAliveIntervalMs           : 55_000,
    defaultQueryTimeoutMs         : undefined,
    getMessage                    : async () => ({ conversation: '' }),
  });

  // ── Código de emparejamiento ──────────────────────────────────────
  if (useCode && phoneNum && !state.creds?.registered) {
    setTimeout(async () => {
      try {
        const rawCode   = await sock.requestPairingCode(phoneNum);
        const codeStr   = String(rawCode ?? '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
        const formatted = codeStr.length >= 8
          ? codeStr.slice(0, 4) + ' ' + codeStr.slice(4, 8)
          : codeStr || '???? ????';

        console.log(chalk.hex('#FFB7C5')('\n  ┌──────────────────────────────────────┐'));
        console.log(chalk.hex('#FFB7C5')('  │       💨 Código de Emparejamiento      │'));
        console.log(chalk.hex('#FFB7C5')('  └──────────────────────────────────────┘\n'));
        console.log(chalk.white('  Ingresa este código en WhatsApp:\n'));
        console.log(chalk.bgHex('#FFB7C5').black.bold(`         ${formatted}         `));
        console.log(chalk.gray('\n  Ruta: WhatsApp → 3 puntos → Dispositivos vinculados'));
        console.log(chalk.gray('         → Vincular con número de teléfono\n'));
        console.log(chalk.yellow('  ⏳ El código expira en 60 segundos\n'));
      } catch (err) {
        console.error(chalk.red('  [MAIN] Error al obtener código:'), err.message);
      }
    }, 3000);
  }

  setStore(store);

  // ── Parchear sock.sendMessage para loggear salientes ─────────────
  const _originalSend = sock.sendMessage.bind(sock);
  sock.sendMessage = async (jid, content, opts) => {
    if (!content?.react && !content?.delete && jid !== 'status@broadcast') {
      try { logOutgoing(jid, content, store, false); } catch {}
    }
    return _originalSend(jid, content, opts);
  };

  // ── Store de contactos ────────────────────────────────────────────
  sock.ev.on('contacts.upsert', contacts => {
    for (const c of contacts) {
      if (c.id) store.contacts[c.id] = c;
    }
  });
  sock.ev.on('contacts.update', updates => {
    for (const c of updates) {
      if (c.id) store.contacts[c.id] = { ...(store.contacts[c.id] || {}), ...c };
    }
  });

  // ── Conexión ──────────────────────────────────────────────────────
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr && !useCode) {
      console.log(chalk.hex('#FFB7C5')('\n  💨 Escanea el QR con WhatsApp:\n'));
      qrcode.generate(qr, { small: true });
      console.log(chalk.gray('  Ruta: WhatsApp → Dispositivos vinculados → Vincular dispositivo\n'));
    }

    if (connection === 'close') {
      const errOutput  = lastDisconnect?.error instanceof Boom
        ? lastDisconnect.error.output
        : null;
      const statusCode = errOutput?.statusCode ?? 0;

      console.log(chalk.yellow(`  [MAIN] Conexión cerrada. Código: ${statusCode}`));

      const shouldReconnect =
        statusCode !== DisconnectReason.loggedOut &&
        statusCode !== DisconnectReason.banned    &&
        config.autoReconnect;

      isReconnecting = false;  // liberar guarda para permitir siguiente intento

      if (shouldReconnect) {
        console.log(chalk.cyan(`  [MAIN] Reconectando en ${config.reconnectDelay / 1000}s...`));
        setTimeout(() => startBot({ method: 'saved', phone: null }), config.reconnectDelay);
      } else {
        console.log(chalk.red('  [MAIN] Sesión cerrada permanentemente. Borra /session y reinicia.'));
        process.exit(0);
      }
    }

    if (connection === 'open') {
      isReconnecting = false;  // conexión exitosa, liberar guarda
      const num    = jidNormalizedUser(sock.user.id).split('@')[0];
      const botNum = num.split(':')[0];
      console.log(chalk.green('\n  ✅ ¡Conexión exitosa!'));
      console.log(chalk.hex('#FFB7C5')(`  💨 ${config.botName} → +${botNum}\n`));

      if (!config.owner.includes(botNum)) {
        config.owner.push(botNum);
        console.log(chalk.gray(`  [INFO] +${botNum} agregado como owner automáticamente.`));
      }
    }
  });

  sock.ev.on('creds.update', saveCreds);

  // ── Mensajes ──────────────────────────────────────────────────────
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      if (!msg.message) continue;
      if (msg.key.remoteJid === 'status@broadcast') continue;

      if (msg.key.fromMe) {
        const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
        if (text) try { logOutgoing(msg.key.remoteJid, { text }, store, true); } catch {}
        continue;
      }

      try { logMessage(msg, store, sock); } catch {}
      try { await messageHandler(sock, msg, store); }
      catch (err) { console.error(chalk.red('  [MAIN] Error:'), err.message); }
    }
  });

  // ── Participantes de grupo ────────────────────────────────────────
  sock.ev.on('group-participants.update', async (update) => {
    try {
      await handleWelcome(sock, update, store);
      await handleGroupParticipantsUpdate(sock, update, store);
    } catch (err) {
      console.error(chalk.red('  [MAIN] group-participants:'), err.message);
    }
  });

  // ── Actualizaciones de grupo ──────────────────────────────────────
  sock.ev.on('groups.update', async (updates) => {
    try { await handleGroupsUpdate(sock, updates, store); }
    catch (err) { console.error(chalk.red('  [MAIN] groups.update:'), err.message); }
  });

  // ── Ver estados ───────────────────────────────────────────────────
  if (config.readStatus) {
    sock.ev.on('messages.upsert', async ({ messages }) => {
      for (const msg of messages) {
        if (msg.key.remoteJid === 'status@broadcast')
          await sock.readMessages([msg.key]).catch(() => {});
      }
    });
  }

  return sock;
}

module.exports = { startBot };