// Cerca gli argomenti che stanno diventando virali su YouTube Shorts in tutto il mondo.
// Lo fa partire GitHub ogni mattina (vedi .github/workflows/scopri.yml) e salva il risultato
// in data/scoperte/, dove il sito lo legge.
//
// Prova in locale:  YOUTUBE_API_KEY=la-tua-chiave node scripts/scopri.mjs

import { mkdir, readFile, writeFile } from 'node:fs/promises';

const CHIAVE = process.env.YOUTUBE_API_KEY;
if (!CHIAVE) {
  // Il controllo automatico è spento finché non si aggiunge la chiave: esco senza errore
  console.log('Controllo automatico spento: per accenderlo aggiungi il segreto YOUTUBE_API_KEY nelle impostazioni del progetto su GitHub.');
  process.exit(0);
}

const CARTELLA = new URL('../data/scoperte/', import.meta.url);
const GIORNO = 86400000;
const GIORNI_INDIETRO = 3;        // Shorts usciti negli ultimi 3 giorni
const DURATA_MAX_SHORT = 180;
const TEMI_SALVATI = 40;
const GIORNI_STORICO = 30;

// Una ricerca per categoria di YouTube, così la classifica non è fatta solo di musica e intrattenimento
const CATEGORIE = [
  null,  // tutte
  '1',   // film e animazione
  '2',   // auto e motori
  '10',  // musica
  '15',  // animali
  '17',  // sport
  '19',  // viaggi
  '20',  // videogiochi
  '22',  // persone e blog
  '23',  // comicità
  '24',  // intrattenimento
  '26',  // fai da te e stile
  '27',  // istruzione
  '28',  // scienza e tecnologia
];

// Hashtag troppo generici per dire qualcosa sull'argomento
const GENERICI = new Set(`shorts short shortsvideo shortvideo shortsfeed shortsviral youtubeshorts ytshorts yt youtube
  viral viralvideo viralshorts viralshort trending trend trendingshorts fyp foryou foryoupage fypシ explore explorepage
  reels reel reelsinstagram instagram tiktok tiktokviral subscribe like likes comment share follow new video videos
  funny funnyvideo funnyshorts comedy meme memes lol love cute satisfying asmr music song edit edits capcut
  shortfeed shortsbeta shortsyoutube 1million 1m 100k 4k hd 2024 2025 2026 india usa uk`.split(/\s+/));

let crediti = 0;
async function chiama(risorsa, parametri, costo) {
  crediti += costo;
  const url = 'https://www.googleapis.com/youtube/v3/' + risorsa + '?' + new URLSearchParams({ ...parametri, key: CHIAVE });
  const r = await fetch(url);
  const dati = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = dati.error || {};
    const motivo = e.errors?.[0]?.reason || '';
    throw new Error(`YouTube ha risposto ${r.status} ${motivo}: ${e.message || 'errore sconosciuto'}`);
  }
  return dati;
}

