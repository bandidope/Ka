'use strict';

// ╔══════════════════════════════════════════════════════════════════════╗
// ║           💨 𝘎𝘦𝘯𝘨𝘢𝘳 𝘉𝘰𝘵 v2 — PLUGIN: OWNER COMMANDS 💨               ║
// ╚══════════════════════════════════════════════════════════════════════╝

// reloadPlugins se requiere de forma lazy (dentro del comando) para evitar
// la dependencia circular handler → plugins → handler que genera el warning
const { formatUptime } = require('../lib/utils');

module.exports = {
  commands    : ['addpremium','delpremium','ban','unban','reload','botinfo','addowner','delowner','addmod','delmod'],
  description : 'Comandos de administración del Bot (solo owner)',
  category    : 'owner',

  async execute(ctx) {
    const { command, args, sock, remoteJid, msg, db, config, reply, isOwner, isRowner, tr } = ctx;

    // ── !botinfo ──────────────────────────────────────────────────
    if (command === 'botinfo') {
      const stats  = await db.getStats();
      const up     = formatUptime(process.uptime() * 1000);
      const mem    = (process.memoryUsage().rss / 1024 / 1024).toFixed(1);
      const mode   = db.isMongoMode() ? '☁️ MongoDB Atlas' : '📁 JSON Local';
      const { getActiveSubsList } = require('./serbot');
      const activeSubs = getActiveSubsList().length;

      return reply(
        `╔══════════════════════════════╗\n` +
        `║  *💨 ${config.botName}*\n` +
        `║  *v${config.botVersion}*\n` +
        `╚══════════════════════════════╝\n\n` +
        `*[📊] Estadísticas*\n` +
        `├ 👥 Grupos   : ${stats.groups}\n` +
        `├ 👤 Usuarios : ${stats.users}\n` +
        `├ 👑 Premium  : ${stats.premium}\n` +
        `└ 🤖 Sub-Bots : ${activeSubs} activos\n\n` +
        `*[⚙️] Sistema*\n` +
        `├ ⏱️ Uptime    : ${up}\n` +
        `├ 🧠 RAM       : ${mem} MB\n` +
        `├ 🗄️ Base datos: ${mode}\n` +
        `└ 🔒 Restrict  : ${config.restrictMode ? 'Activado' : 'Desactivado'}\n\n` +
        `*[🔑] Prefijos:* ${(Array.isArray(config.prefix) ? config.prefix : [config.prefix]).join('  ')}`
      );
    }

    // Los demás comandos requieren owner
    if (!isOwner) return reply(tr('prefix_owner_only'));

    const getTarget = () => {
      const m = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid;
      if (m?.[0]) return m[0];
      const num = args[0]?.replace(/[^0-9]/g, '');
      return num?.length >= 7 ? `${num}@s.whatsapp.net` : null;
    };

    // ── !addpremium ───────────────────────────────────────────────
    if (command === 'addpremium') {
      const target = getTarget();
      if (!target) return reply('*[❗]* Menciona al usuario o escribe su número.\nEj: `!addpremium @usuario 30`');
      const days = parseInt(args[1] || args[0]) || null;
      await db.addPremium(target, days);
      const num = target.split('@')[0];
      return sock.sendMessage(remoteJid, {
        text: `*[✅] Premium asignado*\n\n👤 Usuario: @${num}\n⏳ Duración: ${days ? `${days} días` : 'Sin expiración ♾️'}`,
        mentions: [target],
      }, { quoted: msg });
    }

    // ── !delpremium ───────────────────────────────────────────────
    if (command === 'delpremium') {
      const target = getTarget();
      if (!target) return reply('*[❗]* Menciona al usuario.');
      await db.removePremium(target);
      const num = target.split('@')[0];
      return sock.sendMessage(remoteJid, {
        text: `*[❌] Premium removido a @${num}.*`,
        mentions: [target],
      }, { quoted: msg });
    }

    // ── !ban ──────────────────────────────────────────────────────
    if (command === 'ban') {
      const target = getTarget();
      if (!target) return reply('*[❗]* Menciona al usuario a banear.');
      const num = target.split('@')[0];
      if (config.rowner.includes(num)) return reply('*[🚫]* No puedes banear al *rowner*.');
      const reason = args.slice(1).join(' ') || 'Sin razón';
      await db.banUser(target, reason);
      return sock.sendMessage(remoteJid, {
        text: `*[🔨] Usuario baneado*\n\n👤 @${num}\n📋 Razón: ${reason}`,
        mentions: [target],
      }, { quoted: msg });
    }

    // ── !unban ────────────────────────────────────────────────────
    if (command === 'unban') {
      const target = getTarget();
      if (!target) return reply('*[❗]* Menciona al usuario a desbanear.');
      await db.unbanUser(target);
      const num = target.split('@')[0];
      return sock.sendMessage(remoteJid, {
        text: `*[✅] @${num} ha sido *desbaneado*.`,
        mentions: [target],
      }, { quoted: msg });
    }

    // ── !reload ───────────────────────────────────────────────────
    if (command === 'reload') {
      try {
        // Lazy require para evitar dependencia circular
        const { reloadPlugins } = require('../handler');
        reloadPlugins();
        return reply('*[♻️] Plugins recargados correctamente.*');
      } catch (e) {
        return reply(`*[❌] Error al recargar:* ${e.message}`);
      }
    }

    // ── !addowner / !delowner ─────────────────────────────────────
    if (['addowner','delowner'].includes(command)) {
      if (!isRowner) return reply(tr('prefix_owner_only'));
      const target = getTarget();
      if (!target) return reply('*[❗]* Menciona al usuario.');
      const num = target.split('@')[0];
      if (command === 'addowner') {
        if (!config.owner.includes(num)) config.owner.push(num);
        return sock.sendMessage(remoteJid, { text: `*[✅] @${num} añadido como *owner*.`, mentions:[target] }, { quoted: msg });
      } else {
        config.owner = config.owner.filter(n => n !== num);
        return sock.sendMessage(remoteJid, { text: `*[❌] @${num} removido de *owner*.`, mentions:[target] }, { quoted: msg });
      }
    }

    // ── !addmod / !delmod ─────────────────────────────────────────
    if (['addmod','delmod'].includes(command)) {
      const target = getTarget();
      if (!target) return reply('*[❗]* Menciona al usuario.');
      const num = target.split('@')[0];
      if (command === 'addmod') {
        if (!config.mods.includes(num)) config.mods.push(num);
        return sock.sendMessage(remoteJid, { text: `*[✅] @${num} añadido como *mod*.`, mentions:[target] }, { quoted: msg });
      } else {
        config.mods = config.mods.filter(n => n !== num);
        return sock.sendMessage(remoteJid, { text: `*[❌] @${num} removido de *mod*.`, mentions:[target] }, { quoted: msg });
      }
    }
  },
};