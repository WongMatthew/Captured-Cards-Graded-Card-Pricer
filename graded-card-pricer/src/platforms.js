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
      cardladder: { enabled: true, url: 'https://app.cardladder.com/sales-history?q={q}' },
      ppt: { enabled: true, url: 'https://www.pokemonpricetracker.com' },
      terapeak: { enabled: true, url: 'https://www.ebay.ca/sh/research?marketplace=EBAY-CA&keywords={q}&dayRange=365&tabName=SOLD&limit=50&offset=0' },
      snkrdunk: { enabled: true, url: 'https://snkrdunk.com/search?keywords={q}' }
    }
  };
  // Settings saved by older versions pointed eBay at eBay.com (US$). Move them to eBay.ca.
  function migrateSettings(cfg) {
    const e = cfg.platforms && cfg.platforms.ebay;
    if (e && /\/\/www\.ebay\.com\//.test(e.url)) e.url = DEFAULTS.platforms.ebay.url;
    return cfg;
  }
  // Secrets live in chrome.storage.local (this computer only), not in synced settings.
  const SECRET_KEYS = ['psaApiKey', 'ebayAppId', 'ebayCertId', 'pptApiKey'];

  const META = {
    ebay: { name: 'eBay.ca', short: 'eB', color: '#3b82f6', mode: 'fetch', cur: 'CAD', note: 'Sold & completed listings, in CAD' },
    pricecharting: { name: 'PriceCharting', short: 'PC', color: '#16a34a', mode: 'fetch', cur: 'USD', note: 'Completed sales by grade' },
    '130point': { name: '130point', short: '130', color: '#f59e0b', mode: 'fetch', cur: 'USD', note: 'eBay sales incl. real best-offer prices' },
    alt: { name: 'Alt', short: 'Alt', color: '#a855f7', mode: 'embed', cur: 'USD', note: 'Sold history (sign in to Alt)' },
    collectr: { name: 'Collectr', short: 'Co', color: '#ec4899', mode: 'embed', cur: 'USD', note: 'Market price per grade (set Collectr to CAD)' },
    snkrdunk: { name: 'SNKRDUNK', short: 'SD', color: '#111827', mode: 'embed', cur: 'JPY', note: 'Japan marketplace sales history (¥ → CAD)' },
    ppt: { name: 'Pokemon Price Tracker', short: 'PPT', color: '#f97316', mode: 'fetch', cur: 'USD', note: 'eBay graded-sales database (API key)' },
    terapeak: { name: 'Terapeak', short: 'TP', color: '#0064d2', mode: 'embed', cur: 'CAD', note: 'eBay’s own sold data, incl. accepted best offers (sign in to eBay)' },
    cardladder: { name: 'Card Ladder', short: 'CL', color: '#0ea5e9', mode: 'embed', cur: 'USD', note: 'Sales history (sign in to Card Ladder)' }
  };
  // Sources that need your own login: they're read from a real window you're signed into.
  const LOGIN_SOURCES = ['terapeak', 'alt', 'collectr', 'cardladder'];

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
  // Core words to search with: the Pokémon / trainer name and card type ("Gengar EX", "Luigi Pikachu", "Umbreon VMAX").
  // Set names, edition and language are left out of the search (sellers word them differently) and checked locally.
  const TYPE_WORDS = /^(ex|gx|v|vmax|vstar|lv\.x|break|prime|star|δ|delta|illustrator)$/i;
  function searchCore(parts) {
    const words = parts.name.split(/\s+/).filter(Boolean);
    const lower = words.map(w => w.toLowerCase());
    const i = lower.indexOf((parts.keyWord || '').toLowerCase());
    if (i < 0) return root.GCP.coreName({ ...parts, number: '' });
    const keep = [];
    // the word right before the name is often part of it ("Luigi Pikachu", "Dark Charizard", "Rocket's Mewtwo")
    if (i > 0 && /^[a-z'’.-]{3,}$/i.test(words[i - 1]) && !root.GCP.VARIANTS_WORDS.has(lower[i - 1])) keep.push(words[i - 1]);
    keep.push(words[i]);
    for (const w of words.slice(i + 1)) if (TYPE_WORDS.test(w)) keep.push(w);
    for (const w of words) if (TYPE_WORDS.test(w) && !keep.includes(w)) keep.push(w);
    return keep.join(' ');
  }
  // "90" → ["90", "090"] (titles write it both ways). Letter-prefixed numbers (TG23) stay as they are.
  function numberForms(parts) {
    const k = parts.numberKey;
    if (!k) return [];
    const full = /\//.test(parts.number || '') ? [parts.number.replace(/\s+/g, '')] : [];
    if (!/^\d+$/.test(k)) return [k, ...full];
    return [...new Set([k, k.padStart(3, '0'), ...full])];
  }
  function ebayQuery(parts) {
    const ex = ['-lot', '-proxy', '-custom', '-repack', '-digital'];
    if (parts.grader === 'BGS' && parts.qual !== 'BL') ex.push('-"black label"');
    if (parts.grader !== 'PSA' && parts.qual !== 'PRISTINE') ex.push('-pristine');
    const nums = numberForms(parts);
    const num = nums.length > 1 ? `(${nums.join(',')})` : nums[0] || '';
    return [searchCore(parts), num, gradeLabel(parts), ...ex].filter(Boolean).join(' ');
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
  const SCOPE_BASIC = 'https://api.ebay.com/oauth/api_scope';
  // App token for the standard (public data) scope: used for current listings (Browse API).
  async function ebayBasicToken(appId, certId) {
    const key = 'ebayTokenBasic';
    const cached = (await chrome.storage.session.get(key))[key];
    if (cached && cached.app === appId && cached.exp > Date.now() + 60000) return cached.token;
    const res = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
      method: 'POST', credentials: 'omit',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ' + btoa(appId.trim() + ':' + certId.trim()) },
      body: new URLSearchParams({ grant_type: 'client_credentials', scope: SCOPE_BASIC })
    });
    if (!res.ok) {
      let err = {};
      try { err = await res.json(); } catch (e) { /* not JSON */ }
      if (err.error === 'invalid_client') throw new Error('eBay says the App ID / Cert ID are wrong. Use the Production keyset (App ID has “-PRD-”), and copy the Cert ID again.');
      throw new Error(`eBay refused the keys (${err.error || 'HTTP ' + res.status})`);
    }
    const j = await res.json();
    await chrome.storage.session.set({ [key]: { app: appId, token: j.access_token, exp: Date.now() + (j.expires_in || 7200) * 1000 } });
    return j.access_token;
  }

  async function ebayToken(appId, certId) {
    const { ebayToken: cached } = await chrome.storage.session.get('ebayToken');
    if (cached && cached.app === appId && cached.exp > Date.now() + 60000) return cached.token;
    const res = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
      method: 'POST', credentials: 'omit',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ' + btoa(appId.trim() + ':' + certId.trim()) },
      body: new URLSearchParams({ grant_type: 'client_credentials', scope: 'https://api.ebay.com/oauth/api_scope/buy.marketplace.insights' })
    });
    if (!res.ok) {
      let err = {};
      try { err = await res.json(); } catch (e) { /* not JSON */ }
      if (err.error === 'invalid_scope') {
        // Keys may be fine: check them against the basic scope to tell the two problems apart.
        const basic = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
          method: 'POST', credentials: 'omit',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ' + btoa(appId.trim() + ':' + certId.trim()) },
          body: new URLSearchParams({ grant_type: 'client_credentials', scope: 'https://api.ebay.com/oauth/api_scope' })
        }).catch(() => null);
        if (basic && basic.ok) {
          // Remember for a day so searches don't keep asking (eBay has closed new access to this API).
          await chrome.storage.local.set({ ebayInsightsDenied: { app: appId, at: Date.now() } });
          throw Object.assign(new Error('Your eBay keys work (current listings ✓), but sold-items access (Marketplace Insights) isn’t granted.'), { keysOk: true });
        }
      }
      if (err.error === 'invalid_client') throw new Error('eBay says the App ID / Cert ID are wrong. Use the Production keyset (App ID has “-PRD-”), and copy the Cert ID again.');
      throw new Error(`eBay refused the keys (${err.error || 'HTTP ' + res.status}${err.error_description ? ': ' + err.error_description : ''})`);
    }
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
    const { ebayInsightsDenied: denied } = await chrome.storage.local.get('ebayInsightsDenied');
    const skipApi = denied && denied.app === keys.ebayAppId && Date.now() - denied.at < 24 * 3600e3;
    if (keys.ebayAppId && keys.ebayCertId && !skipApi) {
      try { return { url, sales: await ebayViaApi(parts, keys), via: 'eBay API' }; }
      catch (e) { if (!e.keysOk) apiError = e.message; }
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

  // ---------------------------------------------------------------- Pokemon Price Tracker API
  // https://www.pokemonpricetracker.com/docs — eBay graded sales per card: per-grade summary on every paid plan,
  // individual sold listings (ebay.soldListings) on the Business plan.
  const PPT_BASE = 'https://www.pokemonpricetracker.com/api/v2';
  async function pptGet(path, key) {
    const res = await fetch(PPT_BASE + path, { credentials: 'omit', headers: { Authorization: 'Bearer ' + String(key).trim(), Accept: 'application/json' } });
    if (res.status === 401 || res.status === 403) throw new Error('Pokemon Price Tracker rejected the API key (Settings)');
    if (res.status === 429) throw new Error('Pokemon Price Tracker daily credit limit reached');
    if (!res.ok) throw new Error('Pokemon Price Tracker HTTP ' + res.status);
    return { json: await res.json(), remaining: res.headers.get('X-RateLimit-Daily-Remaining') };
  }
  // psa10, psa9, bgs9_5, cgc9_5 …
  const pptGradeKey = (parts) => parts.grader ? parts.grader.toLowerCase() + String(parts.grade).replace('.', '_') : '';

  function pptScore(c, parts) {
    let s = 0;
    const num = String(c.cardNumber || '').replace(/^0+/, '').split('/')[0];
    if (parts.numberKey) { if (num === parts.numberKey) s += 10; else return -1; }
    if (parts.totalKey && String(c.totalSetNumber || '').replace(/^0+/, '') === parts.totalKey) s += 3;
    const hay = `${c.name} ${c.setName} ${(c.printingsAvailable || []).join(' ')}`.toLowerCase();
    for (const w of parts.name.toLowerCase().split(/\s+/)) if (w.length > 2 && hay.includes(w)) s += 1;
    if (parts.keyWord && !String(c.name).toLowerCase().includes(parts.keyWord.toLowerCase())) s -= 6;
    return s;
  }

  async function pptFind(parts, key) {
    const wantJp = (parts.variants || []).includes('Japanese');
    const q = [searchCore(parts), parts.number || parts.numberKey].filter(Boolean).join(' ');
    let best = null;
    for (const lang of wantJp ? ['japanese', 'english'] : ['english', 'japanese']) {
      const { json } = await pptGet(`/cards?search=${encodeURIComponent(q)}&language=${lang}&limit=8`, key);
      for (const c of json.data || []) {
        const sc = pptScore(c, parts);
        if (sc > 0 && (!best || sc > best.sc)) best = { c, sc, lang };
      }
      if (best && best.sc >= 10) break;
    }
    return best;
  }

  async function pricetracker(query, cfg, parts, ctx = {}) {
    const key = ctx.secrets && ctx.secrets.pptApiKey;
    if (!key) throw Object.assign(new Error('Add your Pokemon Price Tracker API key in Settings'), { needsKey: true });
    const hit = await pptFind(parts, key);
    if (!hit) return { url: cfg.url, sales: [], note: 'This card isn’t in Pokemon Price Tracker’s database.' };
    const { json, remaining } = await pptGet(`/cards/${encodeURIComponent(hit.c.tcgPlayerId || hit.c.id)}?includeEbay=true&language=${hit.lang}`, key);
    const card = Array.isArray(json.data) ? json.data[0] : json.data;
    const eb = (card && card.ebay) || {};
    // 1st Edition (or another printing) has its own sales pool when it isn't the card's main printing.
    let pool = eb, printing = (card.prices && card.prices.primaryPrinting) || '';
    const want1st = (parts.variants || []).includes('1st Edition');
    if (want1st !== /1st/i.test(printing) && eb.salesByPrinting) {
      const k = Object.keys(eb.salesByPrinting).find(n => /1st/i.test(n) === want1st);
      if (k) { pool = eb.salesByPrinting[k]; printing = k; }
    }
    const gk = pptGradeKey(parts);
    let grade = (pool.salesByGrade || {})[gk] || null;
    if (grade && parts.qual === 'BL') grade = (grade.labels || {}).blackLabel || null;
    if (grade && parts.qual === 'PRISTINE') grade = (grade.labels || {}).pristine || null;
    const listings = ((pool.soldListings || {})[gk] || []).filter(l =>
      parts.qual === 'BL' ? /black/i.test(l.gradeLabel || l.title) : parts.qual === 'PRISTINE' ? /pristine/i.test(l.gradeLabel || l.title) : true);
    const sales = listings.map(l => ({
      price: +l.price, cur: l.currency || 'USD', date: new Date(l.soldDate), exact: true, title: l.title || '', url: l.url || '',
      itemId: /^\d{9,}$/.test(String(l.listingId || '')) ? String(l.listingId) : null,
      bestOffer: !!l.bestOfferAccepted, auction: l.listingType === 'auction', via: l.source && !/ebay/i.test(l.source) ? l.source : undefined
    })).filter(x => x.price && !isNaN(x.date));
    return {
      url: card.tcgPlayerUrl || cfg.url,
      product: `${card.name} · ${card.setName}${card.cardNumber ? ' #' + card.cardNumber : ''}${printing ? ' · ' + printing : ''}`,
      sales,
      summary: grade ? {
        count: grade.count, median: grade.medianPrice, average: grade.averagePrice, min: grade.minPrice, max: grade.maxPrice,
        market7: grade.marketPrice7Day, trend: grade.marketTrend, lastSale: grade.lastSaleDate,
        smart: grade.smartMarketPrice && grade.smartMarketPrice.price, confidence: grade.smartMarketPrice && grade.smartMarketPrice.confidence, cur: 'USD'
      } : null,
      individual: !!pool.soldListings,
      image: card.imageCdnUrl400 || card.imageUrl || '',
      remaining
    };
  }

  // ---------------------------------------------------------------- current listings (lowest asks)
  // eBay's Browse API (standard scope, works with any production keys), else eBay.ca's Buy It Now search page.
  // Returns [{price, cur, ship, title, url, itemId, img, buyingOptions}] — fixed-price listings only.
  async function ebayAsks(parts, cfg, keys) {
    const q = [searchCore(parts), (numberForms(parts)[0] || ''), gradeLabel(parts)].filter(Boolean).join(' ');
    if (keys && keys.ebayAppId && keys.ebayCertId) {
      const token = await ebayBasicToken(keys.ebayAppId, keys.ebayCertId);
      const out = [];
      // Each number form separately (Browse search has no OR), newest results merged by item id.
      const forms = numberForms(parts).length ? numberForms(parts) : [''];
      const seen = new Set();
      for (const f of forms.slice(0, 3)) {
        const qq = [searchCore(parts), f, gradeLabel(parts)].filter(Boolean).join(' ');
        const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(qq)}&limit=200&filter=${encodeURIComponent('buyingOptions:{FIXED_PRICE|BEST_OFFER}')}`;
        const res = await fetch(url, { credentials: 'omit', headers: { Authorization: 'Bearer ' + token, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_CA', 'Accept-Language': 'en-CA' } });
        if (!res.ok) throw new Error('eBay listings API HTTP ' + res.status);
        const j = await res.json();
        for (const it of j.itemSummaries || []) {
          if (seen.has(it.itemId)) continue;
          seen.add(it.itemId);
          const p = it.price || {};
          const sh = (it.shippingOptions || [])[0];
          out.push({
            price: parseFloat(p.value), cur: p.currency || 'CAD',
            ship: sh && sh.shippingCost ? parseFloat(sh.shippingCost.value) : null,
            title: it.title || '', url: it.itemWebUrl || '', itemId: (String(it.itemId || '').split('|')[1]) || null,
            img: (it.image && it.image.imageUrl) || '', buyingOptions: it.buyingOptions || []
          });
        }
      }
      return { via: 'eBay API', asks: out.filter(a => a.price) };
    }
    // No keys: eBay.ca Buy It Now results, cheapest first (price + shipping).
    const url = `https://www.ebay.ca/sch/i.html?_nkw=${enc(ebayQuery(parts))}&LH_BIN=1&_sop=15&_ipg=120`;
    const { html } = await getText(url);
    return { via: 'eBay.ca', url, asks: parseEbayActive(toDoc(html)) };
  }

  function parseEbayActive(doc) {
    const out = [];
    for (const el of doc.querySelectorAll('ul.srp-results > li, li.s-item, li.s-card')) {
      const text = txt(el);
      if (/srp-river-answer--REWRITE_START/.test(el.className || '') || /results matching fewer words/i.test(text) && text.length < 200) break;
      if (!text || /shop on ebay/i.test(text) && text.length < 120 || /\bSold\s+[A-Z0-9]/.test(text)) continue;
      const priceText = txt(el.querySelector('.s-item__price, .s-card__price')) || '';
      if (!priceText || /\bto\b/.test(priceText)) continue;
      const m = root.GCP.parseMoney(priceText);
      if (!m) continue;
      const shipM = text.match(/\+\s*(?:C\s?)?\$\s?([\d,]+(?:\.\d{2})?)\s*(?:shipping|delivery)/i);
      const a = el.querySelector('a[href*="/itm/"]');
      const href = a ? a.href.split('?')[0] : '';
      const img = el.querySelector('img');
      out.push({
        price: m.amount, cur: m.cur || 'CAD', ship: /free (shipping|delivery)/i.test(text) ? 0 : shipM ? parseFloat(shipM[1].replace(/,/g, '')) : null,
        title: (txt(el.querySelector('.s-item__title, .s-card__title, [role="heading"]')) || '').replace(/^New Listing\s*/i, ''),
        url: href, itemId: (href.match(/\/itm\/(?:[^/]+\/)?(\d{9,})/) || [])[1] || null,
        img: img ? (img.getAttribute('src') || '') : '', buyingOptions: /\bbids?\b/i.test(text) ? ['AUCTION'] : ['FIXED_PRICE']
      });
    }
    return out.filter(x => !x.buyingOptions.includes('AUCTION'));
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
      // the right version: 1st Edition / Japanese / Shadowless pages when asked for, the plain page otherwise
      for (const [v, re] of Object.entries(root.GCP.VARIANTS)) {
        const inT = re.test(text.replace(/-/g, ' '));
        const inQ = (parts.variants || []).includes(v);
        if (inT && inQ) s += 3;
        if (inT && !inQ && !(parts.allowVariants || []).includes(v)) s -= 4;
      }
      const m = matchCard(text.replace(/-/g, ' '), { ...parts, numberKey: '', totalKey: '' });
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
    const url = fill(cfg.url, [searchCore(parts), parts.numberKey].filter(Boolean).join(' ') || query);
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
    const body = new URLSearchParams({ query: [searchCore(parts), parts.numberKey, gradeLabel(parts)].filter(Boolean).join(' '), type: '2', subcat: '-1' });
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

  // Read a PSA / CGC cert page directly (no tab). Works when the site serves the page to the browser normally;
  // if it asks for a security check this throws {blocked:true}.
  async function certViaWeb(grader, cert) {
    const make = CERT_PAGES[grader];
    if (!make || !['PSA', 'CGC'].includes(grader)) throw Object.assign(new Error(`${grader} cert lookup needs its website`), { blocked: true });
    let html;
    try { ({ html } = await getText(make(cert))); }
    catch (e) { throw Object.assign(e, { blocked: true }); }
    if (/security verification|checking your browser|cf-challenge|just a moment/i.test(html.slice(0, 20000))) throw Object.assign(new Error(`${grader} asked for a security check`), { blocked: true });
    const info = parseCertHtml(html, grader, cert);
    if (!info.subject || !info.gradeText) throw Object.assign(new Error(`Couldn’t read the card from ${grader}’s page`), { blocked: true });
    return { ...info, url: make(cert), query: certToQuery(info) };
  }
  // Label/value pairs on the page, or the same fields in embedded JSON.
  function parseCertHtml(html, grader, cert) {
    const doc = toDoc(html);
    const LABELS = {
      subject: ['subject', 'card name', 'player', 'name'], brand: ['brand/title', 'brand', 'card set', 'set', 'title'], year: ['year'],
      cardNumber: ['card number', 'card #', 'card no.', 'number'], variety: ['variety/pedigree', 'variety', 'variant'],
      gradeText: ['item grade', 'grade', 'card grade'], language: ['language'], pop: ['psa population', 'population'],
      popHigher: ['psa pop higher', 'pop higher', 'population higher']
    };
    const info = { grader, cert };
    const els = [...doc.querySelectorAll('dt, th, td, div, span, p, label, h3, h4, strong')].filter(e => e.childElementCount <= 1);
    for (const [key, names] of Object.entries(LABELS)) {
      for (const e of els) {
        const t = txt(e).toLowerCase().replace(/:$/, '');
        if (!names.includes(t)) continue;
        let n = e.nextElementSibling;
        const v = n && txt(n) ? txt(n) : e.parentElement && e.parentElement.nextElementSibling ? txt(e.parentElement.nextElementSibling) : '';
        if (v && v.length < 120 && v.toLowerCase() !== t) { info[key] = v; break; }
      }
    }
    const J = { subject: 'Subject', brand: 'Brand', year: 'Year', cardNumber: 'CardNumber', variety: 'Variety', gradeText: 'CardGrade', pop: 'TotalPopulation', popHigher: 'PopulationHigher' };
    for (const [key, f] of Object.entries(J)) {
      if (info[key]) continue;
      const m = html.match(new RegExp('"' + f + '"\\s*:\\s*("([^"]*)"|\\d+)'));
      if (m) info[key] = m[2] != null ? m[2] : m[1];
    }
    return info;
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

  // ---------------------------------------------------------------- SNKRDUNK (Japan)
  // Search results are plain HTML. Titles look like "ゲンガーEX SR :1ED [XY4 090/088](拡張パック「ファントムゲート」)":
  // ":1ED" = 1st Edition, "【英語版】" = English version. Returns the best product, or null.
  function snkrdunkNumber(title) {
    const m = title.match(/\[(?:[A-Za-z0-9-]+\s+)?0*(\d{1,3})\s*(?:\/|\])/) || title.match(/\b0*(\d{1,3})\s*\/\s*\d{1,3}\b/);
    return m ? m[1] : '';
  }
  function snkrdunkScore(title, parts) {
    let s = 0;
    const want = (parts.numberKey || '').replace(/^0+/, '');
    const num = snkrdunkNumber(title);
    if (want) { if (num === want) s += 10; else if (num) return -1; }
    const first = /:1ED|1st/i.test(title), english = /英語版/.test(title);
    const wantFirst = (parts.variants || []).includes('1st Edition'), wantJp = (parts.variants || []).includes('Japanese');
    s += first === wantFirst ? 3 : -3;
    if (wantJp) s += english ? -5 : 3; else s += english ? 2 : 0;
    if (/未開封|パック|ボックス|BOX|スリーブ|デッキ/i.test(title)) s -= 8; // sealed product, sleeves, decks
    return s;
  }
  async function snkrdunkFind(parts, cfg) {
    // SNKRDUNK matches card numbers as written on the card ("090", not "90"): try padded, as typed, then name only.
    const core = searchCore(parts);
    const nk = parts.numberKey || '';
    const tries = [...new Set([
      /^\d+$/.test(nk) ? `${core} ${nk.padStart(3, '0')}` : '', parts.number ? `${core} ${parts.number}` : '', nk ? `${core} ${nk}` : '', core
    ].filter(Boolean))];
    for (const q of tries) {
      const url = fill(cfg.url, q);
      const { html } = await getText(url);
      const doc = toDoc(html);
      let best = null;
      const seen = new Set();
      for (const a of doc.querySelectorAll('a[href*="/apparels/"]')) {
        const id = ((a.getAttribute('href') || '').match(/\/apparels\/(\d+)\/?$/) || [])[1];
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const title = txt(a);
        const sc = snkrdunkScore(title, parts);
        if (sc > 0 && (!best || sc > best.sc)) best = { id, sc, title: title.replace(/^\d+\s*/, '').replace(/\s*(¥[\d,\s]+|出品待ち).*$/, '') };
      }
      if (best) return { ...best, searchUrl: url, url: `https://snkrdunk.com/apparels/${best.id}/sales-histories` };
    }
    return null;
  }

  const FETCHERS = { ppt: pricetracker, ebay, pricecharting, '130point': point130 };

  // Pages for "Open ↗" and the mini views.
  function pageUrl(id, query, cfg, parts, settings) {
    if (id === 'ebay') return ebaySearchUrl(cfg, parts, settings);
    if (id === 'pricecharting') return fill(cfg.url, [searchCore(parts), parts.numberKey].filter(Boolean).join(' ') || query);
    if (id === 'collectr') return fill(cfg.url, parts.name || query);
    if (id === 'alt') return fill(cfg.url, root.GCP.coreName(parts) || query);
    if (id === 'cardladder') return fill(cfg.url, [cardOnly(parts), gradeLabel(parts)].join(' '));
    if (id === 'terapeak') {
      const n = numberForms(parts);
      return fill(cfg.url, [searchCore(parts), n[1] || n[0] || '', gradeLabel(parts)].filter(Boolean).join(' '));
    }
    // 130point: the page reads this hash, runs the search and hands the results to the panel.
    if (id === '130point') return cfg.url + '#gcpq=' + encodeURIComponent([searchCore(parts), parts.numberKey, gradeLabel(parts)].filter(Boolean).join(' '));
    if (id === 'snkrdunk') return fill(cfg.url, [searchCore(parts), parts.number || parts.numberKey].filter(Boolean).join(' '));
    return cfg.url;
  }

  root.GCPPlatforms = { pricetracker, pptFind, pptGet, pptGradeKey, ebayAsks, parseEbayActive, ebayBasicToken, snkrdunkFind, snkrdunkScore, searchCore, numberForms, certViaWeb, parseCertHtml, psaCertImages, parsePriceChartingInfo, migrateSettings, LOGIN_SOURCES, pageCurrency, SECRET_KEYS, getRates, toCAD, ebayViaApi, CERT_PAGES, certToQuery, psaCertViaApi, DEFAULTS, META, FETCHERS, JUNK_RE, fill, pageUrl, ebayQuery, parseEbay, parsePriceCharting, parse130, pickPriceChartingProduct };
})(globalThis);
