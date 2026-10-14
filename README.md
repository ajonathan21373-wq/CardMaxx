# CardMaxx

Know which credit card to use, everywhere you pay.

CardMaxx ranks the cards in your wallet for any store, restaurant or spending category, and builds a plan around your goal (travel, cash back, or a mix). It's a static web app hosted on GitHub Pages and can be installed to a phone's home screen.

## What's in here

| Path | What it is |
| --- | --- |
| `index.html` | The page itself |
| `css/styles.css` | All styling, including light and dark themes |
| `js/app.js` | Search, ranking, wallet settings and the goal-based plan |
| `data/cards.json` | Each card's earning rates, point currencies and rotating bonus quarters |
| `data/merchants.json` | Stores and restaurants, with their spending category |
| `data/categories.json` | Spending categories, their usual merchant codes (MCCs) and search words |
| `manifest.webmanifest`, `icons/` | Home-screen install details and app icons |
| `sw.js` | Offline support and caching |

## Updating the data

Most updates only touch the `data/` folder, so they don't need any code changes.

- **New Discover quarter:** add an entry to the `rotating` list on the Discover card in `data/cards.json` with its start date, end date, categories, rate and cap.
- **Card earning change:** edit that card's `rates` in `data/cards.json`, then update `"updated"` at the top of the file.
- **New store or restaurant:** add `{ "name": "...", "category": "dining" }` to `data/merchants.json`. Add `aliases` for other spellings and a `note` for anything unusual about how it codes.

After changing app files (not data), bump `VERSION` in `sw.js` so installed copies refresh.

## Running it locally

Any static server works, for example:

```
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Privacy

There are no accounts and no server. Your cards, goals and spending are saved in your browser's local storage on your own device.
