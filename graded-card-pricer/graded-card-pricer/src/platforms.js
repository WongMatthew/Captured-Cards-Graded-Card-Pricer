// Marketplace adapters.
// Fetch adapters return { url, sales: [{price, date, title, url, itemId, img, bestOffer}], product? }.
(function (root) {
  const { parseDate, matchCard, gradeLabel } = root.GCP;

  // Everything is shown in Canadian dollars. eBay is searched on eBay.ca (prices already in CAD); sources with no
  // Canadian version (PriceCharting, 130point, Alt) are converted at the Bank of Canada daily rate and marked "converted".
  const DEFAULTS = {
    autoScan: false,
    trimOutliers: true,
    pokemonOnly: true,
    excludeBestOffers: true,
    includeConverted: true,
    autoCollectr: true,
    autoAlt: false,
    ebayLocation: 'all',
    platforms: {
      ebay: { enabled: true, url: 'https://www.ebay.ca/sch/i.html?_nkw={q}&LH_Sold=1&LH_Complete=1&_sop=13&_ipg=240' },
      pricecharting: { enabled: true, url: 'https://www.pricecharting.com/search-products?q={q}&type=prices' },
      '130point': { enabled: true, url: 'https://130point.com/sales/' },
      alt: { enabled: true, url: 'https://alt.xyz/browse?query={q}&category=POKEMON_CARDS' },
      collectr: { enabled: true, url: 'https://app.getcollectr.com/?query={q}' },
      cardladder: { enabled: true, url: 'https://app.cardladder.com/sales-history?q={q}' }
    }
  };
  // Settings saved by older versions pointed eBay at eBay.com (US$). Move them to eBay.ca.
  function migrateSettings(cfg) {
    const e = cfg.platforms && cfg.platforms.ebay;
    if (e && /\/\/www\.ebay\.com\//.test(e.url)) e.url = DEFAULTS.platforms.ebay.url;
    return cfg;
  }
  // Secrets live in chrome.storage.local (this computer only), not in synced settings.
  const SECRET_KEYS = ['psaApiKey', 'ebayAppId', 'ebayCertId'];

  const META = {
    ebay: { name: 'eBay.ca', short: 'eB', color: '#3b82f6', mode: 'fetch', cur: 'CAD', note: 'Sold & completed listings, in CAD' },
    pricecharting: { name: 'PriceCharting', short: 'PC', color: '#16a34a', mode: 'fetch', cur: 'USD', note: 'Completed sales by grade' },
    '130point': { name: '130point', short: '130', color: '#f59e0b', mode: 'fetch', cur: 'USD', note: 'eBay sales incl. real best-offer prices' },
    alt: { name: 'Alt', short: 'Alt', color: '#a855f7', mode: 'embed', cur: 'USD', note: 'Sold history (sign in to Alt)' },
    collectr: { name: 'Collectr', short: 'Co', color: '#ec4899', mode: 'embed', cur: 'USD', note: 'Market price per grade (set Collectr to CAD)' },
    cardladder: { name: 'Card Ladder', short: 'CL', color: '#0ea5e9', mode: 'embed', cur: 'USD', note: 'Sales history (sign in to Card Ladder)' }
  };
  // Sources that need your own login: they're read from a real window you're signed into.
  const LOGIN_SOURCES = ['alt', 'collectr', 'cardladder'];

  // ---------------------------------------------------------------- exchange rates (Bank of Canada)
  const FX_SERIES = ['USD', 'GBP', 'EUR', 'AUD', 'JPY', 'NZD', 'HKD', 'SGD'];
  async function getRates() {
    const { fxRates } = await chrome.storage.local.get('fxRates');
    if (fxRates && Date.now() - fxRates.at < 12 * 3600e3) return fxRates;
    try {
      const url = 'https://www.bankofcanada.ca/valet/observations/' + FX_SERIES.map(c => `FX${c}CAD`).join(',') + '/json?recent=1';
      const res = await fetch(url, { credentials: 'omit' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const j = await res.json();
      const obs = j.observations[0];
      const rates = { CAD: 1 };
      for (const c of FX_SERIES) if (obs[`FX${c}CAD`]) rates[c] = parseFloat(obs[`FX${c}CAD`].v);
      const out = { at: Date.now(), date: obs.d, rates };
      await chrome.storage.local.set({ fxRates: out });
      return out;
    } catch (e) {
      return fxRates || null; // stale rates beat none; null = can't convert
    }
  }
  // → {price (CAD), converted, orig} or null when it can't be converted.
  function toCAD(amount, cur, fx) {
    if (!amount) return null;
    if (!cur || cur === 'CAD') return { price: amount, converted: false };
    const r = fx && fx.rates[cur];
    if (!r) return null;
    return { price: Math.round(amount * r * 100) / 100, converted: true, orig: { amount, cur } };
  }

  const JUNK_RE = /\b(lot of|\d+\s*card lot|lots|bundle|proxy|custom|replica|fake|repack|mystery|you pick|choose|u pick|pick your|digital|code card|reprint|fan art|sticker|empty|case only|slab only|label only|no card|read description|art card|metal card|orica)\b/i;

  const enc = (q) => encodeURIComponent(q).replace(/%20/g, '+');
  const fill = (tpl, q) => tpl.replace('{q}', enc(q));
  const cardOnly = (parts) => [parts.name, parts.number].filter(Boolean).join(' ').trim();

  async function getText(url, init = {}, timeout = 20000) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeout);
    try {
      const res = await fetch(url, { credentials: 'include', ...init, signal: ctl.signal });
      if (!res.ok) throw new Error(res.status === 403 || res.status === 429 ? `Blocked by the site (HTTP ${res.status})` : 'HTTP ' + res.status);
      return { html: await res.text(), finalUrl: res.url };
    } finally { clearTimeout(t); }
  }

  const toDoc = (html) => new DOMParser().parseFromString(html, 'text/html');
  const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');

  // ---------------------------------------------------------------- eBay
  function ebayQuery(parts) {
    const ex = ['-lot', '-proxy', '-custom', '-repack', '-digital'];
    if (parts.grader === 'BGS' && parts.qual !== 'BL') ex.push('-"black label"');
    if (parts.grader !== 'PSA' && parts.qual !== 'PRISTINE') ex.push('-pristine');
    return [cardOnly(parts), gradeLabel(parts), ...ex].join(' ');
  }

  function parseEbay(doc, siteCur = 'CAD') {
    const out = [];
    const list = doc.querySelectorAll('ul.srp-results > li, ul.srp-results > div > li');
    const items = list.length ? [...list] : [...doc.querySelectorAll('li.s-item, li.s-card')];
    for (const el of items) {
      const cls = el.className || '';
      const text = txt(el);
      // Everything after "Results matching fewer words" is a different card.
      if (/srp-river-answer--REWRITE_START/.test(cls) || /results matching fewer words/i.test(text) && text.length < 200) { out.cutOff = true; break; }
      if (!text || /shop on ebay/i.test(text) && text.length < 120) continue;
      const soldM = text.match(/Sold\s+((?:[A-Z][a-z]{2,8}\.?\s+\d{1,2},?\s+\d{4})|(?:\d{1,2}\s+[A-Z][a-z]{2,8}\.?\s+\d{4}))/);
      if (!soldM) continue;
      const date = parseDate(soldM[1]);
      const priceEl = el.querySelector('.s-item__price, .s-card__price');
      const priceText = txt(priceEl) || text;
      if (/\bto\b/.test(priceText) && (priceText.match(/\$/g) || []).length > 1) continue;
      const money = root.GCP.parseMoney(priceText);
      if (!money || !date) continue;
      const price = money.amount, cur = money.cur || siteCur;
      let title = txt(el.querySelector('.s-item__title, .s-card__title, [role="heading"], h3')) || (el.querySelector('img') || {}).alt || '';
      title = title.replace(/^New Listing\s*/i, '').replace(/Opens in a new window or tab$/i, '').trim();
      const a = el.querySelector('a[href*="/itm/"]');
      const url = a ? a.href.split('?')[0] : '';
      const idM = url.match(/\/itm\/(?:[^/]+\/)?(\d{9,})/);
      const img = el.querySelector('img');
      out.push({
        price, cur, date, title, url, itemId: idM ? idM[1] : null,
        img: img ? (img.getAttribute('src') || img.getAttribute('data-src') || '').replace(/^data:.*/, '') : '',
        bestOffer: /best offer accepted/i.test(text),
        auction: /\bbids?\b/i.test(text)
      });
    }
    return out;
  }

  const siteCurOf = (url) => /ebay\.ca\//.test(url) ? 'CAD' : /ebay\.co\.uk\//.test(url) ? 'GBP' : 'USD';
  function ebaySearchUrl(cfg, parts, settings) {
    let url = fill(cfg.url, ebayQuery(parts));
    if (settings && settings.ebayLocation === 'canada' && !/LH_PrefLoc=/.test(url)) url += '&LH_PrefLoc=1';
    return url;
  }

  // eBay's official sold-items API (Marketplace Insights). Needs an eBay developer key approved for it.
  async function ebayToken(appId, certId) {
    const { ebayToken: cached } = await chrome.storage.session.get('ebayToken');
    if (cached && cached.app === appId && cached.exp > Date.now() + 60000) return cached.token;
    const res = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
      method: 'POST', credentials: 'omit',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ' + btoa(appId.trim() + ':' + certId.trim()) },
      body: new URLSearchParams({ grant_type: 'client_credentials', scope: 'https://api.ebay.com/oauth/api_scope/buy.marketplace.insights' })
    });
    if (!res.ok) throw new Error(res.status === 400 || res.status === 401 ? 'eBay API keys rejected, or not yet approved for sold-items access' : 'eBay token HTTP ' + res.status);
    const j = await res.json();
    await chrome.storage.session.set({ ebayToken: { app: appId, token: j.access_token, exp: Date.now() + (j.expires_in || 7200) * 1000 } });
    return j.access_token;
  }

  async function ebayViaApi(parts, keys) {
    const token = await ebayToken(keys.ebayAppId, keys.ebayCertId);
    const q = [cardOnly(parts), gradeLabel(parts)].join(' ');
    let next = `https://api.ebay.com/buy/marketplace_insights/v1_beta/item_sales/search?q=${encodeURIComponent(q)}&limit=200`;
    const sales = [];
    for (let page = 0; page < 3 && next; page++) {
      const res = await fetch(next, { credentials: 'omit', headers: { Authorization: 'Bearer ' + token, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_CA', 'Accept-Language': 'en-CA' } });
      if (res.status === 403) throw new Error('Your eBay key isn’t approved for sold-items access (Marketplace Insights)');
      if (!res.ok) throw new Error('eBay API HTTP ' + res.status);
      const j = await res.json();
      for (const it of j.itemSales || []) {
        const p = it.lastSoldPrice || {};
        sales.push({
          price: parseFloat(p.value), cur: p.currency || 'CAD', date: new Date(it.lastSoldDate), exact: true,
          title: it.title || '', url: it.itemWebUrl || '', itemId: (String(it.itemId || '').split('|')[1]) || null,
          img: (it.image && it.image.imageUrl) || '', auction: (it.buyingOptions || []).includes('AUCTION')
        });
      }
      next = j.next || null;
    }
    return sales.filter(x => x.price && !isNaN(x.date));
  }

  async function ebay(query, cfg, parts, ctx = {}) {
    const url = ebaySearchUrl(cfg, parts, ctx.settings);
    const keys = ctx.secrets || {};
    let apiError = null;
    if (keys.ebayAppId && keys.ebayCertId) {
      try { return { url, sales: await ebayViaApi(parts, keys), via: 'eBay API' }; }
      catch (e) { apiError = e.message; }
    }
    // Sold-results pages, newest first: up to 3 pages (720 listings) while results are still relevant.
    const sales = [];
    const seen = new Set();
    for (let page = 1; page <= 3; page++) {
      let html;
      try { ({ html } = await getText(page === 1 ? url : url + '&_pgn=' + page)); }
      catch (e) { if (page > 1) break; if (/Blocked/.test(e.message)) e.blocked = true; if (apiError) e.message = apiError + '; ' + e.message; throw e; }
      const doc = toDoc(html);
      if (/captcha|pardon our interruption|security measure|verify yourself/i.test(txt(doc.querySelector('title')) + ' ' + txt(doc.querySelector('h1')))) {
        if (page > 1) break;
        throw Object.assign(new Error('eBay asked for a security check'), { blocked: true });
      }
      const got = parseEbay(doc, siteCurOf(url));
      for (const s of got) { const k = s.itemId || s.title + s.price; if (!seen.has(k)) { seen.add(k); sales.push(s); } }
      const hasNext = !!doc.querySelector('a.pagination__next:not([aria-disabled="true"]), a[type="next"]:not([aria-disabled="true"])');
      const oldest = got.length ? got[got.length - 1].date : null;
      if (got.cutOff || !hasNext || got.length < 100 || (oldest && root.GCP.daysAgo(oldest) > 120)) break;
      ctx.progress && ctx.progress(`Reading page ${page + 1}…`);
    }
    return { url, sales, note: apiError ? `eBay API: ${apiError}. Used the website instead.` : '' };
  }

  // ---------------------------------------------------------------- PriceCharting
  // Which currency a page is showing: an explicit selector/label wins (e.g. you set the site to CAD), else the fallback.
  function pageCurrency(doc, fallback) {
    // Only the *selected* currency counts (menus list every currency, CAD included).
    const sel = doc.querySelector('#dropdown_selected_currency, select[name*="currency" i] option[selected], [class*="currency" i] [aria-selected="true"]');
    const t = sel ? txt(sel).toUpperCase() : '';
    const m = t.match(/\b(CAD|USD|GBP|EUR|AUD|JPY)\b/);
    if (m) return m[1];
    if (/CA\$|C\$/.test(t)) return 'CAD';
    return fallback;
  }

  function parsePriceCharting(doc) {
    const out = [];
    const pageCur = pageCurrency(doc, 'USD');
    const seen = new Set();
    for (const tr of doc.querySelectorAll('tr')) {
      const dEl = tr.querySelector('td.date');
      if (!dEl) continue;
      const id = tr.id || '';
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      const date = parseDate(txt(dEl));
      const money = root.GCP.parseMoney(txt(tr.querySelector('.js-price, td.numeric')));
      const price = money && money.amount;
      const a = tr.querySelector('td.title a');
      const source = /\[TCGPlayer\]/i.test(txt(tr.querySelector('td.title'))) ? 'TCGPlayer' : 'eBay';
      const title = txt(a || tr.querySelector('td.title')).replace(/\[(eBay|TCGPlayer)\]/gi, '').trim();
      if (!date || !price) continue;
      const ebayId = (id.match(/^ebay-(\d+)/) || [])[1] || null;
      out.push({ price, cur: (money && money.cur) || pageCur, date, title, url: a ? a.href : '', itemId: ebayId, via: source });
    }
    return out;
  }

  function pickPriceChartingProduct(doc, parts) {
    const links = [...new Set([...doc.querySelectorAll('#games_table td.title a, a[href*="/game/pokemon"]')])]
      .filter(a => /\/game\//.test(a.getAttribute('href') || ''));
    if (!links.length) return null;
    const nk = (parts.numberKey || '').toLowerCase();
    const words = parts.name.toLowerCase().split(/\s+/).filter(w => w.length > 1);
    const scored = links.map(a => {
      const href = a.getAttribute('href').toLowerCase();
      const row = a.closest('tr');
      const text = (txt(row || a) + ' ' + href.replace(/[-/]/g, ' ')).toLowerCase();
      let s = 0;
      if (nk && new RegExp('-' + nk + '$').test(href)) s += 6;
      for (const w of words) if (text.includes(w)) s += 1;
      const m = matchCard(text.replace(/-/g, ' '), { ...parts, numberKey: '' });
      if (!m.ok) s -= 6;
      return { href: a.getAttribute('href'), s };
    }).sort((x, y) => y.s - x.s);
    return new URL(scored[0].href, 'https://www.pricecharting.com').href;
  }

  // Population report + card details that PriceCharting embeds in each product page.
  // VGPC.pop_data = {"psa":[g1..g10], "cgc":[g1..g10]} (census updated monthly).
  function parsePriceChartingInfo(doc, html) {
    const pop = {};
    const m = String(html).match(/VGPC\.pop_data\s*=\s*(\{[^;]*\})\s*;/);
    if (m) {
      try {
        const j = JSON.parse(m[1]);
        for (const [k, arr] of Object.entries(j)) {
          if (!Array.isArray(arr) || !arr.some(n => n > 0)) continue;
          pop[k.toUpperCase() === 'BECKETT' ? 'BGS' : k.toUpperCase()] = Object.fromEntries(arr.map((n, i) => [String(i + 1), n]));
        }
      } catch (e) { /* ignore malformed */ }
    }
    const detail = (label) => {
      const td = [...doc.querySelectorAll('#attribute td.title')].find(t => txt(t).replace(/:$/, '').toLowerCase() === label);
      const v = td && td.nextElementSibling ? txt(td.nextElementSibling) : '';
      return /^(none|n\/a|-|tbd)?$/i.test(v) ? '' : v;
    };
    const img = (String(html).match(/https:\/\/storage\.googleapis\.com\/images\.pricecharting\.com\/[^'"\s]+\/240\.jpg/) || [])[0] || '';
    return {
      pop: Object.keys(pop).length ? { source: 'PriceCharting', note: 'census updated monthly', graders: pop } : null,
      info: { image: img, releaseDate: detail('release date'), publisher: detail('publisher'), cardNumber: detail('card number') }
    };
  }

  async function pricecharting(query, cfg, parts) {
    const url = fill(cfg.url, cardOnly(parts) || query);
    let { html, finalUrl } = await getText(url);
    let doc = toDoc(html);
    let productUrl = finalUrl;
    if (!/\/game\//.test(finalUrl)) {
      productUrl = pickPriceChartingProduct(doc, parts);
      if (!productUrl) return { url, sales: [] };
      html = (await getText(productUrl)).html;
      doc = toDoc(html);
    }
    const product = txt(doc.querySelector('h1#product_name')) || txt(doc.querySelector('h1'));
    const extra = parsePriceChartingInfo(doc, html);
    return { url: productUrl, product, sales: parsePriceCharting(doc), pop: extra.pop, info: { ...extra.info, title: product } };
  }

  // ---------------------------------------------------------------- 130point
  function parse130(doc) {
    const out = [];
    for (const tr of doc.querySelectorAll('tr')) {
      const text = txt(tr);
      if (text.length < 10 || tr.querySelector('tr')) continue;
      const exact = root.GCP.parseDateTime(text);
      const dm = text.match(/Date:?\s*((?:[A-Z][a-z]{2}\s+)?\d{1,2}\s+[A-Z][a-z]{2}\s+\d{4}|[A-Z][a-z]{2}\s+\d{1,2},?\s+\d{4}|\d{4}-\d{2}-\d{2})/);
      const date = exact || parseDate(dm ? dm[1] : text);
      const sale = text.match(/(?:Sale|Sold|Final|Best Offer)\s*Price:?\s*[^\d]{0,6}[\d,]+(?:\.\d{1,2})?(?:\s?[A-Z]{3}\b)?/i);
      const dataPrice = tr.getAttribute('data-price');
      const money = root.GCP.parseMoney(sale ? sale[0] : dataPrice ? '$' + dataPrice + ' ' + (tr.getAttribute('data-currency') || '') : text);
      if (!date || !money) continue;
      const a = tr.querySelector('a[href*="ebay"]') || tr.querySelector('a[href]');
      const href = a ? a.getAttribute('href') || '' : '';
      const idM = href.match(/(?:\/itm\/(?:[^/]+\/)?|item=)(\d{9,})/);
      const img = tr.querySelector('img');
      // Currency: from the price text, else the eBay site the sale happened on, else US$.
      const cur = money.cur || (/ebay\.ca\b/.test(href) ? 'CAD' : /ebay\.co\.uk\b/.test(href) ? 'GBP' : 'USD');
      out.push({
        price: money.amount, cur, date, exact: !!exact, title: txt(a) || text.slice(0, 140), url: href, itemId: idM ? idM[1] : null,
        img: img ? img.getAttribute('src') || '' : '', bestOffer: /best offer/i.test(text), realBestOffer: /best offer/i.test(text)
      });
    }
    return out;
  }

  async function point130(query, cfg, parts) {
    const body = new URLSearchParams({ query: [cardOnly(parts), gradeLabel(parts)].join(' '), type: '2', subcat: '-1' });
    let html;
    try {
      ({ html } = await getText('https://back.130point.com/sales/', {
        method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' }
      }));
    } catch (e) { if (/Blocked/.test(e.message)) e.blocked = true; throw e; }
    return { url: cfg.url, sales: parse130(toDoc(html)) };
  }

  // ---------------------------------------------------------------- cert lookups
  const CERT_PAGES = {
    PSA: (n) => `https://www.psacard.com/cert/${n}`,
    CGC: (n) => `https://www.cgccards.com/certlookup/${n}/`,
    BGS: (n) => `https://www.beckett.com/grading/card-lookup?item_type=BGS&item_id=${n}`,
    SGC: (n) => `https://gosgc.com/cert-code-lookup?certcode=${n}`,
    TAG: (n) => `https://my.taggrading.com/card/${n}`
  };

  const titleCase = (s) => String(s || '').toLowerCase().replace(/(^|[\s(/-])([a-z])/g, (m, a, b) => a + b.toUpperCase())
    .replace(/\b(Vmax|Vstar|Gx|Ex|V|Swsh|Sv|Sm|Xy|Tg\d+)\b/g, (w) => w.toUpperCase());

  // Turn cert details (from PSA's API or a cert page) into a search like "Luigi Pikachu Japanese XY Promo 295 PSA 10".
  function certToQuery(info) {
    const g = root.GCP.parseGradeText(info.grader, info.gradeText);
    const subject = String(info.subject || '').replace(/^(FA|SR|AR|SAR|SIR|IR|CHR|RR|UR|HR)\//i, '').replace(/-(HOLO|REV\.?\s*HOLO|FULL ART|SECRET)\b/gi, ' ').replace(/\s+/g, ' ').trim();
    // PSA brand text: "POKEMON GAME" = Base Set; drop series names ("SWORD & SHIELD", "SCARLET & VIOLET") and "P.M." prefixes.
    const brand = String(info.brand || '').replace(/P\.M\.?/gi, ' ').replace(/^\s*POKEMON\s+GAME\s*$/i, 'Base Set')
      .replace(/\b(SWORD\s*&\s*SHIELD|SCARLET\s*&\s*VIOLET|SUN\s*&\s*MOON|SWSH|SV|SM)\b/gi, ' ');
    const japanese = /\b(JPN|JAPANESE|JAPAN)\b/i.test(brand + ' ' + (info.language || ''));
    const setWords = brand.replace(/\b(POKEMON|POKÉMON|P\.M\.|PM|JPN|JAPANESE|GAME|ENGLISH|TCG)\b/gi, ' ').replace(/[^\w\s&'-]/g, ' ').trim().split(/\s+/).filter(Boolean).slice(0, 4).join(' ');
    const variety = String(info.variety || '').match(/1st edition|shadowless|reverse holo|staff|prerelease|stamped/i);
    const number = String(info.cardNumber || '').replace(/^#/, '').trim();
    const parts = [titleCase(subject), japanese ? 'Japanese' : '', titleCase(setWords), variety ? titleCase(variety[0]) : '', number,
      g ? root.GCP.gradeLabel(g) : ''].filter(Boolean);
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  }

  // PSA's official public API (free key from psacard.com → My Account → API). Returns null when no key is set.
  async function psaCertViaApi(cert, token) {
    if (!token) return null;
    const res = await fetch(`https://api.psacard.com/publicapi/cert/GetByCertNumber/${encodeURIComponent(cert)}`, {
      headers: { Authorization: 'bearer ' + token.trim(), Accept: 'application/json' }
    });
    if (res.status === 401 || res.status === 403) {
      // e.g. "Access to this API is limited to approved customers." (account not yet approved) or an expired token
      let msg = '';
      try { msg = (await res.json()).Message || ''; } catch (e) { /* not JSON */ }
      throw new Error('PSA API: ' + (msg || 'the key in Settings was rejected (expired?)'));
    }
    if (res.status === 429) throw new Error('PSA API daily limit reached');
    if (!res.ok) throw new Error('PSA API HTTP ' + res.status);
    const j = await res.json();
    const c = j && (j.PSACert || j.psaCert);
    if (!c || !c.Subject) throw new Error('PSA has no record of cert ' + cert);
    const info = {
      grader: 'PSA', cert, subject: c.Subject, brand: c.Brand, year: c.Year, cardNumber: c.CardNumber, variety: c.Variety,
      gradeText: c.CardGrade || c.GradeDescription, pop: c.TotalPopulation, popHigher: c.PopulationHigher, url: CERT_PAGES.PSA(cert)
    };
    info.specId = c.SpecID;
    info.popWithQualifier = c.TotalPopulationWithQualifier;
    const [pop, images] = await Promise.all([
      psaSpecPop(c.SpecID, token).catch(() => null),
      psaCertImages(cert, token).catch(() => [])
    ]);
    info.specPop = pop;
    info.images = images;
    return { ...info, query: certToQuery(info) };
  }

  // Slab photos: GET /cert/GetImagesByCertNumber/{cert}. The schema is an untyped object, so read any image URLs
  // and use an "is front" style flag when present.
  async function psaCertImages(cert, token) {
    const res = await fetch(`https://api.psacard.com/publicapi/cert/GetImagesByCertNumber/${encodeURIComponent(cert)}`, {
      headers: { Authorization: 'bearer ' + token.trim(), Accept: 'application/json' }
    });
    if (!res.ok) return [];
    const j = await res.json();
    const out = [];
    const walk = (v) => {
      if (Array.isArray(v)) return v.forEach(walk);
      if (!v || typeof v !== 'object') return;
      const url = Object.entries(v).find(([k, x]) => typeof x === 'string' && /^https?:\/\/.+/i.test(x) && /image|url/i.test(k));
      if (url) {
        const flag = Object.entries(v).find(([k]) => /front/i.test(k));
        out.push({ url: url[1], front: flag ? !!flag[1] : out.length === 0 });
      } else Object.values(v).forEach(walk);
    };
    walk(j);
    return out.sort((a, b) => b.front - a.front);
  }

  // Grade-by-grade PSA population for a card (spec). Field names like Grade10, Grade9, Grade8_5, Auth, Total.
  async function psaSpecPop(specId, token) {
    if (!specId) return null;
    const res = await fetch(`https://api.psacard.com/publicapi/pop/GetPSASpecPopulation/${encodeURIComponent(specId)}`, {
      headers: { Authorization: 'bearer ' + token.trim(), Accept: 'application/json' }
    });
    if (!res.ok) return null;
    const j = await res.json();
    const p = j && (j.PSAPop || j.psaPop || j);
    const grades = {};
    for (const [k, v] of Object.entries(p || {})) {
      const m = k.match(/^Grade(\d+)(?:_(5))?$/i);
      if (m && +v > 0) grades[m[2] ? `${m[1]}.5` : m[1]] = +v;
    }
    return Object.keys(grades).length ? { source: 'PSA (official)', graders: { PSA: grades }, total: +p.Total || null, description: j.Description || '' } : null;
  }

  const FETCHERS = { ebay, pricecharting, '130point': point130 };

  // Pages for "Open ↗" and the mini views.
  function pageUrl(id, query, cfg, parts, settings) {
    if (id === 'ebay') return ebaySearchUrl(cfg, parts, settings);
    if (id === 'pricecharting') return fill(cfg.url, cardOnly(parts) || query);
    if (id === 'collectr') return fill(cfg.url, parts.name || query);
    if (id === 'alt') return fill(cfg.url, root.GCP.coreName(parts) || query);
    if (id === 'cardladder') return fill(cfg.url, [cardOnly(parts), gradeLabel(parts)].join(' '));
    // 130point: the page reads this hash, runs the search and hands the results to the panel.
    if (id === '130point') return cfg.url + '#gcpq=' + encodeURIComponent([cardOnly(parts), gradeLabel(parts)].join(' '));
    return cfg.url;
  }

  root.GCPPlatforms = { psaCertImages, parsePriceChartingInfo, migrateSettings, LOGIN_SOURCES, pageCurrency, SECRET_KEYS, getRates, toCAD, ebayViaApi, CERT_PAGES, certToQuery, psaCertViaApi, DEFAULTS, META, FETCHERS, JUNK_RE, fill, pageUrl, ebayQuery, parseEbay, parsePriceCharting, parse130, pickPriceChartingProduct };
})(globalThis);
