/* global GCP */
// Watches the page (Gmail, Outlook, marketplaces, any site) for graded-card mentions
// and reports them to the background worker so the side panel can price them.
(function () {
  if (window.top !== window || window.__gcpContent) return;
  window.__gcpContent = true;

  let last = '';
  let timer = null;
  let opts = { autoScan: true, pokemonOnly: true };

  // When an email is open, read only that email (subject + bodies), not the inbox list around it.
  function readableText() {
    const host = location.hostname;
    const parts = [];
    if (/mail\.google\.com$/.test(host)) {
      const subject = document.querySelector('h2.hP');
      const bodies = document.querySelectorAll('div.a3s');
      if (subject || bodies.length) {
        if (subject) parts.push(subject.innerText);
        bodies.forEach(b => parts.push(b.innerText));
        return parts.join('\n');
      }
    }
    if (/outlook\.(live|office|office365)\.com$/.test(host) || /outlook\.cloud\.microsoft$/.test(host)) {
      const reading = document.querySelector('[aria-label="Reading Pane"], [aria-label="Message body"], div[role="document"]');
      if (reading) return reading.innerText;
    }
    if (/mail\.yahoo\.com$/.test(host)) {
      const msg = document.querySelector('[data-test-id="message-view"], [data-test-id="message-group-view"]');
      if (msg) return msg.innerText;
    }
    const main = document.querySelector('main, [role="main"], article');
    return ((main && main.innerText.length > 200 ? main : document.body).innerText || '');
  }

  function detect(text) {
    return GCP.detectCards(String(text).slice(0, 300000), { max: 30, pokemonOnly: opts.pokemonOnly });
  }

  function scan() {
    timer = null;
    if (!document.body) return;
    const cards = detect(readableText());
    const sig = JSON.stringify(cards.map(c => c.query + c.askPrice));
    if (sig === last) return;
    last = sig;
    chrome.runtime.sendMessage({ type: 'detections', url: location.href, title: document.title, cards }).catch(() => {});
  }

  function schedule() { if (!timer) timer = setTimeout(scan, 1000); }

  chrome.storage.sync.get({ autoScan: true, pokemonOnly: true }, (o) => {
    opts = o;
    if (!o.autoScan) return;
    scan();
    new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    window.addEventListener('hashchange', schedule);
    window.addEventListener('popstate', schedule);
  });

  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg.type === 'scan-now') {
      const sel = String(window.getSelection() || '').trim();
      let cards = sel ? detect(sel) : [];
      if (sel && !cards.length) cards = GCP.detectCards(sel, { max: 5, pokemonOnly: false });
      const fromSelection = !!cards.length && !!sel;
      if (!cards.length) cards = detect(readableText());
      last = '';
      reply({ cards, url: location.href, title: document.title, fromSelection });
    }
  });
})();
