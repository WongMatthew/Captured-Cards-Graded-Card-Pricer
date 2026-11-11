/* global GCP, GCPPlatforms */
const P = GCPPlatforms;
const $ = (s) => document.querySelector(s);
// All prices are Canadian dollars.
const money = (n, whole) => n == null || isNaN(n) ? '—' : n.toLocaleString('en-CA', {
  style: 'currency', currency: 'CAD', currencyDisplay: 'narrowSymbol',
  minimumFractionDigits: whole || n >= 1000 ? 0 : 2, maximumFractionDigits: whole || n >= 1000 ? 0 : 2
});
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const shortDate = (d) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const CACHE_VER = 'v4';
const CACHE_MS = 15 * 60 * 1000;
const EMBED_WAIT_MS = 45000;
const MOBILE_W = 390;
const ORDER = ['ebay', '130point', 'pricecharting', 'cardladder', 'alt', 'collectr'];
const COMMON_GRADES = ['PSA 10', 'PSA 9', 'PSA 8', 'BGS Black Label 10', 'BGS 10', 'BGS 9.5', 'BGS 9', 'CGC Pristine 10', 'CGC 10', 'CGC 9.5', 'CGC 9', 'SGC 10', 'TAG 10'];
const GRADE_BAR = ['PSA 10', 'PSA 9', 'PSA 8', 'BGS 10', 'BGS 9.5', 'BGS 9', 'CGC Pristine 10', 'CGC 10', 'CGC 9.5', 'SGC 10', 'TAG 10'];

let settings = structuredClone(P.DEFAULTS);
let state = blank();
let watchlist = {};
let scanned = { tabId: null, title: '', cards: [], certs: [] };
let rangeDays = 30;
let fx = null;          // Bank of Canada rates (for sources that only show US$)
let secrets = {};       // PSA / eBay API keys (this computer only)
let connected = [];     // login sources with a connected window
let showAllSales = false;

function blank() {
  return { query: '', parts: null, partsM: null, sid: '', src: {}, prefs: { excluded: [], forced: [] }, allow: [], cert: null,
    merged: [], all: [], week: null, snapshotDone: false };
}
const loadingSources = () => Object.values(state.src).filter(r => r.status === 'loading' && P.META[r.id].mode === 'fetch').length;

// ================================================================ settings
async function loadSettings() {
  const s = await chrome.storage.sync.get(null);
  settings = structuredClone(P.DEFAULTS);
  for (const k of Object.keys(P.DEFAULTS)) if (k !== 'platforms' && k in s) settings[k] = s[k];
  if (s.platforms) for (const id of Object.keys(settings.platforms)) Object.assign(settings.platforms[id], s.platforms[id] || {});
  P.migrateSettings(settings);
  $('#trim').checked = settings.trimOutliers;
  $('#bestOffers').checked = !settings.excludeBestOffers;
  $('#converted').checked = settings.includeConverted;
  secrets = await chrome.storage.local.get(P.SECRET_KEYS);
  settings.psaApiKey = secrets.psaApiKey || '';
}
async function refreshConnected() {
  connected = await chrome.runtime.sendMessage({ type: 'list-companions' }).catch(() => []) || [];
  Object.keys(state.src).forEach(renderSource);
}

// ================================================================ page scanning (on open + on request only)
async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}
const isMarketplace = (url) => /(^|\.)(ebay\.com|pricecharting\.com|130point\.com|alt\.xyz|getcollectr\.com|psacard\.com|cgccards\.com)$/.test(safeHost(url));
function safeHost(url) { try { return new URL(url).hostname; } catch (e) { return ''; } }

async function scanTab({ initial = false } = {}) {
  const tab = await activeTab();
  if (!tab) return;
  $('#tabPrompt').hidden = true;
  const btn = $('#scanBtn');
  btn.textContent = 'Scanning…';
  btn.disabled = true;
  let res = null;
  try {
    res = await chrome.tabs.sendMessage(tab.id, { type: 'scan-now' });
  } catch (e) {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/detect.js', 'src/content.js'] });
      res = await chrome.tabs.sendMessage(tab.id, { type: 'scan-now' });
    } catch (e2) { res = null; }
  }
  btn.textContent = 'Scan page';
  btn.disabled = false;
  scanned = { tabId: tab.id, title: tab.title || safeHost(tab.url), cards: res ? res.cards : [], certs: res ? res.certs || [] : [], failed: !res };
  renderChips();
  // Price something automatically only on the panel's first scan (or a highlighted selection), never later.
  if (res && !state.query && (initial || res.fromSelection)) {
    if (res.cards.length) search(res.cards[0].query, { askPrice: res.cards[0].askPrice });
    else if (res.certs && res.certs.length === 1) lookupCert(res.certs[0]);
  } else if (res && res.fromSelection && res.cards.length) search(res.cards[0].query, { askPrice: res.cards[0].askPrice });
}

function renderChips() {
  $('#pageLabel').textContent = scanned.tabId && scanned.title ? `On “${scanned.title}”` : 'This page';
  $('#pageLabel').title = scanned.title;
  const box = $('#chips');
  box.innerHTML = '';
  if (scanned.failed) { box.innerHTML = '<span class="muted">This page can’t be read (browser pages, Web Store).</span>'; return; }
  if (!scanned.tabId) { box.innerHTML = '<span class="muted">Press “Scan page” to find graded cards and cert numbers.</span>'; return; }
  if (!scanned.cards.length && !scanned.certs.length) { box.innerHTML = '<span class="muted">No graded cards found. Highlight the card text and scan again.</span>'; return; }
  for (const c of scanned.cards) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip' + (c.query === state.query ? ' active' : '');
    b.title = c.raw;
    b.innerHTML = `${esc(c.name)}${c.number ? ' ' + esc(c.number) : ''}<b>${esc(GCP.gradeLabel(c))}</b>${c.askPrice ? `<i>· ${money(c.askPrice)}</i>` : ''}`;
    b.onclick = () => search(c.query, { askPrice: c.askPrice });
    box.appendChild(b);
  }
  for (const c of scanned.certs) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip cert' + (state.cert && state.cert.cert === c.cert ? ' active' : '');
    b.title = c.guessed ? 'Grader guessed from the number length' : '';
    b.innerHTML = `${esc(c.grader)} cert <b>#${esc(c.cert)}</b>`;
    b.onclick = () => lookupCert(c);
    box.appendChild(b);
  }
}

// When the user switches tabs or the page changes, offer a scan instead of doing one.
async function onTabChange() {
  const tab = await activeTab();
  if (!tab || !scanned.tabId) return;
  if (tab.id === scanned.tabId && !scanned.navigated) { $('#tabPrompt').hidden = true; return; }
  if (isMarketplace(tab.url) || !/^https?:/.test(tab.url || '')) { $('#tabPrompt').hidden = true; return; }
  $('#tabPromptText').textContent = `Now viewing “${tab.title || safeHost(tab.url)}”`;
  $('#tabPrompt').hidden = false;
}
chrome.tabs.onActivated.addListener(onTabChange);
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status !== 'complete') return;
  if (tabId === scanned.tabId) scanned.navigated = true;
  onTabChange();
});

