// Notula — appunti di riunione e chiamate: registrazione, trascrizione con parlanti, note AI, mappe mentali.
// Tutto nel browser: testi in localStorage, audio in IndexedDB.
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const IS_IOS = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const IS_MOBILE = IS_IOS || /Android/i.test(navigator.userAgent);

/* ---------- Storage ---------- */
const mem = {};
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return mem[k] ?? d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { mem[k] = v; toast('Spazio locale pieno o non disponibile'); } },
};
let meetings = store.get('notula.meetings', []);
let settings = Object.assign(
  { lang: 'it-IT', myName: '', gkey: '', asr: 'gemini', groqKey: '', speaker: false, provider: 'gemini', base: '', model: '', key: '' },
  store.get('notula.settings', {}),
);
// Migrazione dalla versione precedente (chiave Gemini nel campo generico, motore "whisper").
if (!settings.gkey && settings.provider === 'gemini' && settings.key) settings.gkey = settings.key;
if (settings.asr === 'whisper') settings.asr = 'groq';
if (settings.provider === 'none') settings.provider = 'gemini';
const saveMeetings = () => store.set('notula.meetings', meetings);

// Segmenti audio in IndexedDB: chiave "<meetingId>:<canale>:<indice>".
const idb = (() => {
  let dbp;
  const open = () => (dbp ??= new Promise((res, rej) => {
    const r = indexedDB.open('notula', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('segments', { keyPath: 'key' });
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
  const tx = async (mode, fn) => { const db = await open(); return new Promise((res, rej) => { const t = db.transaction('segments', mode); const out = fn(t.objectStore('segments')); t.oncomplete = () => res(out?.result ?? out); t.onerror = () => rej(t.error); }); };
  return {
    put: (seg) => tx('readwrite', (s) => s.put(seg)),
    list: (mid) => tx('readonly', (s) => s.getAll(IDBKeyRange.bound(`${mid}:`, `${mid}:￿`))),
    del: (mid) => tx('readwrite', (s) => s.delete(IDBKeyRange.bound(`${mid}:`, `${mid}:￿`))),
  };
})();

/* ---------- Template ---------- */
const TEMPLATES = {
  generico: { name: 'Generico', guide: 'Sezioni: Sintesi (3 righe), Punti discussi, Decisioni, Prossimi passi (chi/cosa/quando).' },
  telefonata: { name: 'Telefonata', guide: 'Sezioni: Motivo della chiamata, Cosa ha detto il chiamante, Cosa ha detto il chiamato, Accordi presi, Prossimi passi (chi/cosa/quando).' },
  commerciale: { name: 'Call commerciale', guide: 'Sezioni: Contesto cliente, Esigenze e pain point, Budget/tempistiche/decisori, Obiezioni, Concorrenza citata, Prossimi passi e impegni presi.' },
  oneToOne: { name: '1:1', guide: 'Sezioni: Aggiornamenti, Blocchi, Feedback (dato/ricevuto), Obiettivi, Azioni.' },
  standup: { name: 'Stand-up', guide: 'Per ogni persona: Fatto, Da fare, Blocchi. Poi Azioni comuni.' },
  intervista: { name: 'Colloquio', guide: 'Sezioni: Profilo candidato, Esperienze rilevanti, Punti di forza, Dubbi, Valutazione, Prossimi passi.' },
  cliente: { name: 'Audit / visita cliente', guide: 'Sezioni: Partecipanti, Ambito, Rilievi/osservazioni, Rischi, Richieste del cliente, Azioni correttive con responsabili e scadenze.' },
};

/* ---------- Utilità ---------- */
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const fmtDate = (t) => new Date(t).toLocaleString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const mmss = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
const parseTs = (s) => { const p = String(s || '0').split(':').map(Number); return (p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p.length === 2 ? p[0] * 60 + p[1] : p[0]) * 1000 || 0; };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function toast(msg, ms = 3000) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => (t.hidden = true), ms); }

function md(src) {
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*(?!\s)(.+?)\*/g, '$1<i>$2</i>');
  let html = '', depth = 0;
  for (const raw of String(src).split('\n')) {
    const line = raw.trimEnd();
    const li = line.match(/^(\s*)[-*•]\s+(.*)/);
    if (li) {
      const d = Math.floor(li[1].replace(/\t/g, '  ').length / 2) + 1;
      while (depth < d) { html += '<ul>'; depth++; }
      while (depth > d) { html += '</ul>'; depth--; }
      html += `<li>${inline(li[2])}</li>`; continue;
    }
    while (depth) { html += '</ul>'; depth--; }
    const h = line.match(/^(#{1,3})\s+(.*)/);
    if (h) html += `<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`;
    else if (line.trim()) html += `<p>${inline(line)}</p>`;
  }
  while (depth) { html += '</ul>'; depth--; }
  return html;
}

/* ---------- Parlanti ---------- */
const meLabel = (m) => {
  const n = settings.myName || 'Io';
  return m.role === 'chiamante' ? `${n} (chiamante)` : m.role === 'chiamato' ? `${n} (chiamato)` : n;
};
const otherLabel = (m) => {
  const n = m.contact || 'Interlocutore';
  return m.role === 'chiamante' ? `${n} (chiamato)` : m.role === 'chiamato' ? `${n} (chiamante)` : n;
};

/* ---------- Lista ---------- */
function renderList() {
  const q = $('#search').value.trim().toLowerCase();
  const items = meetings
    .filter((m) => !q || [m.title, m.contact, m.notes, m.enhanced, m.transcript.map((x) => x.text).join(' ')].join(' ').toLowerCase().includes(q))
    .sort((a, b) => b.created - a.created);
  $('#meetings').innerHTML = items.map((m) => `
    <li data-id="${m.id}"><b>${esc(m.title || 'Senza titolo')}</b>
    <span>${fmtDate(m.created)} · ${TEMPLATES[m.template]?.name ?? ''}${m.contact ? ` · ${esc(m.contact)}` : ''}${m.duration ? ` · ${mmss(m.duration)}` : ''}</span>
    <p>${esc((m.enhanced || m.notes || m.transcript.map((x) => x.text).join(' ')).replace(/[#*]+|^\s*-\s/gm, '').replace(/\s+/g, ' ').trim().slice(0, 180))}</p></li>`).join('');
  $('#empty').hidden = meetings.length > 0;
}
$('#meetings').addEventListener('click', (e) => { const li = e.target.closest('li'); if (li) openMeeting(li.dataset.id); });
$('#search').addEventListener('input', renderList);
function newMeeting(extra = {}) {
  const m = { id: uid(), title: '', created: Date.now(), template: 'generico', notes: '', enhanced: '', mindmap: '', transcript: [], chat: [], duration: 0, contact: '', phone: '', role: '', segs: {}, ...extra };
  meetings.push(m); saveMeetings(); return m;
}
$('#btn-new').addEventListener('click', () => { const m = newMeeting(); openMeeting(m.id); $('#m-title').focus(); });

/* ---------- Riunione ---------- */
let cur = null;
const tplSel = $('#m-template');
tplSel.innerHTML = Object.entries(TEMPLATES).map(([k, t]) => `<option value="${k}">${t.name}</option>`).join('');

function openMeeting(id) {
  cur = meetings.find((m) => m.id === id);
  cur.segs ??= {}; cur.mindmap ??= '';
  $('#m-title').value = cur.title; $('#m-notes').value = cur.notes; tplSel.value = cur.template;
  $('#m-contact').value = cur.contact || ''; $('#m-phone').value = cur.phone || ''; $('#m-role').value = cur.role || '';
  $('#m-people').open = !!(cur.contact || cur.phone);
  $('#m-date').textContent = fmtDate(cur.created);
  renderTranscript(); renderEnhanced(); renderMap(); renderChat();
  showTab(cur.enhanced ? 'enhanced' : 'notes');
  $('#rec-time').textContent = mmss(cur.duration || 0);
  $('#view-list').hidden = true; $('#view-meeting').hidden = false;
  history.pushState({ m: id }, '');
}
function closeMeeting() {
  if (rec.on) stopRec();
  if (cur && !cur.title && !cur.notes && !cur.transcript.length && !Object.keys(cur.segs).length) meetings = meetings.filter((m) => m !== cur);
  saveMeetings(); cur = null;
  $('#view-meeting').hidden = true; $('#view-list').hidden = false; renderList();
}
$('#btn-back').addEventListener('click', () => history.back());
window.addEventListener('popstate', () => { if (cur) closeMeeting(); });

let saveT;
const autosave = () => { clearTimeout(saveT); saveT = setTimeout(saveMeetings, 400); };
const bind = (sel, key) => $(sel).addEventListener('input', (e) => { cur[key] = e.target.value; autosave(); });
bind('#m-title', 'title'); bind('#m-notes', 'notes'); bind('#m-contact', 'contact'); bind('#m-phone', 'phone');
$('#m-role').addEventListener('change', (e) => { cur.role = e.target.value; if (cur.role && cur.template === 'generico') { cur.template = 'telefonata'; tplSel.value = 'telefonata'; } autosave(); });
tplSel.addEventListener('change', (e) => { cur.template = e.target.value; autosave(); });

function showTab(name) {
  $$('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  $$('.pane').forEach((p) => (p.hidden = p.dataset.pane !== name));
  if (name === 'map') renderMap();
}
$('.tabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) showTab(b.dataset.tab); });

function renderTranscript() {
  if (!cur) return;
  const speakers = [...new Set(cur.transcript.map((x) => x.who).filter(Boolean))];
  $('#m-transcript').innerHTML = cur.transcript.map((x) => `<li><time>${mmss(x.t)}</time>${x.who ? `<b class="who s${speakers.indexOf(x.who) % 4}">${esc(x.who)}</b>` : ''}${esc(x.text)}</li>`).join('')
    || '<li class="muted">Nessuna trascrizione. Tocca Registra o importa un audio da ⋯.</li>';
  const st = Object.values(cur.segs);
  const pend = st.filter((s) => s === 'pending').length, err = st.filter((s) => s === 'error').length;
  const el = $('#seg-status');
  el.hidden = !pend && !err;
  el.innerHTML = `${pend ? `Trascrizione in corso: ${pend} blocc${pend > 1 ? 'hi' : 'o'}… ` : ''}${err ? `<b>${err} blocc${err > 1 ? 'hi' : 'o'} non trascritt${err > 1 ? 'i' : 'o'}.</b> <button type="button" id="btn-retry" class="link">Riprova</button>` : ''}`;
  $('#btn-retry')?.addEventListener('click', () => retranscribe(cur, true));
}
function renderEnhanced() { $('#m-enhanced').innerHTML = cur.enhanced ? md(cur.enhanced) : ''; $('#enh-empty').hidden = !!cur.enhanced; }
function renderChat() {
  $('#chat-log').innerHTML = cur.chat.map((c) => `<div class="${c.role === 'user' ? 'q' : 'a md'}">${c.role === 'user' ? esc(c.text) : md(c.text)}</div>`).join('');
}

/* ---------- Mappa mentale ---------- */
function parseTree(src) {
  const lines = String(src).split('\n').filter((l) => l.trim());
  const root = { text: (lines.find((l) => /^#/.test(l)) || '# Riunione').replace(/^#+\s*/, ''), children: [] };
  const stack = [{ node: root, d: -1 }];
  for (const l of lines) {
    const m = l.match(/^(\s*)[-*•]\s+(.*)/); if (!m) continue;
    const d = Math.floor(m[1].replace(/\t/g, '  ').length / 2);
    const node = { text: m[2].replace(/\*\*/g, ''), children: [] };
    while (stack.length > 1 && stack[stack.length - 1].d >= d) stack.pop();
    stack[stack.length - 1].node.children.push(node); stack.push({ node, d });
  }
  return root;
}
const clean = (s) => String(s).replace(/[()[\]{}<>"'`:;|#]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || '…';
function toMermaid(tree) {
  const out = ['mindmap', `  root((${clean(tree.text)}))`];
  const walk = (n, d) => n.children.forEach((c) => { out.push(`${'  '.repeat(d)}${clean(c.text)}`); walk(c, d + 1); });
  walk(tree, 2);
  return out.join('\n');
}
let mermaidP;
async function renderMap() {
  const box = $('#m-map');
  $('#map-empty').hidden = !!cur?.mindmap;
  if (!cur?.mindmap) { box.innerHTML = ''; delete box.dataset.src; delete box.dataset.svg; return; }
  if (box.dataset.svg === cur.mindmap) return; // grafico già disegnato
  const tree = parseTree(cur.mindmap);
  if (box.dataset.src !== cur.mindmap) {
    box.dataset.src = cur.mindmap; delete box.dataset.svg;
    box.innerHTML = `<div class="md"><h2>${esc(tree.text)}</h2>${md(cur.mindmap.replace(/^#.*$/m, ''))}</div>`;
  }
  if ($('[data-pane="map"]').hidden) return; // il grafico si disegna quando la scheda è visibile
  try {
    mermaidP ??= import('https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.esm.min.mjs').then((m) => {
      const dark = matchMedia('(prefers-color-scheme: dark)').matches;
      m.default.initialize({ startOnLoad: false, theme: dark ? 'dark' : 'neutral', securityLevel: 'strict' });
      return m.default;
    });
    const mermaid = await mermaidP;
    const { svg } = await mermaid.render(`mm${Date.now()}`, toMermaid(tree));
    if (box.dataset.src === cur.mindmap) { box.innerHTML = svg; box.dataset.svg = cur.mindmap; }
  } catch { /* offline o errore: resta l'elenco */ }
}

/* ---------- Audio: registrazione a blocchi ---------- */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const CAN_TAB_AUDIO = !!navigator.mediaDevices?.getDisplayMedia && !IS_MOBILE;
const SEG_MS = window.__NOTULA_SEG_MS || 60000; // sovrascrivibile solo nei test
const rec = { on: false, sr: null, start: 0, base: 0, timer: null, wake: null, recorders: [], streams: [], meeting: null };

function pickMime() {
  for (const m of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']) if (window.MediaRecorder?.isTypeSupported?.(m)) return m;
  return '';
}
const segKeyOf = (key) => { const [, ch, idx] = key.split(':'); return `${ch}:${Number(idx)}`; };
// Ogni blocco è un file autonomo (stop/riavvio) salvato subito: se l'app viene chiusa si perde al massimo un minuto.
function segRecorder(stream, channel, m) {
  const mime = pickMime(); const st = { active: true, mr: null };
  const cycle = () => {
    if (!st.active || !stream.active) return;
    const t0 = m.duration || 0; const parts = [];
    const mr = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 32000 }); st.mr = mr;
    mr.ondataavailable = (e) => e.data.size && parts.push(e.data);
    mr.onstop = async () => {
      const blob = new Blob(parts, { type: mr.mimeType || mime || 'audio/webm' });
      if (blob.size > 4000) {
        const idx = Object.keys(m.segs).filter((k) => k.startsWith(channel + ':')).length;
        const seg = { key: `${m.id}:${channel}:${String(idx).padStart(4, '0')}`, channel, t0, blob };
        m.segs[segKeyOf(seg.key)] = 'pending'; saveMeetings();
        try { await idb.put(seg); } catch { /* senza IndexedDB si trascrive comunque */ }
        transcribeSeg(m, seg);
      }
      cycle();
    };
    mr.start(); setTimeout(() => mr.state !== 'inactive' && mr.stop(), SEG_MS);
  };
  cycle();
  return { stop() { st.active = false; if (st.mr?.state === 'recording') st.mr.stop(); } };
}

function startTimer() {
  rec.base = cur.duration || 0; rec.start = Date.now();
  rec.timer = setInterval(() => { rec.meeting.duration = rec.base + Date.now() - rec.start; if (cur === rec.meeting) $('#rec-time').textContent = mmss(rec.meeting.duration); }, 500);
  navigator.wakeLock?.request('screen').then((w) => { rec.wake = w; }).catch(() => {});
}
function needKeyFor(asr) {
  if (asr === 'gemini' && !settings.gkey) return 'Inserisci la chiave Gemini in ⚙︎ Impostazioni.';
  if (asr === 'groq' && !settings.groqKey) return 'Inserisci la chiave Groq in ⚙︎ Impostazioni.';
  if (asr === 'browser' && !SR) return 'Questo browser non ha il riconoscimento vocale: scegli Gemini in ⚙︎.';
  return '';
}
async function startRec() {
  const miss = needKeyFor(settings.asr); if (miss) { toast(miss, 5000); return false; }
  let mic;
  try {
    mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: !settings.speaker, noiseSuppression: !settings.speaker, autoGainControl: true } });
  } catch (e) { toast(`Microfono non disponibile: ${e.name === 'NotAllowedError' ? 'permesso negato (Impostazioni → Safari/Chrome → Microfono)' : e.message}`, 6000); return false; }
  rec.on = true; rec.meeting = cur; startTimer();
  $('#btn-rec').classList.add('on'); $('#rec-label').textContent = 'Stop';
  rec.streams.push(mic);
  if (settings.asr !== 'browser') rec.recorders.push(segRecorder(mic, 'mic', cur));
  if (SR) listen(); // anteprima live (o trascrizione, se il motore è "browser")
  showTab('transcript');
  if (IS_IOS) toast('Tieni Notula aperta e lo schermo acceso: iOS sospende il microfono in background.', 5000);
  return true;
}
async function startCallAudio() {
  if (settings.asr === 'browser') { toast("L'audio della scheda richiede Gemini o Groq come motore.", 5000); return; }
  try {
    const s = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true, systemAudio: 'include' });
    s.getVideoTracks().forEach((t) => t.stop());
    if (!s.getAudioTracks().length) { toast('Nessun audio condiviso: scegli la scheda della call e attiva "Condividi audio".', 6000); return; }
    if (!rec.on && !(await startRec())) { s.getTracks().forEach((t) => t.stop()); return; }
    const audio = new MediaStream(s.getAudioTracks());
    rec.streams.push(audio); rec.recorders.push(segRecorder(audio, 'tab', cur));
    $('#btn-call').classList.add('on');
    s.getAudioTracks()[0].addEventListener('ended', () => $('#btn-call').classList.remove('on'));
    toast('Audio della scheda collegato');
  } catch { /* annullato */ }
}
function listen() {
  const sr = new SR();
  sr.lang = settings.lang; sr.continuous = true; sr.interimResults = true;
  sr.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal && settings.asr === 'browser') addLines(rec.meeting, [{ t: rec.meeting.duration, who: meLabel(rec.meeting), text: r[0].transcript }]);
      else if (!r.isFinal) interim += r[0].transcript;
    }
    $('#interim').textContent = interim ? `… ${interim}` : '';
  };
  sr.onerror = () => {};
  sr.onend = () => { if (rec.on) setTimeout(() => rec.on && listen(), 300); };
  rec.sr = sr;
  try { sr.start(); } catch {}
}
function stopRec() {
  const m = rec.meeting;
  if (rec.on && m) m.duration = rec.base + Date.now() - rec.start;
  rec.on = false; clearInterval(rec.timer);
  try { rec.sr?.stop(); } catch {}
  rec.recorders.forEach((c) => c.stop()); rec.recorders = [];
  setTimeout(() => { rec.streams.forEach((s) => s.getTracks().forEach((t) => t.stop())); rec.streams = []; }, 400);
  rec.wake?.release?.(); rec.wake = null;
  $('#btn-rec').classList.remove('on'); $('#btn-call').classList.remove('on');
  $('#rec-label').textContent = 'Registra'; $('#interim').textContent = '';
  saveMeetings();
}
$('#btn-rec').addEventListener('click', () => (rec.on ? stopRec() : startRec()));
$('#btn-call').hidden = !CAN_TAB_AUDIO;
$('#btn-call').addEventListener('click', startCallAudio);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && rec.on) navigator.wakeLock?.request('screen').then((w) => { rec.wake = w; }).catch(() => {});
});

