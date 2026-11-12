const assert = require('assert');
const G = require('../src/detect.js');
const now = new Date(2026, 10, 6, 15, 0);
const q = (cards) => cards.map(c => c.query);

// --- detection
const email = `From: seller@example.com
Subject: Re: WTS Umbreon VMAX 215/203 Evolving Skies PSA 10 - $1,850 shipped
Hey, also have these: Charizard Base Set 4/102 Holo BGS 9.5 and Blastoise 2/102 PSA 9. Let me know!
Gengar VMAX 271/264 Fusion Strike CGC Pristine 10 $420
2021 POKEMON SWSH EVOLVING SKIES #215 UMBREON VMAX GEM MT 10 Cert 87654321
Pikachu Illustrator
PSA 9
PSA 10 Lugia V Alt Art 186/195 Silver Tempest $650
Rayquaza VMAX 218/203 BGS 10 Black Label
Mike Trout 2011 Topps Update PSA 10
Order total: $14.99`;
const cards = G.detectCards(email);
console.log(q(cards));
const has = (fn) => assert(cards.some(fn), 'missing card');
has(c => c.name.startsWith('Umbreon VMAX') && c.number === '215/203' && c.grader === 'PSA' && c.grade === '10' && c.askPrice === 1850);
assert.strictEqual(cards.filter(c => /umbreon/i.test(c.name)).length, 1, 'Umbreon should be merged into one chip');
has(c => c.name === 'Charizard Base Set Holo' && c.grader === 'BGS' && c.grade === '9.5');
has(c => c.name === 'Blastoise' && c.number === '2/102' && c.grade === '9');
has(c => /Gengar VMAX/.test(c.name) && c.grader === 'CGC' && c.qual === 'PRISTINE' && c.askPrice === 420);
has(c => /Pikachu Illustrator/.test(c.name) && c.grade === '9');
has(c => /Lugia V/.test(c.name) && c.number === '186/195' && c.askPrice === 650);
has(c => /Rayquaza VMAX/.test(c.name) && c.qual === 'BL');
assert(!cards.some(c => /trout/i.test(c.name)), 'non-Pokémon card should be skipped');

const c2 = G.detectCards("Hi! I'd like to buy your Umbreon VMAX 215/203 Evolving Skies PSA 10 for $1.7k.\nAlso interested in Charizard Base Set 4/102 PSA 9.");
console.log(q(c2));
assert(c2.some(c => c.query === 'Umbreon VMAX Evolving Skies 215/203 PSA 10' && c.askPrice === 1700));
assert(c2.some(c => c.query === 'Charizard Base Set 4/102 PSA 9'));

// Long single-line email paragraph (Gmail often has no line breaks)
const long = 'Hello there, thanks so much for reaching out about the cards you listed last week, I have been collecting for years and '.repeat(4) +
  'I am mostly interested in your Giratina V Alt Art 186/196 Lost Origin PSA 10 if you are still willing to sell it at a fair price.';
assert(G.detectCards(long).some(c => /Giratina V/.test(c.name) && c.number === '186/196'));

// --- grade matching
assert(G.titleMatchesGrade('2021 Umbreon VMAX 215/203 PSA 10 GEM MINT', 'PSA', '10'));
assert(!G.titleMatchesGrade('Umbreon VMAX PSA 9 MINT', 'PSA', '10'));
assert(!G.titleMatchesGrade('Charizard BGS 9.5 Gem Mint', 'BGS', '9'));
assert(G.titleMatchesGrade('Charizard Beckett 9.5', 'BGS', '9.5'));
assert(!G.titleMatchesGrade('Charizard PSA 100 lot', 'PSA', '10'));
assert(!G.titleMatchesGrade('Charizard PSA 9 PSA 10 pair', 'PSA', '10'));
assert(!G.titleMatchesGrade('Rayquaza BGS 10 Black Label', 'BGS', '10'));
assert(G.titleMatchesGrade('Rayquaza BGS 10 Black Label', 'BGS', '10', 'BL'));
assert(!G.titleMatchesGrade('Gengar CGC 10 Pristine', 'CGC', '10'));
assert(G.titleMatchesGrade('Charizard PSA 9.', 'PSA', '9'));

// --- card matching
const p = G.splitQuery('Charizard Base Set 4/102 PSA 9');
assert.strictEqual(p.keyWord, 'charizard');
assert(G.matchCard('1999 Pokemon Base Set Charizard Holo 4/102 PSA 9 MINT', p).ok);
assert(G.matchCard('1999 POKEMON GAME #4 CHARIZARD-HOLO PSA 9', p).ok);
for (const bad of ['Charizard Holo Base Set II 4/130 PSA 9', 'Charizard 1st Edition Base Set 4/102 PSA 9',
  'Charizard Celebrations Classic Collection 4/102 PSA 9', 'Charizard base set shadowless PSA 9', 'Blastoise Base Set 2/102 PSA 9',
  'Charizard Japanese Base Set PSA 9']) assert(!G.matchCard(bad, p).ok, bad);