// ================================================================ cache & prefs
const cacheKey = (id, q) => `cache:${CACHE_VER}:${id}:${q.toLowerCase()}`;
async function cacheGet(id, q) {
  const k = cacheKey(id, q);
  const v = (await chrome.storage.local.get(k))[k];
  if (!v || Date.now() - v.at > CACHE_MS) return null;
  v.data.sales.forEach(s => (s.date = new Date(s.date)));
  return { ...v.data, cachedAt: v.at };
}
function cachePut(id, q, data) {
  return chrome.storage.local.set({ [cacheKey(id, q)]: { at: Date.now(), data: { ...data, sales: data.sales.map(s => ({ ...s, date: s.date.toISOString() })) } } });
}
const prefsKey = (q) => 'prefs:' + q.toLowerCase();
async function loadPrefs(q) {
  const v = (await chrome.storage.local.get(prefsKey(q)))[prefsKey(q)];
  return { excluded: v?.excluded || [], forced: v?.forced || [] };
}
const savePrefs = () => chrome.storage.local.set({ [prefsKey(state.query)]: state.prefs });

// ================================================================ cert lookup
async function lookupCert(c) {
  state = blank();
  state.query = `${c.grader} cert ${c.cert}`;
  state.cert = { ...c, status: 'looking' };
  $('#q').value = `${c.grader} ${c.cert}`;
  showSummaryShell(`${c.grader} cert #${c.cert}`, 'Looking up the slab…');
  renderChips();
  try {
    if (c.grader === 'PSA' && settings.psaApiKey) {
      const info = await P.psaCertViaApi(c.cert, settings.psaApiKey);
      return search(info.query, { cert: info });
    }
  } catch (e) {
    $('#summaryMeta').textContent = e.message + ' · opening the cert page instead…';
  }
  const make = P.CERT_PAGES[c.grader];
  if (!make) { $('#summaryMeta').textContent = `Cert lookup isn’t supported for ${c.grader}.`; return; }
  const readable = c.grader === 'PSA' || c.grader === 'CGC';
  state.cert.status = readable ? 'waiting' : 'manual'; // before opening: the page can answer before tabs.create resolves
  await chrome.tabs.create({ url: make(c.cert), active: true });
  $('#summaryMeta').textContent = readable
    ? `Opened the ${c.grader} cert page in a new tab. If it shows a security check, complete it: the card is read as soon as the details appear.`
    : `Opened ${c.grader}'s lookup page. Type the card name shown there into the search box.`;
}

function onCertInfo(info) {
  if (!state.cert || state.cert.cert !== info.cert || state.cert.status !== 'waiting') return;
  if (!info.subject || !info.gradeText) {
    $('#summaryMeta').textContent = `Couldn’t read the card from the ${info.grader} page. Type the card name and grade instead.`;
    return;
  }
  const query = P.certToQuery(info);
  search(query, { cert: { ...info, query } });
}

// ================================================================ search
function showSummaryShell(title, meta) {
  $('#empty').hidden = true;
  $('#summary').hidden = false;
  $('#summaryTitle').textContent = title;
  $('#summaryMeta').textContent = meta || '';
}

async function search(q, opts = {}) {
  q = String(q || '').replace(/\s+/g, ' ').trim();
  if (!q) return;
  const certQ = GCP.parseCertQuery(q);
  if (certQ && !opts.cert) return lookupCert(certQ);
  const parts = GCP.splitQuery(q);
  fx = await P.getRates();
  state = blank();
  Object.assign(state, { query: q, parts, partsM: { ...parts }, sid: String(Date.now()), cert: opts.cert || null });
  state.prefs = await loadPrefs(q);
  showAllSales = false;
  $('#ask').value = opts.askPrice ? String(opts.askPrice) : '';
  $('#q').value = q;
  const certMeta = opts.cert ? `${opts.cert.grader} cert #${opts.cert.cert}${opts.cert.pop ? ` · pop ${opts.cert.pop}${opts.cert.popHigher != null ? ` (${opts.cert.popHigher} higher)` : ''}` : ''}` : '';
  showSummaryShell(q, parts.grade ? certMeta : 'No grade in the search: add one, e.g. “PSA 10”.');
  renderChips();
  renderGradeBar();
  renderWatchButton();

  $('#sourcesBox').hidden = false;
  const box = $('#sources');
  box.innerHTML = '';
  for (const id of ORDER) {
    const cfg = settings.platforms[id];
    if (!cfg || !cfg.enabled) continue;
    const embed = P.META[id].mode === 'embed';
    state.src[id] = { id, status: embed ? 'idle' : 'loading', raw: [], sales: [], rejected: [], include: true, url: P.pageUrl(id, q, cfg, parts, settings) };
    box.appendChild(buildSource(id));
    if (!embed) runFetch(id, cfg, opts.force);
    else if (connected.includes(id)) followInWindow(id);
    else if (id === 'collectr' && settings.autoCollectr) loadEmbed(id, { quiet: true });
    renderSource(id);
  }
  aggregate();
}

async function runFetch(id, cfg, force) {
  const sid = state.sid, q = state.query, parts = state.parts;
  const r = state.src[id];
  try {
    let data = force ? null : await cacheGet(id, q);
    if (!data) {
      data = await P.FETCHERS[id](q, cfg, parts, { settings, secrets, progress: (t) => { if (sid === state.sid) { r.progress = t; renderSource(id); } } });
      cachePut(id, q, data).catch(() => {});
    }
    if (sid !== state.sid) return;
    Object.assign(r, { status: 'ok', url: data.url || r.url, product: data.product, raw: data.sales, cachedAt: data.cachedAt, note: data.note || '', via: data.via,
      pop: data.pop || null, info: data.info || null });
  } catch (e) {
    if (sid !== state.sid) return;
    Object.assign(r, { status: 'error', blocked: !!e.blocked, error: e.name === 'AbortError' ? 'Timed out' : (e.message || String(e)) });
  }
  reclassify();
}

// ================================================================ filtering
const saleKey = (s, id) => s.itemId ? 'i:' + s.itemId : `${id}:${s.price}:${+s.date}:${(s.title || '').slice(0, 50)}`;

// Learn which variants are part of this card (e.g. "Japanese" for a Japan-only promo), then classify every source.
function reclassify() {
  const titles = Object.values(state.src).flatMap(r => (r.raw || []).filter(s => !s.scoped).map(s => s.title || ''));
  state.allow = GCP.inherentVariants(titles, state.parts);
  state.partsM = { ...state.parts, allowVariants: state.allow };
  Object.keys(state.src).forEach(classify);
  Object.keys(state.src).forEach(renderSource);
  aggregate();
}

function reasonFor(s) {
  const { grader, grade, qual } = state.parts;
  const title = s.title || '';
  if (P.JUNK_RE.test(title)) return 'lot / proxy / custom';
  const grades = GCP.findGrades(title);
  if (s.scoped) return grader && grades.length && !GCP.titleMatchesGrade(title, grader, grade, qual) ? 'different grade' : null;
  if (grader) {
    if (!grades.length) return 'no grade in title';
    if (!GCP.titleMatchesGrade(title, grader, grade, qual)) {
      const other = grades.find(g => !(g.grader === grader && g.grade === grade));
      return other ? GCP.gradeLabel(other) : (qual ? 'not ' + GCP.gradeLabel(state.parts) : 'Black Label / Pristine');
    }
  }
  const m = GCP.matchCard(title, state.partsM);
  if (!m.ok) return m.reason;
  if (s.bestOffer && !s.realBestOffer && settings.excludeBestOffers) return 'best offer (real price hidden)';
  return null;
}

// Every sale in CAD: native CAD prices as-is; anything else at the Bank of Canada rate, marked as converted.
function inCAD(s, id) {
  const c = P.toCAD(s.price, s.cur || P.META[id].cur, fx);
  return c ? { ...s, price: c.price, converted: c.converted, orig: c.orig } : null;
}

