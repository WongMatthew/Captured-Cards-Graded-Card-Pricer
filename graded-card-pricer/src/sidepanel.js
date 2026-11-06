/* global GCP, GCPPlatforms */
const P = GCPPlatforms;
const $ = (s) => document.querySelector(s);
const money = (n, whole) => n == null || isNaN(n) ? '—' : n.toLocaleString('en-US', {
  style: 'currency', currency: 'USD',
  minimumFractionDigits: whole || n >= 1000 ? 0 : 2, maximumFractionDigits: whole || n >= 1000 ? 0 : 2
});
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const shortDate = (d) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const CACHE_VER = 'v2';
const CACHE_MS = 15 * 60 * 1000;
const EMBED_WAIT_MS = 45000;
const MOBILE_W = 390;
const PLATFORM_ORDER = ['ebay', '130point', 'pricecharting', 'alt', 'collectr'];
const COMMON_GRADES = ['PSA 10', 'PSA 9', 'PSA 8', 'BGS Black Label 10', 'BGS 10', 'BGS 9.5', 'BGS 9', 'CGC Pristine 10', 'CGC 10', 'CGC 9.5', 'CGC 9', 'SGC 10', 'TAG 10'];

let settings = structuredClone(P.DEFAULTS);
let state = blankState();
let activeTabId = null;
let lastCards = [];
const autoSearched = new Set();
let watchlist = {};

function blankState() {
  return { query: '', parts: null, sid: '', results: {}, prefs: { excluded: [], forced: [] }, askPrice: null, merged: [], snapshotDone: false, at: 0 };
}

// ================================================================ settings
async function loadSettings() {
  const s = await chrome.storage.sync.get(null);
  settings = structuredClone(P.DEFAULTS);
  for (const k of ['autoScan', 'autoSearch', 'trimOutliers', 'pokemonOnly', 'excludeBestOffers']) if (k in s) settings[k] = s[k];
  if (s.platforms) for (const id of Object.keys(settings.platforms)) Object.assign(settings.platforms[id], s.platforms[id] || {});
  $('#trim').checked = settings.trimOutliers;
  $('#bestOffers').checked = !settings.excludeBestOffers;
}

// ================================================================ detections
async function refreshDetections() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  activeTabId = tab.id;
  const data = (await chrome.storage.session.get('tab:' + tab.id))['tab:' + tab.id];
  renderChips(data ? data.cards : []);
  const top = data && data.cards[0];
  if (settings.autoSearch && top && !autoSearched.has(tab.id + '|' + top.query)) {
    autoSearched.add(tab.id + '|' + top.query);
    // Don't hijack a search the user typed; do follow when they switch emails.
    if (!state.query || state.auto) search(top.query, { auto: true, askPrice: top.askPrice });
  }
}

function renderChips(cards) {
  lastCards = cards || [];
  const box = $('#chips');
  box.innerHTML = '';
  $('#detectedLabel').textContent = lastCards.length ? `${lastCards.length} graded card${lastCards.length > 1 ? 's' : ''} on this page` : 'Cards on this page';
  if (!lastCards.length) { box.innerHTML = '<span class="muted">Nothing detected yet.</span>'; return; }
  for (const c of lastCards) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip' + (c.query === state.query ? ' active' : '');
    b.title = c.raw;
    b.innerHTML = `${esc(c.name)}${c.number ? ' ' + esc(c.number) : ''}<b>${esc(GCP.gradeLabel(c))}</b>${c.askPrice ? `<i>· ${money(c.askPrice)}</i>` : ''}`;
    b.onclick = () => search(c.query, { askPrice: c.askPrice });
    box.appendChild(b);
  }
}

async function scanPage(tabId) {
  const [tab] = tabId ? [{ id: tabId }] : await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  const btn = $('#scanBtn');
  btn.textContent = 'Scanning…';
  let res = null;
  try {
    res = await chrome.tabs.sendMessage(tab.id, { type: 'scan-now' });
  } catch (e) {
    // Page was open before the extension was installed/updated: inject the scanner now.
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/detect.js', 'src/content.js'] });
      res = await chrome.tabs.sendMessage(tab.id, { type: 'scan-now' });
    } catch (e2) { res = null; }
  }
  btn.textContent = 'Scan page';
  if (!res) { $('#chips').innerHTML = '<span class="muted">Can’t read this page (browser pages and the Web Store are off-limits).</span>'; return; }
  await chrome.storage.session.set({ ['tab:' + tab.id]: { url: res.url, title: res.title, cards: res.cards, at: Date.now() } });
  renderChips(res.cards);
  if (!res.cards.length) $('#chips').innerHTML = '<span class="muted">No graded cards found. Try highlighting the card text first.</span>';
  else if (res.fromSelection || !state.query) search(res.cards[0].query, { askPrice: res.cards[0].askPrice });
}

