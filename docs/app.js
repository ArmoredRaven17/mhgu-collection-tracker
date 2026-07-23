/* MHGU Collection Tracker — all app logic (IIFE, no modules). */
(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const C = window.CATALOG;
  if (!C) { document.body.innerHTML = "<p style='padding:20px'>Failed to load catalog data.</p>"; return; }

  const SAVE_APP = "mhgu-collection-tracker";
  const SAVE_VERSION = 2;   // v2 adds per-item upgrade levels
  const AUTOSAVE_KEY = "mhgu-tracker-autosave";
  const THEME_KEY = "mhgu-tracker-theme";

  const SHARP_COLORS = ["#c0392b", "#e08a2b", "#d9cf1f", "#4caf50", "#4a90d0", "#eeeeee", "#a05ad0"];
  const SHARP_LABELS = ["Red", "Orange", "Yellow", "Green", "Blue", "White", "Purple"];
  const RES_NAMES = ["Fire", "Water", "Thndr", "Ice", "Drgn"];

  // Same palette + monster icons as the MHGU Quest Randomizer, minus the
  // Gypceros/Khezu gag theme. [displayName, hex] or [displayName, hex, iconName].
  const THEME_COLORS = [
    ["Teostra","#570B0B"], ["Rathalos","#b51717"],
    ["Tetsucabra","#c65900"], ["Agnaktor","#fc933e"],
    ["Tigrex","#C8A319"], ["Rajang","#f1d364"],
    ["Deviljho","#0B570F"], ["Rathian","#3a9b3f"],
    ["Astalos","#14503d"], ["Zinogre","#2dae85"],
    ["Zamtrios","#005984"], ["Plesioth","#0080c1"],
    ["Brachydios","#0B2757"], ["Lagiacrus","#0b3f97"],
    ["G. Magala","#1F0B57","Gore Magala"], ["Nerscylla","#4e2fa2"],
    ["Y. Garuga","#62008f","Yian Garuga"], ["Chameleos","#8e50ab"],
    ["Mizutsune","#D84696"], ["Congalala","#ce79a8"],
    ["Duramboros","#5a411f"], ["Diablos","#997c54"],
    ["Barroth","#B57C45"], ["Bulldrome","#cfaa87"],
    ["K. Daora","#505358","Kushala Daora"], ["Valstrax","#aeb5c1"],
    ["Forbidden","#1E2025","Question Mark"],
  ];
  const COLORS_HEX = Object.fromEntries(THEME_COLORS.map(([name, hex]) => [hex.toUpperCase(), name]));
  const COLORS_ICON = Object.fromEntries(THEME_COLORS.filter(c => c[2]).map(([name, , icon]) => [name, icon]));
  const FALLBACK_ICON = "assets/MonsterIcons/MHGU-Question_Mark_Icon.webp";
  const monsterIcon = name => name ? "assets/MonsterIcons/MHGU-" + name.replace(/ /g, "_") + "_Icon.webp" : FALLBACK_ICON;

  // ── Category model ─────────────────────────────────────────────────────
  // Each category: {kind:'w'|'a'|'p', key, label, iconSlug, entries, statsFile}
  const CATS = [];
  for (const [slug, o] of Object.entries(C.weapons))
    CATS.push({ kind: "w", key: slug, label: o.label, iconSlug: o.icon, entries: o.entries, statsFile: `${slug}.json` });
  for (const [slot, o] of Object.entries(C.armor))
    CATS.push({ kind: "a", key: slot, label: o.label, iconSlug: o.icon, entries: o.entries, statsFile: `armor_${slot}.json` });
  for (const [k, o] of Object.entries(C.palico))
    CATS.push({ kind: "p", key: k, label: o.label, iconSlug: o.icon, entries: o.entries,
      statsFile: k === "weapon" ? "palico_weapons.json" : "palico_armor.json" });

  const catId = c => `${c.kind}:${c.key}`;
  const catByIdMap = new Map(CATS.map(c => [catId(c), c]));
  const validIds = new Map();   // "kind:key" -> Set(ids)
  for (const c of CATS) validIds.set(catId(c), new Set(c.entries.map(e => e[0])));
  const maxLevels = new Map();  // "kind:key" -> Map(id -> maxLevel); weapons only (entry[4])
  for (const c of CATS) {
    const m = new Map();
    if (c.kind === "w") for (const e of c.entries) m.set(e[0], e[4] || 0);
    maxLevels.set(catId(c), m);
  }
  const maxLevelOf = (c, id) => maxLevels.get(catId(c)).get(id) || 0;
  const isMaxLevel = (level, max) => level > 0 && max > 0 && level >= max;

  // ── State ──────────────────────────────────────────────────────────────
  const owned = new Map();      // "kind:key" -> Map(id -> level); level 0 = owned, no level chosen
  for (const c of CATS) owned.set(catId(c), new Map());
  const unknownOwned = { w: {}, a: {}, p: {} };   // preserved unknown ids, re-exported verbatim
  const unknownLevels = { w: {}, a: {}, p: {} };  // preserved levels for unknown ids
  let dirty = false;
  let fileHandle = null;
  let current = CATS[0];
  let selectedId = null;
  let sharpBand = 0;            // 0=base 1=+1 2=+2
  let matTab = "next";         // materials tab: "next" | "all"
  let openMaterials = null;    // resolved materials data for the currently-open item
  let viewMode = "grid";       // "grid" | "list"
  try { viewMode = localStorage.getItem("mhgu-tracker-view") || "grid"; } catch (e) {}

  const filters = { text: "", searchAll: false, owned: "all", sort: "rarity", dummy: false, armorClass: "all", rarity: new Set([1,2,3,4,5,6,7,8,9,10,11,0]) };
  const armorClassName = { B: "Blademaster", G: "Gunner", A: "Both" };
  const isDummy = name => /\(DUMMY\)/i.test(name);
  const dummyIds = new Map();   // "kind:key" -> Set(ids whose name is DUMMY)
  for (const c of CATS) {
    const s = new Set();
    for (const e of c.entries) if (isDummy(e[1])) s.add(e[0]);
    dummyIds.set(catId(c), s);
  }
  const statsCache = new Map();
  const materialsCache = new Map();

  // ── Helpers ────────────────────────────────────────────────────────────
  const escapeHtml = s => String(s).replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  const iconSuffix = r => r >= 11 ? "_rX" : r >= 1 ? "_r" + r : "";
  const iconPath = (slug, r) => `assets/icons/icon_${slug}${iconSuffix(r)}.png`;
  const rarityLabel = r => r >= 11 ? "X" : String(r);   // display rarity 11 as "X" (logic keeps 11)
  const fmtNum = n => n.toLocaleString("en-US");

  function toast(msg, ms = 2600) {
    const t = $("toast"); t.textContent = msg; t.classList.remove("hidden");
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add("hidden"), ms);
  }

  async function loadStats(file) {
    if (statsCache.has(file)) return statsCache.get(file);
    const p = fetch(`data/stats/${file}`).then(r => r.ok ? r.json() : Promise.reject(r.status));
    statsCache.set(file, p);
    try { return await p; } catch (e) { statsCache.delete(file); throw e; }
  }
  async function loadMaterials(file) {
    if (materialsCache.has(file)) return materialsCache.get(file);
    const p = fetch(`data/materials/${file}`).then(r => r.ok ? r.json() : Promise.reject(r.status));
    materialsCache.set(file, p);
    try { return await p; } catch (e) { materialsCache.delete(file); return null; }
  }

  // ── Dirty tracking ─────────────────────────────────────────────────────
  function markDirty() {
    if (!dirty) { dirty = true; $("dirtyDot").classList.remove("hidden"); document.title = "● MHGU Collection Tracker"; }
    scheduleAutosave();
  }
  function clearDirty() {
    dirty = false; $("dirtyDot").classList.add("hidden"); document.title = "MHGU Collection Tracker";
  }

  let autosaveTimer = null;
  function scheduleAutosave() {
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
      try { localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(serializeSave())); } catch (e) {}
    }, 500);
  }

  // ── Owned toggling ─────────────────────────────────────────────────────
  const ownedMapOf = c => owned.get(catId(c));
  function isOwned(c, id) { return ownedMapOf(c).has(id); }
  function ownedLevel(c, id) { return ownedMapOf(c).get(id) || 0; }   // 0 = owned but no level set
  function toggleOwned(c, id) {
    const m = ownedMapOf(c);
    if (m.has(id)) m.delete(id); else m.set(id, 0);
    afterOwnedChange(c, id);
  }
  // Record a specific upgrade level (weapons). Clicking the already-selected level un-owns it.
  function setLevel(c, id, lv) {
    const m = ownedMapOf(c);
    if (m.has(id) && m.get(id) === lv) m.delete(id); else m.set(id, lv);
    afterOwnedChange(c, id);
  }
  // Quick-level a weapon by clicking its cell: unowned → owned → LV1 → … → max, then stop.
  function advanceWeapon(c, id) {
    const m = ownedMapOf(c), max = maxLevelOf(c, id);
    if (!m.has(id)) m.set(id, 0);                 // first click: mark owned
    else {
      const cur = m.get(id);
      if (cur === 0) { if (max < 1) return; m.set(id, 1); }   // owned → LV1 (no-op if no levels)
      else if (max > 0 && cur < max) m.set(id, cur + 1);      // LVn → LVn+1
      else return;                                            // already at max → stop
    }
    afterOwnedChange(c, id);
  }
  function afterOwnedChange(c, id) {
    markDirty();
    updateProgress();
    const cell = $("grid").querySelector(`[data-id="${id}"][data-cat="${catId(c)}"]`);
    if (cell) updateCellOwned(cell, isOwned(c, id), ownedLevel(c, id), maxLevelOf(c, id));
    if (selectedId === id && current === c) refreshDetailOwned(c, id);
  }
  function updateCellOwned(cell, on, level, max) {
    cell.classList.toggle("owned", on);
    let chk = cell.querySelector(".cell-check");
    if (on) {
      if (!chk) { chk = document.createElement("span"); chk.className = "cell-check"; cell.appendChild(chk); }
      const maxed = isMaxLevel(level, max);
      chk.textContent = level > 0 ? (maxed ? "Max" : String(level)) : "✓";
      chk.classList.toggle("max", maxed);
    } else if (chk) chk.remove();
  }

  // ── Progress ───────────────────────────────────────────────────────────
  // Counts honour the DUMMY filter: when DUMMY are hidden they drop out of both
  // numerator and denominator, but their owned state stays in `owned` (kept, not
  // deleted) so it returns if the user re-includes them.
  function catTotal(c) {
    const all = c.entries.length;
    return filters.dummy ? all : all - dummyIds.get(catId(c)).size;
  }
  function catOwnedCount(c) {
    const m = owned.get(catId(c));
    const dset = dummyIds.get(catId(c));
    if (filters.dummy || !dset.size) return m.size;
    let n = 0; for (const id of m.keys()) if (!dset.has(id)) n++;
    return n;
  }
  // Count owned entries that are "maxed": weapons at their top level; entries with
  // no levels (armor, palico, no-stat weapons) count once owned. Honours DUMMY filter.
  function catMaxedCount(c) {
    const m = owned.get(catId(c));
    const dset = dummyIds.get(catId(c));
    let n = 0;
    for (const [id, lv] of m) {
      if (!filters.dummy && dset.has(id)) continue;
      const max = maxLevelOf(c, id);
      if (max === 0 || lv >= max) n++;
    }
    return n;
  }
  // Rarity tier from completion: R1..R9 in 10% owned bands, R10 at 100% owned,
  // R11 (X) at 100% maxed.
  const RARITY_TEXT = ["", "#e0e0e0", "#c0a0dc", "#d4cc00", "#d87090", "#48b448",
    "#3888e8", "#d43838", "#20b8b8", "#e88030", "#ff50a0", "#cc00ff"];
  function categoryTier(c) {
    const total = catTotal(c);
    if (total === 0) return 1;
    if (catMaxedCount(c) >= total) return 11;
    if (catOwnedCount(c) >= total) return 10;
    return Math.min(9, Math.floor(catOwnedCount(c) / total * 10) + 1);
  }
  function updateProgress() {
    let total = 0, have = 0;
    for (const c of CATS) { total += catTotal(c); have += catOwnedCount(c); }
    $("overallProgress").textContent = `${fmtNum(have)} / ${fmtNum(total)} — ${total ? ((have / total) * 100).toFixed(1) : 0}%`;
    // sidebar fractions + tier-based icon / text colour
    for (const c of CATS) {
      const row = document.querySelector(`.cat-row[data-cat="${catId(c)}"]`);
      if (!row) continue;
      const n = catOwnedCount(c), d = catTotal(c), tier = categoryTier(c);
      row.querySelector(".cat-frac").textContent = `${n}/${d}`;
      row.classList.toggle("complete", n === d && d > 0);
      const img = row.querySelector("img"); if (img) img.src = iconPath(c.iconSlug, tier);
      const nameEl = row.querySelector(".cat-name"); if (nameEl) nameEl.style.color = RARITY_TEXT[tier];
    }
    // current category header bar
    const n = catOwnedCount(current), d = catTotal(current);
    $("catProgressFill").style.width = d ? (n / d * 100) + "%" : "0";
    $("catCount").textContent = `${n} / ${d} owned`;
  }

  // ── Sidebar ────────────────────────────────────────────────────────────
  function buildSidebar() {
    const groups = [
      { title: "Weapons", cats: CATS.filter(c => c.kind === "w") },
      { title: "Armor", cats: CATS.filter(c => c.kind === "a") },
      { title: "Palico", cats: CATS.filter(c => c.kind === "p") },
    ];
    const tree = $("categoryTree"); tree.innerHTML = "";
    groups.forEach((g, gi) => {
      const sec = document.createElement("div");
      sec.className = "cat-section"; sec.dataset.open = gi === 0 ? "true" : "false";   // accordion: only first open
      sec.innerHTML = `<button class="cat-section-head"><span>${g.title}</span><span class="chev">▾</span></button>
        <div class="cat-section-body"></div>`;
      const body = sec.querySelector(".cat-section-body");
      for (const c of g.cats) {
        const row = document.createElement("div");
        row.className = "cat-row"; row.dataset.cat = catId(c);
        row.innerHTML = `<img src="${iconPath(c.iconSlug, 1)}" alt="">
          <span class="cat-name">${escapeHtml(c.label)}</span>
          <span class="cat-frac"></span>`;
        row.addEventListener("click", () => selectCategory(c));
        body.appendChild(row);
      }
      sec.querySelector(".cat-section-head").addEventListener("click", () => {
        const willOpen = sec.dataset.open !== "true";
        tree.querySelectorAll(".cat-section").forEach(s => s.dataset.open = "false");   // close others
        sec.dataset.open = willOpen ? "true" : "false";
      });
      tree.appendChild(sec);
    });
  }

  function buildRarityFilters() {
    const wrap = $("rarityFilters"); wrap.innerHTML = "";
    for (let r = 1; r <= 11; r++) {
      const chip = document.createElement("div");
      chip.className = "rarity-chip"; chip.dataset.r = r; chip.textContent = rarityLabel(r);
      chip.addEventListener("click", () => {
        if (filters.rarity.has(r)) filters.rarity.delete(r); else filters.rarity.add(r);
        chip.classList.toggle("off", !filters.rarity.has(r));
        renderGrid();
      });
      wrap.appendChild(chip);
    }
  }

  // ── Grid rendering ─────────────────────────────────────────────────────
  function normalize(c, entry) {
    return { kind: c.kind, key: c.key, cat: c, id: entry[0], name: entry[1], rar: entry[2] || 0,
      final: c.kind === "w" ? entry[3] : 0, armorClass: c.kind === "a" ? (entry[7] || "A") : "",
      iconSlug: c.iconSlug };
  }
  function currentItems() {
    if (filters.searchAll && filters.text) {
      const q = filters.text.toLowerCase();
      const out = [];
      for (const c of CATS)
        for (const e of c.entries)
          if (e[1].toLowerCase().includes(q) || (c.kind === "w" && e[3] && String(e[3]).toLowerCase().includes(q)))
            out.push(normalize(c, e));
      return out;
    }
    return current.entries.map(e => normalize(current, e));
  }
  function passesFilters(it) {
    if (!filters.dummy && isDummy(it.name)) return false;
    // Armor-type filter: "Both" (A) pieces always pass; applies to armor only.
    if (it.kind === "a" && filters.armorClass !== "all" && it.armorClass !== "A" && it.armorClass !== filters.armorClass) return false;
    if (filters.text && !filters.searchAll) {
      const q = filters.text.toLowerCase();
      if (!it.name.toLowerCase().includes(q) && !(it.final && String(it.final).toLowerCase().includes(q))) return false;
    }
    if (it.rar >= 1 && !filters.rarity.has(it.rar)) return false;
    if (filters.owned !== "all") {
      const has = owned.get(`${it.kind}:${it.key}`).has(it.id);
      if (filters.owned === "owned" && !has) return false;
      if (filters.owned === "missing" && has) return false;
    }
    return true;
  }
  // Rarity ordering: 1 → 2 → … → 10 → X(11), matching the Save App's in-game sort
  // within a class. Unknown rarity (0) sorts last; ties keep in-game (id) order.
  const rarKey = r => (r === 0 ? 99 : r);
  function sortItems(items) {
    // Rarity (default) also serves as the in-game ordering (rarity asc, id tie-break).
    if (filters.sort === "name") items.sort((a, b) => a.name.localeCompare(b.name));
    else items.sort((a, b) => (rarKey(a.rar) - rarKey(b.rar)) || (a.id - b.id));
    return items;
  }
  function ownedBadgeHtml(it) {
    const cid = `${it.kind}:${it.key}`;
    const m = owned.get(cid);
    if (!m.has(it.id)) return { on: false, html: "" };
    const level = m.get(it.id) || 0;
    const maxed = isMaxLevel(level, it.kind === "w" ? (maxLevels.get(cid).get(it.id) || 0) : 0);
    const text = level > 0 ? (maxed ? "Max" : level) : "✓";
    return { on: true, html: `<span class="cell-check${maxed ? " max" : ""}">${text}</span>` };
  }
  function cellHtml(it) {
    const { on, html } = ownedBadgeHtml(it);
    const rc = it.rar >= 1 ? ` rarity-${it.rar}` : "";
    return `<div class="box-cell${rc}${on ? " owned" : ""}" data-id="${it.id}" data-cat="${it.kind}:${it.key}" title="${escapeHtml(it.name)}">
      <img class="cell-icon" src="${iconPath(it.iconSlug, it.rar)}" alt="" loading="lazy">${html}</div>`;
  }
  function listRowHtml(it) {
    const { on, html } = ownedBadgeHtml(it);
    const rc = it.rar >= 1 ? ` rarity-${it.rar}` : "";
    const rarLabel = it.rar >= 1 ? rarityLabel(it.rar) : "–";
    return `<div class="list-row${rc}${on ? " owned" : ""}" data-id="${it.id}" data-cat="${it.kind}:${it.key}" title="${escapeHtml(it.name)}">
      <img class="list-icon" src="${iconPath(it.iconSlug, it.rar)}" alt="" loading="lazy">
      <span class="list-name">${escapeHtml(it.name)}</span>
      <span class="list-rar">R${rarLabel}</span>${html}</div>`;
  }
  function renderGrid() {
    const grid = $("grid");
    grid.classList.toggle("view-list", viewMode === "list");
    let items = currentItems().filter(passesFilters);
    sortItems(items);
    if (!items.length) { grid.innerHTML = ""; $("gridEmpty").classList.remove("hidden"); return; }
    $("gridEmpty").classList.add("hidden");
    const render = viewMode === "list" ? listRowHtml : cellHtml;
    grid.innerHTML = items.map(render).join("");
  }

  function selectCategory(c) {
    current = c;
    selectedId = null;
    $("armorTypeGroup").classList.toggle("hidden", c.kind !== "a");   // armor-type filter is armor-only
    document.querySelectorAll(".cat-row").forEach(r => r.classList.toggle("active", r.dataset.cat === catId(c)));
    $("catTitle").textContent = c.label;
    renderGrid();
    updateProgress();
    $("detailPanel").innerHTML = '<div class="detail-empty">Select an item to see its details.</div>';
  }

  // grid click:
  //   ctrl/meta = toggle owned (quick on/off, also the un-own escape)
  //   first click on a cell = inspect (open detail, no change)
  //   clicking the already-open weapon = cycle ownership/level up to max
  $("grid").addEventListener("click", ev => {
    const cell = ev.target.closest(".box-cell, .list-row");
    if (!cell) return;
    const c = catByIdMap.get(cell.dataset.cat);
    const id = Number(cell.dataset.id);
    if (ev.ctrlKey || ev.metaKey) { toggleOwned(c, id); return; }
    const alreadyOpen = selectedId === id && current === c;
    if (alreadyOpen && c.kind === "w") {
      advanceWeapon(c, id);   // repeat clicks on the open weapon level it up
    } else {
      document.querySelectorAll(".box-cell.selected, .list-row.selected").forEach(x => x.classList.remove("selected"));
      cell.classList.add("selected");
      openDetail(c, id);      // first click = inspect only
    }
  });

  // ── Detail panel ───────────────────────────────────────────────────────
  function ownedBtnLabel(c, id) {
    if (!isOwned(c, id)) return "Mark as owned";
    const lv = ownedLevel(c, id);
    return lv > 0 ? `✓ Owned — LV ${lv}` : "✓ Owned";
  }
  // Sync the owned button + level-row highlight for the currently-open item.
  function refreshDetailOwned(c, id) {
    const btn = $("detailOwnedBtn");
    if (btn) { btn.classList.toggle("is-owned", isOwned(c, id)); btn.textContent = ownedBtnLabel(c, id); }
    const lv = ownedLevel(c, id), on = isOwned(c, id);
    document.querySelectorAll("#detailStats .lvl-row").forEach(tr =>
      tr.classList.toggle("selected", on && Number(tr.dataset.lv) === lv));
    // Materials are relative to the owned level → refresh them for weapons.
    if (c.kind === "w" && openMaterials) renderMaterials(c, id, openMaterials);
  }
  function wireLevelRows(c, id) {
    document.querySelectorAll("#detailStats .lvl-row").forEach(tr =>
      tr.addEventListener("click", () => setLevel(c, id, Number(tr.dataset.lv))));
  }
  function detailHead(c, entry) {
    const name = entry[1];
    const final = c.kind === "w" ? entry[3] : 0;
    let title = escapeHtml(name);
    if (final) title += ` <span style="opacity:.6">→</span> ${escapeHtml(final)}`;
    let sub = "";
    if (c.kind === "a") {
      const femaleName = entry[6];
      const parts = [armorClassName[entry[7] || "A"], `Rarity ${entry[2] ? rarityLabel(entry[2]) : "?"}`];
      if (entry[4]) parts.push(escapeHtml(entry[4]) + " set");
      sub = parts.join(" · ");
      if (femaleName) title = `${escapeHtml(name)} <span style="opacity:.6">/</span> ${escapeHtml(femaleName)}`;
    } else {
      sub = `Rarity ${entry[2] ? rarityLabel(entry[2]) : "?"}`;
    }
    return { title, sub, rar: entry[2] || 0 };
  }

  async function openDetail(c, id) {
    selectedId = id; current = c;
    const entry = c.entries.find(e => e[0] === id);
    if (!entry) return;
    const { title, sub, rar } = detailHead(c, entry);
    const on = isOwned(c, id);
    const panel = $("detailPanel");
    panel.innerHTML = `
      <div class="detail-head">
        <img class="detail-icon" src="${iconPath(c.iconSlug, rar)}" alt="">
        <div><div class="detail-title">${title}</div><div class="detail-sub">${sub}</div></div>
      </div>
      <button id="detailOwnedBtn" class="detail-owned-btn ${on ? "is-owned" : ""}">${ownedBtnLabel(c, id)}</button>
      <div id="detailStats"><div class="detail-note">Loading stats…</div></div>
      <div id="detailMaterials"></div>`;
    $("detailOwnedBtn").addEventListener("click", () => toggleOwned(c, id));
    openMaterials = null;

    try {
      const data = await loadStats(c.statsFile);
      if (selectedId !== id) return;   // selection changed while loading
      const body = $("detailStats");
      if (c.kind === "w") { body.innerHTML = renderWeaponDetail(data, id); wireLevelRows(c, id); }
      else if (c.kind === "a") body.innerHTML = renderArmorDetail(data, id);
      else body.innerHTML = renderPalicoDetail(c.key, data, id);
      wireSharpToggle();
      refreshDetailOwned(c, id);   // highlight the owned level row, if any
    } catch (e) {
      $("detailStats").innerHTML = '<div class="detail-note">Stats unavailable for this item.</div>';
    }
    // Crafting materials (weapons, armor, palico) — lazy, rendered when it arrives.
    if (c.kind === "w" || c.kind === "a" || c.kind === "p") {
      loadMaterials(c.statsFile).then(md => {
        if (selectedId !== id) return;
        openMaterials = md;
        renderMaterials(c, id, md);
      });
    }
  }

  function sharpBarHtml(arr, band) {
    const a = arr[band] || arr[arr.length - 1];
    if (!a) return "";
    const total = a.reduce((s, v) => s + v, 0) || 1;
    const segs = a.map((v, i) => v ? `<div class="sharp-seg" style="width:${v / total * 100}%;background:${SHARP_COLORS[i]}" title="${SHARP_LABELS[i]}: ${v}"></div>` : "").join("");
    return `<div class="sharp-bar">${segs}</div>`;
  }
  function eleText(ele) {
    if (!ele || !ele.length) return "—";
    return ele.map(e => `${e[0]} ${e[1]}${e[2] ? " (Awk)" : ""}`).join(" / ");
  }

  function renderWeaponDetail(data, id) {
    const levels = data.byId[String(id)];
    if (!levels || !levels.length) return '<div class="detail-note">No detailed stats for this weapon.</div>';
    const anySharp = levels.some(l => l.sh);
    const rows = levels.map(l => {
      const sharp = l.sh ? sharpBarHtml(l.sh, sharpBand) : "";
      return `<tr class="lvl-row" data-lv="${l.lv}">
        <td class="lvl-own"></td>
        <td>${l.lv}</td><td>${l.raw}</td><td>${l.aff ? (l.aff > 0 ? "+" : "") + l.aff + "%" : "—"}</td>
        <td>${eleText(l.ele)}</td><td>${escapeHtml(l.slots || "")}</td>
        ${anySharp ? `<td>${sharp}</td>` : ""}</tr>`;
    }).join("");
    const toggle = anySharp ? `<div class="sharp-toggle" data-role="sharp">
      <button data-band="0" class="${sharpBand===0?"active":""}">Base</button>
      <button data-band="1" class="${sharpBand===1?"active":""}">+1</button>
      <button data-band="2" class="${sharpBand===2?"active":""}">+2</button></div>` : "";
    const extras = renderExtras(levels[levels.length - 1].x);
    return `<div class="detail-section-title">Upgrade levels</div>
      <div class="lvl-hint">Click the level you currently have.</div>${toggle}
      <table class="lvl-table"><thead><tr><th class="lvl-own"></th><th>Lv</th><th>Raw</th><th>Aff</th><th>Element</th><th>Slots</th>${anySharp ? "<th>Sharp</th>" : ""}</tr></thead>
      <tbody>${rows}</tbody></table>${extras}`;
  }
  function renderExtras(x) {
    if (!x) return "";
    let h = '<div class="detail-section-title">Details (final form)</div>';
    const rowsHtml = [];
    if (x.notes) rowsHtml.push(row("Notes", x.notes.join(", ")));
    if (x.shell) rowsHtml.push(row("Shelling", x.shell));
    if (x.phial) rowsHtml.push(row("Phial", x.phial));
    if (x.arc) rowsHtml.push(row("Arc shot", x.arc));
    if (x.kinsect) rowsHtml.push(row("Kinsect", `${x.kinsect.name} (${x.kinsect.type}) P${x.kinsect.power}/W${x.kinsect.weight}/S${x.kinsect.speed}`));
    if (x.stats) rowsHtml.push(row("Reload / Recoil / Dev", `${x.stats.reload} / ${x.stats.recoil} / ${x.stats.deviation}`));
    if (x.siege) rowsHtml.push(row("Siege", x.siege));
    let extraBlocks = "";
    if (x.charges) extraBlocks += `<div class="detail-section-title">Charges</div><div class="chip-list">${x.charges.map(c => `<span class="chip">${escapeHtml(c)}</span>`).join("")}</div>`;
    if (x.coatings) extraBlocks += `<div class="detail-section-title">Coatings</div><div class="chip-list">${x.coatings.map(c => `<span class="chip">${escapeHtml(c)}</span>`).join("")}</div>`;
    if (x.ammo) {
      const rows = Object.entries(x.ammo).map(([n, caps]) => `<tr><td>${escapeHtml(n)}</td><td>${caps.map(v => v || "–").join(" / ")}</td></tr>`).join("");
      extraBlocks += `<div class="detail-section-title">Ammo</div><table class="lvl-table"><tbody>${rows}</tbody></table>`;
    }
    if (x.rapidFire) extraBlocks += `<div class="detail-section-title">Rapid fire</div><div class="chip-list">${x.rapidFire.map(r => `<span class="chip">${escapeHtml(r.ammo)} ×${r.cap}</span>`).join("")}</div>`;
    if (x.internal) extraBlocks += `<div class="detail-section-title">Internal</div><div class="chip-list">${x.internal.map(r => `<span class="chip">${escapeHtml(r.ammo)} ${r.cap}/${r.total}</span>`).join("")}</div>`;
    if (!rowsHtml.length && !extraBlocks) return "";
    return h + rowsHtml.join("") + extraBlocks;
  }
  const row = (k, v) => `<div class="stat-row"><span class="k">${escapeHtml(k)}</span><span class="v">${escapeHtml(v)}</span></div>`;

  function resGridHtml(res) {
    return `<div class="detail-section-title">Resistances</div><div class="res-grid">
      ${RES_NAMES.map((n, i) => `<div><div class="res-name">${n}</div><div class="res-val">${res[i] > 0 ? "+" + res[i] : res[i]}</div></div>`).join("")}</div>`;
  }
  function renderArmorDetail(data, id) {
    const s = data.byId[String(id)];
    if (!s) return '<div class="detail-note">Stats unavailable for this armor piece.</div>';
    let h = `${row("Defense", `${s.def[0]} – ${s.def[1]}`)}${row("Deco slots", s.slots || 0)}`;
    h += resGridHtml(s.res);
    if (s.sk && s.sk.length)
      h += `<div class="detail-section-title">Skills</div><div class="chip-list">${s.sk.map(k => `<span class="chip">${escapeHtml(k[0])} ${k[1] > 0 ? "+" + k[1] : k[1]}</span>`).join("")}</div>`;
    return h;
  }
  function renderPalicoDetail(key, data, id) {
    if (key === "weapon") {
      const s = data.byId[String(id)];
      if (!s) return '<div class="detail-note">Stats unavailable.</div>';
      let h = `${row("Type", s.type || "—")}${row("Sharpness", s.sharp || "—")}${row("Defense bonus", s.defBonus || 0)}`;
      const atkLine = (o, label) => o ? row(label, `Atk ${o.atk} · Aff ${o.aff}%${o.ele ? " · " + (o.ele.type ? o.ele.type + " " + o.ele.value : o.ele) : ""}`) : "";
      h += atkLine(s.melee, "Melee") + atkLine(s.boom, "Boomerang");
      return h;
    }
    // palico armor: data = {head:{}, body:{}}
    const s = (data[key] || {})[String(id)];
    if (!s) return '<div class="detail-note">Stats unavailable.</div>';
    return row("Defense", s.def || 0) + resGridHtml(s.res);
  }
  function wireSharpToggle() {
    const t = document.querySelector('.sharp-toggle[data-role="sharp"]');
    if (!t) return;
    t.querySelectorAll("button").forEach(b => b.addEventListener("click", () => {
      sharpBand = Number(b.dataset.band);
      if (selectedId != null) openDetail(current, selectedId);
    }));
  }

  // ── Crafting materials ─────────────────────────────────────────────────
  const matPairsHtml = (pairs, mats) =>
    (!pairs || !pairs.length) ? '<div class="detail-note">None listed.</div>'
      : `<ul class="mat-list">${pairs.map(([mi, q]) => `<li><span class="mat-q">${q}×</span> ${escapeHtml(mats[mi])}</li>`).join("")}</ul>`;
  const matNameListHtml = map => {
    const entries = [...map].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return `<ul class="mat-list">${entries.map(([n, q]) => `<li><span class="mat-q">${q}×</span> ${escapeHtml(n)}</li>`).join("")}</ul>`;
  };
  // Reference level: owned → its level (unspecified counts as 1); not owned → 0 (needs creating).
  const refLevelOf = (c, id) => isOwned(c, id) ? Math.max(1, ownedLevel(c, id)) : 0;

  function weaponMaterialsHtml(c, id, data) {
    const rec = data.byId[String(id)];
    if (!rec) return "";                       // non-craftable (relic/event) — show nothing
    const mats = data.mats, max = maxLevelOf(c, id), ref = refLevelOf(c, id);
    if (max > 0 && ref >= max)
      return `<div class="detail-section-title">Crafting materials</div><div class="detail-note">Fully upgraded — no materials needed.</div>`;
    let body;
    if (matTab === "next") {
      const nl = ref + 1;
      const label = ref === 0 ? "Create (LV 1)" : `Upgrade to LV ${nl}`;
      body = `<div class="mat-step">${label}</div>${matPairsHtml(rec[nl], mats)}`;
    } else {
      const merge = new Map();
      for (let L = ref + 1; L <= max; L++) {
        const p = rec[L]; if (!p) continue;
        for (const [mi, q] of p) { const n = mats[mi]; merge.set(n, (merge.get(n) || 0) + q); }
      }
      const label = ref === 0 ? "Everything to reach max" : `Remaining to reach LV ${max}`;
      body = `<div class="mat-step">${label}</div>${matNameListHtml(merge)}`;
    }
    return `<div class="detail-section-title">Crafting materials</div>
      <div class="mat-tabs" data-role="mattabs">
        <button class="mat-tab ${matTab === "next" ? "active" : ""}" data-tab="next">Next Level</button>
        <button class="mat-tab ${matTab === "all" ? "active" : ""}" data-tab="all">All Materials Needed</button>
      </div><div class="mat-body">${body}</div>`;
  }
  // Single Create recipe (armor, palico weapon, palico armor head/body).
  function createMaterialsHtml(c, id, data) {
    const rec = (c.kind === "p" && (c.key === "head" || c.key === "body"))
      ? (data[c.key] || {})[String(id)]     // palico armor file is keyed by slot
      : (data.byId || {})[String(id)];
    if (!rec) return "";
    return `<div class="detail-section-title">Crafting materials</div>${matPairsHtml(rec, data.mats)}`;
  }
  function renderMaterials(c, id, data) {
    const el = $("detailMaterials"); if (!el) return;
    if (!data) { el.innerHTML = ""; return; }
    el.innerHTML = c.kind === "w" ? weaponMaterialsHtml(c, id, data) : createMaterialsHtml(c, id, data);
    const tabs = el.querySelector('[data-role="mattabs"]');
    if (tabs) tabs.querySelectorAll("button").forEach(b =>
      b.addEventListener("click", () => { matTab = b.dataset.tab; renderMaterials(c, id, data); }));
  }

  // ── Save / load ────────────────────────────────────────────────────────
  function serializeSave() {
    const out = { app: SAVE_APP, version: SAVE_VERSION, savedAt: new Date().toISOString(),
      showDummy: filters.dummy, owned: { w: {}, a: {}, p: {} }, levels: { w: {}, a: {}, p: {} } };
    for (const c of CATS) {
      const m = owned.get(catId(c));
      const ids = [...m.keys()].sort((a, b) => a - b);
      const unk = (unknownOwned[c.kind] || {})[c.key] || [];
      out.owned[c.kind][c.key] = unk.length ? ids.concat(unk).sort((a, b) => a - b) : ids;
      const lv = {};
      m.forEach((level, id) => { if (level > 0) lv[id] = level; });
      Object.assign(lv, (unknownLevels[c.kind] || {})[c.key] || {});
      if (Object.keys(lv).length) out.levels[c.kind][c.key] = lv;
    }
    return out;
  }
  function validateSave(obj) {
    if (!obj || typeof obj !== "object") return "Not a valid file.";
    if (obj.app !== SAVE_APP) return "This file isn't an MHGU Collection Tracker save.";
    if (!Number.isInteger(obj.version) || obj.version > SAVE_VERSION) return "This save was made with a newer version.";
    if (!obj.owned || typeof obj.owned !== "object") return "Save file is missing collection data.";
    for (const kind of ["w", "a", "p"]) {
      const bucket = obj.owned[kind];
      if (bucket == null) continue;
      if (typeof bucket !== "object") return "Collection data is malformed.";
      for (const arr of Object.values(bucket))
        if (!Array.isArray(arr) || arr.some(x => !Number.isInteger(x))) return "Collection data is malformed.";
    }
    if (obj.levels != null && typeof obj.levels !== "object") return "Collection data is malformed.";
    return null;
  }
  function applySave(obj) {
    for (const c of CATS) owned.get(catId(c)).clear();
    unknownOwned.w = {}; unknownOwned.a = {}; unknownOwned.p = {};
    unknownLevels.w = {}; unknownLevels.a = {}; unknownLevels.p = {};
    let unknownCount = 0;
    const remapId = (kind, key, id) => {
      if (kind === "a") { const rm = (C.armor[key] && C.armor[key].remap) || {}; if (rm[id] != null) return rm[id]; }
      return id;
    };
    for (const kind of ["w", "a", "p"]) {
      const bucket = obj.owned[kind]; if (!bucket) continue;
      for (const [key, ids] of Object.entries(bucket)) {
        const cid = `${kind}:${key}`;
        const valid = validIds.get(cid);
        const m = owned.get(cid);
        for (let id of ids) {
          id = remapId(kind, key, id);   // female → canonical
          if (valid && valid.has(id)) { if (!m.has(id)) m.set(id, 0); }
          else { (unknownOwned[kind][key] ||= []).push(id); unknownCount++; }
        }
      }
    }
    // Levels (v2+): a level implies ownership at that level.
    if (obj.levels && typeof obj.levels === "object") {
      for (const kind of ["w", "a", "p"]) {
        const bucket = obj.levels[kind]; if (!bucket || typeof bucket !== "object") continue;
        for (const [key, map] of Object.entries(bucket)) {
          if (!map || typeof map !== "object") continue;
          const cid = `${kind}:${key}`;
          const valid = validIds.get(cid);
          const m = owned.get(cid);
          for (let [rawId, rawLv] of Object.entries(map)) {
            const id = remapId(kind, key, Number(rawId)), lv = Number(rawLv);
            if (!Number.isInteger(lv) || lv <= 0) continue;
            if (valid && valid.has(id)) m.set(id, lv);
            else ((unknownLevels[kind][key] ||= {}))[id] = lv;
          }
        }
      }
    }
    if (unknownCount) toast(`${unknownCount} unrecognized id(s) preserved for re-export.`);
    if (typeof obj.showDummy === "boolean") { filters.dummy = obj.showDummy; $("dummyFilter").checked = obj.showDummy; }
    updateProgress();
    renderGrid();
    $("detailPanel").innerHTML = '<div class="detail-empty">Select an item to see its details.</div>';
    selectedId = null;
    scheduleAutosave();   // keep the crash-recovery mirror in step with the loaded file
  }

  const supportsFsApi = "showSaveFilePicker" in window;
  const saveOpts = { suggestedName: "mhgu-collection.json", types: [{ description: "JSON", accept: { "application/json": [".json"] } }] };

  async function saveToFile(forceNew) {
    const data = JSON.stringify(serializeSave(), null, 2);
    if (supportsFsApi) {
      try {
        if (forceNew || !fileHandle) fileHandle = await window.showSaveFilePicker(saveOpts);
        const w = await fileHandle.createWritable(); await w.write(data); await w.close();
        clearDirty(); toast("Saved."); return;
      } catch (e) { if (e && e.name === "AbortError") return; /* else fall through to download */ }
    }
    downloadBlob(data, "mhgu-collection.json");
    clearDirty(); toast("Downloaded save file.");
  }
  function downloadBlob(data, name) {
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function openFile() {
    if (supportsFsApi) {
      try {
        const [h] = await window.showOpenFilePicker({ types: saveOpts.types });
        fileHandle = h;
        const f = await h.getFile();
        loadFromText(await f.text());
        return;
      } catch (e) { if (e && e.name === "AbortError") return; }
    }
    $("importFile").click();
  }
  function loadFromText(text) {
    let obj;
    try { obj = JSON.parse(text); } catch (e) { toast("That file isn't valid JSON."); return; }
    const err = validateSave(obj);
    if (err) { toast(err); return; }
    applySave(obj);
    clearDirty();
    toast("Collection loaded.");
  }

  $("importFile").addEventListener("change", function () {
    const file = this.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = e => loadFromText(e.target.result);
    reader.readAsText(file);
    this.value = "";
  });
  $("saveBtn").addEventListener("click", () => saveToFile(false));
  $("saveAsBtn").addEventListener("click", () => saveToFile(true));
  $("openBtn").addEventListener("click", () => openFile());

  window.addEventListener("beforeunload", e => { if (dirty) { e.preventDefault(); e.returnValue = ""; } });
  document.addEventListener("keydown", e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); saveToFile(false); }
  });

  // ── Search / filter wiring ─────────────────────────────────────────────
  let searchTimer = null;
  $("searchInput").addEventListener("input", function () {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { filters.text = this.value.trim(); renderGrid(); updateSearchTitle(); }, 120);
  });
  $("searchAll").addEventListener("change", function () { filters.searchAll = this.checked; renderGrid(); updateSearchTitle(); });
  document.querySelectorAll('input[name="ownedFilter"]').forEach(r =>
    r.addEventListener("change", function () { if (this.checked) { filters.owned = this.value; renderGrid(); } }));
  $("sortSelect").addEventListener("change", function () { filters.sort = this.value; renderGrid(); });
  $("dummyFilter").addEventListener("change", function () { filters.dummy = this.checked; renderGrid(); updateProgress(); });
  document.querySelectorAll('input[name="armorClassFilter"]').forEach(r =>
    r.addEventListener("change", function () { if (this.checked) { filters.armorClass = this.value; renderGrid(); } }));
  function setView(v) {
    viewMode = v === "list" ? "list" : "grid";
    try { localStorage.setItem("mhgu-tracker-view", viewMode); } catch (e) {}
    $("viewToggle").querySelectorAll("button").forEach(b => b.classList.toggle("active", b.dataset.view === viewMode));
    renderGrid();
  }
  $("viewToggle").querySelectorAll("button").forEach(b => b.addEventListener("click", () => setView(b.dataset.view)));
  function updateSearchTitle() {
    if (filters.searchAll && filters.text) { $("catTitle").textContent = `Search: "${filters.text}"`; $("catCount").textContent = ""; }
    else if (current) { $("catTitle").textContent = current.label; updateProgress(); }
  }

  // ── Theme ──────────────────────────────────────────────────────────────
  const hexRgb = h => { h = h.replace("#", ""); return [0, 2, 4].map(i => parseInt(h.substr(i, 2), 16)); };
  const clamp = n => Math.max(0, Math.min(255, Math.round(n)));
  const clamp01 = n => Math.max(0, Math.min(1, n));
  const rgbToHsl = ([r, g, b]) => {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, l = (max + min) / 2;
    if (d === 0) return [0, 0, l];
    const s = d / (1 - Math.abs(2 * l - 1));
    const h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) / 6 : max === g ? ((b - r) / d + 2) / 6 : ((r - g) / d + 4) / 6;
    return [h, s, l];
  };
  const hslToRgb = ([h, s, l]) => {
    const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h * 6) % 2 - 1)), m = l - c / 2;
    const hi = Math.floor(h * 6) % 6;
    const [r, g, b] = hi === 0 ? [c, x, 0] : hi === 1 ? [x, c, 0] : hi === 2 ? [0, c, x] : hi === 3 ? [0, x, c] : hi === 4 ? [x, 0, c] : [c, 0, x];
    return [r + m, g + m, b + m].map(v => clamp(v * 255));
  };
  const darken = (rgb, f) => { const [h, s, l] = rgbToHsl(rgb); return hslToRgb([h, s, clamp01(l * f)]); };
  const lighten = (rgb, b) => { const [h, s, l] = rgbToHsl(rgb); return hslToRgb([h, s, clamp01(l + (1 - l) * b)]); };
  const cssRgb = rgb => `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
  function applyTheme(hex) {
    const c = hexRgb(hex), r = document.documentElement.style;
    r.setProperty("--bg", cssRgb(darken(c, .70)));
    r.setProperty("--bg1", cssRgb(darken(c, .80)));
    r.setProperty("--grid-bg", cssRgb(darken(c, .35)));   // grid backdrop: deep, hue-preserving tint
    r.setProperty("--bg2", cssRgb(darken(c, .95)));
    r.setProperty("--hover", cssRgb(darken(c, .30)));
    r.setProperty("--accent", cssRgb(darken(c, .7)));
    r.setProperty("--accent-hover", cssRgb(lighten(c, .4)));
    r.setProperty("--text", "#ffffff");
    r.setProperty("--text-dim", "#fffffff5");
    r.setProperty("--line", "rgba(255,255,255,0.12)");
    r.setProperty("--card", "rgba(255,255,255,0.05)");
    try { localStorage.setItem(THEME_KEY, hex); } catch (e) {}
    document.querySelectorAll(".swatch").forEach(s => s.classList.toggle("sel", s.dataset.hex === hex));
    const titleIcon = document.querySelector(".title-icon");
    if (titleIcon) {
      const name = COLORS_HEX[hex.toUpperCase()];
      titleIcon.src = name ? monsterIcon(COLORS_ICON[name] || name) : FALLBACK_ICON;
    }
  }
  function buildSwatches() {
    const wrap = $("swatches"); wrap.innerHTML = "";
    for (const [name, hex, iconOverride] of THEME_COLORS) {
      const d = document.createElement("div");
      d.className = "swatch"; d.dataset.hex = hex; d.style.background = hex; d.title = name;
      d.innerHTML = `<img class="swatch-icon" src="${monsterIcon(iconOverride || name)}" alt=""><span>${name}</span>`;
      d.addEventListener("click", () => applyTheme(hex));
      wrap.appendChild(d);
    }
  }

  // ── Modals ─────────────────────────────────────────────────────────────
  function bindModal(btnId, modalId, closeId) {
    $(btnId).addEventListener("click", () => $(modalId).classList.remove("hidden"));
    $(closeId).addEventListener("click", () => $(modalId).classList.add("hidden"));
    $(modalId).addEventListener("click", e => { if (e.target.id === modalId) $(modalId).classList.add("hidden"); });
  }
  bindModal("aboutBtn", "aboutModal", "aboutClose");
  $("themeBtn").addEventListener("click", () => $("themeModal").classList.remove("hidden"));
  $("themeClose").addEventListener("click", () => $("themeModal").classList.add("hidden"));
  $("themeModal").addEventListener("click", e => { if (e.target.id === "themeModal") $("themeModal").classList.add("hidden"); });

  // ── Restore banner ─────────────────────────────────────────────────────
  function maybeOfferRestore() {
    let raw; try { raw = localStorage.getItem(AUTOSAVE_KEY); } catch (e) { return; }
    if (!raw) return;
    let obj; try { obj = JSON.parse(raw); } catch (e) { return; }
    if (validateSave(obj)) return;
    const hasAny = obj.owned && ["w", "a", "p"].some(k => obj.owned[k] && Object.values(obj.owned[k]).some(a => a.length));
    if (!hasAny) return;
    $("restoreBanner").classList.remove("hidden");
    $("restoreYes").addEventListener("click", () => { applySave(obj); clearDirty(); $("restoreBanner").classList.add("hidden"); });
    $("restoreNo").addEventListener("click", () => $("restoreBanner").classList.add("hidden"));
  }

  // ── Init ───────────────────────────────────────────────────────────────
  buildSidebar();
  buildRarityFilters();
  buildSwatches();
  let savedTheme = "#1E2025";
  try { savedTheme = localStorage.getItem(THEME_KEY) || savedTheme; } catch (e) {}
  applyTheme(savedTheme);
  $("viewToggle").querySelectorAll("button").forEach(b => b.classList.toggle("active", b.dataset.view === viewMode));
  selectCategory(CATS[0]);
  updateProgress();
  maybeOfferRestore();

  // Custom-font repaint fix (selects/text can clip before the font loads)
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => {
    document.body.style.opacity = "0.999"; requestAnimationFrame(() => document.body.style.opacity = "");
  });
})();