function classify(id) {
  const r = state.src[id];
  const forced = new Set(state.prefs.forced);
  r.sales = []; r.rejected = [];
  for (const raw of r.raw || []) {
    if (!raw.price || !raw.date || isNaN(raw.date)) continue;
    const key = saleKey(raw, id);
    const s = inCAD(raw, id);
    if (!s) { r.rejected.push({ ...raw, key, reason: 'no exchange rate', platform: id }); continue; }
    let reason = forced.has(key) ? null : reasonFor(s);
    if (!reason && s.converted && !settings.includeConverted) reason = `${s.orig.cur} price (converted sources off)`;
    (reason ? r.rejected : r.sales).push({ ...s, key, reason, platform: id });
  }
  r.sales.sort((a, b) => b.date - a.date);
  r.rejected.sort((a, b) => b.date - a.date);
}

function toggleForced(key) {
  const f = new Set(state.prefs.forced);
  f.has(key) ? f.delete(key) : f.add(key);
  state.prefs.forced = [...f];
  savePrefs();
  reclassify();
}
function toggleExcluded(key) {
  const x = new Set(state.prefs.excluded);
  x.has(key) ? x.delete(key) : x.add(key);
  state.prefs.excluded = [...x];
  savePrefs();
  Object.keys(state.src).forEach(renderSource);
  aggregate();
}

// ================================================================ sources
function buildSource(id) {
  const meta = P.META[id];
  const node = $('#sourceTpl').content.firstElementChild.cloneNode(true);
  node.dataset.id = id;
  const badge = node.querySelector('.pbadge');
  badge.textContent = meta.short;
  badge.style.background = meta.color;
  node.querySelector('.src-name strong').textContent = meta.name;
  node.querySelector('.src-name small').textContent = meta.note;
  node.querySelector('.src-row').onclick = () => {
    const body = node.querySelector('.src-body');
    body.hidden = !body.hidden;
    node.classList.toggle('open', !body.hidden);
  };
  node.querySelector('.include').onchange = (e) => {
    state.src[id].include = e.target.checked;
    node.classList.toggle('off', !e.target.checked);
    aggregate();
  };
  node.querySelector('.live').onclick = () => setMini(id, node.querySelector('.mini').hidden);
  if (meta.mode === 'embed') {
    node.querySelector('.live').hidden = true;
    const load = node.querySelector('.load');
    load.hidden = false;
    load.onclick = () => loadEmbed(id);
    const ph = node.querySelector('.phone');
    ph.hidden = false;
    ph.onclick = async () => {
      state.src[id].status = 'loading';
      state.src[id].progress = 'Waiting for the window…';
      renderSource(id);
      await chrome.runtime.sendMessage({ type: 'open-companion', platform: id, url: frameUrl(id) });
      refreshConnected();
    };
    if (id !== 'collectr') node.querySelector('.load').hidden = true; // Alt / Card Ladder show nothing useful signed out
  }
  return node;
}

function relDay(d) {
  const n = GCP.daysAgo(d);
  return n <= 0 ? 'today' : n === 1 ? 'yesterday' : `${n}d ago`;
}

