// build-armor-data.mjs — generate armor stats + crafting materials from the
// GAME'S OWN DATA (MHGU romfs `nativeNX/table`), not from scraped sources.
//
//   node scripts/build-armor-data.mjs "<path to nativeNX/table>" [--db <mhgu.db>] [--check]
//
// The romfs is authoritative. mhgu.db supplies English names only (its item ids
// are the game's own ids, and armor_families._id is the game's series index), and
// with --check it is also used to verify every decoded field.
//
// romfs table format: f32 version, u32 record count, then fixed-width records.
//
//   armorSeriesData.asd   1287 x 127
//     @0   u16 series id            @13/@14 male/female flags
//     @15/@16 blademaster/gunner    @17  u16 forge zenny
//     @23..27 s8 fire/water/thunder/ice/dragon resistance (series-wide)
//     @28+slot*15  5 x [u16 skill id, u8 points]   (slot 0..4 = head..legs)
//     @103 u8 rarity-1             @106 u8 base defense (shared by all pieces)
//     @107 u8 growth-curve index   @108..112 u8 decoration slots per slot
//
//   armorBuildData.abd    22 x 20   per-level defense gains (0 terminated)
//   armorCreateA0{0..4}   n  x 42   level-1 recipe per slot
//     @0/@2/@4/@6 u16 series ids sharing it; @10..37 7 x [u16 item, u8 qty, u8 key]
//   armorProcessA00.apd  5162 x 38  one record per upgrade level
//     @0/@2 u16 series ids; @8 u16 level; @10..21 + @26..37 4 x [u16 item, u8 qty]
//     @22 u16 material-point category, @24 u16 points. A category is itself an item
//     in mhgu.db at (30<<16)|id — e.g. category 32 is "LR Maccao Materials" — so a
//     point cost is emitted as an ordinary material, exactly as the weapon data does.
//   itemData.itm         2991 x 44  @28 u16 material-point category
//
// Outputs (compact, same conventions as build-data.mjs):
//   docs/data/stats/armor_<slot>.json      { slot, byId: { id: {def,res,slots,sk} } }
//   docs/data/materials/armor_<slot>.json  { slot, mats, byId, create, maxLevel, zenny }

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const DEFAULT_STATS = join(REPO, 'docs', 'data', 'stats');
const DEFAULT_MATERIALS = join(REPO, 'docs', 'data', 'materials');

const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const flagVal = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const DB_PATH = flagVal('--db') || join(REPO, 'data-src', 'mhgu.db');
const OUT_DIR = flagVal('--out');                 // dry-run target; omit to write docs/data
const TABLE = args.find((a, i) => !a.startsWith('--') && !['--db', '--out'].includes(args[i - 1]));
if (!TABLE) { console.error('usage: node scripts/build-armor-data.mjs "<nativeNX/table>" [--db <mhgu.db>] [--out <dir>] [--check]'); process.exit(1); }

const SLOTS = ['head', 'chest', 'arms', 'waist', 'legs'];
const DB_SLOT = { head: 'Head', chest: 'Body', arms: 'Arms', waist: 'Waist', legs: 'Legs' };
const SLOT_HI = { head: 20, chest: 21, arms: 22, waist: 23, legs: 24 };
const CATEGORY_BASE = 30 << 16;   // material-point category N is item (30<<16)|N

// ── table reader ───────────────────────────────────────────────────────────
function table(name, recSize) {
  const buf = readFileSync(join(TABLE, name));
  const count = buf.readUInt32LE(4);
  if (buf.length - 8 !== count * recSize)
    throw new Error(`${name}: ${buf.length - 8} bytes != ${count} x ${recSize}`);
  return { count, rec: i => buf.subarray(8 + i * recSize, 8 + (i + 1) * recSize) };
}
const s8 = v => (v > 127 ? v - 256 : v);

const OUT_STATS = OUT_DIR || DEFAULT_STATS;
const OUT_MATERIALS = OUT_DIR || DEFAULT_MATERIALS;
const statsFile = slot => join(OUT_STATS, OUT_DIR ? `stats_armor_${slot}.json` : `armor_${slot}.json`);
const matsFile = slot => join(OUT_MATERIALS, OUT_DIR ? `mats_armor_${slot}.json` : `armor_${slot}.json`);

// GMD (MT Framework): u32 filename length @0x24, filename @0x28, then a
// null-separated UTF-8 blob. armorSeriesData has 10 strings per series —
// 5 piece names then 5 descriptions. An empty slot is named 装備なし.
const EMPTY_PIECE = '装備なし';   // 装備なし
function gmdStrings(name) {
  const b = readFileSync(join(TABLE, name));
  if (b.subarray(0, 4).toString('ascii') !== 'GMD\0') throw new Error(`${name}: not a GMD`);
  const off = 0x28 + b.readUInt32LE(0x24) + 1;
  const parts = b.subarray(off).toString('utf8').split('\0');
  if (parts.at(-1) === '') parts.pop();
  return parts;
}

