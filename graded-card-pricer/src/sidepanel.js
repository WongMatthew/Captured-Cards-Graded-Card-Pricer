/* global GCP, GCPPlatforms */
const P = GCPPlatforms;
const $ = (s) => document.querySelector(s);
const money = (n) => n == null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: n >= 1000 ? 0 : 2 });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const CACHE_MS = 15 * 60 * 1000;
const EMBED_WAIT_MS = 30000;

let settings = structuredClone(P.DEFAULTS);
let state = { query: '', parts: null, results: {}, searchId: 0 };
let activeTabId = null;
let lastCards = [];
let autoSearchedFor = new Set();

// ---------------- settings ----------------
async function loadSettings() {
  const s = await chrome.storage.sync.get(null);
  settings = structuredClone(P.DEFAULTS);
  for (const k of ['autoScan', 'autoSearch', 'trimOutliers']) if (k in s) settings[k] = s[k];
  if (s.platforms) for (const id of Object.keys(settings.platforms)) Object.assign(settings.platforms[id], s.platforms[id] || {});
  $('#trim').checked = settings.trimOutliers;
}

// ---------------- detections ----------------
async function refreshDetections() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  activeTabId = tab.id;
  const data = (await chrome.storage.session.get('tab:' + tab.id))['tab:' + tab.id];
  renderChips(data ? data.cards : [], tab);
  if (settings.autoSearch && data && data.cards.length && !autoSearchedFor.has(tab.id + data.cards[0].query)) {
    autoSearchedFor.add(tab.id + data.cards[0].query);
    if (!state.query || state.autoFromTab === tab.id) search(data.cards[0].query, { auto: tab.id });
  }
}

function renderChips(cards, tab) {
  lastCards = cards || [];
  const box = $('#chips');
  box.innerHTML = '';
  $('#detectedLabel').textContent = lastCards.length ? `${lastCards.length} graded card${lastCards.length > 1 ? 's' : ''} on this page` : 'Cards found on this page';
  if (!lastCards.length) {
    box.innerHTML = '<span class="muted">Nothing detected yet.</span>';
    return;
  }
  for (const c of lastCards) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip' + (c.query === state.query ? ' active' : '');
    b.title = c.raw;
    b.innerHTML = `${esc(c.name)}${c.number ? ' ' + esc(c.number) : ''}<b>${esc(c.grader)} ${esc(c.grade)}</b>`;
    b.onclick = () => search(c.query);
    box.appendChild(b);
  }
}

async function scanPage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  const btn = $('#scanBtn');
  btn.textContent = 'Scanning…';
  let res = null;
  try {
    res = await chrome.tabs.sendMessage(tab.id, { type: 'scan-now' });
  } catch (e) {
    // Content script not present (page opened before install, or restricted). Inject it.
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/detect.js', 'src/content.js'] });
      res = await chrome.tabs.sendMessage(tab.id, { type: 'scan-now' });
    } catch (e2) { res = null; }
  }
  btn.textContent = 'Scan page';
  if (!res) { $('#chips').innerHTML = '<span class="muted">Can’t read this page (browser pages and the Web Store are off-limits).</span>'; return; }
  await chrome.storage.session.set({ ['tab:' + tab.id]: { url: res.url, title: res.title, cards: res.cards, at: Date.now() } });
  renderChips(res.cards, tab);
  if (res.cards.length && (res.fromSelection || !state.query)) search(res.cards[0].query);
}

// ---------------- search ----------------
function splitQuery(q) {
  const { grader, grade } = GCP.parseQuery(q);
  const numM = q.match(GCP.CARD_NO_RE);
  const number = numM ? numM[1].replace(/\s+/g, '') : '';
  const name = GCP.cleanName(q.replace(GCP.CARD_NO_RE, ' ')).replace(/\s+/g, ' ').trim();
  return { name, number, grader, grade };
}

async function cacheGet(id, q) {
  const k = `cache:${id}:${q.toLowerCase()}`;
  const v = (await chrome.storage.local.get(k))[k];
  if (!v || Date.now() - v.at > CACHE_MS) return null;
  v.data.sales.forEach(s => (s.date = new Date(s.date)));
  return v.data;
}
async function cachePut(id, q, data) {
  const k = `cache:${id}:${q.toLowerCase()}`;
  await chrome.storage.local.set({ [k]: { at: Date.now(), data: { ...data, sales: data.sales.map(s => ({ ...s, date: s.date.toISOString() })) } } });
}

