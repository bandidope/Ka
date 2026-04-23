'use strict';

// ╔══════════════════════════════════════════════════════════════════════╗
// ║            💨 𝘎𝘦𝘯𝘨𝘢𝘳 𝘉𝘰𝘵 v2 — PLUGIN: SERBOT / JADIBOT 💨            ║
// ║  Sistema completo de Sub-Bots                                        ║
// ╚══════════════════════════════════════════════════════════════════════╝

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');

const { Boom }  = require('@hapi/boom');
const pino      = require('pino');
const qrcode    = require('qrcode');
const fs        = require('fs');
const path      = require('path');
const chalk     = require('chalk');
const config    = require('../config');
const { formatUptime, sleep } = require('../lib/utils');
const { t }     = require('../lib/i18n');

// ── Almacenamiento en memoria ──────────────────────────────────────────
const activeSubs = new Map();

const SUBBOTS_DIR = path.resolve(process.cwd(), config.subbotDir || './subbots');
if (!fs.existsSync(SUBBOTS_DIR)) fs.mkdirSync(SUBBOTS_DIR, { recursive: true });

// ══════════════════════════════════════════════════════════════════════
//   HELPERS
// ══════════════════════════════════════════════════════════════════════

function subDir(phone) {
  const d = path.join(SUBBOTS_DIR, phone);
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  return d;
}
function subConfigPath(phone) { return path.join(subDir(phone), 'subconfig.json'); }
function getSubConfig(phone) {
  const p = subConfigPath(phone);
  if (!fs.existsSync(p)) return {};
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return {}; }
}
function saveSubConfig(phone, data) {
  fs.writeFileSync(subConfigPath(phone), JSON.stringify(data, null, 2));
}
function removeSubDir(phone) {
  const d = path.join(SUBBOTS_DIR, phone);
  if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
}

// ══════════════════════════════════════════════════════════════════════
//   INICIO / CONEXIÓN DEL SUB-BOT
// ══════════════════════════════════════════════════════════════════════

