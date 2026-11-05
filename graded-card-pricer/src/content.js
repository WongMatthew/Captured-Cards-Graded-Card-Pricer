// Watches the page (Gmail, Outlook, marketplaces, any site) for graded-card mentions
// and reports them to the background worker so the side panel can price them.
(function () {
  if (window.top !== window || window.__gcpContent) return;
  window.__gcpContent = true;

  let last = '';
  let timer = null;

  function visibleText() {
    // Prefer the open email body in Gmail / Outlook so inbox lists don't drown it out.
    const focus = document.querySelector('div[role="main"] .a3s, div[role="main"] [role="listitem"] .ii, div[aria-label="Message body"], [role="document"]');
    const main = document.querySelector('div[role="main"]');
    const parts = [];
    if (focus) parts.push(focus.innerText);
    parts.push((main || document.body).innerText || '');
    return parts.join('\n').slice(0, 200000);
  }

  function scan() {
    timer = null;
    if (!document.body) return;
    const text = visibleText();
    const cards = GCP.detectCards(text, { max: 25 });
    const sig = JSON.stringify(cards.map(c => c.query));
    if (sig === last) return;
    last = sig;
    chrome.runtime.sendMessage({ type: 'detections', url: location.href, title: document.title, cards }).catch(() => {});
  }

  function schedule() { if (!timer) timer = setTimeout(scan, 1200); }

  chrome.storage.sync.get({ autoScan: true }, ({ autoScan }) => {
    if (!autoScan) return;
    scan();
    new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    window.addEventListener('hashchange', schedule);
  });

  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg.type === 'scan-now') {
      const sel = String(window.getSelection() || '').trim();
      const cards = GCP.detectCards(sel || visibleText(), { max: 25 });
      reply({ cards, url: location.href, title: document.title, fromSelection: !!sel });
    }
  });
})();
