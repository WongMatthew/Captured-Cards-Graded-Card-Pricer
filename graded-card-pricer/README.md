# Graded Card Pricer (Chrome extension) · v3.1

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