const u = G.splitQuery('Umbreon VMAX Evolving Skies 215/203 PSA 10');
assert.strictEqual(u.keyWord, 'umbreon');
assert(G.matchCard('Umbreon VMAX 215/203 alt art PSA 10 GEM MINT', u).ok);
assert(!G.matchCard('Umbreon V 189/203 Evolving Skies PSA 10', u).ok);
assert(!G.matchCard('Umbreon VMAX 095/203 PSA 10', u).ok);

// --- prices & dates
assert.strictEqual(G.parsePrice('$1,234.56'), 1234.56);
assert.strictEqual(G.parsePrice('US $45.00'), 45);
assert.strictEqual(G.parsePrice('C $45.00'), null);
assert.strictEqual(G.parsePrice('AU $45.00'), null);
const d = (s) => { const x = G.parseDate(s, now); return x && x.toDateString(); };
assert.strictEqual(d('Sold Nov 3, 2026'), new Date(2026, 10, 3).toDateString());
assert.strictEqual(d('2026-11-01'), new Date(2026, 10, 1).toDateString());
assert.strictEqual(d('Date: Thu 30 Oct 2026 18:22'), new Date(2026, 9, 30).toDateString());
assert.strictEqual(d('2 days ago'), new Date(2026, 10, 4).toDateString());
assert.strictEqual(d('Dec 28'), new Date(2025, 11, 28).toDateString());
assert.strictEqual(d('yesterday'), new Date(2026, 10, 5).toDateString());
assert.strictEqual(d('Feb 30, 2026'), null);

// --- windows (calendar days counting today): Today = today only, Last 7 days = today + 6 days before
const sales = [0, 0, 1, 2, 3, 4, 5, 6, 7, 9].map((ago, i) => ({ price: 100 + i * 10, date: new Date(2026, 10, 6 - ago) }));
const w = G.windowStats(sales, now);
assert.strictEqual(w['1d'].count, 2);
assert.strictEqual(w['3d'].count, 4);
assert.strictEqual(w['5d'].count, 6);
assert.strictEqual(w['7d'].count, 8);
assert.strictEqual(w['1d'].avg, 105);
console.log('all detect tests passed');

// --- v3: typed bare numbers, cards that only exist in one variant, cert numbers
const lp = G.splitQuery('luigi pikachu 295 PSA 10');
assert.strictEqual(lp.number, '295');
assert.strictEqual(lp.name, 'luigi pikachu');
const lpTitles = ['2016 POKEMON JAPANESE XY PROMO #295 LUIGI PIKACHU PSA 10', 'Luigi Pikachu Holo #295 XY Promo 2016 Pokemon Japanese PSA 10',
  'Pokemon Luigi Pikachu 295/XY-P Japanese Promo PSA 10', 'Mario Pikachu #294 Japanese PSA 10'];
const inh = G.inherentVariants(lpTitles, lp);
assert.deepStrictEqual(inh, ['Japanese']);
const lpM = { ...lp, allowVariants: inh };
assert(G.matchCard(lpTitles[0], lpM).ok && G.matchCard(lpTitles[1], lpM).ok && G.matchCard('Luigi Pikachu #295 PSA 10', lpM).ok);
assert(!G.matchCard(lpTitles[3], lpM).ok, 'Mario Pikachu #294 is a different card');
// a minority variant must still be filtered (1st Edition among unlimited Charizards)
const cz = G.splitQuery('Charizard Base Set 4/102 PSA 9');
assert.deepStrictEqual(G.inherentVariants(['Charizard Base Set 4/102 PSA 9', 'Charizard Holo 4/102 PSA 9', 'Charizard 1st Edition 4/102 PSA 9'], cz), []);
assert.strictEqual(G.splitQuery('Umbreon VMAX 2021 PSA 10').number, '');
const certs = G.detectCerts('Your PSA order shipped. Cert #140688778. Also CGC Certification Number: 4061234001');
assert.deepStrictEqual(certs.map(c => c.grader + ':' + c.cert), ['PSA:140688778', 'CGC:4061234001']);
assert.deepStrictEqual(G.parseCertQuery('140688778'), { grader: 'PSA', cert: '140688778', guessed: true });
assert.strictEqual(G.parseCertQuery('cgc 4061234001').grader, 'CGC');
assert.strictEqual(G.parseCertQuery('Charizard 4/102 PSA 9'), null);
global.GCP = G; require('../src/platforms.js');
assert.strictEqual(GCPPlatforms.certToQuery({ grader: 'PSA', subject: 'LUIGI PIKACHU-HOLO', brand: 'P.M. JPN. XY PROMO', cardNumber: '295', gradeText: 'GEM MT 10' }),
  'Luigi Pikachu Japanese XY Promo 295 PSA 10');
