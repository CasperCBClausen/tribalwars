/*
 * Script Name: TW High Command
 * Author: NeilB
 * Version: 2.0.0
 * Description: Batch process combat reports from overview page (Rule Compliant)
 * 
 * COMPLIANCE NOTES:
 * - This script does NOT send player names, player IDs, tribe names, or tribe IDs
 * - Only sends coordinates and battle statistics (non-identifying data)
 * - Requires manual button click to start processing
 * - Rate limited to 5 reports per second (respects server rules)
 * - Does not interact with Farm Assistant, Rally Point, or Premium Exchange
 * - Not obfuscated
 */

console.log('🎮 TW High Command v2.0 loaded!');

(function() {
    'use strict';

    const CONFIG = {
        scriptName: 'TW High Command',
        version: '2.0.0',
        author: 'NeilB',
        apiEndpoint: '',
        localStorageKey: 'twHighCommand_config',
        delayBetweenReports: 200 // 5 reports/second = 200ms delay
    };

    // Load/save configuration
    function loadConfig() {
        const saved = localStorage.getItem(CONFIG.localStorageKey);
        if (saved) {
            try {
                CONFIG.apiEndpoint = JSON.parse(saved).apiEndpoint || '';
            } catch (e) {}
        }
    }

    function saveConfig() {
        localStorage.setItem(CONFIG.localStorageKey, JSON.stringify({
            apiEndpoint: CONFIG.apiEndpoint
        }));
    }

    function getWorldId() {
        const match = window.location.hostname.match(/([a-z]+\d+)/);
        return match ? match[1] : 'unknown';
    }

    function isReportsOverviewPage() {
        const params = new URLSearchParams(window.location.search);
        return params.get('screen') === 'report' && !params.get('view');
    }

    function getReportLinks() {
        const links = [];
        document.querySelectorAll('table#report_list tr').forEach(row => {
            const link = row.querySelector('a[href*="view="]');
            if (link) {
                const match = link.href.match(/view=(\d+)/);
                if (match) {
                    links.push({ reportId: match[1], url: link.href, element: row });
                }
            }
        });
        return links;
    }

    async function fetchReportData(reportUrl, reportId) {
        try {
            const response = await fetch(reportUrl);
            const html = await response.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');

            const report = {
                reportId: reportId,
                worldId: getWorldId(),
                timestamp: Date.now(),
                attackerCoords: null,
                defenderCoords: null,
                attackerTroops: {},
                defenderTroops: {},
                attackerLosses: {},
                defenderLosses: {},
                haul: { wood: 0, clay: 0, iron: 0 },
                maxHaul: 0,
                loyalty: null,
                loyaltyChange: null,
                outcome: null
            };

            const content = doc.getElementById('content_value');
            if (!content) return null;

            // Extract coordinates
            const villageLinks = content.querySelectorAll('a[href*="screen=info_village"]');
            if (villageLinks.length >= 2) {
                const attackerMatch = villageLinks[0].textContent.match(/(\d+)\|(\d+)/);
                const defenderMatch = villageLinks[1].textContent.match(/(\d+)\|(\d+)/);
                if (attackerMatch) report.attackerCoords = `${attackerMatch[1]}|${attackerMatch[2]}`;
                if (defenderMatch) report.defenderCoords = `${defenderMatch[1]}|${defenderMatch[2]}`;
            }

            // Extract loot
            const text = content.textContent;
            const haulMatch = text.match(/Haul:\s*(\d+)\/(\d+)/i);
            if (haulMatch) report.maxHaul = parseInt(haulMatch[2]);

            const woodMatch = text.match(/(\d+)\s*wood/i) || text.match(/wood"\s*\/>\s*(\d+)/i);
            const clayMatch = text.match(/(\d+)\s*clay/i) || text.match(/clay"\s*\/>\s*(\d+)/i);
            const ironMatch = text.match(/(\d+)\s*iron/i) || text.match(/iron"\s*\/>\s*(\d+)/i);
            
            if (woodMatch) report.haul.wood = parseInt(woodMatch[1]);
            if (clayMatch) report.haul.clay = parseInt(clayMatch[1]);
            if (ironMatch) report.haul.iron = parseInt(ironMatch[1]);

            // Extract loyalty
            const loyaltyMatch = text.match(/Loyalty:\s*(\d+)\s*→\s*(\d+)/i);
            if (loyaltyMatch) {
                report.loyalty = parseInt(loyaltyMatch[2]);
                report.loyaltyChange = parseInt(loyaltyMatch[1]) - parseInt(loyaltyMatch[2]);
            }

            // Determine outcome
            const lower = text.toLowerCase();
            if (lower.includes('attacker has won')) report.outcome = 'attacker_won';
            else if (lower.includes('defender has won')) report.outcome = 'defender_won';

            return report;
        } catch (error) {
            console.error(`Error fetching report ${reportId}:`, error);
            return null;
        }
    }

    async function sendReportData(reportData) {
        const response = await fetch(`${CONFIG.apiEndpoint}/api/report`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(reportData)
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
    }

    function createProgressUI() {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.8);z-index:10000;display:flex;align-items:center;justify-content:center;';

        const dialog = document.createElement('div');
        dialog.style.cssText = 'background:#f4e4bc;border:2px solid #7d510f;padding:30px;border-radius:8px;max-width:500px;width:90%;text-align:center;';

        dialog.innerHTML = `
            <h2 style="margin-top:0;color:#7d510f;">⚔️ Processing Reports</h2>
            <div style="width:100%;height:30px;background:#ddd;border-radius:15px;overflow:hidden;margin:20px 0;">
                <div id="progressFill" style="width:0%;height:100%;background:linear-gradient(90deg,#7d510f,#a0691f);transition:width 0.3s;"></div>
            </div>
            <div id="progressText" style="font-size:18px;margin:15px 0;color:#333;">Processing 0 of 0...</div>
            <div id="statsText" style="font-size:14px;color:#666;">✓ Success: 0 | ✗ Failed: 0</div>
            <button id="cancelBtn" style="margin-top:20px;padding:10px 20px;background:#dc3545;color:white;border:none;border-radius:4px;cursor:pointer;">Cancel</button>
        `;

        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        let cancelled = false;
        dialog.querySelector('#cancelBtn').onclick = () => { cancelled = true; overlay.remove(); };

        return {
            update: (processed, total, success, failed) => {
                if (cancelled) throw new Error('Cancelled');
                dialog.querySelector('#progressFill').style.width = `${(processed/total)*100}%`;
                dialog.querySelector('#progressText').textContent = `Processing ${processed} of ${total}...`;
                dialog.querySelector('#statsText').innerHTML = `✓ Success: <span style="color:#28a745;">${success}</span> | ✗ Failed: <span style="color:#dc3545;">${failed}</span>`;
            },
            complete: (success, failed) => {
                const btn = dialog.querySelector('#cancelBtn');
                btn.textContent = 'Close';
                btn.style.background = '#28a745';
                dialog.querySelector('#progressText').textContent = 'Complete!';
                dialog.querySelector('#progressText').style.color = '#28a745';
                btn.onclick = () => overlay.remove();
            }
        };
    }

    async function processAllReports(links, progressUI) {
        let processed = 0, success = 0, failed = 0;

        for (const link of links) {
            try {
                const reportData = await fetchReportData(link.url, link.reportId);
                if (reportData) {
                    await sendReportData(reportData);
                    success++;
                    link.element.style.backgroundColor = '#d4edda';
                } else {
                    failed++;
                    link.element.style.backgroundColor = '#f8d7da';
                }
            } catch (error) {
                failed++;
                link.element.style.backgroundColor = '#f8d7da';
            }

            processed++;
            progressUI.update(processed, links.length, success, failed);

            if (processed < links.length) {
                await new Promise(r => setTimeout(r, CONFIG.delayBetweenReports));
            }
        }

        progressUI.complete(success, failed);
    }

    function showSettings() {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);z-index:10000;display:flex;align-items:center;justify-content:center;';

        const dialog = document.createElement('div');
        dialog.style.cssText = 'background:#f4e4bc;border:2px solid #7d510f;padding:20px;border-radius:8px;max-width:500px;width:90%;';

        dialog.innerHTML = `
            <h2 style="margin-top:0;color:#7d510f;">⚔️ Settings</h2>
            <p style="color:#333;"><strong>Note:</strong> Only coordinates and battle stats are sent to your backend.</p>
            <label style="display:block;margin:15px 0 5px;font-weight:bold;color:#7d510f;">API Endpoint:</label>
            <input type="text" id="apiInput" value="${CONFIG.apiEndpoint}" placeholder="http://localhost:3000" style="width:100%;padding:8px;border:1px solid #7d510f;border-radius:4px;">
            <div style="margin-top:20px;text-align:right;">
                <button id="cancelBtn" style="margin-right:10px;padding:8px 16px;background:#ccc;border:none;border-radius:4px;cursor:pointer;">Cancel</button>
                <button id="saveBtn" style="padding:8px 16px;background:#7d510f;color:white;border:none;border-radius:4px;cursor:pointer;">Save</button>
            </div>
        `;

        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        dialog.querySelector('#saveBtn').onclick = () => {
            CONFIG.apiEndpoint = dialog.querySelector('#apiInput').value.trim();
            saveConfig();
            alert('Settings saved!');
            overlay.remove();
        };

        dialog.querySelector('#cancelBtn').onclick = () => overlay.remove();
        overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    }

    function createUI() {
        const reportList = document.querySelector('#report_list');
        if (!reportList) return;

        const panel = document.createElement('div');
        panel.style.cssText = 'background:#f4e4bc;border:2px solid #7d510f;padding:15px;margin-bottom:15px;border-radius:5px;';

        const reportCount = getReportLinks().length;

        panel.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:space-between;">
                <div>
                    <strong style="color:#7d510f;font-size:16px;">⚔️ TW High Command</strong>
                    <span style="color:#666;margin-left:10px;font-size:12px;">by ${CONFIG.author} | Found ${reportCount} reports</span>
                </div>
                <div>
                    <button id="settingsBtn" class="btn" style="margin-right:5px;">⚙️ Settings</button>
                    <button id="processBtn" class="btn" style="background:#7d510f;color:white;">📊 Process All Reports</button>
                </div>
            </div>
            <div style="margin-top:10px;font-size:12px;color:#666;">Rate limited to 5 reports/second. Estimated time: ${Math.ceil(reportCount/5)} seconds</div>
        `;

        reportList.parentNode.insertBefore(panel, reportList);

        panel.querySelector('#settingsBtn').onclick = showSettings;
        
        panel.querySelector('#processBtn').onclick = async () => {
            if (!CONFIG.apiEndpoint) {
                alert('Please configure your API endpoint first!');
                showSettings();
                return;
            }

            const links = getReportLinks();
            if (links.length === 0) {
                alert('No reports found.');
                return;
            }

            if (!confirm(`Process ${links.length} reports?\n\nAPI: ${CONFIG.apiEndpoint}\nTime: ~${Math.ceil(links.length/5)} seconds`)) return;

            const progressUI = createProgressUI();
            try {
                await processAllReports(links, progressUI);
            } catch (error) {
                alert('Processing stopped: ' + error.message);
            }
        };
    }

    function init() {
        loadConfig();

        if (!isReportsOverviewPage()) {
            if (confirm('⚠️ TW High Command\n\nThis script must be run from the Reports Overview page.\n\nClick OK to go there now.')) {
                window.location.href = 'game.php?screen=report';
            }
            return;
        }

        if (!CONFIG.apiEndpoint) {
            const endpoint = prompt('🎮 TW High Command - Setup\n\nEnter your API endpoint URL:', 'http://localhost:3000');
            if (endpoint) {
                CONFIG.apiEndpoint = endpoint.trim();
                saveConfig();
            }
        }

        createUI();
        console.log(`[${CONFIG.scriptName} v${CONFIG.version}] Ready. Found ${getReportLinks().length} reports.`);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