const aGruppi = (lista, n) => Array.from({ length: Math.ceil(lista.length / n) }, (_, i) => lista.slice(i * n, i * n + n));
const mediana = (a) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
function durataSecondi(iso) {
  const m = /P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso || '');
  return m ? (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0) : null;
}
function hashtag(testo) {
  const trovati = new Set();
  for (const m of (testo || '').matchAll(/#([\p{L}\p{N}_]+)/gu)) {
    const t = m[1].toLowerCase();
    if (t.length < 3 || t.length > 30 || /^\d+$/.test(t) || GENERICI.has(t)) continue;
    trovati.add(t);
    if (trovati.size >= 8) break;   // chi mette 40 hashtag non deve contare 40 volte
  }
  return [...trovati];
}
const giornoYouTube = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(d);
const giornoItalia = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(d);

async function leggiJson(nome, def) {
  try { return JSON.parse(await readFile(new URL(nome, CARTELLA), 'utf8')); } catch { return def; }
}

// ---------- 1. Cerco gli Shorts più visti degli ultimi giorni ----------
const ora = new Date();
const dopo = new Date(ora - GIORNI_INDIETRO * GIORNO).toISOString();
const ids = new Set();
for (const categoria of CATEGORIE) {
  const par = {
    part: 'id', type: 'video', videoDuration: 'short', order: 'viewCount', maxResults: 50,
    publishedAfter: dopo, fields: 'items/id/videoId',
  };
  if (categoria) par.videoCategoryId = categoria;
  try {
    const d = await chiama('search', par, 100);
    (d.items || []).forEach((it) => it.id?.videoId && ids.add(it.id.videoId));
  } catch (e) {
    // una categoria che non esiste più non deve fermare tutto, i crediti finiti sì
    if (/quotaExceeded|dailyLimitExceeded|keyInvalid|accessNotConfigured|API key/.test(e.message)) throw e;
    console.warn('Categoria ' + categoria + ' saltata: ' + e.message);
  }
}
console.log(`Shorts trovati: ${ids.size}`);

// ---------- 2. Leggo i numeri di ogni Short ----------
const video = [];
for (const gruppo of aGruppi([...ids], 50)) {
  const d = await chiama('videos', {
    part: 'snippet,statistics,contentDetails', id: gruppo.join(','),
    fields: 'items(id,snippet(title,description,channelId,channelTitle,publishedAt,defaultLanguage,defaultAudioLanguage),statistics/viewCount,contentDetails/duration)',
  }, 1);
  for (const v of d.items || []) {
    const durata = durataSecondi(v.contentDetails?.duration);
    if (v.statistics?.viewCount == null || !durata || durata > DURATA_MAX_SHORT) continue;
    const giorni = Math.max((ora - new Date(v.snippet.publishedAt)) / GIORNO, 1);
    const views = +v.statistics.viewCount;
    video.push({
      id: v.id,
      titolo: v.snippet.title,
      canale: v.snippet.channelTitle,
      canaleId: v.snippet.channelId,
      lingua: (v.snippet.defaultAudioLanguage || v.snippet.defaultLanguage || '').slice(0, 2).toLowerCase() || null,
      views,
      vpd: views / giorni,
      temi: hashtag(v.snippet.title + ' ' + (v.snippet.description || '')),
    });
  }
}
console.log(`Shorts validi: ${video.length}`);

// ---------- 3. Raggruppo per hashtag e faccio la classifica ----------
const temi = new Map();
for (const v of video) {
  for (const t of v.temi) {
    if (!temi.has(t)) temi.set(t, []);
    temi.get(t).push(v);
  }
}
const classifica = [];
for (const [tag, lista] of temi) {
  const canali = new Map();
  lista.forEach((v) => { if (!canali.has(v.canaleId) || canali.get(v.canaleId).vpd < v.vpd) canali.set(v.canaleId, v); });
  if (lista.length < 2 || canali.size < 2) continue;   // serve più di un canale: un solo canale non fa un argomento
  // il punteggio somma lo Short migliore di ogni canale, così un canale che pubblica 10 volte non gonfia il tema
  const punteggio = [...canali.values()].reduce((a, v) => a + v.vpd, 0);
  const lingue = {};
  lista.forEach((v) => { if (v.lingua) lingue[v.lingua] = (lingue[v.lingua] || 0) + 1; });
  const lingua = Object.entries(lingue).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  classifica.push({
    tag,
    punteggio: Math.round(punteggio),
    shorts: lista.length,
    canali: canali.size,
    vpdTipico: Math.round(mediana(lista.map((v) => v.vpd))),
    viewsTotali: lista.reduce((a, v) => a + v.views, 0),
    lingua,
    esempi: [...canali.values()].sort((a, b) => b.vpd - a.vpd).slice(0, 3)
      .map((v) => ({ id: v.id, titolo: v.titolo, canale: v.canale, views: v.views, vpd: Math.round(v.vpd) })),
  });
}
classifica.sort((a, b) => b.punteggio - a.punteggio);
const top = classifica.slice(0, TEMI_SALVATI);

// ---------- 4. Confronto con i giorni prima ----------
const oggi = giornoItalia(ora);
const storico = (await leggiJson('storico.json', [])).filter((g) => g.data !== oggi);
const ieri = storico[storico.length - 1];
top.forEach((t, i) => {
  t.posizione = i + 1;
  const prima = ieri?.temi.find((x) => x.tag === t.tag);
  t.variazione = prima ? prima.posizione - t.posizione : null;   // positivo = è salito
  let giorni = 1;
  for (let k = storico.length - 1; k >= 0 && storico[k].temi.some((x) => x.tag === t.tag); k--) giorni++;
  t.giorniInClassifica = giorni;
  t.nuovo = !storico.some((g) => g.temi.some((x) => x.tag === t.tag));
});
storico.push({ data: oggi, temi: top.map((t) => ({ tag: t.tag, posizione: t.posizione, punteggio: t.punteggio })) });

await mkdir(CARTELLA, { recursive: true });
await writeFile(new URL('storico.json', CARTELLA), JSON.stringify(storico.slice(-GIORNI_STORICO)) + '\n');
await writeFile(new URL('ultimo.json', CARTELLA), JSON.stringify({
  aggiornato: ora.toISOString(),
  giorno: oggi,
  giornoYouTube: giornoYouTube(ora),
  crediti,
  shortsAnalizzati: video.length,
  giorniIndietro: GIORNI_INDIETRO,
  temi: top,
}, null, 1) + '\n');

console.log(`Fatto: ${top.length} argomenti salvati, ${crediti} crediti usati.`);
top.slice(0, 10).forEach((t) => console.log(`${t.posizione}. #${t.tag}  ${t.shorts} Shorts, ${t.canali} canali`));
