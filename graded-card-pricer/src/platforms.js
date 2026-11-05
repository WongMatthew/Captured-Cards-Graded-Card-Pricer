// Marketplace adapters. Each returns { sales: [{price, date, title, url, itemId, img, bestOffer}], url, marketPrice? }.
(function (root) {
  const { parsePrice, parseDate } = root.GCP;

  const DEFAULTS = {
    autoScan: true,
    autoSearch: true,
    trimOutliers: true,
    platforms: {
      ebay: { enabled: true, url: 'https://www.ebay.com/sch/i.html?_nkw={q}&LH_Sold=1&LH_Complete=1&_sop=13&_ipg=120' },
      pricecharting: { enabled: true, url: 'https://www.pricecharting.com/search-products?q={q}&type=prices' },
      '130point': { enabled: true, url: 'https://130point.com/sales/' },
      alt: { enabled: true, url: 'https://alt.xyz/browse?query={q}' },
      collectr: { enabled: true, url: 'https://app.getcollectr.com/?query={q}' }
    }
  };

  const META = {
    ebay: { name: 'eBay', short: 'eB', color: '#3b82f6', mode: 'fetch', note: 'Sold & completed listings' },
    pricecharting: { name: 'PriceCharting', short: 'PC', color: '#16a34a', mode: 'fetch', note: 'Completed sales by grade' },
    '130point': { name: '130point', short: '130', color: '#f59e0b', mode: 'fetch', note: 'eBay sales incl. accepted best offers' },
    alt: { name: 'Alt', short: 'Alt', color: '#a855f7', mode: 'embed', note: 'Live mini view · prices read from page' },
    collectr: { name: 'Collectr', short: 'Co', color: '#ec4899', mode: 'embed', note: 'Live mini view · prices read from page' }
  };

  const JUNK_RE = /\b(lot of|lots|proxy|custom|replica|repack|mystery|you pick|choose|u pick|digital|code card|reprint|fan art|sticker|empty|case only|slab only)\b/i;

  function fill(tpl, q) { return tpl.replace('{q}', encodeURIComponent(q).replace(/%20/g, '+')); }

  async function getText(url, init = {}, timeout = 20000) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeout);
    try {
      const res = await fetch(url, { credentials: 'include', ...init, signal: ctl.signal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return { html: await res.text(), finalUrl: res.url };
    } finally { clearTimeout(t); }
  }

  const toDoc = (html) => new DOMParser().parseFromString(html, 'text/html');
  const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');

  // ---------- eBay ----------
  function parseEbay(doc, now = new Date()) {
    const items = new Set(doc.querySelectorAll('ul.srp-results > li, li.s-item, li.s-card'));
    const out = [];
    for (const el of items) {
      const text = txt(el);
      if (!text || /shop on ebay/i.test(text)) continue;
      const soldM = text.match(/Sold\s+((?:[A-Z][a-z]{2,8}\.?\s+\d{1,2},?\s+\d{4})|(?:\d{1,2}\s+[A-Z][a-z]{2,8}\.?\s+\d{4}))/);
      if (!soldM) continue;
      const date = parseDate(soldM[1], now);
      const priceEl = el.querySelector('.s-item__price, .s-card__price, [class*="price"]');
      const priceText = txt(priceEl) || text;
      if (/\bto\b/.test(priceText) && (priceText.match(/\$/g) || []).length > 1) continue; // price ranges
      const price = parsePrice(priceText);
      if (!price || !date) continue;
      let title = txt(el.querySelector('.s-item__title, .s-card__title, [role="heading"], h3')) ||
        (el.querySelector('img') || {}).alt || '';
      title = title.replace(/^New Listing\s*/i, '').replace(/Opens in a new window or tab$/i, '').trim();
      const a = el.querySelector('a[href*="/itm/"]');
      const url = a ? a.href.split('?')[0] : '';
      const idM = url.match(/\/itm\/(?:[^/]+\/)?(\d{9,})/);
      const img = el.querySelector('img');
      out.push({
        price, date, title, url, itemId: idM ? idM[1] : null,
        img: img ? (img.getAttribute('src') || img.getAttribute('data-src') || '') : '',
        bestOffer: /best offer accepted/i.test(text)
      });
    }
    return out;
  }

  async function ebay(query, cfg) {
    const url = fill(cfg.url, query);
    const { html } = await getText(url);
    const doc = toDoc(html);
    if (/captcha|pardon our interruption|security measure/i.test(txt(doc.querySelector('title')) + txt(doc.querySelector('h1'))))
      throw new Error('eBay is asking for a captcha. Open eBay in a tab once, then retry.');
    return { url, sales: parseEbay(doc) };
  }

  // ---------- PriceCharting ----------
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
      const title = txt(a || tr.querySelector('td.title')).replace(/\[(eBay|TCGPlayer)\]/gi, '').trim();
      if (!date || !price) continue;
      const ebayId = (id.match(/^ebay-(\d+)/) || [])[1] || null;
      out.push({ price, date, title, url: a ? a.href : '', itemId: ebayId });
    }
    return out;
  }

  async function pricecharting(query, cfg, parts) {
    // PriceCharting groups all grades on one product page, so search for the card only.
    const cardQ = (parts.name + ' ' + (parts.number || '')).trim() || query;
    const url = fill(cfg.url, cardQ);
    let { html, finalUrl } = await getText(url);
    let doc = toDoc(html);
    let productUrl = finalUrl;
    if (!/\/game\//.test(finalUrl)) {
      const links = [...doc.querySelectorAll('#games_table td.title a, table#games_table a[href*="/game/"], a[href*="/game/pokemon"]')];
      if (!links.length) return { url, sales: [] };
      const tokens = cardQ.toLowerCase().split(/\s+/).filter(t => t.length > 1);
      const scored = links.map(a => {
        const t = (txt(a) + ' ' + a.getAttribute('href')).toLowerCase();
        return { a, s: tokens.filter(k => t.includes(k.replace('/', '-')) || t.includes(k)).length - (/1st|shadowless/.test(t) && !/1st|shadowless/i.test(cardQ) ? 1 : 0) };
      }).sort((x, y) => y.s - x.s);
      productUrl = new URL(scored[0].a.getAttribute('href'), 'https://www.pricecharting.com').href;
      doc = toDoc((await getText(productUrl)).html);
    }
    const product = txt(doc.querySelector('h1#product_name, h1'));
    return { url: productUrl, product, sales: parsePriceCharting(doc) };
  }

  // ---------- 130point ----------
  function parse130(doc) {
    const out = [];
    for (const tr of doc.querySelectorAll('tr')) {
      const text = txt(tr);
      if (text.length < 10) continue;
      const date = parseDate((text.match(/Date:?\s*([^|]{6,40}?\d{4})/i) || [])[1] || text);
      const sale = text.match(/(?:Sale|Sold|Final)\s*Price:?\s*(?:US)?\$\s?[\d,]+(?:\.\d{1,2})?/i);
      const price = parsePrice(sale ? sale[0] : (tr.getAttribute('data-price') ? '$' + tr.getAttribute('data-price') : text));
      if (!date || !price) continue;
      const a = tr.querySelector('a[href*="ebay"], a');
      const href = a ? a.getAttribute('href') || '' : '';
      const idM = href.match(/(?:\/itm\/|item=)(\d{9,})/);
      out.push({ price, date, title: txt(a) || text.slice(0, 140), url: href, itemId: idM ? idM[1] : null, bestOffer: /best offer/i.test(text) });
    }
    return out;
  }

  async function point130(query, cfg) {
    const body = new URLSearchParams({ query, type: '2', subcat: '-1' });
    const { html } = await getText('https://back.130point.com/sales/', {
      method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' }
    });
    return { url: cfg.url, sales: parse130(toDoc(html)) };
  }

  const FETCHERS = { ebay, pricecharting, '130point': point130 };

  function embedUrl(id, query, cfg, parts) {
    if (id === 'pricecharting' || id === 'collectr') return fill(cfg.url, (parts.name + ' ' + (parts.number || '')).trim());
    if (id === '130point') return cfg.url;
    return fill(cfg.url, query);
  }

  root.GCPPlatforms = { DEFAULTS, META, FETCHERS, JUNK_RE, fill, embedUrl, parseEbay, parsePriceCharting, parse130 };
})(globalThis);
