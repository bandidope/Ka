'use strict';

// ╔══════════════════════════════════════════════════════════════════════╗
// ║           💨 𝘎𝘦𝘯𝘨𝘢𝘳 𝘉𝘰𝘵 v2 — PLUGIN: WELCOME / BYE 💨               ║
// ╚══════════════════════════════════════════════════════════════════════╝

const fs   = require('fs');
const path = require('path');
const db   = require('../lib/database');
const { t }             = require('../lib/i18n');
const { translateText } = require('../lib/translate');
const {
  resolveLid, learnLidsFromParticipants,
  getDisplayNumber, getProfilePicBuffer, normalizeJid,
} = require('../lib/utils');

// ── Mensajes de bienvenida (base en español) ──────────────────────────
const WELCOME_MSGS = [
  '¡El grupo se alegra de tenerte aquí! 🎉',
  'Bienvenido/a, esperamos que disfrutes tu estadía. 💨',
  '¡Por fin llegas! El grupo ya puede funcionar correctamente. 😄',
  '¡Bienvenido/a! Las reglas existen… aunque nadie las lea. 📜',
  'Llegó alguien nuevo. El promedio de productividad sigue igual. 😂',
  '¡Qué bueno que llegaste! Ahora somos uno más en esta familia. 🌺',
];

// ── Mensajes de despedida satíricos (base en español) ─────────────────
const BYE_MSGS = [
  'Se fue... probablemente a pensar en sus malas decisiones de vida. 💀',
  'Se marchó. El promedio de inteligencia del grupo sube automáticamente. 📈',
  'Voló lejos. Que encuentre lo que busca. 🕊️',
  'Salió del grupo sin decir adiós. La educación también se fue con él/ella. 🚶',
  'Abandonó el circo. Y el circo sigue sin él/ella, como siempre. 🎪',
  'Se fue en silencio. Como toda buena película de terror. 🎬',
  'Partió al más allá... bueno, al menos de este grupo. 💨',
  'Un miembro menos. El drama también bajó un nivel. 📉',
  'Se esfumó. Igual que sus ganas de participar en la conversación. 👻',
  'Dijo adiós con sus pies. Al menos alguien es consistente aquí. 🚪',
];

const DEFAULT_PIC = path.join(process.cwd(), 'src', 'no-photo.jpg');

/**
 * Traduce un texto al idioma indicado (si no es español).
 * Devuelve el texto original en caso de error.
 */
async function translateIfNeeded(text, lang) {
  if (!lang || lang === 'es') return text;
  try {
    const result = await translateText(text, lang, 'es');
    return result.text || text;
  } catch {
    return text;
  }
}

// ══════════════════════════════════════════════════════════════════════
//   HANDLER DE EVENTOS (llamado desde main.js)
// ══════════════════════════════════════════════════════════════════════

async function handleWelcome(sock, update, store) {
  const { id: groupJid, participants, action } = update;
  if (!['add', 'remove'].includes(action)) return;

  const groupConfig = await db.getGroup(groupJid);
  if (action === 'add'    && !groupConfig.welcome) return;
  if (action === 'remove' && !groupConfig.bye)     return;

  const lang = groupConfig.lang || 'es';

  let groupName = groupJid, groupDesc = '';
  try {
    const meta = await sock.groupMetadata(groupJid);
    groupName  = meta.subject || groupJid;
    groupDesc  = meta.desc    || '';
    await learnLidsFromParticipants(meta.participants);
  } catch {}

  for (const participant of participants) {
    // Resolución async para mayor precisión en LIDs
    const resolved = normalizeJid(await resolveLid(participant, store));
    const num = resolved.endsWith('@s.whatsapp.net')
      ? resolved.split('@')[0]
      : getDisplayNumber(resolved);

    // Foto de perfil
    let profilePic = await getProfilePicBuffer(sock, resolved);
    if (!profilePic && fs.existsSync(DEFAULT_PIC)) {
      profilePic = fs.readFileSync(DEFAULT_PIC);
    }

    if (action === 'add') {
      // Elegir mensaje aleatorio y traducirlo si el grupo no está en español
      const rawMsg       = WELCOME_MSGS[Math.floor(Math.random() * WELCOME_MSGS.length)];
      const translatedMsg = await translateIfNeeded(rawMsg, lang);

      // El template de es.json ya tiene "@{num}" → pasamos solo el número sin @
      const baseTx = await t('welcome_group', lang, {
        num  : num,
        group: groupName,
        desc : groupDesc ? `📝 _${groupDesc.slice(0, 120)}${groupDesc.length > 120 ? '...' : ''}_` : '',
      });
      const caption = `${baseTx}\n\n💬 ${translatedMsg}`;

      if (profilePic) {
        await sock.sendMessage(groupJid, { image: profilePic, caption, mentions: [resolved] }).catch(() => {});
      } else {
        await sock.sendMessage(groupJid, { text: caption, mentions: [resolved] }).catch(() => {});
      }

    } else if (action === 'remove') {
      const rawMsg        = BYE_MSGS[Math.floor(Math.random() * BYE_MSGS.length)];
      const translatedMsg = await translateIfNeeded(rawMsg, lang);

      const baseTx = await t('bye_group', lang, { num });
      const text   = `${baseTx}\n\n😔 ${translatedMsg}`;

      if (profilePic) {
        await sock.sendMessage(groupJid, { image: profilePic, caption: text, mentions: [resolved] }).catch(() => {});
      } else {
        await sock.sendMessage(groupJid, { text, mentions: [resolved] }).catch(() => {});
      }
    }
  }
}

// ══════════════════════════════════════════════════════════════════════
//   COMANDOS
// ══════════════════════════════════════════════════════════════════════

module.exports = {
  handleWelcome,

  commands    : ['welcome', 'bienvenida', 'bye', 'despedida'],
  description : 'Activa/desactiva mensajes de bienvenida y despedida',
  category    : 'grupo',
  adminOnly   : true,
  groupOnly   : true,
  usage       : '!welcome on/off | !bye on/off',

  async execute(ctx) {
    const { remoteJid, command, args, db, reply, prefix } = ctx;

    const isWelcome = ['welcome', 'bienvenida'].includes(command);
    const field     = isWelcome ? 'welcome' : 'bye';
    const label     = isWelcome ? 'bienvenida' : 'despedida';
    const sub       = args[0]?.toLowerCase();

    if (!sub || !['on', 'off', 'activar', 'desactivar'].includes(sub)) {
      const current = await db.getGroupField(remoteJid, field);
      return reply(
        `*[💨] Mensaje de ${label}*\n\n` +
        `Estado: ${current ? '✅ *Activado*' : '❌ *Desactivado*'}\n\n` +
        `▸ \`${prefix}${command} on\` — Activar\n` +
        `▸ \`${prefix}${command} off\` — Desactivar`
      );
    }

    const activate = ['on', 'activar'].includes(sub);
    await db.updateGroupField(remoteJid, field, activate);
    return reply(`${activate ? '✅' : '❌'} Mensaje de *${label}* ${activate ? '*activado*' : '*desactivado*'}.`);
  },
};