async function search(q, opts = {}) {
  q = String(q || '').trim();
  if (!q) return;
  const sid = ++state.searchId;
  const parts = splitQuery(q);
  state = { query: q, parts, results: {}, searchId: sid, autoFromTab: opts.auto || null };
  $('#q').value = q;
  $('#empty').hidden = true;
  $('#summary').hidden = false;
  $('#summaryTitle').textContent = q + (parts.grade ? '' : '  (no grade detected; add e.g. “PSA 10”)');
  renderChips(lastCards);

  const grid = $('#platforms');
  grid.innerHTML = '';
  for (const [id, cfg] of Object.entries(settings.platforms)) {
    if (!cfg.enabled) continue;
    const meta = P.META[id];
    state.results[id] = { id, status: 'loading', sales: [], include: true, url: P.embedUrl(id, q, cfg, parts), expanded: false };
    grid.appendChild(buildCard(id, meta));
    renderPlatform(id);

    if (meta.mode === 'fetch') {
      runFetch(id, q, cfg, parts, sid, opts.force);
    } else {
      setMini(id, true);
      setTimeout(() => {
        const r = state.results[id];
        if (sid === state.searchId && r && r.status === 'loading') { r.status = 'empty'; renderPlatform(id); }
      }, EMBED_WAIT_MS);
    }
  }
  aggregate();
}

async function runFetch(id, q, cfg, parts, sid, force) {
  const r = state.results[id];
  try {
    let data = force ? null : await cacheGet(id, q);
    if (!data) {
      data = await P.FETCHERS[id](q, cfg, parts);
      cachePut(id, q, data).catch(() => {});
    }
    if (sid !== state.searchId) return;
    Object.assign(r, { status: 'ok', url: data.url || r.url, product: data.product, raw: data.sales, sales: filterSales(data.sales, id) });
  } catch (e) {
    if (sid !== state.searchId) return;
    Object.assign(r, { status: 'error', error: e.name === 'AbortError' ? 'Timed out' : (e.message || String(e)) });
  }
  renderPlatform(id);
  aggregate();
}

function filterSales(sales, id) {
  const { grader, grade } = state.parts;
  // Alt searches are already scoped to the graded card; Collectr pages may show raw prices.
  const embed = id === 'alt';
  return sales.filter(s => {
    if (!s.price || !s.date || isNaN(s.date)) return false;
    if (P.JUNK_RE.test(s.title || '')) return false;
    if (!grader) return true;
    const mentionsGrader = /\b(PSA|BGS|BECKETT|CGC|SGC|TAG|ACE|AGS)\b/i.test(s.title || '');
    if (!mentionsGrader) return embed; // embedded app pages are already scoped to the card
    return GCP.titleMatchesGrade(s.title, grader, grade);
  }).sort((a, b) => b.date - a.date);
}

// ---------------- embedded mini views ----------------
function setMini(id, on) {
  const card = document.querySelector(`.pcard[data-id="${id}"]`);
  if (!card) return;
  const mini = card.querySelector('.mini');
  const frame = mini.querySelector('iframe');
  mini.hidden = !on;
  card.querySelector('.live').textContent = on ? 'Hide mini view' : 'Mini view';
  if (on && frame.dataset.src !== state.results[id].url) { frame.dataset.src = state.results[id].url; frame.src = state.results[id].url; }
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === 'frame-sales') {
    const r = state.results[msg.platform];
    if (!r || P.META[msg.platform].mode !== 'embed') return;
    const sales = msg.rows.map(x => ({ ...x, date: new Date(x.date) }));
    r.raw = sales;
    r.sales = filterSales(sales, msg.platform);
    r.marketPrice = msg.marketPrice;
    r.status = r.sales.length || r.marketPrice ? 'ok' : 'loading';
    renderPlatform(msg.platform);
    aggregate();
  } else if (msg.type === 'detections-updated' && msg.tabId === activeTabId) {
    refreshDetections();
  } else if (msg.type === 'pending-query') {
    takePending();
  } else if (msg.type === 'rescan') {
    scanPage();
  }
});

async function takePending() {
  const { pendingQuery } = await chrome.storage.session.get('pendingQuery');
  if (!pendingQuery || Date.now() - pendingQuery.at > 60000) return;
  await chrome.storage.session.remove('pendingQuery');
  const found = GCP.detectCards(pendingQuery.text, { max: 1 });
  search(found.length ? found[0].query : pendingQuery.text);
}

// ---------------- rendering ----------------
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
  return node;
}

