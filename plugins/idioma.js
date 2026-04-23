'use strict';

// ╔══════════════════════════════════════════════════════════════════════╗
// ║        💨 𝘎𝘦𝘯𝘨𝘢𝘳 𝘉𝘰𝘵 v2 — PLUGIN: IDIOMA (personal + grupo) 💨       ║
// ╚══════════════════════════════════════════════════════════════════════╝

const { SUPPORTED } = require('../lib/i18n');
const moment        = require('moment');

// ── Lista formateada de idiomas disponibles ───────────────────────────
function langList(prefix) {
  return (
    Object.entries(SUPPORTED)
      .map(([k, v]) => `  \`${k}\` — ${v}`)
      .join('\n') +
    `\n\n_Google Translate soporta más idiomas (ej: \`sw\`, \`tl\`, \`vi\`...)_\n` +
    `_Si no aparece en la lista, pruébalo igualmente con su código ISO._`
  );
}

module.exports = {
  commands: [
    // ── Personal ──────────────────────────────────────────────────
    'setlang', 'idioma', 'milang',
    'resetlang', 'resetidioma',
    // ── Grupo ─────────────────────────────────────────────────────
    'setidioma', 'setgrouplan', 'langgrupo', 'grupoidio',
    'resetidiomagc', 'resetlanggrupo',
    // ── Info ──────────────────────────────────────────────────────
    'perfil', 'profile',
    'registro', 'register', 'setnombre', 'setname',
  ],
  description : 'Gestiona idioma personal, idioma del grupo y perfil de usuario',
  category    : 'general',

  async execute(ctx) {
    const { command, args, sender, pushName, remoteJid, fromGroup, db, reply, tr, lang, prefix } = ctx;

    // ════════════════════════════════════════════════════════════════
    //   PERFIL
    // ════════════════════════════════════════════════════════════════
    if (['perfil', 'profile'].includes(command)) {
      const user    = await db.getUser(sender);
      const since   = user.createdAt
        ? moment(user.createdAt).locale('es').fromNow()
        : 'desconocido';
      const premium = await db.isPremium(sender);

      return reply(
        `*[👤] Perfil de Usuario*\n\n` +
        `🏷️ *Nombre:* ${user.name || pushName || 'Sin nombre'}\n` +
        `🌐 *Idioma personal:* ${SUPPORTED[user.lang] || user.lang || '_(hereda del grupo/bot)_'}\n` +
        `👑 *Premium:* ${premium ? '✅ Sí' : '❌ No'}\n` +
        `📅 *Miembro desde:* ${since}`
      );
    }

    // ── Registro de nombre ─────────────────────────────────────────
    if (['registro', 'register', 'setnombre', 'setname'].includes(command)) {
      const name = args.join(' ').trim();
      if (!name) {
        return reply(`*[❗] Indica tu nombre.*\nEj: \`${prefix}registro Juan Pérez\``);
      }
      if (name.length > 50) return reply('*[❌] El nombre no puede tener más de 50 caracteres.*');
      await db.setUser(sender, { name });
      return reply(await tr('profile_saved', { name }));
    }

    // ════════════════════════════════════════════════════════════════
    //   IDIOMA PERSONAL  (!setlang / !idioma / !milang)
    // ════════════════════════════════════════════════════════════════
    if (['setlang', 'idioma', 'milang'].includes(command)) {
      const code = args[0]?.toLowerCase();

      if (!code) {
        const user    = await db.getUser(sender);
        const current = user.lang || '_(hereda del grupo/bot)_';
        return reply(
          `*[🌐] Tu Idioma Personal*\n\n` +
          `Idioma actual: *${SUPPORTED[user.lang] || current}*\n\n` +
          `*Idiomas disponibles:*\n${langList(prefix)}\n\n` +
          `Uso: \`${prefix}setlang en\`\n` +
          `Reset: \`${prefix}resetlang\`\n\n` +
          `_Si tienes un idioma personal establecido, el bot te responderá_\n` +
          `_en ese idioma aunque el grupo use otro._`
        );
      }

      await db.setUser(sender, { lang: code });
      const langName = SUPPORTED[code] || code;
      return reply(`*[🌐] Tu idioma personal establecido:* *${langName}*\n_El bot ahora te responderá en ${langName}._`);
    }

    // ── Reset idioma personal ──────────────────────────────────────
    if (['resetlang', 'resetidioma'].includes(command)) {
      await db.setUser(sender, { lang: '' });
      return reply(await tr('lang_reset'));
    }

    // ════════════════════════════════════════════════════════════════
    //   IDIOMA DEL GRUPO  (!setidioma / !setgrouplan / etc.)
    //   Solo admins en grupos
    // ════════════════════════════════════════════════════════════════
    if (['setidioma', 'setgrouplan', 'langgrupo', 'grupoidio'].includes(command)) {
      if (!fromGroup) {
        return reply('*[❗] Este comando solo funciona en grupos.*');
      }
      if (!ctx.isAdmin) {
        return reply('*[🔒] Solo los administradores pueden cambiar el idioma del grupo.*');
      }

      const code = args[0]?.toLowerCase();

      if (!code) {
        const g       = await db.getGroup(remoteJid);
        const current = g.lang || '_(idioma por defecto del bot)_';
        return reply(
          `*[🌐] Idioma del Grupo*\n\n` +
          `Idioma actual: *${SUPPORTED[g.lang] || current}*\n\n` +
          `*Idiomas disponibles:*\n${langList(prefix)}\n\n` +
          `Uso: \`${prefix}setidioma en\`\n` +
          `Reset: \`${prefix}resetidiomagc\`\n\n` +
          `_Los miembros pueden establecer su propio idioma con_ \`${prefix}setlang\`\n` +
          `_y el bot les responderá en ese idioma aunque el grupo use otro._`
        );
      }

      await db.updateGroupField(remoteJid, 'lang', code);
      const langName = SUPPORTED[code] || code;
      return reply(`*[🌐] Idioma del grupo establecido:* *${langName}*`);
    }

    // ── Reset idioma del grupo ─────────────────────────────────────
    if (['resetidiomagc', 'resetlanggrupo'].includes(command)) {
      if (!fromGroup) return reply('*[❗] Este comando solo funciona en grupos.*');
      if (!ctx.isAdmin) return reply('*[🔒] Solo los administradores pueden resetear el idioma del grupo.*');
      await db.updateGroupField(remoteJid, 'lang', '');
      return reply(await tr('lang_group_reset'));
    }
  },
};
