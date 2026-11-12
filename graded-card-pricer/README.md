# Graded Card Pricer (Chrome extension) · v5.3

Reads the email or page you have open, finds graded Pokémon cards ("Umbreon VMAX 215/203 PSA 10",
"Charizard Base Set 4/102 BGS 9.5", PSA slab text like "#215 UMBREON VMAX GEM MT 10"), and shows recent **sold**
prices from eBay.ca, Terapeak, PriceCharting, SNKRDUNK, Pokemon Price Tracker, Card Ladder and Alt in one side panel.

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
- **Every matching sale counts.** Best offers count, using the real accepted price when Terapeak or Card Ladder has it. Nothing is
  trimmed. **Each sale counts once.** The same eBay item number reported by several sites is one sale. Sources without item
  numbers (Card Ladder, Alt, some PriceCharting rows) are matched on marketplace, day (±1), price (exact in
  the same currency, within 2.5% after conversion) and title. Two sales from the same source are never merged, so a
  seller's two identical copies sold the same day both count. The merged sale lists every site that reported it.
- **All in CAD.** Other currencies are converted at the Bank of Canada daily rate and marked "≈".
- **Summary:**
  - Today, 3-day, 5-day and 7-day averages.
  - Last sale, plus the average and low–high of the **last 10 sales**, so thinly traded cards still get a price.
  - 30-day average, a 90-day trend line (hover for a day; **drag across it to see the average, median, range and number of sales for that period**), and every sale listed newest first.

| Source | What's read | Needs |
|---|---|---|
| eBay.ca | Sold listings (up to 3 pages) | Nothing |
| **Terapeak** | eBay.com research tool (Seller Hub → Research), searched with exactly the words you typed: sold listings with actual prices, incl. accepted best offers (US$ → CAD) | Sign in to eBay in its 📱 window once (Terapeak is free in Seller Hub) |
| **Pokemon Price Tracker** (API key) | eBay graded-sales database. Business plan: every sold listing, which joins your sales. Other paid plans: a per-grade summary (smart price, median, 7-day price, trend) shown as a reference. Uses the 1st Edition pool when you search 1st Edition. | API key in Settings |
| PriceCharting | The exact product page (e.g. the 1st Edition version) and its graded sales | Nothing |
| **SNKRDUNK** | Japan's largest card marketplace: sales history per grade (PSA 10/9, BGS 9.5/10/Black Label), ¥ → CAD | Nothing |
| Card Ladder, Alt | Your signed-in sales history and value. Alt: sign in once in its window and it continues to the card, opens it, and reads its sold history (never listings or bids). | 📱 Connect once |

## Current listings (lowest asks)

The cheapest matching **Buy It Now** listings on eBay.ca, in CAD with shipping, checked with the same exact-card and
exact-grade rules as sales. The lowest ask is compared with the average of the last 10 sales. With eBay keys in Settings
this uses eBay's standard listings API; without keys it reads eBay.ca's Buy It Now search. (eBay's sold-items API,
Marketplace Insights, is closed to new apps, so the keys are used for listings only.)

## Cert lookups

Type or scan a cert number. The extension tries **PSA's API** first (needs an approved key), then reads **PSA's cert page
directly in the background**. Either way the card, its edition (Variety) and grade become the search. No tab opens.
If PSA refuses both, the panel offers an "Open PSA cert page" button.

## Offer guide

Under the price: your usual offers as a percentage of the card's value (the average of the last 10 sales). The defaults
are **70%** and **80%**; change them in Settings → Offer guide. Click one to put it in the Asking / offer box, which
shows what percentage of value any price is.

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

eBay is searched on **eBay.ca**, so its prices are already in CAD. Alt and Card Ladder show CAD when you set CAD
in your account there; the extension detects which currency each page
is showing. Anything that still arrives in another currency (PriceCharting, Terapeak, Alt and Card Ladder show US$) is converted at the
**Bank of Canada daily rate** and marked **≈ from USD …**. Every matching sale counts.

## How each source is read

| Source | How | Notes |
|---|---|---|
| eBay.ca | Sold + completed results, newest first, **up to 3 pages** (720 listings) | With eBay API keys (Settings) it uses eBay's official sold-items API instead: exact sale times, no blocking. eBay approves that API case by case. Without keys, if eBay refuses the background request, **Open sold results ↗** opens a normal tab; every results page you open there adds to the data. Settings: all eBay.ca sellers, or Canada-only. |
| PriceCharting | Matching product, then its completed-sales tables | US$ (converted) unless your PriceCharting account is set to CAD. |
| Card Ladder | Your signed-in Card Ladder sales history | **📱 Connect** once and sign in; the window then follows every search. |
| Alt | Your signed-in Alt: opens the matching item and reads only rows marked as sold | **📱 Connect** once and sign in. Browse results are active listings and are never counted. |

**Card Ladder (and other signed-in sources) set up once:**
1. In the panel, open the **Card Ladder** row and press **📱 Connect**.
2. In the window that opens, pass any security check and sign in to your PRO account.
3. Search one card yourself in Card Ladder's **Sales History**. The extension learns that page from your search.

From then on every search in the panel opens that page for the new card. Every sale row (date, price, title, marketplace)
and Card Ladder's value are read into the panel in CAD, using the same exact-card and grade filtering. Alt and
Terapeak learn the same way.

**Connected windows:** Alt and Card Ladder need your login, and Chrome keeps logins out of embedded panels.
Each gets one real phone-sized window. Sign in once, minimise it if you like, and it follows every new search.
Closing the window disconnects it.

**Date boxes:** calendar days in your time zone, counting today. "Today" = sold today; "Last 7 days" = today plus the 6
days before. Sales with an exact time (Pokemon Price Tracker) are placed on your local date.

## Tests

```bash
node test/detect.test.js
```