assert.strictEqual(GCPPlatforms.certToQuery({ grader: 'PSA', subject: 'CHARIZARD-HOLO', brand: 'POKEMON GAME', cardNumber: '4', variety: '1ST EDITION', gradeText: 'NM-MT 8' }),
  'Charizard Base Set 1st Edition 4 PSA 8');
console.log('v3 tests passed');

// --- v3.1: CAD, windows by calendar day
assert.deepStrictEqual(G.parseMoney('C $1,234.56'), { amount: 1234.56, cur: 'CAD' });
assert.deepStrictEqual(G.parseMoney('US $45.00'), { amount: 45, cur: 'USD' });
assert.deepStrictEqual(G.parseMoney('Sale Price: $1,600.00 USD'), { amount: 1600, cur: 'USD' });
assert.strictEqual(G.parseMoney('$99').cur, null);
assert.strictEqual(G.parseMoney('£30').cur, 'GBP');
assert.strictEqual(G.parseDateTime('Date: Thu 30 Oct 2026 18:22:54 GMT').toISOString(), '2026-10-30T18:22:54.000Z');
const fxr = { rates: { CAD: 1, USD: 1.4 } };
assert.deepStrictEqual(GCPPlatforms.toCAD(100, 'USD', fxr), { price: 140, converted: true, orig: { amount: 100, cur: 'USD' } });
assert.deepStrictEqual(GCPPlatforms.toCAD(100, 'CAD', fxr), { price: 100, converted: false });
assert.strictEqual(GCPPlatforms.toCAD(100, 'USD', null), null);
const w2 = G.windowStats([0, 1, 2, 6, 7].map(a => ({ price: 10, date: new Date(2026, 10, 6 - a) })), now);
assert.strictEqual(w2['1d'].count, 1, '"Today" = today only');
assert.strictEqual(w2['3d'].count, 3);
assert.strictEqual(w2['7d'].count, 4, 'Last 7 days = today + 6 days before');
const mig = GCPPlatforms.migrateSettings({ platforms: { ebay: { url: 'https://www.ebay.com/sch/i.html?_nkw={q}&LH_Sold=1' } } });
assert(/ebay\.ca/.test(mig.platforms.ebay.url));
console.log('v3.1 tests passed');

// --- v3.2: graded promo cards whose titles mention the ETB they came in; Black Star promo number prefixes
const sn = G.splitQuery('snorlax 051 PSA 10');
for (const t of ['2023 Pokemon SVP 051 Snorlax 151 Elite Trainer Box Black Star Promo PSA 10',
  'Snorlax #051 SV: Scarlet & Violet 151 ETB Promo PSA 10 Pokemon Card *TEW',
  'Pokémon Snorlax #051 PSA 10 Gem Mint 151 ETB Promo (2023)']) assert(G.matchCard(t, sn).ok, t);
assert(!G.matchCard('Snorlax 143/165 Pokemon 151 PSA 10', sn).ok);
assert(!G.matchCard('Snorlax TG10 PSA 10', sn).ok, 'Trainer Gallery numbers stay distinct');
assert(G.matchCard('Snorlax #051 PSA 10', G.splitQuery('Snorlax SVP 051 PSA 10')).ok);
assert.strictEqual(G.numberKey('SWSH050'), '50');
assert.strictEqual(G.numberKey('TG23/TG30'), 'TG23');
console.log('v3.2 tests passed');

// --- v3.3: population from PriceCharting product pages
{
  const html = `<script>VGPC.pop_data = {"cgc":[0,0,1,0,0,0,1,1,2,4],"psa":[4096,3573,5580,10192,16102,17851,16980,15931,8455,486]};</script>`;
  const fakeDoc = { querySelectorAll: () => [] };
  const r = GCPPlatforms.parsePriceChartingInfo(fakeDoc, html);
  assert.strictEqual(r.pop.graders.PSA['10'], 486);
  assert.strictEqual(r.pop.graders.PSA['9'], 8455);
  assert.strictEqual(r.pop.graders.CGC['10'], 4);
  assert.strictEqual(GCPPlatforms.parsePriceChartingInfo(fakeDoc, '<p>no pop</p>').pop, null);
  console.log('v3.3 tests passed');
}

