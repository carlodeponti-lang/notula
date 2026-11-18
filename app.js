// Notula — appunti di riunione con trascrizione e note AI. Tutto nel browser.
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

/* ---------- Storage (localStorage, con fallback in memoria) ---------- */
const mem = {};
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return mem[k] ?? d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { mem[k] = v; toast('Spazio locale non disponibile: i dati non verranno salvati'); } },
};
let meetings = store.get('notula.meetings', []);
let settings = Object.assign(
  { lang: 'it-IT', provider: 'gemini', base: '', model: '', key: '' },
  store.get('notula.settings', {}),
);
const saveMeetings = () => store.set('notula.meetings', meetings);

/* ---------- Template ---------- */
const TEMPLATES = {
  generico: { name: 'Generico', guide: 'Sezioni: Sintesi (3 righe), Punti discussi, Decisioni, Prossimi passi (chi/cosa/quando).' },
  commerciale: { name: 'Call commerciale', guide: 'Sezioni: Contesto cliente, Esigenze e pain point, Budget/tempistiche/decisori, Obiezioni, Concorrenza citata, Prossimi passi e impegni presi.' },
  oneToOne: { name: '1:1', guide: 'Sezioni: Aggiornamenti, Blocchi, Feedback (dato/ricevuto), Obiettivi, Azioni.' },
  standup: { name: 'Stand-up', guide: 'Per ogni persona: Fatto, Da fare, Blocchi. Poi Azioni comuni.' },
  intervista: { name: 'Colloquio', guide: 'Sezioni: Profilo candidato, Esperienze rilevanti, Punti di forza, Dubbi, Valutazione, Prossimi passi.' },
  cliente: { name: 'Audit / visita cliente', guide: 'Sezioni: Partecipanti, Ambito, Rilievi/osservazioni, Rischi, Richieste del cliente, Azioni correttive con responsabili e scadenze.' },
};

/* ---------- Utilità ---------- */
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const fmtDate = (t) => new Date(t).toLocaleString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const mmss = (ms) => { const s = Math.floor(ms / 1000); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function toast(msg, ms = 2600) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => (t.hidden = true), ms); }

