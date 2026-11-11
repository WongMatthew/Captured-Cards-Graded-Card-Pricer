/* global GCPPlatforms */
const P = GCPPlatforms;
const $ = (s) => document.querySelector(s);
const BOOLS = ['autoScan', 'pokemonOnly', 'autoCollectr'];

async function load() {
  const s = await chrome.storage.sync.get(null);
  const cfg = structuredClone(P.DEFAULTS);
  for (const k of BOOLS.concat('ebayLocation')) if (k in s) cfg[k] = s[k];
  const sec = await chrome.storage.local.get(P.SECRET_KEYS);
  // Older versions kept the PSA key in synced storage: move it to this computer only.
  if (s.psaApiKey && !sec.psaApiKey) { sec.psaApiKey = s.psaApiKey; await chrome.storage.local.set({ psaApiKey: s.psaApiKey }); await chrome.storage.sync.remove('psaApiKey'); }
  for (const k of P.SECRET_KEYS) $('#' + k).value = sec[k] || '';
  if (s.platforms) for (const id of Object.keys(cfg.platforms)) Object.assign(cfg.platforms[id], s.platforms[id] || {});
  P.migrateSettings(cfg);
  render(cfg);
}

function render(cfg) {
  for (const k of BOOLS) $('#' + k).checked = cfg[k];
  $('#ebayLocation').value = cfg.ebayLocation || 'all';
  const box = $('#platforms');
  box.innerHTML = '';
  for (const [id, p] of Object.entries(cfg.platforms)) {
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `<label class="name"><input type="checkbox" data-id="${id}" class="en"> ${P.META[id].name}</label><input type="text" data-id="${id}" class="url">`;
    row.querySelector('.en').checked = p.enabled;
    row.querySelector('.url').value = p.url;
    if (id === '130point') row.querySelector('.url').disabled = true;
    box.appendChild(row);
  }
}

$('#save').onclick = async () => {
  const platforms = {};
  for (const el of document.querySelectorAll('.en')) platforms[el.dataset.id] = { enabled: el.checked };
  for (const el of document.querySelectorAll('.url')) platforms[el.dataset.id].url = el.value.trim();
  const out = { platforms, ebayLocation: $('#ebayLocation').value };
  await chrome.storage.local.set(Object.fromEntries(P.SECRET_KEYS.map(k => [k, $('#' + k).value.trim()])));
  for (const k of BOOLS) out[k] = $('#' + k).checked;
  await chrome.storage.sync.set(out);
  $('#saved').textContent = 'Saved';
  setTimeout(() => ($('#saved').textContent = ''), 1500);
};
$('#reset').onclick = async () => { await chrome.storage.sync.clear(); load(); };
$('#clear').onclick = async () => {
  const all = await chrome.storage.local.get(null);
  await chrome.storage.local.remove(Object.keys(all).filter(k => k.startsWith('cache:')));
  $('#saved').textContent = 'Cache cleared';
};
load();

$('#testEbay').onclick = async () => {
  const out = $('#ebayResult');
  out.textContent = ' Testing…';
  await chrome.storage.session.remove(['ebayToken', 'ebayTokenBasic']);
  await chrome.storage.local.remove('ebayInsightsDenied');
  const keys = { ebayAppId: $('#ebayAppId').value, ebayCertId: $('#ebayCertId').value };
  const parts = GCP.splitQuery('Charizard Base Set 4/102 PSA 9');
  let listings = '';
  try {
    const r = await P.ebayAsks(parts, { url: '' }, keys);
    listings = `Current listings ✓ (${r.asks.length} found)`;
  } catch (e) { out.textContent = ' ' + e.message; return; }
  try {
    const sales = await P.ebayViaApi(parts, keys);
    out.textContent = ` ${listings} · Sold items ✓ (${sales.length})`;
  } catch (e) {
    out.textContent = ` ${listings} · Sold items: not available (eBay has closed Marketplace Insights). Sold prices come from eBay.ca, Terapeak and 130point instead.`;
  }
};