/* ---------- Chiamate ---------- */
$('#btn-dial').addEventListener('click', async () => {
  const num = (cur.phone || '').replace(/[^\d+]/g, '');
  if (!num) { toast('Inserisci il numero di telefono'); $('#m-phone').focus(); return; }
  if (!cur.role) { cur.role = 'chiamante'; $('#m-role').value = 'chiamante'; }
  if (cur.template === 'generico') { cur.template = 'telefonata'; tplSel.value = 'telefonata'; }
  if (!cur.title) { cur.title = `Chiamata con ${cur.contact || num}`; $('#m-title').value = cur.title; }
  saveMeetings();
  if (IS_MOBILE) { $('#dlg-phone').showModal(); return; }
  // Mac: tel: apre FaceTime, che chiama tramite l'iPhone (Continuity). Notula registra dal microfono in vivavoce.
  if (!settings.speaker) { settings.speaker = true; store.set('notula.settings', settings); toast('Modalità vivavoce attivata: usa gli altoparlanti del Mac, non le cuffie.', 5000); }
  if (!rec.on) await startRec();
  location.href = `tel:${num}`;
});
$('#dlg-phone').addEventListener('close', () => {
  if ($('#dlg-phone').returnValue === 'dial') location.href = `tel:${(cur.phone || '').replace(/[^\d+]/g, '')}`;
});