function saleLi(s, withSource) {
  const li = document.createElement('li');
  const excluded = state.prefs.excluded.includes(s.key);
  if (excluded) li.className = 'excluded';
  const meta = P.META[s.platform];
  const tags = [withSource ? (s.sources || [s.platform]).map(x => P.META[x].name).join(' + ') : '', s.via && s.via !== 'eBay' ? 'via ' + s.via : '',
    s.converted ? `≈ from ${s.orig.cur} ${s.orig.amount.toLocaleString('en-CA', { maximumFractionDigits: 2 })}` : '',
    s.bestOffer ? (s.realBestOffer ? 'best offer ✓' : 'best offer') : '', s.auction ? 'auction' : ''].filter(Boolean).join(' · ');
  const thumb = s.img ? `<img src="${esc(s.img)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
    : `<span class="noimg" style="background:${meta.color}">${esc(meta.short)}</span>`;
  li.innerHTML = `${thumb}
    <div style="min-width:0"><a class="t" href="${esc(s.url || state.src[s.platform]?.url || '#')}" target="_blank" rel="noopener" title="${esc(s.title)}">${esc(s.title || '(untitled)')}</a>
    <div class="d">${shortDate(s.date)} · ${relDay(s.date)}${tags ? ' · ' + esc(tags) : ''}</div></div>
    <button class="p" title="${excluded ? 'Left out: click to count it again' : 'Click to leave this sale out'}">${s.converted ? '≈' : ''}${money(s.price)}</button>`;
  li.querySelector('.p').onclick = () => toggleExcluded(s.key);
  return li;
}

function renderSource(id) {
  const r = state.src[id];
  const node = document.querySelector(`.src[data-id="${id}"]`);
  if (!node || !r) return;
  const open = node.querySelector('.open');
  open.href = r.pageUrl || r.url;
  if (r.product) node.querySelector('.src-name small').textContent = r.product;

  const counted = r.sales.filter(s => !state.prefs.excluded.includes(s.key));
  const wk = GCP.windowStats(counted);
  const st = node.querySelector('.status');
  st.className = 'status';
  let label;
  if (r.status === 'loading') { st.classList.add('loading'); label = r.progress || 'Searching…'; }
  else if (r.status === 'idle') label = 'Not loaded';
  else if (r.status === 'error') { st.classList.add('err'); label = r.blocked ? 'Blocked' : 'Error'; }
  else if (counted.length) { st.classList.add('ok'); label = `${counted.length} sale${counted.length > 1 ? 's' : ''}`; }
  else if (r.marketPrice != null) { st.classList.add('ok'); label = 'Market price'; }
  else { st.classList.add('warn'); label = r.raw.length ? 'No matches' : 'Nothing found'; }
  st.textContent = label;
  st.title = label;
  node.querySelector('.src-val').textContent = wk['7d'] ? money(wk['7d'].avg) : r.marketPrice != null ? money(r.marketPrice) : '';
  if (r.via) node.querySelector('.src-name small').textContent = 'via ' + r.via;
  node.querySelector('.src-val').title = wk['7d'] ? '7-day average' : r.marketPrice != null ? 'Market price for this grade' : '';

  const note = node.querySelector('.pnote');
  let noteText = r.note || '';
  if (r.status === 'error') {
    noteText = r.blocked && id === 'ebay'
      ? 'eBay turned away the panel’s background request. Click “Open sold results ↗”: the sales are read from that eBay tab as soon as it loads. (Or add eBay API keys in Settings.)'
      : r.blocked && id === '130point'
        ? '130point turned away the panel’s background request. Click “Search on 130point ↗”: it runs the search in that tab and the sales are read from it.'
        : `${r.error}. Try Open ↗.`;
  } else if (r.status === 'ok' && !counted.length && r.rejected.length) {
    noteText = `${r.rejected.length} listings found, none match this exact card and grade. Check “filtered out” below.`;
  } else if (r.status === 'idle') {
    noteText = `${P.META[id].name} needs your login. Press “📱 Connect”, sign in once in the window that opens, and it will follow every search.` +
      (id === 'collectr' ? ' (“Load here” shows the public price without your account.)' : '');
  }
  if (connected.includes(id) && r.status !== 'error') noteText = (noteText ? noteText + ' ' : '') + 'Connected: follows your searches in its own window.';
  note.hidden = !noteText;
  note.className = 'pnote' + (r.status === 'error' ? ' err' : '');
  note.textContent = noteText;
  const blockedCta = r.status === 'error' && r.blocked && (id === 'ebay' || id === '130point');
  open.textContent = blockedCta ? (id === 'ebay' ? 'Open sold results ↗' : 'Search on 130point ↗') : 'Open ↗';
  open.classList.toggle('cta', blockedCta);
  if (blockedCta && !node.dataset.autoOpened) { node.dataset.autoOpened = '1'; node.querySelector('.src-body').hidden = false; node.classList.add('open'); }
  const ph = node.querySelector('.phone');
  if (ph) ph.textContent = connected.includes(id) ? '📱 Show window' : '📱 Connect';

  const gp = node.querySelector('.gradeprices');
  if (r.gradePrices && Object.keys(r.gradePrices).length) {
    const want = GCP.gradeLabel(state.parts);
    gp.hidden = false;
    gp.innerHTML = Object.entries(r.gradePrices).map(([k, v]) => `<div class="${k === want ? 'cur' : ''}" data-g="${esc(k)}" title="Price this grade">${esc(k)}<b>${money(v, true)}</b></div>`).join('');
    gp.querySelectorAll('div').forEach(d => (d.onclick = () => switchGrade(d.dataset.g)));
  } else gp.hidden = true;

  const list = node.querySelector('.sales');
  list.innerHTML = '';
  for (const s of r.sales.slice(0, 40)) list.appendChild(saleLi(s, false));

  const rej = node.querySelector('.rejected');
  if (r.rejected.length) {
    rej.hidden = false;
    rej.querySelector('summary').textContent = `${r.rejected.length} listing${r.rejected.length > 1 ? 's' : ''} filtered out (different card, grade or lot)`;
    const ol = rej.querySelector('ol');
    ol.innerHTML = '';
    for (const s of r.rejected.slice(0, 80)) {
      const li = document.createElement('li');
      li.innerHTML = `<span title="${esc(s.title)}">${shortDate(s.date)} · ${money(s.price)} · ${esc(s.title)}</span><em>${esc(s.reason)}</em><button title="Count this sale anyway">Use</button>`;
      li.querySelector('button').onclick = () => toggleForced(s.key);
      ol.appendChild(li);
    }
  } else rej.hidden = true;
  const load = node.querySelector('.load');
  if (load) load.textContent = r.status === 'idle' ? 'Load here' : 'Reload';
}

// ---------------------------------------------------------------- embedded mobile views (on request)
function frameUrl(id) {
  return state.src[id].url + '#gcp=' + encodeURIComponent(JSON.stringify({ q: state.query, sid: state.sid }));
}
function followInWindow(id) {
  const r = state.src[id];
  r.status = 'loading';
  r.progress = 'Searching in your window…';
  chrome.runtime.sendMessage({ type: 'open-companion', platform: id, url: frameUrl(id), focus: false }).then(ok => {
    if (!ok) { connected = connected.filter(x => x !== id); r.status = 'idle'; renderSource(id); }
  }).catch(() => {});
  const sid = state.sid;
  setTimeout(() => { if (sid === state.sid && r.status === 'loading') { r.status = 'done'; r.note = 'Nothing read yet. Check the window (still signed in?).'; renderSource(id); aggregate(); } }, EMBED_WAIT_MS);
}

function loadEmbed(id, { quiet } = {}) {
  const r = state.src[id];
  r.status = 'loading';
  r.progress = 'Loading…';
  const node = document.querySelector(`.src[data-id="${id}"]`);
  if (!quiet) { node.querySelector('.src-body').hidden = false; node.classList.add('open'); }
  setMini(id, true, true); // a collapsed row still loads its view, without pushing the layout around
  renderSource(id);
  const sid = state.sid;
  setTimeout(() => {
    if (sid === state.sid && r.status === 'loading') {
      r.status = 'done'; r.note = r.note || 'Nothing could be read from this page. Try 📱 Phone.';
      renderSource(id); aggregate();
    }
  }, EMBED_WAIT_MS);
}
function fitMini(node) {
  const mini = node.querySelector('.mini');
  const frame = mini.querySelector('iframe');
  const mobile = P.META[node.dataset.id].mode === 'embed';
  const designW = mobile ? MOBILE_W : 1100;
  const scale = (mini.clientWidth || 300) / designW;
  frame.style.width = designW + 'px';
  frame.style.height = Math.ceil(mini.clientHeight / scale) + 'px';
  frame.style.transform = `scale(${scale})`;
}
const ro = new ResizeObserver((es) => es.forEach(e => fitMini(e.target.closest('.src'))));
function setMini(id, on, reload) {
  const node = document.querySelector(`.src[data-id="${id}"]`);
  if (!node) return;
  const mini = node.querySelector('.mini');
  const frame = mini.querySelector('iframe');
  mini.hidden = !on;
  node.querySelector('.live').textContent = on ? 'Hide view' : 'Mini view';
  if (!on) return;
  const url = P.META[id].mode === 'embed' ? frameUrl(id) : state.src[id].url;
  if (reload || frame.dataset.src !== url) { frame.dataset.src = url; frame.src = url; }
  ro.observe(mini);
  requestAnimationFrame(() => fitMini(node));
}

// ================================================================ messages
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'frame-status' || msg.type === 'frame-sales') {
    const r = state.src[msg.platform];
    if (!r || msg.sid !== state.sid || P.META[msg.platform].mode !== 'embed') return;
    if (msg.type === 'frame-status') { if (r.status === 'loading') { r.progress = msg.text; renderSource(msg.platform); } return; }
    r.raw = (msg.rows || []).map(x => ({ ...x, cur: x.cur || cur, date: new Date(x.date) }));
    const cur = msg.cur || P.META[msg.platform].cur;
    const cad = (v) => { const c = v == null ? null : P.toCAD(v, cur, fx); return c ? c.price : null; };
    r.marketPrice = cad(msg.marketPrice);
    r.marketCur = cur;
    if (msg.gradePrices) r.gradePrices = Object.fromEntries(Object.entries(msg.gradePrices).map(([k, v]) => [k, cad(v)]));
    if (msg.product) r.product = msg.product;
    if (msg.pop) r.pop = msg.pop;
    r.note = msg.note || '';
    r.pageUrl = msg.url;
    r.status = r.raw.length || r.marketPrice != null || r.gradePrices || msg.note ? 'ok' : 'loading';
    reclassify();
  } else if (msg.type === 'ebay-page-sales') {
    const r = state.src.ebay;
    if (!r || !state.parts) return;
    if (state.parts.keyWord && !msg.nkw.toLowerCase().includes(state.parts.keyWord.toLowerCase())) return;
    const sales = msg.sales.map(x => ({ ...x, date: new Date(x.date) }));
    // Each eBay results page you open adds to what's already read (page 2, 3 …).
    const byKey = new Map((r.status === 'ok' ? r.raw : []).map(x => [x.itemId || x.title + x.price, x]));
    for (const x of sales) byKey.set(x.itemId || x.title + x.price, x);
    const all = [...byKey.values()];
    Object.assign(r, { status: 'ok', blocked: false, raw: all, pageUrl: msg.url, note: `Read from your open eBay tab (${all.length} listings). Open the next results page to add more.` });
    cachePut('ebay', state.query, { url: msg.url, sales: all }).catch(() => {});
    reclassify();
  } else if (msg.type === '130-page-sales') {
    const r = state.src['130point'];
    if (!r || !state.parts) return;
    if (state.parts.keyWord && !msg.query.toLowerCase().includes(state.parts.keyWord.toLowerCase())) return;
    const sales = msg.sales.map(x => ({ ...x, date: new Date(x.date) }));
    Object.assign(r, { status: 'ok', blocked: false, raw: sales, pageUrl: msg.url, note: 'Read from your open 130point tab.' });
    cachePut('130point', state.query, { url: msg.url, sales }).catch(() => {});
    reclassify();
  } else if (msg.type === 'companions-changed') {
    refreshConnected();
  } else if (msg.type === 'cert-page-info') {
    onCertInfo(msg.info);
  } else if (msg.type === 'pending-query') {
    takePending();
  } else if (msg.type === 'rescan') {
    scanTab();
  }
});

async function takePending() {
  const { pendingQuery } = await chrome.storage.session.get('pendingQuery');
  if (!pendingQuery || Date.now() - pendingQuery.at > 60000) return false;
  await chrome.storage.session.remove('pendingQuery');
  const cert = GCP.parseCertQuery(pendingQuery.text) || GCP.detectCerts(pendingQuery.text)[0];
  const found = GCP.detectCards(pendingQuery.text, { max: 1, pokemonOnly: false });
  if (found.length) search(found[0].query, { askPrice: found[0].askPrice });
  else if (cert) lookupCert(cert);
  else search(pendingQuery.text);
  return true;
}

// ================================================================ aggregation
function mergedAll() {
  const out = new Map();
  for (const id of ORDER) {
    const r = state.src[id];
    if (!r || !r.include) continue;
    for (const s of r.sales) {
      if (state.prefs.excluded.includes(s.key)) continue;
      const prev = out.get(s.key);
      if (!prev) { out.set(s.key, { ...s, sources: [id] }); continue; }
      if (!prev.sources.includes(id)) prev.sources.push(id);
      if (s.realBestOffer && prev.bestOffer && !prev.realBestOffer) Object.assign(prev, { price: s.price, realBestOffer: true });
      if (!prev.img && s.img) prev.img = s.img;
    }
  }
  return [...out.values()].sort((a, b) => b.date - a.date);
}

function aggregate() {
  if (!state.parts) return;
  const now = new Date();
  const all = mergedAll();
  const trim = $('#trim').checked;
  let week = all.filter(s => GCP.inWindow(s, 7, now));
  const before = week.length;
  if (trim) week = GCP.trimOutliers(week);
  const w = GCP.windowStats(week, now);
  state.all = all; state.merged = week; state.week = w;
  const busy = loadingSources() > 0;

  // tiles
  const tiles = $('#tiles');
  tiles.innerHTML = '';
  const base = w['7d'] && w['7d'].avg;
  for (const win of GCP.WINDOWS) {
    const s = w[win.key];
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (win.days - 1));
    const el = document.createElement('div');
    el.className = 'tile' + (s ? '' : busy ? ' loading' : ' empty');
    el.title = `Sold ${shortDate(from)} – today`;
    let delta = '&nbsp;';
    if (s && base && win.key !== '7d') {
      const pct = (s.avg - base) / base * 100;
      if (Math.abs(pct) >= 0.5) delta = `<span class="delta ${pct > 0 ? 'up' : 'down'}">${pct > 0 ? '▲' : '▼'}${Math.abs(pct).toFixed(1)}% vs 7D</span>`;
    }
    el.innerHTML = `<div class="lbl"><span>${win.label}</span><span>${win.days === 1 ? shortDate(from) : shortDate(from) + '+'}</span></div>
      <div class="avg">${s ? money(s.avg) : busy ? '$0,000' : win.days === 1 ? 'None yet today' : 'No sales'}</div>
      <div class="sub">${s ? delta : '&nbsp;'}</div>
      <div class="sub">${s ? `${s.count} sale${s.count > 1 ? 's' : ''} · med ${money(s.median)}` : '&nbsp;'}</div>`;
    tiles.appendChild(el);
  }

  // key stats: last sale, 7-day low / high, 30-day average
  const month = all.filter(s => GCP.inWindow(s, 30, now));
  const m30 = GCP.stats((trim ? GCP.trimOutliers(month) : month).map(s => s.price));
  const lo = week.length ? week.reduce((a, b) => (b.price < a.price ? b : a)) : null;
  const hi = week.length ? week.reduce((a, b) => (b.price > a.price ? b : a)) : null;
  const last = all[0];
  const ks = (cls, label, val, sub) => `<div class="ks ${cls}${busy && !val ? ' loading' : ''}"><span>${label}</span><b>${val || (busy ? '$0,000' : '—')}</b><small>${sub || '&nbsp;'}</small></div>`;
  $('#keystats').innerHTML =
    ks('', 'Last sale', last && money(last.price), last && `${shortDate(last.date)} · ${P.META[last.sources[0]].name}`) +
    ks('low', 'Low · 7D', lo && money(lo.price), lo && shortDate(lo.date)) +
    ks('high', 'High · 7D', hi && money(hi.price), hi && shortDate(hi.date)) +
    ks('', 'Avg · 30D', m30 && money(m30.avg), m30 && `${m30.count} sales`);

  // footer
  const pendingEmbeds = Object.values(state.src).filter(r => r.status === 'loading' && P.META[r.id].mode === 'embed').length;
  const rejected = Object.values(state.src).reduce((n, r) => n + r.rejected.length, 0);
  const srcs = new Set(week.flatMap(s => s.sources));
  $('#summaryFoot').textContent = [
    busy ? 'Searching sources…' : `${week.length} sale${week.length === 1 ? '' : 's'} this week from ${srcs.size} source${srcs.size === 1 ? '' : 's'}`,
    before > week.length ? `${before - week.length} outlier${before - week.length > 1 ? 's' : ''} trimmed` : '',
    rejected ? `${rejected} other listings filtered out` : '',
    state.allow.length ? `treated as ${state.allow.join(', ')} card` : '',
    pendingEmbeds ? 'loading Alt/Collectr…' : ''
  ].filter(Boolean).join(' · ');

  renderRecent(all, busy);
  renderCardInfo();
  renderDeal();
  drawChart();
  renderGradesTable();
  maybeSnapshot();
}

// Accepted best offers: same card and grade, but eBay hides the real price. Shown in date order, never averaged.
function bestOfferSales(counted) {
  const have = new Set(counted.map(s => s.key));
  const out = new Map();
  for (const r of Object.values(state.src)) {
    if (!r.include) continue;
    for (const s of r.rejected) if (/^best offer/.test(s.reason) && !have.has(s.key) && !out.has(s.key)) out.set(s.key, { ...s, offer: true, sources: [r.id] });
  }
  return [...out.values()];
}

function renderRecent(all, busy) {
  const ol = $('#recent');
  ol.innerHTML = '';
  const offers = bestOfferSales(all);
  // Newest first; same-day sales keep the marketplace's own order (most recently ended first).
  const rows = [...all, ...offers].sort((a, b) => b.date - a.date);
  const SHOW = 10;
  const n = showAllSales ? 80 : SHOW;
  $('#salesCount').textContent = all.length ? `${all.length} matching sale${all.length > 1 ? 's' : ''}${offers.length ? ` + ${offers.length} best offer${offers.length > 1 ? 's' : ''}` : ''}` : '';
  if (!rows.length) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="empty-row">${busy ? 'Loading sales…' : 'No matching sales found. Open a source below to see what was filtered out.'}</span>`;
    ol.appendChild(li);
  }
  for (const s of rows.slice(0, n)) {
    const li = saleLi(s, true);
    if (s.offer) {
      li.classList.add('offer');
      li.querySelector('.d').textContent += ' · best offer accepted: real price hidden, not in average';
      li.querySelector('.p').title = 'Listed price. The accepted offer was lower and eBay doesn’t show it. Tick “Count eBay best-offer list prices” to include these, or check 130point.';
      li.querySelector('.p').onclick = null;
    }
    ol.appendChild(li);
  }
  const more = $('#moreSales');
  more.hidden = rows.length <= SHOW;
  more.textContent = showAllSales ? 'Show fewer' : `Show ${Math.min(rows.length, 80) - SHOW} more`;
}
$('#moreSales').onclick = () => { showAllSales = !showAllSales; renderRecent(state.all, false); };

