'use strict';

// ╔══════════════════════════════════════════════════════════════════════╗
// ║                    💨 𝘎𝘦𝘯𝘨𝘢𝘳 𝘉𝘰𝘵 v2 💨                               ║
// ╚══════════════════════════════════════════════════════════════════════╝

const chalk    = require('chalk');
const figlet   = require('figlet');
const readline = require('readline');
const config   = require('./config');

// ════════════════════════════════════════════════════════════════════
//   BANNER
// ════════════════════════════════════════════════════════════════════

function showBanner() {
  console.clear();
  const lines = figlet.textSync('𝘎𝘦𝘯𝘨𝘢𝘳 𝘉𝘰𝘵', { font: 'Big' }).split('\n');
  lines.forEach(l => console.log(chalk.hex('#FFB7C5').bold(l)));
  console.log('');
  console.log(chalk.hex('#E8A0B4')('  💨 Inspirado en los cerezos japoneses (桜 Sakura) 💨'));
  console.log(chalk.gray('  ─────────────────────────────────────────────────────'));
  console.log(chalk.white(`  📦 Versión  : `) + chalk.yellow(config.botVersion));
  console.log(chalk.white(`  ⌨️  Prefijos : `) + chalk.green((Array.isArray(config.prefix) ? config.prefix : [config.prefix]).join('  ')));
  console.log(chalk.white(`  🌐 Idioma   : `) + chalk.green(config.defaultLang.toUpperCase()));
  console.log(chalk.white(`  🗄️  Base DB  : `) + chalk.cyan(config.mongoUri ? '☁️  MongoDB Atlas' : '📁 JSON Local'));
  console.log(chalk.white(`  🔒 Restrict : `) + chalk.magenta(config.restrictMode ? 'Activado' : 'Desactivado'));
  console.log(chalk.gray('  ─────────────────────────────────────────────────────\n'));
}

// ════════════════════════════════════════════════════════════════════
//   FORMATO INTELIGENTE DE NÚMERO DE TELÉFONO
//
//   Acepta cualquier formato que el usuario pueda ingresar:
//   +52 1 999 612 5657  →  5219996125657
//   +521 999 612 5657   →  5219996125657
//   521 999 612 5657    →  5219996125657
//   52 999 612 5657     →  5219996125657  (agrega el 1 para MX móvil)
//   9996125657          →  5219996125657  (10 dígitos MX → agrega 521)
//   1 999 612 5657      →  5219996125657  (si rowner es MX, agrega 52)
// ════════════════════════════════════════════════════════════════════

function formatPhoneNumber(input) {
  if (!input) return null;

  // 1. Limpiar: quitar todo excepto dígitos
  let num = input.trim().replace(/[\s\-\.\(\)\+]/g, '');

  // 2. Quitar prefijo internacional "00"
  if (num.startsWith('00')) num = num.slice(2);

  // 3. Quitar ceros iniciales simples
  if (num.startsWith('0') && num.length > 10) num = num.slice(1);

  // 4. México: detectar y corregir formato
  //    Número correcto en WA: 52 + 1 + 10 dígitos = 13 dígitos total
  //    Ejemplos de lo que puede ingresar el usuario:
  if (num.startsWith('52')) {
    const afterCode = num.slice(2); // lo que viene después del 52
    // Si son exactamente 10 dígitos después de 52 → falta el "1" del móvil
    if (afterCode.length === 10 && afterCode[0] !== '1') {
      num = '52' + '1' + afterCode; // → 521XXXXXXXXXX (13 dígitos)
    }
    // Si ya tiene 11 dígitos después de 52 (52 + 1 + 10) → correcto
    // Si tiene el 1 ya incluido → no tocar
  }

  // 5. Solo 10 dígitos sin código de país
  //    Asumimos México si el número es de 10 dígitos y empieza con área conocida
  if (num.length === 10) {
    num = '521' + num; // Agregar +52 1 (México móvil)
  }

  // 6. Solo 11 dígitos (puede ser MX sin el 52, o US con 1)
  if (num.length === 11 && num.startsWith('1')) {
    // Podría ser US (+1 XXX XXX XXXX) o MX con solo el "1" de área
    // Si el rowner tiene prefijo 52, asumir México
    const rownerHasMX = config.rowner?.some(r => r.startsWith('52'));
    if (rownerHasMX) {
      num = '52' + num; // → 521XXXXXXXXXX
    }
    // Si no, dejarlo como está (US/Canada con código 1)
  }

  // 7. Validar longitud mínima
  if (num.length < 8) return null;

  return num;
}

// ════════════════════════════════════════════════════════════════════
//   READLINE HELPER
// ════════════════════════════════════════════════════════════════════

function createRL() {
  return readline.createInterface({
    input : process.stdin,
    output: process.stdout,
  });
}

function ask(rl, question) {
  return new Promise(resolve => rl.question(question, answer => resolve(answer.trim())));
}

// ════════════════════════════════════════════════════════════════════
//   VERIFICACIONES PREVIAS
// ════════════════════════════════════════════════════════════════════

function preChecks() {
  const [major] = process.versions.node.split('.').map(Number);
  if (major < 18) {
    console.error(chalk.red(`  [ERROR] Necesitas Node.js 18+. Tienes v${process.versions.node}`));
    process.exit(1);
  }
  if (!config.rowner?.length || config.rowner.includes('521000000000')) {
    console.warn(chalk.yellow(
      '  [WARN] No has configurado tu número en config.js\n' +
      '         Edita config.rowner con tu número. Ej: \'521234567890\'\n'
    ));
  }
  const { mkdirSync, existsSync } = require('fs');
  ['session', 'lib', 'plugins', 'src', 'subbots', 'locales'].forEach(d => {
    const p = require('path').join(process.cwd(), d);
    if (!existsSync(p)) mkdirSync(p, { recursive: true });
  });
}

