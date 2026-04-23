'use strict';

// ╔══════════════════════════════════════════════════════════════════════╗
// ║            💨 𝘎𝘦𝘯𝘨𝘢𝘳 𝘉𝘰𝘵 v2 — PLUGIN: RESTRICT 💨                    ║
// ║                                                                      ║
// ║  Activa / desactiva comandos "peligrosos" marcados con              ║
// ║  restrict:true en sus plugins.                                       ║
// ║  Solo el rowner puede usar este comando.                             ║
// ╚══════════════════════════════════════════════════════════════════════╝

const config = require('../config');

module.exports = {
  commands    : ['restrict'],
  description : 'Activa o desactiva los comandos peligrosos del Bot',
  category    : 'owner',
  rownOnly    : true,   // Solo rowner
  usage       : '!restrict on/off | !restrict status',

  async execute(ctx) {
    const { args, reply, tr } = ctx;
    const sub = args[0]?.toLowerCase();

    if (!sub || sub === 'status' || sub === 'estado') {
      return reply(
        `*[🔒] Estado del Modo Restrict*\n\n` +
        `Estado actual: ${config.restrictMode ? '*🔒 Activado*' : '*🔓 Desactivado*'}\n\n` +
        `Cuando está *activado*, los comandos marcados como\n` +
        `peligrosos (_expulsar, banear, añadir, etc._) solo\n` +
        `pueden ser usados por el *rowner*.\n\n` +
        `▸ \`!restrict on\` — Activar restricción\n` +
        `▸ \`!restrict off\` — Desactivar restricción`
      );
    }

    if (['on', 'activar', 'enable'].includes(sub)) {
      config.restrictMode = true;
      return reply(tr('restrict_on'));
    }

    if (['off', 'desactivar', 'disable'].includes(sub)) {
      config.restrictMode = false;
      return reply(tr('restrict_off'));
    }

    return reply(`*[❗]* Uso: \`!restrict on\` o \`!restrict off\``);
  },
};
