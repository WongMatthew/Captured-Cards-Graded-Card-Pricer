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

// --- windows: 1 day = today + yesterday, week = last 7 days + today
const sales = [0, 0, 1, 2, 3, 4, 5, 6, 7, 9].map((ago, i) => ({ price: 100 + i * 10, date: new Date(2026, 10, 6 - ago) }));
const w = G.windowStats(sales, now);
assert.strictEqual(w['1d'].count, 3);
assert.strictEqual(w['3d'].count, 5);
assert.strictEqual(w['5d'].count, 7);
assert.strictEqual(w['7d'].count, 9);
assert.strictEqual(w['1d'].avg, 110);
const trimmed = G.trimOutliers([...sales, { price: 5000, date: now }]);
assert(!trimmed.some(s => s.price === 5000));
assert.strictEqual(G.trimOutliers(sales).length, sales.length, 'normal spread must not be trimmed');
console.log('all detect tests passed');
