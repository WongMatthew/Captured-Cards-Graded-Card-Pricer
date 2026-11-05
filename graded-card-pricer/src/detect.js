// Shared helpers: graded-card detection, price/date parsing, grade matching.
// Loaded in content scripts, the side panel and Node tests.
(function (root) {
  if (root.GCP) return;

  const GRADERS = {
    PSA: 'PSA', BGS: 'BGS', BECKETT: 'BGS', CGC: 'CGC', SGC: 'SGC', TAG: 'TAG', ACE: 'ACE', AGS: 'AGS'
  };
  const GRADE_WORDS = '(?:GEM\\s*(?:MINT|MT)\\s*|MINT\\s*|PRISTINE\\s*|BLACK\\s*LABEL\\s*|PERFECT\\s*|NM-?MT\\s*\\+?\\s*)?';
  const GRADE_NUM = '(10|9\\.5|9|8\\.5|8|7\\.5|7|6\\.5|6|5\\.5|5|4|3|2|1\\.5|1)(?!\\d|\\.\\d)';
  const GRADE_RE = new RegExp('\\b(PSA|BGS|BECKETT|CGC|SGC|TAG|ACE|AGS)\\s*[-:#]?\\s*' + GRADE_WORDS + GRADE_NUM, 'i');
  const GRADE_RE_G = new RegExp(GRADE_RE.source, 'gi');

  const CARD_NO_RE = /(?:#\s?)?\b((?:[A-Z]{1,4})?\d{1,3}\s?\/\s?(?:[A-Z]{1,4})?\d{1,3}|SWSH\d{2,3}|SM\d{2,3}|XY\d{2,3}|BW\d{2,3}|SVP?\s?\d{1,3}|TG\d{2}|GG\d{2}|RC\d{1,2})\b/i;

  const POKEMON_HINTS = [
    'pokemon', 'pokémon', 'holo', 'reverse holo', '1st edition', 'first edition', 'shadowless', 'base set', 'jungle', 'fossil',
    'team rocket', 'neo genesis', 'gym heroes', 'skyridge', 'aquapolis', 'evolving skies', 'hidden fates', 'shining fates',
    'crown zenith', 'celebrations', 'brilliant stars', 'lost origin', 'silver tempest', 'fusion strike', 'obsidian flames',
    'paldea', 'scarlet', 'violet', 'paradox rift', 'temporal forces', 'twilight masquerade', 'surging sparks', 'prismatic',
    'stellar crown', 'shrouded fable', 'destined rivals', 'journey together', 'black bolt', 'white flare', 'mega evolution',
    'full art', 'alt art', 'alternate art', 'special illustration', 'illustration rare', 'sir', 'secret rare', 'rainbow',
    'gold star', 'promo', 'japanese', 'trainer gallery', 'vmax', 'vstar', ' gx', ' ex', 'lv.x', 'prime', 'legend',
    'charizard', 'pikachu', 'umbreon', 'rayquaza', 'mewtwo', 'mew', 'lugia', 'gengar', 'eevee', 'espeon', 'sylveon',
    'gyarados', 'blastoise', 'venusaur', 'dragonite', 'giratina', 'greninja', 'lucario', 'snorlax', 'moonbreon', 'leafeon',
    'glaceon', 'vaporeon', 'jolteon', 'flareon', 'zapdos', 'moltres', 'articuno', 'ho-oh', 'celebi', 'tyranitar', 'gardevoir',
    'arceus', 'dialga', 'palkia', 'darkrai', 'zekrom', 'reshiram', 'kyogre', 'groudon', 'latias', 'latios', 'iono', 'lillie',
    'marnie', 'erika', 'misty', 'cynthia', 'n\'s', 'magikarp', 'bulbasaur', 'squirtle', 'charmander', 'ninetales', 'alakazam'
  ];

  const NOISE_RE = /\b(wts|wtb|wtt|fs|ft|ftf|obo|firm|shipped|shipping|ship|offer|offers|price|asking|selling|sell|buying|buy|sold|for sale|for trade|lot|dm|pm|paypal|g&s|f&f|venmo|zelle|re|fwd|fw|subject|order|confirmation|your|you|won|item|cert|cert#|graded|card|cards|tcg|mint condition|ending|soon|bid|bids|watch|listing|new|hi|hey|thanks|thank|i'd|i'm|i'll|i've|i|id|im|me|my|we|our|like|would|want|wanted|looking|interested|also|have|has|these|this|that|the|a|an|and|or|to|for|in|of|on|at|with|is|it|are|still|available|please|can|could|do|does|got|get)\b/gi;

  function cleanName(text) {
    return text
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/\S+@\S+/g, ' ')
      .replace(/[$€£]\s?\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s?(?:usd|dollars)/gi, ' ')
      .replace(GRADE_RE_G, ' ')
      .replace(NOISE_RE, ' ')
      .replace(/[^\p{L}\p{N}\s'\-./&é]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normGrader(g) { return GRADERS[String(g).toUpperCase()] || String(g).toUpperCase(); }

  function pokemonScore(text) {
    const t = ' ' + text.toLowerCase() + ' ';
    let s = 0;
    for (const h of POKEMON_HINTS) if (t.includes(h)) s += h.length > 6 ? 2 : 1;
    if (CARD_NO_RE.test(text)) s += 2;
    return s;
  }

  // Find graded-card mentions in a block of text (e.g. document.body.innerText).
  function detectCards(text, opts = {}) {
    const max = opts.max || 25;
    const lines = String(text || '').split(/\n+/).map(l => l.trim()).filter(Boolean);
    const pageIsPokemon = /pok[eé]mon/i.test(text);
    const found = new Map();
    for (let i = 0; i < lines.length && found.size < max; i++) {
      const line = lines[i];
      if (line.length > 400) continue;
      const re = new RegExp(GRADE_RE.source, 'gi');
      let m;
      while ((m = re.exec(line))) {
        const grader = normGrader(m[1]);
        const grade = m[2];
        let context = line;
        // Short lines like "PSA 10" alone: pull the previous line in for the card name.
        if (cleanName(line).split(' ').filter(Boolean).length < 2 && i > 0) context = lines[i - 1] + ' ' + line;
        const numMatch = context.match(CARD_NO_RE);
        const number = numMatch ? numMatch[1].replace(/\s+/g, '') : '';
        let name = cleanName(context.replace(CARD_NO_RE, ' '));
        name = name.split(' ').filter(w => w.length > 1 || /\d/.test(w)).slice(0, 8).join(' ');
        if (!name) continue;
        const score = pokemonScore(context) + (pageIsPokemon ? 1 : 0);
        if (opts.minScore != null && score < opts.minScore) continue;
        const query = [name, number, grader, grade].filter(Boolean).join(' ');
        const key = query.toLowerCase();
        if (!found.has(key)) found.set(key, { query, name, number, grader, grade, score, raw: line.slice(0, 200) });
      }
    }
    return [...found.values()].sort((a, b) => b.score - a.score);
  }

  // Parse a query like "Charizard 4/102 PSA 10" into its parts.
  function parseQuery(q) {
    const m = String(q).match(GRADE_RE);
    return m ? { grader: normGrader(m[1]), grade: m[2] } : { grader: '', grade: '' };
  }

  // Does a listing title match the requested grade? (PSA 9 must not match PSA 9.5 or PSA 10)
  function titleMatchesGrade(title, grader, grade) {
    if (!grader || !grade) return true;
    const names = grader === 'BGS' ? '(?:BGS|BECKETT)' : grader;
    const g = grade.replace('.', '\\.');
    const re = new RegExp('\\b' + names + '\\s*[-:#]?\\s*' + GRADE_WORDS + g + '(?!\\d|\\.\\d)', 'i');
    return re.test(title);
  }

  function parsePrice(s) {
    const m = String(s).replace(/ /g, ' ').match(/(?:US\s?)?\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/);
    return m ? parseFloat(m[1].replace(/,/g, '')) : null;
  }

  const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
  const MON = '(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\\.?';

  // Returns a Date (local midnight) or null. Understands most formats used by marketplaces.
  function parseDate(s, now = new Date()) {
    s = String(s || '').replace(/ /g, ' ');
    let m;
    const day = (y, mo, d) => { const dt = new Date(y, mo, d); return isNaN(dt) ? null : dt; };
    const fixYear = (dt) => {
      // Month-day without a year: assume the most recent such date.
      if (dt && dt > now) dt.setFullYear(dt.getFullYear() - 1);
      return dt;
    };
    if ((m = s.match(/\b(\d{4})-(\d{2})-(\d{2})\b/))) return day(+m[1], +m[2] - 1, +m[3]);
    if ((m = s.match(new RegExp('\\b' + MON + '\\s+(\\d{1,2}),?\\s+(\\d{4})', 'i')))) return day(+m[3], MONTHS[m[1].toLowerCase()], +m[2]);
    if ((m = s.match(new RegExp('\\b(\\d{1,2})\\s+' + MON + ',?\\s+(\\d{4})', 'i')))) return day(+m[3], MONTHS[m[2].toLowerCase()], +m[1]);
    if ((m = s.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/))) return day(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[1] - 1, +m[2]);
    if ((m = s.match(/\b(\d+)\s*(m|min|mins|minutes?|h|hr|hrs|hours?|d|days?|w|wk|weeks?)\s+ago\b/i))) {
      const n = +m[1], u = m[2][0].toLowerCase();
      const ms = u === 'm' ? n * 6e4 : u === 'h' ? n * 36e5 : u === 'd' ? n * 864e5 : n * 6048e5;
      const dt = new Date(now - ms); return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
    }
    if (/\btoday\b/i.test(s)) return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (/\byesterday\b/i.test(s)) return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    if ((m = s.match(new RegExp('\\b' + MON + '\\s+(\\d{1,2})\\b', 'i')))) return fixYear(day(now.getFullYear(), MONTHS[m[1].toLowerCase()], +m[2]));
    return null;
  }

  // Whole calendar days between sale date and today (0 = today).
  function daysAgo(date, now = new Date()) {
    const a = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const b = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    return Math.round((a - b) / 864e5);
  }

  function stats(prices) {
    if (!prices.length) return null;
    const s = [...prices].sort((a, b) => a - b);
    const sum = s.reduce((a, b) => a + b, 0);
    const mid = s.length >> 1;
    return {
      count: s.length, avg: sum / s.length,
      median: s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2,
      low: s[0], high: s[s.length - 1]
    };
  }

  // Drop extreme outliers (lots, mislabeled raw cards, best-offer artifacts) using median absolute deviation.
  function trimOutliers(sales) {
    if (sales.length < 4) return sales;
    const p = sales.map(x => x.price).sort((a, b) => a - b);
    const med = p[p.length >> 1];
    const mad = [...p.map(x => Math.abs(x - med))].sort((a, b) => a - b)[p.length >> 1] || med * 0.1;
    return sales.filter(x => Math.abs(x.price - med) <= 4 * mad * 1.4826 || Math.abs(x.price - med) <= med * 0.15);
  }

  const WINDOWS = [
    { key: '1d', label: 'Last 1 day', days: 1 },
    { key: '3d', label: 'Last 3 days', days: 3 },
    { key: '5d', label: 'Last 5 days', days: 5 },
    { key: '7d', label: 'Last week', days: 7 }
  ];

  // "Last N days" = sold within the past N×24h. Sale dates are day-precision,
  // so a sale dated N calendar days ago is included.
  function windowStats(sales, now = new Date()) {
    const out = {};
    for (const w of WINDOWS) {
      const inWin = sales.filter(s => s.date && daysAgo(s.date, now) <= w.days && daysAgo(s.date, now) >= 0);
      out[w.key] = stats(inWin.map(s => s.price));
    }
    return out;
  }

  root.GCP = {
    GRADE_RE, CARD_NO_RE, WINDOWS, detectCards, parseQuery, titleMatchesGrade, parsePrice, parseDate,
    daysAgo, stats, trimOutliers, windowStats, cleanName, pokemonScore
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.GCP;
})(typeof globalThis !== 'undefined' ? globalThis : this);
