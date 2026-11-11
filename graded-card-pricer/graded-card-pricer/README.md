# Graded Card Pricer (Chrome extension) · v4.1

Reads the email or page you have open, finds graded Pokémon cards ("Umbreon VMAX 215/203 PSA 10",
"Charizard Base Set 4/102 BGS 9.5", PSA slab text like "#215 UMBREON VMAX GEM MT 10"), and shows recent **sold**
prices from eBay, PriceCharting, 130point, Alt and Collectr in one side panel.

## What you get

- **Scanning when you want it.** The current page is scanned once when you open the panel. After that the panel never
  rescans or re-prices by itself. Switch tabs and it offers a **Scan this page** button. (Background scanning with a
  badge count can be turned on in Settings.)
- **Cert lookup.** Type a slab's cert number (e.g. `140688778`, `CGC 4061234001`), or scan an email that contains one.
  With a free PSA API key in Settings, PSA certs are looked up instantly, with population counts. Without one, the PSA
  or CGC cert page opens in a tab and the card is read from it.
- **Sold-price summary:** averages for the last 1, 3, 5 and 7 days. Also the last sale, the lowest and highest sale
  this week, and a 30-day average. The boxes keep a fixed size while loading, so nothing jumps.
- **Price trend line chart:** the daily average over 7D / 30D / 90D / 1Y, every sale as a dot, period change, and a
  hover tooltip.
- **Recent sales:** one list across all sources, showing which marketplace each sale came from. Click a price to leave
  that sale out.
- **Exact-card matching.** Different grades, card numbers, card types (V vs VMAX) and versions are filtered out, each
  with a reason and a **Use** button to override. Versions that *every* sale of a card mentions (e.g. "Japanese" for a
  Japan-only promo) are treated as part of the card automatically. Type "English" to force English copies only.
- Deal check against an asking price, grade switcher, an "Other grades" table, a watchlist, and copy summary.

## Install / update

