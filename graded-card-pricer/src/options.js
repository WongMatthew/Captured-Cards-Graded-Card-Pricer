/* global GCPPlatforms */
const P = GCPPlatforms;
const $ = (s) => document.querySelector(s);
const BOOLS = ['autoScan', 'pokemonOnly'];

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
  $('#offerPcts').value = (Array.isArray(s.offerPcts) ? s.offerPcts : [70, 80]).join(', ');
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
  out.offerPcts = $('#offerPcts').value.split(/[,\s]+/).map(Number).filter(n => n > 0 && n <= 200);
  if (!out.offerPcts.length) out.offerPcts = [70, 80];
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
  await chrome.storage.session.remove('ebayTokenBasic');
  try {
    const r = await P.ebayAsks(GCP.splitQuery('Charizard Base Set 4/102 PSA 9'), { url: '' }, { ebayAppId: $('#ebayAppId').value, ebayCertId: $('#ebayCertId').value });
    out.textContent = ` Works: current listings ✓ (${r.asks.length} found)`;
  } catch (e) { out.textContent = ' ' + e.message; }
};

$('#testPpt').onclick = async () => {
  const out = $('#pptResult');
  out.textContent = ' Testing…';
  try {
    const { json, remaining } = await P.pptGet('/cards?search=' + encodeURIComponent('charizard base set') + '&limit=1&includeEbay=true', $('#pptApiKey').value);
    const c = (json.data || [])[0];
    const eb = (c && c.ebay) || {};
    const individual = eb.soldListings && Object.values(eb.soldListings).some(a => a && a.length);
    const restricted = json.metadata && json.metadata.planRestrictions && json.metadata.planRestrictions.message;
    out.textContent = ` Works ✓ · ${individual ? 'individual sold listings ✓' : 'per-grade summary (individual sales need the Business plan)'}` +
      (remaining != null ? ` · ${remaining} credits left today` : '') + (restricted ? ` · ${restricted}` : '');
  } catch (e) { out.textContent = ' ' + e.message; }
};

$('#testPsa').onclick = async () => {
  const out = $('#psaResult');
  const cert = $('#psaTestCert').value.trim();
  if (!/^\d{7,10}$/.test(cert)) { out.textContent = ' Enter a PSA cert number first.'; return; }
  out.textContent = ' Testing…';
  try {
    const info = await P.psaCertViaApi(cert, $('#psaApiKey').value);
    const q = await P.psaQuota();
    out.textContent = ` Works: ${info.query} · pop ${info.pop ?? '?'}${info.specPop ? ' · population by grade ✓' : ''}` +
      `${info.fromCache ? ' (remembered, no call used)' : ''} · PSA calls used today: ${q.used}/100`;
  } catch (e) { out.textContent = ' ' + e.message; }
};
