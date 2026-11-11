/* global GCPPlatforms */
// Runs on 130point's sales page in a normal tab. When the panel opened it (#gcpq=…), it types the search in for you;
// whenever results are on screen (yours or the panel's search) it hands them to the side panel.
(function () {
  if (window.top !== window || window.__gcp130) return;
  window.__gcp130 = true;
  const m = location.hash.match(/gcpq=([^&]+)/);
  const q = m ? decodeURIComponent(m[1]) : '';
  const visible = (el) => !!(el && el.getClientRects().length);
  const searchInput = () => [...document.querySelectorAll('input[type="search"], input[type="text"], input:not([type])')].find(visible);

  function runSearch() {
    const input = searchInput();
    if (!input) return false;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, q);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    const scope = input.closest('form') || input.parentElement.parentElement || document;
    const btn = [...scope.querySelectorAll('button, input[type="submit"]')].find(b => visible(b) && /search|go|submit/i.test(b.innerText || b.value || b.ariaLabel || ''))
      || scope.querySelector('button[type="submit"], input[type="submit"]');
    if (btn) btn.click();
    else input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    return true;
  }
  if (q) {
    let tries = 0;
    const t = setInterval(() => { if (runSearch() || ++tries > 30) clearInterval(t); }, 500);
  }

  let last = '', timer = null;
  function send() {
    const sales = GCPPlatforms.parse130(document);
    if (!sales.length) return;
    const sig = sales.length + ':' + sales[0].price + ':' + sales[0].title;
    if (sig === last) return;
    last = sig;
    const input = searchInput();
    chrome.runtime.sendMessage({
      type: '130-page-sales', url: location.href, query: (input && input.value) || q,
      sales: sales.map(s => ({ ...s, date: s.date.toISOString() }))
    }).catch(() => {});
  }
  new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(send, 700); })
    .observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(send, 1500);
})();