1. Go to `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and pick this `graded-card-pricer` folder. If an older version is loaded, remove it first or press its reload ↻ button.
3. Reload any open Gmail tabs so the new scanner runs there.

## How prices are gathered (v4)

- **Search wide, filter locally.** Each site is searched with just the Pokémon name, card type, number (both "90" and
  "090") and grade. Set names, edition and language are checked on the results instead, because sellers word them
  differently.
- **Exact card, exact grade.** A listing is rejected only for something it actually says:
  - a different grade;
  - a different number or set size ("090/128" when the card's sales say "/088");
  - a different card type (V vs VMAX);
  - a version you didn't ask for (e.g. "Unlimited", "English", "1st Edition");
  - a lot or proxy.

  A listing that just leaves out "1st Edition" or "Japanese" still counts. Every rejected listing shows its reason, with **Use** to override.
- **Every matching sale counts.** Best offers count, using 130point's real accepted price when it has one. Nothing is
  trimmed. The same eBay item reported by several sites counts once.
- **All in CAD.** Other currencies are converted at the Bank of Canada daily rate and marked "≈".
- **Summary:**
  - Today, 3-day, 5-day and 7-day averages.
  - Last sale, plus the average and low–high of the **last 10 sales**, so thinly traded cards still get a price.
  - 30-day average, a 90-day trend line, and every sale listed newest first.

| Source | What's read | Needs |
|---|---|---|
| eBay.ca | Sold listings (up to 3 pages) | Nothing |
| **Terapeak** | eBay's own research tool (Seller Hub → Research): sold listings with actual prices, incl. accepted best offers | Sign in to eBay in its 📱 window once (Terapeak is free in Seller Hub) |
| 130point | eBay + auction-house sales, incl. real best-offer prices | Nothing |
| PriceCharting | The exact product page (e.g. the 1st Edition version) and its graded sales | Nothing |
| **SNKRDUNK** | Japan's largest card marketplace: sales history per grade (PSA 10/9, BGS 9.5/10/Black Label), ¥ → CAD | Nothing |
| Card Ladder, Alt, Collectr | Your signed-in sales history / market price | 📱 Connect once |

## Current listings (lowest asks)

The cheapest matching **Buy It Now** listings on eBay.ca, in CAD with shipping, checked with the same exact-card and
exact-grade rules as sales. The lowest ask is compared with the average of the last 10 sales. With eBay keys in Settings
this uses eBay's standard listings API; without keys it reads eBay.ca's Buy It Now search. (eBay's sold-items API,
Marketplace Insights, is closed to new apps, so the keys are used for listings only.)

## Cert lookups

Type or scan a cert number. The extension tries **PSA's API** first (needs an approved key), then reads **PSA's cert page
directly in the background**. Either way the card, its edition (Variety) and grade become the search. No tab opens.
If PSA refuses both, the panel offers an "Open PSA cert page" button.

## Card details & population

Each search shows the card's image, set, card number and release date. A **population report** per grading company
lists how many slabs exist at each grade, with your grade highlighted. Also shown: how many are graded higher, the total
graded and the gem rate (share of 10s). Click any grade to price it.

| Population source | What it gives | Needs |
|---|---|---|
| PSA's official API | Exact PSA count per grade (including half grades), your slab's pop / pop higher, and the slab photos (front / back) | A cert lookup + an approved PSA API key (Settings → Test PSA key) |
| PriceCharting | PSA and CGC grades 1–10 (census updated monthly) | Nothing: loads with every search |
| Alt item page | PSA, BGS, CGC top grades (incl. 9.5, Black Label / Pristine) | Alt loaded or connected |
| PSA cert page | Your slab's population and pop higher | Cert lookup without a key |

For each grading company the panel uses PSA's official numbers when available, otherwise the most complete other source,
and names the source under the chart.

## Currency: everything in CAD

eBay is searched on **eBay.ca**, so its prices are already in CAD. Collectr, Alt and Card Ladder show CAD when you set CAD
in your account there; the extension also switches Collectr's currency menu to CAD and detects which currency each page
is showing. Anything that still arrives in another currency (PriceCharting and most of 130point only show US$) is converted at the
**Bank of Canada daily rate** and marked **≈ from USD …**. Untick *Include US$ sources (converted)* to use only native
CAD prices.

## How each source is read

| Source | How | Notes |
|---|---|---|
| eBay.ca | Sold + completed results, newest first, **up to 3 pages** (720 listings) | With eBay API keys (Settings) it uses eBay's official sold-items API instead: exact sale times, no blocking. eBay approves that API case by case. Without keys, if eBay refuses the background request, **Open sold results ↗** opens a normal tab; every results page you open there adds to the data. Settings: all eBay.ca sellers, or Canada-only. |
| 130point | Its sales search | If refused, **Search on 130point ↗** opens 130point, types the search for you, and the results are read from that tab. |
| PriceCharting | Matching product, then its completed-sales tables | US$ (converted) unless your PriceCharting account is set to CAD. |
| Card Ladder | Your signed-in Card Ladder sales history | **📱 Connect** once and sign in; the window then follows every search. |
| Alt | Your signed-in Alt: opens the matching item and reads only rows marked as sold | **📱 Connect** once and sign in. Browse results are active listings and are never counted. |
| Collectr | The matching product's price per grade | **📱 Connect** to use your paid account (phone-sized window); otherwise the public price loads quietly in the panel. |

**Connected windows:** Alt, Collectr and Card Ladder need your login, and Chrome keeps logins out of embedded panels.
Each gets one real phone-sized window. Sign in once, minimise it if you like, and it follows every new search.
Closing the window disconnects it.

**Date boxes:** calendar days in your time zone, counting today. "Today" = sold today; "Last 7 days" = today plus the 6
days before. Sales with an exact time (eBay API, 130point) are placed on your local date.

## Tests

```bash
node test/detect.test.js
```