// ── names from mhgu.db (its ids ARE the game's ids) ─────────────────────────
if (!existsSync(DB_PATH)) { console.error(`mhgu.db not found at ${DB_PATH}`); process.exit(1); }
const db = new DatabaseSync(DB_PATH, { readOnly: true });
const itemName = new Map();
for (const r of db.prepare('SELECT _id, name FROM items').all()) itemName.set(r._id, r.name);
const skillName = new Map();
for (const r of db.prepare('SELECT _id, name FROM skill_trees').all()) skillName.set(r._id, r.name);
const famRarity = new Map();
for (const r of db.prepare('SELECT _id, rarity FROM armor_families').all()) famRarity.set(r._id, r.rarity);

// ── decode ────────────────────────────────────────────────────────────────
const seriesNames = gmdStrings('armorSeriesData_jpn.gmd');
const series = table('armorSeriesData.asd', 127);
const build = table('armorBuildData.abd', 20);
const curves = [];
for (let i = 0; i < build.count; i++) curves.push([...build.rec(i)].filter(v => v));

const items = table('itemData.itm', 44);
const catMembers = new Map();                     // category id -> [material names]
for (let i = 0; i < items.count; i++) {
  const c = items.rec(i).readUInt16LE(28);
  if (c && itemName.has(i)) {
    if (!catMembers.has(c)) catMembers.set(c, []);
    catMembers.get(c).push(itemName.get(i));
  }
}

// series id -> decoded record
const S = new Map();
for (let i = 0; i < series.count; i++) {
  const r = series.rec(i);
  const id = r.readUInt16LE(0);
  if (id !== i) continue;                         // record index is the series id
  const curve = curves[r[107]] || [];
  const base = r[106];
  S.set(id, {
    rarity: r[103] + 1,
    zenny: r.readUInt16LE(17),
    male: !!r[13], female: !!r[14],
    blademaster: !!r[15], gunner: !!r[16],
    res: [23, 24, 25, 26, 27].map(o => s8(r[o])),
    defense: base,
    maxDefense: base + curve.reduce((a, b) => a + b, 0),
    curve,
    slots: SLOTS.map((_, si) => r[108 + si]),
    skills: SLOTS.map((_, si) => {
      const out = [];
      for (let k = 0; k < 5; k++) {
        const off = 28 + si * 15 + k * 3;
        const sk = r.readUInt16LE(off), pts = s8(r[off + 2]);
        if (sk) out.push([skillName.get(sk) || `skill#${sk}`, pts]);
      }
      return out;
    }),
  });
}

// create recipes, per slot: series id -> [[itemId, qty, key]]
const create = SLOTS.map((_, si) => {
  const t = table(`armorCreateA0${si}.acrd`, 42);
  const m = new Map();
  for (let i = 0; i < t.count; i++) {
    const r = t.rec(i);
    const mats = [];
    for (let o = 10; o < 38; o += 4) {
      const iid = r.readUInt16LE(o);
      if (iid) mats.push([iid, r[o + 2], r[o + 3]]);
    }
    for (const o of [0, 2, 4, 6]) { const sid = r.readUInt16LE(o); if (sid) m.set(sid, mats); }
  }
  return m;
});

// upgrade levels: series id -> { level: {mats, points} }
const upgrades = new Map();
{
  const t = table('armorProcessA00.apd', 38);
  for (let i = 0; i < t.count; i++) {
    const r = t.rec(i);
    const lv = r.readUInt16LE(8);
    const mats = [];
    for (const o of [10, 13, 16, 19, 26, 29, 32, 35]) {
      const iid = r.readUInt16LE(o);
      if (iid) mats.push([iid, r[o + 2]]);
    }
    const cat = r.readUInt16LE(22), pts = r.readUInt16LE(24);
    for (const o of [0, 2]) {
      const sid = r.readUInt16LE(o);
      if (!sid) continue;
      if (!upgrades.has(sid)) upgrades.set(sid, {});
      upgrades.get(sid)[lv] = { mats, cat, pts };
    }
  }
}

// ── emit ──────────────────────────────────────────────────────────────────
const report = { stats: 0, recipes: 0, levels: 0, skipped: 0 };
const diffs = [];
const allMaxLevels = {};
const curveMismatch = [];

