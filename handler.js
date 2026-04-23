'use strict';

// ╔══════════════════════════════════════════════════════════════════════╗
// ║              💨 𝘎𝘦𝘯𝘨𝘢𝘳 𝘉𝘰𝘵 v2 — HANDLER / MANEJADOR 💨               ║
// ╚══════════════════════════════════════════════════════════════════════╝

const path    = require('path');
const fs      = require('fs');
const chalk   = require('chalk');
const config  = require('./config');
const db      = require('./lib/database');
const { t, getLang }  = require('./lib/i18n');
const {
  getBody, isGroup, getGroupAdmins, getBotJid, isBotAdmin,
  resolveLidSync, learnLidsFromParticipants, normalizeJid,
  detectPrefix,
} = require('./lib/utils');

// ══════════════════════════════════════════════════════════════════════
//   CARGA DE PLUGINS
// ══════════════════════════════════════════════════════════════════════

const PLUGINS_DIR = path.join(process.cwd(), 'plugins');
const plugins     = new Map();
const allPlugins  = new Set();

function loadPlugins() {
  if (!fs.existsSync(PLUGINS_DIR)) fs.mkdirSync(PLUGINS_DIR, { recursive: true });
  plugins.clear();
  allPlugins.clear();

  const files = fs.readdirSync(PLUGINS_DIR).filter(f => f.endsWith('.js') && !f.startsWith('_'));
  let loaded = 0;

  for (const file of files) {
    const filepath = path.join(PLUGINS_DIR, file);
    try {
      delete require.cache[require.resolve(filepath)];
      const plugin = require(filepath);
      allPlugins.add(plugin);
      const cmds = plugin.commands || (plugin.command ? [plugin.command] : []);
      for (const cmd of cmds.flat()) plugins.set(cmd.toLowerCase(), plugin);
      loaded++;
    } catch (e) {
      console.error(chalk.red(`  [HANDLER] Error cargando ${file}: ${e.message}`));
    }
  }

  console.log(chalk.gray(`  [HANDLER] ${loaded} plugins cargados, ${plugins.size} comandos registrados`));
  return plugins;
}

function reloadPlugins() { return loadPlugins(); }
function getPlugins()    { return allPlugins; }

loadPlugins();

// ══════════════════════════════════════════════════════════════════════
//   HELPER — Resolver texto que puede ser string o Promise<string>
//
//   Problema: t() es async → devuelve Promise<string>
//   Los plugins hacen reply(tr('key')) sin await
//   → Baileys recibe Promise como texto → crashea con .match error
//   Solución: reply() siempre resuelve el valor antes de enviarlo
// ══════════════════════════════════════════════════════════════════════

async function resolveText(value) {
  if (value instanceof Promise) return await value;
  return String(value ?? '');
}

// ══════════════════════════════════════════════════════════════════════
//   HANDLER PRINCIPAL
// ══════════════════════════════════════════════════════════════════════

