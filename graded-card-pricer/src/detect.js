// Shared helpers: graded-card detection, card/grade matching, price/date parsing, stats.
// Loaded in content scripts, the side panel, the options page and Node tests.
(function (root) {
  if (root.GCP) return;

  // ---------------------------------------------------------------- grades
  const GRADERS = { PSA: 'PSA', BGS: 'BGS', BECKETT: 'BGS', CGC: 'CGC', SGC: 'SGC', TAG: 'TAG', ACE: 'ACE', AGS: 'AGS' };
  const GRADER_ALT = 'PSA|BGS|BECKETT|CGC|SGC|TAG|ACE|AGS';
  const QUAL = '(GEM\\s*(?:MINT|MT)|MINT|PRISTINE|BLACK\\s*LABEL|PERFECT|NM-?MT\\s*\\+?|EX-?MT)?';
  const NUM = '(10|9\\.5|9|8\\.5|8|7\\.5|7|6\\.5|6|5\\.5|5|4\\.5|4|3\\.5|3|2\\.5|2|1\\.5|1)(?!\\d|\\.\\d|%)';
  const GRADE_SRC = '\\b(' + GRADER_ALT + ')\\s*[-:#]?\\s*' + QUAL + '\\s*' + NUM;
  const GRADE_RE = new RegExp(GRADE_SRC, 'i');
  const gradeReG = () => new RegExp(GRADE_SRC, 'gi');
  // PSA slab label wording without the grader name, e.g. "... #215 UMBREON VMAX GEM MT 10".
  const PSA_LABEL_RE = /\b(GEM\s*MT)\s*(10)\b|\b(NM-MT|MINT)\s+(9|8)\b(?!\.\d)/i;

  const normGrader = (g) => GRADERS[String(g).toUpperCase()] || String(g).toUpperCase();
  function normQual(q, grader, grade) {
    q = String(q || '').toUpperCase().replace(/\s+/g, ' ');
    if (/BLACK/.test(q)) return 'BL';
    if (/PRISTINE/.test(q) || (grader === 'BGS' && /PRISTINE/.test(q))) return 'PRISTINE';
    if (grader === 'PSA' && /PERFECT/.test(q)) return '';
    return '';
  }

  // Every grade mention in a string: [{grader, grade, qual, index, end}]
  function findGrades(text) {
    const out = [];
    const re = gradeReG();
    let m;
    while ((m = re.exec(text))) {
      const grader = normGrader(m[1]);
      let qual = normQual(m[2], grader, m[3]);
      // "BGS 10 Black Label" / "CGC 10 Pristine" put the qualifier after the number.
      const after = text.slice(re.lastIndex, re.lastIndex + 16);
      if (!qual && /^\s*(black\s*label|\bBL\b)/i.test(after)) qual = 'BL';
      if (!qual && /^\s*pristine/i.test(after)) qual = 'PRISTINE';
      out.push({ grader, grade: m[3], qual, index: m.index, end: re.lastIndex });
    }
    return out;
  }

  const gradeLabel = (g) => !g || !g.grader ? '' : g.grader + (g.qual === 'BL' ? ' Black Label' : g.qual === 'PRISTINE' ? ' Pristine' : '') + ' ' + g.grade;

  // ---------------------------------------------------------------- card numbers
  // 4/102, 215/203, TG23/TG30, SWSH050, SVP 085, #215, No. 4
  const CARD_NO_RE = /(?:^|[\s(#])((?:[A-Z]{1,4})?\d{1,3}\s?\/\s?(?:[A-Z]{1,4})?\d{1,3}|SWSH\s?\d{2,3}|SM\s?\d{2,3}|XY\s?\d{2,3}|BW\s?\d{2,3}|SVP?\s?\d{1,3}|TG\d{2}|GG\d{2}|RC\d{1,2})(?=$|[\s),.;:!?])|#\s?(\d{1,3})\b|\bNo\.\s?(\d{1,3})\b/i;
  const CARD_NO_RE_G = new RegExp(CARD_NO_RE.source, 'gi');

  function extractNumber(text) {
    const m = String(text).match(CARD_NO_RE);
    if (!m) return '';
    return (m[1] || m[2] || m[3] || '').replace(/\s+/g, '').toUpperCase();
  }
  // Comparable key for a card number: "004/102" -> "4", "TG23/TG30" -> "TG23", "SWSH050" -> "SWSH50"
  function numberKey(n) {
    if (!n) return '';
    const first = String(n).toUpperCase().split('/')[0].replace(/\s+/g, '');
    const m = first.match(/^([A-Z]*)0*(\d+)$/);
    if (!m) return first;
    // Black Star promo prefixes aren't part of the number: "SVP 051" = "#051" = "051/SV-P". Gallery/subset prefixes are.
    if (/^(SVP|SVE|SV|SWSH|SM|XY|BW|DP|HGSS)$/.test(m[1])) return m[2];
    return m[1] + m[2];
  }
  // Set size after the slash: "090/088" → "88". Different set size = different set.
  function totalKeys(text) {
    const out = new Set();
    for (const m of String(text).matchAll(/\b[A-Z]{0,4}\d{1,3}\s?\/\s?[A-Z]{0,4}0*(\d{1,3})\b/gi)) out.add(m[1]);
    return out;
  }
  function allNumberKeys(text) {
    const keys = new Set();
    for (const m of String(text).matchAll(CARD_NO_RE_G)) keys.add(numberKey((m[1] || m[2] || m[3] || '').replace(/\s+/g, '')));
    keys.delete('');
    return keys;
  }

  // ---------------------------------------------------------------- name cleaning
  const POKEMON_HINTS = [
    'pokemon', 'pokémon', 'holo', 'reverse holo', '1st edition', 'first edition', 'shadowless', 'base set', 'jungle', 'fossil',
    'team rocket', 'neo genesis', 'neo discovery', 'neo revelation', 'neo destiny', 'gym heroes', 'gym challenge', 'skyridge', 'aquapolis',
    'expedition', 'evolving skies', 'hidden fates', 'shining fates', 'crown zenith', 'celebrations', 'brilliant stars', 'lost origin',
    'silver tempest', 'fusion strike', 'obsidian flames', 'paldea', 'scarlet', 'violet', 'paradox rift', 'temporal forces',
    'twilight masquerade', 'surging sparks', 'prismatic', 'stellar crown', 'shrouded fable', 'destined rivals', 'journey together',
    'black bolt', 'white flare', 'mega evolution', 'phantasmal', 'vivid voltage', 'chilling reign', 'astral radiance', 'cosmic eclipse',
    'unified minds', 'team up', 'burning shadows', 'full art', 'alt art', 'alternate art', 'special illustration', 'illustration rare',
    'secret rare', 'rainbow', 'gold star', 'promo', 'trainer gallery', 'vmax', 'vstar', 'gx', 'lv.x', 'charizard', 'pikachu',
    'umbreon', 'rayquaza', 'mewtwo', 'mew', 'lugia', 'gengar', 'eevee', 'espeon', 'sylveon', 'gyarados', 'blastoise', 'venusaur',
    'dragonite', 'giratina', 'greninja', 'lucario', 'snorlax', 'moonbreon', 'leafeon', 'glaceon', 'vaporeon', 'jolteon', 'flareon',
    'zapdos', 'moltres', 'articuno', 'ho-oh', 'celebi', 'tyranitar', 'gardevoir', 'arceus', 'dialga', 'palkia', 'darkrai', 'zekrom',
    'reshiram', 'kyogre', 'groudon', 'latias', 'latios', 'iono', 'lillie', 'marnie', 'erika', 'misty', 'cynthia', 'magikarp',
    'bulbasaur', 'squirtle', 'charmander', 'ninetales', 'alakazam', 'garchomp', 'chansey', 'scizor', 'mimikyu', 'pikachu', 'raichu',
    'typhlosion', 'feraligatr', 'meganium', 'suicune', 'entei', 'raikou', 'jirachi', 'deoxys', 'shaymin', 'zoroark', 'hydreigon',
    'terapagos', 'ogerpon', 'miraidon', 'koraidon', 'pecharunt', 'dragapult', 'ceruledge', 'armarouge', 'roaring moon'
  ];
  const STOP = new Set(('wts wtb wtt fs ft ftf obo firm shipped shipping ship offer offers price asking selling sell buying buy sold ' +
    'sale trade lot dm pm paypal venmo zelle re fwd fw subject order confirmation your you won item cert graded card cards tcg ' +
    'ending soon bid bids watch listing listed new hi hey hello thanks thank i\'d i\'m i\'ll i\'ve i id im me my we our like would ' +
    'want wanted looking interested also have has these this that the a an and or to for in of on at with is it are still ' +
    'available please can could do does got get just here there pokemon pokémon english eng nm mint gem mt condition total ' +
    'qty quantity each per usd dollars plus tax tracking delivered purchase purchased paid payment congrats congratulations ' +
    'from by via if any some what which who how much make let know see attached pics photos pic photo slab slabbed authentic ' +
    'psa bgs cgc sgc beckett tag ace ags grade grading population pop swsh game').split(' '));

  function cleanName(text) {
    const words = String(text)
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/\S+@\S+/g, ' ')
      .replace(/(?:US|C|CA|AU|A)?\s?[$€£]\s?\d[\d,]*(?:\.\d+)?k?|\d[\d,]*(?:\.\d+)?\s?(?:usd|dollars|bucks)/gi, ' ')
      .replace(gradeReG(), ' ')
      .replace(PSA_LABEL_RE, ' ')
      .replace(/\b(?:19[89]\d|20[0-3]\d)\b/g, ' ')        // years
      .replace(/\b\d{5,}\b/g, ' ')                        // cert / order numbers
      .replace(/\b(?:black\s*label|pristine|gem\s*mint|gem\s*mt)\b/gi, ' ')
      .replace(/\b(?:FA|SR|AR|SAR|SIR|IR|CHR|RR|UR|HR|AA|SA|TG)\s*\/\s*(?=[A-Za-z])/gi, ' ')   // PSA label prefixes: FA/SYLVEON VMAX
      .replace(/[^\p{L}\p{N}\s'\-./&]/gu, ' ')
      .split(/\s+/)
      .filter(Boolean);
    const kept = words.filter(w => {
      const lw = w.toLowerCase().replace(/^[-'./]+|[-'./]+$/g, '');
      if (!lw) return false;
      if (STOP.has(lw)) return false;
      if (lw.length < 2 && !/\d/.test(lw) && lw !== 'v') return false;
      return true;
    }).map(w => w.replace(/^[-'./]+|[-'./]+$/g, ''));
    return kept.join(' ').trim();
  }

  // "UMBREON VMAX" -> "Umbreon VMAX" (keeps short all-caps tokens like VMAX, GX, EX, SIR).
  function titleCase(name) {
    if (name !== name.toUpperCase()) return name;
    return name.split(' ').map(w => /^(VMAX|VSTAR|GX|EX|V|SIR|IR|SAR|AR|CHR|TG\d+|SWSH\d*|SVP?\d*|LV\.X)$/.test(w) || /\d/.test(w) ? w
      : w.charAt(0) + w.slice(1).toLowerCase()).join(' ');
  }

  function pokemonScore(text) {
    const t = ' ' + String(text).toLowerCase() + ' ';
    let s = 0;
    for (const h of POKEMON_HINTS) if (new RegExp('(^|[^a-z])' + h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z]|$)').test(t)) s += h.length > 6 ? 2 : 1;
    if (CARD_NO_RE.test(text)) s += 1;
    return s;
  }

  // ---------------------------------------------------------------- detection
  function priceNear(seg, at) {
    let best = null;
    const re = /(?:US\s?)?\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?\s*(k)?\b/gi;
    let m;
    while ((m = re.exec(seg))) {
      let v = parseFloat(m[1].replace(/,/g, '') + (m[2] ? '.' + m[2] : ''));
      if (m[3]) v *= 1000;
      const d = Math.abs(m.index - at);
      if (v >= 1 && (!best || d < best.d)) best = { v, d };
    }
    return best ? best.v : null;
  }

  function segmentsOf(text) {
    // Lines, then sentences. Keep "Lv.X", "No. 4", "Mr. Mime" intact by only splitting on ". " before an uppercase/quote.
    const out = [];
    for (const line of String(text || '').split(/\n+/)) {
      const l = line.trim();
      if (!l) continue;
      for (const s of l.split(/(?<!\b(?:No|Mr|Lv|vs|St|Jr))[.!?;•|]\s+(?=[A-Z"'(])/)) {
        const t = s.trim();
        if (t) out.push(t);
      }
    }
    return out;
  }

  function cardKey(c) {
    const words = c.name.toLowerCase().split(' ');
    const core = words.find(w => NAMES.has(w)) || words.filter(w => !/\d/.test(w)).slice(0, 2).join(' ');
    return [core, numberKey(c.number), c.grader, c.qual, c.grade].join('|');
  }

  // Find graded-card mentions in a block of text (e.g. an email body).
  function detectCards(text, opts = {}) {
    const max = opts.max || 25;
    const minScore = opts.minScore == null ? 1 : opts.minScore;
    const segs = segmentsOf(text);
    const pageBoost = /pok[eé]mon/i.test(text) ? 1 : 0;
    const found = new Map();
    for (let i = 0; i < segs.length && found.size < max; i++) {
      const seg = segs[i];
      let grades = findGrades(seg);
      if (!grades.length) {
        const lm = seg.match(PSA_LABEL_RE);
        if (lm && (extractNumber(seg) || /psa/i.test(text))) {
          grades = [{ grader: 'PSA', grade: lm[2] || lm[4], qual: '', index: lm.index, end: lm.index + lm[0].length }];
        }
      }
      grades.forEach((g, gi) => {
        // Text belonging to this grade: from the previous grade's end to the next grade's start.
        // The card name normally comes before its grade ("Umbreon VMAX 215/203 PSA 10"); fall back to the
        // text after it ("PSA 10 Umbreon VMAX") when nothing useful precedes it.
        const from = gi ? grades[gi - 1].end : 0;
        const to = gi < grades.length - 1 ? grades[gi + 1].index : seg.length;
        const priceCtx = seg.slice(from, to);
        let ctx = seg.slice(from, g.end);
        let rel = g.index - from;
        if (!/\p{L}{3,}/u.test(cleanName(ctx.replace(CARD_NO_RE_G, ' ')))) { ctx = seg.slice(g.index, to); rel = 0; }
        // Very long segments: keep a window of words around the grade.
        if (ctx.length > 220) {
          const before = ctx.slice(0, rel).split(/\s+/).slice(-14).join(' ');
          const after = ctx.slice(rel).split(/\s+/).slice(0, 6).join(' ');
          ctx = before + ' ' + after;
          rel = before.length + 1;
        }
        let name = cleanName(ctx.replace(CARD_NO_RE_G, ' '));
        let number = extractNumber(ctx);
        // "PSA 10" on its own line: borrow the card name from the previous segment.
        if (name.split(' ').filter(Boolean).length < 1 && i > 0 && !findGrades(segs[i - 1]).length) {
          name = cleanName(segs[i - 1].replace(CARD_NO_RE_G, ' '));
          number = number || extractNumber(segs[i - 1]);
          ctx = segs[i - 1] + ' ' + ctx;
        }
        name = titleCase(name.split(' ').slice(0, 9).join(' '));
        if (!name || !/\p{L}{2,}/u.test(name)) return;
        const own = pokemonScore(ctx);
        if (own < minScore && !(opts.pokemonOnly === false)) return;
        const score = own + pageBoost;
        const card = {
          name, number, grader: g.grader, grade: g.grade, qual: g.qual,
          askPrice: priceNear(priceCtx, g.index - from), score, raw: ctx.trim().slice(0, 200)
        };
        card.query = buildQuery(card);
        const k = cardKey(card);
        const prev = found.get(k);
        if (!prev) found.set(k, card);
        else {
          if (card.name.length > prev.name.length) { prev.name = card.name; prev.query = buildQuery({ ...prev, name: card.name }); }
          if (card.number && (!prev.number || (!prev.number.includes('/') && card.number.includes('/')))) { prev.number = card.number; prev.query = buildQuery(prev); }
          if (prev.askPrice == null) prev.askPrice = card.askPrice;
        }
      });
    }
    return [...found.values()].sort((a, b) => b.score - a.score);
  }

  function buildQuery(c) {
    return [c.name, c.number, gradeLabel(c)].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  }

  // ---------------------------------------------------------------- query parsing & matching
  const VARIANTS = {
    '1st Edition': /\b1st\s*ed(ition)?\b|\bfirst\s*edition\b|\b1st\b/i,
    'Shadowless': /\bshadowless\b/i,
    'Japanese': /\bjapanese\b|\bjapan\b|\bjpn?\b/i,
    'Korean': /\bkorean\b|\bkor\b/i,
    'Chinese': /\bchinese\b|\b[st]-?chinese\b|\bcn\b/i,
    'Reverse Holo': /\breverse\s*holo|\brev\s*holo/i,
    'Celebrations': /\bcelebrations\b|\bclassic\s*collection\b|\b25th\s*anniv/i,
    'Base Set 2': /\bbase\s*set\s*(2|ii)\b|\bbase\s*2\b/i,
    'Legendary Collection': /\blegendary\s*collection\b/i,
    'Jumbo': /\bjumbo\b|\boversized?\b/i,
    'Error': /\berror\b|\bmisprint\b|\bmiscut\b|\bno\s*symbol\b/i,
    'Prerelease/Staff': /\bpre-?release\b|\bstaff\b/i,
    'Stamped': /\bstamped\b|\bstamp\b/i,
    'Print run': /\b(2nd|3rd|4th)\s*print\b|\(uk\)|\buk\s*print\b/i,
    'Gold/Metal': /\bgold\s*metal\b|\bmetal\b/i,
  };
  const NAMES = new Set(POKEMON_HINTS.slice(POKEMON_HINTS.indexOf('charizard')));
  const SET_WORDS = new Set(POKEMON_HINTS.slice(0, POKEMON_HINTS.indexOf('charizard')).join(' ').split(/\s+/));
  const OPPOSITE = {
    '1st Edition': /\bunlimited\b|\bunl\b/i,
    'Shadowless': /\bshadow(ed)?\b(?!less)/i,
    'Japanese': /\benglish\b|\beng\b/i,
    'Korean': /\benglish\b|\bjapanese\b/i,
    'Chinese': /\benglish\b|\bjapanese\b/i
  };
  const TYPE_STRICT = ['vmax', 'vstar', 'gx', 'v-union', 'break', 'lv.x', 'tag team'];
  const GENERIC = new Set(('holo holofoil rare secret alt alternate art full illustration special ultra hyper gold rainbow ' +
    'promo set base edition trainer gallery sir ir fa aa sar ar chr ex v vmax vstar gx unlimited shadowless 1st reverse ' +
    'japanese english card pokemon tcg swsh sv sm xy bw').split(' '));

  function splitQuery(q) {
    q = String(q || '');
    const g = findGrades(q)[0] || null;
    let number = extractNumber(q);
    let rest = q.replace(CARD_NO_RE_G, ' ');
    if (!number) {
      // A typed search like "luigi pikachu 295 PSA 10": a bare 1–3 digit number (not the grade, not a year) is the card number.
      const noGrade = q.replace(gradeReG(), ' ');
      const bare = [...noGrade.matchAll(/(?:^|\s)(\d{1,3})(?=\s|$)/g)].pop();
      if (bare) { number = bare[1]; rest = noGrade.replace(new RegExp('(^|\\s)' + bare[1] + '(?=\\s|$)'), ' ') + ' ' + (g ? gradeLabel(g) : ''); }
    }
    const name = cleanName(rest);
    const variants = Object.keys(VARIANTS).filter(k => VARIANTS[k].test(q));
    const words = name.toLowerCase().split(/\s+/).filter(Boolean);
    // The key word is the Pokémon / trainer name: a known name if present, else the first word that isn't a set or rarity word.
    const known = words.find(w => NAMES.has(w.replace(/[^a-z-]/g, '')));
    const keyWords = known ? [known] : words.filter(w => !GENERIC.has(w) && !SET_WORDS.has(w) && !/\d/.test(w));
    return {
      name, number, numberKey: numberKey(number), totalKey: [...totalKeys(number)][0] || '',
      grader: g ? g.grader : '', grade: g ? g.grade : '', qual: g ? g.qual : '',
      variants, types: TYPE_STRICT.concat('v').filter(t => new RegExp('(^|[^a-z])' + t.replace('.', '\\.') + '([^a-z]|$)', 'i').test(name)),
      keyWord: keyWords[0] || words[0] || ''
    };
  }

  // Short search phrase for app-style searches (Collectr / Alt): Pokémon name + card type + number, no set or rarity words.
  const FILLER = new Set('holo holofoil rare secret art alt alternate full illustration special promo set base edition unlimited sir ir sar ar chr fa aa'.split(' '));
  function coreName(parts) {
    const words = parts.name.split(/\s+/).filter(w => w && (/^(vmax|vstar|gx|ex|v|lv\.x|break)$/i.test(w) || !SET_WORDS.has(w.toLowerCase()) && !FILLER.has(w.toLowerCase())));
    return [words.slice(0, 4).join(' ') || parts.name, parts.number].filter(Boolean).join(' ');
  }

  // Does a listing title have exactly the requested grade?
  // PSA 9 never matches PSA 9.5/10; BGS 10 never matches Black Label; titles listing two grades are rejected.
  function titleMatchesGrade(title, grader, grade, qual = '') {
    if (!grader || !grade) return true;
    const gs = findGrades(title);
    if (!gs.length) return false;
    const want = gs.filter(g => g.grader === grader && g.grade === grade);
    if (!want.length) return false;
    if (gs.some(g => g.grader === grader && g.grade !== grade)) return false;
    const titleQual = want.some(g => g.qual === 'BL') || /black\s*label/i.test(title) ? 'BL'
      : want.some(g => g.qual === 'PRISTINE') || (grader !== 'PSA' && /pristine/i.test(title)) ? 'PRISTINE' : '';
    return titleQual === (qual || '');
  }

  const fold = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  // Is this listing the same card? Returns {ok, reason}.
  function matchCard(title, parts) {
    const t = fold(title);
    if (parts.keyWord && !new RegExp('(^|[^a-z])' + fold(parts.keyWord).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(t))
      return { ok: false, reason: `missing “${parts.keyWord}”` };
    // Card type (V / VMAX / VSTAR / GX …) only matters when your search names one, and an exact card-number match
    // outweighs wording: "Sylveon TG15 PSA 10" accepts "Sylveon VMAX TG15", "Umbreon V …" rejects "Umbreon VMAX …".
    const numberHit = parts.numberKey && allNumberKeys(title).has(parts.numberKey);
    const qTypes = parts.types || [];
    if (qTypes.length && !numberHit) {
      const hasType = (ty) => new RegExp('(^|[^a-z])' + ty.replace('.', '\\.') + '([^a-z]|$)').test(t);
      const titleType = TYPE_STRICT.concat('v').find(hasType);
      for (const ty of qTypes) if (!hasType(ty)) return { ok: false, reason: titleType ? `is ${titleType.toUpperCase()}` : `not ${ty.toUpperCase()}` };
      for (const ty of TYPE_STRICT.concat('v')) if (!qTypes.includes(ty) && hasType(ty) && !(ty === 'v' && qTypes.some(q => /^v/.test(q)))) return { ok: false, reason: `is ${ty.toUpperCase()}` };
    }
    if (parts.numberKey) {
      const keys = allNumberKeys(title);
      if (keys.size && !keys.has(parts.numberKey)) return { ok: false, reason: `number #${[...keys][0]}` };
    }
    if (parts.totalKey) {
      const totals = totalKeys(title);
      if (totals.size && !totals.has(parts.totalKey)) return { ok: false, reason: `different set (/${[...totals][0]})` };
    }
    const allow = parts.allowVariants || [];
    for (const [v, re] of Object.entries(VARIANTS)) {
      if (allow.includes(v)) continue; // this variant is part of the card itself (e.g. a Japanese-only promo)
      const inQ = (parts.variants || []).includes(v);
      const inT = re.test(title);
      // A version the listing names but you didn't ask for is a different card (1st Edition, Japanese, …).
      if (inT && !inQ) return { ok: false, reason: v };
      // A version you asked for that the listing just doesn't mention is fine (sellers often leave it out);
      // only reject when the listing says the opposite.
      if (inQ && !inT && OPPOSITE[v] && OPPOSITE[v].test(title)) return { ok: false, reason: `not ${v}` };
    }
    return { ok: true };
  }

  // Variants that most real sales of this card mention are part of the card, not a different version.
  // e.g. every "Luigi Pikachu #295 PSA 10" sale says "Japanese" because no English version exists.
  // Typing the variant (or "English") in the search always wins.
  function inherentVariants(titles, parts) {
    if (/\benglish\b/i.test(parts.name)) return [];
    const base = { ...parts, variants: [], allowVariants: Object.keys(VARIANTS) };
    const same = titles.filter(t => matchCard(t, base).ok);
    if (same.length < 2) return [];
    const out = [];
    for (const [v, re] of Object.entries(VARIANTS)) {
      if ((parts.variants || []).includes(v) || v === 'Sealed') continue;
      const n = same.filter(t => re.test(t)).length;
      if (n >= 2 && n / same.length >= 0.5) out.push(v);
    }
    return out;
  }

  // When you didn't type the set size, learn it from the sales: if most listings of this card number say "/088",
  // a "/128" listing is a different set's card with the same number.
  function dominantTotal(titles, parts) {
    if (parts.totalKey || !parts.numberKey) return '';
    const counts = {};
    let n = 0;
    for (const t of titles) {
      if (!matchCard(t, parts).ok) continue;
      const tk = [...totalKeys(t)];
      if (!tk.length) continue;
      n++;
      for (const k of tk) counts[k] = (counts[k] || 0) + 1;
    }
    const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    return best && best[1] >= 3 && best[1] / n >= 0.6 ? best[0] : '';
  }

  // ---------------------------------------------------------------- cert numbers
  // "PSA Cert #140688778", "Certification Number: 4061234001", "CGC 4061234001", a bare "140688778" typed in the search.
  const CERT_RE = /\b(?:(PSA|CGC|BGS|Beckett|SGC|TAG)\b[^\n\d]{0,30}?)?(?:cert(?:ification)?|serial)\s*(?:#|no\.?|number|num)?\s*:?\s*#?\s*(\d{7,10})\b/gi;
  const CERT_ONLY_RE = /^\s*(PSA|CGC|BGS|Beckett|SGC|TAG)?\s*(?:cert(?:ification)?)?\s*(?:#|no\.?|number)?\s*:?\s*#?\s*(\d{7,10})\s*$/i;

  function guessGrader(cert, context) {
    const near = String(context || '').match(/\b(PSA|CGC|BGS|Beckett|SGC|TAG)\b/i);
    if (near) return normGrader(near[1]);
    return String(cert).length === 10 ? 'CGC' : 'PSA';
  }

  function detectCerts(text) {
    const out = new Map();
    // Slab label text ("… FA/Sylveon VMAX PSA 10 Brilliant Stars 105232318"): a lone 8–10 digit number next to a grade.
    for (const line of String(text || '').split(/\n+/)) {
      const g = findGrades(line)[0];
      if (!g) continue;
      for (const m of line.matchAll(/(?:^|[^\d$.,#])(\d{8,10})(?![\d,.])/g)) {
        if (!out.has(m[1])) out.set(m[1], { grader: g.grader, cert: m[1], guessed: false, fromLabel: true });
      }
    }
    for (const m of String(text || '').matchAll(CERT_RE)) {
      const ctx = String(text).slice(Math.max(0, m.index - 25), m.index + m[0].length + 10);
      const grader = m[1] ? normGrader(m[1]) : guessGrader(m[2], ctx);
      out.set(m[2], { grader, cert: m[2], guessed: !m[1] && !/\b(PSA|CGC|BGS|Beckett|SGC|TAG)\b/i.test(ctx) });
    }
    return [...out.values()];
  }

  function parseCertQuery(q) {
    const m = String(q || '').match(CERT_ONLY_RE);
    return m ? { grader: m[1] ? normGrader(m[1]) : guessGrader(m[2]), cert: m[2], guessed: !m[1] } : null;
  }

  // Grade text from a slab / cert page: "GEM MT 10", "MINT 9", "Pristine 10", "9.5", "Black Label 10"
  function parseGradeText(grader, text) {
    const t = String(text || '');
    const n = (t.match(/(10|\d(?:\.5)?)(?!\d)/) || [])[1];
    if (!n) return null;
    return { grader, grade: n, qual: /black\s*label/i.test(t) ? 'BL' : grader !== 'PSA' && /pristine/i.test(t) ? 'PRISTINE' : '' };
  }

  // ---------------------------------------------------------------- prices & dates
  // USD only: "C $45" / "AU $45" are rejected.
  function parsePrice(s) {
    const m = String(s).replace(/ /g, ' ').match(/(?:\b(US|C|CA|AU|A|NZ|HK|SG|S)\s?)?\$\s?(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/);
    if (!m) return null;
    if (m[1] && m[1].toUpperCase() !== 'US') return null;
    return parseFloat(m[2].replace(/,/g, ''));
  }

  const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
  const MON = '(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\\.?';

  // Price with its currency: "C $1,234.56" → {amount, cur:'CAD'}, "US $45" → USD, "£30" → GBP, "1,234.00 CAD" → CAD.
  // A bare "$" has cur:null (the caller knows the site's currency).
  const PREFIX_CUR = { US: 'USD', C: 'CAD', CA: 'CAD', CAD: 'CAD', AU: 'AUD', A: 'AUD', NZ: 'NZD', HK: 'HKD', SG: 'SGD', S: 'SGD' };
  function parseMoney(s) {
    s = String(s || '').replace(/\u00a0/g, ' ');
    const num = '(\\d{1,3}(?:,\\d{3})+(?:\\.\\d{1,2})?|\\d+(?:\\.\\d{1,2})?)';
    let m = s.match(new RegExp('(?:\\b(US|CAD|CA|C|AU|A|NZ|HK|SG|S)\\s?)?\\$\\s?' + num + '(?:\\s?(USD|CAD|AUD|NZD|HKD|SGD)\\b)?'));
    if (m) return { amount: parseFloat(m[2].replace(/,/g, '')), cur: m[3] || (m[1] ? PREFIX_CUR[m[1].toUpperCase()] : null) };
    if ((m = s.match(new RegExp('£\\s?' + num)))) return { amount: parseFloat(m[1].replace(/,/g, '')), cur: 'GBP' };
    if ((m = s.match(new RegExp('€\\s?' + num + '|' + num + '\\s?€')))) return { amount: parseFloat((m[1] || m[2]).replace(/,/g, '')), cur: 'EUR' };
    if ((m = s.match(new RegExp('[¥￥]\\s?' + num)))) return { amount: parseFloat(m[1].replace(/,/g, '')), cur: 'JPY' };
    if ((m = s.match(new RegExp(num + '\\s?(USD|CAD|GBP|EUR|AUD|JPY|NZD|HKD|SGD)\\b')))) return { amount: parseFloat(m[1].replace(/,/g, '')), cur: m[2] };
    return null;
  }

  // Exact sale time when the text has one ("Thu 30 Oct 2026 18:22:54 GMT", ISO timestamps); otherwise null.
  function parseDateTime(s) {
    s = String(s || '');
    let m = s.match(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})\b/);
    if (m) { const d = new Date(m[0]); return isNaN(d) ? null : d; }
    m = s.match(/\b(\d{1,2}\s+[A-Z][a-z]{2}\s+\d{4}\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:GMT|UTC|Z|[+-]\d{4}))/);
    if (m) { const d = new Date(m[1].replace(/\bZ$/, 'GMT')); return isNaN(d) ? null : d; }
    return null;
  }

  // Returns a Date (local midnight) or null.
  function parseDate(s, now = new Date()) {
    s = String(s || '').replace(/ /g, ' ');
    let m;
    const day = (y, mo, d) => { const dt = new Date(y, mo, d); return isNaN(dt) || dt.getDate() !== d ? null : dt; };
    const fixYear = (dt) => { if (dt && dt - now > 864e5) dt.setFullYear(dt.getFullYear() - 1); return dt; };
    if ((m = s.match(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/))) return day(+m[1], +m[2] - 1, +m[3]);
    if ((m = s.match(/(\d+)\s*(分|時間|日|週間)前/))) {
      const n = +m[1], ms = m[2] === '分' ? n * 6e4 : m[2] === '時間' ? n * 36e5 : m[2] === '日' ? n * 864e5 : n * 6048e5;
      const dt = new Date(now - ms); return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
    }
    if ((m = s.match(new RegExp('\\b' + MON + '\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})', 'i')))) return day(+m[3], MONTHS[m[1].toLowerCase()], +m[2]);
    if ((m = s.match(new RegExp('\\b(\\d{1,2})\\s+' + MON + ',?\\s+(\\d{4})', 'i')))) return day(+m[3], MONTHS[m[2].toLowerCase()], +m[1]);
    if ((m = s.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})\b/))) return day(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[1] - 1, +m[2]);
    if ((m = s.match(/\b(\d+)\s*(m|min|mins|minutes?|h|hr|hrs|hours?|d|days?|w|wk|wks|weeks?)\s+ago\b/i))) {
      const n = +m[1], u = m[2].toLowerCase();
      const ms = /^m/.test(u) ? n * 6e4 : /^h/.test(u) ? n * 36e5 : /^d/.test(u) ? n * 864e5 : n * 6048e5;
      const dt = new Date(now - ms); return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
    }
    if (/\btoday\b|\bjust now\b/i.test(s)) return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (/\byesterday\b/i.test(s)) return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    if ((m = s.match(new RegExp('\\b' + MON + '\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?!\\s*,?\\s*\\d{4})', 'i')))) return fixYear(day(now.getFullYear(), MONTHS[m[1].toLowerCase()], +m[2]));
    return null;
  }

  // Whole calendar days between a sale date and today (0 = today).
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
    return { count: s.length, avg: sum / s.length, median: s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2, low: s[0], high: s[s.length - 1] };
  }

  const WINDOWS = [
    { key: '1d', label: 'Today', short: '1D', days: 1 },
    { key: '3d', label: 'Last 3 days', short: '3D', days: 3 },
    { key: '5d', label: 'Last 5 days', short: '5D', days: 5 },
    { key: '7d', label: 'Last 7 days', short: '7D', days: 7 }
  ];

  // Calendar days in the user's own time zone, counting today: "Today" = sold today, "Last 3 days" = today and
  // the 2 days before. Sales with an exact time are placed on the user's local date; date-only sales use the
  // date the site shows.
  const inWindow = (s, days, now) => { const d = daysAgo(s.date, now); return d >= 0 && d < days; };

  function windowStats(sales, now = new Date()) {
    const out = {};
    for (const w of WINDOWS) out[w.key] = stats(sales.filter(s => s.date && inWindow(s, w.days, now)).map(s => s.price));
    return out;
  }

  root.GCP = {
    GRADE_RE, CARD_NO_RE, CARD_NO_RE_G, WINDOWS, VARIANTS, detectCards, findGrades, gradeLabel, splitQuery, buildQuery,
    titleMatchesGrade, matchCard, parsePrice, parseDate, daysAgo, inWindow, stats, windowStats, cleanName,
    pokemonScore, parseMoney, parseDateTime, extractNumber, numberKey, allNumberKeys, coreName, VARIANTS_WORDS: new Set('japanese english korean chinese 1st first edition shadowless unlimited reverse holo promo'.split(' ')), inherentVariants, dominantTotal, totalKeys, detectCerts, parseCertQuery, parseGradeText
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.GCP;
})(typeof globalThis !== 'undefined' ? globalThis : this);