function renderPlatform(id) {
  const r = state.results[id];
  const card = document.querySelector(`.pcard[data-id="${id}"]`);
  if (!card || !r) return;
  card.querySelector('.open').href = r.url;
  if (r.product) card.querySelector('.pname small').textContent = r.product;

  const st = card.querySelector('.status');
  st.className = 'status';
  const map = {
    loading: ['loading', P.META[id].mode === 'embed' ? 'Reading page…' : 'Searching…'],
    ok: ['ok', `${r.sales.length} sale${r.sales.length === 1 ? '' : 's'}`],
    error: ['err', 'Error'],
    empty: ['', 'No dated sales']
  };
  const [cls, label] = map[r.status] || ['', r.status];
  if (cls) st.classList.add(cls);
  st.textContent = label;

  const wk = GCP.windowStats(r.sales);
  const last = r.sales[0];
  const statsEl = card.querySelector('.pstats');
  statsEl.innerHTML = r.status === 'ok' || r.status === 'empty'
    ? [
      `7d avg <b>${money(wk['7d'] && wk['7d'].avg)}</b>`,
      `last <b>${last ? money(last.price) : '—'}</b>${last ? ` <span>${relDay(last.date)}</span>` : ''}`,
      r.marketPrice ? `market <b>${money(r.marketPrice)}</b>` : '',
      r.raw && r.raw.length !== r.sales.length ? `<span title="Listings dropped because the grade didn't match or looked like a lot/proxy">${r.raw.length - r.sales.length} filtered</span>` : ''
    ].filter(Boolean).join('')
    : '';

  let err = card.querySelector('.perr');
  if (r.status === 'error') {
    if (!err) { err = document.createElement('div'); err.className = 'perr'; statsEl.after(err); }
    err.textContent = r.error + ' — try Mini view or Open ↗';
  } else if (err) err.remove();

  const list = card.querySelector('.sales');
  list.innerHTML = '';
  const shown = r.expanded ? r.sales.slice(0, 50) : r.sales.slice(0, 5);
  for (const s of shown) {
    const li = document.createElement('li');
    li.innerHTML = `${s.img ? `<img src="${esc(s.img)}" alt="" loading="lazy">` : '<span class="noimg"></span>'}
      <div style="min-width:0"><a class="t" href="${esc(s.url || r.url)}" target="_blank" rel="noopener" title="${esc(s.title)}">${esc(s.title || '(untitled)')}</a>
      <div class="d">${s.date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} · ${relDay(s.date)}</div></div>
      <div class="p">${money(s.price)}${s.bestOffer ? '<span class="bo">best offer</span>' : ''}</div>`;
    list.appendChild(li);
  }
  if (r.sales.length > 5) {
    const more = document.createElement('li');
    more.innerHTML = `<span class="more">${r.expanded ? 'Show less' : `Show all ${Math.min(r.sales.length, 50)}`}</span>`;
    more.style.display = 'block';
    more.onclick = () => { r.expanded = !r.expanded; renderPlatform(id); };
    list.appendChild(more);
  }
}

function relDay(d) {
  const n = GCP.daysAgo(d);
  return n <= 0 ? 'today' : n === 1 ? 'yesterday' : `${n}d ago`;
}

function aggregate() {
  // Merge included platforms, dedupe the same eBay item reported by several sources.
  const merged = new Map();
  for (const r of Object.values(state.results)) {
    if (!r.include) continue;
    for (const s of r.sales) {
      const k = s.itemId ? 'ebay:' + s.itemId : `${r.id}:${s.price}:${+s.date}:${(s.title || '').slice(0, 40)}`;
      const prev = merged.get(k);
      if (prev) {
        // Prefer 130point's price for accepted best offers (it shows the real sale price).
        if (r.id === '130point' && prev.bestOffer) merged.set(k, { ...s, platform: r.id });
        continue;
      }
      merged.set(k, { ...s, platform: r.id });
    }
  }
  let sales = [...merged.values()].filter(s => GCP.daysAgo(s.date) <= 7 && GCP.daysAgo(s.date) >= 0);
  const before = sales.length;
  if ($('#trim').checked) sales = GCP.trimOutliers(sales);
  const w = GCP.windowStats(sales);

  const tiles = $('#tiles');
  tiles.innerHTML = '';
  const base = w['7d'] && w['7d'].avg;
  for (const win of GCP.WINDOWS) {
    const s = w[win.key];
    const el = document.createElement('div');
    el.className = 'tile' + (s ? '' : ' empty');
    let delta = '';
    if (s && base && win.key !== '7d') {
      const pct = (s.avg - base) / base * 100;
      if (Math.abs(pct) >= 0.5) delta = `<span class="delta ${pct > 0 ? 'up' : 'down'}">${pct > 0 ? '▲' : '▼'}${Math.abs(pct).toFixed(1)}% vs wk</span><br>`;
    }
    el.innerHTML = `<div class="lbl">${win.label}</div>
      <div class="avg">${s ? money(s.avg) : 'No sales'}</div>
      <div class="sub">${s ? `${delta}${s.count} sale${s.count > 1 ? 's' : ''} · med ${money(s.median)}<br>${money(s.low)}–${money(s.high)}` : '&nbsp;'}</div>`;
    tiles.appendChild(el);
  }

  const pending = Object.values(state.results).filter(r => r.status === 'loading').length;
  const srcs = new Set(sales.map(s => s.platform));
  $('#summaryFoot').textContent =
    `${sales.length} unique sale${sales.length === 1 ? '' : 's'} in the last 7 days from ${srcs.size} source${srcs.size === 1 ? '' : 's'}` +
    (before > sales.length ? ` · ${before - sales.length} outlier${before - sales.length > 1 ? 's' : ''} trimmed` : '') +
    (pending ? ` · waiting on ${pending} platform${pending > 1 ? 's' : ''}…` : '');
  drawChart(sales, w['7d']);
}

