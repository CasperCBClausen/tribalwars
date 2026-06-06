// NeilsTribeInfoExtractor
(function () {

  /* ── Constants ── */

  const MODES = {
    members_troops:    'Member Troops',
    members_buildings: 'Member Buildings',
    members_defense:   'Member Defense',
  };

  // Fallback column order — used only if header detection fails
  const UNIT_COLS = [
    'spear', 'sword', 'axe', 'archer', 'scout',
    'light', 'marcher', 'heavy', 'ram', 'catapult',
    'paladin', 'noble', 'militia',
  ];

  // Maps TW unit display names to short CSV column names
  const UNIT_NAME_MAP = {
    'Spear fighter': 'spear', 'Swordsman': 'sword', 'Axeman': 'axe',
    'Archer': 'archer', 'Scout': 'scout', 'Light cavalry': 'light',
    'Mounted archer': 'marcher', 'Heavy cavalry': 'heavy',
    'Ram': 'ram', 'Catapult': 'catapult',
    'Paladin': 'paladin', 'Nobleman': 'noble', 'Militia': 'militia',
  };

  const FETCH_DELAY_MS = 350;

  /* ── Utilities ── */

  function el(tag, opts) {
    const e = document.createElement(tag);
    if (opts) Object.keys(opts).forEach(k => { e[k] = opts[k]; });
    return e;
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function escapeCSV(s) {
    return '"' + String(s ?? '').replace(/"/g, '""') + '"';
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise((resolve, reject) => {
      try {
        const ta = el('textarea', { value: text, style: 'position:fixed;top:-9999px;left:-9999px;' });
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy') ? resolve() : reject(new Error('execCommand failed'));
        ta.remove();
      } catch (e) { reject(e); }
    });
  }

  function extractCoords(villageName) {
    const m = villageName.match(/\((\d+)\|(\d+)\)/);
    return m ? m[1] + '|' + m[2] : '';
  }

  function cellInt(cell) {
    return parseInt((cell.textContent || '').trim()) || 0;
  }

  /* ── Page Detection ── */

  const urlParams     = new URLSearchParams(window.location.search);
  const currentMode   = urlParams.get('mode')   || '';
  const currentScreen = urlParams.get('screen') || '';
  const isAllyPage    = currentScreen === 'ally';
  const isKnownMode   = currentMode in MODES;

  function buildAllyUrl(mode, playerId) {
    const u = new URL(window.location.href); // preserve village + any other TW session params
    u.searchParams.set('screen', 'ally');
    u.searchParams.set('mode', mode);
    if (playerId) u.searchParams.set('player_id', playerId);
    else u.searchParams.delete('player_id');
    return u.toString();
  }

  /* ── Member Detection ── */

  function getMembersFromDoc(doc) {
    const select = doc.querySelector('select[name="player_id"]');
    if (!select) return [];
    return Array.from(select.querySelectorAll('option[value]'))
      .map(opt => ({ id: String(opt.value).trim(), name: opt.textContent.trim() }))
      .filter(m => m.id && m.name);
  }

  /* ── Fetcher ── */

  async function fetchPlayerPage(mode, playerId) {
    const resp = await fetch(buildAllyUrl(mode, playerId), { credentials: 'same-origin' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    return new DOMParser().parseFromString(await resp.text(), 'text/html');
  }

  /* ── Defense Parser ── */
  // Table structure confirmed from HTML inspection:
  //   Header:   Village(th) | Points(th) | (empty th) | Spear..Militia (img th×13) | Incoming(th)
  //   Village row (17 cells): village-link(td rs2) | points(td rs2) | "in village"(td) | units×13(td) | incoming(td rs2)
  //   Enroute row (14 cells): "enroute"(td) | units×13(td)    ← village/points/incoming are rowspanned above

  // Reads unit column names from table header images — works for any unit set (no archers, etc.)
  function detectUnitNamesFromTable(table) {
    const names = [], srcs = [];
    const seen  = new Set();
    table.querySelectorAll('thead th, tr:first-child th').forEach(th => {
      const img  = th.querySelector('img');
      if (!img) return;
      const disp = img.getAttribute('data-title') || img.getAttribute('alt') || img.getAttribute('title') || '';
      if (!disp) return;
      const slug = UNIT_NAME_MAP[disp] || disp.toLowerCase().replace(/\s+/g, '_');
      if (!seen.has(slug)) { seen.add(slug); names.push(slug); srcs.push(img.src || ''); }
    });
    return names.length ? { names, srcs } : { names: UNIT_COLS.slice(), srcs: UNIT_COLS.map(() => '') };
  }

  function parseDefensePage(doc, player) {
    const table = findUnitTable(doc);
    if (!table) return { rows: [], unitNames: UNIT_COLS.slice(), unitImgSrcs: UNIT_COLS.map(() => '') };

    const { names: unitNames, srcs: unitImgSrcs } = detectUnitNamesFromTable(table);
    const rows = [];
    let village = '', coords = '', points = 0, incoming = 0;

    table.querySelectorAll('tbody tr').forEach(tr => {
      const cells = Array.from(tr.querySelectorAll('td'));
      if (!cells.length) return;

      // In-village row: [village(rs), points(rs), label, ...N units..., incoming(rs)]
      // Enroute row:    [label, ...N units...]
      // Distinguish by whether the first cell contains a village link (anchor or coords pattern)
      const firstText = cells[0].textContent.trim();
      const hasVillage = cells[0].querySelector('a') || /\(\d+\|\d+\)/.test(firstText);

      if (hasVillage) {
        const anchor = cells[0].querySelector('a');
        village  = anchor ? anchor.textContent.trim() : firstText;
        coords   = extractCoords(village);
        points   = cellInt(cells[1]);
        const N  = cells.length - 4; // village, points, label, ...N..., incoming
        incoming = cellInt(cells[cells.length - 1]);
        const inVillage = cells.slice(3, 3 + N).map(cellInt);
        rows.push({ player_name: player.name, player_id: player.id, village, coords, points, incoming, type: 'in_village', units: inVillage });
      } else if (firstText === 'enroute') {
        const enroute = cells.slice(1).map(cellInt);
        rows.push({ player_name: player.name, player_id: player.id, village, coords, points, incoming, type: 'enroute', units: enroute });
      }
    });

    return { rows, unitNames, unitImgSrcs };
  }

  function flattenDefenseRows(rawRows) {
    const map = new Map();
    const sample = rawRows.find(r => r.units);
    const N = sample ? sample.units.length : UNIT_COLS.length;
    rawRows.forEach(r => {
      const key = r.player_id + '||' + r.village;
      if (!map.has(key)) {
        map.set(key, {
          player_name: r.player_name,
          player_id:   r.player_id,
          village:     r.village,
          coords:      r.coords,
          points:      r.points,
          incoming:    r.incoming,
          in_village:  new Array(N).fill(0),
          enroute:     new Array(N).fill(0),
        });
      }
      const entry = map.get(key);
      if (r.type === 'in_village') {
        entry.in_village = r.units;
        entry.incoming   = r.incoming;
      } else {
        entry.enroute = r.units;
      }
    });
    return Array.from(map.values());
  }

  /* ── Troops Parser ── */
  // Structure confirmed from HTML: one row per village, no rowspan.
  //   Header:  Village(th) | Points(th) | Spear..Militia(img th×13) | Active commands(th) | Incoming(th)
  //   Row:     village-link | points | units×13 | active_commands | incoming

  function parseTroopsPage(doc, player) {
    const table = findUnitTable(doc);
    if (!table) return { rows: [], unitNames: UNIT_COLS.slice(), unitImgSrcs: UNIT_COLS.map(() => ''), activeCmdSrc: '', incomingSrc: '' };

    const { names: unitNames, srcs: unitImgSrcs } = detectUnitNamesFromTable(table);

    // Read Active commands and Incoming header img srcs from the last two header cells
    const theadRows = Array.from(table.querySelectorAll('thead tr'));
    const headerRow = theadRows.length ? theadRows[theadRows.length - 1] : table.querySelector('tr:first-child');
    const allThs    = headerRow ? Array.from(headerRow.querySelectorAll('th')) : [];
    const N         = unitNames.length;
    const activeCmdSrc = allThs[2 + N]?.querySelector('img')?.src || '';
    const incomingSrc  = allThs[3 + N]?.querySelector('img')?.src || '';

    const rows = [];
    table.querySelectorAll('tbody tr').forEach(tr => {
      const cells = Array.from(tr.querySelectorAll('td'));
      if (cells.length < 4) return;
      const anchor = cells[0].querySelector('a');
      if (!anchor && !/\(\d+\|\d+\)/.test(cells[0].textContent)) return;
      const village = anchor ? anchor.textContent.trim() : cells[0].textContent.trim();
      const coords  = extractCoords(village);
      const points  = cellInt(cells[1]);
      // Row: village | points | ...N units... | active_commands | incoming
      const Nc       = cells.length - 4;
      const units    = cells.slice(2, 2 + Nc).map(cellInt);
      const active   = cellInt(cells[2 + Nc]);
      const incoming = cellInt(cells[3 + Nc]);
      rows.push({ player_name: player.name, player_id: player.id, village, coords, points, active_commands: active, incoming, units });
    });

    return { rows, unitNames, unitImgSrcs, activeCmdSrc, incomingSrc };
  }

  /* ── Generic Unit Table Parser (for Buildings until structure confirmed) ── */

  function findUnitTable(doc) {
    // Troops/defense: find by Spear fighter image
    const spearImg = doc.querySelector('img[data-title="Spear fighter"]');
    if (spearImg) return spearImg.closest('table');
    // Buildings and other pages: find table.vis.w100 inside content area
    const area = doc.getElementById('content_value') || doc.body;
    const visTbl = area.querySelector('table.vis.w100');
    if (visTbl) return visTbl;
    // Final fallback: table with the most img[data-title] header columns
    let best = null, bestCols = 0;
    area.querySelectorAll('table').forEach(t => {
      const cols = t.querySelectorAll('th img[data-title]').length;
      if (cols > bestCols) { bestCols = cols; best = t; }
    });
    return best;
  }

  function readUnitTableHeaders(table) {
    // Use the last thead row — skips category/colspan rows, gets the granular per-column headers
    const theadRows = Array.from(table.querySelectorAll('thead tr'));
    const headerRow = theadRows.length
      ? theadRows[theadRows.length - 1]
      : table.querySelector('tr:first-child');
    if (!headerRow) return { texts: [], srcs: [] };
    const texts = [], srcs = [];
    Array.from(headerRow.querySelectorAll('th')).forEach(th => {
      const img = th.querySelector('img');
      texts.push((img && (img.getAttribute('data-title') || img.getAttribute('alt') || img.getAttribute('title'))) || th.textContent.trim());
      srcs.push(img ? (img.src || '') : '');
    });
    return { texts, srcs };
  }

  function parseGenericUnitPage(doc, player) {
    const table = findUnitTable(doc);
    if (!table) return { headers: [], headerSrcs: [], rows: [] };
    const { texts, srcs } = readUnitTableHeaders(table);
    const rows = [];

    table.querySelectorAll('tbody tr').forEach(tr => {
      const cells = Array.from(tr.querySelectorAll('td'));
      if (!cells.length) return;
      const anchor = cells[0].querySelector('a');
      if (!anchor && !/\(\d+\|\d+\)/.test(cells[0].textContent)) return; // skip non-village rows
      const village = anchor ? anchor.textContent.trim() : cells[0].textContent.trim();
      const coords  = extractCoords(village);
      const points  = cellInt(cells[1]);
      const data    = cells.slice(2).map(c => c.textContent.trim());
      rows.push({ player_name: player.name, player_id: player.id, village, coords, points, data });
    });

    return { headers: texts.slice(2), headerSrcs: srcs.slice(2), rows };
  }

  /* ── Export ── */

  function withTimestamp(villages) {
    return { exported_at: Math.floor(Date.now() / 1000), villages };
  }

  function csvTimestamp() {
    return 'exported_at,' + Math.floor(Date.now() / 1000);
  }

  function defenseToCSV(flat, unitNames) {
    const inVillageH = unitNames.map(u => u + '_in_village');
    const enrouteH   = unitNames.map(u => u + '_enroute');
    const headers    = ['player_name', 'player_id', 'village', 'coords', 'points', 'incoming_attacks', ...inVillageH, ...enrouteH];
    const lines      = [csvTimestamp(), headers.map(escapeCSV).join(',')];
    flat.forEach(r => {
      const vals = [r.player_name, r.player_id, r.village, r.coords, r.points, r.incoming, ...r.in_village, ...r.enroute];
      lines.push(vals.map(escapeCSV).join(','));
    });
    return lines.join('\n');
  }

  function defenseToJSON(flat, unitNames) {
    return JSON.stringify(withTimestamp(flat.map(r => {
      const obj = { player_name: r.player_name, player_id: r.player_id, village: r.village, coords: r.coords, points: r.points, incoming_attacks: r.incoming };
      unitNames.forEach((u, i) => { obj[u + '_in_village'] = r.in_village[i] || 0; obj[u + '_enroute'] = r.enroute[i] || 0; });
      return obj;
    })), null, 2);
  }

  function troopsToCSV(rows, unitNames) {
    const headers = ['player_name', 'player_id', 'village', 'coords', 'points', 'active_commands', 'incoming', ...unitNames];
    const lines   = [csvTimestamp(), headers.map(escapeCSV).join(',')];
    rows.forEach(r => {
      const vals = [r.player_name, r.player_id, r.village, r.coords, r.points, r.active_commands, r.incoming, ...r.units];
      lines.push(vals.map(escapeCSV).join(','));
    });
    return lines.join('\n');
  }

  function troopsToJSON(rows, unitNames) {
    return JSON.stringify(withTimestamp(rows.map(r => {
      const obj = { player_name: r.player_name, player_id: r.player_id, village: r.village, coords: r.coords, points: r.points, active_commands: r.active_commands, incoming: r.incoming };
      unitNames.forEach((u, i) => { obj[u] = r.units[i] || 0; });
      return obj;
    })), null, 2);
  }

  function combineAllModes(troopRows, defenseFlat, buildingRows, unitNames, buildingHeaders) {
    const N = unitNames.length;
    const B = buildingHeaders.length;
    const map = new Map();
    const rowKey = r => r.player_id + '||' + r.village;
    const ensure = r => {
      if (!map.has(rowKey(r))) {
        map.set(rowKey(r), {
          player_name: r.player_name, player_id: r.player_id,
          village: r.village, coords: r.coords, points: r.points,
          active_commands: 0, incoming_attacks: 0,
          troops:     new Array(N).fill(0),
          in_village: new Array(N).fill(0),
          enroute:    new Array(N).fill(0),
          buildings:  new Array(B).fill(''),
        });
      }
      return map.get(rowKey(r));
    };
    troopRows.forEach(r => {
      const e = ensure(r);
      e.active_commands  = r.active_commands;
      e.incoming_attacks = r.incoming;
      e.troops           = r.units;
    });
    defenseFlat.forEach(r => {
      const e = ensure(r);
      e.incoming_attacks = r.incoming;
      e.in_village       = r.in_village;
      e.enroute          = r.enroute;
    });
    buildingRows.forEach(r => {
      ensure(r).buildings = r.data;
    });
    return Array.from(map.values());
  }

  function combinedToCSV(rows, unitNames, buildingHeaders) {
    const headers = [
      'player_name', 'player_id', 'village', 'coords', 'points',
      'active_commands', 'incoming_attacks',
      ...unitNames,
      ...unitNames.map(u => u + '_in_village'),
      ...unitNames.map(u => u + '_enroute'),
      ...buildingHeaders,
    ];
    const lines = [csvTimestamp(), headers.map(escapeCSV).join(',')];
    rows.forEach(r => {
      const vals = [
        r.player_name, r.player_id, r.village, r.coords, r.points,
        r.active_commands, r.incoming_attacks,
        ...r.troops, ...r.in_village, ...r.enroute, ...r.buildings,
      ];
      lines.push(vals.map(escapeCSV).join(','));
    });
    return lines.join('\n');
  }

  function combinedToJSON(rows, unitNames, buildingHeaders) {
    return JSON.stringify(withTimestamp(rows.map(r => {
      const obj = {
        player_name: r.player_name, player_id: r.player_id,
        village: r.village, coords: r.coords, points: r.points,
        active_commands: r.active_commands, incoming_attacks: r.incoming_attacks,
      };
      unitNames.forEach((u, i) => { obj[u]                = r.troops[i]     || 0; });
      unitNames.forEach((u, i) => { obj[u + '_in_village'] = r.in_village[i] || 0; });
      unitNames.forEach((u, i) => { obj[u + '_enroute']   = r.enroute[i]    || 0; });
      buildingHeaders.forEach((h, i) => { obj[h] = r.buildings[i] || ''; });
      return obj;
    })), null, 2);
  }

  function genericToCSV(headers, rows) {
    const lines = [csvTimestamp(), ['player_name', 'player_id', 'village', 'coords', 'points', ...headers].map(escapeCSV).join(',')];
    rows.forEach(r => {
      const vals = [r.player_name, r.player_id, r.village, r.coords, r.points, ...r.data];
      lines.push(vals.map(escapeCSV).join(','));
    });
    return lines.join('\n');
  }

  /* ── Message System ── */

  let msgBar;
  const messageHistory = [];

  function showMessage(msg) {
    messageHistory.push({ text: msg, time: new Date() });
    if (msgBar) msgBar.textContent = msg;
  }

  /* ── UI Helpers ── */

  let helpOverlay, helpTitle, helpText;

  function showHelp(title, html) {
    helpTitle.textContent = title;
    helpText.innerHTML    = html;
    helpOverlay.style.display = 'flex';
  }

  function makeCollapseHandler(contentEl, btn) {
    return function () {
      const collapsed = contentEl.style.display === 'none';
      contentEl.style.display = collapsed ? 'block' : 'none';
      btn.innerText = collapsed ? '−' : '+';
    };
  }

  function ensureExpanded(contentEl, btn) {
    if (contentEl.style.display === 'none') {
      contentEl.style.display = 'block';
      btn.innerText = '−';
    }
  }

  /* ── UI Build ── */

  if (document.getElementById('tw_tribe_extractor_ui')) {
    document.getElementById('tw_tribe_extractor_ui').remove();
  }

  const container = el('div', {
    id:    'tw_tribe_extractor_ui',
    style: 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:99999;' +
           'background:#1a1a1a;color:#fff;padding:0;border-radius:8px;' +
           'font-family:Arial,Helvetica,sans-serif;font-size:13px;width:1104px;max-height:88vh;' +
           'box-shadow:0 8px 24px rgba(0,0,0,0.8);resize:both;overflow:hidden;border:2px solid #333;' +
           'display:flex;flex-direction:column;',
  });

  // ── Title Bar ──
  const titleBar     = el('div', { style: 'cursor:move;padding:14px 16px;background:linear-gradient(135deg,#2a2a2a 0%,#1a1a1a 100%);border-top-left-radius:6px;border-top-right-radius:6px;user-select:none;border-bottom:2px solid #444;position:relative;flex-shrink:0;' });
  const titleWrapper = el('div', { style: 'text-align:center;position:relative;' });
  const titleEl      = el('div', { style: 'font-size:20px;font-weight:bold;color:#e0e0e0;text-shadow:2px 2px 4px rgba(0,0,0,0.6);letter-spacing:1px;' });
  titleEl.textContent = 'TRIBE INFO EXTRACTOR';
  const btnGlobalHelp = el('button', { innerText: '?', title: 'Help', type: 'button', style: 'position:absolute;left:10px;top:50%;transform:translateY(-50%);cursor:pointer;padding:4px 9px;background:#1a2a1a;color:#6d6;border:1px solid #2a4a2a;border-radius:4px;font-size:14px;font-weight:bold;z-index:2;' });
  const closeBtn      = el('button', { innerText: '✕', title: 'Close', style: 'position:absolute;right:0;top:50%;transform:translateY(-50%);cursor:pointer;padding:4px 10px;background:#444;color:#fff;border:1px solid #666;border-radius:4px;font-size:16px;font-weight:bold;' });
  titleWrapper.append(titleEl, closeBtn);
  titleBar.append(btnGlobalHelp, titleWrapper);
  container.appendChild(titleBar);

  // ── Message Bar (always visible, click for history) ──
  msgBar = el('div', {
    style: 'padding:6px 16px;background:#0d0d0d;border-bottom:1px solid #2a2a2a;font-size:12px;color:#aaa;' +
           'cursor:pointer;min-height:30px;display:flex;align-items:center;flex-shrink:0;',
    title: 'Click to view message history',
  });
  msgBar.textContent = 'Initialising…';
  container.appendChild(msgBar);

  // ── Scrollable Body ──
  const body = el('div', { style: 'padding:16px;overflow-y:auto;flex:1;' });
  container.appendChild(body);

  // ── Members Section ──
  const membersSection       = el('div', { style: 'margin-bottom:12px;padding:12px;background:#0f0f0f;border-radius:6px;border:1px solid #333;' });
  const membersSectionHeader = el('div', { style: 'display:flex;align-items:center;margin-bottom:10px;' });
  const membersSectionTitle  = el('div', { style: 'font-weight:bold;color:#aaa;font-size:13px;flex:1;text-align:center;' });
  membersSectionTitle.textContent = 'Filter';
  const membersCollapseBtn   = el('button', { innerText: '−', type: 'button', style: 'cursor:pointer;padding:2px 8px;background:#2a2a2a;color:#fff;border:1px solid #4a4a4a;border-radius:3px;font-size:16px;font-weight:bold;line-height:1;' });
  membersSectionHeader.append(membersSectionTitle, membersCollapseBtn);
  membersSection.appendChild(membersSectionHeader);

  const membersContent    = el('div');
  const membersTopRow     = el('div', { style: 'display:flex;gap:8px;align-items:center;margin-bottom:8px;' });
  const membersCountLabel = el('span', { style: 'font-size:12px;color:#888;flex:1;' });
  const btnSelectAll      = el('button', { innerText: 'All',  type: 'button', style: 'cursor:pointer;padding:4px 10px;background:#2a2a2a;color:#aaa;border:1px solid #4a4a4a;border-radius:3px;font-size:11px;' });
  const btnSelectNone     = el('button', { innerText: 'None', type: 'button', style: 'cursor:pointer;padding:4px 10px;background:#2a2a2a;color:#aaa;border:1px solid #4a4a4a;border-radius:3px;font-size:11px;' });
  membersTopRow.append(membersCountLabel, btnSelectAll, btnSelectNone);
  const membersList       = el('div', { style: 'display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px;' });
  const memberCheckboxes  = {};

  const modeCheckboxes = {};
  const modeFilterSep  = el('div', { style: 'border-top:1px solid #2a2a2a;padding-top:10px;' });
  const modeTopRow     = el('div', { style: 'display:flex;gap:8px;align-items:center;margin-bottom:8px;' });
  const modeLabel      = el('span', { style: 'font-size:12px;color:#888;flex:1;' });
  modeLabel.textContent = 'Data:';
  const btnModeAll  = el('button', { innerText: 'All',  type: 'button', style: 'cursor:pointer;padding:4px 10px;background:#2a2a2a;color:#aaa;border:1px solid #4a4a4a;border-radius:3px;font-size:11px;' });
  const btnModeNone = el('button', { innerText: 'None', type: 'button', style: 'cursor:pointer;padding:4px 10px;background:#2a2a2a;color:#aaa;border:1px solid #4a4a4a;border-radius:3px;font-size:11px;' });
  modeTopRow.append(modeLabel, btnModeAll, btnModeNone);
  const modeCheckRow = el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;' });
  Object.keys(MODES).forEach(mode => {
    const label = el('label', { style: 'display:flex;align-items:center;gap:5px;cursor:pointer;padding:5px 11px;background:#1a1a1a;border:1px solid #3a3a3a;border-radius:4px;font-size:12px;color:#bbb;' });
    const cb    = el('input', { type: 'checkbox', checked: true, style: 'cursor:pointer;' });
    modeCheckboxes[mode] = cb;
    label.append(cb, document.createTextNode(MODES[mode]));
    modeCheckRow.appendChild(label);
  });
  modeFilterSep.append(modeTopRow, modeCheckRow);

  membersContent.append(membersTopRow, membersList, modeFilterSep);
  membersSection.appendChild(membersContent);
  body.appendChild(membersSection);

  // ── Overview Section ──
  const overviewSection       = el('div', { style: 'margin-bottom:12px;padding:12px;background:#0f0f0f;border-radius:6px;border:1px solid #333;' });
  const overviewSectionHeader = el('div', { style: 'display:flex;align-items:center;margin-bottom:10px;' });
  const overviewSectionTitle  = el('div', { style: 'font-weight:bold;color:#aaa;font-size:13px;flex:1;text-align:center;' });
  overviewSectionTitle.textContent = 'Overview';
  const overviewCollapseBtn   = el('button', { innerText: '−', type: 'button', style: 'cursor:pointer;padding:2px 8px;background:#2a2a2a;color:#fff;border:1px solid #4a4a4a;border-radius:3px;font-size:16px;font-weight:bold;line-height:1;' });
  overviewSectionHeader.append(overviewSectionTitle, overviewCollapseBtn);
  overviewSection.appendChild(overviewSectionHeader);

  const overviewContent = el('div');
  const overviewSummary = el('div', { style: 'font-size:12px;color:#888;text-align:center;margin-bottom:10px;' });
  const overviewScroll  = el('div', { style: 'overflow-x:auto;' });
  const overviewTable   = el('table', { style: 'min-width:100%;border-collapse:collapse;font-size:12px;' });
  const overviewTbody = el('tbody');
  overviewTable.appendChild(overviewTbody);
  overviewScroll.appendChild(overviewTable);
  overviewContent.append(overviewSummary, overviewScroll);
  overviewSection.appendChild(overviewContent);
  body.appendChild(overviewSection);

  // ── Export Section ──
  const resultsSection       = el('div', { style: 'margin-bottom:12px;padding:12px;background:#0f0f0f;border-radius:6px;border:1px solid #333;' });
  const resultsSectionHeader = el('div', { style: 'display:flex;align-items:center;margin-bottom:10px;' });
  const resultsSectionTitle  = el('div', { style: 'font-weight:bold;color:#aaa;font-size:13px;flex:1;text-align:center;' });
  resultsSectionTitle.textContent = 'Export';
  const resultsCollapseBtn   = el('button', { innerText: '−', type: 'button', style: 'cursor:pointer;padding:2px 8px;background:#2a2a2a;color:#fff;border:1px solid #4a4a4a;border-radius:3px;font-size:16px;font-weight:bold;line-height:1;' });
  resultsSectionHeader.append(resultsSectionTitle, resultsCollapseBtn);
  resultsSection.appendChild(resultsSectionHeader);

  const resultsContent = el('div');
  const exportRow   = el('div', { style: 'display:flex;gap:8px;justify-content:center;flex-wrap:wrap;' });
  const btnCopyCSV  = el('button', { innerText: 'Copy CSV',  type: 'button', style: 'cursor:pointer;padding:8px 18px;background:#2a3a5a;color:#fff;border:1px solid #3a5a7a;border-radius:4px;font-size:12px;' });
  const btnCopyJSON = el('button', { innerText: 'Copy JSON', type: 'button', style: 'cursor:pointer;padding:8px 18px;background:#2a3a5a;color:#fff;border:1px solid #3a5a7a;border-radius:4px;font-size:12px;' });
  exportRow.append(btnCopyCSV, btnCopyJSON);
  resultsContent.append(exportRow);
  resultsSection.appendChild(resultsContent);
  body.appendChild(resultsSection);

  // ── Footer ──
  const footer = el('div', { style: 'padding:10px;background:linear-gradient(135deg,#1a1a1a 0%,#0a0a0a 100%);border-bottom-left-radius:6px;border-bottom-right-radius:6px;border-top:2px solid #444;text-align:center;flex-shrink:0;' });
  const footerAuthor = el('div', { style: 'font-size:12px;color:#888;letter-spacing:0.5px;' });
  footerAuthor.textContent = 'Created by NeilB';
  footer.appendChild(footerAuthor);
  container.appendChild(footer);
  document.body.appendChild(container);

  // ── Help Overlay ──
  helpOverlay = el('div', { style: 'position:fixed;left:0;top:0;width:100%;height:100%;background:rgba(0,0,0,0.75);z-index:200000;display:none;align-items:center;justify-content:center;' });
  const helpContent  = el('div', { style: 'background:#1a1a1a;color:#fff;padding:16px;border-radius:8px;border:2px solid #444;max-width:420px;width:90%;max-height:70vh;display:flex;flex-direction:column;' });
  helpTitle          = el('div', { style: 'font-size:13px;font-weight:bold;margin-bottom:8px;color:#e0e0e0;flex-shrink:0;' });
  helpText           = el('div', { style: 'font-size:11px;color:#bbb;line-height:1.5;margin-bottom:12px;overflow-y:auto;flex:1;' });
  const helpCloseRow = el('div', { style: 'display:flex;justify-content:center;' });
  const helpCloseBtn = el('button', { innerText: 'Close', type: 'button', style: 'cursor:pointer;padding:5px 16px;background:#444;color:#fff;border:1px solid #666;border-radius:4px;font-size:11px;flex-shrink:0;' });
  helpCloseRow.appendChild(helpCloseBtn);
  helpContent.append(helpTitle, helpText, helpCloseRow);
  helpOverlay.appendChild(helpContent);
  document.body.appendChild(helpOverlay);

  // ── Message History Overlay ──
  const msgHistoryOverlay  = el('div', { style: 'position:fixed;left:0;top:0;width:100%;height:100%;background:rgba(0,0,0,0.75);z-index:200000;display:none;align-items:center;justify-content:center;' });
  const msgHistoryContent  = el('div', { style: 'background:#1a1a1a;color:#fff;padding:20px;border-radius:8px;border:2px solid #444;max-width:480px;width:90%;max-height:60vh;display:flex;flex-direction:column;' });
  const msgHistoryTitle    = el('div', { style: 'font-size:16px;font-weight:bold;margin-bottom:12px;color:#e0e0e0;flex-shrink:0;' });
  msgHistoryTitle.textContent = 'Message History';
  const msgHistoryList     = el('div', { style: 'overflow-y:auto;flex:1;' });
  const msgHistoryCloseRow = el('div', { style: 'display:flex;justify-content:center;margin-top:12px;flex-shrink:0;' });
  const msgHistoryCloseBtn = el('button', { innerText: 'Close', type: 'button', style: 'cursor:pointer;padding:8px 24px;background:#444;color:#fff;border:1px solid #666;border-radius:4px;' });
  msgHistoryCloseRow.appendChild(msgHistoryCloseBtn);
  msgHistoryContent.append(msgHistoryTitle, msgHistoryList, msgHistoryCloseRow);
  msgHistoryOverlay.appendChild(msgHistoryContent);
  document.body.appendChild(msgHistoryOverlay);

  /* ── State ── */

  let lastCSV  = '';
  let lastJSON = '';
  let cachedData = { unitNames: [], unitImgSrcs: [], activeCmdSrc: '', incomingSrc: '', buildingHeaders: [], buildingImgSrcs: [], members: [], troops: {}, defenseRaw: {}, buildings: {} };
  const expandedPlayers = new Set();

  /* ── Member List Builder ── */

  function buildMemberList(memberArr) {
    membersList.innerHTML = '';
    Object.keys(memberCheckboxes).forEach(k => delete memberCheckboxes[k]);

    if (!memberArr.length) {
      const note = el('div', { style: 'font-size:12px;color:#888;padding:6px;' });
      note.textContent = 'Loading member data…';
      membersList.appendChild(note);
      membersCountLabel.textContent = '0 members';
      return;
    }

    membersCountLabel.textContent = memberArr.length + ' member' + (memberArr.length > 1 ? 's' : '') + ' detected';

    memberArr.forEach(m => {
      const label = el('label', { style: 'display:flex;align-items:center;gap:5px;cursor:pointer;padding:5px 10px;background:#1a1a1a;border:1px solid #333;border-radius:4px;font-size:12px;color:#ddd;' });
      const cb    = el('input', { type: 'checkbox', checked: true, style: 'cursor:pointer;' });
      memberCheckboxes[m.id] = { cb, member: m };
      cb.addEventListener('change', () => { expandedPlayers.clear(); refreshOverview(); });
      const nameSpan = el('span');
      nameSpan.textContent = m.name;
      const idSpan = el('span', { style: 'color:#555;font-size:10px;' });
      idSpan.textContent = '(' + m.id + ')';
      label.append(cb, nameSpan, idSpan);
      membersList.appendChild(label);
    });
  }

  function getSelectedMembers() {
    return Object.values(memberCheckboxes)
      .filter(({ cb }) => cb.checked)
      .map(({ member }) => member);
  }

  /* ── Fetch & Export Logic ── */

  function getSelectedModes() {
    return Object.keys(modeCheckboxes).filter(mode => modeCheckboxes[mode].checked);
  }

  function getSelectedMemberIds() {
    return new Set(
      Object.entries(memberCheckboxes)
        .filter(([, { cb }]) => cb.checked)
        .map(([id]) => id)
    );
  }

  function generateExport() {
    const selectedModes = getSelectedModes();
    const selectedIds   = getSelectedMemberIds();
    const { unitNames, buildingHeaders, members } = cachedData;
    const pick = store => members.filter(m => selectedIds.has(m.id)).flatMap(m => store[m.id] || []);

    if (selectedModes.length === 1) {
      const mode = selectedModes[0];
      if (mode === 'members_troops') {
        const rows = pick(cachedData.troops);
        lastCSV  = troopsToCSV(rows, unitNames);
        lastJSON = troopsToJSON(rows, unitNames);
      } else if (mode === 'members_defense') {
        const flat = flattenDefenseRows(pick(cachedData.defenseRaw));
        lastCSV  = defenseToCSV(flat, unitNames);
        lastJSON = defenseToJSON(flat, unitNames);
      } else if (mode === 'members_buildings') {
        const rows = pick(cachedData.buildings);
        lastCSV  = genericToCSV(buildingHeaders, rows);
        lastJSON = JSON.stringify(withTimestamp(rows.map(r => {
          const obj = { player_name: r.player_name, player_id: r.player_id, village: r.village, coords: r.coords, points: r.points };
          buildingHeaders.forEach((h, i) => { obj[h] = r.data[i] || ''; });
          return obj;
        })), null, 2);
      }
    } else {
      // 0 or 2+ modes → combined format (missing data filled with zeros)
      const troopRows = selectedModes.includes('members_troops')    ? pick(cachedData.troops)                        : [];
      const flat      = selectedModes.includes('members_defense')   ? flattenDefenseRows(pick(cachedData.defenseRaw)) : [];
      const buildRows = selectedModes.includes('members_buildings') ? pick(cachedData.buildings)                      : [];
      const combined  = combineAllModes(troopRows, flat, buildRows, unitNames, buildingHeaders);
      lastCSV  = combinedToCSV(combined, unitNames, buildingHeaders);
      lastJSON = combinedToJSON(combined, unitNames, buildingHeaders);
    }
  }

  function refreshOverview() {
    const selectedIds   = getSelectedMemberIds();
    const selectedModes = getSelectedModes();
    const { members, unitNames, unitImgSrcs, activeCmdSrc, incomingSrc, buildingHeaders, buildingImgSrcs } = cachedData;

    if (!members.length) {
      overviewTbody.innerHTML = '<tr><td colspan="5" style="color:#888;text-align:center;padding:16px;">No data loaded yet</td></tr>';
      overviewSummary.textContent = '';
      return;
    }

    const fmt = n => Number(n).toLocaleString();
    const selectedMembers = members.filter(m => selectedIds.has(m.id));
    let totalVillages = 0;
    overviewTbody.innerHTML = '';

    selectedMembers.forEach((m, idx) => {
      const troopRows = cachedData.troops[m.id]    || [];
      const defFlat   = flattenDefenseRows(cachedData.defenseRaw[m.id] || []);
      const bldgRows  = cachedData.buildings[m.id] || [];

      const troopTotal  = troopRows.reduce((s, r) => s + r.units.reduce((a, b) => a + b, 0), 0);
      const totalActive = troopRows.reduce((s, r) => s + r.active_commands, 0);
      const totalIn     = troopRows.reduce((s, r) => s + r.incoming, 0);
      const villCount   = troopRows.length || defFlat.length || bldgRows.length;
      totalVillages    += villCount;

      // Per-unit totals across all villages for this member
      const unitTotals     = unitNames.map((_, i) => troopRows.reduce((s, r) => s + (r.units[i] || 0), 0));
      const troopBreakdown = troopRows.length
        ? unitNames.map((_, i) => i).filter(i => unitTotals[i] > 0).map(i => ({ src: unitImgSrcs[i], name: unitNames[i], count: unitTotals[i] }))
        : null;

      const isExpanded = expandedPlayers.has(m.id);
      const rowBg      = '#242424';

      // ── Summary row (clickable) ──
      const summaryTr = el('tr', { style: 'cursor:pointer;background:' + rowBg + ';' });
      summaryTr.addEventListener('mouseenter', () => { summaryTr.style.background = '#2e2e2e'; });
      summaryTr.addEventListener('mouseleave', () => { summaryTr.style.background = rowBg; });
      summaryTr.addEventListener('click', () => {
        if (expandedPlayers.has(m.id)) expandedPlayers.delete(m.id);
        else expandedPlayers.add(m.id);
        refreshOverview();
      });

      const summaryCells = [
        { v: (isExpanded ? '▾  ' : '▸  ') + m.name,           label: null,               align: 'left',  color: '#f0f0f0' },
        { v: villCount,                                          label: 'villages',         align: 'right', color: '#ccc' },
        { v: troopRows.length ? fmt(totalActive) : '—',         label: 'active commands',  align: 'right', color: '#ccc' },
        { v: troopRows.length ? fmt(totalIn)     : '—',         label: 'incoming attacks', align: 'right', color: '#ccc' },
        { v: troopRows.length ? fmt(troopTotal)  : '—',         label: 'troops total',     align: 'right', color: '#ccc', breakdown: troopBreakdown },
      ];
      summaryCells.forEach(({ v, label, align, color, breakdown }, ci) => {
        const td = el('td', { style:
          'padding:7px 10px;text-align:' + align + ';color:' + color + ';' +
          'border-top:2px solid #484848;border-bottom:1px solid #333;' +
          (ci === 0 ? 'border-left:3px solid #4a6a4a;font-weight:500;' : '')
        });
        if (label) {
          const val = el('span', { style: 'display:block;' });
          val.textContent = v;
          const lbl = el('span', { style: 'display:block;font-size:10px;color:#aaa;font-weight:normal;margin-top:1px;' });
          lbl.textContent = label;
          td.append(val, lbl);
          if (breakdown && breakdown.length) {
            const bdRow = el('div', { style: 'display:flex;flex-wrap:wrap;gap:5px;margin-top:4px;justify-content:flex-end;' });
            breakdown.forEach(({ src, name, count }) => {
              const chip = el('span', { style: 'display:inline-flex;align-items:center;gap:2px;', title: name });
              if (src) {
                const img = document.createElement('img');
                img.src = src; img.alt = name;
                img.style.cssText = 'width:15px;height:15px;image-rendering:pixelated;vertical-align:middle;';
                chip.appendChild(img);
              }
              const cnt = el('span', { style: 'font-size:10px;color:#bbb;' });
              cnt.textContent = fmt(count);
              chip.appendChild(cnt);
              bdRow.appendChild(chip);
            });
            td.appendChild(bdRow);
          }
        } else {
          td.textContent = v;
        }
        summaryTr.appendChild(td);
      });
      overviewTbody.appendChild(summaryTr);

      // ── Village detail (expanded) ──
      if (isExpanded) {
        const detailTr = el('tr', { style: 'background:#0a0a0a;' });
        const detailTd = el('td', { colSpan: 5, style: 'padding:0;' });
        detailTd.appendChild(buildVillageDetail(selectedModes, troopRows, defFlat, bldgRows, unitNames, unitImgSrcs, activeCmdSrc, incomingSrc, buildingHeaders, buildingImgSrcs));
        detailTr.appendChild(detailTd);
        overviewTbody.appendChild(detailTr);
        // spacer separates this player block from the next
        const spacerTr = el('tr');
        const spacerTd = el('td', { colSpan: 5, style: 'height:5px;padding:0;background:#111;border-bottom:2px solid #484848;' });
        spacerTr.appendChild(spacerTd);
        overviewTbody.appendChild(spacerTr);
      }
    });

    const mv = selectedMembers.length;
    overviewSummary.textContent = mv + ' member' + (mv !== 1 ? 's' : '') + ' • ' + totalVillages + ' village' + (totalVillages !== 1 ? 's' : '');
  }

  function buildVillageDetail(selectedModes, troopRows, defFlat, bldgRows, unitNames, unitImgSrcs, activeCmdSrc, incomingSrc, buildingHeaders, buildingImgSrcs) {
    const outer = el('div', { style: 'display:flex;flex-direction:column;' });

    if (!selectedModes.length) {
      const msg = el('div', { style: 'color:#555;font-size:11px;padding:8px 16px;' });
      msg.textContent = 'No data mode selected';
      outer.appendChild(msg);
      return outer;
    }

    const thS   = 'padding:4px 8px;color:#555;border-bottom:1px solid #222;font-weight:normal;text-align:right;white-space:nowrap;';
    const thSL  = 'padding:4px 8px;color:#555;border-bottom:1px solid #222;font-weight:normal;text-align:left;white-space:nowrap;';
    const tdS   = 'padding:3px 8px;color:#aaa;border-bottom:1px solid #181818;text-align:right;vertical-align:middle;';
    const tdSL  = 'padding:3px 8px;color:#aaa;border-bottom:1px solid #181818;text-align:left;vertical-align:middle;';
    const tdVill = 'padding:3px 8px;color:#aaa;border-bottom:1px solid #181818;text-align:left;vertical-align:middle;max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';

    function mkth(text, left) { const e = el('th', { style: left ? thSL : thS }); e.textContent = text; return e; }
    function mktd(text, left) { const e = el('td', { style: left ? tdSL : tdS }); e.textContent = text; return e; }
    function mktdV(text) { const e = el('td', { style: tdVill, title: text }); e.textContent = text; return e; }
    function mkthImg(slug, src) {
      const e = el('th', { style: thS, title: slug });
      if (src) {
        const img = document.createElement('img');
        img.src = src; img.title = slug;
        img.style.cssText = 'width:18px;height:18px;vertical-align:middle;image-rendering:pixelated;';
        e.appendChild(img);
      } else { e.textContent = slug; }
      return e;
    }
    function rBg(i) { return i % 2 === 0 ? '' : 'background:#0d0d0d;'; }

    function makeSection(label, tableBuilder) {
      const section = el('div');
      if (selectedModes.length > 1) {
        const hd = el('div', { style: 'font-size:10px;color:#999;padding:4px 10px 2px;letter-spacing:0.5px;text-transform:uppercase;' });
        hd.textContent = label;
        section.appendChild(hd);
      }
      const t = el('table', { style: 'border-collapse:collapse;font-size:11px;white-space:nowrap;min-width:100%;' });
      tableBuilder(t);
      section.appendChild(t);
      return section;
    }

    const hasTroops  = selectedModes.includes('members_troops');
    const hasDefense = selectedModes.includes('members_defense');
    const hasBldg    = selectedModes.includes('members_buildings');

    function mkPill(text, bg, color) {
      const s = el('span', { style: 'display:inline-block;padding:1px 6px;border-radius:3px;font-size:10px;background:' + bg + ';color:' + color + ';font-weight:bold;white-space:nowrap;' });
      s.textContent = text; return s;
    }
    function mkLblTd(pill, borderColor) {
      const tc = el('td', { style: 'padding:2px 6px;border-bottom:1px solid ' + borderColor + ';text-align:left;vertical-align:middle;white-space:nowrap;' });
      tc.appendChild(pill); return tc;
    }

    if (hasTroops && hasDefense) {
      // ── Merged Troops + Defense ──
      const activeIdx = unitNames.map((_, i) => i).filter(i =>
        troopRows.some(r => (r.units[i] || 0) > 0) ||
        defFlat.some(r => (r.in_village[i] || 0) > 0 || (r.enroute[i] || 0) > 0)
      );
      const troopMap = new Map(troopRows.map(r => [r.village + '|' + r.coords, r]));
      const defMap   = new Map(defFlat.map(r =>  [r.village + '|' + r.coords, r]));
      const orderedKeys = [
        ...troopRows.map(r => r.village + '|' + r.coords),
        ...defFlat.filter(r => !troopMap.has(r.village + '|' + r.coords)).map(r => r.village + '|' + r.coords),
      ];

      outer.appendChild(makeSection('Troops & Defense', t => {
        const thead = el('thead'), tbody = el('tbody'), hr = el('tr');
        hr.append(mkth('Village', true), mkth('Coords'), mkth('Points'), mkthImg('Active cmds', activeCmdSrc), mkthImg('Incoming', incomingSrc), mkth(''));
        activeIdx.forEach(j => hr.append(mkthImg(unitNames[j], unitImgSrcs[j])));
        thead.appendChild(hr);

        orderedKeys.forEach((key, i) => {
          const tp  = troopMap.get(key);
          const df  = defMap.get(key);
          const hasTp = !!tp, hasDf = !!df;
          const rowCount  = (hasTp ? 1 : 0) + (hasDf ? 2 : 0);
          const bg        = rBg(i);
          const src       = tp || df;
          const incoming  = tp ? tp.incoming : df.incoming;
          const active    = tp ? tp.active_commands : 0;
          const grpBorder = '#2c2c2c';
          const rowBorder = '#181818';

          const tdV = el('td', { rowSpan: rowCount, style: tdVill + 'border-bottom:1px solid ' + grpBorder + ';', title: src.village }); tdV.textContent = src.village;
          const tdC = el('td', { rowSpan: rowCount, style: tdS + 'border-bottom:1px solid ' + grpBorder + ';' }); tdC.textContent = src.coords;
          const tdP = el('td', { rowSpan: rowCount, style: tdS + 'border-bottom:1px solid ' + grpBorder + ';' }); tdP.textContent = src.points;
          const tdA = el('td', { rowSpan: rowCount, style: tdS + 'border-bottom:1px solid ' + grpBorder + ';' }); tdA.textContent = active;
          const tdI = el('td', { rowSpan: rowCount, style: tdS + 'border-bottom:1px solid ' + grpBorder + ';' }); tdI.textContent = incoming;

          if (hasTp) {
            const tr1 = el('tr', { style: bg });
            tr1.append(tdV, tdC, tdP, tdA, tdI);
            tr1.appendChild(mkLblTd(mkPill('troops', '#1a1a2e', '#88c'), hasDf ? rowBorder : grpBorder));
            activeIdx.forEach(j => {
              const tc = mktd(tp.units[j] || 0);
              if (!hasDf) tc.style.borderBottom = '1px solid ' + grpBorder;
              tr1.appendChild(tc);
            });
            tbody.appendChild(tr1);
          }

          if (hasDf) {
            const tr2 = el('tr', { style: bg });
            if (!hasTp) tr2.append(tdV, tdC, tdP, tdA, tdI);
            tr2.appendChild(mkLblTd(mkPill('in village', '#0e2318', '#4a9'), rowBorder));
            activeIdx.forEach(j => tr2.append(mktd(df.in_village[j] || 0)));
            tbody.appendChild(tr2);

            const tr3 = el('tr', { style: bg });
            tr3.appendChild(mkLblTd(mkPill('en route', '#2a1505', '#c84'), grpBorder));
            activeIdx.forEach(j => {
              const tc = mktd(df.enroute[j] || 0);
              tc.style.borderBottom = '1px solid ' + grpBorder;
              tr3.appendChild(tc);
            });
            tbody.appendChild(tr3);
          }
        });

        if (!orderedKeys.length) tbody.innerHTML = '<tr><td colspan="' + (6 + activeIdx.length) + '" style="color:#555;padding:6px 8px;">No data</td></tr>';
        t.append(thead, tbody);
      }));

    } else if (hasTroops) {
      const activeIdx = unitNames.map((_, i) => i).filter(i => troopRows.some(r => (r.units[i] || 0) > 0));
      outer.appendChild(makeSection(MODES['members_troops'], t => {
        const thead = el('thead'), tbody = el('tbody'), hr = el('tr');
        hr.append(mkth('Village', true), mkth('Coords'), mkth('Points'), mkthImg('Active cmds', activeCmdSrc), mkthImg('Incoming', incomingSrc));
        activeIdx.forEach(j => hr.append(mkthImg(unitNames[j], unitImgSrcs[j])));
        thead.appendChild(hr);
        troopRows.forEach((r, i) => {
          const tr = el('tr', { style: rBg(i) });
          tr.append(mktdV(r.village), mktd(r.coords), mktd(r.points), mktd(r.active_commands), mktd(r.incoming));
          activeIdx.forEach(j => tr.append(mktd(r.units[j] || 0)));
          tbody.appendChild(tr);
        });
        if (!troopRows.length) tbody.innerHTML = '<tr><td colspan="' + (5 + activeIdx.length) + '" style="color:#555;padding:6px 8px;">No troop data</td></tr>';
        t.append(thead, tbody);
      }));

    } else if (hasDefense) {
      const activeIdx = unitNames.map((_, i) => i).filter(i => defFlat.some(r => (r.in_village[i] || 0) > 0 || (r.enroute[i] || 0) > 0));
      outer.appendChild(makeSection(MODES['members_defense'], t => {
        const thead = el('thead'), tbody = el('tbody'), hr = el('tr');
        hr.append(mkth('Village', true), mkth('Coords'), mkth('Points'), mkth('Inc'), mkth(''));
        activeIdx.forEach(j => hr.append(mkthImg(unitNames[j], unitImgSrcs[j])));
        thead.appendChild(hr);
        defFlat.forEach((r, i) => {
          const bg = rBg(i);
          const tr1 = el('tr', { style: bg });
          const tdV = el('td', { rowSpan: 2, style: tdVill, title: r.village }); tdV.textContent = r.village; tr1.appendChild(tdV);
          const tdC = el('td', { rowSpan: 2, style: tdS });  tdC.textContent = r.coords;   tr1.appendChild(tdC);
          const tdP = el('td', { rowSpan: 2, style: tdS });  tdP.textContent = r.points;   tr1.appendChild(tdP);
          const tdI = el('td', { rowSpan: 2, style: tdS });  tdI.textContent = r.incoming; tr1.appendChild(tdI);
          tr1.appendChild(mkLblTd(mkPill('in village', '#0e2318', '#4a9'), '#181818'));
          activeIdx.forEach(j => tr1.append(mktd(r.in_village[j] || 0)));
          tbody.appendChild(tr1);
          const tr2 = el('tr', { style: bg });
          tr2.appendChild(mkLblTd(mkPill('en route', '#2a1505', '#c84'), '#222'));
          activeIdx.forEach(j => {
            const tc = mktd(r.enroute[j] || 0);
            tc.style.borderBottom = '1px solid #222';
            tr2.appendChild(tc);
          });
          tbody.appendChild(tr2);
        });
        if (!defFlat.length) tbody.innerHTML = '<tr><td colspan="' + (5 + activeIdx.length) + '" style="color:#555;padding:6px 8px;">No defense data</td></tr>';
        t.append(thead, tbody);
      }));
    }

    if (hasBldg) {
      outer.appendChild(makeSection(MODES['members_buildings'], t => {
        const thead = el('thead'), tbody = el('tbody'), hr = el('tr');
        hr.append(mkth('Village', true), mkth('Coords'), mkth('Points'));
        buildingHeaders.forEach((h, i) => hr.append(mkthImg(h, (buildingImgSrcs || [])[i] || '')));
        thead.appendChild(hr);
        bldgRows.forEach((r, i) => {
          const tr = el('tr', { style: rBg(i) });
          tr.append(mktdV(r.village), mktd(r.coords), mktd(r.points));
          r.data.forEach(v => tr.append(mktd(v)));
          tbody.appendChild(tr);
        });
        if (!bldgRows.length) tbody.innerHTML = '<tr><td colspan="' + (3 + buildingHeaders.length) + '" style="color:#555;padding:6px 8px;">No building data</td></tr>';
        t.append(thead, tbody);
      }));
    }

    return outer;
  }

  async function initFetch() {
    const myId = String((window.game_data && game_data.player && game_data.player.id) || '');
    if (!myId) {
      showMessage('✗ Could not read player ID from game_data — are you logged in?');
      return;
    }

    const allyId = window.game_data && game_data.player && game_data.player.ally_id;
    if (!allyId) {
      showMessage('✗ Not in a tribe — tribe membership is required to use this script');
      return;
    }

    cachedData = { unitNames: [], unitImgSrcs: [], activeCmdSrc: '', incomingSrc: '', buildingHeaders: [], buildingImgSrcs: [], members: [], troops: {}, defenseRaw: {}, buildings: {} };
    let fetchCount = 0;

    async function doFetch(mode, playerId) {
      if (fetchCount > 0) await sleep(FETCH_DELAY_MS);
      fetchCount++;
      return fetchPlayerPage(mode, playerId);
    }

    // ── Troops (first fetch also gives member list) ──
    try {
      showMessage('Fetching member list…');
      const firstDoc = await doFetch('members_troops', myId);
      const allMembers = getMembersFromDoc(firstDoc);
      if (!allMembers.length) {
        showMessage('✗ Access denied — Baron or Duke tribe privilege is required to view member data');
        return;
      }
      cachedData.members = allMembers;
      buildMemberList(allMembers);

      const myMember = allMembers.find(m => m.id === myId) || { id: myId, name: 'Me' };
      const myTroops = parseTroopsPage(firstDoc, myMember);
      cachedData.troops[myId] = myTroops.rows;
      if (myTroops.unitNames.length) { cachedData.unitNames = myTroops.unitNames; cachedData.unitImgSrcs = myTroops.unitImgSrcs; cachedData.activeCmdSrc = myTroops.activeCmdSrc; cachedData.incomingSrc = myTroops.incomingSrc; }

      const others = allMembers.filter(m => m.id !== myId);
      for (let i = 0; i < others.length; i++) {
        const m = others[i];
        showMessage('Troops (' + (i + 2) + '/' + allMembers.length + ') ' + m.name + '…');
        try {
          const doc = await doFetch('members_troops', m.id);
          const r = parseTroopsPage(doc, m);
          cachedData.troops[m.id] = r.rows;
          if (!cachedData.unitNames.length && r.unitNames.length) { cachedData.unitNames = r.unitNames; cachedData.unitImgSrcs = r.unitImgSrcs; cachedData.activeCmdSrc = r.activeCmdSrc; cachedData.incomingSrc = r.incomingSrc; }
        } catch (e) { showMessage('Troops error — ' + m.name + ': ' + e.message); }
      }
    } catch (e) {
      showMessage('✗ Failed on first fetch: ' + e.message);
      return;
    }

    const allMembers = cachedData.members;

    // ── Defense ──
    for (let i = 0; i < allMembers.length; i++) {
      const m = allMembers[i];
      showMessage('Defense (' + (i + 1) + '/' + allMembers.length + ') ' + m.name + '…');
      try {
        const doc = await doFetch('members_defense', m.id);
        const r = parseDefensePage(doc, m);
        cachedData.defenseRaw[m.id] = r.rows;
        if (!cachedData.unitNames.length && r.unitNames.length) { cachedData.unitNames = r.unitNames; cachedData.unitImgSrcs = r.unitImgSrcs; }
      } catch (e) { showMessage('Defense error — ' + m.name + ': ' + e.message); }
    }

    // ── Buildings ──
    for (let i = 0; i < allMembers.length; i++) {
      const m = allMembers[i];
      showMessage('Buildings (' + (i + 1) + '/' + allMembers.length + ') ' + m.name + '…');
      try {
        const doc = await doFetch('members_buildings', m.id);
        const r = parseGenericUnitPage(doc, m);
        cachedData.buildings[m.id] = r.rows;
        if (!cachedData.buildingHeaders.length && r.headers.length) { cachedData.buildingHeaders = r.headers; cachedData.buildingImgSrcs = r.headerSrcs; }
      } catch (e) { showMessage('Buildings error — ' + m.name + ': ' + e.message); }
    }

    showMessage('✓ Done — ' + allMembers.length + ' member(s), ' + fetchCount + ' pages fetched');
    refreshOverview();
  }

  /* ── Event Wiring ── */

  // Draggable
  (function makeDraggable() {
    const noDragZones = [membersContent, overviewContent, resultsContent, msgBar];

    let drag = false, sx = 0, sy = 0, il = 0, it = 0;
    function onDown(e) {
      const t = e.target;
      if (t === closeBtn) return;
      if (['BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'LABEL'].indexOf(t.tagName) !== -1) return;
      if (t.closest && t.closest('button,input,textarea,select,label')) return;
      if (noDragZones.some(z => z.contains(t))) return;
      e.preventDefault();
      drag = true;
      sx = e.clientX; sy = e.clientY;
      const r = container.getBoundingClientRect();
      il = r.left; it = r.top;
      document.onmousemove = onMove;
      document.onmouseup   = onUp;
    }
    function onMove(e) {
      if (!drag) return;
      e.preventDefault();
      container.style.left      = Math.max(-container.offsetWidth + 50,  Math.min(il + e.clientX - sx, window.innerWidth  - 50)) + 'px';
      container.style.top       = Math.max(0, Math.min(it + e.clientY - sy, window.innerHeight - 50)) + 'px';
      container.style.transform = 'none';
    }
    function onUp() { drag = false; document.onmousemove = null; document.onmouseup = null; }
    container.onmousedown = onDown;
  })();

  closeBtn.addEventListener('click', () => container.remove());

  // Message history popup
  msgBar.addEventListener('click', () => {
    msgHistoryList.innerHTML = messageHistory.length === 0
      ? '<div style="color:#888;padding:8px;">No messages yet</div>'
      : messageHistory.slice().reverse().map(e => {
          const t  = e.time;
          const ts = ('0' + t.getHours()).slice(-2) + ':' + ('0' + t.getMinutes()).slice(-2) + ':' + ('0' + t.getSeconds()).slice(-2);
          return '<div style="padding:6px 4px;border-bottom:1px solid #2a2a2a;font-size:12px;">' +
            '<span style="color:#555;margin-right:8px;">' + ts + '</span>' +
            '<span style="color:#ddd;">' + e.text + '</span></div>';
        }).join('');
    msgHistoryOverlay.style.display = 'flex';
  });
  msgHistoryCloseBtn.addEventListener('click', () => { msgHistoryOverlay.style.display = 'none'; });
  msgHistoryOverlay.addEventListener('click', e => { if (e.target === msgHistoryOverlay) msgHistoryOverlay.style.display = 'none'; });

  membersCollapseBtn.onclick  = makeCollapseHandler(membersContent,  membersCollapseBtn);
  overviewCollapseBtn.onclick = makeCollapseHandler(overviewContent, overviewCollapseBtn);
  resultsCollapseBtn.onclick  = makeCollapseHandler(resultsContent,  resultsCollapseBtn);
  Object.values(modeCheckboxes).forEach(cb => cb.addEventListener('change', refreshOverview));

  helpCloseBtn.addEventListener('click', () => { helpOverlay.style.display = 'none'; });
  helpOverlay.addEventListener('click',  e => { if (e.target === helpOverlay) helpOverlay.style.display = 'none'; });

  btnGlobalHelp.addEventListener('click', e => {
    e.stopPropagation();
    showHelp('Tribe Info Extractor — Overview',
      '<b>How it works</b><br>' +
      'Run from any page while logged in. The script reads your player ID, fetches ally data for every tribe member, and caches it — no navigation needed. Progress shows in the message bar; click it to see the full fetch history.<br><br>' +
      '<b>Filter section</b><br>' +
      'Tick/untick members to include or exclude them — the Overview updates instantly and any expanded rows collapse. Use <b>All / None</b> to bulk-select members.<br>' +
      'Check one or more <b>data modes</b> (Troops, Defense, Buildings) — these control what appears in the Overview and what gets exported.<br><br>' +
      '<b>Overview section</b><br>' +
      'Click any player row to expand it and see per-village data. Click again to collapse.<br>' +
      '&bull; <b>Troops + Defense together:</b> merged table with up to 3 sub-rows per village — <span style="color:#88c">troops</span> (unit counts owned by that player), <span style="color:#4a9">in village</span> (defense present), <span style="color:#c84">en route</span> (defense traveling).<br>' +
      '&bull; <b>Troops or Defense alone:</b> single table for that mode.<br>' +
      '&bull; <b>Buildings:</b> always its own table when checked, shown after troops/defense.<br>' +
      'The unexpanded row shows totals: villages, troops, active commands, incoming, and defense in-village / en-route.<br><br>' +
      '<b>Export section</b><br>' +
      'Copy CSV or Copy JSON exports data for all ticked members in all checked modes.<br>' +
      '&bull; One mode checked: mode-specific column layout.<br>' +
      '&bull; Multiple modes checked: one combined row per village with all columns merged.<br><br>' +
      '<b>Member Troops</b><br>' +
      'All troops <i>owned by</i> the player, grouped by home village — includes units currently away. Columns: active_commands, incoming, one per unit type.<br><br>' +
      '<b>Member Defense</b><br>' +
      'Troops <i>present in or traveling to</i> each village — includes allied support. Split into in-village and en-route sub-rows.<br><br>' +
      '<b>Member Buildings</b><br>' +
      'Building levels per village — columns depend on the world\'s building set.'
    );
  });

  btnSelectAll.addEventListener('click',  () => { Object.values(memberCheckboxes).forEach(({ cb }) => { cb.checked = true;  }); expandedPlayers.clear(); refreshOverview(); });
  btnSelectNone.addEventListener('click', () => { Object.values(memberCheckboxes).forEach(({ cb }) => { cb.checked = false; }); expandedPlayers.clear(); refreshOverview(); });
  btnModeAll.addEventListener('click',   () => { Object.values(modeCheckboxes).forEach(cb => { cb.checked = true;  }); refreshOverview(); });
  btnModeNone.addEventListener('click',  () => { Object.values(modeCheckboxes).forEach(cb => { cb.checked = false; }); refreshOverview(); });

  btnCopyCSV.addEventListener('click', () => {
    if (!cachedData.members.length) { showMessage('Data not loaded yet'); return; }
    generateExport();
    copyText(lastCSV).then(() => showMessage('CSV copied!')).catch(() => showMessage('Copy failed'));
  });

  btnCopyJSON.addEventListener('click', () => {
    if (!cachedData.members.length) { showMessage('Data not loaded yet'); return; }
    generateExport();
    copyText(lastJSON).then(() => showMessage('JSON copied!')).catch(() => showMessage('Copy failed'));
  });

  /* ── Init ── */

  buildMemberList([]); // show empty list with "loading" state until fetch completes
  initFetch();

})();
