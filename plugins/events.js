'use strict';

// ╔══════════════════════════════════════════════════════════════════════╗
// ║           💨 𝘎𝘦𝘯𝘨𝘢𝘳 𝘉𝘰𝘵 v2 — PLUGIN: EVENTOS DE GRUPO 💨             ║
// ╚══════════════════════════════════════════════════════════════════════╝

const db = require('../lib/database');
const { t } = require('../lib/i18n');
const {
  resolveLid, resolveLidSync,
  learnLidsFromParticipants,
  getDisplayNumber, getGroupAdmins,
  normalizeJid,
} = require('../lib/utils');

// ── Notificar a admins por DM ─────────────────────────────────────────
async function notifyAdminsIfEnabled(sock, groupJid, groupConfig, lang, message) {
  if (!groupConfig.events?.notifyAdmins) return;
  try {
    const meta   = await sock.groupMetadata(groupJid);
    const admins = getGroupAdmins(meta.participants);
    for (const adminJid of admins) {
      await sock.sendMessage(adminJid, {
        text: `🔔 *Alerta de seguridad — ${meta.subject}*\n\n${message}`,
      }).catch(() => {});
    }
  } catch {}
}

// ═════════════════════════════════════════════════════════════════════
//   HANDLER: PROMOTE / DEMOTE
// ═════════════════════════════════════════════════════════════════════

async function handleGroupParticipantsUpdate(sock, update, store) {
  const { id: groupJid, participants, action, author } = update;
  if (!['promote', 'demote'].includes(action)) return;

  const groupConfig = await db.getGroup(groupJid);
  if (!groupConfig.events?.active || !groupConfig.events?.adminChange) return;

  const lang = groupConfig.lang || 'es';

  let groupName = groupJid;
  try {
    const meta = await sock.groupMetadata(groupJid);
    groupName  = meta.subject || groupJid;
    await learnLidsFromParticipants(meta.participants);
  } catch {}

  // Resolver autor con async (LID)
  let authorJid = null, authorNum = null;
  if (author) {
    authorJid = normalizeJid(await resolveLid(author, store));
    authorNum = authorJid?.split('@')[0] || null;
  }

  for (const participant of participants) {
    const resolved = normalizeJid(await resolveLid(participant, store));
    const num      = resolved.split('@')[0] || getDisplayNumber(resolved);

    // AWAIT t() — sin await devuelve Promise → [object Promise]
    const key  = action === 'promote' ? 'event_promoted' : 'event_demoted';
    let text   = await t(key, lang, { num, group: groupName });
    if (authorNum) text += `\n🛠️ *Por:* @${authorNum}`;

    const mentions = [resolved];
    if (authorJid) mentions.push(authorJid);

    await sock.sendMessage(groupJid, { text, mentions }).catch(() => {});
    await notifyAdminsIfEnabled(sock, groupJid, groupConfig, lang, text);
  }
}

// ═════════════════════════════════════════════════════════════════════
//   HANDLER: ACTUALIZACIÓN DE GRUPO (desc, foto, nombre)
// ═════════════════════════════════════════════════════════════════════

async function handleGroupsUpdate(sock, updates, store) {
  for (const update of updates) {
    const groupJid    = update.id;
    const groupConfig = await db.getGroup(groupJid);
    if (!groupConfig.events?.active) continue;

    const lang = groupConfig.lang || 'es';

    let groupName = groupJid;
    try {
      const m = await sock.groupMetadata(groupJid);
      groupName = m.subject || groupJid;
    } catch {}

    // ── Cambio de descripción ────────────────────────────────────
    if (update.desc !== undefined && groupConfig.events?.descChange) {
      // AWAIT t()
      const text = await t('event_desc', lang, {
        group: groupName,
        desc : update.desc || '_(sin descripción)_',
      });
      await sock.sendMessage(groupJid, { text }).catch(() => {});
      await notifyAdminsIfEnabled(sock, groupJid, groupConfig, lang, text);
    }

    // ── Cambio de foto ───────────────────────────────────────────
    if (update.pictureUpdated && groupConfig.events?.photoChange) {
      const text = await t('event_photo', lang, { group: groupName });
      await sock.sendMessage(groupJid, { text }).catch(() => {});
      await notifyAdminsIfEnabled(sock, groupJid, groupConfig, lang, text);
    }

    // ── Cambio de nombre ─────────────────────────────────────────
    if (update.subject !== undefined && groupConfig.events?.descChange) {
      const text = await t('event_subject', lang, { subject: update.subject });
      await sock.sendMessage(groupJid, { text }).catch(() => {});
      await notifyAdminsIfEnabled(sock, groupJid, groupConfig, lang, text);
    }
  }
}

