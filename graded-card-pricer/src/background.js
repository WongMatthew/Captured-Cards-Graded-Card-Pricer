// Service worker: side panel wiring, per-tab detections, context menu, and header rules
// that let the side panel embed marketplace pages as mini views.

const EMBED_DOMAINS = ['alt.xyz', 'getcollectr.com', 'ebay.com', 'pricecharting.com', '130point.com'];

async function installFrameRules() {
  // Strip anti-framing headers ONLY for sub-frames loaded by this extension's own pages.
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [1],
    addRules: [{
      id: 1,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        responseHeaders: [
          { header: 'x-frame-options', operation: 'remove' },
          { header: 'content-security-policy', operation: 'remove' },
          { header: 'content-security-policy-report-only', operation: 'remove' },
          { header: 'cross-origin-opener-policy', operation: 'remove' },
          { header: 'cross-origin-embedder-policy', operation: 'remove' }
        ]
      },
      condition: {
        resourceTypes: ['sub_frame'],
        requestDomains: EMBED_DOMAINS,
        initiatorDomains: [chrome.runtime.id]
      }
    }]
  });
}

function setup() {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'gcp-price', title: 'Price graded card: "%s"', contexts: ['selection'] });
    chrome.contextMenus.create({ id: 'gcp-scan', title: 'Scan page for graded cards', contexts: ['page'] });
  });
  installFrameRules().catch(e => console.warn('frame rules', e));
}

chrome.runtime.onInstalled.addListener(setup);
chrome.runtime.onStartup.addListener(setup);
installFrameRules().catch(() => {});

const key = (tabId) => 'tab:' + tabId;

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === 'detections' && sender.tab) {
    const tabId = sender.tab.id;
    chrome.storage.session.set({ [key(tabId)]: { url: msg.url, title: msg.title, cards: msg.cards, at: Date.now() } });
    const n = msg.cards.length;
    chrome.action.setBadgeText({ tabId, text: n ? String(n) : '' });
    chrome.action.setBadgeBackgroundColor({ tabId, color: '#e5484d' });
    chrome.runtime.sendMessage({ type: 'detections-updated', tabId }).catch(() => {});
  }
});

chrome.tabs.onRemoved.addListener((tabId) => chrome.storage.session.remove(key(tabId)));

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  // sidePanel.open must be called synchronously inside the user gesture.
  chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
  if (info.menuItemId === 'gcp-price' && info.selectionText) {
    await chrome.storage.session.set({ pendingQuery: { text: info.selectionText.trim(), at: Date.now() } });
    chrome.runtime.sendMessage({ type: 'pending-query' }).catch(() => {});
  } else if (info.menuItemId === 'gcp-scan') {
    chrome.runtime.sendMessage({ type: 'rescan' }).catch(() => {});
  }
});