// ================================================================ card details & population
let popGrader = null;
const GRADE_ORDER = (g) => (g === 'BL' ? 10.6 : parseFloat(g));
const gradeName = (grader, g) => g === 'BL' ? (grader === 'BGS' ? 'Black Label' : grader === 'CGC' ? 'Pristine 10' : 'BL') : `${grader} ${g}`;

// Best available population per grader: PSA's own API > the most complete other source.
function populations() {
  const cands = [];
  if (state.cert && state.cert.specPop) cands.push({ ...state.cert.specPop, rank: 3 });
  for (const id of ['pricecharting', 'alt', 'cardladder', 'collectr']) {
    const r = state.src[id];
    if (r && r.pop) cands.push({ ...r.pop, rank: 1 });
  }
  const out = {};
  for (const c of cands) {
    for (const [grader, counts] of Object.entries(c.graders || {})) {
      // A source's own total (PSA's includes "Authentic" slabs) beats summing the grades.
      const total = (c.total && Object.keys(c.graders).length === 1 ? c.total : 0) || Object.values(counts).reduce((a, b) => a + b, 0);
      const cur = out[grader];
      if (!cur || c.rank > cur.rank || (c.rank === cur.rank && total > cur.total)) out[grader] = { counts, total, source: c.source, note: c.note, rank: c.rank };
    }
  }
  return out;
}

