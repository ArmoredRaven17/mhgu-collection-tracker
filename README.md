# MHGU Collection Tracker

A web app for tracking your **Monster Hunter Generations Ultimate** equipment
collection — every weapon, armor piece, and Palico gear item, with an "owned"
checkbox and full stats for each entry.

**Live:** https://armoredraven17.github.io/mhgu-collection-tracker/ *(GitHub Pages, served from `docs/`)*

## Features

- All 14 weapon classes (~1,500 weapon trees), hunter armor (Head/Chest/Arms/Waist/Legs,
  gender variants merged), and Palico weapons/helmets/armor.
- Click a cell to see stats: raw/affinity/element/sharpness per upgrade level for
  weapons, defense/resistances/skills for armor.
- Ctrl+click a cell to toggle owned without opening the detail panel.
- Progress tracking per category and overall.
- **File-based saves** — your collection is saved to a JSON file you keep
  (File System Access API in Chrome/Edge, download/upload fallback elsewhere).
  A localStorage autosave acts as a crash safety net only.

## Local development

There is no build step. The stats data is lazy-loaded with `fetch()`, which
browsers block on `file://`, so serve `docs/` over HTTP:

```
cd docs
python -m http.server 8000
```

Then open http://localhost:8000/.

## Regenerating data

Game data and icons are generated from the [mhgu-editor](https://github.com/AHumphrey17/mhgu-editor)
repo's data files (which in turn derive from Kiranico):

```
node scripts/build-data.mjs "C:/Coding Repos/mhgu-editor" --icons
```

This rewrites `docs/data/catalog.js`, `docs/data/stats/*.json`, and (with
`--icons`) copies the equipment icons into `docs/assets/icons/`.

## Cache busting

GitHub Pages caches assets by full URL. When you change `styles.css`, `app.js`,
or `data/catalog.js`, bump the `?v=N` query string on its tag in `index.html`.

## Licensing

Code is MIT (see [LICENSE](LICENSE)). Game data and icons come from third
parties with their own terms — see [NOTICE.md](NOTICE.md). Monster Hunter
Generations Ultimate is © Capcom Co., Ltd.; this is an unofficial fan project.
