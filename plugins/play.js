'use strict';

// ╔══════════════════════════════════════════════════════════════════════╗
// ║        💨 𝘎𝘦𝘯𝘨𝘢𝘳 𝘉𝘰𝘵 v2 — PLUGIN: PLAY (Música y Video) 💨           ║
// ║                                                                      ║
// ║  !play  → Audio MP3  → api.mp3youtube.cc → ffmpeg MP4→MP3           ║
// ║  !play2 → Video MP4  → api.mp3youtube.cc → ffmpeg repair faststart  ║
// ║  !letra → Letras     → lyrist.vercel.app / some-random-api          ║
// ╚══════════════════════════════════════════════════════════════════════╝

const axios   = require('axios');
const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');
const chalk   = require('chalk');

// ── ffmpeg setup ──────────────────────────────────────────────────────
let ffmpeg;
try {
  ffmpeg = require('fluent-ffmpeg');
  // Intentar usar el binario del paquete @ffmpeg-installer/ffmpeg
  try {
    const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
    ffmpeg.setFfmpegPath(ffmpegPath);
  } catch {
    // Usar el ffmpeg del sistema si @ffmpeg-installer no está disponible
  }
} catch {
  ffmpeg = null;
}

// ── APIs de letras ────────────────────────────────────────────────────
const LYRICS_APIS = [
  (artist, song) => `https://lyrist.vercel.app/api/${encodeURIComponent(song)}/${encodeURIComponent(artist)}`,
  (artist, song) => `https://some-random-api.com/lyrics?title=${encodeURIComponent(artist + ' ' + song)}`,
];

// ── Carpeta temporal ──────────────────────────────────────────────────
const TMP_DIR = path.join(process.cwd(), '.tmp_media');
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

// ── Logger ────────────────────────────────────────────────────────────
// DEBUG desactivado — eliminar completamente los logs de consola del plugin
function log() {}
function logErr(step, err) {
  console.error(`  [PLAY:${step}] ❌ ${err.message}`);
}

// ══════════════════════════════════════════════════════════════════════
//   HELPERS
// ══════════════════════════════════════════════════════════════════════

function normalizeYouTubeUrl(url) {
  if (!url) return url;
  const short = url.match(/youtu\.be\/([A-Za-z0-9_-]+)/);
  if (short) return `https://www.youtube.com/watch?v=${short[1]}`;
  return url.replace(/^https?:\/\/(youtube\.com)/, 'https://www.youtube.com');
}

function uniqueTmpPath(title, ext) {
  const safe = (title || 'media').replace(/[^a-z0-9]/gi, '_').slice(0, 30);
  return path.join(TMP_DIR, `${safe}_${crypto.randomBytes(6).toString('hex')}.${ext}`);
}

function cleanOldTmpFiles() {
  try {
    const now = Date.now();
    fs.readdirSync(TMP_DIR).forEach(f => {
      const fp = path.join(TMP_DIR, f);
      try { if (now - fs.statSync(fp).mtimeMs > 15 * 60 * 1000) fs.unlinkSync(fp); } catch {}
    });
  } catch {}
}
cleanOldTmpFiles();

function removeTmp(filepath) {
  if (filepath && fs.existsSync(filepath)) {
    try { fs.unlinkSync(filepath); log('CLEANUP', path.basename(filepath)); } catch {}
  }
}

// ══════════════════════════════════════════════════════════════════════
//   BÚSQUEDA EN YOUTUBE
// ══════════════════════════════════════════════════════════════════════

async function searchYT(query) {
  log('SEARCH', `Buscando: "${query}"`);
  const yts   = require('yt-search');
  const res   = await yts(query);
  const video = res.videos?.[0];
  if (!video) throw new Error(`Sin resultados para: "${query}"`);
  const result = {
    url      : normalizeYouTubeUrl(video.url),
    title    : video.title,
    thumbnail: video.thumbnail || video.image || null,
    duration : video.timestamp || video.duration?.timestamp || '',
    author   : video.author?.name || '',
    videoId  : video.videoId || '',
  };
  log('SEARCH', `"${result.title}"`, `${result.duration} · ${result.url}`);
  return result;
}

// ══════════════════════════════════════════════════════════════════════
//   API mp3youtube.cc — Obtener link de descarga (MP3 o MP4)
//
//   Flujo:
//     1. GET  /v2/sanity/key  → clave dinámica de sesión
//     2. POST /v2/converter   → payload con URL + formato + clave
//     3. Respuesta: { link, url, downloadUrl }
// ══════════════════════════════════════════════════════════════════════