async function startSubbot(parentSock, chatJid, quotedMsg, phone, opts = {}) {
  const db        = require('../lib/database');
  const lang      = opts.lang    || 'es';
  const botName   = opts.botName || 'KanzanSubBot 💨';
  const ownerId   = opts.ownerId || '';
  const useCode   = opts.useCode || false;
  const MAX_RECONNECTS = 3;

  saveSubConfig(phone, { name: botName, ownerId, phone, createdAt: Date.now() });

  const sessionDir = path.join(subDir(phone), 'session');
  if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  const { version } = await fetchLatestBaileysVersion();

  const connOpts = {
    version,
    auth                  : state,
    logger                : pino({ level: 'silent' }),
    printQRInTerminal     : false,
    browser               : ['𝘎𝘦𝘯𝘨𝘢𝘳 𝘉𝘰𝘵 Sub', 'Chrome', '121.0.0'],
    connectTimeoutMs      : 60_000,
    keepAliveIntervalMs   : 25_000,
    defaultQueryTimeoutMs : undefined,
    getMessage            : async () => ({ conversation: '' }),
  };

  let conn = makeWASocket(connOpts);
  conn.isInit = false;
  conn.fstop  = false;

  activeSubs.set(phone, { conn, connectedAt: null, reconnects: 0, name: botName, ownerId });

  // ── Código de emparejamiento ────────────────────────────────────
  if (useCode && !conn.authState.creds.registered) {
    try {
      await sleep(2000);
      const rawCode = await conn.requestPairingCode(phone);
      // Convertir a string explícitamente — Baileys puede devolver distintos tipos
      const codeStr = String(rawCode ?? '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
      const formatted = codeStr.length >= 8
        ? codeStr.slice(0, 4) + ' ' + codeStr.slice(4, 8)
        : codeStr || '???? ????';

      const pairingText = await t('serbot_pairing', lang);
      await parentSock.sendMessage(chatJid, {
        text:
          `${pairingText}\n\n` +
          `┌──────────────────────┐\n` +
          `│   *${formatted.padEnd(9)}*    │\n` +
          `└──────────────────────┘\n\n` +
          `_🤖 Sub-Bot: ${botName}_`,
      }, { quoted: quotedMsg });
    } catch (err) {
      await parentSock.sendMessage(chatJid, {
        text: `*[❌] Error obteniendo código:* ${err.message}`,
      }, { quoted: quotedMsg });
    }
  }

  // ── Handler de conexión ─────────────────────────────────────────
  let reconnecting = false;

  async function onConnectionUpdate(update) {
    const { connection, lastDisconnect, qr } = update;

    if (qr && !useCode) {
      try {
        const qrBuffer   = await qrcode.toBuffer(qr, { scale: 8 });
        const scanningTx = await t('serbot_scanning', lang);
        await parentSock.sendMessage(chatJid, {
          image  : qrBuffer,
          caption: `${scanningTx}\n\n_🤖 Sub-Bot: *${botName}*_`,
        }, { quoted: quotedMsg });
      } catch {}
    }

    if (connection === 'open') {
      const subPhone = conn.user.id.split('@')[0].split(':')[0];
      const sub = activeSubs.get(phone) || {};
      sub.connectedAt = Date.now();
      sub.reconnects  = 0;
      activeSubs.set(phone, { ...sub, conn });

      await db.setSubbot(phone, {
        ownerId, name: botName,
        status: 'active', connectedAt: sub.connectedAt, reconnects: 0,
      }).catch(() => {});

      console.log(chalk.green(`  [SERBOT] ✅ Sub-Bot conectado: +${subPhone} (${botName})`));

      const connectedTx = await t('serbot_connected', lang, {
        name: botName,
        num : subPhone,
        time: new Date().toLocaleString('es-MX'),
      });
      await parentSock.sendMessage(chatJid, { text: connectedTx }, { quoted: quotedMsg });
    }

    if (connection === 'close') {
      const errCode = lastDisconnect?.error instanceof Boom
        ? lastDisconnect.error.output.statusCode : 0;

      const sub = activeSubs.get(phone) || {};

      // Detenido manualmente
      if (conn.fstop) {
        await db.setSubbot(phone, { status: 'stopped' }).catch(() => {});
        activeSubs.delete(phone);
        const stoppedTx = await t('serbot_stopped', lang, { num: phone });
        await parentSock.sendMessage(chatJid, { text: stoppedTx }, { quoted: quotedMsg }).catch(() => {});
        return;
      }

      // Sesión inválida
      if (errCode === DisconnectReason.loggedOut || errCode === DisconnectReason.badSession) {
        removeSubDir(phone);
        await db.deleteSubbot(phone).catch(() => {});
        activeSubs.delete(phone);
        await parentSock.sendMessage(chatJid, {
          text: `*[❌] La sesión del Sub-Bot *${botName}* fue cerrada o es inválida.*\n_Usa_ \`!serbot ${phone}\` _para reconectar._`,
        }, { quoted: quotedMsg }).catch(() => {});
        return;
      }

      // Auto-reconexión
      const currentReconnects = (sub.reconnects || 0) + 1;

      if (currentReconnects > MAX_RECONNECTS) {
        activeSubs.delete(phone);
        await db.setSubbot(phone, { status: 'stopped', reconnects: currentReconnects }).catch(() => {});
        const maxTx = await t('serbot_max_reconnects', lang, { num: phone });
        await parentSock.sendMessage(chatJid, { text: maxTx }, { quoted: quotedMsg }).catch(() => {});
        return;
      }

      activeSubs.set(phone, { ...sub, reconnects: currentReconnects });
      const reconnTx = await t('serbot_reconnecting', lang, { n: currentReconnects });
      await parentSock.sendMessage(chatJid, { text: reconnTx }, { quoted: quotedMsg }).catch(() => {});

      await sleep(4000);
      if (!reconnecting) {
        reconnecting = true;
        try {
          conn.ev.removeAllListeners();
          conn = makeWASocket(connOpts);
          conn.fstop = false;
          conn.ev.on('connection.update', onConnectionUpdate);
          conn.ev.on('creds.update', saveCreds);
          const s = activeSubs.get(phone) || {};
          activeSubs.set(phone, { ...s, conn });
        } catch (err) {
          console.error('[SERBOT] Error reconectando:', err.message);
        }
        reconnecting = false;
      }
    }
  }

  conn.ev.on('connection.update', onConnectionUpdate);
  conn.ev.on('creds.update', saveCreds);

  if (state.creds?.registered) {
    await parentSock.sendMessage(chatJid, {
      text: `*[🔄] Reconectando Sub-Bot *${botName}*...*`,
    }, { quoted: quotedMsg }).catch(() => {});
  }
}

// ══════════════════════════════════════════════════════════════════════
//   DETENER / ELIMINAR
// ══════════════════════════════════════════════════════════════════════

async function stopSubbot(phone) {
  const sub = activeSubs.get(phone);
  if (!sub) return false;
  sub.conn.fstop = true;
  try { sub.conn.ws.close(); } catch {}
  sub.conn.ev.removeAllListeners();
  activeSubs.delete(phone);
  return true;
}

async function deleteSubbot(phone) {
  await stopSubbot(phone).catch(() => {});
  removeSubDir(phone);
  await require('../lib/database').deleteSubbot(phone).catch(() => {});
}

function getActiveSubsList() {
  const list = [];
  for (const [phone, sub] of activeSubs.entries()) {
    list.push({
      phone,
      name       : sub.name || 'SubBot',
      uptime     : sub.connectedAt ? formatUptime(Date.now() - sub.connectedAt) : 'Conectando...',
      connectedAt: sub.connectedAt,
      ownerId    : sub.ownerId,
    });
  }
  return list;
}

// ══════════════════════════════════════════════════════════════════════
//   COMANDOS DEL PLUGIN
// ══════════════════════════════════════════════════════════════════════

module.exports = {
  startSubbot, stopSubbot, deleteSubbot, getActiveSubsList, activeSubs,

  commands    : ['serbot', 'jadibot', 'subbot'],
  description : 'Crea y gestiona Sub-Bots secundarios',
  category    : 'serbot',
  tags        : ['serbot'],

  async execute(ctx) {
    const { sock, msg, remoteJid, args, sender, isOwner, db, reply, tr, lang } = ctx;

    const sub = args[0]?.toLowerCase();

    // ── Sin argumentos → crear sub-bot con el número del remitente ──
    // (Distinto de 'list' que muestra los activos)
    if (!sub) {
      // Saltar directo a la lógica de creación
      const targetPhone = getTargetPhone(ctx, [], true);
      if (!targetPhone) return reply('*[❗] No se pudo obtener tu número. Intenta con* `!serbot tu_numero`');

      if (!isOwner) {
        const owned = [...activeSubs.values()].filter(s => s.ownerId === sender);
        if (owned.length >= (config.maxSubbots || 3)) {
          return reply(`*[❌] Límite alcanzado: *${config.maxSubbots}* sub-bots.*\nElimina uno con \`!serbot delete\` antes de crear otro.`);
        }
      }

      if (activeSubs.has(targetPhone)) { await stopSubbot(targetPhone); await sleep(1500); }

      await startSubbot(sock, remoteJid, msg, targetPhone, {
        useCode: false, botName: 'KanzanSubBot 💨', ownerId: sender, lang,
      });
      return;
    }

    // ── list ─────────────────────────────────────────────────────
    if (sub === 'list' || sub === 'lista') {
      const list = getActiveSubsList();
      if (!list.length) return reply(tr('serbot_list_empty'));

      let text =
        `╔═══════════════════════════╗\n` +
        `║  *💨 Sub-Bots Activos*    ║\n` +
        `╚═══════════════════════════╝\n\n`;

      list.forEach((s, i) => {
        text +=
          `*[${i + 1}]* 🤖 *${s.name}*\n` +
          `  📱 Número : +${s.phone}\n` +
          `  ⏱️ Activo  : ${s.uptime}\n` +
          `  🏷️ Mención : @${s.phone}\n\n`;
      });
      text += `_Total: ${list.length} sub-bot(s)_`;

      return sock.sendMessage(remoteJid, {
        text,
        mentions: list.map(s => `${s.phone}@s.whatsapp.net`),
      }, { quoted: msg });
    }

    // ── stop ──────────────────────────────────────────────────────
    if (sub === 'stop' || sub === 'detener') {
      const target = getTargetPhone(ctx, args.slice(1), true);
      if (!target) return reply('*[❗] Indica el número a detener.*');
      const subData = activeSubs.get(target);
      if (!subData) return reply(`*[❌] No hay Sub-Bot activo con ese número.*`);
      if (!isOwner && subData.ownerId !== sender) return reply('*[🔒] Solo puedes detener tus propios sub-bots.*');
      const ok = await stopSubbot(target);
      return reply(ok ? tr('serbot_stopped', { num: target }) : `*[❌] No se encontró el Sub-Bot.*`);
    }

    // ── delete ────────────────────────────────────────────────────
    if (sub === 'delete' || sub === 'eliminar' || sub === 'borrar') {
      const target = getTargetPhone(ctx, args.slice(1), true);
      if (!target) return reply('*[❗] Indica el número a eliminar.*');
      const subData = activeSubs.get(target) || await db.getSubbot(target);
      if (subData && !isOwner && subData.ownerId !== sender) return reply('*[🔒] Solo puedes eliminar tus propios sub-bots.*');
      await deleteSubbot(target);
      return reply(tr('serbot_deleted'));
    }

    // ── start (reconectar) ────────────────────────────────────────
    if (sub === 'start' || sub === 'iniciar') {
      const target = getTargetPhone(ctx, args.slice(1), true);
      if (!target) return reply('*[❗] Indica el número a reconectar.*');
      const subCfg  = getSubConfig(target);
      const useCode = args.includes('--code');
      await startSubbot(sock, remoteJid, msg, target, {
        useCode, botName: subCfg.name || 'KanzanSubBot 💨', ownerId: sender, lang,
      });
      return;
    }

    // ── rename ────────────────────────────────────────────────────
    if (sub === 'rename' || sub === 'renombrar') {
      const target  = getTargetPhone(ctx, args.slice(1), true);
      const newName = args.slice(target ? 2 : 1).join(' ').trim();
      if (!target || !newName) return reply('*[❗] Uso:* `!serbot rename Nuevo Nombre`');
      saveSubConfig(target, { ...getSubConfig(target), name: newName });
      if (activeSubs.has(target)) activeSubs.set(target, { ...activeSubs.get(target), name: newName });
      return reply(`*[✅] Sub-Bot renombrado a:* *${newName}*`);
    }

    // ── --code → crear con código de emparejamiento ───────────────
    if (sub === '--code') {
      const targetPhone = getTargetPhone(ctx, args.slice(1), true);
      if (!targetPhone) return reply('*[❗] No se pudo obtener tu número.*');

      if (!isOwner) {
        const owned = [...activeSubs.values()].filter(s => s.ownerId === sender);
        if (owned.length >= (config.maxSubbots || 3)) {
          return reply(`*[❌] Límite de sub-bots alcanzado (${config.maxSubbots}).*`);
        }
      }
      if (activeSubs.has(targetPhone)) { await stopSubbot(targetPhone); await sleep(1500); }
      await startSubbot(sock, remoteJid, msg, targetPhone, {
        useCode: true, botName: 'KanzanSubBot 💨', ownerId: sender, lang,
      });
      return;
    }

    // ── Número explícito → crear para ese número ──────────────────
    const explicitPhone = getTargetPhone(ctx, args, false); // sin fallback
    if (explicitPhone) {
      if (!isOwner) {
        const owned = [...activeSubs.values()].filter(s => s.ownerId === sender);
        if (owned.length >= (config.maxSubbots || 3)) {
          return reply(`*[❌] Límite de sub-bots alcanzado (${config.maxSubbots}).*`);
        }
      }
      const useCode = args.includes('--code');
      const nameArg = args.find(a => a.startsWith('--name='));
      const botName = nameArg ? nameArg.replace('--name=', '') : 'KanzanSubBot 💨';
      if (activeSubs.has(explicitPhone)) { await stopSubbot(explicitPhone); await sleep(1500); }
      await startSubbot(sock, remoteJid, msg, explicitPhone, {
        useCode, botName, ownerId: sender, lang,
      });
      return;
    }

    // ── Comando no reconocido → mostrar ayuda ─────────────────────
    return reply(
      `*[🤖] Sistema de Sub-Bots — 𝘎𝘦𝘯𝘨𝘢𝘳 𝘉𝘰𝘵*\n\n` +
      `*Comandos:*\n` +
      `▸ \`!serbot\` — Crear con tu número (QR)\n` +
      `▸ \`!serbot --code\` — Crear con código de emparejamiento\n` +
      `▸ \`!serbot 521234567890\` — Crear para otro número\n` +
      `▸ \`!serbot list\` — Ver activos con uptime\n` +
      `▸ \`!serbot stop\` — Detener el tuyo\n` +
      `▸ \`!serbot delete\` — Eliminar completamente\n` +
      `▸ \`!serbot start\` — Reconectar uno detenido\n` +
      `▸ \`!serbot rename Nombre\` — Renombrar`
    );
  },
};

function getTargetPhone(ctx, args, fallbackToSender = false) {
  // 1. Mención @usuario
  const mentioned = ctx.msg.message?.extendedTextMessage?.contextInfo?.mentionedJid;
  if (mentioned?.[0]) {
    const jid = mentioned[0];
    if (jid.endsWith('@s.whatsapp.net')) return jid.split('@')[0].split(':')[0];
  }
  // 2. Número escrito en args
  const rawArg = args[0];
  if (rawArg) {
    const clean = rawArg.replace(/[^0-9]/g, '');
    if (clean.length >= 7) return clean;
  }
  // 3. Fallback al número de quien escribe el comando
  if (fallbackToSender && ctx.sender) {
    return ctx.sender.split('@')[0].split(':')[0];
  }
  return null;
}