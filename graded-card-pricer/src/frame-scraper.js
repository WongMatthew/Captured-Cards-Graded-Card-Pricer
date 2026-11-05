// Runs inside platform pages that the side panel embeds as "mini views".
// Heuristically pulls sold rows (price + date) out of the rendered page and posts them back.
(function () {
  let embedded = false;
  try {
    const anc = location.ancestorOrigins;
    embedded = window.top !== window && anc && anc.length && String(anc[anc.length - 1]).startsWith('chrome-extension://');
  } catch (e) { embedded = false; }
  if (!embedded || window.__gcpFrame) return;
  window.__gcpFrame = true;

  const host = location.hostname;
  const platform = host.includes('alt.xyz') ? 'alt' : host.includes('getcollectr') ? 'collectr'
    : host.includes('ebay') ? 'ebay' : host.includes('pricecharting') ? 'pricecharting' : host.includes('130point') ? '130point' : host;

  const PRICE_RE = /\$\s?\d[\d,]*(?:\.\d{1,2})?/g;

  function extract() {
    const rows = [];
    const candidates = document.querySelectorAll('tr, li, [role="row"], article, a, div');
    const seen = new Set();
    for (const el of candidates) {
      if (el.childElementCount > 40) continue;
      const t = (el.innerText || '').trim();
      if (t.length < 8 || t.length > 320) continue;
      const prices = t.match(PRICE_RE);
      if (!prices || prices.length !== 1) continue;
      const date = GCP.parseDate(t);
      if (!date) continue;
      // Keep the smallest element that still holds both price and date.
      let inner = false;
      for (const c of el.children) {
        const ct = c.innerText || '';
        if (ct.match(PRICE_RE) && GCP.parseDate(ct)) { inner = true; break; }
      }
      if (inner && el.tagName !== 'TR') continue;
      if (seen.has(t)) continue;
      seen.add(t);
      const link = el.closest('a') || el.querySelector('a');
      rows.push({
        price: GCP.parsePrice(prices[0]),
        date: date.toISOString(),
        title: t.replace(/\s+/g, ' ').slice(0, 160),
        url: link ? link.href : location.href
      });
      if (rows.length >= 80) break;
    }
    // A headline "market price" for apps (e.g. Collectr) that show value without dated sales.
    let marketPrice = null;
    const label = [...document.querySelectorAll('div, span, p, dt, h2, h3')].find(e =>
      e.childElementCount < 4 && /market\s*(price|value)|est\.?\s*value|alt value|current value/i.test(e.innerText || '') && (e.innerText || '').length < 80);
    if (label) {
      const box = label.parentElement || label;
      const p = (box.innerText || '').match(PRICE_RE);
      if (p) marketPrice = GCP.parsePrice(p[0]);
    }
    return { rows, marketPrice };
  }

  let lastSig = '';
  function send() {
    const { rows, marketPrice } = extract();
    const sig = rows.length + ':' + marketPrice;
    if (sig === lastSig) return;
    lastSig = sig;
    chrome.runtime.sendMessage({ type: 'frame-sales', platform, url: location.href, rows, marketPrice }).catch(() => {});
  }

  let t = null;
  const obs = new MutationObserver(() => { clearTimeout(t); t = setTimeout(send, 800); });
  obs.observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(send, 1500);
  setTimeout(() => obs.disconnect(), 45000);
})();
