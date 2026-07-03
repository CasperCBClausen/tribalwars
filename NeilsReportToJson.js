(function () {
  const worldMatch = location.hostname.match(/^(\w+)\.tribalwars\./);
  const world = worldMatch ? worldMatch[1] : null;

  const MONTHS = {Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};

  function parseTWDate(str) {
    const m = str.replace(/\s+/g,' ').trim()
      .match(/(\w{3})\s+(\d+),\s+(\d{4})\s+(\d+):(\d+):(\d+)/);
    if (!m || !(m[1] in MONTHS)) return null;
    return Date.UTC(+m[3], MONTHS[m[1]], +m[2], +m[4], +m[5], +m[6]);
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

  const r = {};
  if (world) r.world = world;

  // ── Report ID ────────────────────────────────────────────────────────────
  const urlViewM = location.search.match(/[?&]view=([^&#]+)/);
  if (urlViewM) {
    r.reportId = urlViewM[1];
  } else {
    const ridM = (document.querySelector('.no-preview a[href*="report_id="]')?.href || '')
      .match(/report_id=(\d+)/);
    if (ridM) r.reportId = ridM[1];
    else {
      const qe = document.querySelector('.quickedit[data-id]');
      if (qe?.dataset.id) r.reportId = qe.dataset.id;
    }
  }

  // ── Timestamp ────────────────────────────────────────────────────────────
  // Report page: row where first td is "Battle time", second td has the date
  // Forum preview: td starting with "Sent: DATE"
  outer: for (const row of document.querySelectorAll('tr')) {
    const cells = [...row.querySelectorAll('td')];
    if (cells.length >= 2 && /battle\s+time/i.test(cells[0].textContent)) {
      const ts = parseTWDate(cells[1].textContent);
      if (ts) { r.reportTimestamp = ts; break; }
    }
    for (const td of cells) {
      const m = td.textContent.match(/Sent:\s*(\w{3}\s+\d+,\s+\d{4}\s+\d+:\d+:\d+)/);
      if (m) {
        const ts = parseTWDate(m[1]);
        if (ts) { r.reportTimestamp = ts; break outer; }
      }
    }
  }

  // ── Report type ──────────────────────────────────────────────────────────
  const h3txt = (document.querySelector('h3')?.textContent || '').toLowerCase();
  if (h3txt) {
    r.reportType = h3txt.includes('scout') ? 'scout'
                 : h3txt.includes('attack') ? 'attack'
                 : 'combat';
  }

  // ── Luck ─────────────────────────────────────────────────────────────────
  const luckBold = document.querySelector('#attack_luck b');
  if (luckBold) {
    const pct = parseFloat(luckBold.textContent);
    if (!isNaN(pct)) {
      r.luck = document.querySelector('#attack_luck img[alt="Luck"]') ? pct : -pct;
    }
  }

  // ── Morale ───────────────────────────────────────────────────────────────
  for (const h4 of document.querySelectorAll('h4')) {
    const m = h4.textContent.match(/Morale:\s*(\d+)/);
    if (m) { r.morale = parseInt(m[1]); break; }
  }

  // ── Attacker / Defender ──────────────────────────────────────────────────
  function parseParticipant(tblId, unitTblId, pfx) {
    const tbl = document.getElementById(tblId);
    if (!tbl) return;

    const anch = tbl.querySelector('.village_anchor');
    const vid = anch ? parseInt(anch.dataset.id) : null;
    if (vid) r[pfx + 'VillageId'] = vid;

    const vLink = anch?.querySelector('a');
    if (vLink) {
      const txt = vLink.textContent || '';
      const cm = txt.match(/\((\d+)\|(\d+)\)/);
      if (cm) { r[pfx + 'X'] = parseInt(cm[1]); r[pfx + 'Y'] = parseInt(cm[2]); }
      const name = txt.replace(/\s*\(\d+\|\d+\)\s*K\d+/, '').trim();
      if (name) r[pfx + 'VillageName'] = name;
    }

    const pLink = tbl.querySelector('th a[href*="info_player"]');
    if (pLink) {
      const name = pLink.textContent?.trim();
      if (name) r[pfx + 'PlayerName'] = name;
      const pm = (pLink.getAttribute('href') || '').match(/id=(\d+)/);
      if (pm) r[pfx + 'PlayerId'] = parseInt(pm[1]);
    }

    const unitTbl = document.getElementById(unitTblId);
    if (unitTbl) {
      for (const row of unitTbl.querySelectorAll('tr')) {
        const lbl = row.querySelector('td:first-child')?.textContent?.trim() || '';
        const u = extractUnits(row);
        if (!u) continue;
        if (lbl.startsWith('Quantity')) r[pfx + 'Troops'] = u;
        else if (lbl.startsWith('Losses')) r[pfx + 'Losses'] = u;
      }
    }
  }

  parseParticipant('attack_info_att', 'attack_info_att_units', 'attacker');
  parseParticipant('attack_info_def', 'attack_info_def_units', 'defender');

  // ── Troops away from village ─────────────────────────────────────────────
  const awayTbl = document.getElementById('attack_spy_away');
  if (awayTbl) {
    const u = {};
    awayTbl.querySelectorAll('[data-unit-count]').forEach(td => {
      const cls = [...td.classList].find(c => c.startsWith('unit-item-') && c !== 'unit-item');
      if (!cls) return;
      const n = parseInt(td.dataset.unitCount) || 0;
      if (n > 0) u[cls.replace('unit-item-', '')] = n;
    });
    if (Object.keys(u).length) r.defenderTroopsAway = u;
  }

  // ── Buildings ────────────────────────────────────────────────────────────
  const bldInput = document.getElementById('attack_spy_building_data');
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

  // ── Resources + relic ────────────────────────────────────────────────────
  const resTbl = document.getElementById('attack_spy_resources');
  if (resTbl) {
    const get = title => resTbl.querySelector(`.icon[title="${title}"]`)?.closest('.nowrap');
    const parse = el => el ? parseInt(el.textContent.replace(/\D/g, '')) || 0 : 0;
    const w = get('Wood'), c = get('Clay'), ir = get('Iron');
    if (w || c || ir) r.resources = { wood: parse(w), clay: parse(c), iron: parse(ir) };
    const relicEl = resTbl.querySelector('.inline-relic');
    if (relicEl) {
      const relic = relicEl.textContent?.trim();
      if (relic) r.relic = relic;
    }
  }

  // ── Output ───────────────────────────────────────────────────────────────
  const out = clean(r);
  const found = Object.keys(out).filter(k => k !== 'world');
  console.log('=== Neils report to json ===');
  console.log(`Fields found: ${found.join(', ')}`);
  console.log(JSON.stringify(out, null, 2));

  const json = JSON.stringify(out);
  navigator.clipboard.writeText(json).then(() => {
    const n = found.length;
    const toast = document.createElement('div');
    toast.textContent = `✓ ${n} field${n !== 1 ? 's' : ''} copied`;
    toast.style.cssText = [
      'position:fixed', 'top:16px', 'right:16px',
      'background:#2a7', 'color:#fff',
      'padding:10px 18px', 'border-radius:4px',
      'z-index:999999', 'font:bold 13px sans-serif',
      'box-shadow:0 2px 8px rgba(0,0,0,.4)', 'pointer-events:none'
    ].join(';');
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  }).catch(() => {
    prompt('Clipboard blocked — copy manually:', json);
  });
})();