// ================================================================ cache & prefs
const cacheKey = (id, q) => `cache:${CACHE_VER}:${id}:${q.toLowerCase()}`;
async function cacheGet(id, q) {
  const k = cacheKey(id, q);
  const v = (await chrome.storage.local.get(k))[k];
  if (!v || Date.now() - v.at > CACHE_MS) return null;
  v.data.sales.forEach(s => (s.date = new Date(s.date)));
  return { ...v.data, cachedAt: v.at };
}
async function cachePut(id, q, data) {
  await chrome.storage.local.set({ [cacheKey(id, q)]: { at: Date.now(), data: { ...data, sales: data.sales.map(s => ({ ...s, date: s.date.toISOString() })) } } });
}
const prefsKey = (q) => 'prefs:' + q.toLowerCase();
async function loadPrefs(q) {
  const v = (await chrome.storage.local.get(prefsKey(q)))[prefsKey(q)];
  return { excluded: v?.excluded || [], forced: v?.forced || [] };
}
const savePrefs = () => chrome.storage.local.set({ [prefsKey(state.query)]: state.prefs });

// ================================================================ search
async function search(q, opts = {}) {
  q = String(q || '').replace(/\s+/g, ' ').trim();
  if (!q) return;
  const parts = GCP.splitQuery(q);
  state = blankState();
  Object.assign(state, { query: q, parts, sid: String(Date.now()), auto: !!opts.auto, at: Date.now() });
  state.prefs = await loadPrefs(q);
  state.askPrice = opts.askPrice ?? null;
  $('#ask').value = state.askPrice ? String(state.askPrice) : '';
  $('#q').value = q;
  $('#empty').hidden = true;
  $('#summary').hidden = false;
  $('#summaryTitle').textContent = q;
  $('#summaryMeta').textContent = parts.grade ? '' : 'No grade found in the search: add one, e.g. “PSA 10”.';
  renderChips(lastCards);
  renderGradeBar();
  renderWatchButton();

  const grid = $('#platforms');
  grid.innerHTML = '';
  for (const id of PLATFORM_ORDER) {
    const cfg = settings.platforms[id];
    if (!cfg || !cfg.enabled) continue;
    const meta = P.META[id];
    state.results[id] = { id, status: 'loading', sales: [], rejected: [], raw: [], include: true, url: P.pageUrl(id, q, cfg, parts), expanded: false };
    grid.appendChild(buildCard(id, meta));
    renderPlatform(id);
    if (meta.mode === 'fetch') runFetch(id, cfg, opts.force);
    else {
      setMini(id, true);
      const sid = state.sid;
      setTimeout(() => {
        const r = state.results[id];
        if (sid === state.sid && r && r.status === 'loading') {
          r.status = 'empty';
          r.note = r.note || (id === 'alt' ? 'No sold history read yet. Try 📱 Phone (signed in to Alt).' : 'Collectr didn’t load. Try 📱 Phone.');
          renderPlatform(id); aggregate();
        }
      }, EMBED_WAIT_MS);
    }
  }
  aggregate();
}

async function runFetch(id, cfg, force) {
  const sid = state.sid, q = state.query, parts = state.parts;
  const r = state.results[id];
  try {
    let data = force ? null : await cacheGet(id, q);
    if (!data) {
      data = await P.FETCHERS[id](q, cfg, parts);
      cachePut(id, q, data).catch(() => {});
    }
    if (sid !== state.sid) return;
    Object.assign(r, { status: 'ok', url: data.url || r.url, product: data.product, raw: data.sales, cachedAt: data.cachedAt });
    classify(id);
  } catch (e) {
    if (sid !== state.sid) return;
    Object.assign(r, { status: 'error', error: e.name === 'AbortError' ? 'Timed out' : (e.message || String(e)) });
  }
  renderPlatform(id);
  aggregate();
}

// ================================================================ filtering
const saleKey = (s, id) => s.itemId ? 'i:' + s.itemId : `${id}:${s.price}:${+s.date}:${(s.title || '').slice(0, 50)}`;