// Markdown minimale e sicuro (escape prima del parsing).
function md(src) {
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*(?!\s)(.+?)\*/g, '$1<i>$2</i>');
  let html = '', inList = false;
  for (const raw of src.split('\n')) {
    const line = raw.trimEnd();
    const li = line.match(/^\s*[-*•]\s+(.*)/);
    if (li) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${inline(li[1])}</li>`; continue; }
    if (inList) { html += '</ul>'; inList = false; }
    const h = line.match(/^(#{1,3})\s+(.*)/);
    if (h) html += `<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`;
    else if (line.trim()) html += `<p>${inline(line)}</p>`;
  }
  return html + (inList ? '</ul>' : '');
}

/* ---------- Lista ---------- */
function renderList() {
  const q = $('#search').value.trim().toLowerCase();
  const items = meetings
    .filter((m) => !q || [m.title, m.notes, m.enhanced, m.transcript.map((x) => x.text).join(' ')].join(' ').toLowerCase().includes(q))
    .sort((a, b) => b.created - a.created);
  $('#meetings').innerHTML = items.map((m) => `
    <li data-id="${m.id}"><b>${esc(m.title || 'Senza titolo')}</b>
    <span>${fmtDate(m.created)} · ${TEMPLATES[m.template]?.name ?? ''}${m.transcript.length ? ` · ${mmss(m.duration || 0)}` : ''}</span>
    <p>${esc((m.enhanced || m.notes || m.transcript.map((x) => x.text).join(' ')).replace(/[#*]+|^\s*-\s/gm, '').replace(/\s+/g, ' ').trim().slice(0, 180))}</p></li>`).join('');
  $('#empty').hidden = meetings.length > 0;
}
$('#meetings').addEventListener('click', (e) => { const li = e.target.closest('li'); if (li) openMeeting(li.dataset.id); });
$('#search').addEventListener('input', renderList);
$('#btn-new').addEventListener('click', () => {
  const m = { id: uid(), title: '', created: Date.now(), template: 'generico', notes: '', enhanced: '', transcript: [], chat: [], duration: 0 };
  meetings.push(m); saveMeetings(); openMeeting(m.id); $('#m-title').focus();
});

/* ---------- Riunione ---------- */
let cur = null;
const tplSel = $('#m-template');
tplSel.innerHTML = Object.entries(TEMPLATES).map(([k, t]) => `<option value="${k}">${t.name}</option>`).join('');

function openMeeting(id) {
  cur = meetings.find((m) => m.id === id);
  $('#m-title').value = cur.title; $('#m-notes').value = cur.notes; tplSel.value = cur.template;
  $('#m-date').textContent = fmtDate(cur.created);
  renderTranscript(); renderEnhanced(); renderChat();
  showTab(cur.enhanced ? 'enhanced' : 'notes');
  $('#rec-time').textContent = mmss(cur.duration || 0);
  $('#view-list').hidden = true; $('#view-meeting').hidden = false;
  history.pushState({ m: id }, '');
}
function closeMeeting() {
  if (rec.on) stopRec();
  if (cur && !cur.title && !cur.notes && !cur.transcript.length) meetings = meetings.filter((m) => m !== cur);
  saveMeetings(); cur = null;
  $('#view-meeting').hidden = true; $('#view-list').hidden = false; renderList();
}
$('#btn-back').addEventListener('click', () => history.back());
window.addEventListener('popstate', () => { if (cur) closeMeeting(); });

let saveT;
const autosave = () => { clearTimeout(saveT); saveT = setTimeout(saveMeetings, 400); };
$('#m-title').addEventListener('input', (e) => { cur.title = e.target.value; autosave(); });
$('#m-notes').addEventListener('input', (e) => { cur.notes = e.target.value; autosave(); });
tplSel.addEventListener('change', (e) => { cur.template = e.target.value; autosave(); });

function showTab(name) {
  $$('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  $$('.pane').forEach((p) => (p.hidden = p.dataset.pane !== name));
}
$('.tabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) showTab(b.dataset.tab); });

function renderTranscript() {
  $('#m-transcript').innerHTML = cur.transcript.map((x) => `<li><time>${mmss(x.t)}</time>${esc(x.text)}</li>`).join('')
    || '<li class="muted">Nessuna trascrizione. Tocca Registra.</li>';
}
function renderEnhanced() { $('#m-enhanced').innerHTML = cur.enhanced ? md(cur.enhanced) : ''; $('#enh-empty').hidden = !!cur.enhanced; }
function renderChat() {
  $('#chat-log').innerHTML = cur.chat.map((c) => `<div class="${c.role === 'user' ? 'q' : 'a md'}">${c.role === 'user' ? esc(c.text) : md(c.text)}</div>`).join('');
}

/* ---------- Registrazione + trascrizione (Web Speech API) ---------- */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const rec = { on: false, sr: null, start: 0, base: 0, timer: null, wake: null };

function startRec() {
  if (!SR) { toast('Trascrizione live non supportata da questo browser. Usa Chrome (Android/desktop) o Safari iOS 14.5+.', 5000); return; }
  rec.on = true; rec.base = cur.duration || 0; rec.start = Date.now();
  $('#btn-rec').classList.add('on'); $('#rec-label').textContent = 'Stop';
  rec.timer = setInterval(() => { cur.duration = rec.base + Date.now() - rec.start; $('#rec-time').textContent = mmss(cur.duration); }, 500);
  listen();
  navigator.wakeLock?.request('screen').then((w) => { rec.wake = w; }).catch(() => {});
  showTab('transcript');
}
function listen() {
  const sr = new SR();
  sr.lang = settings.lang; sr.continuous = true; sr.interimResults = true;
  sr.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) { const text = r[0].transcript.trim(); if (text) { cur.transcript.push({ t: cur.duration, text }); renderTranscript(); autosave(); } }
      else interim += r[0].transcript;
    }
    $('#interim').textContent = interim;
    const pane = $('[data-pane="transcript"]'); pane.scrollTop = pane.scrollHeight;
  };
  sr.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { toast('Permesso microfono negato.'); stopRec(); }
  };
  // Il riconoscimento si chiude da solo dopo pause/limiti: riavvio finché si registra.
  sr.onend = () => { if (rec.on) setTimeout(() => rec.on && listen(), 250); };
  rec.sr = sr;
  try { sr.start(); } catch { /* già avviato */ }
}
function stopRec() {
  if (rec.on) cur.duration = rec.base + Date.now() - rec.start;
  rec.on = false; clearInterval(rec.timer);
  try { rec.sr?.stop(); } catch {}
  rec.wake?.release?.(); rec.wake = null;
  $('#btn-rec').classList.remove('on'); $('#rec-label').textContent = 'Registra'; $('#interim').textContent = '';
  saveMeetings();
}
$('#btn-rec').addEventListener('click', () => (rec.on ? stopRec() : startRec()));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && rec.on) navigator.wakeLock?.request('screen').then((w) => { rec.wake = w; }).catch(() => {});
});