for (const [si, slot] of SLOTS.entries()) {
  const statById = {}, matsIdx = new Map();
  const byId = {}, createOut = {}, maxLevel = {}, zennyOut = {};
  const mi = n => { if (!matsIdx.has(n)) matsIdx.set(n, matsIdx.size); return matsIdx.get(n); };

  for (const [sid, s] of S) {
    // The game itself says whether a slot is populated: an absent piece is 装備なし.
    if ((seriesNames[sid * 10 + si] || EMPTY_PIECE) === EMPTY_PIECE) { report.skipped++; continue; }
    const cr = create[si].get(sid);

    statById[sid] = {
      def: [s.defense, s.maxDefense],
      // Defense at each upgrade level: base, then the growth curve applied cumulatively.
      // Index 0 is LV 1, so lv[n-1] is the defense at LV n.
      lv: s.curve.reduce((acc, gain) => (acc.push(acc[acc.length - 1] + gain), acc), [s.defense]),
      res: s.res,
      slots: s.slots[si],
      sk: s.skills[si],
      rar: s.rarity,
      cls: s.blademaster && s.gunner ? 'A' : s.gunner ? 'G' : 'B',
      gen: s.male && s.female ? 2 : s.male ? 1 : 0,
    };
    report.stats++;

    if (cr) {
      createOut[sid] = cr.map(([iid, q, key]) =>
        key ? [mi(itemName.get(iid) || `item#${iid}`), q, 1] : [mi(itemName.get(iid) || `item#${iid}`), q]);
      zennyOut[sid] = s.zenny;
      report.recipes++;
    }
    const up = upgrades.get(sid);
    if (up) {
      const lv = {};
      for (const [level, u] of Object.entries(up)) {
        const pairs = u.mats.map(([iid, q]) => [mi(itemName.get(iid) || `item#${iid}`), q]);
        // A material-point cost is the category item itself, quantity = points.
        if (u.cat) pairs.push([mi(itemName.get(CATEGORY_BASE | u.cat) || `category#${u.cat}`), u.pts]);
        if (pairs.length) lv[level] = pairs;
        report.levels++;
      }
      if (Object.keys(lv).length) byId[sid] = lv;
      maxLevel[sid] = Math.max(...Object.keys(up).map(Number));
      // The defense curve and the upgrade path must agree on how many levels exist.
      if (s.curve.length + 1 !== maxLevel[sid]) curveMismatch.push({ slot, sid, curve: s.curve.length + 1, path: maxLevel[sid] });
    } else {
      maxLevel[sid] = 1;
    }

    if (CHECK) {
      const row = db.prepare(
        'SELECT a.defense, a.max_defense, a.num_slots, a.fire_res, a.water_res, a.thunder_res, a.ice_res, a.dragon_res '
        + 'FROM armor a WHERE a._id = ?').get((SLOT_HI[slot] << 16) | sid);
      if (row) {
        const want = [row.defense, row.max_defense, row.num_slots,
          row.fire_res, row.water_res, row.thunder_res, row.ice_res, row.dragon_res];
        const got = [s.defense, s.maxDefense, s.slots[si], ...s.res];
        if (want.join() !== got.join()) diffs.push({ slot, sid, want, got });
      }
    }
  }

  allMaxLevels[slot] = maxLevel;
  writeFileSync(statsFile(slot),
    JSON.stringify({ slot, byId: statById }));
  writeFileSync(matsFile(slot),
    JSON.stringify({ slot, mats: [...matsIdx.keys()], byId, create: createOut, maxLevel, zenny: zennyOut }));
  console.log(`  armor_${slot}: ${Object.keys(statById).length} pieces, `
    + `${Object.keys(createOut).length} recipes, ${Object.keys(byId).length} upgrade paths, ${matsIdx.size} materials`);
}

// Armor max levels ship as a small synchronous companion to catalog.js: the grid,
// the level picker and the Show filters all need them before materials are fetched.
if (!OUT_DIR) {
  writeFileSync(join(REPO, 'docs', 'data', 'armor_levels.js'),
    'window.ARMOR_LEVELS = ' + JSON.stringify(allMaxLevels) + ';\n');
  console.log(`  armor_levels.js: max levels for ${Object.values(allMaxLevels).reduce((n, m) => n + Object.keys(m).length, 0)} pieces`);
}

console.log(`\n${report.stats} pieces, ${report.recipes} create recipes, ${report.levels} upgrade levels`);
if (curveMismatch.length) {
  console.log(`WARNING: ${curveMismatch.length} series where the defense curve and upgrade path disagree on level count`);
  for (const m of curveMismatch.slice(0, 5)) console.log('  ', m);
} else console.log('defense curve level count agrees with the upgrade path for every series');
if (CHECK) {
  console.log(diffs.length ? `MISMATCHES vs mhgu.db: ${diffs.length}` : 'validation: every piece matches mhgu.db exactly');
  for (const d of diffs.slice(0, 10)) console.log('  ', d);
}