function reasonFor(s, id) {
  const { grader, grade, qual } = state.parts;
  const title = s.title || '';
  if (P.JUNK_RE.test(title)) return 'lot / proxy / custom';
  const grades = GCP.findGrades(title);
  if (s.scoped) {
    // Rows from an Alt item's own sales history: only reject if they name a different grade.
    if (grader && grades.length && !GCP.titleMatchesGrade(title, grader, grade, qual)) return 'different grade';
    return null;
  }
  if (grader) {
    if (!grades.length) return 'no grade in title';
    if (!GCP.titleMatchesGrade(title, grader, grade, qual)) {
      const other = grades.find(g => !(g.grader === grader && g.grade === grade));
      return other ? GCP.gradeLabel(other) : (qual ? 'not ' + GCP.gradeLabel(state.parts) : 'Black Label / Pristine');
    }
  }
  const m = GCP.matchCard(title, state.parts);
  if (!m.ok) return m.reason;
  if (s.bestOffer && !s.realBestOffer && settings.excludeBestOffers) return 'best offer (real price hidden)';
  return null;
}

function classify(id) {
  const r = state.results[id];
  const forced = new Set(state.prefs.forced);
  r.sales = []; r.rejected = [];
  for (const s of r.raw || []) {
    if (!s.price || !s.date || isNaN(s.date)) continue;
    const key = saleKey(s, id);
    const reason = forced.has(key) ? null : reasonFor(s, id);
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
  Object.keys(state.results).forEach(classify);
  Object.keys(state.results).forEach(renderPlatform);
  aggregate();
}

function toggleExcluded(key) {
  const x = new Set(state.prefs.excluded);
  x.has(key) ? x.delete(key) : x.add(key);
  state.prefs.excluded = [...x];
  savePrefs();
  Object.keys(state.results).forEach(renderPlatform);
  aggregate();
}

// ================================================================ embedded views
function frameUrl(id) {
  const tag = encodeURIComponent(JSON.stringify({ q: state.query, sid: state.sid }));
  return state.results[id].url + '#gcp=' + tag;
}

function fitMini(card) {
  const mini = card.querySelector('.mini');
  const frame = mini.querySelector('iframe');
  const mobile = P.META[card.dataset.id].mode === 'embed';
  const w = mini.clientWidth || 340;
  const designW = mobile ? MOBILE_W : 1100;
  const scale = w / designW;
  frame.style.width = designW + 'px';
  frame.style.height = Math.ceil(mini.clientHeight / scale) + 'px';
  frame.style.transform = `scale(${scale})`;
}
const ro = new ResizeObserver((entries) => entries.forEach(e => fitMini(e.target.closest('.pcard'))));

function setMini(id, on) {
  const card = document.querySelector(`.pcard[data-id="${id}"]`);
  if (!card) return;
  const mini = card.querySelector('.mini');
  const frame = mini.querySelector('iframe');
  mini.hidden = !on;
  card.querySelector('.live').textContent = on ? 'Hide view' : 'Mini view';
  if (on) {
    const url = P.META[id].mode === 'embed' ? frameUrl(id) : state.results[id].url;
    if (frame.dataset.src !== url) { frame.dataset.src = url; frame.src = url; }
    ro.observe(mini);
    requestAnimationFrame(() => fitMini(card));
  }
}

function openPhone(id) {
  chrome.runtime.sendMessage({ type: 'open-companion', platform: id, url: frameUrl(id) });
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'frame-sales' || msg.type === 'frame-status') {
    const r = state.results[msg.platform];
    if (!r || msg.sid !== state.sid || P.META[msg.platform].mode !== 'embed') return;
    if (msg.type === 'frame-status') {
      if (r.status === 'loading') { r.progress = msg.text; renderPlatform(msg.platform); }
      return;
    }
    r.raw = (msg.rows || []).map(x => ({ ...x, date: new Date(x.date) }));
    r.marketPrice = msg.marketPrice;
    r.gradePrices = msg.gradePrices || r.gradePrices;
    r.rawPrice = msg.rawPrice ?? r.rawPrice;
    if (msg.product) r.product = msg.product;
    r.note = msg.note || '';
    r.pageUrl = msg.url;
    classify(msg.platform);
    r.status = r.sales.length || r.marketPrice != null || r.gradePrices ? 'ok' : msg.note ? 'empty' : 'loading';
    renderPlatform(msg.platform);
    aggregate();
  } else if (msg.type === 'detections-updated' && msg.tabId === activeTabId) {
    refreshDetections();
  } else if (msg.type === 'pending-query') {
    takePending();
  } else if (msg.type === 'rescan') {
    scanPage(msg.tabId);
  }
});

