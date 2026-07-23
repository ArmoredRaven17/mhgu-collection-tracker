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

### Kiranico (https://mhgu.kiranico.com/)

Weapon, armor, skill, and Palico-equipment names and stat tables originate
from Kiranico's MHGU database, by way of the
[mhgu-editor](https://github.com/AHumphrey17/mhgu-editor) project's data
files. They are compiled into [docs/data/catalog.js](docs/data/catalog.js)
and [docs/data/stats/](docs/data/stats/) by
[scripts/build-data.mjs](scripts/build-data.mjs). Kiranico does not publish
a formal data license; this attribution is offered as courtesy
acknowledgment of their fan-database work. If the maintainers of Kiranico
object to this use, please open an issue and the affected data will be
reviewed or removed.

### Crafting materials — gatheringhallstudios / JoeLago

The weapon and armor crafting-material lists in
[docs/data/materials/](docs/data/materials/) are derived from the MHGU
database (`mhgu.db`) bundled in
[JoeLago/MHGUDB-iOS](https://github.com/JoeLago/MHGUDB-iOS) (MIT-licensed),
which in turn is built on the community database from
[gatheringhallstudios/MHGenDatabase](https://github.com/gatheringhallstudios/MHGenDatabase).
Only the factual recipe data (which materials and quantities craft or
upgrade each item) is extracted and re-emitted in this project's own JSON
schema by [scripts/build-data.mjs](scripts/build-data.mjs); no source code,
schema, or image assets from those projects are redistributed. Attribution
is offered as courtesy acknowledgment of that community data work.

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
