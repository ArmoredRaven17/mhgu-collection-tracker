# Notices and Attributions

This project bundles game data and icons derived from third-party sources.
The original source code of this project is MIT-licensed (see
[LICENSE](LICENSE)). The following third-party materials retain their own
licenses and require attribution.

---

## Game IP

**Monster Hunter Generations Ultimate** and all related characters, item
names, monster names, armor, weapons, and other in-game assets are
trademarks and © Capcom Co., Ltd. This project is an **unofficial fan-made
collection tracker**. It is not affiliated with, endorsed by, or sponsored
by Capcom.

---

## Game Data

### Armor — extracted from the game's own data files

Armor stats, resistances, decoration slots, skills, upgrade levels,
per-level upgrade costs, crafting recipes, and forge prices are extracted
directly from **Monster Hunter Generations Ultimate's own data tables**
(`nativeNX/table`), read from a copy of the game dumped by the author from a
personally-owned cartridge. The extraction is performed by
[scripts/build-armor-data.mjs](scripts/build-armor-data.mjs), which emits
this project's own JSON schema into [docs/data/stats/](docs/data/stats/) and
[docs/data/materials/](docs/data/materials/).

**No game files, extracted archives, or decryption keys are redistributed by
this project.** The dump is a local, gitignored input; only the generated
data tables are committed. The underlying facts and all in-game names remain
Capcom's property (see *Game IP* above).

Armor data was previously sourced from Kiranico and the community database
described below; it no longer is, and those sources are credited here for
the remaining categories and for naming.

### Kiranico (https://mhgu.kiranico.com/)

Weapon and Palico-equipment names and stat tables originate from Kiranico's
MHGU database, by way of the
[mhgu-editor](https://github.com/redacted/mhgu-editor) project's data
files. They are compiled into [docs/data/catalog.js](docs/data/catalog.js)
and [docs/data/stats/](docs/data/stats/) by
[scripts/build-data.mjs](scripts/build-data.mjs). Kiranico does not publish
a formal data license; this attribution is offered as courtesy
acknowledgment of their fan-database work. If the maintainers of Kiranico
object to this use, please open an issue and the affected data will be
reviewed or removed.

### Crafting materials and English naming — gatheringhallstudios / JoeLago

The weapon and Palico crafting-material lists in
[docs/data/materials/](docs/data/materials/) are derived from the MHGU
database (`mhgu.db`) bundled in
[JoeLago/MHGUDB-iOS](https://github.com/JoeLago/MHGUDB-iOS) (MIT-licensed),
which in turn is built on the community database from
[gatheringhallstudios/MHGenDatabase](https://github.com/gatheringhallstudios/MHGenDatabase).

That database also supplies the **English item, skill, and equipment names
used throughout this project, including for armor.** The game's own data
tables store names in Japanese only, so while the armor *numbers* now come
from the game, the English *naming* still rests on this community work.
`mhgu.db` is additionally used to verify the armor extraction: every decoded
field is cross-checked against it by `build-armor-data.mjs --check`.

Only the factual recipe and naming data is extracted and re-emitted in this
project's own JSON schema; no source code, schema, or image assets from
those projects are redistributed. Attribution is offered as courtesy
acknowledgment of that community data work.

---

## Icons

### Monster Hunter Wiki (monsterhunterwiki.org) — equipment icons

The equipment-type icons under [docs/assets/icons/](docs/assets/icons/)
(`icon_<slug>.png` Base variants plus the `_r1`–`_r10` and `_rX`
rarity-coloured variants) are sourced from
[Category:MHGU Equipment Icons](https://monsterhunterwiki.org/wiki/Category:MHGU_Equipment_Icons)
on the independent Monster Hunter Wiki, via the mhgu-editor project's
AI-upscale/tint pipeline (Real-ESRGAN upscale of each 24×24 Base to 96×96,
then per-rarity multiply tints matching the wiki source colours).

**monsterhunterwiki.org content is licensed under
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).** By the
share-alike clause, the upscaled and tint-derived variants bundled here are
shared under the same licence. Underlying Capcom game sprites remain Capcom
property regardless of which community wiki redistributes them.

### Monster Hunter Wiki (Fandom) — monster icons

The monster icons under [docs/assets/MonsterIcons/](docs/assets/MonsterIcons/)
(used by the theme colour picker, carried over from the MHGU Quest
Randomizer project) come from the Fandom community wiki,
https://monsterhunter.fandom.com/. **Fandom community content is licensed
under [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/);** any
adaptations are shared under the same licence.

---

## Fonts

The MHFU display font under [docs/fonts/](docs/fonts/) is a fan-made
recreation of the Monster Hunter interface typeface, carried over from the
MHGU Quest Randomizer project.

---

## Reporting Misattribution

If a person, project, or organization is misattributed or omitted from this
notice, please open an issue on the project repository and the file will be
updated.
