'use strict';

// ╔══════════════════════════════════════════════════════════════════════╗
// ║             💨 𝘎𝘦𝘯𝘨𝘢𝘳 𝘉𝘰𝘵 v2 — PLUGIN: PERFIL DE USUARIO 💨          ║
// ║  Registro de nombre, idioma preferido y estadísticas del usuario     ║
// ╚══════════════════════════════════════════════════════════════════════╝

const moment = require('moment');
const { SUPPORTED }  = require('../lib/i18n');

module.exports = {
  commands    : ['perfil', 'profile', 'registro', 'register', 'setnombre', 'setname', 'setlang', 'idioma'],
  description : 'Gestiona tu perfil: nombre, idioma y estadísticas',
  category    : 'general',
  usage       : [
    '!perfil                  — Ver tu perfil',
    '!registro Mi Nombre      — Registrar tu nombre',
    '!setlang es/en/pt        — Cambiar tu idioma preferido',
  ],

  async execute(ctx) {
    const { command, args, sender, pushName, db, reply, tr, lang } = ctx;

    // ── !perfil / !profile ─────────────────────────────────────────
    if (['perfil', 'profile'].includes(command)) {
      const user = await db.getUser(sender);
      const since = user.createdAt
        ? moment(user.createdAt).locale('es').fromNow()
        : 'desconocido';
      const premium = await db.isPremium(sender);

      return reply(tr('profile_show', {
        name   : user.name || pushName || 'Sin nombre',
        lang   : SUPPORTED[user.lang || lang] || user.lang || lang,
        premium: premium ? '✅ Sí' : '❌ No',
        since,
      }));
    }

    // ── !registro / !setnombre / !setname ─────────────────────────
    if (['registro', 'register', 'setnombre', 'setname'].includes(command)) {
      const name = args.join(' ').trim();
      if (!name) {
        return reply(
          `*[❗] Indica tu nombre.*\n\n` +
          `Ejemplo: \`!registro Juan Pérez\``
        );
      }
      if (name.length > 50) {
        return reply('*[❌] El nombre no puede tener más de 50 caracteres.*');
      }
      await db.setUser(sender, { name });
      return reply(tr('profile_saved', { name }));
    }

    // ── !setlang / !idioma ─────────────────────────────────────────
    if (['setlang', 'idioma'].includes(command)) {
      const code = args[0]?.toLowerCase();

      if (!code) {
        const langList = Object.entries(SUPPORTED)
          .map(([k, v]) => `  \`${k}\` — ${v}`)
          .join('\n');
        const user = await db.getUser(sender);
        return reply(
          `*[🌐] Configuración de Idioma*\n\n` +
          `Tu idioma actual: *${SUPPORTED[user.lang || lang] || lang}*\n\n` +
          `*Idiomas disponibles:*\n${langList}\n\n` +
          `Uso: \`!setlang en\``
        );
      }

      if (!SUPPORTED[code]) {
        return reply(
          `*[❌] Idioma no soportado:* \`${code}\`\n` +
          `Usa \`!setlang\` para ver la lista.`
        );
      }

      await db.setUser(sender, { lang: code });
      return reply(tr('lang_set', { lang: SUPPORTED[code] }));
    }
  },
};