// --- v4: lenient on what sellers leave out, strict on what they state; set size learned from sales
{
  const g = G.splitQuery('Gengar EX Japanese Phantom Gate 1st Edition 90 PSA 10');
  const titles = ['2014 Pokemon Japanese XY Phantom Gate 1st Edition #090 FA Gengar EX PSA 10', 'PSA10 Gengar EX 090/088 XY4 SR 1st Edition Japanese',
    'Gengar EX 090/088 SR Full Art 1st ED', 'Pokemon Gengar EX Full Art 090/088 1st Edition', '2014 POKEMON JAPANESE XY #090 FA/GENGAR EX PSA 10'];
  const gm = { ...g, totalKey: G.dominantTotal(titles, g) };
  assert.strictEqual(gm.totalKey, '88');
  for (const t of titles) assert(G.matchCard(t, gm).ok, t);
  assert(!G.matchCard('Pokemon Gengar EX XY Phantom Gate Japanese UNLIMITED FA #090 PSA 10', gm).ok, 'unlimited is a different version');
  assert(!G.matchCard('Gengar EX 090/088 PSA 10 English', gm).ok);
  assert(!G.matchCard('Gengar ex 090/128 30th Celebration PSA 10', gm).ok, 'same number, different set');
  assert.strictEqual(G.parseDate('2026/11/04', now).getDate(), 4);
  assert.strictEqual(GCPPlatforms.ebayQuery(g), 'Gengar EX (90,090) PSA 10');
  assert.strictEqual(GCPPlatforms.ebayQuery(G.splitQuery('Umbreon VMAX Evolving Skies 215/203 PSA 10')), 'Umbreon VMAX (215/203,215) PSA 10');
  console.log('v4 tests passed');
}

// --- v4.2: PSA slab-label text (FA/ prefix, bare cert number), Trainer Gallery numbers
{
  const t = '2022 pokemon swsh #tg15 FA/Sylveon Vmax PSA 10 brilliant stars 105232318';
  const c = G.detectCards(t);
  assert.strictEqual(c[0].query, 'Sylveon Vmax TG15 PSA 10');
  assert.deepStrictEqual(G.detectCerts(t).map(x => x.grader + ':' + x.cert), ['PSA:105232318']);
  assert.deepStrictEqual(G.detectCerts('Order #1234567890 total $40'), []);
  const p = G.splitQuery('Sylveon VMAX Brilliant Stars TG15 PSA 10');
  assert(G.matchCard('2022 Pokemon Brilliant Stars Sylveon VMAX TG15/TG30 PSA 10', p).ok);
  assert(!G.matchCard('Sylveon V TG14/TG30 Brilliant Stars PSA 10', p).ok);
  assert(!G.matchCard('Sylveon VMAX 075/203 Evolving Skies PSA 10', p).ok);
  assert.strictEqual(GCPPlatforms.ebayQuery(p), 'Sylveon VMAX TG15 PSA 10');
  console.log('v4.2 tests passed');
}

// --- v4.7: card type only enforced when the search names one
{
  const loose = G.splitQuery('Sylveon TG15 PSA 10');
  assert(G.matchCard('2022 POKEMON SWORD & SHIELD BRILLIANT STARS #TG15 FULL ART/SYLVEON VMAX PSA 10', loose).ok, 'no type in search → VMAX listing kept');
  assert(!G.matchCard('Sylveon V TG14/TG30 Brilliant Stars PSA 10', loose).ok, 'different number still dropped');
  const v = G.splitQuery('Umbreon V PSA 10');
  assert.strictEqual(G.matchCard('Umbreon VMAX 215/203 PSA 10', v).reason, 'is VMAX');
  assert(G.matchCard('Umbreon V 189/203 PSA 10', v).ok);
  assert(!G.matchCard('Umbreon V 189/203 PSA 10', G.splitQuery('Umbreon VMAX PSA 10')).ok);
  console.log('v4.7 tests passed');
}

// --- v4.9: Terapeak on eBay.com with the exact words typed; numbers kept as typed (SV56)
{
  const q = 'psa 10 greninja gx hidden fates sv56';
  const p = G.splitQuery(q);
  assert(/ebay\.com\/sh\/research\?marketplace=EBAY-US&keywords=psa\+10\+greninja\+gx\+hidden\+fates\+sv56/.test(GCPPlatforms.pageUrl('terapeak', q, GCPPlatforms.DEFAULTS.platforms.terapeak, p)));
  assert.strictEqual(GCPPlatforms.ebayQuery(p), 'greninja gx (SV56,56,056) PSA 10');
  assert(G.matchCard('Greninja GX SV56/SV94 Hidden Fates Shiny Vault PSA 10', p).ok);
  assert(!G.matchCard('Greninja GX SV55 Hidden Fates PSA 10', p).ok);
  console.log('v4.9 tests passed');
}