/* ---------- Trascrizione ---------- */
// Decodifica e converte in WAV 16 kHz mono (formato accettato da tutti i motori).
async function decode16k(blob) {
  const buf = await blob.arrayBuffer();
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx({ sampleRate: 16000 });
  try {
    const ab = await ctx.decodeAudioData(buf.slice(0));
    const n = ab.length, out = new Float32Array(n);
    for (let c = 0; c < ab.numberOfChannels; c++) { const d = ab.getChannelData(c); for (let i = 0; i < n; i++) out[i] += d[i] / ab.numberOfChannels; }
    if (ab.sampleRate === 16000) return out;
    const ratio = ab.sampleRate / 16000, res = new Float32Array(Math.floor(n / ratio));
    for (let i = 0; i < res.length; i++) res[i] = out[Math.floor(i * ratio)];
    return res;
  } finally { ctx.close?.(); }
}
function wav(samples) {
  const b = new ArrayBuffer(44 + samples.length * 2), v = new DataView(b);
  const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 16000, true); v.setUint32(28, 32000, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 0x7fff, true);
  return new Blob([b], { type: 'audio/wav' });
}
const rms = (s) => { let a = 0, n = 0; for (let i = 0; i < s.length; i += 16) { a += s[i] * s[i]; n++; } return Math.sqrt(a / (n || 1)); };
const b64 = (blob) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.readAsDataURL(blob); });
const WHISPER_NOISE = /^(?:sottotitoli\b.*|.*amara\.org.*|grazie (?:a tutti )?per (?:la visione|l'attenzione|l'ascolto).*|thank you\W*|you\W*|\W*)$/i;

