// Rally Opener
(function () {

  /* ── Feature Detection ── */

  const hasPremium = typeof game_data !== 'undefined'
    && game_data.features && game_data.features.Premium
    && game_data.features.Premium.active === true;

  const isOverviewPage = window.location.href.indexOf('screen=overview_villages') !== -1
    && window.location.href.indexOf('mode=combined') !== -1;

  if (!isOverviewPage && hasPremium) {
    if (confirm('Some features require the Combined Village Overview page (Premium Account).\n\nWould you like to be redirected there now?')) {
      try {
        window.location.href = window.location.origin + window.location.pathname + '?screen=overview_villages&mode=combined';
      } catch (e) {
        alert('Could not redirect. Please navigate to:\nOverview → Combined → Village Overview');
      }
      return;
    }
  }

  /* ── Constants ── */

  const ALL_UNIT_TYPES = ['spear','sword','axe','archer','spy','light','marcher','heavy','ram','catapult','knight','snob'];
  const UNIT_TYPES = (() => {
    if (typeof game_data === 'undefined' || !game_data.units) return ALL_UNIT_TYPES;
    if (Array.isArray(game_data.units)) return game_data.units.length ? ALL_UNIT_TYPES.filter(u => game_data.units.includes(u)) : ALL_UNIT_TYPES;
    return ALL_UNIT_TYPES.filter(u => !!game_data.units[u]);
  })();
  const UNIT_NAMES = {
    spear: 'Spear', sword: 'Sword', axe: 'Axe', archer: 'Archer',
    spy: 'Scout', light: 'LC', marcher: 'MA', heavy: 'HC',
    ram: 'Ram', catapult: 'Cata', knight: 'Pala', snob: 'Noble'
  };
  const UNIT_IMG_SRCS = (() => {
    const srcs = {};
    const anyImg = document.querySelector('img[src*="innogamescdn.com"]');
    if (anyImg) {
      const m = anyImg.src.match(/(https?:\/\/\w+\.innogamescdn\.com\/asset\/[a-z0-9]+\/)/);
      if (m) ALL_UNIT_TYPES.forEach(u => { srcs[u] = m[1] + 'graphic/unit/unit_' + u + '.webp'; });
    }
    return srcs;
  })();
  const POPUP_BLOCKED_HTML =
    'Your browser is blocking Rally Opener from opening tabs.<br><br>' +
    '<b>To fix:</b><br>' +
    '1. Look for the popup blocked icon in your browser\'s address bar (usually on the right).<br>' +
    '2. Click it and select <i>Always allow popups from this site</i>.<br>' +
    '3. Click <i>Open Tabs</i> again.';

  /* ── Utilities ── */

  function el(tag, opts) {
    const e = document.createElement(tag);
    if (opts) Object.keys(opts).forEach(k => { e[k] = opts[k]; });
    return e;
  }

  function saveVillagesText(txt) {
    try {
      localStorage.setItem('tw_villages_txt', txt);
      localStorage.setItem('tw_villages_updated', String(Date.now()));
    } catch (e) {}
  }

  function loadVillagesText() {
    try { return localStorage.getItem('tw_villages_txt') || null; } catch (e) { return null; }
  }

  function parseVillagesTxt(txt) {
    if (!txt) return [];
    return txt.split(/\r?\n/).reduce((out, L) => {
      if (!L || !L.trim()) return out;
      const parts = L.split(',');
      if (parts.length < 4) return out;
      const id = parts[0];
      let name = (parts[1] || '').replace(/\+/g, ' ');
      try { name = decodeURIComponent(name); } catch (e) {}
      const x = parts[2] ? Number(parts[2]) : null;
      const y = parts[3] ? Number(parts[3]) : null;
      const playerId = parts[4] || null;
      if (id && x != null && y != null) out.push({ id, name, x, y, playerId });
      return out;
    }, []);
  }

  function coordKey(x, y) { return x + '|' + y; }

  function buildCoordIndex(arr) {
    const m = new Map();
    arr.forEach(v => m.set(coordKey(v.x, v.y), v));
    return m;
  }

  function tryFetchVillagesFromServer() {
    return fetch(location.origin + '/map/village.txt').then(r => {
      if (!r.ok) throw new Error('Failed to fetch village.txt');
      return r.text();
    });
  }

  function parseCoordinateList(text) {
    if (!text) return [];
    return text.trim().split(/\r?\n/)
      .map(l => l.trim().replace(',', '|'))
      .filter(l => /\d+\|\d+/.test(l));
  }

  function coordToVillage(coord) {
    if (!coord) return null;
    const m = coord.match(/(\d+)\|(\d+)/);
    return m ? (villagesIndex.get(coordKey(Number(m[1]), Number(m[2]))) || null) : null;
  }

  function coordToVillageId(coord) {
    const v = coordToVillage(coord);
    return v ? v.id : null;
  }

  function buildRallyUrl(forVillageId, targetVillageId) {
    try {
      const url = new URL(window.location.origin + window.location.pathname);
      url.searchParams.set('screen', 'place');
      url.searchParams.set('village', forVillageId);
      url.searchParams.set('target', targetVillageId);
      return url.toString();
    } catch (e) {
      return location.origin + '/game.php?village=' + forVillageId + '&screen=place&target=' + targetVillageId;
    }
  }

  /* ── Server Time ── */

  function getServerTime() {
    try {
      const timeEl = document.getElementById('serverTime');
      const dateEl = document.getElementById('serverDate');
      if (timeEl && dateEl) {
        const tm = timeEl.textContent.trim().match(/(\d{2}):(\d{2}):(\d{2})/);
        const dm = dateEl.textContent.trim().match(/(\d{2})\/(\d{2})\/(\d{4})/);
        if (tm && dm) return new Date(+dm[3], +dm[2] - 1, +dm[1], +tm[1], +tm[2], +tm[3]);
      }
    } catch (e) {}
    return new Date();
  }

  const serverTimeOffset = (() => {
    try {
      const diff = getServerTime().getTime() - Date.now();
      return Math.round(diff / 3600000) * 3600000;
    } catch (e) { return 0; }
  })();

  function getCurrentServerTime() {
    return new Date(Date.now() + serverTimeOffset);
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
    helpText.innerHTML = html;
    helpOverlay.style.display = 'flex';
  }

  function makeCollapseHandler(contentEl, btn) {
    return function () {
      const collapsed = contentEl.style.display === 'none';
      contentEl.style.display = collapsed ? 'block' : 'none';
      btn.innerText = collapsed ? '−' : '+';
    };
  }

  function openUrls(urls) {
    let blocked = false;
    urls.forEach((url, idx) => {
      setTimeout(() => {
        const w = window.open(url, '_blank');
        if ((!w || w.closed) && !blocked) {
          blocked = true;
          showHelp('Popups Blocked', POPUP_BLOCKED_HTML);
        }
      }, 200 * idx);
    });
  }

  /* ── Village Data ── */

  let villagesArr = parseVillagesTxt(loadVillagesText());
  let villagesIndex = buildCoordIndex(villagesArr);

  (function autoFetchVillages() {
    try {
      const lastFetch = localStorage.getItem('tw_villages_updated');
      const needsFetch = !lastFetch || (Date.now() - Number(lastFetch)) > 3600000;
      if (!needsFetch) return;
      tryFetchVillagesFromServer().then(txt => {
        if (!txt) throw new Error('Empty');
        saveVillagesText(txt);
        villagesArr = parseVillagesTxt(txt);
        villagesIndex = buildCoordIndex(villagesArr);
        showMessage('Village data updated (' + villagesArr.length + ' villages)');
      }).catch(() => {
        if (!lastFetch) showMessage('Could not load village data');
      });
    } catch (e) {
      console.error('Auto-fetch error:', e);
    }
  })();

  /* ── Template System ── */

  let unitTemplates = {};
  let currentTemplate = null;

  function loadTemplates() {
    try {
      const saved = localStorage.getItem('tw_unit_templates');
      if (saved) unitTemplates = JSON.parse(saved);
    } catch (e) { console.error('Error loading templates:', e); }
  }

  function saveTemplates() {
    try {
      localStorage.setItem('tw_unit_templates', JSON.stringify(unitTemplates));
    } catch (e) { console.error('Error saving templates:', e); }
  }

  /* ── Unit Calculations ── */

  function getVillageUnitsFromOverview(villageId) {
    const units = {};
    try {
      const table = document.getElementById('combined_table');
      if (!table) return units;
      const rows = table.querySelectorAll('tr');
      for (const row of rows) {
        const span = row.querySelector('span.quickedit-vn[data-id="' + villageId + '"]');
        if (!span) continue;
        row.querySelectorAll('td.unit-item').forEach((cell, j) => {
          if (j < UNIT_TYPES.length) units[UNIT_TYPES[j]] = parseInt(cell.textContent.trim()) || 0;
        });
        break;
      }
    } catch (e) { console.error('Error reading units:', e); }
    return units;
  }

  function calculateUnitsToSend(availableUnits, template) {
    const unitsToSend = {};
    const { mode, units: config } = template;
    for (const unitType in availableUnits) {
      const available = availableUnits[unitType] || 0;
      const tplValue = config[unitType] || 0;
      const toSend = mode === 'send'
        ? Math.min(tplValue, available)
        : Math.max(0, available - tplValue);
      if (toSend > 0) unitsToSend[unitType] = toSend;
    }
    return unitsToSend;
  }

  function calculateMaxAttacks(availableUnits, template, reserves) {
    if (!template || !template.units) return 0;
    const { mode, units: config } = template;
    const res = reserves || {};
    let max = Infinity;
    for (const unitType in config) {
      const required = config[unitType];
      if (!required) continue;
      const available = availableUnits[unitType] || 0;
      const effectiveAvailable = Math.max(0, available - (res[unitType] || 0));
      const possible = mode === 'send'
        ? Math.floor(effectiveAvailable / required)
        : (Math.max(0, effectiveAvailable - required) > 0 ? Infinity : 0);
      max = Math.min(max, possible);
    }
    return max === Infinity ? 0 : max;
  }

  function buildRallyUrlWithTemplate(forVillageId, targetVillageId) {
    const baseUrl = buildRallyUrl(forVillageId, targetVillageId);
    if (!currentTemplate || !unitTemplates[currentTemplate]) return baseUrl;
    const available = getVillageUnitsFromOverview(forVillageId);
    const toSend = calculateUnitsToSend(available, unitTemplates[currentTemplate]);
    try {
      const url = new URL(baseUrl);
      Object.keys(toSend).forEach(u => url.searchParams.set(u, toSend[u]));
      return url.toString();
    } catch (e) {
      const params = Object.keys(toSend).map(u => u + '=' + toSend[u]).join('&');
      return baseUrl + (baseUrl.indexOf('?') > -1 ? '&' : '?') + params;
    }
  }

  function getVillagesFromCurrentGroup() {
    const villages = [];
    try {
      const table = document.getElementById('combined_table');
      if (!table) return villages;
      table.querySelectorAll('tr').forEach(row => {
        const span = row.querySelector('span.quickedit-vn[data-id]');
        if (!span) return;
        const m = span.textContent.trim().match(/\((\d+)\|(\d+)\)/);
        if (m) villages.push({ id: span.getAttribute('data-id'), coord: m[1] + '|' + m[2] });
      });
    } catch (e) { console.error('Error getting villages from group:', e); }
    return villages;
  }

  function prepareTabsFromPairs(fromCoords, toCoords, opts) {
    const { advancedMode = false, maxPerVillage = 1, randomize = false } = opts || {};
    const pairs = [];
    const failed = [];
    if (!advancedMode) {
      const maxLen = Math.max(fromCoords.length, toCoords.length);
      for (let i = 0; i < maxLen; i++) {
        const fromCoord = fromCoords[i] || null;
        const toCoord   = toCoords[i]   || null;
        if (!fromCoord || !toCoord) { failed.push('Row ' + (i+1) + ': missing From or To coordinate'); continue; }
        const fromV = coordToVillage(fromCoord);
        const toV   = coordToVillage(toCoord);
        if (!fromV) { failed.push('Row ' + (i+1) + ': FROM ' + fromCoord + ' does not exist'); continue; }
        if (!toV)   { failed.push('Row ' + (i+1) + ': TO '   + toCoord   + ' does not exist'); continue; }
        pairs.push({ fromId: fromV.id, toId: toV.id, index: i + 1 });
      }
    } else {
      const fromVillages = [], toVillages = [];
      fromCoords.forEach(coord => {
        const v = coordToVillage(coord);
        if (!v) { failed.push('FROM ' + coord + ' does not exist'); return; }
        fromVillages.push({ id: v.id, coord });
      });
      toCoords.forEach(coord => {
        const v = coordToVillage(coord);
        if (!v) { failed.push('TO ' + coord + ' does not exist'); return; }
        toVillages.push({ id: v.id, coord });
      });
      if (fromVillages.length && toVillages.length) {
        const fromList = randomize ? fromVillages.slice().sort(() => Math.random() - 0.5) : fromVillages;
        fromList.forEach((from, fi) => {
          for (let k = 0; k < maxPerVillage; k++) {
            pairs.push({ fromId: from.id, toId: toVillages[(fi * maxPerVillage + k) % toVillages.length].id, index: fi * maxPerVillage + k + 1 });
          }
        });
      }
    }

    if (!pairs.length) { showMessage('No valid pairs found - check your coordinates'); return []; }

    const isFakeMode = fakeModeCheckbox.checked;
    let noUnitDataDetected = false;

    if (isFakeMode && currentTemplate && unitTemplates[currentTemplate]) {
      const villageGroups = {};
      pairs.forEach(p => {
        if (!villageGroups[p.fromId]) villageGroups[p.fromId] = [];
        villageGroups[p.fromId].push(p);
      });

      const finalPairs = [];
      for (const villageId in villageGroups) {
        const vPairs = villageGroups[villageId];
        const available = getVillageUnitsFromOverview(villageId);
        if (Object.keys(available).length === 0) noUnitDataDetected = true;
        const maxAttacks = calculateMaxAttacks(available, unitTemplates[currentTemplate], getFakeReserves());

        if (maxAttacks >= vPairs.length) {
          vPairs.forEach(p => finalPairs.push(p));
        } else if (maxAttacks > 0) {
          const shuffled = vPairs.slice().sort(() => Math.random() - 0.5);
          shuffled.slice(0, maxAttacks).forEach(p => finalPairs.push(p));
          shuffled.slice(maxAttacks).forEach(p => failed.push('Row ' + p.index + ': insufficient units (randomly skipped in Fake Mode)'));
        } else {
          const reason = noUnitDataDetected ? ': no unit data — open Combined Village Overview first' : ': insufficient units in village';
          vPairs.forEach(p => failed.push('Row ' + p.index + reason));
        }
      }
      pairs.length = 0;
      finalPairs.forEach(p => pairs.push(p));
    }

    const urls = pairs.map(p => buildRallyUrlWithTemplate(p.fromId, p.toId));

    if (!urls.length) {
      if (noUnitDataDetected) {
        showHelp('Unit Data Unavailable',
          'Fake Mode needs unit counts from the Combined Village Overview, which requires a <b>Premium Account</b>.<br><br>' +
          'To fix:<br>' +
          '1. Make sure you have an active Premium Account.<br>' +
          '2. Navigate to the Combined Village Overview page.<br>' +
          '3. Run the script again from there.');
      } else {
        showMessage('No valid pairs found - check your coordinates and available units');
      }
      return [];
    }

    let msg = 'Prepared ' + urls.length + ' tab' + (urls.length > 1 ? 's' : '');
    if (isFakeMode && failed.length) msg += ' (skipped ' + failed.length + ' due to unit limits)';
    showMessage(msg + ' - ready to open!');
    return urls;
  }

  /* ── Attack Plan ── */

  let attackPlanGroups = {};

  function parseLaunchTime(str) {
    if (!str) return null;
    const dmhms = str.match(/(\d{1,2})\/(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})/);
    if (dmhms) {
      const srv = getCurrentServerTime();
      return new Date(srv.getFullYear(), +dmhms[2] - 1, +dmhms[1], +dmhms[3], +dmhms[4], +dmhms[5]);
    }
    if (/\d{4}-\d{2}-\d{2}/.test(str)) return new Date(str);
    return null;
  }

  function parseAttackPlan(text) {
    const groups = {};
    text.split(/\r?\n/).forEach(line => {
      line = line.trim();
      if (!line || /^-+$/.test(line) || /Group.*From.*To/i.test(line)) return;
      const parts = line.split(/\s{2,}|\t/);
      if (parts.length < 3) return;
      const groupNum    = parts[0].trim();
      const fromVillage = parts[1].trim();
      const toTarget    = parts[2].trim();
      if (!/^\d+$/.test(groupNum) || !/\d+\|\d+/.test(fromVillage) || !/\d+\|\d+/.test(toTarget)) return;
      const launchTime = parts.length >= 6 ? parseLaunchTime(parts[5].trim()) : null;
      if (!groups[groupNum]) groups[groupNum] = { attacks: [], launchTime };
      groups[groupNum].attacks.push({ from: fromVillage, to: toTarget });
    });
    return groups;
  }

  function parseHTMLAttackPlan(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const groups = {};
    doc.querySelectorAll('table tbody tr').forEach(row => {
      const cells = row.querySelectorAll('td');
      if (cells.length < 3) return;
      const groupNum    = cells[0].textContent.trim();
      const fromVillage = cells[1].textContent.trim();
      const toTarget    = cells[2].textContent.trim();
      if (!/^\d+$/.test(groupNum) || !/\d+\|\d+/.test(fromVillage) || !/\d+\|\d+/.test(toTarget)) return;
      const launchTime = cells.length >= 6 ? parseLaunchTime(cells[5].textContent.trim()) : null;
      if (!groups[groupNum]) groups[groupNum] = { attacks: [], launchTime };
      groups[groupNum].attacks.push({ from: fromVillage, to: toTarget });
    });
    return groups;
  }

  function openGroupAttacks(group) {
    const urls = group.attacks.reduce((acc, atk) => {
      const fromId = coordToVillageId(atk.from);
      const toId   = coordToVillageId(atk.to);
      if (fromId && toId) acc.push(buildRallyUrlWithTemplate(fromId, toId));
      return acc;
    }, []);
    if (!urls.length) { showMessage('No valid attacks in this group'); return; }
    showMessage('Opening ' + urls.length + ' tabs for group...');
    openUrls(urls);
  }

  function startCountdowns() {
    if (window._countdownInterval) clearInterval(window._countdownInterval);
    window._countdownInterval = setInterval(() => {
      document.querySelectorAll('.countdown').forEach(span => {
        const btn = span.closest('.group-btn');
        if (!btn) return;
        const group = attackPlanGroups[btn.dataset.group];
        if (!group || !group.launchTime) return;
        const diff = group.launchTime - getCurrentServerTime();
        if (diff <= 0) {
          span.textContent = 'LAUNCH EXCEEDED';
          span.style.color = '#ff4444';
          span.style.fontWeight = 'bold';
        } else {
          const h = Math.floor(diff / 3600000);
          const m = Math.floor((diff % 3600000) / 60000);
          const s = Math.floor((diff % 60000) / 1000);
          span.textContent = h + 'h ' + m + 'm ' + s + 's';
          span.style.color = '#aaffaa';
          span.style.fontWeight = '';
        }
      });
    }, 1000);
  }

  function createGroupButtons() {
    attackPlanContainer.innerHTML = '';
    attackPlanContainer.style.display = 'block';
    Object.keys(attackPlanGroups).sort((a, b) => +a - +b).forEach(groupNum => {
      const group = attackPlanGroups[groupNum];
      const btn = document.createElement('button');
      btn.className = 'group-btn';
      btn.dataset.group = groupNum;
      btn.style.cssText = 'cursor:pointer;padding:10px 20px;background:#3a5a3a;color:#fff;border:1px solid #4a7a4a;border-radius:4px;font-weight:bold;margin:5px;display:inline-block;min-width:180px;';
      const count = group.attacks.length;
      btn.innerHTML = 'Group ' + groupNum + '<br><span style="font-size:11px;">(' + count + ' attack' + (count > 1 ? 's' : '') + ')</span>';
      if (group.launchTime) {
        const expired = group.launchTime <= getCurrentServerTime();
        const span = document.createElement('span');
        span.className = 'countdown';
        span.style.cssText = 'font-size:10px;display:block;margin-top:4px;';
        span.textContent = expired ? 'LAUNCH EXCEEDED' : 'Calculating...';
        span.style.color = expired ? '#ff4444' : '#aaffaa';
        if (expired) span.style.fontWeight = 'bold';
        btn.append(document.createElement('br'), span);
      }
      btn.onclick = () => openGroupAttacks(group);
      attackPlanContainer.appendChild(btn);
    });
    startCountdowns();
  }

  /* ── UI Build ── */

  if (document.getElementById('tw_open_tabs_ui')) document.getElementById('tw_open_tabs_ui').remove();

  const spinnerStyle = document.createElement('style');
  spinnerStyle.textContent = '#tw_open_tabs_ui input[type=number]::-webkit-inner-spin-button,#tw_open_tabs_ui input[type=number]::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}#tw_open_tabs_ui input[type=number]{-moz-appearance:textfield}';
  document.head.appendChild(spinnerStyle);

  const container = el('div', { id: 'tw_open_tabs_ui', style: 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:99999;background:#1a1a1a;color:#fff;padding:0;border-radius:8px;font-family:Arial,Helvetica,sans-serif;font-size:13px;width:880px;box-shadow:0 8px 24px rgba(0,0,0,0.8);resize:both;overflow:auto;border:2px solid #333;' });

  // Title Bar
  const titleBar     = el('div', { style: 'cursor:move;padding:16px;background:linear-gradient(135deg,#2a2a2a 0%,#1a1a1a 100%);border-top-left-radius:6px;border-top-right-radius:6px;user-select:none;border-bottom:2px solid #444;position:relative;' });
  const titleWrapper = el('div', { style: 'text-align:center;position:relative;' });
  const titleEl      = el('div', { style: 'font-size:22px;font-weight:bold;color:#e0e0e0;text-shadow:2px 2px 4px rgba(0,0,0,0.6);letter-spacing:1px;' });
  titleEl.textContent = 'RALLY OPENER';

  const btnGlobalHelp = el('button', { innerText: '?', title: 'Help', type: 'button', style: 'position:absolute;left:10px;top:50%;transform:translateY(-50%);cursor:pointer;padding:4px 9px;background:#1a2a1a;color:#6d6;border:1px solid #2a4a2a;border-radius:4px;font-size:14px;font-weight:bold;z-index:10;' });
  const closeBtn      = el('button', { innerText: '✕', title: 'Close', style: 'position:absolute;right:0;top:50%;transform:translateY(-50%);cursor:pointer;padding:4px 10px;background:#444;color:#fff;border:1px solid #666;border-radius:4px;font-size:16px;font-weight:bold;z-index:10;' });

  titleBar.appendChild(btnGlobalHelp);
  titleWrapper.appendChild(titleEl);
  if (!hasPremium) {
    const amWarning = el('div', { style: 'position:absolute;right:40px;top:50%;transform:translateY(-50%);font-size:11px;color:#ffaa00;white-space:nowrap;' });
    amWarning.textContent = '⚠ Premium Account not active';
    titleWrapper.appendChild(amWarning);
  }
  titleWrapper.appendChild(closeBtn);
  titleBar.appendChild(titleWrapper);
  container.appendChild(titleBar);

  // Body
  const body = el('div', { style: 'padding:16px;display:block;' });
  container.appendChild(body);

  // Unit Templates Section
  const templatesSection       = el('div', { style: 'margin-bottom:12px;padding:12px;background:#0f0f0f;border-radius:6px;border:1px solid #333;' });
  const templatesSectionHeader = el('div', { style: 'display:flex;align-items:center;margin-bottom:8px;' });
  const _templatesLeft         = el('div', { style: 'flex:1;' });
  const templatesSectionTitle  = el('div', { style: 'font-weight:bold;color:#aaa;text-align:center;font-size:13px;cursor:pointer;' });
  templatesSectionTitle.textContent = 'Unit Templates';
  const templatesCollapseBtn = el('button', { innerText: '+', type: 'button', style: 'cursor:pointer;padding:2px 8px;background:#2a2a2a;color:#fff;border:1px solid #4a4a4a;border-radius:3px;font-size:16px;font-weight:bold;line-height:1;' });
  const templatesHelpBtn     = el('button', { innerText: '?', type: 'button', title: 'Help', style: 'cursor:pointer;padding:2px 7px;background:#1a2a1a;color:#6d6;border:1px solid #2a4a2a;border-radius:3px;font-size:13px;font-weight:bold;line-height:1;margin-left:4px;' });
  const _templatesRight      = el('div', { style: 'flex:1;display:flex;justify-content:flex-end;' });
  _templatesRight.append(templatesCollapseBtn, templatesHelpBtn);
  templatesSectionHeader.append(_templatesLeft, templatesSectionTitle, _templatesRight);
  templatesSection.appendChild(templatesSectionHeader);

  const templatesContent = el('div', { style: 'display:none;' });
  templatesSection.appendChild(templatesContent);

  const templateControls = el('div', { style: 'display:flex;gap:8px;margin-bottom:8px;align-items:center;justify-content:center;flex-wrap:wrap;' });
  templatesContent.appendChild(templateControls);

  const templateSelect     = el('select', { style: 'padding:6px;background:#0f0f0f;color:#fff;border:1px solid #444;border-radius:4px;min-width:150px;' });
  const btnNewTemplate     = el('button', { innerText: 'New',    type: 'button', style: 'cursor:pointer;padding:6px 12px;background:#2a5a2a;color:#fff;border:1px solid #3a7a3a;border-radius:4px;font-size:12px;' });
  const btnDeleteTemplate  = el('button', { innerText: 'Delete', type: 'button', style: 'cursor:pointer;padding:6px 12px;background:#5a2a2a;color:#fff;border:1px solid #7a3a3a;border-radius:4px;font-size:12px;' });
  templateSelect.appendChild(el('option', { value: '', innerText: '-- Select Template --' }));
  templateControls.append(templateSelect, btnNewTemplate, btnDeleteTemplate);

  const templateEditor = el('div', { style: 'display:none;margin-top:6px;padding:6px;background:#0a0a0a;border-radius:4px;border:1px solid #333;' });
  templatesContent.appendChild(templateEditor);

  // Unit label row
  const labelsRow = el('div', { style: 'display:flex;align-items:center;gap:6px;margin-bottom:3px;padding-left:9px;' });
  labelsRow.append(el('span', { style: 'width:15px;flex-shrink:0;' }), el('span', { style: 'width:45px;flex-shrink:0;' }));
  UNIT_TYPES.forEach(u => {
    const lbl = el('span', { style: 'width:50px;min-width:50px;text-align:center;display:flex;align-items:center;justify-content:center;flex-shrink:0;' });
    if (UNIT_IMG_SRCS[u]) {
      const img = el('img'); img.src = UNIT_IMG_SRCS[u]; img.alt = UNIT_NAMES[u]; img.title = UNIT_NAMES[u];
      img.style.cssText = 'width:25px;height:25px;object-fit:contain;';
      lbl.appendChild(img);
    } else {
      lbl.style.cssText += ';color:#888;font-size:9px;white-space:nowrap;';
      lbl.textContent = UNIT_NAMES[u];
    }
    labelsRow.appendChild(lbl);
  });
  templateEditor.appendChild(labelsRow);

  const inputStyle  = 'width:50px;min-width:50px;padding:3px 4px;background:#1a1a1a;color:#fff;border:1px solid #444;border-radius:2px;box-sizing:border-box;font-size:11px;text-align:center;flex-shrink:0;';
  const sendModeRow = el('label', { style: 'display:flex;align-items:center;gap:6px;margin-bottom:4px;padding:4px;background:#0f0f0f;border-radius:3px;cursor:pointer;' });
  const keepModeRow = el('label', { style: 'display:flex;align-items:center;gap:6px;padding:4px;background:#0f0f0f;border-radius:3px;cursor:pointer;' });
  const sendModeRadio = el('input', { type: 'radio', name: 'template_mode', value: 'send', style: 'cursor:pointer;flex-shrink:0;' });
  const keepModeRadio = el('input', { type: 'radio', name: 'template_mode', value: 'keep', style: 'cursor:pointer;flex-shrink:0;' });
  sendModeRow.append(sendModeRadio, el('span', { innerText: 'Send:', style: 'color:#bbb;font-size:11px;min-width:45px;flex-shrink:0;' }));
  keepModeRow.append(keepModeRadio, el('span', { innerText: 'Keep:', style: 'color:#bbb;font-size:11px;min-width:45px;flex-shrink:0;' }));
  templateEditor.append(sendModeRow, keepModeRow);

  const unitInputs     = {};
  const keepUnitInputs = {};
  UNIT_TYPES.forEach(u => {
    unitInputs[u]     = el('input', { type: 'number', min: '0', value: '', placeholder: '0', style: inputStyle });
    keepUnitInputs[u] = el('input', { type: 'number', min: '0', value: '', placeholder: '0', style: inputStyle });
    sendModeRow.appendChild(unitInputs[u]);
    keepModeRow.appendChild(keepUnitInputs[u]);
  });

  body.appendChild(templatesSection);

  // Rally Point Opener Section
  const rallySection       = el('div', { style: 'margin-bottom:12px;padding:12px;background:#0f0f0f;border-radius:6px;border:1px solid #333;' });
  const rallySectionHeader = el('div', { style: 'display:flex;align-items:center;margin-bottom:8px;' });
  const _rallyLeft         = el('div', { style: 'flex:1;display:flex;align-items:center;gap:6px;' });
  const modeToggle         = el('div', { style: 'display:flex;border:1px solid #444;border-radius:3px;overflow:hidden;flex-shrink:0;' });
  const btnModeSimple      = el('button', { innerText: 'Simple', type: 'button', style: 'cursor:pointer;padding:3px 10px;background:#2a5a2a;color:#fff;border:none;font-size:11px;font-weight:bold;' });
  const btnModeAdvanced    = el('button', { innerText: 'Advanced', type: 'button', style: 'cursor:pointer;padding:3px 10px;background:#1e1e1e;color:#555;border:none;font-size:11px;font-weight:bold;' });
  modeToggle.append(btnModeSimple, btnModeAdvanced);
  const btnTestData        = el('button', { innerText: 'Test', title: 'Load Test Data', type: 'button', style: 'cursor:pointer;padding:4px 8px;background:#2a4a5a;color:#fff;border:1px solid #3a6a7a;border-radius:3px;font-size:11px;' });
  _rallyLeft.append(modeToggle, btnTestData);
  const rallySectionTitle  = el('div', { style: 'font-weight:bold;color:#aaa;text-align:center;font-size:13px;cursor:pointer;' });
  rallySectionTitle.textContent = 'Rally Point Opener';
  const rallyCollapseBtn   = el('button', { innerText: '+', type: 'button', style: 'cursor:pointer;padding:2px 8px;background:#2a2a2a;color:#fff;border:1px solid #4a4a4a;border-radius:3px;font-size:16px;font-weight:bold;line-height:1;' });
  const rallyHelpBtn       = el('button', { innerText: '?', type: 'button', title: 'Help', style: 'cursor:pointer;padding:2px 7px;background:#1a2a1a;color:#6d6;border:1px solid #2a4a2a;border-radius:3px;font-size:13px;font-weight:bold;line-height:1;margin-left:4px;' });
  const _rallyRight        = el('div', { style: 'flex:1;display:flex;justify-content:flex-end;' });
  _rallyRight.append(rallyCollapseBtn, rallyHelpBtn);
  rallySectionHeader.append(_rallyLeft, rallySectionTitle, _rallyRight);
  rallySection.appendChild(rallySectionHeader);

  const rallyContent   = el('div', { style: 'display:none;' });
  const columnsWrapper = el('div', { style: 'display:flex;gap:12px;margin-bottom:12px;' });
  rallyContent.appendChild(columnsWrapper);

  const fromColumn  = el('div', { style: 'flex:1;display:flex;flex-direction:column;position:relative;' });
  const fromLabel   = el('div', { style: 'font-weight:bold;margin-bottom:6px;color:#aaa;text-align:center;font-size:14px;' });
  fromLabel.textContent = 'FROM Coordinates';
  const fromTextarea = el('textarea', { rows: 8, style: 'width:100%;box-sizing:border-box;background:#0f0f0f;color:#fff;border:1px solid #444;padding:8px;border-radius:4px;resize:vertical;font-family:monospace;', placeholder: '111|222\n222|111\n223|111' });
  const fromOverlay  = el('div', { style: 'position:absolute;top:30px;left:0;right:0;bottom:0;background:rgba(15,15,15,0.95);border:1px solid #444;border-radius:4px;display:none;align-items:center;justify-content:center;color:#4a9eff;font-weight:bold;font-size:14px;pointer-events:none;' });
  fromOverlay.textContent = 'Using current group';
  fromColumn.append(fromLabel, fromTextarea, fromOverlay);

  const toColumn   = el('div', { style: 'flex:1;display:flex;flex-direction:column;' });
  const toLabel    = el('div', { style: 'font-weight:bold;margin-bottom:6px;color:#aaa;text-align:center;font-size:14px;' });
  toLabel.textContent = 'TO Coordinates';
  const toTextarea = el('textarea', { rows: 8, style: 'width:100%;box-sizing:border-box;background:#0f0f0f;color:#fff;border:1px solid #444;padding:8px;border-radius:4px;resize:vertical;font-family:monospace;', placeholder: '123|234\n112|223\n112|224' });
  toColumn.append(toLabel, toTextarea);
  columnsWrapper.append(fromColumn, toColumn);

  // Advanced options (hidden in Simple mode)
  const advancedOptions  = el('div', { style: 'display:none;padding:8px;background:#0a0a0a;border-radius:4px;border:1px solid #2a2a2a;margin-bottom:12px;' });

  const useGroupWrapper  = el('label', { style: 'display:flex;align-items:center;gap:6px;color:#bbb;font-size:11px;cursor:pointer;margin-bottom:8px;' });
  const useGroupCheckbox = el('input', { type: 'checkbox', style: 'cursor:pointer;' });
  useGroupWrapper.append(useGroupCheckbox, el('span', { innerText: 'Use current group' }));
  advancedOptions.appendChild(useGroupWrapper);

  const fakeModeWrapper  = el('label', { style: 'display:flex;align-items:center;gap:6px;color:#bbb;font-size:12px;cursor:pointer;margin-bottom:8px;' });
  const fakeModeCheckbox = el('input', { type: 'checkbox', style: 'cursor:pointer;' });
  fakeModeWrapper.append(fakeModeCheckbox, el('span', { innerText: 'Fake Mode (limit by available units)' }));
  advancedOptions.appendChild(fakeModeWrapper);

  const maxAttacksRow   = el('div', { style: 'display:none;align-items:center;gap:8px;margin-bottom:8px;' });
  const maxAttacksInput = el('input', { type: 'number', min: '1', value: '1', style: 'width:60px;padding:3px 4px;background:#1a1a1a;color:#fff;border:1px solid #444;border-radius:2px;font-size:11px;text-align:center;' });
  maxAttacksRow.append(el('span', { innerText: 'Max attacks per village:', style: 'color:#bbb;font-size:11px;' }), maxAttacksInput);
  advancedOptions.appendChild(maxAttacksRow);

  const randomizeWrapper  = el('label', { style: 'display:flex;align-items:center;gap:6px;color:#bbb;font-size:11px;cursor:pointer;' });
  const randomizeCheckbox = el('input', { type: 'checkbox', style: 'cursor:pointer;' });
  randomizeWrapper.append(randomizeCheckbox, el('span', { innerText: 'Randomize pairings' }));
  advancedOptions.appendChild(randomizeWrapper);

  // Fake Mode Reserves
  const fakeReservesRow = el('div', { style: 'display:none;margin-top:8px;padding:8px;background:#111;border-radius:4px;border:1px solid #2a2a2a;' });
  const fakeReservesTitle = el('div', { style: 'font-size:11px;color:#888;margin-bottom:4px;' });
  fakeReservesTitle.textContent = 'Keep home (reserves per village):';
  const fakeReservesLabels = el('div', { style: 'display:flex;align-items:center;gap:6px;margin-bottom:2px;' });
  const fakeReservesInputsRow = el('div', { style: 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;' });
  const fakeReserveInputs = {};
  UNIT_TYPES.forEach(u => {
    const lbl = el('span', { style: 'width:50px;min-width:50px;text-align:center;display:flex;align-items:center;justify-content:center;flex-shrink:0;' });
    if (UNIT_IMG_SRCS[u]) {
      const img = el('img'); img.src = UNIT_IMG_SRCS[u]; img.alt = UNIT_NAMES[u]; img.title = UNIT_NAMES[u];
      img.style.cssText = 'width:25px;height:25px;object-fit:contain;';
      lbl.appendChild(img);
    } else {
      lbl.style.cssText += ';color:#888;font-size:9px;white-space:nowrap;';
      lbl.textContent = UNIT_NAMES[u];
    }
    fakeReservesLabels.appendChild(lbl);
    fakeReserveInputs[u] = el('input', { type: 'number', min: '0', value: '', placeholder: '0', style: inputStyle });
    fakeReservesInputsRow.appendChild(fakeReserveInputs[u]);
  });
  fakeReservesRow.append(fakeReservesTitle, fakeReservesLabels, fakeReservesInputsRow);
  advancedOptions.appendChild(fakeReservesRow);

  rallyContent.appendChild(advancedOptions);

  const openTabsRow = el('div', { style: 'display:flex;justify-content:center;' });
  const btnOpenTabs = el('button', { innerText: 'Open Tabs', type: 'button', style: 'cursor:pointer;padding:10px 24px;background:#2a5a2a;color:#fff;border:1px solid #3a7a3a;border-radius:4px;font-weight:bold;font-size:14px;' });
  openTabsRow.append(btnOpenTabs);
  rallyContent.appendChild(openTabsRow);

  rallySection.appendChild(rallyContent);
  body.appendChild(rallySection);

  // Attack Plan Section
  const attackPlanSection      = el('div', { style: 'margin-bottom:12px;padding:12px;background:#0f0f0f;border-radius:6px;border:1px solid #333;' });
  const attackPlanHeader       = el('div', { style: 'display:flex;align-items:center;margin-bottom:8px;' });
  const _attackPlanLeft        = el('div', { style: 'flex:1;' });
  const attackPlanTitle        = el('div', { style: 'font-weight:bold;color:#aaa;text-align:center;font-size:13px;cursor:pointer;' });
  attackPlanTitle.textContent  = 'Attack Plans';
  const attackPlanCollapseBtn  = el('button', { innerText: '+', type: 'button', style: 'cursor:pointer;padding:2px 8px;background:#2a2a2a;color:#fff;border:1px solid #4a4a4a;border-radius:3px;font-size:16px;font-weight:bold;line-height:1;' });
  const attackPlanHelpBtn      = el('button', { innerText: '?', type: 'button', title: 'Help', style: 'cursor:pointer;padding:2px 7px;background:#1a2a1a;color:#6d6;border:1px solid #2a4a2a;border-radius:3px;font-size:13px;font-weight:bold;line-height:1;margin-left:4px;' });
  const _attackPlanRight       = el('div', { style: 'flex:1;display:flex;justify-content:flex-end;' });
  _attackPlanRight.append(attackPlanCollapseBtn, attackPlanHelpBtn);
  attackPlanHeader.append(_attackPlanLeft, attackPlanTitle, _attackPlanRight);
  attackPlanSection.appendChild(attackPlanHeader);

  const attackPlanContent   = el('div', { style: 'display:none;' });
  const attackPlanRow       = el('div', { style: 'display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-bottom:8px;' });
  const btnPasteAttackPlan  = el('button', { innerText: 'Paste Attack Plan', type: 'button', style: 'cursor:pointer;padding:8px 16px;background:#5a3a2a;color:#fff;border:1px solid #7a5a3a;border-radius:4px;' });
  const attackPlanContainer = el('div', { id: 'attack_plan_groups', style: 'display:none;margin-top:8px;' });
  attackPlanRow.appendChild(btnPasteAttackPlan);
  attackPlanContent.append(attackPlanRow, attackPlanContainer);
  attackPlanSection.appendChild(attackPlanContent);
  body.appendChild(attackPlanSection);

  // Message Box
  msgBox = el('div', { style: 'margin-bottom:12px;color:#9f9f9f;min-height:18px;text-align:center;padding:6px;background:#0a0a0a;border-radius:4px;border:1px solid #2a2a2a;cursor:pointer;', title: 'Click to view message history' });
  body.appendChild(msgBox);

  // Footer
  const footer = el('div', { style: 'padding:12px;background:linear-gradient(135deg,#1a1a1a 0%,#0a0a0a 100%);border-bottom-left-radius:6px;border-bottom-right-radius:6px;border-top:2px solid #444;text-align:center;' });
  const author = el('div', { style: 'font-size:12px;color:#888;text-shadow:1px 1px 2px rgba(0,0,0,0.6);letter-spacing:0.5px;' });
  author.textContent = 'Created by NeilB';
  footer.appendChild(author);
  container.appendChild(footer);
  document.body.appendChild(container);

  // Help Overlay
  helpOverlay = el('div', { style: 'position:fixed;left:0;top:0;width:100%;height:100%;background:rgba(0,0,0,0.75);z-index:200000;display:none;align-items:center;justify-content:center;' });
  const helpContent  = el('div', { style: 'background:#1a1a1a;color:#fff;padding:24px;border-radius:8px;border:2px solid #444;max-width:480px;width:90%;' });
  helpTitle          = el('div', { style: 'font-size:16px;font-weight:bold;margin-bottom:12px;color:#e0e0e0;' });
  helpText           = el('div', { style: 'font-size:13px;color:#bbb;line-height:1.7;margin-bottom:16px;' });
  const helpCloseRow = el('div', { style: 'display:flex;justify-content:center;' });
  const helpCloseBtn = el('button', { innerText: 'Close', type: 'button', style: 'cursor:pointer;padding:8px 24px;background:#444;color:#fff;border:1px solid #666;border-radius:4px;' });
  helpCloseRow.appendChild(helpCloseBtn);
  helpContent.append(helpTitle, helpText, helpCloseRow);
  helpOverlay.appendChild(helpContent);
  document.body.appendChild(helpOverlay);

  // Message History Overlay
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

  /* ── Template Logic ── */

  function refreshTemplateSelect() {
    templateSelect.innerHTML = '';
    templateSelect.appendChild(el('option', { value: '', innerText: '-- Select Template --' }));
    Object.keys(unitTemplates).sort().forEach(name => {
      templateSelect.appendChild(el('option', { value: name, innerText: name }));
    });
    if (currentTemplate && unitTemplates[currentTemplate]) {
      templateSelect.value = currentTemplate;
      loadTemplateIntoEditor(currentTemplate);
    } else {
      templateSelect.value = '';
      currentTemplate = null;
      templateEditor.style.display = 'none';
    }
  }

  function loadTemplateIntoEditor(name) {
    if (!name || !unitTemplates[name]) { templateEditor.style.display = 'none'; return; }
    const template = unitTemplates[name];
    templateEditor.style.display = 'block';
    const isSend = template.mode === 'send';
    sendModeRadio.checked = isSend;
    keepModeRadio.checked = !isSend;
    sendModeRow.style.background = isSend ? '#1a3a1a' : '#0f0f0f';
    keepModeRow.style.background = isSend ? '#0f0f0f' : '#1a3a1a';
    UNIT_TYPES.forEach(u => { unitInputs[u].value = ''; keepUnitInputs[u].value = ''; });
    const inputs = isSend ? unitInputs : keepUnitInputs;
    UNIT_TYPES.forEach(u => { inputs[u].value = template.units[u] || ''; });
  }

  function saveCurrentTemplate() {
    if (!currentTemplate) return;
    const mode = sendModeRadio.checked ? 'send' : 'keep';
    const inputs = mode === 'send' ? unitInputs : keepUnitInputs;
    const units = {};
    UNIT_TYPES.forEach(u => {
      const v = inputs[u].value.trim();
      if (v && v !== '0') units[u] = parseInt(v);
    });
    unitTemplates[currentTemplate] = { mode, units };
    saveTemplates();
  }

  function getFakeReserves() {
    const res = {};
    UNIT_TYPES.forEach(u => {
      const v = parseInt(fakeReserveInputs[u].value) || 0;
      if (v > 0) res[u] = v;
    });
    return res;
  }

  /* ── Event Wiring ── */

  // Draggable
  (function makeDraggable() {
    // Section content areas — drag does not activate when clicking inside these
    const noDragZones = [templatesContent, rallyContent, attackPlanContent, msgBox];

    let isDragging = false, startX = 0, startY = 0, initLeft = 0, initTop = 0;

    function onMouseDown(e) {
      const t = e.target;
      if (t === closeBtn) return;
      if (['BUTTON','INPUT','TEXTAREA','SELECT','LABEL'].indexOf(t.tagName) !== -1) return;
      if (t.closest && t.closest('button,input,textarea,select,label')) return;
      if (noDragZones.some(z => z.contains(t))) return;
      const r = container.getBoundingClientRect();
      if (e.clientX > r.right - 16 && e.clientY > r.bottom - 16) return;
      e.preventDefault();
      isDragging = true;
      startX = e.clientX; startY = e.clientY;
      initLeft = r.left; initTop = r.top;
      document.onmousemove = onMouseMove;
      document.onmouseup   = onMouseUp;
    }

    function onMouseMove(e) {
      if (!isDragging) return;
      e.preventDefault();
      const newLeft = Math.max(-container.offsetWidth + 50, Math.min(initLeft + e.clientX - startX, window.innerWidth  - 50));
      const newTop  = Math.max(0,                           Math.min(initTop  + e.clientY - startY, window.innerHeight - 50));
      container.style.left      = newLeft + 'px';
      container.style.top       = newTop  + 'px';
      container.style.transform = 'none';
    }

    function onMouseUp() {
      isDragging = false;
      document.onmousemove = null;
      document.onmouseup   = null;
    }

    container.onmousedown = onMouseDown;
  })();

  // Close
  closeBtn.addEventListener('click', () => container.remove());

  // Collapse toggles
  const templatesHandler  = makeCollapseHandler(templatesContent,  templatesCollapseBtn);
  const rallyHandler      = makeCollapseHandler(rallyContent,      rallyCollapseBtn);
  const attackPlanHandler = makeCollapseHandler(attackPlanContent, attackPlanCollapseBtn);
  templatesCollapseBtn.onclick  = templatesHandler;  templatesSectionTitle.onclick  = templatesHandler;
  rallyCollapseBtn.onclick      = rallyHandler;      rallySectionTitle.onclick      = rallyHandler;
  attackPlanCollapseBtn.onclick = attackPlanHandler; attackPlanTitle.onclick        = attackPlanHandler;

  // Mode toggle logic
  let isAdvancedMode = false;
  function setRallyMode(advanced) {
    isAdvancedMode = advanced;
    btnModeSimple.style.background   = advanced ? '#1e1e1e' : '#2a5a2a';
    btnModeSimple.style.color        = advanced ? '#555'    : '#fff';
    btnModeAdvanced.style.background = advanced ? '#2a5a2a' : '#1e1e1e';
    btnModeAdvanced.style.color      = advanced ? '#fff'    : '#555';
    advancedOptions.style.display    = advanced ? 'block'   : 'none';
  }
  btnModeSimple.onclick   = () => setRallyMode(false);
  btnModeAdvanced.onclick = () => setRallyMode(true);

  // Help
  helpCloseBtn.addEventListener('click', () => { helpOverlay.style.display = 'none'; });
  helpOverlay.addEventListener('click', e => { if (e.target === helpOverlay) helpOverlay.style.display = 'none'; });

  templatesHelpBtn.addEventListener('click', e => {
    e.stopPropagation();
    showHelp('Unit Templates',
      'Define unit compositions to auto-fill when opening rally tabs.<br><br>' +
      '<b>Send mode:</b> sends exactly the number specified per attack.<br>' +
      '<b>Keep mode:</b> keeps that many troops home and sends the rest.<br><br>' +
      'Select a template before clicking <i>Open Tabs</i> to apply it. Enable <i>Fake Mode</i> to automatically skip attacks where a village lacks sufficient units.');
  });

  rallyHelpBtn.addEventListener('click', e => {
    e.stopPropagation();
    if (!isAdvancedMode) {
      showHelp('Rally Point Opener — Simple',
        'Enter FROM and TO coordinates — one per line — then click <i>Open Tabs</i>.<br><br>' +
        'Each row is matched by position: FROM row 1 attacks TO row 1, FROM row 2 attacks TO row 2, and so on. If the lists have different lengths the shorter one determines how many tabs open.<br><br>' +
        '<b>Example:</b><br>' +
        '<code style="display:block;background:#0a0a0a;padding:8px;border-radius:4px;margin:6px 0;font-size:12px;line-height:1.8;">' +
        'FROM &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;TO<br>' +
        '531|537 → 534|534 &nbsp;(tab 1)<br>' +
        '531|537 → 537|536 &nbsp;(tab 2)<br>' +
        '539|544 → 534|534 &nbsp;(tab 3)' +
        '</code>' +
        'The FROM village can appear multiple times — each entry opens a separate tab to a different target.<br><br>' +
        'Both coordinates are validated against local village data. Invalid coordinates are skipped and reported.');
    } else {
      showHelp('Rally Point Opener — Advanced',
        '<b>Use current group</b><br>' +
        'Replaces the FROM textarea with the villages in your currently active in-game village group. Pairings are distributed round-robin across all TO targets.<br><br>' +
        '<b>Fake Mode</b><br>' +
        'Reads available units from the Combined Village Overview before opening tabs. Villages with fewer units than the template requires are skipped.<br>' +
        'Use <i>Keep home (reserves)</i> to subtract a minimum per unit type before the check.<br><br>' +
        '<b>Max attacks per village</b> (visible when Fake Mode is on)<br>' +
        'How many TO targets each FROM village can attack. Default is 1.<br>' +
        'With 10 FROM villages, 5 TO targets, and max = 1: each village attacks one target, giving each target 2 attackers.<br>' +
        'With max = 2: each village attempts 2 targets, giving 4 attackers per target (before Fake Mode filtering).<br><br>' +
        'Fake Mode caps this further by actual available units — if a village can only support 1 send but max is 2, only 1 tab is opened for that village.<br><br>' +
        '<b>Randomize pairings</b><br>' +
        'Shuffles which FROM village is paired with which TO target. Clicking <i>Open Tabs</i> multiple times will produce different assignments.<br><br>' +
        '<b>Example — 3 villages, 2 targets, max = 1, Template: 100 LC</b><br>' +
        '<code style="display:block;background:#0a0a0a;padding:8px;border-radius:4px;margin:6px 0;font-size:12px;line-height:1.8;">' +
        'Round-robin (no randomize):<br>' +
        'V1 → T1, V2 → T2, V3 → T1<br><br>' +
        'Village V1: 120 LC → meets template → tab opened<br>' +
        'Village V2: 80 LC &nbsp;→ fails template → skipped<br>' +
        'Village V3: 150 LC → meets template → tab opened<br>' +
        'Result: T1 gets 2 tabs, T2 gets 0' +
        '</code>');
    }
  });

  attackPlanHelpBtn.addEventListener('click', e => {
    e.stopPropagation();
    showHelp('Attack Plans',
      'Paste a formatted attack plan to generate one button per attack wave.<br><br>' +
      'Clicking a wave button opens all attacks in that wave as rally point tabs. If a launch time is included, a live countdown is shown on the button.<br><br>' +
      '<b>Accepted format (tab or multi-space separated):</b><br>' +
      '<code style="display:block;background:#0a0a0a;padding:8px;border-radius:4px;margin:6px 0;font-size:11px;line-height:1.8;white-space:pre;">' +
      'Grp  Attacker   Target     Dist  Travel  Launch           Arrival\n' +
      '1    528|546    537|536    13.5  4h 2m   06/06 21:38:45  07/06 01:40:55\n' +
      '1    539|544    534|534    11.2  3h 21m  06/06 21:38:45  07/06 01:00:00\n' +
      '2    531|537    534|534    8.1   2h 26m  06/06 22:15:00  07/06 00:41:00' +
      '</code>' +
      'Only <b>Grp</b>, <b>Attacker</b> and <b>Target</b> are required. Launch time (column 6) is used for the countdown — format must be <b>DD/MM HH:MM:SS</b>.<br><br>' +
      'You can also paste directly from a Tribal Wars HTML attack plan table.');
  });

  btnGlobalHelp.addEventListener('click', e => {
    e.stopPropagation();
    showHelp('Rally Opener — Overview',
      '<b>Purpose</b><br>' +
      'Opens rally point tabs for multiple village pairs at once, letting you queue up attacks or fakes quickly without navigating manually.<br><br>' +
      '<b>How to use</b><br>' +
      '1. Optionally select or create a unit template to pre-fill troop counts.<br>' +
      '2. <b>Simple</b>: enter FROM and TO coordinates one per line, then click <i>Open Tabs</i>. Rows are paired by position.<br>' +
      '3. <b>Advanced</b>: enable <i>Use current group</i> to pull FROM villages from your active group, <i>Fake Mode</i> to filter by available units, and <i>Randomize pairings</i> for varied assignments each run. With Fake Mode on, set <i>Max attacks per village</i> to let each village attack multiple targets.<br>' +
      '4. Or paste an attack plan and click a wave button to open all attacks in that wave.<br><br>' +
      'Village data is fetched on script load if no data exists or the cache is more than an hour old.<br><br>' +
      '<b>Premium requirements</b><br>' +
      'The following features require a <b>Premium Account</b>:<br>' +
      '— Unit templates (reads available units from the Combined Village Overview)<br>' +
      '— Fake Mode (checks unit availability per village)<br>' +
      '— Use current group (village groups are a Premium feature)<br><br>' +
      '<b>Popups blocked?</b><br>' +
      'After clicking Open Tabs, look for the popup blocked icon in your browser\'s address bar, click it, and choose <i>Always allow popups from this site</i>. Then try again.');
  });

  // Feature gating
  if (!hasPremium) {
    const disabled = 'opacity:0.35;pointer-events:none;';
    templatesSection.style.cssText += disabled;
    templatesSection.title = 'Requires Premium Account';
    btnModeAdvanced.style.cssText += 'opacity:0.35;pointer-events:none;cursor:not-allowed;';
    btnModeAdvanced.title = 'Requires Premium Account';
  }

  // Message history
  msgBox.addEventListener('click', () => {
    msgHistoryList.innerHTML = messageHistory.length === 0
      ? '<div style="color:#888;padding:8px;">No messages yet</div>'
      : messageHistory.slice().reverse().map(e => {
          const t = e.time;
          const ts = ('0'+t.getHours()).slice(-2) + ':' + ('0'+t.getMinutes()).slice(-2) + ':' + ('0'+t.getSeconds()).slice(-2);
          return '<div style="padding:6px 4px;border-bottom:1px solid #2a2a2a;font-size:12px;">' +
            '<span style="color:#555;margin-right:8px;">' + ts + '</span>' +
            '<span style="color:#ddd;">' + e.text + '</span></div>';
        }).join('');
    msgHistoryOverlay.style.display = 'flex';
  });
  msgHistoryCloseBtn.addEventListener('click', () => { msgHistoryOverlay.style.display = 'none'; });
  msgHistoryOverlay.addEventListener('click', e => { if (e.target === msgHistoryOverlay) msgHistoryOverlay.style.display = 'none'; });

  // Fake Mode toggle — show/hide reserves panel and max attacks row
  fakeModeCheckbox.addEventListener('change', () => {
    const on = fakeModeCheckbox.checked;
    fakeReservesRow.style.display = on ? 'block' : 'none';
    maxAttacksRow.style.display   = on ? 'flex'  : 'none';
  });

  // Fake reserves persistence
  UNIT_TYPES.forEach(u => {
    fakeReserveInputs[u].addEventListener('input', () => {
      try {
        const res = {};
        UNIT_TYPES.forEach(ut => { const v = parseInt(fakeReserveInputs[ut].value) || 0; if (v) res[ut] = v; });
        localStorage.setItem('tw_fake_reserves', JSON.stringify(res));
      } catch (e) {}
    });
  });

  // Use current group toggle
  useGroupCheckbox.addEventListener('change', () => {
    const active = useGroupCheckbox.checked;
    fromTextarea.disabled      = active;
    fromTextarea.style.opacity = active ? '0.5' : '1';
    fromOverlay.style.display  = active ? 'flex' : 'none';
  });

  // Template auto-save on input change
  UNIT_TYPES.forEach(u => {
    unitInputs[u].addEventListener('input',     () => { if (currentTemplate) saveCurrentTemplate(); });
    keepUnitInputs[u].addEventListener('input', () => { if (currentTemplate) saveCurrentTemplate(); });
  });

  // Mode selection visual feedback
  sendModeRadio.addEventListener('change', () => {
    if (!sendModeRadio.checked) return;
    sendModeRow.style.background = '#1a3a1a';
    keepModeRow.style.background = '#0f0f0f';
    if (currentTemplate) saveCurrentTemplate();
  });
  keepModeRadio.addEventListener('change', () => {
    if (!keepModeRadio.checked) return;
    keepModeRow.style.background = '#1a3a1a';
    sendModeRow.style.background = '#0f0f0f';
    if (currentTemplate) saveCurrentTemplate();
  });

  // Template controls
  btnNewTemplate.onclick = function createTemplate() {
    const name = (prompt('Enter template name:') || '').trim();
    if (!name) return;
    if (unitTemplates[name]) { alert('A template with this name already exists'); return; }
    unitTemplates[name] = { mode: 'send', units: {} };
    saveTemplates();
    currentTemplate = name;
    refreshTemplateSelect();
    showMessage('Template "' + name + '" created');
  };

  btnDeleteTemplate.onclick = function deleteTemplate() {
    const selected = templateSelect.value;
    if (!selected) { showMessage('Please select a template to delete'); return; }
    if (confirm('Delete template "' + selected + '"?')) {
      delete unitTemplates[selected];
      saveTemplates();
      if (currentTemplate === selected) currentTemplate = null;
      refreshTemplateSelect();
      showMessage('Template deleted');
    }
  };

  templateSelect.onchange = function onTemplateChange() {
    currentTemplate = templateSelect.value || null;
    if (currentTemplate) {
      loadTemplateIntoEditor(currentTemplate);
      showMessage('Template "' + currentTemplate + '" selected');
    } else {
      templateEditor.style.display = 'none';
      showMessage('No template selected');
    }
  };

  // Open Tabs
  btnOpenTabs.onclick = function openTabs() {
    const toCoords = parseCoordinateList(toTextarea.value);
    let fromCoords;
    if (useGroupCheckbox.checked) {
      const groupVillages = getVillagesFromCurrentGroup();
      if (!groupVillages.length) { showMessage('No villages found in current group'); return; }
      fromCoords = groupVillages.map(v => v.coord);
    } else {
      fromCoords = parseCoordinateList(fromTextarea.value);
    }
    if (!fromCoords.length || !toCoords.length) {
      showMessage('Please enter coordinates in both FROM and TO fields');
      return;
    }
    const maxPerVillage = fakeModeCheckbox.checked ? (parseInt(maxAttacksInput.value) || 1) : 1;
    const urls = prepareTabsFromPairs(fromCoords, toCoords, {
      advancedMode: isAdvancedMode,
      maxPerVillage,
      randomize: randomizeCheckbox.checked,
    });
    if (!urls.length) return;
    showMessage('Opening ' + urls.length + ' tabs...');
    openUrls(urls);
  };

  // Test data
  btnTestData.onclick = function loadTestData() {
    fromTextarea.value = '531|537\n531|537';
    toTextarea.value   = '534|534\n537|536';
    showMessage('Test data loaded');
  };

  // Paste Attack Plan
  btnPasteAttackPlan.onclick = function pasteAttackPlan() {
    const text = prompt('Paste your attack plan (ASCII or copied from HTML table):');
    if (!text) return;
    try {
      attackPlanGroups = parseAttackPlan(text);
      if (!Object.keys(attackPlanGroups).length) { showMessage('No valid groups found in attack plan'); return; }
      createGroupButtons();
      showMessage('Loaded ' + Object.keys(attackPlanGroups).length + ' groups from attack plan');
    } catch (e) {
      showMessage('Error parsing attack plan: ' + e.message);
      console.error(e);
    }
  };

  /* ── Init ── */

  loadTemplates();
  refreshTemplateSelect();

  try {
    const savedRes = localStorage.getItem('tw_fake_reserves');
    if (savedRes) {
      const res = JSON.parse(savedRes);
      UNIT_TYPES.forEach(u => { if (res[u]) fakeReserveInputs[u].value = res[u]; });
    }
  } catch (e) {}

  showMessage('Rally Opener ready!');

})();
