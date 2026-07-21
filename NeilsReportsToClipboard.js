// Reports To Clipboard — batch export checked reports from the Reports Overview list
(function () {
  const worldMatch = location.hostname.match(/^(\w+)\.tribalwars\./);
  const world = worldMatch ? worldMatch[1] : null;

  const MONTHS = {Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
  const DELAY_MS = 200; // 5 reports/second

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

    const unitTbl = doc.getElementById(unitTblId);
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

  // Same field extraction as NeilsReportToJson.js, parameterized on a Document
  // so it can run against fetch()-ed report pages instead of only window.document.
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

    // Timestamp
    outer: for (const row of doc.querySelectorAll('tr')) {
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

    // Report type
    const h3txt = (doc.querySelector('h3')?.textContent || '').toLowerCase();
    if (h3txt) {
      r.reportType = h3txt.includes('scout') ? 'scout'
                   : h3txt.includes('attack') ? 'attack'
                   : 'combat';
    }

    // Luck
    const luckBold = doc.querySelector('#attack_luck b');
    if (luckBold) {
      const pct = parseFloat(luckBold.textContent);
      if (!isNaN(pct)) {
        r.luck = doc.querySelector('#attack_luck img[alt="Luck"]') ? pct : -pct;
      }
    }

    // Morale
    for (const h4 of doc.querySelectorAll('h4')) {
      const m = h4.textContent.match(/Morale:\s*(\d+)/);
      if (m) { r.morale = parseInt(m[1]); break; }
    }

    // Attacker / Defender
    parseParticipant(doc, r, 'attack_info_att', 'attack_info_att_units', 'attacker');
    parseParticipant(doc, r, 'attack_info_def', 'attack_info_def_units', 'defender');

    // Troops away from village
    const awayTbl = doc.getElementById('attack_spy_away');
    if (awayTbl) {
      const u = extractUnits(awayTbl);
      if (u) r.defenderTroopsAway = u;
    }

    // Buildings
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

    // Resources + relic
    const resTbl = doc.getElementById('attack_spy_resources');
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

    return clean(r);
  }

  // ── Page guard ──────────────────────────────────────────────────────────
  const reportList = document.getElementById('report_list');
  if (!reportList) {
    alert('Neils Reports To Clipboard must be run from the Reports Overview page.');
    return;
  }

  function getCheckedLinks() {
    const links = [];
    reportList.querySelectorAll('tbody tr').forEach(row => {
      const checkbox = row.querySelector('input[type="checkbox"][name^="id_"]');
      if (!checkbox || !checkbox.checked) return;
      const link = row.querySelector('a.report-link[href*="view="]');
      if (!link) return;
      const reportId = link.dataset.id || (link.href.match(/view=(\d+)/) || [])[1];
      links.push({ reportId, url: link.href, row });
    });
    return links;
  }

  // ── UI ──────────────────────────────────────────────────────────────────
  const existing = document.getElementById('neils_reports_clipboard_ui');
  if (existing) existing.remove();

  const panel = document.createElement('div');
  panel.id = 'neils_reports_clipboard_ui';
  panel.style.cssText = 'background:#f4e4bc;border:2px solid #7d510f;padding:15px;margin-bottom:15px;border-radius:5px;font-family:Arial,Helvetica,sans-serif;';
  panel.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
      <div>
        <strong style="color:#7d510f;font-size:16px;">Reports To Clipboard</strong>
        <span id="nrc_count" style="color:#666;margin-left:10px;font-size:12px;"></span>
      </div>
      <div>
        <button id="nrc_processBtn" type="button" style="padding:6px 12px;background:#7d510f;color:#fff;border:none;border-radius:4px;cursor:pointer;">Copy Selected</button>
        <button id="nrc_stopBtn" type="button" style="padding:6px 12px;background:#dc3545;color:#fff;border:none;border-radius:4px;cursor:pointer;display:none;margin-left:5px;">Stop</button>
      </div>
    </div>
    <div id="nrc_status" style="font-size:12px;color:#666;">Check reports above, then click Copy Selected.</div>
  `;
  reportList.parentNode.insertBefore(panel, reportList);

  const countEl = panel.querySelector('#nrc_count');
  const statusEl = panel.querySelector('#nrc_status');
  const processBtn = panel.querySelector('#nrc_processBtn');
  const stopBtn = panel.querySelector('#nrc_stopBtn');

  function refreshCount() {
    countEl.textContent = `${getCheckedLinks().length} selected`;
  }
  refreshCount();
  reportList.addEventListener('change', e => {
    if (e.target.matches('input[type="checkbox"]')) refreshCount();
  });

  let processing = false;

  async function processLinks(links) {
    processing = true;
    const results = [];
    let done = 0, failed = 0;

    for (const link of links) {
      if (!processing) {
        statusEl.textContent = `Stopped at ${done}/${links.length} (${failed} failed).`;
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
      statusEl.textContent = `Processing ${done}/${links.length} (${failed} failed)...`;

      if (done < links.length && processing) {
        await new Promise(r => setTimeout(r, DELAY_MS));
      }
    }

    processing = false;
    stopBtn.style.display = 'none';
    processBtn.disabled = false;
    processBtn.textContent = 'Copy Selected';

    if (!results.length) {
      statusEl.textContent = 'No reports copied.';
      return;
    }

    const json = JSON.stringify(results);
    console.log('=== Neils Reports To Clipboard ===');
    console.log(`${results.length} report(s), ${failed} failed`);
    console.log(json);

    navigator.clipboard.writeText(json).then(() => {
      statusEl.textContent = `Copied ${results.length} report${results.length !== 1 ? 's' : ''} to clipboard${failed ? ` (${failed} failed)` : ''}.`;
    }).catch(() => {
      statusEl.textContent = 'Done, but clipboard write failed — copy manually from the prompt.';
      prompt('Clipboard blocked — copy manually:', json);
    });
  }

  processBtn.onclick = async () => {
    if (processing) return;
    const links = getCheckedLinks();
    if (!links.length) {
      alert('No reports selected. Check the boxes next to the reports you want first.');
      return;
    }
    processBtn.disabled = true;
    processBtn.textContent = 'Processing...';
    stopBtn.style.display = 'inline-block';
    stopBtn.disabled = false;
    stopBtn.textContent = 'Stop';
    await processLinks(links);
  };

  stopBtn.onclick = () => {
    processing = false;
    stopBtn.disabled = true;
    stopBtn.textContent = 'Stopping...';
  };

  console.log('[Neils Reports To Clipboard] Ready. ' + getCheckedLinks().length + ' report(s) currently selected.');
})();