async function takePending() {
  const { pendingQuery } = await chrome.storage.session.get('pendingQuery');
  if (!pendingQuery || Date.now() - pendingQuery.at > 60000) return;
  await chrome.storage.session.remove('pendingQuery');
  const found = GCP.detectCards(pendingQuery.text, { max: 1, pokemonOnly: false });
  if (found.length) search(found[0].query, { askPrice: found[0].askPrice });
  else search(pendingQuery.text);
}

// ================================================================ platform cards
function buildCard(id, meta) {
  const node = $('#platformTpl').content.firstElementChild.cloneNode(true);
  node.dataset.id = id;
  const badge = node.querySelector('.pbadge');
  badge.textContent = meta.short;
  badge.style.background = meta.color;
  node.querySelector('.pname strong').textContent = meta.name;
  node.querySelector('.pname small').textContent = meta.note;
  node.querySelector('.include').onchange = (e) => {
    state.results[id].include = e.target.checked;
    node.classList.toggle('off', !e.target.checked);
    aggregate();
  };
  node.querySelector('.live').onclick = () => setMini(id, node.querySelector('.mini').hidden);
  if (meta.mode === 'embed') {
    const ph = node.querySelector('.phone');
    ph.hidden = false;
    ph.onclick = () => openPhone(id);
  }
  return node;
}

function relDay(d) {
  const n = GCP.daysAgo(d);
  return n <= 0 ? 'today' : n === 1 ? 'yesterday' : `${n}d ago`;
}