// ════════════════════════════════════════════════════════════════════
//   SELECTOR DE MÉTODO DE CONEXIÓN
//   Solo pregunta si NO existe sesión guardada (primera vez)
// ════════════════════════════════════════════════════════════════════

async function askConnectionMethod() {
  const path = require('path');
  const fs   = require('fs');

  // Verificar si ya existe sesión → no preguntar, conectar directo
  const sessionDir  = path.resolve(process.cwd(), config.sessionPath || './session');
  const credsFile   = path.join(sessionDir, 'creds.json');
  if (fs.existsSync(credsFile)) {
    return { method: 'saved', phone: null };
  }

  const rl = createRL();
  console.log(chalk.hex('#FFB7C5')('  ┌──────────────────────────────────────────┐'));
  console.log(chalk.hex('#FFB7C5')('  │     💨 Método de vinculación de WhatsApp  │'));
  console.log(chalk.hex('#FFB7C5')('  └──────────────────────────────────────────┘\n'));
  console.log(chalk.white('  Selecciona cómo vincular tu número:\n'));
  console.log(chalk.cyan('  [1]') + chalk.white(' QR — Escanear código QR desde la app'));
  console.log(chalk.cyan('  [2]') + chalk.white(' Código de emparejamiento — Introducir código en WhatsApp\n'));

  let choice = '';
  while (!['1', '2'].includes(choice)) {
    choice = await ask(rl, chalk.yellow('  → Elige una opción (1 o 2): '));
    if (!['1', '2'].includes(choice)) {
      console.log(chalk.red('  [!] Por favor escribe 1 o 2.\n'));
    }
  }

  if (choice === '1') {
    rl.close();
    console.log(chalk.gray('\n  [INFO] Se mostrará el QR en pantalla. Escanéalo con WhatsApp.\n'));
    return { method: 'qr', phone: null };
  }

  // Opción 2 → pedir número
  console.log(chalk.gray('\n  Ingresa tu número en formato internacional:'));
  console.log(chalk.gray('  Ej: +521XXXXXXXXXX\n'));

  let phoneFormatted = null;
  while (!phoneFormatted) {
    const rawPhone = await ask(rl, chalk.yellow('  → Número de WhatsApp a vincular: '));
    phoneFormatted = formatPhoneNumber(rawPhone);
    if (!phoneFormatted) {
      console.log(chalk.red('  [!] Número no válido. Inténtalo de nuevo.\n'));
    }
  }

  rl.close();
  console.log(chalk.gray('\n  [INFO] Se enviará el código de emparejamiento a WhatsApp.\n'));
  return { method: 'code', phone: phoneFormatted };
}

// ════════════════════════════════════════════════════════════════════
//   MAIN
// ════════════════════════════════════════════════════════════════════

async function main() {
  showBanner();
  preChecks();

  const { method, phone } = await askConnectionMethod();

  console.log(chalk.cyan('  [INFO] Iniciando conexión con WhatsApp...\n'));

  try {
    const { startBot } = require('./main');
    await startBot({ method, phone });
  } catch (error) {
    console.error(chalk.red('\n  [FATAL] Error crítico:'), error.message);
    console.error(chalk.gray('\n  Posibles soluciones:'));
    console.error(chalk.gray('  1. Verifica tu conexión a Internet'));
    console.error(chalk.gray('  2. Borra la carpeta /session y vuelve a iniciar'));
    console.error(chalk.gray('  3. Asegúrate de tener Node.js 18+'));
    process.exit(1);
  }
}

// ════════════════════════════════════════════════════════════════════
//   FILTRO DE LOGS INTERNOS DE BAILEYS
//   Suprime mensajes de sesión interna que Baileys imprime en consola
//   aunque el logger esté en 'silent' (son console.log directos)
// ════════════════════════════════════════════════════════════════════

const FILTERED_STRINGS = [
  'Q2xvc2luZyBzdGFsZSBvcGVu',       // "Closing stale open"
  'Q2xvc2luZyBvcGVuIHNlc3Npb24=',   // "Closing open session"
  'Q2xvc2luZyBzZXNzaW9u',           // "Closing session"
  'RmFpbGVkIHRvIGRlY3J5cHQ=',       // "Failed to decrypt"
  'U2Vzc2lvbiBlcnJvcg==',            // "Session error"
  'RXJyb3I6IEJhZCBNQUM=',           // "Error: Bad MAC"
  'RGVjcnlwdGVkIG1lc3NhZ2U=',       // "Decrypted message"
].map(b => Buffer.from(b, 'base64').toString('utf-8'));

// Silenciar info y debug completamente (solo ruido de Baileys)
console.info  = () => {};
console.debug = () => {};

// Filtrar log/warn/error cuando contienen strings de sesión interna
;['log', 'warn', 'error'].forEach(method => {
  const original = console[method].bind(console);
  console[method] = function (...args) {
    const msg = typeof args[0] === 'string' ? args[0] : '';
    // Si el mensaje o el objeto stringificado contiene algún string filtrado, suprimirlo
    const combined = msg || (args[0] && typeof args[0] === 'object' ? JSON.stringify(args[0]).slice(0, 200) : '');
    if (FILTERED_STRINGS.some(f => combined.includes(f))) return;
    original(...args);
  };
});

process.on('SIGINT', () => {
  console.log(chalk.hex('#FFB7C5')('\n\n  💨 𝘎𝘦𝘯𝘨𝘢𝘳 𝘉𝘰𝘵 detenido. ¡Hasta pronto!\n'));
  process.exit(0);
});

main();