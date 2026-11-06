// Service worker: side panel wiring, per-tab detections, context menu, network rules for the
// embedded mini views, and phone-sized "companion" windows for Alt / Collectr.

const EMBED_DOMAINS = ['alt.xyz', 'getcollectr.com', 'ebay.com', 'pricecharting.com', '130point.com'];
const MOBILE_DOMAINS = ['alt.xyz', 'getcollectr.com'];
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

// ---------------------------------------------------------------- companion phone windows
// platform -> { windowId, tabId }
const companions = {};
const ruleIdFor = (tabId) => 1000 + (tabId % 900000);

async function openCompanion(platform, url) {
  const existing = companions[platform];
  if (existing) {
    try {
      await chrome.tabs.update(existing.tabId, { url });
      await chrome.windows.update(existing.windowId, { focused: true });
      return;
    } catch (e) { delete companions[platform]; }
  }
  // Create blank first so the mobile rule is in place before the site loads.
  const win = await chrome.windows.create({ url: 'about:blank', type: 'popup', width: 410, height: 860, focused: true });
  const tabId = win.tabs[0].id;
  companions[platform] = { windowId: win.id, tabId };
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [ruleIdFor(tabId)],
    addRules: [{
      id: ruleIdFor(tabId), priority: 2,
      action: { type: 'modifyHeaders', requestHeaders: mobileHeaders },
      condition: { tabIds: [tabId], requestDomains: MOBILE_DOMAINS, resourceTypes: ['main_frame', 'sub_frame', 'xmlhttprequest', 'script'] }
    }]
  });
  await chrome.tabs.update(tabId, { url });
}

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove('tab:' + tabId);
  for (const [p, c] of Object.entries(companions)) {
    if (c.tabId === tabId) {
      delete companions[p];
      chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [ruleIdFor(tabId)] }).catch(() => {});
    }
  }
});

// ---------------------------------------------------------------- messages
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.type === 'detections' && sender.tab) {
    const tabId = sender.tab.id;
    if (Object.values(companions).some(c => c.tabId === tabId)) return;
    chrome.storage.session.set({ ['tab:' + tabId]: { url: msg.url, title: msg.title, cards: msg.cards, at: Date.now() } });
    const n = msg.cards.length;
    chrome.action.setBadgeText({ tabId, text: n ? String(n) : '' });
    chrome.action.setBadgeBackgroundColor({ tabId, color: '#e5484d' });
    chrome.runtime.sendMessage({ type: 'detections-updated', tabId }).catch(() => {});
  } else if (msg.type === 'open-companion') {
    openCompanion(msg.platform, msg.url).then(() => reply({ ok: true }), e => reply({ ok: false, error: String(e) }));
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