function saleRow(s, r) {
  const li = document.createElement('li');
  const excluded = state.prefs.excluded.includes(s.key);
  if (excluded) li.className = 'excluded';
  const tags = [s.via && s.via !== 'eBay' ? s.via : '', s.bestOffer ? (s.realBestOffer ? 'best offer ✓' : 'best offer') : '', s.auction ? 'auction' : ''].filter(Boolean).join(' · ');
  li.innerHTML = `${s.img ? `<img src="${esc(s.img)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<span class="noimg"></span>'}
    <div style="min-width:0"><a class="t" href="${esc(s.url || r.url)}" target="_blank" rel="noopener" title="${esc(s.title)}">${esc(s.title || '(untitled)')}</a>
    <div class="d">${shortDate(s.date)} · ${relDay(s.date)}${tags ? ' · ' + esc(tags) : ''}</div></div>
    <button class="p" title="${excluded ? 'Excluded: click to count it again' : 'Click to leave this sale out of the averages'}">${money(s.price)}</button>`;
  li.querySelector('.p').onclick = () => toggleExcluded(s.key);
  return li;
}

function renderPlatform(id) {
  const r = state.results[id];
  const card = document.querySelector(`.pcard[data-id="${id}"]`);
  if (!card || !r) return;
  card.querySelector('.open').href = r.pageUrl || r.url;
  if (r.product) card.querySelector('.pname small').textContent = r.product;

  const st = card.querySelector('.status');
  st.className = 'status';
  const counted = r.sales.filter(s => !state.prefs.excluded.includes(s.key));
  const map = {
    loading: ['loading', r.progress || (P.META[id].mode === 'embed' ? 'Loading…' : 'Searching…')],
    ok: ['ok', r.sales.length ? `${counted.length} sale${counted.length === 1 ? '' : 's'}` : r.marketPrice != null ? 'Market price' : 'No matching sales'],
    error: ['err', 'Error'],
    empty: ['', 'Nothing found']
  };
  const [cls, label] = map[r.status] || ['', r.status];
  if (cls) st.classList.add(cls);
  st.textContent = label.length > 34 ? label.slice(0, 33) + '…' : label;
  st.title = label;

  const wk = GCP.windowStats(counted);
  const last = counted[0];
  const statsEl = card.querySelector('.pstats');
  const bits = [];
  if (r.status === 'ok' || r.status === 'empty') {
    if (counted.length) {
      bits.push(`7d avg <b>${money(wk['7d'] && wk['7d'].avg)}</b>`);
      bits.push(`last <b>${money(last.price)}</b> ${relDay(last.date)}`);
    }
    if (r.marketPrice != null) bits.push(`${id === 'collectr' ? esc(GCP.gradeLabel(state.parts)) + ' market' : id === 'alt' ? 'Alt value' : 'market'} <b>${money(r.marketPrice)}</b>`);
    if (r.rawPrice && id === 'collectr') bits.push(`raw <b>${money(r.rawPrice)}</b>`);
    if (r.cachedAt) bits.push(`<span title="Cached result; press ↻ for fresh data">cached ${Math.round((Date.now() - r.cachedAt) / 60000)}m</span>`);
  }
  statsEl.innerHTML = bits.join('');

  const note = card.querySelector('.pnote');
  const noteText = r.status === 'error' ? `${r.error}. Try Mini view or Open ↗.` : r.note || '';
  note.hidden = !noteText;
  note.className = 'pnote' + (r.status === 'error' ? ' err' : '');
  note.textContent = noteText;

  // Collectr: price per grade, current grade highlighted.
  const gp = card.querySelector('.gradeprices');
  if (r.gradePrices && Object.keys(r.gradePrices).length) {
    const want = GCP.gradeLabel(state.parts);
    gp.hidden = false;
    gp.innerHTML = Object.entries(r.gradePrices).map(([k, v]) => `<div class="${k === want ? 'cur' : ''}" data-g="${esc(k)}" title="Price this grade">${esc(k)}<b>${money(v, true)}</b></div>`).join('');
    gp.querySelectorAll('div').forEach(d => (d.onclick = () => switchGrade(d.dataset.g)));
  } else gp.hidden = true;

  const list = card.querySelector('.sales');
  list.innerHTML = '';
  const shown = r.expanded ? r.sales.slice(0, 60) : r.sales.slice(0, 5);
  for (const s of shown) list.appendChild(saleRow(s, r));
  if (r.sales.length > 5) {
    const more = document.createElement('li');
    more.className = 'more';
    more.textContent = r.expanded ? 'Show less' : `Show all ${Math.min(r.sales.length, 60)}`;
    more.onclick = () => { r.expanded = !r.expanded; renderPlatform(id); };
    list.appendChild(more);
  }

  const rej = card.querySelector('.rejected');
  if (r.rejected.length) {
    rej.hidden = false;
    rej.querySelector('summary').textContent = `${r.rejected.length} listing${r.rejected.length > 1 ? 's' : ''} filtered out (wrong card, grade or lot)`;
    const ol = rej.querySelector('ol');
    ol.innerHTML = '';
    for (const s of r.rejected.slice(0, 80)) {
      const li = document.createElement('li');
      li.innerHTML = `<span title="${esc(s.title)}">${money(s.price)} · ${esc(s.title)}</span><em>${esc(s.reason)}</em><button title="Count this sale anyway">Use</button>`;
      li.querySelector('button').onclick = () => toggleForced(s.key);
      ol.appendChild(li);
    }
  } else rej.hidden = true;
}

// ================================================================ aggregation
function merged() {
  // One entry per real sale. The same eBay item can come from eBay, 130point and PriceCharting:
  // keep one, preferring 130point's price when it reveals an accepted best offer.
  const out = new Map();
  for (const id of PLATFORM_ORDER) {
    const r = state.results[id];
    if (!r || !r.include) continue;
    for (const s of r.sales) {
      if (state.prefs.excluded.includes(s.key)) continue;
      const prev = out.get(s.key);
      if (!prev) { out.set(s.key, { ...s, sources: [id] }); continue; }
      prev.sources.push(id);
      if (s.realBestOffer && prev.bestOffer && !prev.realBestOffer) Object.assign(prev, { price: s.price, realBestOffer: true });
    }
  }
  return [...out.values()];
}

function aggregate() {
  const all = merged();
  const now = new Date();
  let week = all.filter(s => GCP.inWindow(s, 7, now));
  const before = week.length;
  if ($('#trim').checked) week = GCP.trimOutliers(week);
  const trimmedCount = before - week.length;
  const w = GCP.windowStats(week, now);
  state.merged = week;
  state.week = w;

  const tiles = $('#tiles');
  tiles.innerHTML = '';
  const base = w['7d'] && w['7d'].avg;
  for (const win of GCP.WINDOWS) {
    const s = w[win.key];
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - win.days);
    const el = document.createElement('div');
    el.className = 'tile' + (s ? '' : ' empty');
    el.title = `Sales dated ${shortDate(from)} – today`;
    let delta = '';
    if (s && base && win.key !== '7d') {
      const pct = (s.avg - base) / base * 100;
      if (Math.abs(pct) >= 0.5) delta = `<span class="delta ${pct > 0 ? 'up' : 'down'}">${pct > 0 ? '▲' : '▼'}${Math.abs(pct).toFixed(1)}% vs 7D</span><br>`;
    }
    el.innerHTML = `<div class="lbl"><span>${win.label}</span><span>${shortDate(from)}+</span></div>
      <div class="avg">${s ? money(s.avg) : 'No sales'}</div>
      <div class="sub">${s ? `${delta}${s.count} sale${s.count > 1 ? 's' : ''} · median ${money(s.median)}<br>${money(s.low)} – ${money(s.high)}` : '&nbsp;'}</div>`;
    tiles.appendChild(el);
  }

  // 30-day context
  let month = all.filter(s => GCP.inWindow(s, 30, now));
  if ($('#trim').checked) month = GCP.trimOutliers(month);
  const m30 = GCP.stats(month.map(s => s.price));
  const pending = Object.values(state.results).filter(r => r.status === 'loading').length;
  const srcs = new Set(week.flatMap(s => s.sources));
  const rejected = Object.values(state.results).reduce((n, r) => n + r.rejected.length, 0);
  $('#summaryFoot').textContent = [
    `${week.length} sale${week.length === 1 ? '' : 's'} in the last 7 days from ${srcs.size} source${srcs.size === 1 ? '' : 's'}`,
    m30 ? `30-day avg ${money(m30.avg)} (${m30.count})` : '',
    trimmedCount ? `${trimmedCount} outlier${trimmedCount > 1 ? 's' : ''} trimmed` : '',
    rejected ? `${rejected} non-matching listings ignored` : '',
    pending ? `waiting on ${pending} platform${pending > 1 ? 's' : ''}…` : ''
  ].filter(Boolean).join(' · ');

  renderDeal();
  drawChart(week, w['7d']);
  renderGradesTable();
  maybeSnapshot(Object.values(state.results).filter(r => r.status === 'loading' && P.META[r.id].mode === 'fetch').length);
}

// ================================================================ deal check
function renderDeal() {
  const v = parseFloat(String($('#ask').value).replace(/[$,\s]/g, '').replace(/k$/i, '000'));
  const out = $('#dealVerdict');
  out.className = 'verdict muted';
  if (!v) { out.textContent = 'Enter a price to compare with recent sales'; return; }
  const ref = state.week && (state.week['7d'] || null);
  if (!ref) { out.textContent = 'No sales in the last week to compare with'; return; }
  const pct = (v - ref.avg) / ref.avg * 100;
  const pctMed = (v - ref.median) / ref.median * 100;
  const word = Math.abs(pct) < 3 ? 'about market' : pct < 0 ? `${Math.abs(pct).toFixed(1)}% below` : `${pct.toFixed(1)}% above`;
  out.className = 'verdict ' + (pct <= -3 ? 'good' : pct >= 5 ? 'bad' : 'fair');
  out.textContent = `${word} 7-day avg ${money(ref.avg)} · ${pctMed <= 0 ? Math.abs(pctMed).toFixed(0) + '% under' : pctMed.toFixed(0) + '% over'} median`;
  out.title = `Lowest sale this week ${money(ref.low)}, highest ${money(ref.high)}`;
}

// ================================================================ chart
function drawChart(sales, wk) {
  const svg = $('#chart');
  const W = Math.max(240, svg.clientWidth || 320), H = 120, padL = 44, padR = 18, padT = 8, padB = 16;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  if (!sales.length) {
    const pending = Object.values(state.results).some(r => r.status === 'loading');
    svg.innerHTML = `<text x="${W / 2}" y="${H / 2}" text-anchor="middle">${pending ? 'Loading sales…' : 'No matching sales in the last 7 days'}</text>`;
    $('#legend').innerHTML = '';
    return;
  }
  const ask = parseFloat(String($('#ask').value).replace(/[$,\s]/g, '')) || null;
  const prices = sales.map(s => s.price).concat(ask ? [ask] : []);
  let lo = Math.min(...prices), hi = Math.max(...prices);
  if (hi === lo) { lo *= 0.9; hi *= 1.1; }
  const pad = (hi - lo) * 0.1; lo = Math.max(0, lo - pad); hi += pad;
  const x = (dago) => padL + (7 - Math.min(7, dago)) / 7 * (W - padL - padR);
  const y = (p) => padT + (1 - (p - lo) / (hi - lo)) * (H - padT - padB);
  let out = '';
  for (let i = 0; i <= 2; i++) {
    const p = lo + (hi - lo) * i / 2;
    out += `<line class="grid" x1="${padL}" x2="${W - padR}" y1="${y(p)}" y2="${y(p)}"/><text x="${padL - 4}" y="${y(p) + 3}" text-anchor="end">${money(p, true)}</text>`;
  }
  for (const d of [7, 5, 3, 1, 0]) out += `<text x="${x(d)}" y="${H - 3}" text-anchor="middle">${d === 0 ? 'today' : d + 'd'}</text>`;
  if (wk) out += `<line class="avgline" x1="${padL}" x2="${W - padR}" y1="${y(wk.avg)}" y2="${y(wk.avg)}"/>`;
  if (ask) out += `<line class="askline" x1="${padL}" x2="${W - padR}" y1="${y(ask)}" y2="${y(ask)}"/>`;
  const perDay = {};
  for (const s of sales) {
    const dk = GCP.daysAgo(s.date);
    const j = (perDay[dk] = (perDay[dk] || 0) + 1);
    const cx = Math.max(padL + 3, Math.min(W - padR - 3, x(dk) + ((j % 5) - 2) * 4));
    const meta = P.META[s.sources[0]];
    out += `<circle cx="${cx}" cy="${y(s.price)}" r="3.5" fill="${meta.color}" fill-opacity=".85" data-url="${esc(s.url)}"><title>${esc(meta.name)} · ${money(s.price)} · ${s.date.toDateString()}\n${esc(s.title)}</title></circle>`;
  }
  svg.innerHTML = out;
  svg.querySelectorAll('circle').forEach(c => (c.onclick = () => c.dataset.url && window.open(c.dataset.url, '_blank')));
  const used = [...new Set(sales.map(s => s.sources[0]))];
  $('#legend').innerHTML = used.map(id => `<span><i style="background:${P.META[id].color}"></i>${P.META[id].name}</span>`).join('') +
    (wk ? '<span>- - 7-day avg</span>' : '') + (ask ? '<span style="color:var(--accent)">- - asking</span>' : '');
}

// ================================================================ other grades
function renderGradesTable() {
  const box = $('#gradesBox');
  const now = new Date();
  const byGrade = {};
  const seen = new Set();
  for (const id of ['ebay', '130point', 'pricecharting']) {
    const r = state.results[id];
    if (!r || !r.raw) continue;
    for (const s of r.raw) {
      if (!s.date || !GCP.inWindow(s, 30, now) || P.JUNK_RE.test(s.title || '')) continue;
      const gs = GCP.findGrades(s.title || '');
      const uniq = new Set(gs.map(GCP.gradeLabel));
      if (uniq.size !== 1) continue;
      if (!GCP.matchCard(s.title, state.parts).ok) continue;
      const key = s.itemId ? 'i:' + s.itemId : id + s.price + +s.date;
      if (seen.has(key)) continue;
      seen.add(key);
      const label = [...uniq][0];
      (byGrade[label] = byGrade[label] || []).push(s);
    }
  }
  const cp = (state.results.collectr && state.results.collectr.gradePrices) || {};
  // Common investment grades first, then anything else with real volume (7+), at most 10 rows.
  const gradeNum = (g) => parseFloat(g.match(/[\d.]+$/)[0]) + (/Black|Pristine/.test(g) ? 0.6 : 0);
  const extra = Object.keys(byGrade).filter(g => !COMMON_GRADES.includes(g) && byGrade[g].length >= 3 && gradeNum(g) >= 7)
    .sort((a, b) => gradeNum(b) - gradeNum(a));
  const labels = [...COMMON_GRADES.filter(g => byGrade[g] || cp[g]), ...extra].slice(0, 10);
  if (!labels.includes(GCP.gradeLabel(state.parts)) && byGrade[GCP.gradeLabel(state.parts)]) labels.unshift(GCP.gradeLabel(state.parts));
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
  search([p.name, p.number, label].filter(Boolean).join(' '), { askPrice: null });
}

function renderGradeBar() {
  const bar = $('#gradeBar');
  const cur = GCP.gradeLabel(state.parts);
  const opts = ['PSA 10', 'PSA 9', 'PSA 8', 'BGS 10', 'BGS 9.5', 'BGS 9', 'CGC Pristine 10', 'CGC 10', 'CGC 9.5', 'SGC 10', 'TAG 10'];
  if (cur && !opts.includes(cur)) opts.unshift(cur);
  bar.hidden = false;
  bar.innerHTML = '';
  for (const g of opts) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = g;
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
  const box = $('#watchBox');
  box.hidden = !items.length;
  $('#watchCount').textContent = items.length ? String(items.length) : '';
  const ol = $('#watchList');
  ol.innerHTML = '';
  for (const it of items) {
    const snaps = it.snaps;
    const lastS = snaps.at(-1), prevS = snaps.at(-2);
    let delta = '';
    if (lastS && prevS && prevS.avg7) {
      const pct = (lastS.avg7 - prevS.avg7) / prevS.avg7 * 100;
      delta = `<span class="delta ${pct >= 0 ? 'up' : 'down'}">${pct >= 0 ? '▲' : '▼'}${Math.abs(pct).toFixed(1)}%</span>`;
    }
    const li = document.createElement('li');
    li.innerHTML = `<span class="n" title="${esc(it.query)}">${esc(it.query)}</span>${delta || '<span></span>'}<span class="v" title="${lastS ? '7-day avg on ' + new Date(lastS.t).toLocaleString() : 'Not priced yet'}">${lastS ? money(lastS.avg7) : '—'}</span><button class="x" title="Remove">×</button>`;
    li.querySelector('.n').onclick = () => search(it.query);
    li.querySelector('.x').onclick = () => { delete watchlist[it.query.toLowerCase()]; saveWatchlist(); renderWatchlist(); renderWatchButton(); };
    ol.appendChild(li);
  }
}

function renderWatchButton() {
  const on = !!watchlist[state.query.toLowerCase()];
  const b = $('#watchBtn');
  b.textContent = on ? '★ Watching' : '☆ Watch';
  b.classList.toggle('on', on);
}

function maybeSnapshot(pending) {
  const k = state.query.toLowerCase();
  if (state.snapshotDone || pending || !watchlist[k] || !state.week || !state.week['7d']) return;
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
  else {
    watchlist[k] = { query: state.query, added: Date.now(), snaps: [] };
    state.snapshotDone = false;
    maybeSnapshot(Object.values(state.results).filter(r => r.status === 'loading' && P.META[r.id].mode === 'fetch').length);
  }
  saveWatchlist();
  renderWatchlist();
  renderWatchButton();
};

// ================================================================ copy
$('#copyBtn').onclick = async () => {
  const w = state.week || {};
  const lines = [`${state.query}: recent sold prices`];
  for (const win of GCP.WINDOWS) {
    const s = w[win.key];
    lines.push(`${win.label}: ${s ? `${money(s.avg)} avg (${s.count} sale${s.count > 1 ? 's' : ''}, median ${money(s.median)})` : 'no sales'}`);
  }
  const cp = state.results.collectr && state.results.collectr.marketPrice;
  if (cp) lines.push(`Collectr ${GCP.gradeLabel(state.parts)} market: ${money(cp)}`);
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
  search(v, { force: v === state.query, askPrice: v === state.query ? parseFloat($('#ask').value) || null : null });
});
$('#refreshBtn').onclick = () => search(state.query, { force: true, askPrice: parseFloat($('#ask').value) || null });
$('#scanBtn').addEventListener('click', () => scanPage());
$('#trim').addEventListener('change', aggregate);
$('#bestOffers').addEventListener('change', () => {
  settings.excludeBestOffers = !$('#bestOffers').checked;
  Object.keys(state.results).forEach(classify);
  Object.keys(state.results).forEach(renderPlatform);
  aggregate();
});
$('#ask').addEventListener('input', () => { renderDeal(); drawChart(state.merged, state.week && state.week['7d']); });
chrome.tabs.onActivated.addListener(refreshDetections);
chrome.tabs.onUpdated.addListener((tabId, info) => { if (tabId === activeTabId && info.status === 'complete') refreshDetections(); });
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'sync') loadSettings(); });
new ResizeObserver(() => state.query && drawChart(state.merged, state.week && state.week['7d'])).observe($('#chart'));

(async function init() {
  await loadSettings();
  await loadWatchlist();
  await takePending();
  await refreshDetections();
})();
