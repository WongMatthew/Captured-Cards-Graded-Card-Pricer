/* global GCP */
// Runs on pages the extension opens for a search: SNKRDUNK (hidden view in the panel) and the signed-in windows for
// Alt, Card Ladder and Terapeak. It reads SOLD data (never active listings) and sends it to the side panel.
(function () {
  if (window.__gcpFrame) return;
  window.__gcpFrame = true;

  // The search travels in the URL hash once (#gcp=…), then lives in this tab/frame's sessionStorage, so it
  // survives the site's own navigation (sign-in pages, search → item, …).
  let target = null;
  try {
    const m = location.hash.match(/[#&]gcp=([^&]+)/);
    if (m) {
      target = JSON.parse(decodeURIComponent(m[1]));
      sessionStorage.setItem('gcp-target', JSON.stringify(target));
    } else {
      target = JSON.parse(sessionStorage.getItem('gcp-target') || 'null');
    }
  } catch (e) { target = null; }
  if (!target) return;

  const host = location.hostname;
  const platform = host.includes('cardladder') ? 'cardladder' : host.includes('snkrdunk') ? 'snkrdunk'
    : /(^|\.)ebay\./.test(host) ? 'terapeak' : 'alt';
  const parts = GCP.splitQuery(target.q);
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const visible = (el) => !!(el && el.getClientRects().length);
  const send = (msg) => chrome.runtime.sendMessage({ platform, sid: target.sid, url: location.href, ...msg }).catch(() => {});
  const status = (text) => send({ type: 'frame-status', text });
  const pageText = () => norm(document.body && document.body.innerText).slice(0, 5000);

  // Run fn on DOM changes until it returns true or time runs out.
  function watch(fn, ms, onTimeout) {
    let done = false, t = null;
    const tick = () => { if (done) return; try { if (fn()) { done = true; obs.disconnect(); } } catch (e) { /* keep trying */ } };
    const obs = new MutationObserver(() => { clearTimeout(t); t = setTimeout(tick, 400); });
    obs.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    setTimeout(tick, 600);
    setTimeout(() => { if (!done) { done = true; obs.disconnect(); onTimeout && onTimeout(); } }, ms);
  }

  // Currency the page is showing (a CAD setting in your account wins), else null.
  function pageCurrency() {
    const tags = [...document.querySelectorAll('button, span, div, a, select, [role="button"]')]
      .filter(el => visible(el) && el.childElementCount <= 2)
      .map(el => norm(el.tagName === 'SELECT' ? el.selectedOptions[0] && el.selectedOptions[0].text : el.innerText).toUpperCase())
      .filter(t => /^(CAD|USD|CA\$|C\$|US\$)(\s|$)/.test(t));
    if (tags.some(t => /^(CAD|CA\$|C\$)/.test(t))) return 'CAD';
    if (tags.some(t => /^(USD|US\$)/.test(t))) return 'USD';
    return null;
  }

  // ---------------------------------------------------------------- signed in?
  const SECURITY_RE = /performing security verification|verify you are human|are you human|just a moment/i;
  function signedOut() {
    const t = pageText();
    if (/\b(log ?out|sign ?out|my collection|my account|portfolio)\b/i.test(t)) return false;
    return /\b(sign up \/ log in|log ?in|sign ?in|create (an )?account)\b/i.test(t);
  }
  // While you sign in, keep checking; once you're in, go back to the card being searched.
  function waitForSignIn(name) {
    send({ type: 'frame-sales', rows: [], marketPrice: null, note: `Sign in to ${name} in its window: the card is opened automatically once you’re in.` });
    const started = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - started > 15 * 60e3) return clearInterval(timer);
      if (SECURITY_RE.test(pageText()) || signedOut()) return;
      clearInterval(timer);
      status('Signed in: opening the card…');
      if (target.u) location.href = target.u.replace(/#.*$/, '');
      else location.reload();
    }, 3000);
  }

  // ---------------------------------------------------------------- reading sold rows
  const LISTING_RE = /\b(bid|bids|buy now|make (an )?offer|starting (bid|at)|current bid|ends? in|time left|watching|asking|list(ed|ing)? price|for sale|add to cart|place bid)\b|\/\s*BID\b|\b\d+D\s*\d+H\b/i;
  const SOLD_SECTION_RE = /\b(sales? history|recent sales|sold history|past sales|last sold|previous sales|transaction history|comps|sold listings|market sales|sold)\b/i;
  const PRICE_RE = /\$\s?\d[\d,]*(?:\.\d{1,2})?/g;

  // Smallest elements holding one date and one or two prices: one row per sale.
  function rowsIn(root, requireSoldWord) {
    const rows = [];
    const seen = new Set();
    for (const el of root.querySelectorAll('tr, li, [role="row"], a, div')) {
      if (el.childElementCount > 30) continue;
      const t = norm(el.innerText);
      if (t.length < 8 || t.length > 260) continue;
      const prices = t.match(PRICE_RE);
      if (!prices || prices.length > 2) continue;
      const date = GCP.parseDate(t);
      if (!date || LISTING_RE.test(t)) continue;
      if (requireSoldWord && !/\bsold\b|\bsale\b/i.test(t)) continue;
      if ([...el.children].some(c => { const ct = norm(c.innerText); return /\$\s?\d/.test(ct) && GCP.parseDate(ct); })) continue;
      if (seen.has(t)) continue;
      seen.add(t);
      const link = el.closest('a') || el.querySelector('a');
      const money = GCP.parseMoney(prices[0]);
      const exact = GCP.parseDateTime(t);
      rows.push({ price: money && money.amount, cur: (money && money.cur) || pageCurrency() || 'USD', date: (exact || date).toISOString(), exact: !!exact,
        title: t.slice(0, 160), url: link ? link.href : location.href });
      if (rows.length >= 100) break;
    }
    return rows;
  }

  // Tidy a row's text into a title: drop its dates, prices and marketplace name.
  const MARKETS_RE = /\b(eBay|Goldin|Fanatics(?: Collect)?|PWCC|Heritage|MySlabs|Alt|Probstein|Pristine Auction|REA|Lelands|Memory Lane|Collectable|Courtyard)\b/i;
  function tidy(r) {
    const via = (r.title.match(MARKETS_RE) || [])[1];
    const title = r.title.replace(/\b(?:[A-Z][a-z]{2,8}\.?\s+\d{1,2},?\s+\d{4}|\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}\/\d{1,2}\/\d{2,4})\b/g, ' ')
      .replace(/(?:US|C|CA)?\s?\$\s?[\d,]+(?:\.\d{1,2})?/g, ' ').replace(via ? new RegExp('\\b' + via + '\\b', 'i') : /$^/, ' ')
      .replace(/\b(sold|on|for)\b/gi, ' ').replace(/[·•|–—-]+/g, ' ').replace(/\s+/g, ' ').trim();
    return { ...r, title, rawTitle: r.title, via: via && !/ebay/i.test(via) ? via : undefined };
  }

  // Pick the search result that is this card (number, name, grade).
  function scoreResult(text) {
    if (!GCP.matchCard(text, parts).ok) return -1;
    let s = 1;
    if (parts.numberKey && (GCP.allNumberKeys(text).has(parts.numberKey) || new RegExp('[•#]\\s*0*' + parts.numberKey + '\\b', 'i').test(text))) s += 5;
    for (const w of parts.name.toLowerCase().split(' ')) if (w.length > 2 && text.toLowerCase().includes(w)) s += 1;
    if (GCP.findGrades(text).length) s += GCP.titleMatchesGrade(text, parts.grader, parts.grade, parts.qual) ? 4 : -20;
    return s;
  }
  function bestLink(selector) {
    let best = null;
    const seen = new Set();
    for (const a of document.querySelectorAll(selector)) {
      if (!visible(a) || seen.has(a.href)) continue;
      seen.add(a.href);
      let box = a, text = norm(a.innerText);
      for (let i = 0; i < 4 && text.length < 30 && box.parentElement; i++) { box = box.parentElement; text = norm(box.innerText); }
      const s = scoreResult(text);
      if (s > 0 && (!best || s > best.s)) best = { a, s, text };
    }
    return best;
  }

  // ---------------------------------------------------------------- Alt
  // Alt item pages: sold history (signed in), Alt Value, and population per grading company.
  function altPop() {
    const tokens = (document.body.innerText || '').split(/\n+/).map(t => t.trim()).filter(Boolean);
    const graders = {};
    for (let i = 0; i < tokens.length; i++) {
      const h = tokens[i].match(/^(PSA|BGS|CGC|SGC|TAG)\s+POPULATION$/i);
      if (!h) continue;
      const counts = {};
      for (let j = i + 1; j + 1 < tokens.length; j += 2) {
        const grade = tokens[j].toUpperCase(), n = tokens[j + 1].replace(/,/g, '');
        if (!/^(10|[1-9](\.5)?|BL|PRISTINE|P)$/.test(grade) || !/^\d+$/.test(n)) break;
        counts[/^(BL|PRISTINE|P)$/.test(grade) ? 'BL' : grade] = +n;
      }
      if (Object.keys(counts).length) graders[h[1].toUpperCase()] = counts;
    }
    return Object.keys(graders).length ? { source: 'Alt', note: 'top grades only', graders } : null;
  }

  function altSold() {
    let rows = [];
    // Rows under a "Sales history"-style heading belong to this card; elsewhere only rows that say "sold".
    const heads = [...document.querySelectorAll('h1, h2, h3, h4, h5, h6, div, span, p, button, [role="tab"]')]
      .filter(el => el.childElementCount <= 2 && norm(el.innerText).length < 40 && SOLD_SECTION_RE.test(norm(el.innerText)));
    for (const h of heads) {
      let box = h.parentElement;
      for (let i = 0; i < 5 && box; i++, box = box.parentElement) {
        const r = rowsIn(box, false);
        if (r.length) { rows = rows.concat(r.map(x => ({ ...x, scoped: true }))); break; }
      }
    }
    if (!rows.length) rows = rowsIn(document.body, true);
    const seen = new Set();
    // Sales-history rows often hold only date / price / marketplace: title them with the card's name.
    const cardName = norm((document.querySelector('h1') || {}).innerText);
    rows = rows.filter(r => !seen.has(r.title) && seen.add(r.title)).map(tidy)
      .map(r => ({ ...r, title: /[a-z]{3,}/i.test(r.title) ? r.title : r.scoped && cardName ? cardName : r.rawTitle }));
    const text = pageText();
    const v = (text.match(/alt value[^$]{0,20}(\$\s?[\d,]+(?:\.\d{1,2})?)/i) || text.match(/last (?:sale|sold)[^$]{0,20}(\$\s?[\d,]+(?:\.\d{1,2})?)/i) || [])[1];
    const mp = v ? GCP.parseMoney(v) : null;
    return { rows, marketPrice: mp ? mp.amount : null, cur: (mp && mp.cur) || pageCurrency() || 'USD' };
  }

  function alt() {
    if (SECURITY_RE.test(pageText())) return send({ type: 'frame-sales', rows: [], marketPrice: null, note: 'Alt is showing a security check: complete it in the Alt window.' });
    if (signedOut()) return waitForSignIn('Alt');
    if (/^\/(itm|research)\//.test(location.pathname)) {
      status('Reading Alt sold history…');
      // Open the sales-history tab if the page has one.
      const tab = [...document.querySelectorAll('button, [role="tab"], a')].find(el => /sales? history|recent sales|sold|transactions/i.test(norm(el.innerText)) && norm(el.innerText).length < 30);
      if (tab) tab.click();
      let last = '';
      watch(() => {
        const r = altSold();
        const sig = r.rows.length + ':' + r.marketPrice;
        if (sig !== last) { last = sig; send({ type: 'frame-sales', rows: r.rows, marketPrice: r.marketPrice, cur: r.cur, pop: altPop(), product: norm((document.querySelector('h1, h2') || {}).innerText).slice(0, 80) }); }
        return r.rows.length >= 5;
      }, 30000, () => {
        const r = altSold();
        if (!r.rows.length) send({ type: 'frame-sales', rows: [], marketPrice: r.marketPrice, cur: r.cur, pop: altPop(), note: 'No sold history shown on this Alt page.' });
      });
      return;
    }
    if (!/^\/browse/.test(location.pathname)) { if (target.u) location.href = target.u.replace(/#.*$/, ''); return; }
    // Browse results are ACTIVE listings: never counted. Open the matching card to read its sold history.
    status('Finding the card on Alt…');
    watch(() => {
      const best = bestLink('a[href*="/itm/"], a[href*="/research/"]');
      if (!best) return false;
      status('Opening ' + best.text.slice(0, 60) + '…');
      location.href = best.a.href;
      return true;
    }, 20000, () => send({ type: 'frame-sales', rows: [], marketPrice: null, note: 'Couldn’t find this card in Alt’s search. Open it in the Alt window and it will be read.' }));
  }

  // ---------------------------------------------------------------- Card Ladder
  function cardladder() {
    if (SECURITY_RE.test(pageText())) return send({ type: 'frame-sales', rows: [], marketPrice: null, note: 'Card Ladder is showing a security check: complete it in the Card Ladder window.' });
    if (signedOut()) return waitForSignIn('Card Ladder');
    status('Reading Card Ladder…');
    let last = '';
    const read = () => {
      const rows = rowsIn(document.querySelector('main, [role="main"]') || document.body, false).map(tidy)
        .map(r => ({ ...r, title: /[a-z]{3,}/i.test(r.title) ? r.title : r.rawTitle }));
      const v = (pageText().match(/\b(?:CL|Card Ladder)\s*Value[^$]{0,24}(\$\s?[\d,]+(?:\.\d{1,2})?)/i) || [])[1];
      return { rows, value: v ? GCP.parseMoney(v) : null };
    };
    watch(() => {
      const { rows, value } = read();
      const sig = rows.length + ':' + (rows[0] && rows[0].title) + ':' + (value && value.amount);
      if ((rows.length || value) && sig !== last) {
        last = sig;
        send({ type: 'frame-sales', rows, marketPrice: value ? value.amount : null, cur: (value && value.cur) || pageCurrency() || 'USD' });
      }
      return rows.length >= 15;
    }, 30000, () => {
      if (last) return;
      send({ type: 'frame-sales', rows: [], marketPrice: null, note: learned() ? 'No sales found on Card Ladder for this search.'
        : 'Search this card once yourself in the Card Ladder window (Sales History). The extension learns that page and follows every search after.' });
    });
  }

  // When you search in a signed-in window yourself, remember the address with your search replaced by {q},
  // so later searches from the panel open that same kind of page.
  const learned = () => sessionStorage.getItem('gcp-learned') === '1';
  function learnSearchUrl() {
    const inputs = [...document.querySelectorAll('input[type="search"], input[type="text"], input:not([type])')].filter(i => visible(i) && i.value && i.value.trim().length > 2);
    for (const input of inputs) {
      const v = input.value.trim();
      const href = location.href.replace(/#.*$/, '');
      for (const form of [encodeURIComponent(v), encodeURIComponent(v).replace(/%20/g, '+'), v.replace(/ /g, '+'), v.replace(/ /g, '%20'), v]) {
        if (form && href.includes(form)) {
          chrome.runtime.sendMessage({ type: 'learn-url', platform, template: href.replace(form, '{q}') }).catch(() => {});
          sessionStorage.setItem('gcp-learned', '1');
          return;
        }
      }
    }
  }

  // ---------------------------------------------------------------- SNKRDUNK (sales-history page)
  // Rows read "2026/11/04 PSA10 1,335,000". A hidden view returns them run together
  // ("2026/11/04PSA101,335,0002026/11/01…"), so match on the text itself, not on line breaks.
  const SD_GRADES = { 'PSA10': 'PSA 10', 'PSA9': 'PSA 9', 'BGS10 BL': 'BGS Black Label 10', 'BGS10 GL': 'BGS 10', 'BGS9.5': 'BGS 9.5' };
  function snkrdunk() {
    if (!/^\/apparels\/\d+\/sales-histories/.test(location.pathname)) return;
    status('Reading SNKRDUNK sales…');
    watch(() => {
      const text = (document.body.textContent || '').replace(/\s+/g, ' ');
      const title = norm((document.querySelector('h1') || {}).textContent) || norm(document.title);
      const conds = Object.keys(SD_GRADES).concat(['PSA8以下', 'BGS9以下', 'ARS10\\+', 'ARS10', 'ARS9', 'ARS8以下', '他鑑定品', '[A-D]'])
        .sort((a, b) => b.length - a.length).join('|');
      const re = new RegExp('(\\d{4}/\\d{2}/\\d{2}) ?(' + conds + ') ?(\\d{1,3}(?:,\\d{3})*)(?=\\d{4}/|[^\\d,]|$)', 'g');
      const rows = [];
      for (const m of text.matchAll(re)) {
        const label = SD_GRADES[m[2]];
        if (!label) continue; // ungraded (A–D), "8 or lower", other graders
        rows.push({ price: +m[3].replace(/,/g, ''), cur: 'JPY', date: GCP.parseDate(m[1]).toISOString(), title: `${title} ${label}`, url: location.href, scoped: true });
      }
      if (!rows.length) return false;
      send({ type: 'frame-sales', rows, marketPrice: null, cur: 'JPY', product: title });
      return true;
    }, 20000, () => send({ type: 'frame-sales', rows: [], marketPrice: null, note: 'SNKRDUNK has no sales history for this card yet.' }));
  }

  // ---------------------------------------------------------------- Terapeak (eBay Seller Hub → Research, Sold tab)
  // One row per sold listing: title (item link), sold price, date. eBay's actual prices, incl. accepted offers.
  function terapeak() {
    status('Reading Terapeak sold listings…');
    const siteCur = /ebay\.ca$/.test(host) ? 'CAD' : 'USD';
    let last = '';
    const read = () => {
      const rows = [];
      const seen = new Set();
      for (const a of document.querySelectorAll('a[href*="/itm/"]')) {
        const row = a.closest('tr, [role="row"], li, .research-table-row') || (a.parentElement && a.parentElement.parentElement);
        if (!row || seen.has(row)) continue;
        seen.add(row);
        const text = norm(row.innerText || row.textContent);
        const money = GCP.parseMoney(text);
        const date = GCP.parseDate(text.replace(/\b\d+\s+(sold|total)\b/gi, ''));
        if (!money || !date) continue;
        rows.push({ price: money.amount, cur: money.cur || siteCur, date: date.toISOString(), title: norm(a.innerText || a.textContent) || text.slice(0, 140),
          url: a.href.split('?')[0], itemId: (a.href.match(/\/itm\/(?:[^/]+\/)?(\d{9,})/) || [])[1] || null, realBestOffer: true });
      }
      return rows;
    };
    watch(() => {
      const rows = read();
      const sig = rows.length + ':' + (rows[0] && rows[0].itemId);
      if (rows.length && sig !== last) { last = sig; send({ type: 'frame-sales', rows, marketPrice: null, cur: siteCur }); }
      return rows.length >= 50;
    }, 30000, () => {
      if (last) return;
      const t = pageText();
      const note = /sign in|sign-in/i.test(t) && !/sign out/i.test(t) ? 'Sign in to eBay in the Terapeak window.'
        : /seller hub|get started|opt in|subscribe/i.test(t) ? 'Open Seller Hub → Research once in the Terapeak window to turn on Terapeak (free).'
        : 'No sold listings on Terapeak for this search.';
      send({ type: 'frame-sales', rows: [], marketPrice: null, note });
    });
  }

  // Single-page sites change address without reloading: re-run when it changes.
  let lastPath = '';
  function route() {
    if (location.pathname + location.search === lastPath) return;
    lastPath = location.pathname + location.search;
    ({ alt, cardladder, snkrdunk, terapeak })[platform]();
  }
  route();
  setInterval(route, 1000);
  if (platform === 'cardladder' || platform === 'alt') setInterval(learnSearchUrl, 2000);
})();
