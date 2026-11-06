# Graded Card Pricer (Chrome extension) · v2

Reads the email or page you have open, finds graded Pokémon cards ("Umbreon VMAX 215/203 PSA 10",
"Charizard Base Set 4/102 BGS 9.5", PSA slab text like "#215 UMBREON VMAX GEM MT 10"), and shows recent **sold**
prices from eBay, PriceCharting, 130point, Alt and Collectr in one side panel.

## What you get

- **Averages for the last 1, 3, 5 and 7 days.** Each shows the sale count, median, range, the dates it covers and the
  change against the 7-day average. A 30-day average appears underneath.
- **Exact-card matching.** Each listing is checked against the card before it counts. Rejected: different grade
  (PSA 9 ≠ PSA 9.5 ≠ 10, BGS 10 ≠ Black Label, CGC 10 ≠ Pristine), different card number, different card type
  (V ≠ VMAX), and variants you didn't ask for (1st Edition, Shadowless, Japanese, Base Set 2, Celebrations reprints,
  4th prints, errors, jumbos, lots, proxies). Each card lists everything it filtered out, with the reason, and a
  **Use** button if you disagree.
- **Click any sale's price** to leave it out of the averages. Your choice is remembered for that card.
- **Each sale is counted once,** even when eBay, 130point and PriceCharting all report it. eBay "best offer accepted"
  sales are left out unless 130point shows the real price (toggle available).
- **Deal check.** It picks up an asking price from the email ("…PSA 10 for $1,700") or you can type one.
  It shows how far that is above or below the 7-day average and median, and draws it on the chart.
- **Grade switcher** (PSA 10 / 9 / 8, BGS, CGC, SGC, TAG) and an **Other grades** table: 30-day averages for every grade
  of the same card, plus Collectr's price per grade. Click a grade to re-price.
- **Watchlist.** Press ☆ Watch to track a card. Its 7-day average is saved each time you price it, with the change since last time.
- **Copy** puts a plain-text price summary on your clipboard to paste to a buyer or seller.
- **Alt and Collectr in phone layout.** Their mini views load the mobile version of each site. **📱 Phone** opens a
  phone-sized window, a real tab where you're signed in, and the extension reads data there too.
- Shortcut **Alt+Shift+P** opens the panel. Highlight any text → right-click → **Price graded card**.

## Install / update

1. Go to `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and pick this `graded-card-pricer` folder. If an older version is loaded, remove it first or press its reload ↻ button.
3. Reload any open Gmail tabs so the new scanner runs there.

## How each platform is read

| Platform | How | Notes |
|---|---|---|
| eBay | Sold + Completed search, with lots and proxies excluded in the query | Uses your browser session. Stops at eBay's "results matching fewer words" section. Non-USD prices are ignored. |
| PriceCharting | Picks the matching product, then reads its completed-sales tables | Product is picked by card number and name; variants (1st Ed, Base Set 2…) are avoided. |
| 130point | Its sales search | Supplies the real price for accepted best offers. |
| Alt | Opens the matching item, then reads only rows marked as sold or listed under a sales-history heading | Browse results are **active listings** and are never counted. Alt only shows sold history to signed-in users, so use **📱 Phone** and log in. |
| Collectr | Mobile site: finds the exact product, then reads the price for each grade | Collectr's website has no list of individual graded sales (that's only in its phone app). The extension reports Collectr's market price for your grade. It doesn't count toward the date averages because it has no sale dates. |

The mini views work through session-only header rules that apply only to frames inside this extension's panel and to
its phone windows. Your normal browsing is untouched.

Date windows: sale dates have no time of day, so **last N days = today plus the N previous days**. "Last 1 day" therefore
includes yesterday's sales.

## Tests

```bash
node test/detect.test.js
```
