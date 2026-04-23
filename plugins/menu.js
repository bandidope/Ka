'use strict';

// ╔══════════════════════════════════════════════════════════════════════╗
// ║               💨 𝘎𝘦𝘯𝘨𝘢𝘳 𝘉𝘰𝘵 v2 — PLUGIN: MENÚ 💨                    ║
// ╚══════════════════════════════════════════════════════════════════════╝

const fs     = require('fs');
const config = require('../config');
const moment = require('moment');

const CATEGORY_META = {
  grupo      : { emoji: '👥', label: 'Grupo',      order: 1 },
  owner      : { emoji: '👑', label: 'Owner',       order: 2 },
  serbot     : { emoji: '🤖', label: 'Sub-Bots',    order: 3 },
  utilidades : { emoji: '🛠️', label: 'Utilidades',  order: 4 },
  premium    : { emoji: '💎', label: 'Premium',      order: 5 },
  general    : { emoji: '💨', label: 'General',      order: 6 },
  info       : { emoji: 'ℹ️', label: 'Info',         order: 7 },
};

async function buildMenuText(ctx) {
  const { getPlugins } = require('../handler');
  const allPlugins  = [...getPlugins()];
  const usedPrefix  = ctx.usedPrefix || (Array.isArray(config.prefix) ? config.prefix[0] : config.prefix) || '!';
  const { t, getLang } = require('../lib/i18n');
  const lang        = ctx.lang || 'es';

  // Agrupar comandos por categoría
  const categories = {};
  for (const plugin of allPlugins) {
    if (!plugin.commands?.length && !plugin.command) continue;
    const cmds = plugin.commands || [plugin.command];
    const cat  = (plugin.category || 'general').toLowerCase();
    if (!categories[cat]) categories[cat] = [];

    categories[cat].push({
      cmd     : cmds[0],
      desc    : plugin.description || '',
      restrict: plugin.restrict    || false,
      premium : plugin.premiumOnly || false,
    });
  }

  const now    = moment().locale('es').format('ddd D MMM, HH:mm');
  const pfxStr = (Array.isArray(config.prefix) ? config.prefix : [config.prefix]).join('  ');

  // ── Encabezado ──────────────────────────────────────────────────
  let menu =
    `💨 *${config.botName}*  _v${config.botVersion}_\n` +
    `👤 ${ctx.pushName || ''}  ·  📅 ${now}\n` +
    `⌨️ Prefijos: *${pfxStr}*\n\n`;

  // ── Categorías ordenadas ─────────────────────────────────────────
  const sortedCats = Object.entries(categories).sort(([a], [b]) => {
    return (CATEGORY_META[a]?.order ?? 99) - (CATEGORY_META[b]?.order ?? 99);
  });

  for (const [cat, cmds] of sortedCats) {
    const meta = CATEGORY_META[cat] || { emoji: '📌', label: cat };
    menu += `${meta.emoji} *${meta.label.toUpperCase()}*\n`;

    for (const { cmd, desc, restrict, premium } of cmds) {
      const badges = [
        restrict ? '🔒' : '',
        premium  ? '💎' : '',
      ].filter(Boolean).join('');
      menu += `  ▸ \`${usedPrefix}${cmd}\`${badges ? ' ' + badges : ''}\n`;
      if (desc) menu += `     _${desc}_\n`;
    }
    menu += '\n';
  }

  menu += `🔒 _Restringido_  ·  💎 _Premium_\n`;
  menu += `_${config.footer}_`;

  return menu;
}

module.exports = {
  commands    : ['menu', 'help', 'ayuda', 'comandos'],
  description : 'Muestra todos los comandos disponibles',
  category    : 'info',

  async execute(ctx) {
    const { sock, remoteJid, msg } = ctx;
    const text = await buildMenuText(ctx);

    const bannerPath = config.menuBanner;
    if (bannerPath && fs.existsSync(bannerPath)) {
      return sock.sendMessage(remoteJid, { image: { url: bannerPath }, caption: text }, { quoted: msg });
    }
    return sock.sendMessage(remoteJid, { text }, { quoted: msg });
  },
};