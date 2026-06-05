// NeilsTribeInfoExtractor
(function () {

  /* ── Constants ── */

  const MODES = {
    members_troops:    'Member Troops',
    members_buildings: 'Member Buildings',
    members_defense:   'Member Defense'
  };

  /* ── Utilities ── */

  function el(tag, opts) {
    const e = document.createElement(tag);
    if (opts) Object.keys(opts).forEach(k => { e[k] = opts[k]; });
    return e;
  }

  function navigateTo(mode, extraParams) {
    try {
      const u = new URL(window.location.origin + window.location.pathname);
      u.searchParams.set('screen', 'ally');
      u.searchParams.set('mode', mode);
      if (extraParams) Object.keys(extraParams).forEach(k => u.searchParams.set(k, extraParams[k]));
      window.location.href = u.toString();
    } catch (e) {
      window.location.href = window.location.origin + window.location.pathname
        + '?screen=ally&mode=' + mode;
    }
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
        const ok = document.execCommand('copy');
        ta.remove();
        ok ? resolve() : reject(new Error('execCommand failed'));
      } catch (e) { reject(e); }
    });
  }

  /* ── Page Detection ── */

  const urlParams    = new URLSearchParams(window.location.search);
  const currentMode  = urlParams.get('mode')   || '';
  const currentScreen = urlParams.get('screen') || '';
  const isAllyPage   = currentScreen === 'ally';
  const isKnownMode  = currentMode in MODES;

  /* ── Data Extraction ── */

  function cellText(cell) {
    const img = cell.querySelector('img[alt], img[title]');
    if (img) return img.alt || img.title || cell.textContent.trim();
    return cell.textContent.trim().replace(/\s+/g, ' ');
  }

  function extractTable(table) {
    const headers = [];
    const rows    = [];

    const theadRow = table.querySelector('thead tr');
    if (theadRow) {
      theadRow.querySelectorAll('th, td').forEach(c => headers.push(cellText(c)));
    }

    const tbodyRows = table.querySelectorAll('tbody tr');
    const sourceRows = tbodyRows.length ? tbodyRows : table.querySelectorAll('tr');
    sourceRows.forEach((row, idx) => {
      if (!tbodyRows.length && idx === 0) return;
      const cells = Array.from(row.querySelectorAll('td')).map(cellText);
      if (cells.length) rows.push(cells);
    });

    return { headers, rows };
  }

  function findContentArea() {
    return document.getElementById('content_value')
      || document.getElementById('main_content')
      || document.querySelector('#content_value, #main_content, .content-main, #game_body')
      || document.body;
  }

  function scanAllTables() {
    const area   = findContentArea();
    const tables = Array.from(area.querySelectorAll('table'));
    return tables.map((table, idx) => {
      const { headers, rows } = extractTable(table);
      return {
        index:     idx + 1,
        id:        table.id        || '(none)',
        className: table.className || '(none)',
        headers,
        rows,
      };
    }).filter(t => t.rows.length || t.headers.length);
  }

  function getGameDataSnapshot() {
    try {
      if (typeof game_data === 'undefined') return null;
      return {
        player_id:   game_data.player  && game_data.player.id,
        player_name: game_data.player  && game_data.player.name,
        ally_id:     game_data.ally    && game_data.ally.id,
        ally_name:   game_data.ally    && game_data.ally.name,
        top_keys:    Object.keys(game_data),
      };
    } catch (e) { return null; }
  }

  function pickPrimaryTable(tables) {
    if (!tables.length) return null;
    return tables.reduce((best, t) =>
      (t.rows.length > best.rows.length ? t : best), tables[0]);
  }

  /* ── Export ── */

  function toCSV(headers, rows) {
    const escape = s => '"' + String(s || '').replace(/"/g, '""') + '"';
    const lines  = [];
    if (headers.length) lines.push(headers.map(escape).join(','));
    rows.forEach(row => lines.push(row.map(escape).join(',')));
    return lines.join('\n');
  }

  function toJSON(headers, rows) {
    const objects = rows.map(row => {
      const obj = {};
      headers.forEach((h, i) => { obj[h || 'col' + i] = row[i] || ''; });
      return obj;
    });
    return JSON.stringify(objects, null, 2);
  }

  /* ── Message System ── */

  let msgBox;
  const messageHistory = [];

  function showMessage(msg, timeout) {
    messageHistory.push({ text: msg, time: new Date() });
    if (!msgBox) return;
    msgBox.textContent = msg;
    if (msgBox._t) clearTimeout(msgBox._t);
    msgBox._t = setTimeout(() => { msgBox.textContent = ''; }, timeout || 3000);
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
           'font-family:Arial,Helvetica,sans-serif;font-size:13px;width:920px;max-height:85vh;' +
           'box-shadow:0 8px 24px rgba(0,0,0,0.8);resize:both;overflow:hidden;border:2px solid #333;' +
           'display:flex;flex-direction:column;',
  });

  // ── Title Bar ──
  const titleBar     = el('div', { style: 'cursor:move;padding:16px;background:linear-gradient(135deg,#2a2a2a 0%,#1a1a1a 100%);border-top-left-radius:6px;border-top-right-radius:6px;user-select:none;border-bottom:2px solid #444;position:relative;flex-shrink:0;' });
  const titleWrapper = el('div', { style: 'text-align:center;position:relative;' });
  const titleEl      = el('div', { style: 'font-size:20px;font-weight:bold;color:#e0e0e0;text-shadow:2px 2px 4px rgba(0,0,0,0.6);letter-spacing:1px;' });
  titleEl.textContent = 'TRIBE INFO EXTRACTOR';

  const btnGlobalHelp = el('button', { innerText: '?', title: 'Help', type: 'button', style: 'position:absolute;left:10px;top:50%;transform:translateY(-50%);cursor:pointer;padding:4px 9px;background:#1a2a1a;color:#6d6;border:1px solid #2a4a2a;border-radius:4px;font-size:14px;font-weight:bold;z-index:10;' });
  const closeBtn      = el('button', { innerText: '✕', title: 'Close', style: 'position:absolute;right:0;top:50%;transform:translateY(-50%);cursor:pointer;padding:4px 10px;background:#444;color:#fff;border:1px solid #666;border-radius:4px;font-size:16px;font-weight:bold;z-index:10;' });

  titleWrapper.append(titleEl, closeBtn);
  titleBar.append(btnGlobalHelp, titleWrapper);
  container.appendChild(titleBar);

  // ── Scrollable Body ──
  const body = el('div', { style: 'padding:16px;overflow-y:auto;flex:1;' });
  container.appendChild(body);

  // ── Navigation Section ──
  const navSection       = el('div', { style: 'margin-bottom:12px;padding:12px;background:#0f0f0f;border-radius:6px;border:1px solid #333;' });
  const navSectionHeader = el('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;' });
  const navSectionTitle  = el('div', { style: 'font-weight:bold;color:#aaa;font-size:13px;flex:1;text-align:center;' });
  navSectionTitle.textContent = 'Navigation';
  const navCollapseBtn   = el('button', { innerText: '−', type: 'button', style: 'cursor:pointer;padding:2px 8px;background:#2a2a2a;color:#fff;border:1px solid #4a4a4a;border-radius:3px;font-size:16px;font-weight:bold;line-height:1;' });
  navSectionHeader.append(navSectionTitle, navCollapseBtn);
  navSection.appendChild(navSectionHeader);

  const navContent = el('div');

  const navBtnRow = el('div', { style: 'display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-bottom:10px;' });
  const navButtons = {};
  Object.keys(MODES).forEach(mode => {
    const isActive = currentMode === mode;
    const btn = el('button', {
      innerText: MODES[mode],
      type:      'button',
      style:     'cursor:pointer;padding:8px 18px;font-size:12px;font-weight:' + (isActive ? 'bold' : 'normal') + ';border-radius:4px;border:1px solid ' + (isActive ? '#3a7a3a' : '#4a4a4a') + ';background:' + (isActive ? '#1a4a1a' : '#2a2a2a') + ';color:' + (isActive ? '#6f6' : '#fff') + ';',
    });
    if (isActive) {
      btn.title = 'Currently viewing this page';
      btn.style.cursor = 'default';
    }
    navButtons[mode] = btn;
    navBtnRow.appendChild(btn);
  });

  // Player ID row (used for buildings/defense which may need player_id)
  const playerIdRow = el('div', { style: 'display:flex;align-items:center;gap:8px;justify-content:center;margin-bottom:8px;' });
  const playerIdLabel = el('label', { style: 'font-size:11px;color:#888;' });
  playerIdLabel.textContent = 'Player ID (for Buildings / Defense):';
  const playerIdInput = el('input', { type: 'text', placeholder: 'e.g. 123456', style: 'padding:5px 8px;background:#0f0f0f;color:#fff;border:1px solid #444;border-radius:4px;width:120px;font-size:12px;' });
  const btnGoWithPlayer = el('button', { innerText: 'Go', type: 'button', style: 'cursor:pointer;padding:5px 14px;background:#3a3a5a;color:#fff;border:1px solid #5a5a7a;border-radius:4px;font-size:12px;' });
  playerIdRow.append(playerIdLabel, playerIdInput, btnGoWithPlayer);

  // Status strip
  const pageStatusBar = el('div', { style: 'padding:6px;border-radius:4px;text-align:center;font-size:12px;' });
  if (!isAllyPage) {
    pageStatusBar.style.cssText += 'background:#1a0f0f;border:1px solid #5a2a2a;color:#ff8888;';
    pageStatusBar.textContent = 'Not on an ally page — use the buttons above to navigate.';
  } else if (!isKnownMode) {
    pageStatusBar.style.cssText += 'background:#1a0f0f;border:1px solid #5a2a2a;color:#ff8888;';
    pageStatusBar.textContent = 'Unknown ally mode: "' + currentMode + '" — navigate using the buttons above.';
  } else {
    pageStatusBar.style.cssText += 'background:#0a1a0a;border:1px solid #2a5a2a;color:#6d6;';
    pageStatusBar.textContent = '✓ Viewing ' + MODES[currentMode];
  }

  navContent.append(navBtnRow, playerIdRow, pageStatusBar);
  navSection.appendChild(navContent);
  body.appendChild(navSection);

  // ── Discovery Section ──
  const discoverSection       = el('div', { style: 'margin-bottom:12px;padding:12px;background:#0f0f0f;border-radius:6px;border:1px solid #333;' });
  const discoverSectionHeader = el('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;' });
  const discoverSectionTitle  = el('div', { style: 'font-weight:bold;color:#aaa;font-size:13px;flex:1;text-align:center;' });
  discoverSectionTitle.textContent = 'Page Structure (Discovery)';
  const discoverCollapseBtn   = el('button', { innerText: '+', type: 'button', style: 'cursor:pointer;padding:2px 8px;background:#2a2a2a;color:#fff;border:1px solid #4a4a4a;border-radius:3px;font-size:16px;font-weight:bold;line-height:1;' });
  const discoverHelpBtn       = el('button', { innerText: '?', type: 'button', style: 'cursor:pointer;padding:2px 7px;background:#1a2a1a;color:#6d6;border:1px solid #2a4a2a;border-radius:3px;font-size:13px;font-weight:bold;line-height:1;margin-left:4px;' });
  discoverSectionHeader.append(discoverSectionTitle, discoverCollapseBtn, discoverHelpBtn);
  discoverSection.appendChild(discoverSectionHeader);

  const discoverContent  = el('div', { style: 'display:none;' });
  const btnScan          = el('button', { innerText: 'Scan Page Structure', type: 'button', style: 'cursor:pointer;padding:8px 20px;background:#5a3a2a;color:#fff;border:1px solid #7a5a3a;border-radius:4px;font-weight:bold;margin-bottom:10px;' });
  const discoverOutput   = el('div', { style: 'background:#0a0a0a;border:1px solid #2a2a2a;border-radius:4px;padding:10px;font-family:monospace;font-size:11px;color:#ccc;max-height:380px;overflow-y:auto;white-space:pre-wrap;word-break:break-word;min-height:60px;' });
  discoverOutput.textContent = 'Click "Scan Page Structure" to inspect tables and game_data on this page.';
  discoverContent.append(btnScan, discoverOutput);
  discoverSection.appendChild(discoverContent);
  body.appendChild(discoverSection);

  // ── Extract Section ──
  const extractSection       = el('div', { style: 'margin-bottom:12px;padding:12px;background:#0f0f0f;border-radius:6px;border:1px solid #333;' });
  const extractSectionHeader = el('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;' });
  const extractSectionTitle  = el('div', { style: 'font-weight:bold;color:#aaa;font-size:13px;flex:1;text-align:center;' });
  extractSectionTitle.textContent = 'Data Extraction & Export';
  const extractCollapseBtn   = el('button', { innerText: '+', type: 'button', style: 'cursor:pointer;padding:2px 8px;background:#2a2a2a;color:#fff;border:1px solid #4a4a4a;border-radius:3px;font-size:16px;font-weight:bold;line-height:1;' });
  const extractHelpBtn       = el('button', { innerText: '?', type: 'button', style: 'cursor:pointer;padding:2px 7px;background:#1a2a1a;color:#6d6;border:1px solid #2a4a2a;border-radius:3px;font-size:13px;font-weight:bold;line-height:1;margin-left:4px;' });
  extractSectionHeader.append(extractSectionTitle, extractCollapseBtn, extractHelpBtn);
  extractSection.appendChild(extractSectionHeader);

  const extractContent = el('div', { style: 'display:none;' });

  const extractBtnRow  = el('div', { style: 'display:flex;gap:8px;justify-content:center;align-items:center;flex-wrap:wrap;margin-bottom:10px;' });
  const tableIndexLabel = el('label', { style: 'font-size:11px;color:#888;' });
  tableIndexLabel.textContent = 'Table #:';
  const tableIndexInput = el('input', { type: 'number', min: '1', value: '1', title: 'Which table to extract (from Scan results)', style: 'width:48px;padding:5px;background:#0f0f0f;color:#fff;border:1px solid #444;border-radius:4px;text-align:center;font-size:12px;' });
  const btnExtract     = el('button', { innerText: 'Extract', type: 'button', style: 'cursor:pointer;padding:8px 20px;background:#2a5a2a;color:#fff;border:1px solid #3a7a3a;border-radius:4px;font-weight:bold;font-size:13px;' });
  const btnExtractAll  = el('button', { innerText: 'Extract All Tables', type: 'button', style: 'cursor:pointer;padding:8px 16px;background:#2a3a2a;color:#fff;border:1px solid #3a5a3a;border-radius:4px;font-size:12px;' });
  const btnCopyCSV     = el('button', { innerText: 'Copy CSV', type: 'button', style: 'cursor:pointer;padding:8px 16px;background:#2a3a5a;color:#fff;border:1px solid #3a5a7a;border-radius:4px;font-size:12px;' });
  const btnCopyJSON    = el('button', { innerText: 'Copy JSON', type: 'button', style: 'cursor:pointer;padding:8px 16px;background:#2a3a5a;color:#fff;border:1px solid #3a5a7a;border-radius:4px;font-size:12px;' });
  extractBtnRow.append(tableIndexLabel, tableIndexInput, btnExtract, btnExtractAll, btnCopyCSV, btnCopyJSON);

  const extractSummary = el('div', { style: 'font-size:11px;color:#666;text-align:center;margin-bottom:6px;min-height:16px;' });
  const extractOutput  = el('div', { style: 'background:#0a0a0a;border:1px solid #2a2a2a;border-radius:4px;padding:10px;font-family:monospace;font-size:11px;color:#ccc;max-height:380px;overflow-y:auto;white-space:pre-wrap;word-break:break-word;min-height:60px;' });
  extractOutput.textContent = 'Run "Scan Page Structure" first to find tables, then click Extract.';
  extractContent.append(extractBtnRow, extractSummary, extractOutput);
  extractSection.appendChild(extractContent);
  body.appendChild(extractSection);

  // ── Message Box ──
  msgBox = el('div', { style: 'margin-bottom:4px;color:#9f9f9f;min-height:18px;text-align:center;padding:5px;background:#0a0a0a;border-radius:4px;border:1px solid #2a2a2a;' });
  body.appendChild(msgBox);

  // ── Footer ──
  const footer = el('div', { style: 'padding:10px;background:linear-gradient(135deg,#1a1a1a 0%,#0a0a0a 100%);border-bottom-left-radius:6px;border-bottom-right-radius:6px;border-top:2px solid #444;text-align:center;flex-shrink:0;' });
  const footerAuthor = el('div', { style: 'font-size:12px;color:#888;letter-spacing:0.5px;' });
  footerAuthor.textContent = 'Created by NeilB';
  footer.appendChild(footerAuthor);
  container.appendChild(footer);
  document.body.appendChild(container);

  // ── Help Overlay ──
  helpOverlay = el('div', { style: 'position:fixed;left:0;top:0;width:100%;height:100%;background:rgba(0,0,0,0.75);z-index:200000;display:none;align-items:center;justify-content:center;' });
  const helpContent  = el('div', { style: 'background:#1a1a1a;color:#fff;padding:24px;border-radius:8px;border:2px solid #444;max-width:500px;width:90%;' });
  helpTitle          = el('div', { style: 'font-size:16px;font-weight:bold;margin-bottom:12px;color:#e0e0e0;' });
  helpText           = el('div', { style: 'font-size:13px;color:#bbb;line-height:1.7;margin-bottom:16px;' });
  const helpCloseRow = el('div', { style: 'display:flex;justify-content:center;' });
  const helpCloseBtn = el('button', { innerText: 'Close', type: 'button', style: 'cursor:pointer;padding:8px 24px;background:#444;color:#fff;border:1px solid #666;border-radius:4px;' });
  helpCloseRow.appendChild(helpCloseBtn);
  helpContent.append(helpTitle, helpText, helpCloseRow);
  helpOverlay.appendChild(helpContent);
  document.body.appendChild(helpOverlay);

  /* ── State ── */

  let scannedTables  = [];
  let lastExtracted  = null;

  /* ── Formatting Helpers ── */

  function formatScanResult(tables) {
    const gd  = getGameDataSnapshot();
    let out = '';

    if (gd) {
      out += '── game_data ──\n';
      out += 'Player : ' + (gd.player_name || '?') + '  (id: ' + (gd.player_id || '?') + ')\n';
      out += 'Tribe  : ' + (gd.ally_name   || '?') + '  (id: ' + (gd.ally_id   || '?') + ')\n';
      out += 'Keys   : ' + (gd.top_keys    || []).join(', ') + '\n\n';
    }

    out += '── URL ──\n' + window.location.href + '\n\n';
    out += '── Tables found: ' + tables.length + ' ──\n\n';

    if (!tables.length) {
      out += '(No tables with data were found in the content area.)\n';
      out += 'The page may require a player_id parameter, or data may be loaded dynamically.\n';
      return out;
    }

    tables.forEach(t => {
      out += '┌ Table ' + t.index + '  id="' + t.id + '"  class="' + t.className + '"\n';
      out += '│ Rows: ' + t.rows.length + '  |  Columns: ' + t.headers.length + '\n';
      if (t.headers.length) {
        out += '│ Headers: ' + t.headers.map((h, i) => '[' + i + '] ' + (h || '(empty)')).join('  ') + '\n';
      }
      const preview = t.rows.slice(0, 2);
      preview.forEach((row, ri) => {
        out += '│ Row ' + (ri + 1) + ': ' + row.join(' | ') + '\n';
      });
      if (t.rows.length > 2) out += '│ ... (' + (t.rows.length - 2) + ' more rows)\n';
      out += '└─\n\n';
    });

    return out;
  }

  function formatExtractPreview(headers, rows, tableInfo) {
    let out = '── Extracted: Table ' + tableInfo.index + ' ──\n';
    out += 'Rows: ' + rows.length + '  |  Columns: ' + headers.length + '\n\n';
    if (headers.length) {
      out += 'HEADERS:\n' + headers.map((h, i) => '  [' + i + '] ' + h).join('\n') + '\n\n';
    }
    out += 'ROWS (first 10 of ' + rows.length + '):\n';
    rows.slice(0, 10).forEach((row, i) => {
      out += '  [' + (i + 1) + '] ' + row.join(' | ') + '\n';
    });
    if (rows.length > 10) out += '  ... (' + (rows.length - 10) + ' more — use Copy CSV/JSON for full data)\n';
    return out;
  }

  /* ── Event Wiring ── */

  // Draggable
  (function makeDraggable() {
    let dragging = false, sx = 0, sy = 0, il = 0, it = 0;

    function onDown(e) {
      const t = e.target;
      if (t === closeBtn) return;
      if (['BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'LABEL'].indexOf(t.tagName) !== -1) return;
      if (t.closest && t.closest('button,input,textarea,select,label')) return;
      e.preventDefault();
      dragging = true;
      sx = e.clientX; sy = e.clientY;
      const r = container.getBoundingClientRect();
      il = r.left; it = r.top;
      document.onmousemove = onMove;
      document.onmouseup   = onUp;
    }

    function onMove(e) {
      if (!dragging) return;
      e.preventDefault();
      const nl = Math.max(-container.offsetWidth + 50,  Math.min(il + e.clientX - sx, window.innerWidth  - 50));
      const nt = Math.max(0,                             Math.min(it + e.clientY - sy, window.innerHeight - 50));
      container.style.left      = nl + 'px';
      container.style.top       = nt + 'px';
      container.style.transform = 'none';
    }

    function onUp() {
      dragging = false;
      document.onmousemove = null;
      document.onmouseup   = null;
    }

    titleBar.onmousedown = onDown;
    body.onmousedown     = onDown;
  })();

  // Close
  closeBtn.addEventListener('click', () => container.remove());

  // Collapse toggles
  navCollapseBtn.onclick      = makeCollapseHandler(navContent,      navCollapseBtn);
  discoverCollapseBtn.onclick = makeCollapseHandler(discoverContent, discoverCollapseBtn);
  extractCollapseBtn.onclick  = makeCollapseHandler(extractContent,  extractCollapseBtn);

  // Help overlay
  helpCloseBtn.addEventListener('click', () => { helpOverlay.style.display = 'none'; });
  helpOverlay.addEventListener('click',  e => { if (e.target === helpOverlay) helpOverlay.style.display = 'none'; });

  btnGlobalHelp.addEventListener('click', e => {
    e.stopPropagation();
    showHelp('Tribe Info Extractor — Overview',
      '<b>Purpose</b><br>' +
      'Reads tribe member data (troops, buildings, defense) from the alliance overview pages and exports it as CSV or JSON.<br><br>' +
      '<b>Workflow</b><br>' +
      '1. Navigate to the desired page using the navigation buttons.<br>' +
      '2. Click <i>Scan Page Structure</i> to discover which tables are available and what their columns are.<br>' +
      '3. Use the <i>Table #</i> field to select which table to extract (default: 1).<br>' +
      '4. Click <i>Extract</i>, then use <i>Copy CSV</i> or <i>Copy JSON</i> to export.<br><br>' +
      '<b>Buildings / Defense</b><br>' +
      'These pages may require a Player ID in the URL. Enter a player ID and click <i>Go</i> to navigate with it.<br><br>' +
      '<b>Tip</b><br>' +
      'Run Scan on each page first — this reveals what columns and data are available so we know what to parse.'
    );
  });

  discoverHelpBtn.addEventListener('click', e => {
    e.stopPropagation();
    showHelp('Page Structure Scanner',
      'Scans all tables in the page content area and reports:<br><br>' +
      '— Table ID and CSS class<br>' +
      '— Column count and headers<br>' +
      '— A preview of the first 2 data rows<br>' +
      '— <b>game_data</b> snapshot (player, tribe info)<br><br>' +
      'Use this to understand what is available on each of the three ally pages before extracting. ' +
      'The table numbers shown here correspond to the <b>Table #</b> input in the Extract section.'
    );
  });

  extractHelpBtn.addEventListener('click', e => {
    e.stopPropagation();
    showHelp('Data Extraction',
      '<b>Extract</b> — reads the table matching the Table # and shows a preview.<br><br>' +
      '<b>Extract All Tables</b> — reads every table found and concatenates them into one dataset with a table separator column.<br><br>' +
      '<b>Copy CSV</b> — copies extracted data as comma-separated values, ready to paste into a spreadsheet.<br><br>' +
      '<b>Copy JSON</b> — copies extracted data as a JSON array of objects, one per row, using headers as keys.'
    );
  });

  // Navigation buttons
  Object.keys(MODES).forEach(mode => {
    if (currentMode === mode) return;
    navButtons[mode].addEventListener('click', () => {
      const pid = playerIdInput.value.trim();
      if (pid && (mode === 'members_buildings' || mode === 'members_defense')) {
        navigateTo(mode, { player_id: pid });
      } else {
        navigateTo(mode);
      }
    });
  });

  btnGoWithPlayer.addEventListener('click', () => {
    const pid = playerIdInput.value.trim();
    if (!pid) { showMessage('Enter a player ID first'); return; }
    const targetMode = (currentMode in MODES) ? currentMode : 'members_buildings';
    navigateTo(targetMode, { player_id: pid });
  });

  // Scan
  btnScan.addEventListener('click', () => {
    scannedTables = scanAllTables();
    discoverOutput.textContent = formatScanResult(scannedTables);
    ensureExpanded(discoverContent, discoverCollapseBtn);
    showMessage('Found ' + scannedTables.length + ' table(s) on this page');
    if (scannedTables.length) {
      tableIndexInput.max   = String(scannedTables.length);
      tableIndexInput.value = '1';
    }
  });

  // Extract single table
  btnExtract.addEventListener('click', () => {
    if (!scannedTables.length) {
      showMessage('Run Scan first to discover tables');
      return;
    }
    const idx = Math.max(1, Math.min(parseInt(tableIndexInput.value) || 1, scannedTables.length));
    const t   = scannedTables[idx - 1];
    lastExtracted = { headers: t.headers, rows: t.rows };
    extractOutput.textContent  = formatExtractPreview(t.headers, t.rows, t);
    extractSummary.textContent = 'Extracted table ' + t.index + ' — ' + t.rows.length + ' rows × ' + t.headers.length + ' columns';
    ensureExpanded(extractContent, extractCollapseBtn);
    showMessage('Extracted ' + t.rows.length + ' rows from table ' + t.index);
  });

  // Extract all tables merged
  btnExtractAll.addEventListener('click', () => {
    if (!scannedTables.length) {
      showMessage('Run Scan first to discover tables');
      return;
    }
    const maxCols = Math.max(...scannedTables.map(t => t.headers.length));
    const mergedHeaders = ['_table', '_row', ...scannedTables[0].headers];
    const mergedRows    = [];
    scannedTables.forEach(t => {
      t.rows.forEach((row, ri) => {
        mergedRows.push([String(t.index), String(ri + 1), ...row]);
      });
    });
    lastExtracted = { headers: mergedHeaders, rows: mergedRows };
    extractOutput.textContent  = formatExtractPreview(mergedHeaders, mergedRows, { index: 'ALL', rows: mergedRows });
    extractSummary.textContent = 'Merged ' + scannedTables.length + ' tables — ' + mergedRows.length + ' total rows';
    ensureExpanded(extractContent, extractCollapseBtn);
    showMessage('Merged ' + scannedTables.length + ' tables (' + mergedRows.length + ' rows)');
  });

  // Copy CSV
  btnCopyCSV.addEventListener('click', () => {
    if (!lastExtracted) { showMessage('Extract data first'); return; }
    const csv = toCSV(lastExtracted.headers, lastExtracted.rows);
    copyText(csv)
      .then(() => showMessage('CSV copied to clipboard!'))
      .catch(() => showMessage('Copy failed — try a different browser'));
  });

  // Copy JSON
  btnCopyJSON.addEventListener('click', () => {
    if (!lastExtracted) { showMessage('Extract data first'); return; }
    const json = toJSON(lastExtracted.headers, lastExtracted.rows);
    copyText(json)
      .then(() => showMessage('JSON copied to clipboard!'))
      .catch(() => showMessage('Copy failed — try a different browser'));
  });

  /* ── Init ── */

  const pid = urlParams.get('player_id') || urlParams.get('id');
  if (pid) playerIdInput.value = pid;

  showMessage('Tribe Info Extractor ready!' + (isKnownMode ? ' — On: ' + MODES[currentMode] : ' — Navigate to an ally page'));

})();
