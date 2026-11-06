// Marketplace adapters.
// Fetch adapters return { url, sales: [{price, date, title, url, itemId, img, bestOffer}], product? }.
(function (root) {
  const { parsePrice, parseDate, matchCard, gradeLabel } = root.GCP;

  const DEFAULTS = {
    autoScan: true,
    autoSearch: true,
    trimOutliers: true,
    pokemonOnly: true,
    excludeBestOffers: true,
    platforms: {
      ebay: { enabled: true, url: 'https://www.ebay.com/sch/i.html?_nkw={q}&LH_Sold=1&LH_Complete=1&_sop=13&_ipg=240&LH_PrefLoc=1' },
      pricecharting: { enabled: true, url: 'https://www.pricecharting.com/search-products?q={q}&type=prices' },
      '130point': { enabled: true, url: 'https://130point.com/sales/' },
      alt: { enabled: true, url: 'https://alt.xyz/browse?query={q}&category=POKEMON_CARDS' },
      collectr: { enabled: true, url: 'https://app.getcollectr.com/?query={q}' }
    }
  };

  const META = {
    ebay: { name: 'eBay', short: 'eB', color: '#3b82f6', mode: 'fetch', note: 'Sold & completed listings' },
    pricecharting: { name: 'PriceCharting', short: 'PC', color: '#16a34a', mode: 'fetch', note: 'Completed sales by grade' },
    '130point': { name: '130point', short: '130', color: '#f59e0b', mode: 'fetch', note: 'eBay sales incl. real best-offer prices' },
    alt: { name: 'Alt', short: 'Alt', color: '#a855f7', mode: 'embed', note: 'Sold history (sign in to Alt for full history)' },
    collectr: { name: 'Collectr', short: 'Co', color: '#ec4899', mode: 'embed', note: 'Graded market price (mobile view)' }
  };

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

  function parseEbay(doc) {
    const out = [];
    const list = doc.querySelectorAll('ul.srp-results > li, ul.srp-results > div > li');
    const items = list.length ? [...list] : [...doc.querySelectorAll('li.s-item, li.s-card')];
    for (const el of items) {
      const cls = el.className || '';
      const text = txt(el);
      // Everything after "Results matching fewer words" is a different card.
      if (/srp-river-answer--REWRITE_START/.test(cls) || /results matching fewer words/i.test(text) && text.length < 200) break;
      if (!text || /shop on ebay/i.test(text) && text.length < 120) continue;
      const soldM = text.match(/Sold\s+((?:[A-Z][a-z]{2,8}\.?\s+\d{1,2},?\s+\d{4})|(?:\d{1,2}\s+[A-Z][a-z]{2,8}\.?\s+\d{4}))/);
      if (!soldM) continue;
      const date = parseDate(soldM[1]);
      const priceEl = el.querySelector('.s-item__price, .s-card__price');
      const priceText = txt(priceEl) || text;
      if (/\bto\b/.test(priceText) && (priceText.match(/\$/g) || []).length > 1) continue;
      const price = parsePrice(priceText);
      if (!price || !date) continue;
      let title = txt(el.querySelector('.s-item__title, .s-card__title, [role="heading"], h3')) || (el.querySelector('img') || {}).alt || '';
      title = title.replace(/^New Listing\s*/i, '').replace(/Opens in a new window or tab$/i, '').trim();
      const a = el.querySelector('a[href*="/itm/"]');
      const url = a ? a.href.split('?')[0] : '';
      const idM = url.match(/\/itm\/(?:[^/]+\/)?(\d{9,})/);
      const img = el.querySelector('img');
      out.push({
        price, date, title, url, itemId: idM ? idM[1] : null,
        img: img ? (img.getAttribute('src') || img.getAttribute('data-src') || '').replace(/^data:.*/, '') : '',
        bestOffer: /best offer accepted/i.test(text),
        auction: /\bbids?\b/i.test(text)
      });
    }
    return out;
  }

  async function ebay(query, cfg, parts) {
    const url = fill(cfg.url, ebayQuery(parts));
    const { html } = await getText(url);
    const doc = toDoc(html);
    if (/captcha|pardon our interruption|security measure|verify yourself/i.test(txt(doc.querySelector('title')) + ' ' + txt(doc.querySelector('h1'))))
      throw new Error('eBay wants a captcha. Open eBay in a tab, solve it, then press Refresh.');
    return { url, sales: parseEbay(doc) };
  }

  // ---------------------------------------------------------------- PriceCharting
  function parsePriceCharting(doc) {
    const out = [];
    const seen = new Set();
    for (const tr of doc.querySelectorAll('tr')) {
      const dEl = tr.querySelector('td.date');
      if (!dEl) continue;
      const id = tr.id || '';
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      const date = parseDate(txt(dEl));
      const price = parsePrice(txt(tr.querySelector('.js-price, td.numeric')));
      const a = tr.querySelector('td.title a');
      const source = /\[TCGPlayer\]/i.test(txt(tr.querySelector('td.title'))) ? 'TCGPlayer' : 'eBay';
      const title = txt(a || tr.querySelector('td.title')).replace(/\[(eBay|TCGPlayer)\]/gi, '').trim();
      if (!date || !price) continue;
      const ebayId = (id.match(/^ebay-(\d+)/) || [])[1] || null;
      out.push({ price, date, title, url: a ? a.href : '', itemId: ebayId, via: source });
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

  async function pricecharting(query, cfg, parts) {
    const url = fill(cfg.url, cardOnly(parts) || query);
    let { html, finalUrl } = await getText(url);
    let doc = toDoc(html);
    let productUrl = finalUrl;
    if (!/\/game\//.test(finalUrl)) {
      productUrl = pickPriceChartingProduct(doc, parts);
      if (!productUrl) return { url, sales: [] };
      doc = toDoc((await getText(productUrl)).html);
    }
    const product = txt(doc.querySelector('h1#product_name')) || txt(doc.querySelector('h1'));
    return { url: productUrl, product, sales: parsePriceCharting(doc) };
  }

  // ---------------------------------------------------------------- 130point
  function parse130(doc) {
    const out = [];
    for (const tr of doc.querySelectorAll('tr')) {
      const text = txt(tr);
      if (text.length < 10 || tr.querySelector('tr')) continue;
      const dm = text.match(/Date:?\s*((?:[A-Z][a-z]{2}\s+)?\d{1,2}\s+[A-Z][a-z]{2}\s+\d{4}|[A-Z][a-z]{2}\s+\d{1,2},?\s+\d{4}|\d{4}-\d{2}-\d{2})/);
      const date = parseDate(dm ? dm[1] : text);
      const sale = text.match(/(?:Sale|Sold|Final|Best Offer)\s*Price:?\s*(?:US)?\$\s?[\d,]+(?:\.\d{1,2})?/i);
      const dataPrice = tr.getAttribute('data-price');
      const price = sale ? parsePrice(sale[0]) : dataPrice ? parseFloat(dataPrice) : parsePrice(text);
      if (!date || !price) continue;
      const a = tr.querySelector('a[href*="ebay"]') || tr.querySelector('a[href]');
      const href = a ? a.getAttribute('href') || '' : '';
      const idM = href.match(/(?:\/itm\/(?:[^/]+\/)?|item=)(\d{9,})/);
      const img = tr.querySelector('img');
      out.push({
        price, date, title: txt(a) || text.slice(0, 140), url: href, itemId: idM ? idM[1] : null,
        img: img ? img.getAttribute('src') || '' : '', bestOffer: /best offer/i.test(text), realBestOffer: /best offer/i.test(text)
      });
    }
    return out;
  }

  async function point130(query, cfg, parts) {
    const body = new URLSearchParams({ query: [cardOnly(parts), gradeLabel(parts)].join(' '), type: '2', subcat: '-1' });
    const { html } = await getText('https://back.130point.com/sales/', {
      method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' }
    });
    return { url: cfg.url, sales: parse130(toDoc(html)) };
  }

  const FETCHERS = { ebay, pricecharting, '130point': point130 };

  // Pages for "Open ↗" and the mini views.
  function pageUrl(id, query, cfg, parts) {
    if (id === 'ebay') return fill(cfg.url, ebayQuery(parts));
    if (id === 'pricecharting') return fill(cfg.url, cardOnly(parts) || query);
    if (id === 'collectr') return fill(cfg.url, parts.name || query);
    if (id === 'alt') return fill(cfg.url, root.GCP.coreName(parts) || query);
    return cfg.url;
  }

  root.GCPPlatforms = { DEFAULTS, META, FETCHERS, JUNK_RE, fill, pageUrl, ebayQuery, parseEbay, parsePriceCharting, parse130, pickPriceChartingProduct };
})(globalThis);