/* ---------- AI ---------- */
async function llm(system, user) {
  const { provider, key } = settings;
  if (provider === 'none') throw new Error('Nessun motore AI configurato (Impostazioni).');
  if (!key && provider === 'gemini') throw new Error('Inserisci la API key in Impostazioni.');
  if (provider === 'gemini') {
    const model = settings.model || 'gemini-2.5-flash';
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: user }] }], generationConfig: { temperature: 0.3 } }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error?.message || `Errore Gemini ${r.status}`);
    return j.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? '';
  }
  const base = (settings.base || 'https://api.groq.com/openai/v1').replace(/\/$/, '');
  const r = await fetch(`${base}/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({ model: settings.model || 'llama-3.3-70b-versatile', temperature: 0.3, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error?.message || `Errore API ${r.status}`);
  return j.choices?.[0]?.message?.content ?? '';
}

const transcriptText = (m) => m.transcript.map((x) => `[${mmss(x.t)}] ${x.text}`).join('\n');

$('#btn-enhance').addEventListener('click', async () => {
  if (rec.on) stopRec();
  if (!cur.notes.trim() && !cur.transcript.length) { toast('Nessun appunto né trascrizione da elaborare.'); return; }
  const btn = $('#btn-enhance'); btn.disabled = true; btn.textContent = 'Elaboro…';
  const system = `Sei un assistente che redige verbali di riunione in ${settings.lang.startsWith('it') ? 'italiano' : 'nella lingua della trascrizione'}.
Regole:
- Gli APPUNTI dell'utente sono lo scheletro: mantieni i suoi punti, il loro ordine e la sua terminologia; espandili con i dettagli della TRASCRIZIONE.
- Aggiungi ciò che la trascrizione contiene di importante e gli appunti non coprono.
- Non inventare nulla che non sia negli appunti o nella trascrizione. Se un dato (nome, cifra, data) è incerto, scrivi "(da verificare)".
- Struttura: ${TEMPLATES[cur.template].guide}
- Output solo Markdown: titoli con ##, elenchi puntati con "-", grassetto con **. Conciso, niente preamboli.`;
  const user = `TITOLO: ${cur.title || '(nessuno)'}\nDATA: ${fmtDate(cur.created)}\n\nAPPUNTI:\n${cur.notes || '(nessuno)'}\n\nTRASCRIZIONE:\n${transcriptText(cur) || '(nessuna)'}`;
  try {
    cur.enhanced = (await llm(system, user)).trim();
    if (!cur.title) { const h = cur.enhanced.match(/^#{1,2}\s+(.+)/m); if (h && !/sintesi|contesto/i.test(h[1])) cur.title = h[1]; }
    saveMeetings(); renderEnhanced(); showTab('enhanced'); $('#m-title').value = cur.title;
  } catch (err) { toast(err.message, 5000); }
  btn.disabled = false; btn.textContent = '✦ Migliora note';
});

$('#chat-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = $('#chat-input').value.trim(); if (!q) return;
  $('#chat-input').value = ''; cur.chat.push({ role: 'user', text: q }); renderChat();
  const system = 'Rispondi alle domande sulla riunione usando solo appunti, note e trascrizione forniti. Se l\'informazione non c\'è, dillo. Cita il minuto [mm:ss] quando utile. Risposte brevi, in Markdown.';
  const history = cur.chat.slice(-8).map((c) => `${c.role === 'user' ? 'Domanda' : 'Risposta'}: ${c.text}`).join('\n');
  const ctx = `APPUNTI:\n${cur.notes}\n\nNOTE AI:\n${cur.enhanced}\n\nTRASCRIZIONE:\n${transcriptText(cur)}\n\nCONVERSAZIONE:\n${history}`;
  try { cur.chat.push({ role: 'ai', text: (await llm(system, ctx)).trim() }); }
  catch (err) { cur.chat.push({ role: 'ai', text: `⚠︎ ${err.message}` }); }
  saveMeetings(); renderChat(); const p = $('[data-pane="chat"]'); p.scrollTop = p.scrollHeight;
});

