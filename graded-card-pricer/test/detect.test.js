const assert = require('assert');
const G = require('../src/detect.js');
const now = new Date(2026, 10, 5, 15, 0);

const email = `From: seller@example.com
Subject: Re: WTS Umbreon VMAX 215/203 Evolving Skies PSA 10 - $1,850 shipped
Hey, also have these:
Charizard Base Set 4/102 Holo BGS 9.5
Pikachu Illustrator
PSA 9
Gengar VMAX 271/264 Fusion Strike CGC Pristine 10 $420
Order total: $14.99`;
const cards = G.detectCards(email);
console.log(cards.map(c => c.query));
assert(cards.some(c => /Umbreon VMAX/.test(c.name) && c.number === '215/203' && c.grader === 'PSA' && c.grade === '10'));
assert(cards.some(c => /Charizard/.test(c.name) && c.grader === 'BGS' && c.grade === '9.5'));
assert(cards.some(c => /Pikachu Illustrator/.test(c.name) && c.grade === '9'));
assert(cards.some(c => /Gengar/.test(c.name) && c.grader === 'CGC' && c.grade === '10'));

assert(G.titleMatchesGrade('2021 Umbreon VMAX 215/203 PSA 10 GEM MINT', 'PSA', '10'));
assert(!G.titleMatchesGrade('Umbreon VMAX PSA 9 MINT', 'PSA', '10'));
assert(!G.titleMatchesGrade('Charizard BGS 9.5 Gem Mint', 'BGS', '9'));
assert(G.titleMatchesGrade('Charizard Beckett 9.5', 'BGS', '9.5'));
assert(!G.titleMatchesGrade('Charizard PSA 100 lot', 'PSA', '10'));

assert.strictEqual(G.parsePrice('$1,234.56'), 1234.56);
assert.strictEqual(G.parsePrice('US $45.00'), 45);
const d = (s) => { const x = G.parseDate(s, now); return x && x.toDateString(); };
assert.strictEqual(d('Sold Nov 3, 2026'), new Date(2026, 10, 3).toDateString());
assert.strictEqual(d('2026-11-01'), new Date(2026, 10, 1).toDateString());
assert.strictEqual(d('Date: Thu 30 Oct 2026 18:22'), new Date(2026, 9, 30).toDateString());
assert.strictEqual(d('2 days ago'), new Date(2026, 10, 3).toDateString());
assert.strictEqual(d('Dec 28'), new Date(2025, 11, 28).toDateString());
assert.strictEqual(d('yesterday'), new Date(2026, 10, 4).toDateString());

const sales = [0, 0, 1, 2, 3, 4, 5, 6, 7, 9].map((ago, i) => ({ price: 100 + i * 10, date: new Date(2026, 10, 5 - ago) }));
const w = G.windowStats(sales, now);
assert.strictEqual(w['1d'].count, 3);   // today x2 + yesterday
assert.strictEqual(w['3d'].count, 5);
assert.strictEqual(w['5d'].count, 7);
assert.strictEqual(w['7d'].count, 9);   // 9-days-ago excluded
assert.strictEqual(w['1d'].avg, 110);
const trimmed = G.trimOutliers([...sales, { price: 5000, date: now }]);
assert(!trimmed.some(s => s.price === 5000));
console.log('detect tests passed');
const c2 = G.detectCards("Hi! I'd like to buy your Umbreon VMAX 215/203 Evolving Skies PSA 10 for $1,700.\nAlso interested in Charizard Base Set 4/102 PSA 9.");
console.log(c2.map(c => c.query));
assert(c2.some(c => c.query === 'Umbreon VMAX Evolving Skies 215/203 PSA 10'));
assert(c2.some(c => c.query === 'Charizard Base Set 4/102 PSA 9'));
assert(G.titleMatchesGrade('Charizard PSA 9.', 'PSA', '9'));
console.log('sentence tests passed');
