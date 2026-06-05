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
    const names = [];
    const seen  = new Set();
    table.querySelectorAll('thead th, tr:first-child th').forEach(th => {
      const img  = th.querySelector('img');
      if (!img) return;
      const disp = img.getAttribute('data-title') || img.getAttribute('alt') || img.getAttribute('title') || '';
      if (!disp) return;
      const slug = UNIT_NAME_MAP[disp] || disp.toLowerCase().replace(/\s+/g, '_');
      if (!seen.has(slug)) { seen.add(slug); names.push(slug); }
    });
    return names.length ? names : UNIT_COLS.slice();
  }

  function parseDefensePage(doc, player) {
    const table = findUnitTable(doc);
    if (!table) return { rows: [], unitNames: UNIT_COLS.slice() };

    const unitNames = detectUnitNamesFromTable(table);
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

    return { rows, unitNames };
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
    if (!table) return { rows: [], unitNames: UNIT_COLS.slice() };

    const unitNames = detectUnitNamesFromTable(table);
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
      const N      = cells.length - 4;
      const units  = cells.slice(2, 2 + N).map(cellInt);
      const active = cellInt(cells[2 + N]);
      const incoming = cellInt(cells[3 + N]);
      rows.push({ player_name: player.name, player_id: player.id, village, coords, points, active_commands: active, incoming, units });
    });

    return { rows, unitNames };
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
    if (!headerRow) return [];
    return Array.from(headerRow.querySelectorAll('th')).map(th => {
      const img = th.querySelector('img');
      return (img && (img.getAttribute('data-title') || img.getAttribute('alt') || img.getAttribute('title')))
        || th.textContent.trim();
    });
  }

  function parseGenericUnitPage(doc, player) {
    const table = findUnitTable(doc);
    if (!table) return { headers: [], rows: [] };
    const headers = readUnitTableHeaders(table);
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

    return { headers, rows };
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

  let msgBox;
  const messageHistory = [];

  function showMessage(msg, timeout) {
    messageHistory.push({ text: msg, time: new Date() });
    if (!msgBox) return;
    msgBox.textContent = msg;
    if (msgBox._t) clearTimeout(msgBox._t);
    msgBox._t = setTimeout(() => { msgBox.textContent = ''; }, timeout || 4000);
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
           'font-family:Arial,Helvetica,sans-serif;font-size:13px;width:920px;max-height:88vh;' +
           'box-shadow:0 8px 24px rgba(0,0,0,0.8);resize:both;overflow:hidden;border:2px solid #333;' +
           'display:flex;flex-direction:column;',
  });

  // ── Title Bar ──
  const titleBar     = el('div', { style: 'cursor:move;padding:14px 16px;background:linear-gradient(135deg,#2a2a2a 0%,#1a1a1a 100%);border-top-left-radius:6px;border-top-right-radius:6px;user-select:none;border-bottom:2px solid #444;position:relative;flex-shrink:0;' });
  const titleWrapper = el('div', { style: 'text-align:center;position:relative;' });
  const titleEl      = el('div', { style: 'font-size:20px;font-weight:bold;color:#e0e0e0;text-shadow:2px 2px 4px rgba(0,0,0,0.6);letter-spacing:1px;' });
  titleEl.textContent = 'TRIBE INFO EXTRACTOR';

  const btnGlobalHelp = el('button', { innerText: '?', title: 'Help', type: 'button', style: 'position:absolute;left:10px;top:50%;transform:translateY(-50%);cursor:pointer;padding:4px 9px;background:#1a2a1a;color:#6d6;border:1px solid #2a4a2a;border-radius:4px;font-size:14px;font-weight:bold;' });
  const closeBtn      = el('button', { innerText: '✕', title: 'Close', style: 'position:absolute;right:0;top:50%;transform:translateY(-50%);cursor:pointer;padding:4px 10px;background:#444;color:#fff;border:1px solid #666;border-radius:4px;font-size:16px;font-weight:bold;' });

  titleWrapper.append(titleEl, closeBtn);
  titleBar.append(btnGlobalHelp, titleWrapper);
  container.appendChild(titleBar);

  // ── Scrollable Body ──
  const body = el('div', { style: 'padding:16px;overflow-y:auto;flex:1;' });
  container.appendChild(body);

  // ── Navigation Section ──
  const navSection       = el('div', { style: 'margin-bottom:12px;padding:12px;background:#0f0f0f;border-radius:6px;border:1px solid #333;' });
  const navSectionHeader = el('div', { style: 'display:flex;align-items:center;margin-bottom:10px;' });
  const navSectionTitle  = el('div', { style: 'font-weight:bold;color:#aaa;font-size:13px;flex:1;text-align:center;' });
  navSectionTitle.textContent = 'Navigation';
  const navCollapseBtn   = el('button', { innerText: '−', type: 'button', style: 'cursor:pointer;padding:2px 8px;background:#2a2a2a;color:#fff;border:1px solid #4a4a4a;border-radius:3px;font-size:16px;font-weight:bold;line-height:1;' });
  navSectionHeader.append(navSectionTitle, navCollapseBtn);
  navSection.appendChild(navSectionHeader);

  const navContent = el('div');

  const navBtnRow = el('div', { style: 'display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-bottom:10px;' });
  Object.keys(MODES).forEach(mode => {
    const isActive = currentMode === mode;
    const btn = el('button', {
      innerText: MODES[mode],
      type:      'button',
      style:     'cursor:pointer;padding:8px 18px;font-size:12px;font-weight:' + (isActive ? 'bold' : 'normal') + ';border-radius:4px;' +
                 'border:1px solid ' + (isActive ? '#3a7a3a' : '#4a4a4a') + ';' +
                 'background:' + (isActive ? '#1a4a1a' : '#2a2a2a') + ';' +
                 'color:' + (isActive ? '#6f6' : '#fff') + ';',
    });
    if (isActive) {
      btn.style.cursor = 'default';
      btn.title = 'Currently on this page';
    } else {
      btn.onclick = () => window.location.href = buildAllyUrl(mode);
    }
    navBtnRow.appendChild(btn);
  });

  const navStatusBar = el('div', { style: 'padding:6px;border-radius:4px;text-align:center;font-size:12px;' +
    (isAllyPage && isKnownMode
      ? 'background:#0a1a0a;border:1px solid #2a5a2a;color:#6d6;'
      : 'background:#0a0a1a;border:1px solid #2a2a5a;color:#88f;') });
  navStatusBar.textContent = isAllyPage && isKnownMode
    ? '✓ Currently viewing ' + MODES[currentMode]
    : 'Data is fetched automatically — navigation links above are optional shortcuts.';

  navContent.append(navBtnRow, navStatusBar);
  navSection.appendChild(navContent);
  body.appendChild(navSection);

  // ── Members Section ──
  const membersSection       = el('div', { style: 'margin-bottom:12px;padding:12px;background:#0f0f0f;border-radius:6px;border:1px solid #333;' });
  const membersSectionHeader = el('div', { style: 'display:flex;align-items:center;margin-bottom:10px;' });
  const membersSectionTitle  = el('div', { style: 'font-weight:bold;color:#aaa;font-size:13px;flex:1;text-align:center;' });
  membersSectionTitle.textContent = 'Tribe Members';
  const membersCollapseBtn   = el('button', { innerText: '−', type: 'button', style: 'cursor:pointer;padding:2px 8px;background:#2a2a2a;color:#fff;border:1px solid #4a4a4a;border-radius:3px;font-size:16px;font-weight:bold;line-height:1;' });
  membersSectionHeader.append(membersSectionTitle, membersCollapseBtn);
  membersSection.appendChild(membersSectionHeader);

  const membersContent = el('div');

  const membersTopRow = el('div', { style: 'display:flex;gap:8px;align-items:center;margin-bottom:8px;' });
  const membersCountLabel = el('span', { style: 'font-size:12px;color:#888;flex:1;' });
  const btnSelectAll   = el('button', { innerText: 'All',  type: 'button', style: 'cursor:pointer;padding:4px 10px;background:#2a3a2a;color:#aaa;border:1px solid #3a5a3a;border-radius:3px;font-size:11px;' });
  const btnSelectNone  = el('button', { innerText: 'None', type: 'button', style: 'cursor:pointer;padding:4px 10px;background:#2a2a2a;color:#aaa;border:1px solid #4a4a4a;border-radius:3px;font-size:11px;' });
  membersTopRow.append(membersCountLabel, btnSelectAll, btnSelectNone);

  const membersList = el('div', { style: 'display:flex;flex-wrap:wrap;gap:6px;' });

  const memberCheckboxes = {};

  membersContent.append(membersTopRow, membersList);
  membersSection.appendChild(membersContent);
  body.appendChild(membersSection);

  // ── Extract Section ──
  const extractSection       = el('div', { style: 'margin-bottom:12px;padding:12px;background:#0f0f0f;border-radius:6px;border:1px solid #333;' });
  const extractSectionHeader = el('div', { style: 'display:flex;align-items:center;margin-bottom:10px;' });
  const extractSectionTitle  = el('div', { style: 'font-weight:bold;color:#aaa;font-size:13px;flex:1;text-align:center;' });
  extractSectionTitle.textContent = 'Progress';
  const extractCollapseBtn   = el('button', { innerText: '−', type: 'button', style: 'cursor:pointer;padding:2px 8px;background:#2a2a2a;color:#fff;border:1px solid #4a4a4a;border-radius:3px;font-size:16px;font-weight:bold;line-height:1;' });
  extractSectionHeader.append(extractSectionTitle, extractCollapseBtn);
  extractSection.appendChild(extractSectionHeader);

  const extractContent = el('div');
  const progressBox = el('div', { style: 'padding:8px;background:#0a0a0a;border:1px solid #2a2a2a;border-radius:4px;font-size:12px;font-family:monospace;color:#aaa;min-height:36px;white-space:pre-wrap;' });
  progressBox.textContent = 'Initialising...';
  extractContent.appendChild(progressBox);
  extractSection.appendChild(extractContent);
  body.appendChild(extractSection);

  // ── Results Section ──
  const resultsSection       = el('div', { style: 'margin-bottom:12px;padding:12px;background:#0f0f0f;border-radius:6px;border:1px solid #333;' });
  const resultsSectionHeader = el('div', { style: 'display:flex;align-items:center;margin-bottom:10px;' });
  const resultsSectionTitle  = el('div', { style: 'font-weight:bold;color:#aaa;font-size:13px;flex:1;text-align:center;' });
  resultsSectionTitle.textContent = 'Export';
  const resultsCollapseBtn   = el('button', { innerText: '+', type: 'button', style: 'cursor:pointer;padding:2px 8px;background:#2a2a2a;color:#fff;border:1px solid #4a4a4a;border-radius:3px;font-size:16px;font-weight:bold;line-height:1;' });
  resultsSectionHeader.append(resultsSectionTitle, resultsCollapseBtn);
  resultsSection.appendChild(resultsSectionHeader);

  const resultsContent = el('div', { style: 'display:none;' });

  const resultsSummary = el('div', { style: 'font-size:12px;color:#888;text-align:center;margin-bottom:8px;min-height:16px;' });

  // Mode selector (for export — not for fetching)
  const modeRow    = el('div', { style: 'display:flex;gap:8px;justify-content:center;margin-bottom:10px;flex-wrap:wrap;' });
  const modeRadios = {};
  Object.keys(MODES).forEach((mode, idx) => {
    const label = el('label', { style: 'display:flex;align-items:center;gap:5px;cursor:pointer;padding:6px 12px;background:#1a1a1a;border:1px solid #3a3a3a;border-radius:4px;font-size:12px;color:#bbb;' });
    const radio  = el('input', { type: 'radio', name: 'export_mode', value: mode, style: 'cursor:pointer;' });
    if (idx === 0) radio.checked = true;
    modeRadios[mode] = radio;
    label.append(radio, document.createTextNode(MODES[mode]));
    modeRow.appendChild(label);
  });
  {
    const label = el('label', { style: 'display:flex;align-items:center;gap:5px;cursor:pointer;padding:6px 12px;background:#1a1a1a;border:1px solid #4a3a1a;border-radius:4px;font-size:12px;color:#cc9;' });
    const radio  = el('input', { type: 'radio', name: 'export_mode', value: 'all_modes', style: 'cursor:pointer;' });
    modeRadios['all_modes'] = radio;
    label.append(radio, document.createTextNode('All Modes'));
    modeRow.appendChild(label);
  }

  const exportRow   = el('div', { style: 'display:flex;gap:8px;justify-content:center;margin-bottom:10px;flex-wrap:wrap;' });
  const btnCopyCSV  = el('button', { innerText: 'Copy CSV',  type: 'button', style: 'cursor:pointer;padding:8px 18px;background:#2a3a5a;color:#fff;border:1px solid #3a5a7a;border-radius:4px;font-size:12px;' });
  const btnCopyJSON = el('button', { innerText: 'Copy JSON', type: 'button', style: 'cursor:pointer;padding:8px 18px;background:#2a3a5a;color:#fff;border:1px solid #3a5a7a;border-radius:4px;font-size:12px;' });
  exportRow.append(btnCopyCSV, btnCopyJSON);

  const resultsOutput = el('div', { style: 'background:#0a0a0a;border:1px solid #2a2a2a;border-radius:4px;padding:10px;font-family:monospace;font-size:11px;color:#ccc;max-height:320px;overflow-y:auto;white-space:pre;overflow-x:auto;min-height:60px;' });
  resultsOutput.textContent = 'Loading data...';

  resultsContent.append(resultsSummary, modeRow, exportRow, resultsOutput);
  resultsSection.appendChild(resultsContent);
  body.appendChild(resultsSection);

  // ── Discovery Section ──
  const discoverSection       = el('div', { style: 'margin-bottom:12px;padding:12px;background:#0f0f0f;border-radius:6px;border:1px solid #333;' });
  const discoverSectionHeader = el('div', { style: 'display:flex;align-items:center;margin-bottom:8px;' });
  const discoverSectionTitle  = el('div', { style: 'font-weight:bold;color:#aaa;font-size:13px;flex:1;text-align:center;' });
  discoverSectionTitle.textContent = 'Page Structure (Discovery)';
  const discoverCollapseBtn   = el('button', { innerText: '+', type: 'button', style: 'cursor:pointer;padding:2px 8px;background:#2a2a2a;color:#fff;border:1px solid #4a4a4a;border-radius:3px;font-size:16px;font-weight:bold;line-height:1;' });
  const discoverHelpBtn       = el('button', { innerText: '?', type: 'button', style: 'cursor:pointer;padding:2px 7px;background:#1a2a1a;color:#6d6;border:1px solid #2a4a2a;border-radius:3px;font-size:13px;font-weight:bold;line-height:1;margin-right:4px;' });
  discoverSectionHeader.append(discoverHelpBtn, discoverSectionTitle, discoverCollapseBtn);
  discoverSection.appendChild(discoverSectionHeader);

  const discoverContent  = el('div', { style: 'display:none;' });
  const btnScan          = el('button', { innerText: 'Scan Current Page Structure', type: 'button', style: 'cursor:pointer;padding:8px 20px;background:#5a3a2a;color:#fff;border:1px solid #7a5a3a;border-radius:4px;font-weight:bold;margin-bottom:10px;' });
  const discoverOutput   = el('div', { style: 'background:#0a0a0a;border:1px solid #2a2a2a;border-radius:4px;padding:10px;font-family:monospace;font-size:11px;color:#ccc;max-height:300px;overflow-y:auto;white-space:pre-wrap;word-break:break-word;min-height:60px;' });
  discoverOutput.textContent = 'Scan to inspect table structure — useful for Troops and Buildings pages.';
  discoverContent.append(btnScan, discoverOutput);
  discoverSection.appendChild(discoverContent);
  body.appendChild(discoverSection);

  // ── Message Box ──
  msgBox = el('div', { style: 'color:#9f9f9f;min-height:18px;text-align:center;padding:5px;background:#0a0a0a;border-radius:4px;border:1px solid #2a2a2a;cursor:pointer;', title: 'Click to view message history' });
  body.appendChild(msgBox);

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

  // ── Footer ──
  const footer = el('div', { style: 'padding:10px;background:linear-gradient(135deg,#1a1a1a 0%,#0a0a0a 100%);border-bottom-left-radius:6px;border-bottom-right-radius:6px;border-top:2px solid #444;text-align:center;flex-shrink:0;' });
  const footerAuthor = el('div', { style: 'font-size:12px;color:#888;letter-spacing:0.5px;' });
  footerAuthor.textContent = 'Created by NeilB';
  footer.appendChild(footerAuthor);
  container.appendChild(footer);
  document.body.appendChild(container);

  // ── Help Overlay ──
  helpOverlay = el('div', { style: 'position:fixed;left:0;top:0;width:100%;height:100%;background:rgba(0,0,0,0.75);z-index:200000;display:none;align-items:center;justify-content:center;' });
  const helpContent  = el('div', { style: 'background:#1a1a1a;color:#fff;padding:24px;border-radius:8px;border:2px solid #444;max-width:520px;width:90%;' });
  helpTitle          = el('div', { style: 'font-size:16px;font-weight:bold;margin-bottom:12px;color:#e0e0e0;' });
  helpText           = el('div', { style: 'font-size:13px;color:#bbb;line-height:1.7;margin-bottom:16px;' });
  const helpCloseRow = el('div', { style: 'display:flex;justify-content:center;' });
  const helpCloseBtn = el('button', { innerText: 'Close', type: 'button', style: 'cursor:pointer;padding:8px 24px;background:#444;color:#fff;border:1px solid #666;border-radius:4px;' });
  helpCloseRow.appendChild(helpCloseBtn);
  helpContent.append(helpTitle, helpText, helpCloseRow);
  helpOverlay.appendChild(helpContent);
  document.body.appendChild(helpOverlay);

  /* ── State ── */

  let lastCSV  = '';
  let lastJSON = '';
  let cachedData = { unitNames: [], buildingHeaders: [], members: [], troops: {}, defenseRaw: {}, buildings: {} };

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

  function getSelectedMode() {
    for (const mode in modeRadios) {
      if (modeRadios[mode].checked) return mode;
    }
    return 'all_modes';
  }

  function getSelectedMemberIds() {
    return new Set(
      Object.entries(memberCheckboxes)
        .filter(([, { cb }]) => cb.checked)
        .map(([id]) => id)
    );
  }

  function generateExport() {
    const mode        = getSelectedMode();
    const selectedIds = getSelectedMemberIds();
    const { unitNames, buildingHeaders, members } = cachedData;
    const pick = store => members.filter(m => selectedIds.has(m.id)).flatMap(m => store[m.id] || []);

    if (mode === 'members_troops') {
      const rows = pick(cachedData.troops);
      lastCSV  = troopsToCSV(rows, unitNames);
      lastJSON = troopsToJSON(rows, unitNames);
      const N  = new Set(rows.map(r => r.player_id)).size;
      resultsSummary.textContent = N + ' member(s) — ' + rows.length + ' village(s)';
      resultsOutput.textContent = rows.slice(0, 10).map(r =>
        r.player_name.padEnd(12) + '  ' + r.coords.padEnd(9) + '  pts:' + String(r.points).padEnd(5) +
        '  out:' + String(r.active_commands).padEnd(3) + '  in:' + String(r.incoming).padEnd(3) +
        '  spear:' + (r.units[0] || 0) + '  sword:' + (r.units[1] || 0)
      ).join('\n') + (rows.length > 10 ? '\n... (' + (rows.length - 10) + ' more)' : '');

    } else if (mode === 'members_defense') {
      const flat = flattenDefenseRows(pick(cachedData.defenseRaw));
      lastCSV  = defenseToCSV(flat, unitNames);
      lastJSON = defenseToJSON(flat, unitNames);
      const N  = new Set(flat.map(r => r.player_id)).size;
      resultsSummary.textContent = N + ' member(s) — ' + flat.length + ' village(s)';
      resultsOutput.textContent = flat.slice(0, 10).map(r =>
        r.player_name.padEnd(12) + '  ' + r.coords.padEnd(9) + '  pts:' + String(r.points).padEnd(5) +
        '  atk_in:' + String(r.incoming).padEnd(3) + '  spear:' + r.in_village[0] + '/' + r.enroute[0]
      ).join('\n') + (flat.length > 10 ? '\n... (' + (flat.length - 10) + ' more)' : '');

    } else if (mode === 'members_buildings') {
      const rows = pick(cachedData.buildings);
      lastCSV  = genericToCSV(buildingHeaders, rows);
      lastJSON = JSON.stringify(withTimestamp(rows.map(r => {
        const obj = { player_name: r.player_name, player_id: r.player_id, village: r.village, coords: r.coords, points: r.points };
        buildingHeaders.forEach((h, i) => { obj[h] = r.data[i] || ''; });
        return obj;
      })), null, 2);
      const N  = new Set(rows.map(r => r.player_id)).size;
      resultsSummary.textContent = N + ' member(s) — ' + rows.length + ' village(s)';
      resultsOutput.textContent = rows.slice(0, 10).map(r =>
        r.player_name.padEnd(12) + '  ' + (r.coords || '').padEnd(9) + '  pts:' + String(r.points).padEnd(5) + '  ' + r.data.slice(0, 5).join('  ')
      ).join('\n') + (rows.length > 10 ? '\n... (' + (rows.length - 10) + ' more)' : '');

    } else { // all_modes
      const troopRows = pick(cachedData.troops);
      const flat      = flattenDefenseRows(pick(cachedData.defenseRaw));
      const buildRows = pick(cachedData.buildings);
      const combined  = combineAllModes(troopRows, flat, buildRows, unitNames, buildingHeaders);
      lastCSV  = combinedToCSV(combined, unitNames, buildingHeaders);
      lastJSON = combinedToJSON(combined, unitNames, buildingHeaders);
      const N  = new Set(combined.map(r => r.player_id)).size;
      resultsSummary.textContent = N + ' member(s) — ' + combined.length + ' village(s)';
      resultsOutput.textContent = combined.slice(0, 5).map(r =>
        r.player_name.padEnd(12) + '  ' + (r.coords || '').padEnd(9) + '  pts:' + String(r.points).padEnd(5) +
        '  spear:' + (r.troops[0] || 0) + '  spear_iv:' + (r.in_village[0] || 0) + '  bldg[0]:' + (r.buildings[0] || '-')
      ).join('\n') + (combined.length > 5 ? '\n... (' + (combined.length - 5) + ' more)' : '');
    }
  }

  async function initFetch() {
    const myId = String((window.game_data && game_data.player && game_data.player.id) || '');
    if (!myId) {
      progressBox.textContent = '✗ Could not read player ID from game_data — are you logged in?';
      return;
    }

    cachedData = { unitNames: [], buildingHeaders: [], members: [], troops: {}, defenseRaw: {}, buildings: {} };
    let fetchCount = 0;

    async function doFetch(mode, playerId) {
      if (fetchCount > 0) await sleep(FETCH_DELAY_MS);
      fetchCount++;
      return fetchPlayerPage(mode, playerId);
    }

    // ── Troops (first fetch also gives member list) ──
    try {
      const firstDoc = await doFetch('members_troops', myId);
      const allMembers = getMembersFromDoc(firstDoc);
      if (!allMembers.length) {
        progressBox.textContent = '✗ No members found in dropdown — do you have tribe rights to view member info?';
        return;
      }
      cachedData.members = allMembers;
      buildMemberList(allMembers);

      const myMember = allMembers.find(m => m.id === myId) || { id: myId, name: 'Me' };
      const myTroops = parseTroopsPage(firstDoc, myMember);
      cachedData.troops[myId] = myTroops.rows;
      if (myTroops.unitNames.length) cachedData.unitNames = myTroops.unitNames;

      const others = allMembers.filter(m => m.id !== myId);
      for (let i = 0; i < others.length; i++) {
        const m = others[i];
        progressBox.textContent = 'Troops (' + (i + 2) + '/' + allMembers.length + ') ' + m.name + '...';
        try {
          const doc = await doFetch('members_troops', m.id);
          const r = parseTroopsPage(doc, m);
          cachedData.troops[m.id] = r.rows;
          if (!cachedData.unitNames.length && r.unitNames.length) cachedData.unitNames = r.unitNames;
        } catch (e) { showMessage('Troops — ' + m.name + ': ' + e.message); }
      }
    } catch (e) {
      progressBox.textContent = '✗ Failed on first fetch: ' + e.message;
      return;
    }

    const allMembers = cachedData.members;

    // ── Defense ──
    for (let i = 0; i < allMembers.length; i++) {
      const m = allMembers[i];
      progressBox.textContent = 'Defense (' + (i + 1) + '/' + allMembers.length + ') ' + m.name + '...';
      try {
        const doc = await doFetch('members_defense', m.id);
        const r = parseDefensePage(doc, m);
        cachedData.defenseRaw[m.id] = r.rows;
        if (!cachedData.unitNames.length && r.unitNames.length) cachedData.unitNames = r.unitNames;
      } catch (e) { showMessage('Defense — ' + m.name + ': ' + e.message); }
    }

    // ── Buildings ──
    for (let i = 0; i < allMembers.length; i++) {
      const m = allMembers[i];
      progressBox.textContent = 'Buildings (' + (i + 1) + '/' + allMembers.length + ') ' + m.name + '...';
      try {
        const doc = await doFetch('members_buildings', m.id);
        const r = parseGenericUnitPage(doc, m);
        cachedData.buildings[m.id] = r.rows;
        if (!cachedData.buildingHeaders.length && r.headers.length) cachedData.buildingHeaders = r.headers;
      } catch (e) { showMessage('Buildings — ' + m.name + ': ' + e.message); }
    }

    progressBox.textContent = '✓ Done — ' + allMembers.length + ' member(s), ' + fetchCount + ' pages fetched';
    makeCollapseHandler(extractContent, extractCollapseBtn)(); // auto-collapse progress
    ensureExpanded(resultsContent, resultsCollapseBtn);
    generateExport();
    showMessage('Data loaded — ' + allMembers.length + ' member(s)');
  }

  /* ── Discovery Scan ── */

  function scanCurrentPage() {
    const area    = document.getElementById('content_value') || document.body;
    const tables  = Array.from(area.querySelectorAll('table'));
    let out = '── URL: ' + window.location.href + '\n\n';
    out += '── Tables found: ' + tables.length + ' ──\n\n';

    tables.forEach((table, idx) => {
      const headerCells = Array.from(table.querySelectorAll('thead tr th, tr:first-child th'));
      const headers = headerCells.map(th => {
        const img = th.querySelector('img[data-title]');
        return img ? img.getAttribute('data-title') : (th.textContent.trim() || '(empty)');
      });
      const bodyRows = table.querySelectorAll('tbody tr, tr:not(:first-child)');
      const firstRow = bodyRows[0] ? Array.from(bodyRows[0].querySelectorAll('td')).map(c => c.textContent.trim().slice(0, 20)) : [];

      out += '┌ Table ' + (idx + 1) + '  id="' + (table.id || 'none') + '"  class="' + (table.className || 'none').slice(0, 40) + '"\n';
      out += '│ Header cols (' + headers.length + '): ' + headers.join(' | ') + '\n';
      out += '│ Body rows: ' + bodyRows.length + '\n';
      if (firstRow.length) out += '│ First row: ' + firstRow.join(' | ') + '\n';
      out += '└─\n\n';
    });

    return out;
  }

  /* ── Event Wiring ── */

  // Draggable
  (function makeDraggable() {
    // Section content areas — drag does not activate when clicking inside these
    const noDragZones = [navContent, membersContent, extractContent, resultsContent, discoverContent, msgBox];

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

  // Message history
  msgBox.addEventListener('click', () => {
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

  navCollapseBtn.onclick      = makeCollapseHandler(navContent,      navCollapseBtn);
  membersCollapseBtn.onclick  = makeCollapseHandler(membersContent,  membersCollapseBtn);
  extractCollapseBtn.onclick  = makeCollapseHandler(extractContent,  extractCollapseBtn);
  resultsCollapseBtn.onclick  = makeCollapseHandler(resultsContent,  resultsCollapseBtn);
  discoverCollapseBtn.onclick = makeCollapseHandler(discoverContent, discoverCollapseBtn);

  helpCloseBtn.addEventListener('click', () => { helpOverlay.style.display = 'none'; });
  helpOverlay.addEventListener('click',  e => { if (e.target === helpOverlay) helpOverlay.style.display = 'none'; });

  btnGlobalHelp.addEventListener('click', e => {
    e.stopPropagation();
    showHelp('Tribe Info Extractor — Overview',
      '<b>How it works</b><br>' +
      'On load the script reads your player ID from <code>game_data</code>, fetches all three ally data pages for every tribe member, and caches the results. No navigation required.<br><br>' +
      '<b>Workflow</b><br>' +
      '1. Run the script from any page while logged in.<br>' +
      '2. Wait for the Progress section to show ✓ Done.<br>' +
      '3. Untick any members you want to exclude.<br>' +
      '4. Select export mode and click Copy CSV or Copy JSON.<br><br>' +
      '<b>Member Troops</b><br>' +
      'All troops <i>owned by</i> the player, grouped by home village — includes units currently away. ' +
      'Columns: player_name, player_id, village, coords, points, active_commands, incoming, then one column per unit type.<br><br>' +
      '<b>Member Defense</b><br>' +
      'Troops <i>present in or traveling to</i> each village — includes allied support. ' +
      'Columns: …points, incoming_attacks, spear_in_village…militia_in_village, spear_enroute…militia_enroute.<br><br>' +
      '<b>Member Buildings</b><br>' +
      'Building levels per village — columns depend on the world\'s building set.<br><br>' +
      '<b>All Modes</b><br>' +
      'One combined row per village with troops, defense, and building columns merged.'
    );
  });

  discoverHelpBtn.addEventListener('click', e => {
    e.stopPropagation();
    showHelp('Page Structure Scanner',
      'Scans all tables on the current page and shows their headers, row count, and first row preview.<br><br>' +
      'Use this on <i>Member Troops</i> and <i>Member Buildings</i> pages to understand their column layout before proper parsers are built.'
    );
  });

  btnSelectAll.addEventListener('click',  () => Object.values(memberCheckboxes).forEach(({ cb }) => { cb.checked = true; }));
  btnSelectNone.addEventListener('click', () => Object.values(memberCheckboxes).forEach(({ cb }) => { cb.checked = false; }));

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

  btnScan.addEventListener('click', () => {
    discoverOutput.textContent = scanCurrentPage();
    ensureExpanded(discoverContent, discoverCollapseBtn);
    showMessage('Scan complete');
  });

  /* ── Init ── */

  buildMemberList([]); // show empty list with "loading" state until fetch completes
  initFetch();

})();
