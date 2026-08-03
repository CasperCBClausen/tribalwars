/*
Disclaimer
By uploading a user-generated mod for use with Tribal Wars, the creator grants InnoGames a perpetual, irrevocable, worldwide, royalty-free, non-exclusive license to use, reproduce, distribute, publicly display, modify, and create derivative works of the mod. This license permits InnoGames to incorporate the mod into any aspect of the game and its related services, including promotional and commercial endeavors, without any requirement for compensation or attribution to the uploader. The uploader represents and warrants that they have the legal right to grant this license and that the mod does not infringe upon any third-party rights. German law applies.
*/

// NeilBReportsToClipboard
(function () {

  /* ── Constants ── */

  // Server-agnostic world parser (id is the first hostname label on every TW domain -> en130.tribalwars.net, es100.guerrastribales.es, de245.die-staemme.de, ...)
  const worldMatch = location.hostname.match(/^(\w+)\./);
  const world = worldMatch ? worldMatch[1] : null;

  const MONTHS = {Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
  const DELAY_MS = 200; // 5 reports/second

  /* ── Parsing Helpers ── */

  function parseTWDate(str) {
    const s = str.replace(/\s+/g,' ').trim();
    // EN date format: "Mar 3, 2026 14:12:33"
    let m = s.match(/(\w{3})\s+(\d+),\s+(\d{4})\s+(\d+):(\d+):(\d+)/);
    if (m && m[1] in MONTHS) {
      return Date.UTC(+m[3], MONTHS[m[1]], +m[2], +m[4], +m[5], +m[6]);
    }
    // ES date format: "02.08.26 17:48:39" (DD.MM.YY, optional trailing :ms)
    m = s.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})\s+(\d+):(\d+):(\d+)/);
    if (m) {
      const year = +m[3] < 100 ? 2000 + +m[3] : +m[3];
      return Date.UTC(year, +m[2] - 1, +m[1], +m[4], +m[5], +m[6]);
    }
    return null;
  }

  // Only returns units with count > 0; returns null if nothing found
  function extractUnits(container) {
    if (!container) return null;
    const u = {};
    container.querySelectorAll('[data-unit-count]').forEach(td => {
      const cls = [...td.classList].find(c => c.startsWith('unit-item-') && c !== 'unit-item');
      if (!cls) return;
      const n = parseInt(td.dataset.unitCount) || 0;
      if (n > 0) u[cls.replace('unit-item-', '')] = n;
    });
    return Object.keys(u).length ? u : null;
  }

  // A scout run is spies, optionally with a token ram/catapult escort for fakes at slower speeds.
  function isScoutRun(troops) {
    if (!troops || !troops.spy) return false;
    if (Object.keys(troops).some(u => u !== 'spy' && u !== 'ram' && u !== 'catapult')) return false;
    return (troops.ram || 0) + (troops.catapult || 0) <= 5;
  }

  // Drop keys whose value is null, undefined, empty string, or empty object
  function clean(obj) {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v === null || v === undefined || v === '') continue;
      if (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length) continue;
      out[k] = v;
    }
    return out;
  }

  /* ── Report Parser ── */
  // Parameterized on a Document so it can run against fetch()-ed report pages instead of only window.document.

  function parseParticipant(doc, r, tblId, unitTblId, pfx) {
    const tbl = doc.getElementById(tblId);
    if (!tbl) return;

    const anch = tbl.querySelector('.village_anchor');
    const vid = anch ? parseInt(anch.dataset.id) : null;
    if (vid) r[pfx + 'VillageId'] = vid;

    const vLink = anch?.querySelector('a');
    if (vLink) {
      const txt = vLink.textContent || '';
      const cm = txt.match(/\((\d+)\|(\d+)\)/);
      if (cm) { r[pfx + 'X'] = parseInt(cm[1]); r[pfx + 'Y'] = parseInt(cm[2]); }
      const name = txt.replace(/\s*\(\d+\|\d+\)\s*[A-Z]\d+/, '').trim();
      if (name) r[pfx + 'VillageName'] = name;
    }

    const pLink = tbl.querySelector('th a[href*="info_player"]');
    if (pLink) {
      const name = pLink.textContent?.trim();
      if (name) r[pfx + 'PlayerName'] = name;
      const pm = (pLink.getAttribute('href') || '').match(/id=(\d+)/);
      if (pm) r[pfx + 'PlayerId'] = parseInt(pm[1]);
    }

    const unitTbl = doc.getElementById(unitTblId);
    if (unitTbl) {
      // Row labels are localized ("Quantity:"/"Cantidad:"...), but the row order is fixed: first unit-count row = quantity, second = losses.
      const rows = [...unitTbl.querySelectorAll('tr')]
        .filter(row => row.querySelector('[data-unit-count]'));
      const troops = extractUnits(rows[0]);
      if (troops) r[pfx + 'Troops'] = troops;
      const losses = extractUnits(rows[1]);
      if (losses) r[pfx + 'Losses'] = losses;
    }
  }

  function parseReportDoc(doc, reportId) {
    const r = {};
    if (world) r.world = world;
    if (reportId) r.reportId = reportId;

    if (!r.reportId) {
      const ridM = (doc.querySelector('.no-preview a[href*="report_id="]')?.href || '')
        .match(/report_id=(\d+)/);
      if (ridM) r.reportId = ridM[1];
      else {
        const qe = doc.querySelector('.quickedit[data-id]');
        if (qe?.dataset.id) r.reportId = qe.dataset.id;
      }
    }

    // Timestamp. Direct-child cells + exact label match only: outer layout rows contain the whole report as one blob, where a loose match would pick up the first date on the page (e.g. "Hora de envío" = launch time).
    outer: for (const row of doc.querySelectorAll('tr')) {
      const cells = [...row.querySelectorAll(':scope > td')];
      if (cells.length >= 2
          && /^(?:battle\s+time|hora\s+de\s+batalla):?$/i.test(cells[0].textContent.trim())) {
        const ts = parseTWDate(cells[1].textContent);
        if (ts) { r.reportTimestamp = ts; break; }
      }
      for (const td of cells) {
        // Anchored, so "Reenviado el:" (forwarded) and blob cells can't match
        const m = td.textContent.trim().match(/^(?:Sent|Enviado):\s*(.+)/i);
        if (m) {
          const ts = parseTWDate(m[1]);
          if (ts) { r.reportTimestamp = ts; break outer; }
        }
      }
    }

    // Luck — the clover icon: klee.webp = positive luck, klee_grau.webp (greyed out) = negative.
    const luckBold = doc.querySelector('#attack_luck b');
    if (luckBold) {
      const pct = parseFloat(luckBold.textContent);
      if (!isNaN(pct)) {
        const negative = [...doc.querySelectorAll('#attack_luck img')]
          .some(img => (img.getAttribute('src') || '').includes('klee_grau'));
        r.luck = negative ? -pct : pct;
      }
    }

    // Morale
    for (const h4 of doc.querySelectorAll('h4')) {
      const m = h4.textContent.match(/Moral(?:e)?:\s*(\d+)/);
      if (m) { r.morale = parseInt(m[1]); break; }
    }

    // Attacker / Defender
    parseParticipant(doc, r, 'attack_info_att', 'attack_info_att_units', 'attacker');
    parseParticipant(doc, r, 'attack_info_def', 'attack_info_def_units', 'defender');

    // Report type — h3 wording is localized (and lost on renamed reports), so derive it from the attack itself. Must run after the participants are parsed: it reads attackerTroops.
    if (r.attackerTroops) {
      r.reportType = isScoutRun(r.attackerTroops) ? 'scout' : 'attack';
    } else if (doc.querySelector('h3')) {
      r.reportType = 'combat';
    }

    // Troops away from village
    const awayTbl = doc.getElementById('attack_spy_away');
    if (awayTbl) {
      const u = extractUnits(awayTbl);
      if (u) r.defenderTroopsAway = u;
    }

    // Buildings — hidden JSON input when present, otherwise the visible spy tables (building id taken from the icon path, which isn't localized)
    const bldInput = doc.getElementById('attack_spy_building_data');
    if (bldInput?.value) {
      try {
        const parsed = JSON.parse(bldInput.value);
        if (Array.isArray(parsed) && parsed.length) {
          r.buildings = {};
          for (const b of parsed) {
            if (b.id && b.level != null) r.buildings[b.id] = parseInt(b.level);
          }
          if (!Object.keys(r.buildings).length) delete r.buildings;
        }
      } catch (_) {}
    }
    if (!r.buildings) {
      const bld = {};
      doc.querySelectorAll('#attack_spy_buildings_left tr, #attack_spy_buildings_right tr')
        .forEach(row => {
          const src = row.querySelector('img')?.getAttribute('src') || '';
          const idM = src.match(/buildings\/(\w+)\.(?:webp|png)/);
          const lvl = parseInt(row.querySelector('td:last-child')?.textContent);
          if (idM && !isNaN(lvl)) bld[idM[1]] = lvl;
        });
      if (Object.keys(bld).length) r.buildings = bld;
    }

    // Resources + relic
    const resTbl = doc.getElementById('attack_spy_resources');
    if (resTbl) {
      // Icon classes (wood/stone/iron) are locale-independent.
      const get = cls => resTbl.querySelector(`.icon.${cls}`)?.closest('.nowrap');
      const parse = el => el ? parseInt(el.textContent.replace(/\D/g, '')) || 0 : 0;
      const w = get('wood'), c = get('stone'), ir = get('iron');
      if (w || c || ir) r.resources = { wood: parse(w), clay: parse(c), iron: parse(ir) };
      const relicEl = resTbl.querySelector('.inline-relic');
      if (relicEl) {
        const relic = relicEl.textContent?.trim();
        if (relic) r.relic = relic;
      }
    }

    return clean(r);
  }

  /* ── Page Guard ── */

  const reportList = document.getElementById('report_list');
  if (!reportList) {
    if (confirm('Reports To Clipboard must be run from the Reports Overview page.\n\nWould you like to be redirected there now?')) {
      try {
        window.location.href = window.location.origin + window.location.pathname + '?screen=report';
      } catch (e) {
        alert('Could not redirect. Please navigate to the Reports overview page.');
      }
    }
    return;
  }

  /* ── Row Detection ── */

  // Attack/defense reports carry an attack-size icon; scout/trade/system rows don't.
  function isCombatRow(row) {
    return !!row.querySelector('img[src*="attack_small.webp"], img[src*="attack_medium.webp"], img[src*="attack_large.webp"]');
  }

  function getCheckedLinks() {
    const links = [];
    reportList.querySelectorAll('tbody tr').forEach(row => {
      const checkbox = row.querySelector('input[type="checkbox"][name^="id_"]');
      if (!checkbox || !checkbox.checked || !isCombatRow(row)) return;
      const link = row.querySelector('a.report-link[href*="view="]');
      if (!link) return;
      const reportId = link.dataset.id || (link.href.match(/view=(\d+)/) || [])[1];
      links.push({ reportId, url: link.href, row });
    });
    return links;
  }

  /* ── UI Build ── */

  const existing = document.getElementById('neils_reports_clipboard_ui');
  if (existing) existing.remove();

  const panel = document.createElement('div');
  panel.id = 'neils_reports_clipboard_ui';
  panel.style.cssText = 'position:relative;background:#f4e4bc;border:2px solid #7d510f;padding:5px;margin-bottom:15px;border-radius:5px;font-family:Arial,Helvetica,sans-serif;';
  panel.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
      <div>
        <strong style="color:#7d510f;font-size:16px;">Reports To Clipboard</strong>
        <span id="nrc_count" style="color:#666;margin-left:10px;font-size:12px;"></span>
      </div>
      <div>
        <button id="nrc_settingsBtn" type="button" title="Settings" style="cursor:pointer;padding:1px 7px;background:#2a2a2a;color:#fff;border:1px solid #4a4a4a;border-radius:3px;font-size:12px;font-weight:bold;line-height:1.4;">⚙</button>
        <button id="nrc_helpBtn" type="button" title="Help" style="cursor:pointer;padding:1px 7px;background:#1a2a1a;color:#3a3;border:1px solid #2a4a2a;border-radius:3px;font-size:12px;font-weight:bold;line-height:1.4;margin-left:4px;">?</button>
      </div>
    </div>
    <div style="display:flex;align-items:center;gap:5px;margin-bottom:8px;">
      <button id="nrc_copyBtn" type="button" style="padding:6px 12px;background:#7d510f;color:#fff;border:none;border-radius:4px;cursor:pointer;">Copy Selected</button>
      <button id="nrc_saveBtn" type="button" style="padding:6px 12px;background:#7d510f;color:#fff;border:none;border-radius:4px;cursor:pointer;">Save to JSON</button>
      <button id="nrc_stopBtn" type="button" style="padding:6px 12px;background:#dc3545;color:#fff;border:none;border-radius:4px;cursor:pointer;display:none;">Stop</button>
    </div>
    <div id="nrc_status" title="Click to view message history" style="font-size:12px;color:#666;cursor:pointer;box-sizing:border-box;width:100%;padding:6px 10px;background:#fff8ec;border:1px solid #7d510f;border-radius:4px;"></div>
    <div style="text-align:right;font-size:10px;color:#a89066;margin-top:6px;">Created by NeilB</div>
    <div id="nrc_settingsPanel" style="display:none;position:absolute;right:5px;top:34px;background:#fff8ec;border:1px solid #7d510f;border-radius:4px;padding:10px 12px;box-shadow:0 4px 10px rgba(0,0,0,0.3);z-index:10;">
      <label id="nrc_saveAsLabel" style="display:flex;align-items:center;gap:6px;font-size:12px;color:#333;cursor:pointer;white-space:nowrap;">
        <input type="checkbox" id="nrc_saveAsCheckbox"> Use "Save As..." dialog
      </label>
    </div>
  `;
  reportList.parentNode.insertBefore(panel, reportList);

  const countEl = panel.querySelector('#nrc_count');
  const statusEl = panel.querySelector('#nrc_status');
  const helpBtn = panel.querySelector('#nrc_helpBtn');
  const copyBtn = panel.querySelector('#nrc_copyBtn');
  const saveBtn = panel.querySelector('#nrc_saveBtn');
  const settingsBtn = panel.querySelector('#nrc_settingsBtn');
  const settingsPanel = panel.querySelector('#nrc_settingsPanel');
  const saveAsCheckbox = panel.querySelector('#nrc_saveAsCheckbox');
  const stopBtn = panel.querySelector('#nrc_stopBtn');

  /* ── Settings ── */

  const SETTINGS_KEY = 'nrc_settings';
  function loadSettings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch (e) { return {}; }
  }
  function saveSettings(patch) {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...loadSettings(), ...patch })); } catch (e) {}
  }

  saveAsCheckbox.checked = !!loadSettings().useSaveAsDialog;
  saveAsCheckbox.addEventListener('change', () => {
    saveSettings({ useSaveAsDialog: saveAsCheckbox.checked });
  });

  const supportsSaveAs = typeof window.showSaveFilePicker === 'function';
  if (!supportsSaveAs) {
    saveAsCheckbox.disabled = true;
    panel.querySelector('#nrc_saveAsLabel').title = 'Not supported in this browser';
  }

  settingsBtn.onclick = e => {
    e.stopPropagation();
    settingsPanel.style.display = settingsPanel.style.display === 'none' ? 'block' : 'none';
  };
  document.addEventListener('click', e => {
    if (settingsPanel.style.display !== 'none' && !settingsPanel.contains(e.target) && e.target !== settingsBtn) {
      settingsPanel.style.display = 'none';
    }
  });

  /* ── Help Overlay ── */

  const existingHelp = document.getElementById('nrc_help_overlay');
  if (existingHelp) existingHelp.remove();

  const helpOverlay = document.createElement('div');
  helpOverlay.id = 'nrc_help_overlay';
  helpOverlay.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;background:rgba(0,0,0,0.75);z-index:200000;display:none;align-items:center;justify-content:center;';
  helpOverlay.innerHTML = `
    <div style="background:#1a1a1a;color:#fff;padding:24px;border-radius:8px;border:2px solid #444;max-width:420px;width:90%;font-family:Arial,Helvetica,sans-serif;">
      <div style="font-size:16px;font-weight:bold;margin-bottom:12px;color:#e0e0e0;">Reports To Clipboard</div>
      <div style="font-size:13px;color:#bbb;line-height:1.7;margin-bottom:16px;">
        Reads the reports you check below, fetches each one, and extracts the battle data
        (troops, losses, resources, morale, luck, etc.) into JSON &mdash; one report per line
        &mdash; which you can copy to the clipboard or save to a file.
        <br><br>
        Reports other than <b>Attack</b> and <b>Defense</b> reports are disregarded, even if checked.
      </div>
      <div style="display:flex;justify-content:center;">
        <button id="nrc_helpCloseBtn" type="button" style="cursor:pointer;padding:8px 24px;background:#444;color:#fff;border:1px solid #666;border-radius:4px;">Close</button>
      </div>
    </div>
  `;
  document.body.appendChild(helpOverlay);

  const helpCloseBtn = helpOverlay.querySelector('#nrc_helpCloseBtn');
  helpCloseBtn.onclick = () => { helpOverlay.style.display = 'none'; };
  helpOverlay.addEventListener('click', e => {
    if (e.target === helpOverlay) helpOverlay.style.display = 'none';
  });

  helpBtn.onclick = () => { helpOverlay.style.display = 'flex'; };

  /* ── Message History Overlay ── */

  const existingMsgHistory = document.getElementById('nrc_msg_history_overlay');
  if (existingMsgHistory) existingMsgHistory.remove();

  const msgHistoryOverlay = document.createElement('div');
  msgHistoryOverlay.id = 'nrc_msg_history_overlay';
  msgHistoryOverlay.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;background:rgba(0,0,0,0.75);z-index:200000;display:none;align-items:center;justify-content:center;';
  msgHistoryOverlay.innerHTML = `
    <div style="background:#1a1a1a;color:#fff;padding:20px;border-radius:8px;border:2px solid #444;max-width:480px;width:90%;max-height:60vh;display:flex;flex-direction:column;font-family:Arial,Helvetica,sans-serif;">
      <div style="font-size:16px;font-weight:bold;margin-bottom:12px;color:#e0e0e0;flex-shrink:0;">Message History</div>
      <div id="nrc_msgHistoryList" style="overflow-y:auto;flex:1;"></div>
      <div style="display:flex;justify-content:center;margin-top:12px;flex-shrink:0;">
        <button id="nrc_msgHistoryCloseBtn" type="button" style="cursor:pointer;padding:8px 24px;background:#444;color:#fff;border:1px solid #666;border-radius:4px;">Close</button>
      </div>
    </div>
  `;
  document.body.appendChild(msgHistoryOverlay);

  const msgHistoryList = msgHistoryOverlay.querySelector('#nrc_msgHistoryList');
  const msgHistoryCloseBtn = msgHistoryOverlay.querySelector('#nrc_msgHistoryCloseBtn');
  msgHistoryCloseBtn.onclick = () => { msgHistoryOverlay.style.display = 'none'; };
  msgHistoryOverlay.addEventListener('click', e => {
    if (e.target === msgHistoryOverlay) msgHistoryOverlay.style.display = 'none';
  });

  /* ── Message System ── */

  const messageHistory = [];

  function showMessage(msg) {
    messageHistory.push({ text: msg, time: new Date() });
    statusEl.textContent = msg;
  }

  statusEl.addEventListener('click', () => {
    msgHistoryList.innerHTML = messageHistory.length === 0
      ? '<div style="color:#888;padding:8px;">No messages yet</div>'
      : messageHistory.slice().reverse().map(e => {
          const t = e.time;
          const ts = ('0' + t.getHours()).slice(-2) + ':' + ('0' + t.getMinutes()).slice(-2) + ':' + ('0' + t.getSeconds()).slice(-2);
          return '<div style="padding:6px 4px;border-bottom:1px solid #2a2a2a;font-size:12px;">' +
            '<span style="color:#555;margin-right:8px;">' + ts + '</span>' +
            '<span style="color:#ddd;">' + e.text + '</span></div>';
        }).join('');
    msgHistoryOverlay.style.display = 'flex';
  });

  showMessage('Check reports below, then click Copy Selected or Save to JSON.');

  /* ── Utilities ── */

  function timestamp() {
    return new Date().toISOString().replace(/[:.]/g, '-');
  }

  function refreshCount() {
    countEl.textContent = `${getCheckedLinks().length} selected`;
  }
  refreshCount();
  reportList.addEventListener('change', e => {
    if (e.target.matches('input[type="checkbox"]')) refreshCount();
  });

  /* ── Batch Processing ── */

  let processing = false;

  async function fetchAndParse(links) {
    processing = true;
    const results = [];
    let done = 0, failed = 0;

    for (const link of links) {
      if (!processing) {
        showMessage(`Stopped at ${done}/${links.length} (${failed} failed).`);
        break;
      }

      link.row.style.backgroundColor = '#fff3cd';

      try {
        const res = await fetch(link.url);
        const html = await res.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        results.push(parseReportDoc(doc, link.reportId));
        link.row.style.backgroundColor = '#d4edda';
      } catch (e) {
        console.error(`Failed to fetch/parse report ${link.reportId}:`, e);
        failed++;
        link.row.style.backgroundColor = '#f8d7da';
      }

      done++;
      showMessage(`Processing ${done}/${links.length} (${failed} failed)...`);

      if (done < links.length && processing) {
        await new Promise(r => setTimeout(r, DELAY_MS));
      }
    }

    processing = false;
    return { results, failed };
  }

  function resetButtons() {
    stopBtn.style.display = 'none';
    copyBtn.disabled = false;
    copyBtn.textContent = 'Copy Selected';
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save to JSON';
  }

  /* ── Output (Clipboard / File) ── */

  // A valid JSON array, but with each report on its own line for readability.
  function toJsonLines(results) {
    if (!results.length) return '[]';
    return '[\n' + results.map(r => JSON.stringify(r)).join(',\n') + '\n]';
  }

  function copyToClipboard(results, failed) {
    if (!results.length) { showMessage('No reports copied.'); return; }

    const json = toJsonLines(results);
    console.log('=== Reports To Clipboard ===');
    console.log(`${results.length} report(s), ${failed} failed`);
    console.log(json);

    navigator.clipboard.writeText(json).then(() => {
      showMessage(`Copied ${results.length} report${results.length !== 1 ? 's' : ''} to clipboard${failed ? ` (${failed} failed)` : ''}.`);
    }).catch(() => {
      showMessage('Done, but clipboard write failed — copy manually from the prompt.');
      prompt('Clipboard blocked — copy manually:', json);
    });
  }

  async function saveToFile(results, failed, fileHandle) {
    if (!results.length) { showMessage('No reports saved.'); return; }

    const json = toJsonLines(results);
    console.log('=== Reports To Clipboard ===');
    console.log(`${results.length} report(s), ${failed} failed`);

    if (fileHandle) {
      try {
        const writable = await fileHandle.createWritable();
        await writable.write(json);
        await writable.close();
        showMessage(`Saved ${results.length} report${results.length !== 1 ? 's' : ''} to file${failed ? ` (${failed} failed)` : ''}.`);
        return;
      } catch (e) {
        console.error('Save As write failed, falling back to automatic download:', e);
      }
    }

    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tw-reports-${timestamp()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    showMessage(`Saved ${results.length} report${results.length !== 1 ? 's' : ''} to file${failed ? ` (${failed} failed)` : ''}.`);
  }

  const SAVE_AS_CANCELLED = Symbol('save-as-cancelled');

  // Must run before any await in the click handler so the picker still has user activation.
  async function prepareSaveAs() {
    if (!saveAsCheckbox.checked || !supportsSaveAs) return null;
    try {
      return await window.showSaveFilePicker({
        suggestedName: `tw-reports-${timestamp()}.json`,
        types: [{ description: 'JSON file', accept: { 'application/json': ['.json'] } }]
      });
    } catch (e) {
      if (e.name === 'AbortError') return SAVE_AS_CANCELLED;
      console.error('Save As picker failed, falling back to automatic download:', e);
      return null;
    }
  }

  /* ── Event Wiring ── */

  async function runBatch(activeBtn, prepare, outputFn) {
    if (processing) return;
    const links = getCheckedLinks();
    if (!links.length) {
      alert('No reports selected. Check the boxes next to the reports you want first.');
      return;
    }

    let context = null;
    if (prepare) {
      context = await prepare();
      if (context === SAVE_AS_CANCELLED) return;
    }

    copyBtn.disabled = true;
    saveBtn.disabled = true;
    activeBtn.textContent = 'Processing...';
    stopBtn.style.display = 'inline-block';
    stopBtn.disabled = false;
    stopBtn.textContent = 'Stop';

    const { results, failed } = await fetchAndParse(links);
    resetButtons();
    await outputFn(results, failed, context);
  }

  copyBtn.onclick = () => runBatch(copyBtn, null, copyToClipboard);
  saveBtn.onclick = () => runBatch(saveBtn, prepareSaveAs, saveToFile);

  stopBtn.onclick = () => {
    processing = false;
    stopBtn.disabled = true;
    stopBtn.textContent = 'Stopping...';
  };

  console.log('[Reports To Clipboard] Ready. ' + getCheckedLinks().length + ' report(s) currently selected.');
})();
