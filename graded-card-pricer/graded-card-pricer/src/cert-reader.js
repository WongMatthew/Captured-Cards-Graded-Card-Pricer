/* global GCP */
// Runs on PSA / CGC cert pages. Reads the card details and hands them to the side panel so it can price the card.
(function () {
  if (window.top !== window || window.__gcpCert) return;
  window.__gcpCert = true;
  const host = location.hostname;
  const grader = /psacard/.test(host) ? 'PSA' : /cgccards/.test(host) ? 'CGC' : '';
  const cert = (location.pathname.match(/(\d{7,10})/) || [])[1];
  if (!grader || !cert) return;
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const LABELS = {
    subject: ['subject', 'card name', 'player', 'name'],
    brand: ['brand/title', 'brand', 'card set', 'set', 'title'],
    year: ['year'],
    cardNumber: ['card number', 'card #', 'card no.', 'number'],
    variety: ['variety/pedigree', 'variety', 'variant'],
    gradeText: ['item grade', 'grade', 'card grade'],
    language: ['language'],
    pop: ['psa population', 'population'],
    popHigher: ['psa pop higher', 'pop higher', 'population higher']
  };
  function valueAfter(el) {
    // dt/dd, th/td, or label element followed by a value element
    let n = el.nextElementSibling;
    if (n && norm(n.innerText)) return norm(n.innerText);
    const p = el.parentElement;
    if (p && p.children.length === 2 && p.lastElementChild !== el) return norm(p.lastElementChild.innerText);
    n = p && p.nextElementSibling;
    return n ? norm(n.innerText) : '';
  }
  function read() {
    const info = { grader, cert };
    const els = [...document.querySelectorAll('dt, th, td, div, span, p, label, h3, h4, strong')].filter(e => e.childElementCount <= 1);
    for (const [key, names] of Object.entries(LABELS)) {
      for (const e of els) {
        const t = norm(e.innerText).toLowerCase().replace(/:$/, '');
        if (!names.includes(t)) continue;
        const v = valueAfter(e);
        if (v && v.length < 120 && v.toLowerCase() !== t) { info[key] = v; break; }
      }
    }
    return info;
  }
  let tries = 0;
  const timer = setInterval(() => {
    const info = read();
    // Keep trying for ~2 minutes: the user may be passing the site's security check first.
    if ((info.subject && info.gradeText) || ++tries > 150) {
      clearInterval(timer);
      chrome.runtime.sendMessage({ type: 'cert-page-info', url: location.href, info }).catch(() => {});
    }
  }, 800);
})();
