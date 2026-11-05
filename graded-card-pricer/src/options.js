/* global GCPPlatforms */
const P = GCPPlatforms;
const $ = (s) => document.querySelector(s);

async function load() {
  const s = await chrome.storage.sync.get(null);
  const cfg = structuredClone(P.DEFAULTS);
  for (const k of ['autoScan', 'autoSearch', 'trimOutliers']) if (k in s) cfg[k] = s[k];
  if (s.platforms) for (const id of Object.keys(cfg.platforms)) Object.assign(cfg.platforms[id], s.platforms[id] || {});
  render(cfg);
}

function render(cfg) {
  for (const k of ['autoScan', 'autoSearch', 'trimOutliers']) $('#' + k).checked = cfg[k];
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
  await chrome.storage.sync.set({
    autoScan: $('#autoScan').checked, autoSearch: $('#autoSearch').checked, trimOutliers: $('#trimOutliers').checked, platforms
  });
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