async function messageHandler(sock, msg, store) {
  const { key, message, pushName } = msg;
  if (!message) return;

  const remoteJid = key.remoteJid;
  const fromGroup = isGroup(remoteJid);

  let sender = fromGroup ? key.participant : remoteJid;
  sender = normalizeJid(resolveLidSync(sender, store));

  const botJid = getBotJid(sock);
  if (sender === botJid || key.fromMe) return;

  if (await db.isBanned(sender)) return;

  const body = getBody(msg);
  if (!body) return;

  // ── Metadatos del grupo ──────────────────────────────────────────
  let groupMetadata = null;
  let groupAdmins   = [];
  let botIsAdmin    = false;

  if (fromGroup) {
    try {
      groupMetadata = await sock.groupMetadata(remoteJid);
      await learnLidsFromParticipants(groupMetadata.participants);
      groupAdmins = getGroupAdmins(groupMetadata.participants);
      botIsAdmin  = isBotAdmin(sock, groupAdmins);
    } catch {}
  }

  // ── Permisos ─────────────────────────────────────────────────────
  const senderNum = sender.split('@')[0];
  const isRowner  = config.rowner.includes(senderNum);
  const isOwner   = config.owner.includes(senderNum) || isRowner;
  const isMod     = config.mods.includes(senderNum)  || isOwner;
  const isAdmin   = groupAdmins.includes(sender)      || isOwner;
  const isPremium = (await db.isPremium(sender))      || isOwner;

  // ── Idioma ───────────────────────────────────────────────────────
  const lang = await getLang(db, sender, fromGroup ? remoteJid : null);

  // tr() — llama a t() con el idioma ya resuelto. Devuelve Promise<string>.
  // Los helpers reply/send lo resuelven automáticamente con resolveText().
  const tr = (key, vars = {}) => t(key, lang, vars);

  if (config.readMessages) await sock.readMessages([key]).catch(() => {});

  // ── Anti-link ────────────────────────────────────────────────────
  if (fromGroup) {
    const antilinkPlugin = [...plugins.values()].find(p => typeof p.checkAntilink === 'function');
    if (antilinkPlugin?.checkAntilink) {
      const stopped = await antilinkPlugin.checkAntilink(sock, msg, {
        sender, remoteJid, groupAdmins, botIsAdmin, isAdmin, isOwner, db, lang, tr,
      }).catch(() => false);
      if (stopped) return;
    }
  }

  // ── Detectar prefijo ─────────────────────────────────────────────
  const parsed = detectPrefix(body);
  if (!parsed) return;

  const args    = parsed.body.trim().split(/\s+/);
  const command = args.shift()?.toLowerCase();
  if (!command) return;

  const plugin = plugins.get(command);
  if (!plugin) return;

  // ── Restrict ─────────────────────────────────────────────────────
  if (plugin.restrict && config.restrictMode && !isRowner) {
    return sock.sendMessage(remoteJid,
      { text: await tr('prefix_restricted') }, { quoted: msg });
  }

  // ── Restricciones estándar ────────────────────────────────────────
  if (plugin.rownOnly    && !isRowner)  return sock.sendMessage(remoteJid, { text: await tr('prefix_owner_only')    }, { quoted: msg });
  if (plugin.ownerOnly   && !isOwner)   return sock.sendMessage(remoteJid, { text: await tr('prefix_owner_only')    }, { quoted: msg });
  if (plugin.groupOnly   && !fromGroup) return sock.sendMessage(remoteJid, { text: await tr('prefix_only_group')    }, { quoted: msg });
  if (plugin.privateOnly && fromGroup)  return sock.sendMessage(remoteJid, { text: await tr('prefix_only_private')  }, { quoted: msg });
  if (plugin.adminOnly   && !isAdmin)   return sock.sendMessage(remoteJid, { text: await tr('prefix_admin_only')    }, { quoted: msg });
  if (plugin.premiumOnly && !isPremium) return sock.sendMessage(remoteJid, { text: await tr('prefix_premium_only')  }, { quoted: msg });
  if (plugin.botAdmin    && !botIsAdmin)return sock.sendMessage(remoteJid, { text: await tr('prefix_bot_not_admin') }, { quoted: msg });

  // ── Contexto del plugin ──────────────────────────────────────────
  const usedPrefix = parsed.prefix;

  const ctx = {
    sock, msg, key, message, remoteJid,
    sender, fromGroup,
    pushName : pushName || senderNum,
    body     : parsed.body,
    args,
    command,
    store,
    usedPrefix,
    prefix   : usedPrefix || (Array.isArray(config.prefix) ? config.prefix[0] : config.prefix) || '!',
    groupMetadata, groupAdmins, botIsAdmin,
    isRowner, isOwner, isMod, isAdmin, isPremium,
    lang, tr,
    db, config,

    // ── Helpers — resuelven automáticamente Promises de tr() ──────
    reply: async (text, opts = {}) => {
      const resolved = await resolveText(text);
      return sock.sendMessage(remoteJid, { text: resolved }, { quoted: msg, ...opts });
    },
    react: (emoji) => sock.sendMessage(remoteJid, { react: { text: emoji, key: msg.key } }),
    send: async (content, opts = {}) => {
      if (content?.text instanceof Promise) content.text = await content.text;
      return sock.sendMessage(remoteJid, content, opts);
    },
    sendDM: (jid, content) => sock.sendMessage(jid, content),
  };

  // ── Ejecutar ─────────────────────────────────────────────────────
  try {
    await ctx.react('⏳');
    await plugin.execute(ctx);
  } catch (error) {
    console.error(chalk.red(`  [HANDLER] Error en ${command}:`), error.message);
    await ctx.react('❌').catch(() => {});
    const errMsg = await tr('error_generic', { msg: error.message });
    await sock.sendMessage(remoteJid, { text: errMsg }, { quoted: msg }).catch(() => {});
  }
}

module.exports = { messageHandler, loadPlugins, reloadPlugins, plugins, getPlugins };