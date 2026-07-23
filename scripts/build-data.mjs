// build-data.mjs — generate the collection tracker's data from the mhgu-editor
// project's source JSON. Run manually; commit the outputs.
//
//   node scripts/build-data.mjs "C:/Coding Repos/mhgu-editor" [--icons]
//
// Zero dependencies, Node >= 18 (ESM). Reads <editor>/src/assets/*.json (and
// <editor>/public/icons/ with --icons); writes docs/data/ (and docs/assets/icons/).

import { readFileSync, writeFileSync, copyFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const OUT_DATA = join(REPO, 'docs', 'data');
const OUT_STATS = join(OUT_DATA, 'stats');
const OUT_ICONS = join(REPO, 'docs', 'assets', 'icons');

const args = process.argv.slice(2);
const doIcons = args.includes('--icons');
const editorRoot = (args.find(a => !a.startsWith('--')) || 'C:/Coding Repos/mhgu-editor');
const ASSETS = join(editorRoot, 'src', 'assets');
const ICONS_SRC = join(editorRoot, 'public', 'icons');

const J = f => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const kb = n => (n / 1024).toFixed(0) + ' KB';
const warnings = [];
const warn = m => warnings.push(m);

// ── Weapon class definitions (display order) ──────────────────────────────
const WEAPON_CLASSES = [
  { name: 'Great Sword',     slug: 'great_sword',      file: 'greatsword.json' },
  { name: 'Long Sword',      slug: 'long_sword',       file: 'longsword.json' },
  { name: 'Sword & Shield',  slug: 'sword_and_shield', file: 'swordandshield.json' },
  { name: 'Dual Blades',     slug: 'dual_blades',      file: 'dualblades.json' },
  { name: 'Hammer',          slug: 'hammer',           file: 'hammer.json' },
  { name: 'Hunting Horn',    slug: 'hunting_horn',     file: 'huntinghorn.json' },
  { name: 'Lance',           slug: 'lance',            file: 'lance.json' },
  { name: 'Gunlance',        slug: 'gunlance',         file: 'gunlance.json' },
  { name: 'Switch Axe',      slug: 'switch_axe',       file: 'switchaxe.json' },
  { name: 'Charge Blade',    slug: 'charge_blade',     file: 'chargeblade.json' },
  { name: 'Insect Glaive',   slug: 'insect_glaive',    file: 'insectglaive.json' },
  { name: 'Bow',             slug: 'bow',              file: 'bow.json' },
  { name: 'Light Bowgun',    slug: 'light_bowgun',     file: 'lightbowgun.json' },
  { name: 'Heavy Bowgun',    slug: 'heavy_bowgun',     file: 'heavybowgun.json' },
];

const ARMOR_SLOTS = [
  { name: 'Head',  key: 'head',  equipType: '1', icon: 'armor_head' },
  { name: 'Chest', key: 'chest', equipType: '2', icon: 'armor_body' },
  { name: 'Arms',  key: 'arms',  equipType: '3', icon: 'armor_arms' },
  { name: 'Waist', key: 'waist', equipType: '4', icon: 'armor_waist' },
  { name: 'Legs',  key: 'legs',  equipType: '5', icon: 'armor_legs' },
];

// ── Helpers ───────────────────────────────────────────────────────────────
const sortIds = obj => Object.keys(obj).map(Number).sort((a, b) => a - b);

// Some Kiranico source files contain mojibake: UTF-8 bytes decoded as
// Windows-1252 (e.g. "L'Ã‰gide" for "L'Égide"). Reverse it by encoding the
// string back to cp1252 bytes and decoding those as UTF-8.
const CP1252_HIGH = { '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86,
  '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e, '‘': 0x91,
  '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99,
  'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f };
function fixMojibake(s) {
  if (typeof s !== 'string' || !/[ÃÂ]|â€/.test(s)) return s;
  const bytes = [];
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if (cp <= 0xff) bytes.push(cp);
    else if (ch in CP1252_HIGH) bytes.push(CP1252_HIGH[ch]);
    else return s;                 // char outside cp1252 — not this mojibake, leave as-is
  }
  const repaired = Buffer.from(bytes).toString('utf8');
  return /�/.test(repaired) ? s : repaired;
}

function normElements(l) {
  const out = [];
  const push = e => { if (e && e.type) out.push(e.awakened ? [e.type, e.value, 1] : [e.type, e.value]); };
  if (l.element) push(l.element);
  if (Array.isArray(l.elements)) l.elements.forEach(push);
  return out;
}
function shArr(s) {
  return s ? [s.red || 0, s.orange || 0, s.yellow || 0, s.green || 0, s.blue || 0, s.white || 0, s.purple || 0] : null;
}
function sharpness(l) {
  if (!l.sharpness) return null;
  const { base, plus1, plus2 } = l.sharpness;
  return [shArr(base), shArr(plus1), shArr(plus2)].filter(Boolean);
}

// Class-specific extras, trimmed.
function classExtras(slug, l) {
  const x = {};
  switch (slug) {
    case 'hunting_horn':
      if (l.notes) x.notes = l.notes;
      break;
    case 'gunlance':
      if (l.shell) x.shell = `${l.shell.type} Lv${l.shell.level}`;
      break;
    case 'switch_axe':
    case 'charge_blade':
      if (l.phial) x.phial = l.phial.type + (l.phial.value ? ` ${l.phial.value}` : '');
      break;
    case 'insect_glaive':
      if (l.kinsect) {
        const k = l.kinsect;
        x.kinsect = { name: k.name, type: k.attackType, power: k.power, weight: k.weight, speed: k.speed };
      }
      break;
    case 'bow':
      if (l.arcShot) x.arc = l.arcShot;
      if (Array.isArray(l.charges)) x.charges = l.charges.map(c => c.shot + (c.requiresLoadUp ? '!' : ''));
      if (Array.isArray(l.coatings)) x.coatings = l.coatings.filter(c => c.usable).map(c => c.name);
      break;
    case 'light_bowgun':
    case 'heavy_bowgun': {
      if (l.stats) x.stats = { reload: l.stats.reload, recoil: l.stats.recoil, deviation: l.stats.deviation };
      if (l.siegeMode) x.siege = l.siegeMode;
      if (l.ammo) {
        const ammo = {};
        for (const [name, variants] of Object.entries(l.ammo)) {
          if (Array.isArray(variants) && variants.some(v => v.usable)) {
            ammo[name] = variants.map(v => v.usable ? v.capacity : 0);
          }
        }
        if (Object.keys(ammo).length) x.ammo = ammo;
      }
      if (Array.isArray(l.rapidFire) && l.rapidFire.length)
        x.rapidFire = l.rapidFire.map(r => ({ ammo: r.ammo, cap: r.capacity, power: r.power, wait: r.wait }));
      if (Array.isArray(l.internalShots) && l.internalShots.length)
        x.internal = l.internalShots.map(s => ({ ammo: s.ammo, cap: s.capacity, total: s.total }));
      break;
    }
  }
  return Object.keys(x).length ? x : undefined;
}

// ── Build ───────────────────────────────────────────────────────────────
const catalog = { version: 1, weapons: {}, armor: {}, palico: {} };
const counts = { weapons: 0, armor: 0, palico: 0 };

// Weapons — catalog + per-class stats
const weaponsRaw = J('weapons.json');
const weaponRarity = J('weapon_rarity.json');
for (const cls of WEAPON_CLASSES) {
  const names = weaponsRaw[cls.name];      // id -> name
  const rar = weaponRarity[cls.name] || {};
  if (!names) { warn(`weapons.json missing class "${cls.name}"`); continue; }

  const kiranico = JSON.parse(readFileSync(join(ASSETS, cls.file), 'utf8'));
  const treeByBase = new Map();
  for (const t of kiranico.trees) treeByBase.set(fixMojibake(t.baseName), t);
  const nameToId = new Map(Object.entries(names).map(([id, n]) => [n, Number(id)]));

  // assert every tree baseName maps to a catalog id
  for (const base of treeByBase.keys()) {
    if (!nameToId.has(base))
      warn(`${cls.name}: tree baseName "${base}" has no id in weapons.json`);
  }

  const entries = [];
  const byId = {};
  for (const id of sortIds(names)) {
    const name = names[id];
    const tree = treeByBase.get(name);
    let finalName = 0;
    if (tree && tree.levels.length) {
      const last = tree.levels[tree.levels.length - 1];
      const lastName = fixMojibake(last.name);
      if (lastName && lastName !== name) finalName = lastName;
      byId[id] = tree.levels.map(l => {
        const lv = { n: fixMojibake(l.name), lv: l.level, raw: l.raw, aff: l.affinity || 0, def: l.defense || 0, slots: l.slots, rar: l.rarity };
        const ele = normElements(l); if (ele.length) lv.ele = ele;
        const sh = sharpness(l); if (sh) lv.sh = sh;
        const x = classExtras(cls.slug, l); if (x) lv.x = x;
        return lv;
      });
    } else {
      warn(`${cls.name}: id ${id} "${name}" has no stat tree`);
    }
    entries.push([Number(id), name, rar[id] || 0, finalName]);
  }
  catalog.weapons[cls.slug] = { label: cls.name, icon: cls.slug, entries };
  counts.weapons += entries.length;
  writeFileSync(join(OUT_STATS, cls.slug + '.json'), JSON.stringify({ class: cls.slug, byId }));
}

// Armor — dedupe (non-craftable drop + gender merge) then catalog + stats
const armorRaw = J('armor.json');
const armorRarity = J('armor_rarity.json');
const armorSlots = J('armor_slots.json');       // keyed by equipType "1".."5"
const armorKir = J('armor_kiranico.json');       // by name
const mhguArmors = J('mhgu_armors.json');
const nonCraft = J('non_craftable_armor.json');
const genderMap = J('gender_armor_map.json');

const setByName = new Map(mhguArmors.armor_pieces.map(p => [p.name, p.set_name || 0]));

// female_id -> male_id (pairs apply across all slots)
const femaleToMale = new Map();
for (const grp of genderMap) for (const p of grp.pairs) femaleToMale.set(p.female_id, p.male_id);

// non-craftable drop set, per equipType -> Set(equip_id)
const dropByType = {};
for (const list of Object.values(nonCraft))
  for (const { equip_type, equip_id } of list) (dropByType[equip_type] ||= new Set()).add(equip_id);

for (const slot of ARMOR_SLOTS) {
  const names = armorRaw[slot.name];           // id -> name
  const rar = armorRarity[slot.name] || {};
  const deco = armorSlots[slot.equipType] || {};
  const drop = dropByType[slot.equipType] || new Set();
  const remap = {};                            // femaleId -> maleId, for import
  const entries = [];
  const statById = {};

  for (const id of sortIds(names)) {
    if (drop.has(id)) continue;
    if (femaleToMale.has(id)) {                // female variant: fold into male, skip
      remap[id] = femaleToMale.get(id);
      continue;
    }
    const name = names[id];
    // find female counterpart id in this slot (if this id is a male in a pair)
    let femaleId = 0, femaleName = 0;
    for (const [fid, mid] of femaleToMale) {
      if (mid === id && names[fid]) { femaleId = fid; femaleName = names[fid]; break; }
    }
    entries.push([id, name, rar[id] || 0, deco[id] || 0, setByName.get(name) || 0, femaleId, femaleName]);

    const k = armorKir[name];
    if (k) {
      const r = k.resistances || {};
      statById[id] = {
        def: [k.defense_min ?? 0, k.defense_max ?? 0],
        res: [r.fire || 0, r.water || 0, r.thunder || 0, r.ice || 0, r.dragon || 0],
        slots: k.slots || 0,
        sk: (k.skills || []).map(s => [s.name, s.points]),
      };
    } else {
      warn(`armor ${slot.name}: no Kiranico stats for "${name}" (id ${id})`);
    }
  }
  catalog.armor[slot.key] = { label: slot.name, icon: slot.icon, entries, remap };
  counts.armor += entries.length;
  writeFileSync(join(OUT_STATS, 'armor_' + slot.key + '.json'), JSON.stringify({ slot: slot.key, byId: statById }));
}

// Palico
const palicoDefs = [
  { key: 'weapon', label: 'Palico Weapons', icon: 'knife',       src: 'palico_weapons.json', rar: 'Weapon' },
  { key: 'head',   label: 'Palico Helmets', icon: 'palico_head', src: 'palico_head.json',    rar: 'Head' },
  { key: 'body',   label: 'Palico Armor',   icon: 'palico_body', src: 'palico_armor.json',   rar: 'Armor' },
];
const palicoRarity = J('palico_rarity.json');
const palicoWepKir = J('palico_weapons_kiranico.json');       // id -> {...}
const palicoArmKir = J('palico_armor_kiranico.json');         // "23"/"24" -> id -> {...}
for (const def of palicoDefs) {
  const names = J(def.src);
  const rar = palicoRarity[def.rar] || {};
  const entries = sortIds(names).map(id => [id, names[id], rar[id] || 0]);
  catalog.palico[def.key] = { label: def.label, icon: def.icon, entries };
  counts.palico += entries.length;
}
// palico stats files
{
  const byId = {};
  for (const [id, v] of Object.entries(palicoWepKir)) {
    byId[id] = { rar: v.rarity, type: v.type, sharp: v.sharpness, defBonus: v.defense_bonus || 0,
      melee: v.melee ? { atk: v.melee.attack, aff: v.melee.affinity || 0, ele: v.melee.element || 0 } : null,
      boom: v.boomerang ? { atk: v.boomerang.attack, aff: v.boomerang.affinity || 0, ele: v.boomerang.element || 0 } : null };
  }
  writeFileSync(join(OUT_STATS, 'palico_weapons.json'), JSON.stringify({ byId }));
}
{
  const out = { head: {}, body: {} };
  const map = { '23': 'head', '24': 'body' };
  for (const [et, inner] of Object.entries(palicoArmKir)) {
    const dst = out[map[et]]; if (!dst) continue;
    for (const [id, v] of Object.entries(inner)) {
      dst[id] = { def: v.defense || 0, res: [v.fire || 0, v.water || 0, v.thunder || 0, v.ice || 0, v.dragon || 0] };
    }
  }
  writeFileSync(join(OUT_STATS, 'palico_armor.json'), JSON.stringify(out));
}

// catalog.js
const catalogPath = join(OUT_DATA, 'catalog.js');
writeFileSync(catalogPath, 'window.CATALOG = ' + JSON.stringify(catalog) + ';\n');

// ── Icons ──────────────────────────────────────────────────────────────
const ICON_SLUGS = [
  ...WEAPON_CLASSES.map(c => c.slug),
  'armor_head', 'armor_body', 'armor_arms', 'armor_waist', 'armor_legs',
  'knife', 'palico_head', 'palico_body',
];
const RARITY_SUFFIXES = ['', '_r1', '_r2', '_r3', '_r4', '_r5', '_r6', '_r7', '_r8', '_r9', '_r10', '_rX'];
if (doIcons) {
  let copied = 0, missing = 0;
  for (const slug of ICON_SLUGS) {
    for (const suf of RARITY_SUFFIXES) {
      const fn = `icon_${slug}${suf}.png`;
      const src = join(ICONS_SRC, fn);
      if (existsSync(src)) { copyFileSync(src, join(OUT_ICONS, fn)); copied++; }
      else { missing++; warn(`icon missing: ${fn}`); }
    }
  }
  console.log(`\nIcons: copied ${copied}, missing ${missing}`);
}

// ── Report ──────────────────────────────────────────────────────────────
console.log('\n── Counts ──');
console.log(`  weapons: ${counts.weapons}`);
console.log(`  armor:   ${counts.armor}`);
console.log(`  palico:  ${counts.palico}`);
console.log(`  total:   ${counts.weapons + counts.armor + counts.palico}`);
console.log('\n── Output sizes ──');
const sizeOf = p => existsSync(p) ? statSync(p).size : 0;
console.log(`  catalog.js: ${kb(sizeOf(catalogPath))}`);
let statsTotal = 0;
for (const f of readdirSync(OUT_STATS)) statsTotal += sizeOf(join(OUT_STATS, f));
console.log(`  stats/*.json (${readdirSync(OUT_STATS).length} files): ${kb(statsTotal)} total`);
console.log('  "Tonfa" present in output: ' + (JSON.stringify(catalog).includes('"Tonfa"') ? 'YES (BUG)' : 'no'));

if (warnings.length) {
  console.log(`\n── Warnings (${warnings.length}) ──`);
  const shown = warnings.slice(0, 25);
  for (const w of shown) console.log('  • ' + w);
  if (warnings.length > shown.length) console.log(`  … and ${warnings.length - shown.length} more`);
}
console.log('\nDone.');