function renderCardInfo() {
  const pc = state.src.pricecharting;
  const info = (pc && pc.info) || {};
  const img = $('#cardImg');
  const slab = state.cert && state.cert.images && state.cert.images[0];
  const imgUrl = (slab && slab.url) || info.image;
  if (imgUrl) { img.src = imgUrl; img.hidden = false; img.title = slab ? 'Your slab (PSA photo)' : ''; } else img.hidden = true;
  const pops = populations();
  const graders = Object.keys(pops);
  const facts = [];
  if (info.title) facts.push(`<span><b>${esc(info.title)}</b></span>`);
  if (info.cardNumber) facts.push(`<span>No. <b>${esc(info.cardNumber.replace(/^#/, ''))}</b></span>`);
  if (info.releaseDate) facts.push(`<span>Released <b>${esc(info.releaseDate)}</b></span>`);
  if (info.publisher) facts.push(`<span>${esc(info.publisher)}</span>`);
  if (state.cert && state.cert.subject) {
    facts.push(`<span>Slab: <b>${esc(state.cert.grader)} #${esc(state.cert.cert)}</b> · ${esc([state.cert.year, state.cert.brand, state.cert.gradeText].filter(Boolean).join(' · '))}` +
      `${state.cert.pop != null ? ` · pop <b>${Number(state.cert.pop).toLocaleString()}</b>` : ''}${state.cert.popHigher != null ? ` · <b>${Number(state.cert.popHigher).toLocaleString()}</b> higher` : ''}` +
      `${(state.cert.images || []).length ? ' · photos: ' + state.cert.images.map((im, i) => `<a href="${esc(im.url)}" target="_blank" rel="noopener">${im.front ? 'front' : i === 1 ? 'back' : 'photo ' + (i + 1)}</a>`).join(' · ') : ''}</span>`);
  }
  const block = $('#popBlock');
  block.hidden = !graders.length && !facts.length;
  if (block.hidden) return;
  $('#cardFacts').innerHTML = facts.join('');

  // grader tabs
  const want = state.parts.grader;
  if (!popGrader || !pops[popGrader]) popGrader = pops[want] ? want : graders[0];
  const seg = $('#popSeg');
  seg.innerHTML = graders.map(g => `<button data-g="${g}" class="${g === popGrader ? 'on' : ''}">${g}</button>`).join('');
  seg.querySelectorAll('button').forEach(b => (b.onclick = () => { popGrader = b.dataset.g; renderCardInfo(); }));
  if (!popGrader) { $('#popStats').innerHTML = ''; $('#popBars').innerHTML = '<span class="muted small">No population data found for this card.</span>'; $('#popSource').textContent = ''; return; }

  const p = pops[popGrader];
  const grades = Object.keys(p.counts).sort((a, b) => GRADE_ORDER(b) - GRADE_ORDER(a));
  const target = popGrader === want ? (state.parts.qual ? 'BL' : state.parts.grade) : null;
  const atGrade = target != null ? p.counts[target] : null;
  const higher = target != null ? grades.filter(g => GRADE_ORDER(g) > GRADE_ORDER(target)).reduce((a, g) => a + p.counts[g], 0) : null;
  const gems = (p.counts['10'] || 0) + (p.counts.BL || 0);
  const ks = (label, val, sub) => `<div class="ks"><span>${label}</span><b>${val}</b><small>${sub || '&nbsp;'}</small></div>`;
  $('#popStats').innerHTML =
    ks(target ? `Pop · ${esc(gradeName(popGrader, target))}` : 'Pop', atGrade != null ? atGrade.toLocaleString() : '—', atGrade != null && p.total ? `${(atGrade / p.total * 100).toFixed(1)}% of graded` : '') +
    ks('Graded higher', higher != null ? higher.toLocaleString() : '—', higher === 0 ? 'top grade' : '') +
    ks(`Total ${popGrader}`, p.total.toLocaleString(), p.note || '') +
    ks('Gem rate', p.total ? `${(gems / p.total * 100).toFixed(1)}%` : '—', `${popGrader} 10${popGrader !== 'PSA' && p.counts.BL ? ' + BL/Pristine' : ''}`);
  const max = Math.max(...grades.map(g => p.counts[g]), 1);
  $('#popBars').innerHTML = grades.map(g => `<div class="popbar${g === target ? ' cur' : ''}" data-g="${g}" title="Price ${esc(gradeName(popGrader, g))}">
      <span class="g">${esc(gradeName(popGrader, g))}</span><span class="track"><span class="fill" style="width:${(p.counts[g] / max * 100).toFixed(1)}%"></span></span>
      <span class="n">${p.counts[g].toLocaleString()}</span></div>`).join('');
  $('#popBars').querySelectorAll('.popbar').forEach(el => (el.onclick = () => {
    const g = el.dataset.g;
    switchGrade(g === 'BL' ? (popGrader === 'BGS' ? 'BGS Black Label 10' : `${popGrader} Pristine 10`) : `${popGrader} ${g}`);
  }));
  $('#popSource').textContent = `Population from ${p.source}${p.note ? ` (${p.note})` : ''}.`;
}

// ================================================================ deal check
function askValue() { return parseFloat(String($('#ask').value).replace(/[$,\s]/g, '').replace(/k$/i, '000')) || null; }
function renderDeal() {
  const v = askValue();
  const out = $('#dealVerdict');
  out.className = 'verdict muted';
  if (!v) { out.textContent = 'Compare a price with recent sales'; return; }
  const ref = state.week && state.week['7d'];
  if (!ref) { out.textContent = 'No sales this week to compare with'; return; }
  const pct = (v - ref.avg) / ref.avg * 100;
  out.className = 'verdict ' + (pct <= -3 ? 'good' : pct >= 5 ? 'bad' : 'fair');
  out.textContent = `${Math.abs(pct) < 3 ? 'About market' : pct < 0 ? `${Math.abs(pct).toFixed(1)}% below` : `${pct.toFixed(1)}% above`} 7D avg ${money(ref.avg)} · range ${money(ref.low, true)}–${money(ref.high, true)}`;
  out.title = out.textContent;
}