async function geminiAudio(wavBlob, m, channel, context) {
  const lang = $('#s-lang').querySelector(`option[value="${settings.lang}"]`)?.textContent || 'italiano';
  const me = meLabel(m), other = otherLabel(m);
  const who = channel === 'mic' && Object.keys(m.segs).some((k) => k.startsWith('tab:'))
    ? `Su questo canale parla solo "${me}".`
    : channel === 'tab' ? `Su questo canale parlano gli interlocutori remoti: usa "${other}" se è uno solo, altrimenti "${other}", "Interlocutore 2", ecc. (o nomi propri se si presentano).`
      : `Parlanti attesi: "${me}" (l'utente) e "${other}". Distinguili dalla voce e dal contesto (chi pone domande, chi risponde, chi si presenta). Se ci sono altre persone usa "Interlocutore 2", "Interlocutore 3" o i loro nomi se emergono.`;
  const prompt = `Trascrivi parola per parola questo audio in ${lang}. Non riassumere, non tradurre, non correggere lo stile. ${who}
Contesto (ultime battute già trascritte, per mantenere coerenti le etichette): ${context || 'nessuno'}
Dividi in battute: ogni cambio di parlante è una nuova voce. "t" è il minuto:secondo d'inizio della battuta dentro questo audio.
Se l'audio è silenzio o rumore restituisci [].`;
  const model = settings.asrModel || 'gemini-2.5-flash';
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': settings.gkey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ inline_data: { mime_type: 'audio/wav', data: await b64(wavBlob) } }, { text: prompt }] }],
      generationConfig: {
        temperature: 0, responseMimeType: 'application/json',
        responseSchema: { type: 'ARRAY', items: { type: 'OBJECT', properties: { t: { type: 'STRING' }, speaker: { type: 'STRING' }, text: { type: 'STRING' } }, required: ['t', 'speaker', 'text'] } },
      },
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error?.message || `Gemini ${r.status}`), { status: r.status });
  const txt = j.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '[]';
  return JSON.parse(txt).map((x) => ({ dt: parseTs(x.t), who: x.speaker, text: x.text }));
}
async function groqAudio(wavBlob, m, channel) {
  const fd = new FormData();
  fd.append('file', wavBlob, 'audio.wav'); fd.append('model', 'whisper-large-v3-turbo');
  fd.append('language', settings.lang.slice(0, 2)); fd.append('response_format', 'verbose_json');
  const r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${settings.groqKey}` }, body: fd });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error?.message || `Groq ${r.status}`), { status: r.status });
  const who = channel === 'tab' ? otherLabel(m) : channel === 'mic' && Object.keys(m.segs).some((k) => k.startsWith('tab:')) ? meLabel(m) : '';
  return (j.segments || [{ start: 0, text: j.text }]).map((s) => ({ dt: (s.start || 0) * 1000, who, text: s.text }));
}

function addLines(m, lines, segKey) {
  if (segKey) m.transcript = m.transcript.filter((x) => x.seg !== segKey);
  for (const l of lines) { const text = String(l.text || '').trim(); if (text && !WHISPER_NOISE.test(text)) m.transcript.push({ t: l.t, who: l.who || '', text, ...(segKey ? { seg: segKey } : {}) }); }
  m.transcript.sort((a, b) => a.t - b.t);
  saveMeetings();
  if (cur === m) { renderTranscript(); const p = $('[data-pane="transcript"]'); p.scrollTop = p.scrollHeight; }
}
const queue = []; let busy = false;
function transcribeSeg(m, seg) { m.segs[segKeyOf(seg.key)] = 'pending'; if (cur === m) renderTranscript(); queue.push({ m, seg }); pump(); }
async function pump() {
  if (busy) return; busy = true;
  while (queue.length) {
    const { m, seg } = queue.shift(); const sk = segKeyOf(seg.key);
    let attempt = 0;
    for (;;) {
      try {
        const samples = await decode16k(seg.blob);
        if (rms(samples) < 0.002) { m.segs[sk] = 'ok'; break; }
        const context = m.transcript.slice(-4).map((x) => `${x.who}: ${x.text}`).join(' | ');
        const engine = settings.asr === 'groq' ? groqAudio : geminiAudio;
        const lines = await engine(wav(samples), m, seg.channel, context);
        addLines(m, lines.map((l) => ({ ...l, t: seg.t0 + l.dt })), seg.key);
        m.segs[sk] = 'ok'; break;
      } catch (err) {
        if ((err.status === 429 || err.status >= 500) && attempt < 4) { attempt++; await sleep(8000 * attempt); continue; }
        m.segs[sk] = 'error'; toast(`Trascrizione non riuscita: ${err.message}`, 6000); break;
      }
    }
    saveMeetings(); if (cur === m) renderTranscript();
    await sleep(1200); // rispetta i limiti dei piani gratuiti
  }
  busy = false;
}
async function retranscribe(m, onlyErrors = false) {
  let segs;
  try { segs = await idb.list(m.id); } catch { segs = []; }
  if (!segs.length) { toast('Nessun audio salvato per questa riunione.'); return; }
  const miss = needKeyFor(settings.asr === 'browser' ? 'gemini' : settings.asr); if (miss) { toast(miss, 5000); return; }
  segs.sort((a, b) => a.t0 - b.t0 || a.key.localeCompare(b.key));
  if (!onlyErrors) m.transcript = m.transcript.filter((x) => !x.seg);
  for (const s of segs) if (!onlyErrors || m.segs[segKeyOf(s.key)] === 'error') transcribeSeg(m, s);
  showTab('transcript');
}

// Import di un file audio (es. registrazione di chiamata dall'iPhone) diviso in blocchi da 4 minuti.
async function importAudio(file) {
  const m = cur;
  const miss = needKeyFor(settings.asr === 'browser' ? 'gemini' : settings.asr); if (miss) { toast(miss, 5000); return; }
  toast('Decodifico l\'audio…', 8000);
  let samples;
  try { samples = await decode16k(file); } catch { toast('Formato audio non leggibile da questo browser. Prova un file .m4a, .mp3 o .wav.', 7000); return; }
  const CH = 16000 * 240; const base = m.duration || 0;
  const n = Object.keys(m.segs).filter((k) => k.startsWith('imp:')).length;
  for (let i = 0, k = n; i < samples.length; i += CH, k++) {
    const part = samples.subarray(i, Math.min(samples.length, i + CH));
    const seg = { key: `${m.id}:imp:${String(k).padStart(4, '0')}`, channel: 'imp', t0: base + (i / 16000) * 1000, blob: wav(part) };
    try { await idb.put(seg); } catch {}
    transcribeSeg(m, seg);
  }
  m.duration = base + (samples.length / 16000) * 1000; if (cur === m) $('#rec-time').textContent = mmss(m.duration);
  if (!m.title) { m.title = file.name.replace(/\.[^.]+$/, ''); if (cur === m) $('#m-title').value = m.title; }
  saveMeetings(); showTab('transcript');
}
$('#audio-file').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importAudio(f); });

/* ---------- AI testuale ---------- */
async function llm(system, user) {
  if (settings.provider !== 'openai') {
    if (!settings.gkey) throw new Error('Inserisci la chiave Gemini in ⚙︎ Impostazioni.');
    const model = settings.model || 'gemini-2.5-flash';
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': settings.gkey },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: user }] }], generationConfig: { temperature: 0.3 } }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error?.message || `Errore Gemini ${r.status}`);
    return j.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? '';
  }
  const base = (settings.base || 'https://api.groq.com/openai/v1').replace(/\/$/, '');
  const r = await fetch(`${base}/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(settings.key ? { Authorization: `Bearer ${settings.key}` } : {}) },
    body: JSON.stringify({ model: settings.model || 'llama-3.3-70b-versatile', temperature: 0.3, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error?.message || `Errore API ${r.status}`);
  return j.choices?.[0]?.message?.content ?? '';
}
const transcriptText = (m) => m.transcript.map((x) => `[${mmss(x.t)}] ${x.who ? x.who + ': ' : ''}${x.text}`).join('\n');
const langName = () => (settings.lang.startsWith('it') ? 'italiano' : 'la lingua della trascrizione');

