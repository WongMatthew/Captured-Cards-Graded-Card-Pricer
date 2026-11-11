/* global GCP */
// Runs on Alt / Collectr pages that the extension opened (mini view iframe or phone companion window).
// It finds the right card, opens it, and reports SOLD data (never active listings) back to the side panel.
(function () {
  if (window.__gcpFrame) return;
  window.__gcpFrame = true;

  // The target card travels in the URL hash once (#gcp=…), then lives in this tab/frame's sessionStorage.
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

  const platform = location.hostname.includes('getcollectr') ? 'collectr' : location.hostname.includes('cardladder') ? 'cardladder'
    : location.hostname.includes('snkrdunk') ? 'snkrdunk' : /(^|\.)ebay\./.test(location.hostname) ? 'terapeak' : 'alt';

  // Currency the page is showing. If you've set the site to CAD (or picked CAD in its currency menu) prices are CAD.
  function pageCurrency() {
    const tags = [...document.querySelectorAll('button, span, div, a, select, option:checked, [role="button"]')]
      .filter(el => visible(el) && el.childElementCount <= 2)
      .map(el => norm(el.tagName === 'SELECT' ? el.selectedOptions[0] && el.selectedOptions[0].text : el.innerText).toUpperCase())
      .filter(t => /^(CAD|USD|CA\$|C\$|US\$)(\s|$)/.test(t));
    if (tags.some(t => /^(CAD|CA\$|C\$)/.test(t))) return 'CAD';
    if (tags.some(t => /^(USD|US\$)/.test(t))) return 'USD';
    return null;
  }
  const rowCur = (text, fallback) => { const m = GCP.parseMoney(text); return (m && m.cur) || fallback; };
  const parts = GCP.splitQuery(target.q);
  const send = (msg) => chrome.runtime.sendMessage({ platform, sid: target.sid, url: location.href, ...msg }).catch(() => {});
  const status = (text) => send({ type: 'frame-status', text });
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const visible = (el) => !!(el && el.getClientRects().length);

  // Run fn on DOM changes until it returns true or time runs out.
  function watch(fn, ms, onTimeout) {
    let done = false, t = null;
    const tick = () => { if (done) return; try { if (fn()) { done = true; obs.disconnect(); } } catch (e) { /* keep trying */ } };
    const obs = new MutationObserver(() => { clearTimeout(t); t = setTimeout(tick, 400); });
    obs.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    setTimeout(tick, 600);
    setTimeout(() => { if (!done) { done = true; obs.disconnect(); onTimeout && onTimeout(); } }, ms);
  }

  // Score a search-result card against the target. Higher is better; < 0 = wrong card.
  function scoreResult(text) {
    const m = GCP.matchCard(text, parts);
    if (!m.ok) return -1;
    let s = 1;
    if (parts.numberKey && (GCP.allNumberKeys(text).has(parts.numberKey) || new RegExp('[•#]\\s*0*' + parts.numberKey + '\\b', 'i').test(text))) s += 5;
    for (const w of parts.name.toLowerCase().split(' ')) if (w.length > 2 && text.toLowerCase().includes(w)) s += 1;
    const gs = GCP.findGrades(text);
    if (gs.length) s += GCP.titleMatchesGrade(text, parts.grader, parts.grade, parts.qual) ? 4 : -20;
    return s;
  }

  function bestLink(selector) {
    let best = null;
    const seen = new Set();
    for (const a of document.querySelectorAll(selector)) {
      if (!visible(a) || seen.has(a.href)) continue;
      seen.add(a.href);
      // Use the surrounding card's text (title, set, number, grade).
      let box = a, text = norm(a.innerText);
      for (let i = 0; i < 4 && text.length < 30 && box.parentElement; i++) { box = box.parentElement; text = norm(box.innerText); }
      const s = scoreResult(text);
      if (s > 0 && (!best || s > best.s)) best = { a, s, text };
    }
    return best;
  }

  // ---------------------------------------------------------------- Collectr
  const GRADE_PRICE_RE = /\b(PSA|BGS|CGC|SGC|TAG|ACE|Beckett)\s+(Black Label|Pristine|\d{1,2}(?:\.5)?)\s*\(\s*\$\s?([\d,]+(?:\.\d{1,2})?)\s*\)/gi;

  function collectrGradePrices() {
    const text = norm(document.body.innerText);
    const out = {};
    for (const m of text.matchAll(GRADE_PRICE_RE)) {
      const grader = m[1].toUpperCase() === 'BECKETT' ? 'BGS' : m[1].toUpperCase();
      const g = /black/i.test(m[2]) ? { grader, grade: '10', qual: 'BL' } : /pristine/i.test(m[2]) ? { grader, grade: '10', qual: 'PRISTINE' } : { grader, grade: m[2], qual: '' };
      out[GCP.gradeLabel(g)] = parseFloat(m[3].replace(/,/g, ''));
    }
    return out;
  }

  // Show only the requested grade's line on Collectr's graded chart.
  function focusLegend(wantLabel) {
    const items = [...document.querySelectorAll('button, li, div, span')].filter(el => {
      const t = norm(el.innerText);
      return el.childElementCount <= 4 && /^(PSA|BGS|CGC|SGC|TAG|ACE)\s+(Black Label|Pristine|\d{1,2}(\.5)?)\s*\(\$[\d,.]+\)$/.test(t);
    });
    const buttons = items.filter(el => el.tagName === 'BUTTON');
    if (buttons.length) items.splice(0, items.length, ...buttons);
    else for (let i = items.length - 1; i >= 0; i--) if (items.some(o => o !== items[i] && items[i].contains(o))) items.splice(i, 1);
    const struck = (el) => [el, ...el.querySelectorAll('*')].some(e => /line-through/.test(getComputedStyle(e).textDecorationLine));
    for (const el of items) {
      const label = norm(el.innerText).replace(/\s*\(.*/, '');
      const wanted = label.replace('Black Label', 'Black Label 10').replace('Pristine', 'Pristine 10') === wantLabel || label === wantLabel;
      if (wanted === struck(el)) el.click();
    }
  }

  // Result cards are often divs with the click handler on an inner element: click the title text itself.
  function clickCard(el) {
    const firstLine = norm(el.innerText.split('\n')[0]);
    const leaf = [...el.querySelectorAll('*')].find(n => n.childElementCount === 0 && norm(n.innerText) === firstLine) || el;
    const target = leaf.closest('a, button, [role="button"], [role="link"]') || leaf;
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    }
  }

  // Collectr has a currency menu (USD by default). Switch it to CAD once per tab.
  function collectrToCAD() {
    if (pageCurrency() !== 'USD' || sessionStorage.getItem('gcp-cad-tried')) return;
    sessionStorage.setItem('gcp-cad-tried', '1');
    const usd = [...document.querySelectorAll('button, [role="button"], div, span')].find(el => visible(el) && el.childElementCount <= 2 && norm(el.innerText) === 'USD');
    if (!usd) return;
    (usd.closest('button, [role="button"]') || usd).click();
    setTimeout(() => {
      const cad = [...document.querySelectorAll('button, [role="option"], [role="menuitem"], li, div, span')]
        .find(el => visible(el) && el.childElementCount <= 2 && /^CAD\b/.test(norm(el.innerText)));
      if (cad) { (cad.closest('button, [role="option"], [role="menuitem"], li') || cad).click(); sessionStorage.setItem('gcp-cad-done', '1'); }
    }, 600);
  }

  function collectr() {
    const wantLabel = GCP.gradeLabel(parts);
    setTimeout(collectrToCAD, 1500);
    if (/\/explore\/product\//.test(location.pathname)) {
      status('Reading graded prices…');
      const started = Date.now();
      watch(() => {
        if (Date.now() - started < 3000 && pageCurrency() === 'USD' && !sessionStorage.getItem('gcp-cad-done')) return false;
        const prices = collectrGradePrices();
        if (!Object.keys(prices).length) return false;
        const title = norm((document.querySelector('h1') || {}).innerText);
        const raw = GCP.parsePrice(norm(document.body.innerText).slice(0, 2000).match(/\$\s?[\d,]+\.\d{2}/) || '');
        send({ type: 'frame-sales', rows: [], product: title, gradePrices: prices, marketPrice: prices[wantLabel] ?? null, rawPrice: raw, cur: pageCurrency() || 'USD' });
        setTimeout(() => focusLegend(wantLabel), 300);
        return true;
      }, 20000, () => send({
        type: 'frame-sales', rows: [], marketPrice: null,
        note: /technical difficulties|try again/i.test(document.body.innerText)
          ? 'Collectr couldn’t load its data right now. Press ↻ or use 📱 Phone.'
          : 'Collectr shows no graded prices for this card.'
      }));
      return;
    }
    // Search page: open the product that matches the card. Collectr's search is picky, so try a few phrasings.
    searchWithFallbacks('Collectr', [parts.name, GCP.coreName(parts), [parts.keyWord, parts.number].join(' ')], 'query', () => {
      let best = bestLink('a[href*="/explore/product/"]');
      if (!best) {
        // Results are clickable cards rather than links.
        for (const el of document.querySelectorAll('li, .product-card, article')) {
          const t = norm(el.innerText);
          if (!visible(el) || t.length < 10 || t.length > 300 || !/\$[\d,]+\.\d{2}/.test(t)) continue;
          const sc = scoreResult(t);
          if (sc > 0 && (!best || sc > best.s)) best = { a: el, s: sc, text: t };
        }
      }
      if (!best || (parts.numberKey && best.s < 6)) return false;
      status('Opening ' + best.text.slice(0, 60) + '…');
      if (best.a.href) location.href = best.a.href; else clickCard(best.a);
      return true;
    });
  }

  // Try each search phrasing in turn (state kept in sessionStorage across page loads).
  function searchWithFallbacks(name, queries, param, tryPick) {
    queries = [...new Set(queries.map(q => norm(q)).filter(Boolean))];
    const cur = norm(new URLSearchParams(location.search).get(param) || '');
    let idx = queries.findIndex(q => q.toLowerCase() === cur.toLowerCase());
    if (idx < 0) idx = 0;
    status(`Finding the card on ${name}…`);
    watch(tryPick, 15000, () => {
      const next = queries[idx + 1];
      if (next) {
        status(`Trying “${next}” on ${name}…`);
        const u = new URL(location.href);
        u.searchParams.set(param, next);
        u.hash = '';
        location.href = u.toString();
      } else {
        send({ type: 'frame-sales', rows: [], marketPrice: null, note: `Couldn’t find this exact card on ${name}. Pick it in the mini view or 📱 Phone window.` });
      }
    });
  }

  // ---------------------------------------------------------------- Alt
  const LISTING_RE = /\b(bid|bids|buy now|make (an )?offer|starting (bid|at)|current bid|ends? in|time left|watching|asking|list(ed|ing)? price|for sale|add to cart|place bid)\b|\/\s*BID\b|\b\d+D\s*\d+H\b/i;
  const SOLD_SECTION_RE = /\b(sales? history|recent sales|sold history|past sales|last sold|previous sales|transaction history|comps|sold listings|market sales)\b/i;
  const PRICE_RE = /\$\s?\d[\d,]*(?:\.\d{1,2})?/g;

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
      if (!date) continue;
      if (LISTING_RE.test(t)) continue;
      if (requireSoldWord && !/\bsold\b|\bsale\b/i.test(t)) continue;
      // Keep the smallest element holding both a price and a date.
      if ([...el.children].some(c => { const ct = norm(c.innerText); return /\$\s?\d/.test(ct) && GCP.parseDate(ct); })) continue;
      if (seen.has(t)) continue;
      seen.add(t);
      const link = el.closest('a') || el.querySelector('a');
      const money = GCP.parseMoney(prices[prices.length - 1]);
      const exact = GCP.parseDateTime(t);
      rows.push({ price: money && money.amount, cur: (money && money.cur) || pageCurrency() || 'USD', date: (exact || date).toISOString(), exact: !!exact,
        title: t.slice(0, 160), url: link ? link.href : location.href, scoped: !requireSoldWord });
      if (rows.length >= 100) break;
    }
    return rows;
  }

  // Alt item pages list population per grading company ("PSA POPULATION 10 587 9 5,796 …", "BGS POPULATION 9.5 75 …").
  function altPop() {
    const tokens = (document.body.innerText || '').split(/\n+/).map(t => t.trim()).filter(Boolean);
    const graders = {};
    for (let i = 0; i < tokens.length; i++) {
      const h = tokens[i].match(/^(PSA|BGS|CGC|SGC|TAG)\s+POPULATION$/i);
      if (!h) continue;
      const g = h[1].toUpperCase();
      const counts = {};
      for (let j = i + 1; j + 1 < tokens.length; j += 2) {
        const grade = tokens[j].toUpperCase(), n = tokens[j + 1].replace(/,/g, '');
        if (!/^(10|[1-9](\.5)?|BL|PRISTINE|P)$/.test(grade) || !/^\d+$/.test(n)) break;
        counts[grade === 'BL' || grade === 'PRISTINE' || grade === 'P' ? 'BL' : grade] = +n;
      }
      if (Object.keys(counts).length) graders[g] = counts;
    }
    return Object.keys(graders).length ? { source: 'Alt', note: 'top grades only', graders } : null;
  }

  function altSold() {
    let rows = [];
    // 1) Rows inside a "Sales history"-style section belong to the open asset.
    const heads = [...document.querySelectorAll('h1, h2, h3, h4, h5, h6, div, span, p, button, [role="tab"]')]
      .filter(el => el.childElementCount <= 2 && norm(el.innerText).length < 40 && SOLD_SECTION_RE.test(norm(el.innerText)));
    for (const h of heads) {
      let box = h.parentElement;
      for (let i = 0; i < 5 && box; i++, box = box.parentElement) {
        const r = rowsIn(box, false);
        if (r.length >= 1) { rows = rows.concat(r); break; }
      }
    }
    // 2) Anywhere else, only rows that explicitly say sold.
    if (!rows.length) rows = rowsIn(document.body, true);
    const seen = new Set();
    rows = rows.filter(r => !seen.has(r.title) && seen.add(r.title));
    const text = norm(document.body.innerText);
    const altValue = (text.match(/alt value[^$]{0,20}(\$\s?[\d,]+(?:\.\d{1,2})?)/i) || [])[1];
    const lastSale = (text.match(/last (?:sale|sold)[^$]{0,20}(\$\s?[\d,]+(?:\.\d{1,2})?)/i) || [])[1];
    const mp = GCP.parseMoney(altValue || lastSale || '');
    return { rows, marketPrice: mp ? mp.amount : null, cur: (mp && mp.cur) || pageCurrency() || 'USD', signedOut: /sign up \/ log in|log in to see|sign in to view/i.test(text) };
  }

  function alt() {
    if (/^\/itm\//.test(location.pathname) || /^\/research\//.test(location.pathname)) {
      status('Reading sold history…');
      // Open a sales-history tab if the page has one.
      const tab = [...document.querySelectorAll('button, [role="tab"], a')].find(el => SOLD_SECTION_RE.test(norm(el.innerText)) && norm(el.innerText).length < 30);
      if (tab) tab.click();
      let last = '';
      watch(() => {
        const r = altSold();
        const sig = r.rows.length + ':' + r.marketPrice;
        if (sig !== last) { last = sig; send({ type: 'frame-sales', rows: r.rows, marketPrice: r.marketPrice, cur: r.cur, pop: altPop(), product: norm((document.querySelector('h1, h2') || {}).innerText).slice(0, 80) }); }
        return r.rows.length >= 3;
      }, 20000, () => {
        const r = altSold();
        send({
          type: 'frame-sales', rows: r.rows, marketPrice: r.marketPrice, cur: r.cur, pop: altPop(),
          note: r.rows.length ? '' : r.signedOut ? 'Alt only shows sold history when you’re signed in. Open the phone window and log in.' : 'No sold history visible on this Alt page.'
        });
      });
      return;
    }
    // Browse page = ACTIVE listings. Never report them as sales; open the matching asset to read its sold history.
    searchWithFallbacks('Alt', [GCP.coreName(parts), parts.name, parts.keyWord], 'query', () => {
      const best = bestLink('a[href*="/itm/"], a[href*="/research/"]');
      if (!best) return false;
      status('Opening ' + best.text.slice(0, 60) + '…');
      location.href = best.a.href;
      return true;
    });
  }

  // ---------------------------------------------------------------- Card Ladder
  function cardladder() {
    status('Reading Card Ladder sales…');
    let last = '';
    watch(() => {
      const rows = rowsIn(document.querySelector('main') || document.body, false).map(r => ({ ...r, scoped: false }));
      const sig = rows.length + ':' + (rows[0] && rows[0].title);
      if (rows.length && sig !== last) { last = sig; send({ type: 'frame-sales', rows, marketPrice: null, cur: pageCurrency() || 'USD' }); }
      return rows.length >= 10;
    }, 25000, () => {
      const signedOut = /log ?in|sign ?in|subscribe/i.test(norm(document.body.innerText).slice(0, 3000));
      if (!last) send({ type: 'frame-sales', rows: [], marketPrice: null, note: signedOut ? 'Sign in to Card Ladder in the 📱 window to see sales history.' : 'No sales found on Card Ladder for this search.' });
    });
  }

  // ---------------------------------------------------------------- SNKRDUNK (Japan)
  // Product titles look like "ゲンガーEX SR :1ED [XY4 090/088](拡張パック「ファントムゲート」)"; ":1ED" = 1st Edition,
  // "【英語版】" = English version. Sales histories list date / condition / price (¥) per grade.
  const SD_GRADES = { 'PSA10': 'PSA 10', 'PSA9': 'PSA 9', 'BGS10 BL': 'BGS Black Label 10', 'BGS10 GL': 'BGS 10', 'BGS9.5': 'BGS 9.5' };

  function sdNumber(title) {
    const m = title.match(/\[(?:[A-Za-z0-9-]+\s+)?0*(\d{1,3})\s*(?:\/|\])/) || title.match(/\b0*(\d{1,3})\s*\/\s*\d{1,3}\b/);
    return m ? m[1] : '';
  }
  function sdScore(title) {
    let s = 0;
    const want = (parts.numberKey || '').replace(/^0+/, '');
    const num = sdNumber(title);
    if (want) { if (num === want) s += 10; else if (num) return -1; }
    const first = /:1ED|1st/i.test(title), english = /英語版/.test(title);
    const wantFirst = (parts.variants || []).includes('1st Edition'), wantJp = (parts.variants || []).includes('Japanese');
    s += first === wantFirst ? 3 : -3;
    if (wantJp) s += english ? -5 : 3; else s += english ? 2 : 0;
    if (/未開封|パック|ボックス|BOX/i.test(title)) s -= 8; // sealed products
    return s;
  }

  function snkrdunk() {
    const path = location.pathname;
    if (/^\/apparels\/\d+\/sales-histories/.test(path)) {
      status('Reading SNKRDUNK sales…');
      watch(() => {
        // Rows read as "2026/11/04 PSA10 1,335,000". A hidden view returns them run together
        // ("2026/11/04PSA101,335,0002026/11/01…"), so match on the text itself, not on line breaks.
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
      return;
    }
    const prod = path.match(/^\/apparels\/(\d+)\/?$/);
    if (prod) { location.href = `/apparels/${prod[1]}/sales-histories`; return; }
    // search results → the exact version of the card
    status('Finding the card on SNKRDUNK…');
    watch(() => {
      let best = null;
      for (const a of document.querySelectorAll('a[href*="/apparels/"]')) {
        const id = (a.getAttribute('href').match(/\/apparels\/(\d+)\/?$/) || [])[1];
        if (!id) continue;
        const t = norm(a.innerText);
        const sc = sdScore(t);
        if (sc > 0 && (!best || sc > best.sc)) best = { id, sc, t };
      }
      if (!best) return false;
      status('Opening ' + best.t.slice(0, 50) + '…');
      location.href = `/apparels/${best.id}/sales-histories`;
      return true;
    }, 15000, () => send({ type: 'frame-sales', rows: [], marketPrice: null, note: 'This card isn’t on SNKRDUNK (it mostly lists Japanese cards and popular English ones).' }));
  }

  // ---------------------------------------------------------------- Terapeak (eBay Seller Hub → Research)
  // Sold tab: one row per sold listing with title (item link), average sold price, and date last sold.
  // These are eBay's actual sold prices, so accepted best offers show their real amount.
  function terapeak() {
    status('Reading Terapeak sold listings…');
    let last = '';
    const read = () => {
      const rows = [];
      const seen = new Set();
      for (const a of document.querySelectorAll('a[href*="/itm/"]')) {
        const row = a.closest('tr, [role="row"], li, .research-table-row') || a.parentElement && a.parentElement.parentElement;
        if (!row || seen.has(row)) continue;
        seen.add(row);
        const text = norm(row.innerText || row.textContent);
        const money = GCP.parseMoney(text);
        const date = GCP.parseDate(text.replace(/\b\d+\s+(sold|total)\b/gi, ''));
        if (!money || !date) continue;
        const id = (a.href.match(/\/itm\/(?:[^/]+\/)?(\d{9,})/) || [])[1] || null;
        const qty = +((text.match(/\b(\d+)\s*(?:sold|total sold)\b/i) || [])[1] || 1);
        rows.push({ price: money.amount, cur: money.cur || 'CAD', date: date.toISOString(), title: norm(a.innerText || a.textContent) || text.slice(0, 140),
          url: a.href.split('?')[0], itemId: id, realBestOffer: true, qty });
      }
      return rows;
    };
    watch(() => {
      const rows = read();
      const sig = rows.length + ':' + (rows[0] && rows[0].itemId);
      if (rows.length && sig !== last) { last = sig; send({ type: 'frame-sales', rows, marketPrice: null, cur: 'CAD' }); }
      return rows.length >= 50;
    }, 30000, () => {
      if (last) return;
      const t = norm(document.body.innerText).slice(0, 4000);
      const note = /sign in|sign-in/i.test(t) && !/sign out/i.test(t) ? 'Sign in to eBay in the Terapeak window.'
        : /seller hub|get started|opt in|subscribe/i.test(t) ? 'Open Seller Hub → Research once in the Terapeak window to turn on Terapeak (free).'
        : 'No sold listings on Terapeak for this search.';
      send({ type: 'frame-sales', rows: [], marketPrice: null, note });
    });
  }

  // SPA route changes: re-run when the path changes.
  let lastPath = '';
  function route() {
    if (location.pathname + location.search === lastPath) return;
    lastPath = location.pathname + location.search;
    ({ collectr, alt, cardladder, snkrdunk, terapeak })[platform]();
  }
  route();
  setInterval(route, 1000);
})();