/* ---------- Azioni: condividi, copia, export, elimina ---------- */
const asMarkdown = (m) => `# ${m.title || 'Riunione'}\n${fmtDate(m.created)}\n\n${m.enhanced || m.notes}\n\n---\n## Trascrizione\n${transcriptText(m)}`;
function download(name, text, type) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const fileName = (m) => `${(m.title || 'riunione').replace(/[^\w\-àèéìòù ]+/gi, '').trim().replace(/\s+/g, '-')}.md`;
$('#btn-more').addEventListener('click', () => $('#dlg-more').showModal());
$('#dlg-more').addEventListener('close', async () => {
  const v = $('#dlg-more').returnValue; const text = asMarkdown(cur);
  if (v === 'share') {
    if (navigator.share) { try { await navigator.share({ title: cur.title || 'Riunione', text }); } catch {} }
    else { await navigator.clipboard?.writeText(text); toast('Condivisione non disponibile: copiato negli appunti'); }
  } else if (v === 'copy') { try { await navigator.clipboard.writeText(text); toast('Copiato'); } catch { toast('Copia non riuscita'); } }
  else if (v === 'md') download(fileName(cur), text, 'text/markdown');
  else if (v === 'delete' && confirm('Eliminare questa riunione?')) { meetings = meetings.filter((m) => m !== cur); cur.title = ''; cur.notes = ''; cur.transcript = []; history.back(); }
});

/* ---------- Impostazioni ---------- */
function syncProviderUI() {
  const p = $('#s-provider').value;
  $('#row-base').hidden = p !== 'openai';
  $('#s-model').placeholder = p === 'gemini' ? 'gemini-2.5-flash' : 'llama-3.3-70b-versatile';
}
$('#btn-settings').addEventListener('click', () => {
  $('#s-lang').value = settings.lang; $('#s-provider').value = settings.provider;
  $('#s-base').value = settings.base; $('#s-model').value = settings.model; $('#s-key').value = settings.key;
  syncProviderUI(); $('#dlg-settings').showModal();
});
$('#s-provider').addEventListener('change', syncProviderUI);
$('#dlg-settings').addEventListener('close', () => {
  const v = $('#dlg-settings').returnValue;
  if (v === 'save') {
    settings = { lang: $('#s-lang').value, provider: $('#s-provider').value, base: $('#s-base').value.trim(), model: $('#s-model').value.trim(), key: $('#s-key').value.trim() };
    store.set('notula.settings', settings); toast('Impostazioni salvate');
  } else if (v === 'export') download(`notula-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(meetings, null, 2), 'application/json');
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

/* ---------- Avvio ---------- */
renderList();
setTimeout(() => !settings.key && settings.provider === 'gemini' && toast('Configura il motore AI gratuito in ⚙︎ Impostazioni', 4000), 800);
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