// ═════════════════════════════════════════════════════════════════════
//   COMANDOS
// ═════════════════════════════════════════════════════════════════════

module.exports = {
  handleGroupParticipantsUpdate,
  handleGroupsUpdate,

  commands    : ['eventos', 'events', 'notifyadmins'],
  description : 'Configura notificaciones de eventos del grupo',
  category    : 'grupo',
  adminOnly   : true,
  groupOnly   : true,

  async execute(ctx) {
    const { remoteJid, args, command, db, reply, prefix } = ctx;
    const sub = args[0]?.toLowerCase();

    // ── !notifyadmins ─────────────────────────────────────────────
    if (command === 'notifyadmins') {
      if (!['on', 'off'].includes(sub)) {
        const cur = await db.getGroupField(remoteJid, 'events.notifyAdmins');
        return reply(
          `*[🔔] Notificación privada a Admins*\n\n` +
          `Estado: ${cur ? '✅ *Activado*' : '❌ *Desactivado*'}\n\n` +
          `Cuando está activo, los admins reciben un mensaje\n` +
          `privado ante cada evento del grupo.\n\n` +
          `▸ \`${prefix}notifyadmins on/off\``
        );
      }
      const act = sub === 'on';
      await db.updateGroupField(remoteJid, 'events.notifyAdmins', act);
      return reply(`${act ? '✅' : '❌'} Notificación a admins ${act ? '*activada*' : '*desactivada*'}.`);
    }

    // ── !eventos sin args → mostrar estado ───────────────────────
    if (!sub) {
      const cfg = await db.getGroup(remoteJid);
      const ev  = cfg.events || {};
      return reply(
        `*[📡] Eventos del Grupo*\n\n` +
        `Estado general : ${ev.active       ? '✅' : '❌'}\n` +
        `├ 👑 Cambio admin   : ${ev.adminChange  ? '✅' : '❌'}\n` +
        `├ 📝 Cambio desc    : ${ev.descChange   ? '✅' : '❌'}\n` +
        `├ 📸 Cambio foto    : ${ev.photoChange  ? '✅' : '❌'}\n` +
        `└ 🔔 Notif. admins  : ${ev.notifyAdmins ? '✅' : '❌'}\n\n` +
        `▸ \`${prefix}eventos on/off\`\n` +
        `▸ \`${prefix}eventos admin on/off\`\n` +
        `▸ \`${prefix}eventos desc on/off\`\n` +
        `▸ \`${prefix}eventos foto on/off\`\n` +
        `▸ \`${prefix}notifyadmins on/off\``
      );
    }

    // ── !eventos on/off (todo) ────────────────────────────────────
    if (['on', 'off'].includes(sub) && !args[1]) {
      await db.updateGroupField(remoteJid, 'events.active', sub === 'on');
      return reply(`${sub === 'on' ? '✅' : '❌'} Eventos ${sub === 'on' ? '*activados*' : '*desactivados*'}.`);
    }

    // ── !eventos [sub] on/off ─────────────────────────────────────
    const onoff    = args[1]?.toLowerCase();
    const activate = onoff === 'on';
    if (!['on', 'off'].includes(onoff)) return reply('*[❗]* Usa `on` o `off`.');

    const fieldMap = {
      admin : 'events.adminChange',
      desc  : 'events.descChange',
      foto  : 'events.photoChange',
      photo : 'events.photoChange',
    };
    const field = fieldMap[sub];
    if (!field) return reply(`*[❗]* Opción no reconocida: *${sub}*\nOpciones: admin, desc, foto`);

    await db.updateGroupField(remoteJid, field, activate);
    return reply(`${activate ? '✅' : '❌'} Evento *${sub}* ${activate ? 'activado' : 'desactivado'}.`);
  },
};