// ================================================================ trend chart
document.querySelectorAll('#rangeSeg button').forEach(b => (b.onclick = () => {
  rangeDays = +b.dataset.days;
  document.querySelectorAll('#rangeSeg button').forEach(x => x.classList.toggle('on', x === b));
  drawChart();
}));

function drawChart() {
  const svg = $('#chart');
  const tip = $('#tip');
  tip.hidden = true;
  const W = Math.max(240, svg.clientWidth || 320), H = 160, padL = 46, padR = 10, padT = 10, padB = 18;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const now = new Date();
  let sales = (state.all || []).filter(s => GCP.inWindow(s, rangeDays, now));
  if ($('#trim').checked) sales = GCP.trimOutliers(sales);
  if (!sales.length) {
    svg.innerHTML = `<text x="${W / 2}" y="${H / 2}" text-anchor="middle">${loadingSources() ? 'Loading…' : `No matching sales in the last ${rangeDays} days`}</text>`;
    $('#legend').innerHTML = '';
    svg.onmousemove = null;
    return;
  }
  // Daily averages → trend line; every sale also drawn as a small dot.
  const byDay = new Map();
  for (const s of sales) {
    const d = GCP.daysAgo(s.date, now);
    (byDay.get(d) || byDay.set(d, []).get(d)).push(s);
  }
  const days = [...byDay.keys()].sort((a, b) => b - a);
  const daily = days.map(d => ({ d, list: byDay.get(d), avg: byDay.get(d).reduce((a, s) => a + s.price, 0) / byDay.get(d).length }));
  const ask = askValue();
  const prices = sales.map(s => s.price).concat(ask ? [ask] : []);
  let lo = Math.min(...prices), hi = Math.max(...prices);
  if (hi === lo) { lo *= 0.9; hi *= 1.1; }
  const pad = (hi - lo) * 0.12; lo = Math.max(0, lo - pad); hi += pad;
  const span = Math.max(rangeDays, 1);
  const x = (dago) => padL + (span - Math.min(span, dago)) / span * (W - padL - padR);
  const y = (p) => padT + (1 - (p - lo) / (hi - lo)) * (H - padT - padB);
  let out = '';
  for (let i = 0; i <= 3; i++) {
    const p = lo + (hi - lo) * i / 3;
    out += `<line class="grid" x1="${padL}" x2="${W - padR}" y1="${y(p)}" y2="${y(p)}"/><text x="${padL - 4}" y="${y(p) + 3}" text-anchor="end">${money(p, true)}</text>`;
  }
  const ticks = rangeDays <= 7 ? [7, 5, 3, 1, 0] : rangeDays <= 30 ? [30, 21, 14, 7, 0] : rangeDays <= 90 ? [90, 60, 30, 0] : [365, 270, 180, 90, 0];
  for (const t of ticks) {
    const dt = new Date(now.getFullYear(), now.getMonth(), now.getDate() - t);
    out += `<text x="${Math.min(W - padR - 12, Math.max(padL + 12, x(t)))}" y="${H - 4}" text-anchor="middle">${t === 0 ? 'today' : shortDate(dt)}</text>`;
  }
  const avg = sales.reduce((a, s) => a + s.price, 0) / sales.length;
  out += `<line class="avgline" x1="${padL}" x2="${W - padR}" y1="${y(avg)}" y2="${y(avg)}"/>`;
  if (ask) out += `<line class="askline" x1="${padL}" x2="${W - padR}" y1="${y(ask)}" y2="${y(ask)}"/>`;
  for (const s of sales) {
    out += `<circle class="pt" cx="${x(GCP.daysAgo(s.date, now))}" cy="${y(s.price)}" r="2.6" fill="${P.META[s.sources[0]].color}" fill-opacity=".55"/>`;
  }
  if (daily.length > 1) {
    const pts = daily.map(p => `${x(p.d).toFixed(1)},${y(p.avg).toFixed(1)}`);
    out += `<path class="area" d="M${x(daily[0].d)},${H - padB} L${pts.join(' L')} L${x(daily[daily.length - 1].d)},${H - padB} Z"/>`;
    out += `<path class="trend" d="M${pts.join(' L')}"/>`;
  } else {
    out += `<circle cx="${x(daily[0].d)}" cy="${y(daily[0].avg)}" r="4" fill="var(--line-c)"/>`;
  }
  out += `<line class="cursor" id="cursor" x1="0" x2="0" y1="${padT}" y2="${H - padB}" visibility="hidden"/>`;
  svg.innerHTML = out;

  // Hover: nearest day → tooltip with that day's average and sale count.
  svg.onmousemove = (e) => {
    const rect = svg.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (W / rect.width);
    let best = daily[0];
    for (const p of daily) if (Math.abs(x(p.d) - mx) < Math.abs(x(best.d) - mx)) best = p;
    const cur = svg.querySelector('#cursor');
    cur.setAttribute('x1', x(best.d)); cur.setAttribute('x2', x(best.d)); cur.setAttribute('visibility', 'visible');
    const dt = best.list[0].date;
    tip.innerHTML = `${shortDate(dt)} · <b>${money(best.avg)}</b> avg · ${best.list.length} sale${best.list.length > 1 ? 's' : ''}` +
      (best.list.length > 1 ? ` (${money(Math.min(...best.list.map(s => s.price)), true)}–${money(Math.max(...best.list.map(s => s.price)), true)})` : '');
    tip.hidden = false;
    const px = x(best.d) / W * rect.width;
    tip.style.left = Math.max(0, Math.min(rect.width - tip.offsetWidth, px - tip.offsetWidth / 2)) + 'px';
  };
  svg.onmouseleave = () => { tip.hidden = true; const c = svg.querySelector('#cursor'); if (c) c.setAttribute('visibility', 'hidden'); };

  const first = daily[0], lastD = daily[daily.length - 1];
  const change = daily.length > 1 ? (lastD.avg - first.avg) / first.avg * 100 : null;
  const used = [...new Set(sales.map(s => s.sources[0]))];
  $('#legend').innerHTML = `<span style="color:var(--line-c)">━ daily avg</span><span>- - ${rangeDays}D avg ${money(avg, true)}</span>` +
    (change != null ? `<span class="delta ${change >= 0 ? 'up' : 'down'}">${change >= 0 ? '▲' : '▼'}${Math.abs(change).toFixed(1)}% over period</span>` : '') +
    used.map(id => `<span><i style="background:${P.META[id].color}"></i>${P.META[id].name}</span>`).join('') +
    (ask ? '<span style="color:var(--accent)">- - asking</span>' : '');
}
new ResizeObserver(() => state.parts && drawChart()).observe($('#chart'));