const YT_DL_HEADERS = {
  'accept'            : '*/*',
  'accept-encoding'   : 'gzip, deflate, br',
  'accept-language'   : 'en-US,en;q=0.9',
  'cache-control'     : 'no-cache',
  'pragma'            : 'no-cache',
  'sec-ch-ua'         : '"Not)A;Brand";v="8", "Chromium";v="138"',
  'sec-ch-ua-mobile'  : '?0',
  'sec-ch-ua-platform': '"Windows"',
  'sec-fetch-dest'    : 'empty',
  'sec-fetch-mode'    : 'cors',
  'sec-fetch-site'    : 'cross-site',
  'user-agent'        : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
};

async function getKey() {
  log('API', `Obteniendo clave dinámica`);
  const res = await axios.get('https://api.mp3youtube.cc/v2/sanity/key', {
    headers: { ...YT_DL_HEADERS, 'content-type': 'application/json', 'origin': 'https://iframe.y2meta-uk.com', 'referer': 'https://iframe.y2meta-uk.com/' },
    timeout: 15000,
  });
  if (!res.data?.key) throw new Error('No se pudo obtener la clave de conversión.');
  log('API', `Clave`, res.data.key.slice(0, 20) + '...');
  return res.data.key;
}

/**
 * @param {string} ytUrl    URL normalizada de YouTube
 * @param {string} formatId '128kbps' | '320kbps' | '144p' | '360p' | '720p'
 */
async function getDownloadLink(ytUrl, formatId = '128kbps') {
  const normalUrl = normalizeYouTubeUrl(ytUrl);
  log('API', `Solicitando conversión`, `${formatId} · ${normalUrl}`);

  const key  = await getKey();
  const match = formatId.match(/(\d+)(\w+)/);
  const format = match[2] === 'kbps' ? 'mp3' : 'mp4';

  const payload = {
    link         : normalUrl,
    format,
    audioBitrate : format === 'mp3' ? match[1] : 128,
    videoQuality : format === 'mp4' ? match[1] : 720,
    filenameStyle: 'pretty',
    vCodec       : 'h264',
  };

  let res;
  try {
    res = await axios.post('https://api.mp3youtube.cc/v2/converter',
      new URLSearchParams(payload).toString(),
      {
        headers: { ...YT_DL_HEADERS, 'content-type': 'application/x-www-form-urlencoded', 'Key': key, 'origin': 'https://iframe.y2meta-uk.com', 'referer': 'https://iframe.y2meta-uk.com/' },
        timeout: 60000,
      }
    );
  } catch (err) {
    logErr('API', err);
    throw new Error(`Error al convertir (${formatId}): ${err.message}`);
  }

  const dlUrl = res.data?.link || res.data?.url || res.data?.downloadUrl;
  if (!dlUrl) {
    log('API', `Respuesta inesperada`, JSON.stringify(res.data || {}).slice(0, 200));
    throw new Error(`La API no devolvió un link de descarga para ${formatId}.`);
  }
  log('API', `Link obtenido (${formatId})`, dlUrl.slice(0, 80) + '...');
  return dlUrl;
}

// ══════════════════════════════════════════════════════════════════════
//   DESCARGA DE ARCHIVO (con headers de navegador)
// ══════════════════════════════════════════════════════════════════════

async function downloadFile(url, filepath) {
  log('DL', `Descargando`, `${path.basename(filepath)}`);
  log('DL', `URL`, url);
  const res = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout     : 180000,
    headers     : {
      'User-Agent': YT_DL_HEADERS['user-agent'],
      'Accept'    : '*/*',
      'Referer'   : 'https://iframe.y2meta-uk.com/',
    },
  });
  fs.writeFileSync(filepath, Buffer.from(res.data));
  const mb = (res.data.byteLength / 1024 / 1024).toFixed(2);
  log('DL', `Guardado`, `${mb} MB`);
  return filepath;
}

// ══════════════════════════════════════════════════════════════════════
//   FFMPEG — Reparar MP4 (faststart) y convertir MP4→MP3
// ══════════════════════════════════════════════════════════════════════

/**
 * Repara el MP4: mueve el átomo moov al inicio del archivo.
 * Sin esto el video no se puede reproducir en móviles antes de descargarse completo.
 */
function repairMP4(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    if (!ffmpeg) return reject(new Error('ffmpeg no disponible'));
    ffmpeg(inputPath)
      .outputOptions([
        '-c copy',
        '-movflags +faststart',
        '-avoid_negative_ts make_zero',
        '-fflags +genpts',
      ])
      .on('end',   ()  => resolve(outputPath))
      .on('error', err => { logErr('FFMPEG', err); reject(err); })
      .save(outputPath);
  });
}

/**
 * Convierte un archivo MP4 (o cualquier audio/video) a MP3.
 * Extrae el audio sin recodificar si el codec ya es MP3/AAC,
 * de lo contrario lo convierte a MP3 con libmp3lame.
 */