$('#btn-enhance').addEventListener('click', async () => {
  if (rec.on) stopRec();
  const m = cur;
  if (!m.notes.trim() && !m.transcript.length) { toast('Nessun appunto né trascrizione da elaborare.'); return; }
  if (Object.values(m.segs).includes('pending')) toast('Alcuni blocchi sono ancora in trascrizione: rielabora al termine per includerli.', 5000);
  const btn = $('#btn-enhance'); btn.disabled = true; btn.textContent = 'Elaboro…';
  const ctx = `TITOLO: ${m.title || '(nessuno)'}\nDATA: ${fmtDate(m.created)}\nUTENTE: ${meLabel(m)}\nINTERLOCUTORE: ${otherLabel(m)}\n\nAPPUNTI:\n${m.notes || '(nessuno)'}\n\nTRASCRIZIONE:\n${transcriptText(m) || '(nessuna)'}`;
  const system = `Redigi il verbale in ${langName()}.
Regole:
- Gli APPUNTI dell'utente sono lo scheletro: mantieni i suoi punti, l'ordine e la terminologia; espandili con i dettagli della TRASCRIZIONE.
- Attribuisci ogni affermazione, richiesta e impegno a chi l'ha detto, usando le etichette dei parlanti.
- Aggiungi ciò che di importante la trascrizione contiene e gli appunti non coprono.
- Non inventare nulla. Se un dato (nome, cifra, data) è incerto scrivi "(da verificare)".
- Struttura: ${TEMPLATES[m.template].guide}
- Solo Markdown: titoli ##, elenchi "-", grassetto **. Conciso, nessun preambolo.`;
  const mapSystem = `Crea una mappa mentale della conversazione in ${langName()}.
Formato obbligatorio, nient'altro:
# Tema centrale (max 5 parole)
- Ramo principale
  - sotto-punto
    - dettaglio
Massimo 6 rami principali, 3 livelli, testi di massimo 7 parole. Includi un ramo "Prossimi passi" con chi/cosa/quando se presenti.`;
  try {
    const [notes, map] = await Promise.allSettled([llm(system, ctx), llm(mapSystem, ctx)]);
    if (notes.status === 'rejected') throw notes.reason;
    m.enhanced = notes.value.trim();
    if (map.status === 'fulfilled') m.mindmap = map.value.replace(/```\w*/g, '').trim();
    if (!m.title) { const h = parseTree(m.mindmap || '').text; if (h && h !== 'Riunione') m.title = h; }
    saveMeetings();
    if (cur === m) { renderEnhanced(); showTab('enhanced'); renderMap(); $('#m-title').value = m.title; }
    if (map.status === 'rejected') toast(`Mappa non generata: ${map.reason.message}`, 5000);
  } catch (err) { toast(err.message, 6000); }
  btn.disabled = false; btn.textContent = '✦ Migliora';
});

$('#chat-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const m = cur; const q = $('#chat-input').value.trim(); if (!q) return;
  $('#chat-input').value = ''; m.chat.push({ role: 'user', text: q }); renderChat();
  const system = 'Rispondi alle domande sulla conversazione usando solo appunti, note e trascrizione forniti. Se l\'informazione non c\'è, dillo. Indica chi l\'ha detto e il minuto [mm:ss]. Risposte brevi, in Markdown.';
  const hist = m.chat.slice(-8).map((c) => `${c.role === 'user' ? 'Domanda' : 'Risposta'}: ${c.text}`).join('\n');
  const ctx = `APPUNTI:\n${m.notes}\n\nNOTE AI:\n${m.enhanced}\n\nTRASCRIZIONE:\n${transcriptText(m)}\n\nCONVERSAZIONE:\n${hist}`;
  try { m.chat.push({ role: 'ai', text: (await llm(system, ctx)).trim() }); }
  catch (err) { m.chat.push({ role: 'ai', text: `⚠︎ ${err.message}` }); }
  saveMeetings(); if (cur === m) { renderChat(); const p = $('[data-pane="chat"]'); p.scrollTop = p.scrollHeight; }
});

/* ---------- Azioni ---------- */
const asMarkdown = (m) => `# ${m.title || 'Riunione'}\n${fmtDate(m.created)}${m.contact ? ` · ${m.contact}` : ''}\n\n${m.enhanced || m.notes}\n\n---\n## Mappa mentale\n${m.mindmap ? m.mindmap.replace(/^#.*\n?/m, '') : '(non generata)'}\n\n---\n## Trascrizione integrale\n${transcriptText(m)}`;
function download(name, text, type) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const fileName = (m) => `${(m.title || 'riunione').replace(/[^\w\-àèéìòù ]+/gi, '').trim().replace(/\s+/g, '-')}.md`;
$('#btn-more').addEventListener('click', () => $('#dlg-more').showModal());
$('#dlg-more').addEventListener('close', async () => {
  const v = $('#dlg-more').returnValue; const text = asMarkdown(cur);
  if (v === 'import') $('#audio-file').click();
  else if (v === 'retranscribe') retranscribe(cur);
  else if (v === 'share') {
    if (navigator.share) { try { await navigator.share({ title: cur.title || 'Riunione', text }); } catch {} }
    else { await navigator.clipboard?.writeText(text); toast('Copiato negli appunti'); }
  } else if (v === 'copy') { try { await navigator.clipboard.writeText(text); toast('Copiato'); } catch { toast('Copia non riuscita'); } }
  else if (v === 'md') download(fileName(cur), text, 'text/markdown');
  else if (v === 'delete' && confirm('Eliminare questa riunione e il suo audio?')) {
    const m = cur; meetings = meetings.filter((x) => x !== m); idb.del(m.id).catch(() => {});
    m.title = ''; m.notes = ''; m.transcript = []; m.segs = {}; history.back();
  }
});

/* ---------- Impostazioni ---------- */
function syncSettingsUI() {
  $('#row-groq').hidden = $('#s-asr').value !== 'groq';
  const oa = $('#s-provider').value === 'openai';
  $('#row-base').hidden = !oa; $('#row-key').hidden = !oa;
  $('#s-model').placeholder = oa ? 'llama-3.3-70b-versatile' : 'gemini-2.5-flash';
}
$('#btn-settings').addEventListener('click', () => {
  $('#s-myname').value = settings.myName; $('#s-lang').value = settings.lang; $('#s-gkey').value = settings.gkey;
  $('#s-asr').value = settings.asr; $('#s-groq').value = settings.groqKey; $('#s-speaker').checked = settings.speaker;
  $('#s-provider').value = settings.provider; $('#s-base').value = settings.base; $('#s-key').value = settings.key; $('#s-model').value = settings.model;
  $('#diag').hidden = true; syncSettingsUI(); $('#dlg-settings').showModal();
});
$('#s-asr').addEventListener('change', syncSettingsUI);
$('#s-provider').addEventListener('change', syncSettingsUI);
function readSettingsForm() {
  return {
    ...settings, myName: $('#s-myname').value.trim(), lang: $('#s-lang').value, gkey: $('#s-gkey').value.trim(),
    asr: $('#s-asr').value, groqKey: $('#s-groq').value.trim(), speaker: $('#s-speaker').checked,
    provider: $('#s-provider').value, base: $('#s-base').value.trim(), key: $('#s-key').value.trim(), model: $('#s-model').value.trim(),
  };
}
$('#dlg-settings').addEventListener('close', () => {
  const v = $('#dlg-settings').returnValue;
  if (v === 'save') { settings = readSettingsForm(); store.set('notula.settings', settings); toast('Impostazioni salvate'); }
  else if (v === 'export') download(`notula-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(meetings, null, 2), 'application/json');
});
$('#s-import').addEventListener('change', async (e) => {
  try {
    const data = JSON.parse(await e.target.files[0].text());
    if (!Array.isArray(data)) throw new Error();
    const ids = new Set(meetings.map((m) => m.id));
    meetings.push(...data.filter((m) => m && m.id && !ids.has(m.id)));
    saveMeetings(); renderList(); toast('Backup importato'); $('#dlg-settings').close();
  } catch { toast('File di backup non valido'); }
});

// Diagnostica: verifica davvero microfono, registrazione e chiavi, mostrando l'errore esatto.
$('#btn-diag').addEventListener('click', async () => {
  const s = readSettingsForm(); const out = $('#diag'); out.hidden = false; out.textContent = 'Verifico…';
  const lines = [];
  const add = (ok, msg) => { lines.push(`${ok ? '✅' : '❌'} ${msg}`); out.textContent = lines.join('\n'); };
  add(window.isSecureContext, `Connessione sicura (HTTPS): ${window.isSecureContext ? 'sì' : 'no — il microfono non funziona'}`);
  add(!!window.MediaRecorder, `Registrazione audio: ${pickMime() || (window.MediaRecorder ? 'formato predefinito' : 'non supportata')}`);
  try {
    const st = await navigator.mediaDevices.getUserMedia({ audio: true });
    const label = st.getAudioTracks()[0]?.label || 'microfono'; st.getTracks().forEach((t) => t.stop());
    add(true, `Microfono: ${label}`);
  } catch (e) { add(false, `Microfono: ${e.name} — ${e.message}`); }
  add(true, `Riconoscimento vocale del browser: ${SR ? 'disponibile' : 'assente (normale su iPhone): si usa Gemini'}`);
  if (s.gkey) {
    try {
      const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', { headers: { 'x-goog-api-key': s.gkey } });
      const j = await r.json().catch(() => ({}));
      add(r.ok, `Chiave Gemini: ${r.ok ? 'valida' : j.error?.message || r.status}`);
    } catch (e) { add(false, `Chiave Gemini: rete bloccata (${e.message})`); }
  } else add(false, 'Chiave Gemini: mancante');
  if (s.asr === 'groq') {
    try {
      const r = await fetch('https://api.groq.com/openai/v1/models', { headers: { Authorization: `Bearer ${s.groqKey}` } });
      add(r.ok, `Chiave Groq: ${r.ok ? 'valida' : r.status}`);
    } catch (e) { add(false, `Groq: chiamata bloccata dal browser (${e.message}) — usa Gemini`); }
  }
  try { await idb.list('test'); add(true, 'Archivio audio locale: ok'); } catch (e) { add(false, `Archivio audio locale: ${e.message}`); }
});

/* ---------- Avvio ---------- */
renderList();
setTimeout(() => !settings.gkey && settings.asr !== 'groq' && toast('Inserisci la chiave Gemini gratuita in ⚙︎ Impostazioni', 4000), 800);
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