// ================================================================ other grades
function renderGradesTable() {
  const box = $('#gradesBox');
  const now = new Date();
  const byGrade = {};
  const seen = new Set();
  for (const id of ['ebay', '130point', 'pricecharting']) {
    const r = state.src[id];
    if (!r || !r.raw) continue;
    for (const s of r.raw) {
      if (!s.date || !GCP.inWindow(s, 30, now) || P.JUNK_RE.test(s.title || '')) continue;
      const uniq = new Set(GCP.findGrades(s.title || '').map(GCP.gradeLabel));
      if (uniq.size !== 1 || !GCP.matchCard(s.title, state.partsM).ok) continue;
      const key = s.itemId ? 'i:' + s.itemId : id + s.price + +s.date;
      if (seen.has(key)) continue;
      seen.add(key);
      const label = [...uniq][0];
      const c = inCAD(s, id);
      if (!c || (c.converted && !settings.includeConverted)) continue;
      (byGrade[label] = byGrade[label] || []).push(c);
    }
  }
  const cp = (state.src.collectr && state.src.collectr.gradePrices) || {};
  const gradeNum = (g) => parseFloat(g.match(/[\d.]+$/)[0]) + (/Black|Pristine/.test(g) ? 0.6 : 0);
  const extra = Object.keys(byGrade).filter(g => !COMMON_GRADES.includes(g) && byGrade[g].length >= 3 && gradeNum(g) >= 7).sort((a, b) => gradeNum(b) - gradeNum(a));
  const labels = [...COMMON_GRADES.filter(g => byGrade[g] || cp[g]), ...extra].slice(0, 10);
  if (!labels.length) { box.hidden = true; return; }
  box.hidden = false;
  const cur = GCP.gradeLabel(state.parts);
  const tbody = $('#gradesTable tbody');
  tbody.innerHTML = '';
  for (const g of labels) {
    const list = (byGrade[g] || []).sort((a, b) => b.date - a.date);
    const st = GCP.stats(GCP.trimOutliers(list).map(s => s.price));
    const tr = document.createElement('tr');
    if (g === cur) tr.className = 'cur';
    tr.innerHTML = `<td>${esc(g)}</td><td>${st ? money(st.avg) : '—'}</td><td>${list.length || '—'}</td><td>${list[0] ? money(list[0].price) : '—'}</td><td>${cp[g] ? money(cp[g], true) : '—'}</td>`;
    tr.onclick = () => switchGrade(g);
    tbody.appendChild(tr);
  }
}

// ================================================================ grade switching
function switchGrade(label) {
  const p = state.parts;
  if (!p) return;
  search([p.name, p.number, label].filter(Boolean).join(' '));
}
function renderGradeBar() {
  const bar = $('#gradeBar');
  const cur = state.parts ? GCP.gradeLabel(state.parts) : '';
  const opts = cur && !GRADE_BAR.includes(cur) ? [cur, ...GRADE_BAR] : GRADE_BAR;
  bar.innerHTML = '';
  for (const g of opts) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = g;
    b.disabled = !state.parts;
    if (g === cur) b.className = 'active';
    b.onclick = () => switchGrade(g);
    bar.appendChild(b);
  }
}

// ================================================================ watchlist
async function loadWatchlist() {
  watchlist = (await chrome.storage.local.get('watchlist')).watchlist || {};
  renderWatchlist();
}
const saveWatchlist = () => chrome.storage.local.set({ watchlist });
function renderWatchlist() {
  const items = Object.values(watchlist).sort((a, b) => (b.snaps.at(-1)?.t || b.added) - (a.snaps.at(-1)?.t || a.added));
  $('#watchBox').hidden = !items.length;
  $('#watchCount').textContent = items.length ? String(items.length) : '';
  const ol = $('#watchList');
  ol.innerHTML = '';
  for (const it of items) {
    const lastS = it.snaps.at(-1), prevS = it.snaps.at(-2);
    let delta = '<span></span>';
    if (lastS && prevS && prevS.avg7) {
      const pct = (lastS.avg7 - prevS.avg7) / prevS.avg7 * 100;
      delta = `<span class="delta ${pct >= 0 ? 'up' : 'down'}">${pct >= 0 ? '▲' : '▼'}${Math.abs(pct).toFixed(1)}%</span>`;
    }
    const li = document.createElement('li');
    li.innerHTML = `<span class="n" title="${esc(it.query)}">${esc(it.query)}</span>${delta}<span class="v" title="${lastS ? '7-day avg on ' + new Date(lastS.t).toLocaleString() : 'Not priced yet'}">${lastS ? money(lastS.avg7) : '—'}</span><button class="x" title="Remove">×</button>`;
    li.querySelector('.n').onclick = () => search(it.query);
    li.querySelector('.x').onclick = () => { delete watchlist[it.query.toLowerCase()]; saveWatchlist(); renderWatchlist(); renderWatchButton(); };
    ol.appendChild(li);
  }
}
function renderWatchButton() {
  const on = !!watchlist[state.query.toLowerCase()];
  $('#watchBtn').textContent = on ? '★' : '☆';
  $('#watchBtn').title = on ? 'Watching: click to remove' : 'Add to watchlist';
  $('#watchBtn').classList.toggle('on', on);
}
function maybeSnapshot() {
  const k = state.query.toLowerCase();
  if (state.snapshotDone || loadingSources() || !watchlist[k] || !state.week || !state.week['7d']) return;
  state.snapshotDone = true;
  const snaps = watchlist[k].snaps;
  const snap = { t: Date.now(), avg7: state.week['7d'].avg, n7: state.week['7d'].count };
  if (snaps.length && Date.now() - snaps.at(-1).t < 3 * 3600e3) snaps[snaps.length - 1] = snap; else snaps.push(snap);
  if (snaps.length > 60) snaps.shift();
  saveWatchlist();
  renderWatchlist();
}
$('#watchBtn').onclick = () => {
  const k = state.query.toLowerCase();
  if (!k) return;
  if (watchlist[k]) delete watchlist[k];
  else { watchlist[k] = { query: state.query, added: Date.now(), snaps: [] }; state.snapshotDone = false; maybeSnapshot(); }
  saveWatchlist();
  renderWatchlist();
  renderWatchButton();
};

// ================================================================ copy
$('#copyBtn').onclick = async () => {
  const w = state.week || {};
  const lines = [`${state.query}: recent sold prices (CAD)`];
  for (const win of GCP.WINDOWS) {
    const s = w[win.key];
    lines.push(`${win.label}: ${s ? `${money(s.avg)} avg (${s.count} sale${s.count > 1 ? 's' : ''}, ${money(s.low)}–${money(s.high)})` : 'no sales'}`);
  }
  if (state.all[0]) lines.push(`Last sale: ${money(state.all[0].price)} on ${shortDate(state.all[0].date)}`);
  const cp = state.src.collectr && state.src.collectr.marketPrice;
  if (cp) lines.push(`Collectr ${GCP.gradeLabel(state.parts)} market: ${money(cp)}`);
  if (state.cert) lines.push(`${state.cert.grader} cert #${state.cert.cert}`);
  const srcs = [...new Set(state.merged.flatMap(s => s.sources))].map(id => P.META[id].name);
  if (srcs.length) lines.push(`Sources: ${srcs.join(', ')}`);
  await navigator.clipboard.writeText(lines.join('\n'));
  toast('Summary copied');
};
function toast(text) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = text;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 1600);
}

// ================================================================ wiring
$('#searchForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = $('#q').value.trim();
  search(v, { force: v === state.query, askPrice: v === state.query ? askValue() : null });
});
$('#refreshBtn').onclick = () => state.cert && !state.parts ? lookupCert(state.cert) : search(state.query, { force: true, askPrice: askValue(), cert: state.cert });
$('#scanBtn').onclick = () => scanTab();
$('#tabPromptScan').onclick = () => scanTab();
$('#trim').addEventListener('change', aggregate);
$('#bestOffers').addEventListener('change', () => { settings.excludeBestOffers = !$('#bestOffers').checked; reclassify(); });
$('#converted').addEventListener('change', () => {
  settings.includeConverted = $('#converted').checked;
  chrome.storage.sync.set({ includeConverted: settings.includeConverted });
  reclassify();
});
$('#ask').addEventListener('input', () => { renderDeal(); drawChart(); });
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'sync' || (area === 'local' && P.SECRET_KEYS.some(k => k in changes))) loadSettings(); });

(async function init() {
  await loadSettings();
  fx = await P.getRates();
  await refreshConnected();
  await loadWatchlist();
  renderGradeBar();
  const pending = await takePending();
  // First open: scan the current page once. After that, scanning only happens when asked.
  await scanTab({ initial: !pending });
})();
