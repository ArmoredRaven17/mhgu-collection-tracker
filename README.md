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
- **Saved in your browser** — your collection is kept in this browser and loads
  automatically, so there's nothing to open each visit. Turn it off (and clear
  it) any time under **Storage** in the sidebar.
- **File saves too** — save your collection to a JSON file for backups or to move
  it to another device (File System Access API in Chrome/Edge, download/upload
  fallback elsewhere).

## Local development

There is no build step. The stats data is lazy-loaded with `fetch()`, which
browsers block on `file://`, so serve `docs/` over HTTP:

```
cd docs
python -m http.server 8000
```

Then open http://localhost:8000/.

## Regenerating data

Two generators, with separate ownership of the output files — they do not
overlap, so the order does not matter.

**1. Weapons, Palico gear, the catalog and icons** come from the
[mhgu-editor](https://github.com/redacted/mhgu-editor) repo's data files
(which in turn derive from Kiranico), plus crafting-material recipes from the MHGU
database (`mhgu.db`):

```
node scripts/build-data.mjs "C:/Coding Repos/mhgu-editor" --icons
```

This rewrites `docs/data/catalog.js`, the weapon and Palico files under
`docs/data/stats/` and `docs/data/materials/`, and (with `--icons`) copies the
equipment icons into `docs/assets/icons/`.

**2. Armor** comes from the game's own data tables, read from a local dump of
MHGU (`nativeNX/table`). Nothing from the dump is committed — only the generated
JSON:

```
node scripts/build-armor-data.mjs "<path to nativeNX/table>" --check
```

This rewrites `docs/data/stats/armor_*.json`, `docs/data/materials/armor_*.json`
and `docs/data/armor_levels.js`. `--check` cross-validates every decoded field
against `mhgu.db` and reports any mismatch. Armor stats and materials are
deliberately *not* written by `build-data.mjs`, so re-running it will not clobber
them.

**Materials input:** the generator reads `data-src/mhgu.db` (gitignored — not
redistributed). Download it from
[JoeLago/MHGUDB-iOS](https://github.com/JoeLago/MHGUDB-iOS) at
`MHGUDB/Assets/databases/mhgu.db` and place it there, or pass `--db <path>`.
If the DB is absent the generator skips materials and builds everything else.

## Cache busting

GitHub Pages caches assets by full URL. When you change `styles.css`, `app.js`,
or `data/catalog.js`, bump the `?v=N` query string on its tag in `index.html`.

## AI assistance

Most of this project's code — the app, both data generators, and this README —
was written with [Claude Code](https://claude.com/claude-code), Anthropic's AI
coding tool, working from the author's direction and reviewed before landing.
Commits made that way carry a `Co-Authored-By: Claude` trailer.

## Licensing

Code is MIT (see [LICENSE](LICENSE)). Game data and icons come from third
parties with their own terms — see [NOTICE.md](NOTICE.md). Monster Hunter
Generations Ultimate is © Capcom Co., Ltd.; this is an unofficial fan project.
