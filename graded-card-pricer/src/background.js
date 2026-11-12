// Service worker: side panel wiring, per-tab detections, context menu, network rules for the
// embedded mini views, and phone-sized "companion" windows for Alt / Collectr.

const EMBED_DOMAINS = ['snkrdunk.com', 'alt.xyz', 'cardladder.com', 'ebay.ca', 'ebay.com', 'pricecharting.com', '130point.com'];
const MOBILE_DOMAINS = ['alt.xyz'];
const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const TAB_ID_NONE = -1; // requests from the side panel's iframes are not tied to a tab

const mobileHeaders = [
  { header: 'user-agent', operation: 'set', value: MOBILE_UA },
  { header: 'sec-ch-ua-mobile', operation: 'set', value: '?1' },
  { header: 'sec-ch-ua-platform', operation: 'set', value: '"iOS"' }
];

async function installRules() {
  const base = baseRules();
  // Same rules again keyed on "loaded by this extension" (covers the first load of each mini view).
  const byInitiator = base.map(r => ({ ...r, id: r.id + 2, condition: { ...r.condition, tabIds: undefined, initiatorDomains: [chrome.runtime.id] } }));
  byInitiator.forEach(r => delete r.condition.tabIds);
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [1, 2, 3, 4], addRules: [...base, ...byInitiator] });
}

function baseRules() {
  return ({
    addRules: [
      {
        // Let marketplace pages load inside the side panel. Only affects frames that aren't in a tab
        // (i.e. this extension's own panel), never the user's normal browsing.
        id: 1,
        priority: 1,
        action: {
          type: 'modifyHeaders',
          responseHeaders: [
            { header: 'x-frame-options', operation: 'remove' },
            { header: 'content-security-policy', operation: 'remove' },
            { header: 'content-security-policy-report-only', operation: 'remove' },
            { header: 'cross-origin-opener-policy', operation: 'remove' },
            { header: 'cross-origin-embedder-policy', operation: 'remove' },
            { header: 'cross-origin-resource-policy', operation: 'remove' }
          ]
        },
        condition: { resourceTypes: ['sub_frame'], requestDomains: EMBED_DOMAINS, tabIds: [TAB_ID_NONE] }
      },
      {
        // Alt / Collectr mini views get the phone version of the site.
        id: 2,
        priority: 1,
        action: { type: 'modifyHeaders', requestHeaders: mobileHeaders },
        condition: { resourceTypes: ['sub_frame', 'xmlhttprequest', 'script'], requestDomains: MOBILE_DOMAINS, tabIds: [TAB_ID_NONE] }
      }
    ]
  }).addRules;
}

function setup() {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'gcp-price', title: 'Price graded card: "%s"', contexts: ['selection'] });
    chrome.contextMenus.create({ id: 'gcp-scan', title: 'Scan page for graded cards', contexts: ['page'] });
  });
  installRules().catch(e => console.warn('rules', e));
}

chrome.runtime.onInstalled.addListener(setup);
chrome.runtime.onStartup.addListener(setup);
installRules().catch(() => {});

// ---------------------------------------------------------------- companion windows for signed-in sources
// Alt, Collectr and Card Ladder need your own login, which embedded frames can't use. Each gets one real,
// phone-sized window that you sign into once; it then follows every new search ("connected").
// platform -> { windowId, tabId }, kept in session storage so it survives the worker restarting.
const ruleIdFor = (tabId) => 1000 + (tabId % 900000);
async function getCompanions() { return (await chrome.storage.session.get('companions')).companions || {}; }
async function setCompanions(c) { await chrome.storage.session.set({ companions: c }); }

async function openCompanion(platform, url, { focus = true } = {}) {
  const companions = await getCompanions();
  const existing = companions[platform];
  if (existing) {
    try {
      await chrome.tabs.update(existing.tabId, { url });
      if (focus) await chrome.windows.update(existing.windowId, { focused: true });
      return true;
    } catch (e) { delete companions[platform]; await setCompanions(companions); }
  }
  if (!focus) return false; // follow-only: never pops a new window by itself
  // Create blank first so the phone headers are in place before the site loads.
  // Phone-sized for Alt / Collectr (their mobile views); desktop-sized for Terapeak / Card Ladder (wide tables).
  const wide = platform === 'terapeak' || platform === 'cardladder';
  const win = await chrome.windows.create({ url: 'about:blank', type: 'popup', width: wide ? 1100 : 410, height: wide ? 820 : 860, focused: true });
  const tabId = win.tabs[0].id;
  companions[platform] = { windowId: win.id, tabId };
  await setCompanions(companions);
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [ruleIdFor(tabId)],
    addRules: [{
      id: ruleIdFor(tabId), priority: 2,
      action: { type: 'modifyHeaders', requestHeaders: mobileHeaders },
      condition: { tabIds: [tabId], requestDomains: MOBILE_DOMAINS, resourceTypes: ['main_frame', 'sub_frame', 'xmlhttprequest', 'script'] }
    }]
  });
  await chrome.tabs.update(tabId, { url });
  return true;
}

chrome.tabs.onRemoved.addListener(async (tabId) => {
  chrome.storage.session.remove('tab:' + tabId);
  const companions = await getCompanions();
  let changed = false;
  for (const [p, c] of Object.entries(companions)) {
    if (c.tabId === tabId) {
      delete companions[p];
      changed = true;
      chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [ruleIdFor(tabId)] }).catch(() => {});
    }
  }
  if (changed) {
    await setCompanions(companions);
    chrome.runtime.sendMessage({ type: 'companions-changed' }).catch(() => {});
  }
});

// ---------------------------------------------------------------- messages
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.type === 'detections' && sender.tab) {
    const tabId = sender.tab.id;
    chrome.storage.session.set({ ['tab:' + tabId]: { url: msg.url, title: msg.title, cards: msg.cards, at: Date.now() } });
    const n = msg.cards.length;
    chrome.action.setBadgeText({ tabId, text: n ? String(n) : '' });
    chrome.action.setBadgeBackgroundColor({ tabId, color: '#e5484d' });
    chrome.runtime.sendMessage({ type: 'detections-updated', tabId }).catch(() => {});
  } else if (msg.type === 'open-companion') {
    openCompanion(msg.platform, msg.url, { focus: msg.focus !== false })
      .then(ok => { reply({ ok }); chrome.runtime.sendMessage({ type: 'companions-changed' }).catch(() => {}); }, e => reply({ ok: false, error: String(e) }));
    return true;
  } else if (msg.type === 'learn-url') {
    // Only accept a same-site address that contains the search slot.
    const ok = typeof msg.template === 'string' && msg.template.includes('{q}') && /^https:\/\//.test(msg.template) && sender.tab;
    if (ok) chrome.storage.local.get('learnedUrls').then(({ learnedUrls = {} }) => {
      if (learnedUrls[msg.platform] === msg.template) return;
      learnedUrls[msg.platform] = msg.template;
      chrome.storage.local.set({ learnedUrls });
    });
  } else if (msg.type === 'list-companions') {
    getCompanions().then(c => reply(Object.keys(c)));
    return true;
  }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  // sidePanel.open must run synchronously inside the user gesture.
  chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
  if (info.menuItemId === 'gcp-price' && info.selectionText) {
    await chrome.storage.session.set({ pendingQuery: { text: info.selectionText.trim(), at: Date.now() } });
    chrome.runtime.sendMessage({ type: 'pending-query' }).catch(() => {});
  } else if (info.menuItemId === 'gcp-scan') {
    chrome.runtime.sendMessage({ type: 'rescan', tabId: tab.id }).catch(() => {});
  }
});
