'use strict';

// ╔══════════════════════════════════════════════════════════════════════╗
// ║           💨 𝘎𝘦𝘯𝘨𝘢𝘳 𝘉𝘰𝘵 v2 — PLUGIN: ANTI-LINK 💨                    ║
// ╚══════════════════════════════════════════════════════════════════════╝

const { t } = require('../lib/i18n');

const WA_LINK_PATTERNS = [
  /chat\.whatsapp\.com\/[A-Za-z0-9]+/i,
  /wa\.me\/[A-Za-z0-9]+/i,
  /whatsapp\.com\/channel\/[A-Za-z0-9]+/i,
];

function hasWALink(text) {
  if (!text) return false;
  return WA_LINK_PATTERNS.some(p => p.test(text));
}

function getFullText(msg) {
  const m = msg.message;
  if (!m) return '';
  return m.conversation || m.extendedTextMessage?.text ||
    m.imageMessage?.caption || m.videoMessage?.caption || m.documentMessage?.caption || '';
}

async function checkAntilink(sock, msg, ctx) {
  const { sender, remoteJid, botIsAdmin, isAdmin, isOwner, db, lang } = ctx;

  const groupConfig = await db.getGroup(remoteJid);
  if (!groupConfig.antilink || !botIsAdmin) return false;

  const text = getFullText(msg);
  if (!text || !hasWALink(text)) return false;
  if (isAdmin || isOwner) return false;

  const senderNum = sender.split('@')[0];
  const action    = groupConfig.antilinkAction || 'delete';
  const MAX_WARNS = 3;

  try {
    await sock.sendMessage(remoteJid, { delete: msg.key });

    if (action === 'warn') {
      const warns = await db.addAntilinkWarn(remoteJid, sender);
      if (warns >= MAX_WARNS) {
        await sock.groupParticipantsUpdate(remoteJid, [sender], 'remove');
        await db.resetAntilinkWarn(remoteJid, sender);
        await sock.sendMessage(remoteJid, {
          text: t('antilink_kick', lang, { num: senderNum }),
          mentions: [sender],
        });
      } else {
        await sock.sendMessage(remoteJid, {
          text: t('antilink_warn', lang, { n: warns, max: MAX_WARNS, num: senderNum }),
          mentions: [sender],
        });
      }
    } else if (action === 'kick') {
      await sock.groupParticipantsUpdate(remoteJid, [sender], 'remove');
      await sock.sendMessage(remoteJid, {
        text: t('antilink_kick', lang, { num: senderNum }),
        mentions: [sender],
      });
    } else {
      await sock.sendMessage(remoteJid, {
        text: t('antilink_delete', lang, { num: senderNum }),
        mentions: [sender],
      });
    }
    return true;
  } catch { return false; }
}

module.exports = {
  checkAntilink,

  commands    : ['antilink'],
  description : 'Bloquea links de grupos de WhatsApp',
  category    : 'grupo',
  adminOnly   : true,
  groupOnly   : true,
  botAdmin    : true,
  restrict    : false,

  async execute(ctx) {
    const { remoteJid, args, db, reply, prefix } = ctx;
    const sub = args[0]?.toLowerCase();

    if (!sub) {
      const g      = await db.getGroup(remoteJid);
      const estado = g.antilink ? '✅ *Activado*' : '❌ *Desactivado*';
      const modos  = { delete: '🗑️ Solo eliminar', warn: '⚠️ Advertir (3→expulsión)', kick: '🔨 Expulsar directo' };
      return reply(
        `*[🔗] Anti-Link de WhatsApp*\n\n` +
        `Estado : ${estado}\n` +
        `Acción : ${modos[g.antilinkAction || 'delete']}\n\n` +
        `▸ \`${prefix}antilink on/off\` — Activar/desactivar\n` +
        `▸ \`${prefix}antilink warn\` — Modo advertencia\n` +
        `▸ \`${prefix}antilink kick\` — Expulsión directa\n` +
        `▸ \`${prefix}antilink delete\` — Solo eliminar\n\n` +
        `_Los admins están exentos del anti-link._`
      );
    }

    const modeMap = {
      on: () => db.updateGroupField(remoteJid, 'antilink', true),
      off: () => db.updateGroupField(remoteJid, 'antilink', false),
      activar: () => db.updateGroupField(remoteJid, 'antilink', true),
      desactivar: () => db.updateGroupField(remoteJid, 'antilink', false),
    };

    if (modeMap[sub]) {
      await modeMap[sub]();
      return reply(`${['on','activar'].includes(sub) ? '✅' : '❌'} Anti-link ${['on','activar'].includes(sub) ? '*activado*' : '*desactivado*'}.`);
    }

    if (['warn', 'kick', 'delete', 'eliminar'].includes(sub)) {
      const action = sub === 'eliminar' ? 'delete' : sub;
      await db.updateGroupField(remoteJid, 'antilink', true);
      await db.updateGroupField(remoteJid, 'antilinkAction', action);
      const labels = { warn: '⚠️ Modo advertencia activado.', kick: '🔨 Modo expulsión directa activado.', delete: '🗑️ Modo solo eliminar activado.' };
      return reply(`✅ Anti-link activado. ${labels[action]}`);
    }

    return reply(`*[❗]* Opción no reconocida. Usa \`${prefix}antilink\` para ver las opciones.`);
  },
};
