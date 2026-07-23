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

  const filters = { text: "", searchAll: false, owned: "all", sort: "rarity", rarity: new Set([1,2,3,4,5,6,7,8,9,10,11,0]) };
  const statsCache = new Map();

  // ── Helpers ────────────────────────────────────────────────────────────
  const escapeHtml = s => String(s).replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  const iconSuffix = r => r >= 11 ? "_rX" : r >= 1 ? "_r" + r : "";
  const iconPath = (slug, r) => `assets/icons/icon_${slug}${iconSuffix(r)}.png`;
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
  function afterOwnedChange(c, id) {
    markDirty();
    updateProgress();
    const cell = $("grid").querySelector(`.box-cell[data-id="${id}"][data-cat="${catId(c)}"]`);
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
  function catOwnedCount(c) { return owned.get(catId(c)).size; }
  function updateProgress() {
    let total = 0, have = 0;
    for (const c of CATS) { total += c.entries.length; have += catOwnedCount(c); }
    $("overallProgress").textContent = `${fmtNum(have)} / ${fmtNum(total)} — ${total ? ((have / total) * 100).toFixed(1) : 0}%`;
    // sidebar fractions
    for (const c of CATS) {
      const el = document.querySelector(`.cat-row[data-cat="${catId(c)}"] .cat-frac`);
      if (el) {
        const n = catOwnedCount(c), d = c.entries.length;
        el.textContent = `${n}/${d}`;
        el.parentElement.classList.toggle("complete", n === d && d > 0);
      }
    }
    // current category header bar
    const n = catOwnedCount(current), d = current.entries.length;
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
    for (const g of groups) {
      const sec = document.createElement("div");
      sec.className = "cat-section"; sec.dataset.open = "true";
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
        sec.dataset.open = sec.dataset.open === "true" ? "false" : "true";
      });
      tree.appendChild(sec);
    }
  }

  function buildRarityFilters() {
    const wrap = $("rarityFilters"); wrap.innerHTML = "";
    for (let r = 1; r <= 11; r++) {
      const chip = document.createElement("div");
      chip.className = "rarity-chip"; chip.dataset.r = r; chip.textContent = r;
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
      final: c.kind === "w" ? entry[3] : 0, iconSlug: c.iconSlug };
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
  function renderGrid() {
    const grid = $("grid");
    let items = currentItems().filter(passesFilters);
    sortItems(items);
    if (!items.length) { grid.innerHTML = ""; $("gridEmpty").classList.remove("hidden"); return; }
    $("gridEmpty").classList.add("hidden");
    const html = items.map(it => {
      const cid = `${it.kind}:${it.key}`;
      const m = owned.get(cid);
      const on = m.has(it.id), level = m.get(it.id) || 0;
      const rc = it.rar >= 1 ? ` rarity-${it.rar}` : "";
      let badge = "";
      if (on) {
        const maxed = isMaxLevel(level, it.kind === "w" ? (maxLevels.get(cid).get(it.id) || 0) : 0);
        const text = level > 0 ? (maxed ? "Max" : level) : "✓";
        badge = `<span class="cell-check${maxed ? " max" : ""}">${text}</span>`;
      }
      return `<div class="box-cell${rc}${on ? " owned" : ""}" data-id="${it.id}" data-cat="${cid}" title="${escapeHtml(it.name)}">
        <img class="cell-icon" src="${iconPath(it.iconSlug, it.rar)}" alt="" loading="lazy">${badge}</div>`;
    }).join("");
    grid.innerHTML = html;
  }

  function selectCategory(c) {
    current = c;
    selectedId = null;
    document.querySelectorAll(".cat-row").forEach(r => r.classList.toggle("active", r.dataset.cat === catId(c)));
    $("catTitle").textContent = c.label;
    renderGrid();
    updateProgress();
    $("detailPanel").innerHTML = '<div class="detail-empty">Select an item to see its details.</div>';
  }

  // grid click: ctrl/meta = toggle owned; plain = open detail
  $("grid").addEventListener("click", ev => {
    const cell = ev.target.closest(".box-cell");
    if (!cell) return;
    const c = catByIdMap.get(cell.dataset.cat);
    const id = Number(cell.dataset.id);
    if (ev.ctrlKey || ev.metaKey) { toggleOwned(c, id); return; }
    document.querySelectorAll(".box-cell.selected").forEach(x => x.classList.remove("selected"));
    cell.classList.add("selected");
    openDetail(c, id);
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
      const parts = [`Rarity ${entry[2] || "?"}`];
      if (entry[4]) parts.push(escapeHtml(entry[4]) + " set");
      sub = parts.join(" · ");
      if (femaleName) title = `${escapeHtml(name)} <span style="opacity:.6">/</span> ${escapeHtml(femaleName)}`;
    } else {
      sub = `Rarity ${entry[2] || "?"}`;
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
      <div id="detailStats"><div class="detail-note">Loading stats…</div></div>`;
    $("detailOwnedBtn").addEventListener("click", () => toggleOwned(c, id));

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

  // ── Save / load ────────────────────────────────────────────────────────
  function serializeSave() {
    const out = { app: SAVE_APP, version: SAVE_VERSION, savedAt: new Date().toISOString(),
      owned: { w: {}, a: {}, p: {} }, levels: { w: {}, a: {}, p: {} } };
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
  selectCategory(CATS[0]);
  updateProgress();
  maybeOfferRestore();

  // Custom-font repaint fix (selects/text can clip before the font loads)
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => {
    document.body.style.opacity = "0.999"; requestAnimationFrame(() => document.body.style.opacity = "");
  });
})();