function convertToMP3(inputPath, outputPath, meta = {}) {
  return new Promise((resolve, reject) => {
    if (!ffmpeg) return reject(new Error('ffmpeg no disponible'));

    // Sanitizar: quitar caracteres que ffmpeg interpreta como separadores
    const sanitize = s => (s || '').replace(/[:"\\]/g, '').trim();
    const title  = sanitize(meta.title)  || '𝘎𝘦𝘯𝘨𝘢𝘳 𝘉𝘰𝘵';
    const artist = sanitize(meta.artist) || '𝘎𝘦𝘯𝘨𝘢𝘳 𝘉𝘰𝘵';

    ffmpeg(inputPath)
      .noVideo()
      .audioCodec('libmp3lame')
      .audioBitrate(128)
      // -map_metadata -1 limpia metadatos originales
      // Cada par -metadata key=value debe ir en elementos separados del array
      // para que fluent-ffmpeg no intente dividir por espacios en Windows
      .outputOptions([
        '-map_metadata', '-1',
        '-metadata', `title=${title}`,
        '-metadata', `artist=${artist}`,
      ])
      .on('end',   ()  => resolve(outputPath))
      .on('error', err => { logErr('FFMPEG', err); reject(err); })
      .save(outputPath);
  });
}

// ══════════════════════════════════════════════════════════════════════
//   LETRAS
// ══════════════════════════════════════════════════════════════════════

async function fetchLyrics(query) {
  const parts  = query.split(' - ');
  const artist = parts.length > 1 ? parts[0].trim() : '';
  const song   = parts.length > 1 ? parts.slice(1).join(' - ').trim() : query.trim();
  if (!artist || !song) throw new Error('Formato: `!letra Artista - Canción`');

  log('LYRICS', `Buscando: "${artist} - ${song}"`);
  for (let i = 0; i < LYRICS_APIS.length; i++) {
    const url = LYRICS_APIS[i](artist, song);
    log('LYRICS', `API ${i + 1}`, url.slice(0, 70));
    try {
      const res = await axios.get(url, { timeout: 12000 });
      if (res.data?.lyrics && typeof res.data.lyrics === 'string') {
        log('LYRICS', `✅ API ${i + 1} OK`, `${res.data.lyrics.length} chars`);
        return { artist: res.data.artist || artist, song: res.data.title || song, lyrics: res.data.lyrics };
      }
    } catch (err) { logErr(`LYRICS-${i + 1}`, err); }
  }
  throw new Error(`No se encontró la letra de *"${song}"* de *${artist}*.\n_Verifica el nombre del artista y la canción._`);
}

// ══════════════════════════════════════════════════════════════════════
//   PLUGIN
// ══════════════════════════════════════════════════════════════════════

module.exports = {
  commands    : ['play', 'play2', 'letra', 'lyrics'],
  description : 'Descarga música (MP3) o video (MP4) y busca letras',
  category    : 'utilidades',

  async execute(ctx) {
    const { command, args, sock, remoteJid, msg, reply } = ctx;
    const query = args.join(' ').trim();

    // ── !letra / !lyrics ──────────────────────────────────────────
    if (['letra', 'lyrics'].includes(command)) {
      if (!query) return reply(`*[🎤] Letras*\n\nUso: \`!letra Artista - Canción\`\nEj: \`!letra Maneskin - Beggin\``);
      await ctx.react('🔍');
      try {
        const { artist, song, lyrics } = await fetchLyrics(query);
        return reply(`*[🎤] ${song}*\n_${artist}_\n\n` + lyrics.slice(0, 3800) + (lyrics.length > 3800 ? '\n\n_...letra truncada_' : ''));
      } catch (err) {
        logErr('LETRA-CMD', err);
        return reply(`*[❌] Error buscando letra:*\n\n${err.message}`);
      }
    }

    // ── !play / !play2 ────────────────────────────────────────────
    const isVideo = command === 'play2';
    if (!query) return reply(
      `*[${isVideo ? '🎥' : '🎵'}] ${isVideo ? 'Video' : 'Música'}*\n\n` +
      `Uso: \`!${command} <búsqueda o URL de YouTube>\`\n\n` +
      `Ej: \`!${command} Maneskin Beggin\``
    );

    if (!ffmpeg) {
      return reply(
        `*[❌] ffmpeg no está disponible.*\n\n` +
        `Ejecuta: \`npm install\` para instalar \`@ffmpeg-installer/ffmpeg\`\n` +
        `O instala ffmpeg en el sistema: https://ffmpeg.org/download.html`
      );
    }

    await ctx.react('⏳');
    log('CMD', `Iniciando ${isVideo ? 'video' : 'audio'}`, `"${query}"`);

    // Límite para enviar como audio/video normal en WhatsApp.
    // Archivos mayores a 100 MB se envían como documento.
    const WA_MEDIA_LIMIT = 100 * 1024 * 1024;  // 100 MB en bytes

    const tmpFiles = [];

    try {
      // 1. Buscar o normalizar URL
      const isURL = /youtube\.com|youtu\.be/.test(query);
      let ytUrl = isURL ? normalizeYouTubeUrl(query) : '';
      let ytTitle = isURL ? 'Video' : query;
      let ytThumb = null, ytAuthor = '', ytDuration = '';

      if (!isURL) {
        const r = await searchYT(query);
        ytUrl = r.url; ytTitle = r.title; ytThumb = r.thumbnail;
        ytAuthor = r.author; ytDuration = r.duration;
      } else {
        log('CMD', `URL directa`, ytUrl);
      }

      if (isVideo) {
        // ── VIDEO: descargar MP4 → reparar con ffmpeg ────────────
        const dlUrl  = await getDownloadLink(ytUrl, '720p');
        const rawMp4 = uniqueTmpPath(ytTitle, 'raw.mp4');
        const fixMp4 = uniqueTmpPath(ytTitle, 'mp4');
        tmpFiles.push(rawMp4, fixMp4);

        await downloadFile(dlUrl, rawMp4);
        await repairMP4(rawMp4, fixMp4);

        const buf    = fs.readFileSync(fixMp4);
        const sizeMB = (buf.length / 1024 / 1024).toFixed(2);
        log('CMD', `MP4 listo`, `${sizeMB} MB`);

        const caption =
          `🎥 *${ytTitle}*\n` +
          (ytAuthor   ? `👤 _${ytAuthor}_\n`   : '') +
          (ytDuration ? `⏱️ _${ytDuration}_\n` : '') +
          `📦 _${sizeMB} MB_\n\n_💨 𝘎𝘦𝘯𝘨𝘢𝘳 𝘉𝘰𝘵_`;

        if (buf.length > WA_MEDIA_LIMIT) {
          // Supera 16 MB → enviar como documento
          log('CMD', `Peso > 16 MB, enviando como documento`, `${sizeMB} MB`);
          await sock.sendMessage(remoteJid, {
            document : buf,
            mimetype : 'video/mp4',
            fileName : `${ytTitle.slice(0, 60)}.mp4`,
            caption,
          }, { quoted: msg });
        } else {
          await sock.sendMessage(remoteJid, {
            video   : buf,
            caption,
            mimetype: 'video/mp4',
          }, { quoted: msg });
        }

      } else {
        // ── AUDIO: descargar → convertir a MP3 con ffmpeg ────────
        const dlUrl   = await getDownloadLink(ytUrl, '128kbps');
        const rawFile = uniqueTmpPath(ytTitle, 'raw');
        const outMp3  = uniqueTmpPath(ytTitle, 'mp3');
        tmpFiles.push(rawFile, outMp3);

        await downloadFile(dlUrl, rawFile);
        await convertToMP3(rawFile, outMp3, { title: ytTitle, artist: ytAuthor || '𝘎𝘦𝘯𝘨𝘢𝘳 𝘉𝘰𝘵' });

        const buf    = fs.readFileSync(outMp3);
        const sizeMB = (buf.length / 1024 / 1024).toFixed(2);
        log('CMD', `MP3 listo`, `${sizeMB} MB`);

        const caption =
          `🎵 *${ytTitle}*\n` +
          (ytAuthor   ? `👤 _${ytAuthor}_\n`   : '') +
          (ytDuration ? `⏱️ _${ytDuration}_\n` : '') +
          `📦 _${sizeMB} MB_\n\n_💨 𝘎𝘦𝘯𝘨𝘢𝘳 𝘉𝘰𝘵_`;

        if (buf.length > WA_MEDIA_LIMIT) {
          await sock.sendMessage(remoteJid, {
            document : buf,
            mimetype : 'audio/mpeg',
            fileName : `${ytTitle.slice(0, 60)}.mp3`,
            caption,
          }, { quoted: msg });
        } else {
          // Audio normal: sin caption, sin mensaje aparte
          await sock.sendMessage(remoteJid, {
            audio   : buf,
            mimetype: 'audio/mpeg',
            ptt     : false,
          }, { quoted: msg });
        }
      }

      log('CMD', `✅ Completado`, ytTitle);
      await ctx.react('✅');

    } catch (err) {
      logErr('CMD', err);
      await ctx.react('❌');
      return reply(
        `*[❌] Error al descargar*\n\n${err.message}\n\n` +
        `_Intenta con otro término de búsqueda o una URL directa._`
      );
    } finally {
      // Limpiar TODOS los archivos temporales sin importar si hubo error
      tmpFiles.forEach(removeTmp);
    }
  },
};