function drawChart(sales, wk) {
  const svg = $('#chart');
  const W = Math.max(240, svg.clientWidth || 320), H = 120, padL = 40, padR = 18;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const padT = 8, padB = 16;
  if (!sales.length) { svg.innerHTML = `<text x="${W / 2}" y="${H / 2}" text-anchor="middle">No sales in the last 7 days yet</text>`; $('#legend').innerHTML = ''; return; }
  const prices = sales.map(s => s.price);
  let lo = Math.min(...prices), hi = Math.max(...prices);
  if (hi === lo) { lo *= 0.9; hi *= 1.1; }
  const pad = (hi - lo) * 0.1; lo = Math.max(0, lo - pad); hi += pad;
  const x = (d) => padL + (7 - Math.min(7, GCP.daysAgo(d))) / 7 * (W - padL - padR);
  const y = (p) => padT + (1 - (p - lo) / (hi - lo)) * (H - padT - padB);
  let out = '';
  for (let i = 0; i <= 2; i++) {
    const p = lo + (hi - lo) * i / 2;
    out += `<line class="grid" x1="${padL}" x2="${W - padR}" y1="${y(p)}" y2="${y(p)}"/><text x="${padL - 4}" y="${y(p) + 3}" text-anchor="end">${money(p).replace('.00', '')}</text>`;
  }
  for (const d of [7, 5, 3, 1, 0]) {
    const xx = padL + (7 - d) / 7 * (W - padL - padR);
    out += `<text x="${xx}" y="${H - 3}" text-anchor="middle">${d === 0 ? 'today' : d + 'd'}</text>`;
  }
  if (wk) out += `<line class="avgline" x1="${padL}" x2="${W - padR}" y1="${y(wk.avg)}" y2="${y(wk.avg)}"/>`;
  // Jitter dots within a day so same-day sales don't stack exactly.
  const perDay = {};
  for (const s of sales) {
    const dk = GCP.daysAgo(s.date);
    const j = (perDay[dk] = (perDay[dk] || 0) + 1);
    const cx = Math.min(W - padR - 3, x(s.date) + ((j % 5) - 2) * 3);
    out += `<circle cx="${cx}" cy="${y(s.price)}" r="3.2" fill="${P.META[s.platform].color}" fill-opacity=".85"><title>${esc(P.META[s.platform].name)} · ${money(s.price)} · ${s.date.toDateString()}\n${esc(s.title)}</title></circle>`;
  }
  svg.innerHTML = out;
  const used = [...new Set(sales.map(s => s.platform))];
  $('#legend').innerHTML = used.map(id => `<span><i style="background:${P.META[id].color}"></i>${P.META[id].name}</span>`).join('') +
    (wk ? '<span>- - - 7-day avg</span>' : '');
}

// ---------------- wiring ----------------
$('#searchForm').addEventListener('submit', (e) => { e.preventDefault(); search($('#q').value, { force: true }); });
$('#scanBtn').addEventListener('click', scanPage);
$('#trim').addEventListener('change', aggregate);
chrome.tabs.onActivated.addListener(refreshDetections);
chrome.tabs.onUpdated.addListener((tabId, info) => { if (tabId === activeTabId && info.status === 'complete') refreshDetections(); });
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'sync') loadSettings(); });

(async function init() {
  await loadSettings();
  await takePending();
  await refreshDetections();
})();
