/*
 * Script Name: TW High Command
 * Author: NeilB
 * Version: 2.1.0
 * Description: Batch process combat reports from overview page (Rule Compliant)
 * 
 * COMPLIANCE NOTES:
 * - This script does NOT send player names, player IDs, tribe names, or tribe IDs
 * - Only sends coordinates and battle statistics (non-identifying data)
 * - Requires manual button click to start processing
 * - Rate limited to 5 reports per second (respects server rules)
 * - Allows stopping for bot detection
 * - Not obfuscated
 */

console.log('🎮 TW High Command v2.1 loaded!');

(function() {
    'use strict';

    const CONFIG = {
        scriptName: 'TW High Command',
        version: '2.1.0',
        author: 'NeilB',
        apiEndpoint: '',
        localStorageKey: 'twHighCommand_config',
        delayBetweenReports: 200, // 5 reports/second = 200ms delay
        processing: false
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

    function getWorldDomain() {
        if (window.location.hostname.includes('.tribalwars.works')) {
            return 'tribalwars.works';
        }
        const domainMatch = window.location.hostname.match(/tribalwars\.([a-z]+)/);
        return domainMatch ? `tribalwars.${domainMatch[1]}` : 'tribalwars.net';
    }

    function isReportsOverviewPage() {
        const params = new URLSearchParams(window.location.search);
        return params.get('screen') === 'report' && !params.get('view');
    }

    function getReportLinks() {
        const links = [];
        const rows = document.querySelectorAll('table#report_list tbody tr');
        
        rows.forEach(row => {
            // Skip reports that are clearly not about villages (trades, events, etc.)
            // We want: attacks, defenses, scouts, support (if they show village info)
            const icons = row.querySelectorAll('img');
            let isVillageReport = false;
            
            // Check for village-related icons
            for (const icon of icons) {
                const src = icon.src.toLowerCase();
                // Include: attack, defense, spy/scout icons
                // Exclude: trade, support arrival (green arrow), event icons
                if (src.includes('attack') || 
                    src.includes('defense') || 
                    src.includes('spy') || 
                    src.includes('scout') ||
                    src.includes('info')) {
                    isVillageReport = true;
                    break;
                }
            }
            
            // If no specific icon found, check the report link text
            // Most village reports have coordinates in the title
            const linkText = row.textContent;
            if (linkText.match(/\d+\|\d+/)) {
                isVillageReport = true;
            }
            
            if (!isVillageReport) {
                return; // Skip non-village reports
            }

            const link = row.querySelector('a[href*="view="]');
            if (link) {
                const match = link.href.match(/view=(\d+)/);
                if (match) {
                    links.push({ 
                        reportId: match[1], 
                        url: link.href, 
                        row: row,
                        processed: false 
                    });
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
                reportTimestamp: null,
                reportType: null, // attack, defense, scout, support
                
                // Village information
                attackerCoords: null,
                defenderCoords: null,
                defenderPlayerId: null,
                defenderPlayerName: null,
                
                // Military info
                attackerTroops: {},
                defenderTroops: {},
                attackerLosses: {},
                defenderLosses: {},
                
                // Scout/spy info
                buildingLevels: {}, // headquarters, barracks, stable, etc.
                resources: { wood: null, clay: null, iron: null },
                
                // Combat results
                haul: { wood: 0, clay: 0, iron: 0 },
                maxHaul: 0,
                loyalty: null,
                loyaltyChange: null,
                outcome: null
            };

            const content = doc.getElementById('content_value');
            if (!content) return null;

            // Determine report type
            const text = content.textContent.toLowerCase();
            if (text.includes('espionage') || text.includes('scout')) {
                report.reportType = 'scout';
            } else if (text.includes('attacker')) {
                report.reportType = 'attack';
            } else if (text.includes('defender')) {
                report.reportType = 'defense';
            }

            // Extract report timestamp
            const dateRow = content.querySelector('table.vis tr:first-child td');
            if (dateRow) {
                const dateText = dateRow.textContent.trim();
                const dateMatch = dateText.match(/(\d+)\.\s+(\w+)\s+(\d+),\s+(\d+):(\d+):(\d+)/);
                
                if (dateMatch) {
                    const [, day, monthStr, year, hour, min, sec] = dateMatch;
                    const months = {
                        'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5,
                        'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11
                    };
                    const month = months[monthStr];
                    
                    if (month !== undefined) {
                        const date = new Date(year, month, day, hour, min, sec);
                        report.reportTimestamp = date.getTime();
                    }
                }
            }

            // Extract coordinates
            const villageLinks = content.querySelectorAll('a[href*="screen=info_village"]');
            if (villageLinks.length >= 1) {
                // For scouts, might only have one village (the target)
                const firstCoordMatch = villageLinks[0].textContent.match(/(\d+)\|(\d+)/);
                if (firstCoordMatch) {
                    if (villageLinks.length >= 2) {
                        report.attackerCoords = `${firstCoordMatch[1]}|${firstCoordMatch[2]}`;
                        const secondCoordMatch = villageLinks[1].textContent.match(/(\d+)\|(\d+)/);
                        if (secondCoordMatch) {
                            report.defenderCoords = `${secondCoordMatch[1]}|${secondCoordMatch[2]}`;
                        }
                    } else {
                        // Scout report - only target village
                        report.defenderCoords = `${firstCoordMatch[1]}|${firstCoordMatch[2]}`;
                    }
                }
            }

            // Extract building levels (from scout reports)
            const buildingRows = content.querySelectorAll('tr');
            buildingRows.forEach(row => {
                const cells = row.querySelectorAll('td');
                if (cells.length >= 2) {
                    const buildingName = cells[0].textContent.trim().toLowerCase();
                    const levelText = cells[1].textContent.trim();
                    const levelMatch = levelText.match(/(\d+)/);
                    
                    if (levelMatch && (
                        buildingName.includes('headquarters') ||
                        buildingName.includes('barracks') ||
                        buildingName.includes('stable') ||
                        buildingName.includes('workshop') ||
                        buildingName.includes('academy') ||
                        buildingName.includes('smithy') ||
                        buildingName.includes('rally point') ||
                        buildingName.includes('market') ||
                        buildingName.includes('timber camp') ||
                        buildingName.includes('clay pit') ||
                        buildingName.includes('iron mine') ||
                        buildingName.includes('farm') ||
                        buildingName.includes('warehouse') ||
                        buildingName.includes('hiding place') ||
                        buildingName.includes('wall')
                    )) {
                        report.buildingLevels[buildingName.replace(/\s+/g, '_')] = parseInt(levelMatch[1]);
                    }
                }
            });

            // Extract resources (from scout reports)
            const resourceMatch = content.innerHTML.match(/wood"\s*\/>\s*(\d+)/i);
            const clayMatch = content.innerHTML.match(/clay"\s*\/>\s*(\d+)/i);
            const ironMatch = content.innerHTML.match(/iron"\s*\/>\s*(\d+)/i);
            
            if (resourceMatch) report.resources.wood = parseInt(resourceMatch[1]);
            if (clayMatch) report.resources.clay = parseInt(clayMatch[1]);
            if (ironMatch) report.resources.iron = parseInt(ironMatch[1]);

            // Extract troops (visible in scout or combat reports)
            const tables = content.querySelectorAll('table.vis');
            tables.forEach(table => {
                const rows = table.querySelectorAll('tr');
                rows.forEach(row => {
                    const cells = Array.from(row.querySelectorAll('td'));
                    const unitTypes = ['spear', 'sword', 'axe', 'archer', 'spy', 'light', 'marcher', 'heavy', 'ram', 'catapult', 'knight', 'snob'];
                    
                    cells.forEach((cell, idx) => {
                        const img = cell.querySelector('img');
                        if (!img) return;
                        
                        const unitType = unitTypes.find(u => img.src.includes(u));
                        if (!unitType || !cells[idx + 1]) return;
                        
                        const count = parseInt(cells[idx + 1].textContent.replace(/\D/g, '')) || 0;
                        
                        // Try to determine if defender troops
                        if (row.textContent.toLowerCase().includes('defender') || 
                            row.textContent.toLowerCase().includes('quantity')) {
                            report.defenderTroops[unitType] = count;
                        }
                    });
                });
            });

            // Extract loot (from attack reports)
            const haulMatch = text.match(/haul:\s*(\d+)\/(\d+)/i);
            if (haulMatch) report.maxHaul = parseInt(haulMatch[2]);

            const woodLoot = text.match(/(\d+)\s*wood/i);
            const clayLoot = text.match(/(\d+)\s*clay/i);
            const ironLoot = text.match(/(\d+)\s*iron/i);
            
            if (woodLoot) report.haul.wood = parseInt(woodLoot[1]);
            if (clayLoot) report.haul.clay = parseInt(clayLoot[1]);
            if (ironLoot) report.haul.iron = parseInt(ironLoot[1]);

            // Extract loyalty
            const loyaltyMatch = text.match(/loyalty:\s*(\d+)\s*→\s*(\d+)/i);
            if (loyaltyMatch) {
                report.loyalty = parseInt(loyaltyMatch[2]);
                report.loyaltyChange = parseInt(loyaltyMatch[1]) - parseInt(loyaltyMatch[2]);
            }

            // Determine outcome
            if (text.includes('attacker has won')) report.outcome = 'attacker_won';
            else if (text.includes('defender has won')) report.outcome = 'defender_won';

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

    async function processReports(links, statusDiv) {
        CONFIG.processing = true;
        let processed = 0;
        let success = 0;
        let failed = 0;

        const stopBtn = document.getElementById('stopBtn');
        const processBtn = document.getElementById('processBtn');

        for (const link of links) {
            // Check if stopped
            if (!CONFIG.processing) {
                statusDiv.innerHTML = `⏸️ Stopped at ${processed}/${links.length} reports. ✓ Success: ${success} | ✗ Failed: ${failed}`;
                statusDiv.style.color = '#ff9800';
                break;
            }

            // Mark row as processing
            link.row.style.backgroundColor = '#fff3cd';
            
            try {
                const reportData = await fetchReportData(link.url, link.reportId);
                
                if (reportData && reportData.attackerCoords && reportData.defenderCoords) {
                    await sendReportData(reportData);
                    success++;
                    link.row.style.backgroundColor = '#d4edda';
                    link.processed = true;
                } else {
                    failed++;
                    link.row.style.backgroundColor = '#f8d7da';
                }
            } catch (error) {
                console.error(`Failed to process report ${link.reportId}:`, error);
                failed++;
                link.row.style.backgroundColor = '#f8d7da';
            }

            processed++;
            statusDiv.innerHTML = `Processing: ${processed}/${links.length} | ✓ Success: <span style="color:#28a745;">${success}</span> | ✗ Failed: <span style="color:#dc3545;">${failed}</span>`;

            // Rate limiting: 5 reports/second = 200ms delay
            if (processed < links.length && CONFIG.processing) {
                await new Promise(r => setTimeout(r, CONFIG.delayBetweenReports));
            }
        }

        if (CONFIG.processing) {
            statusDiv.innerHTML = `✅ Complete! ${processed}/${links.length} | ✓ Success: <span style="color:#28a745;">${success}</span> | ✗ Failed: <span style="color:#dc3545;">${failed}</span>`;
            statusDiv.style.color = '#28a745';
        }

        CONFIG.processing = false;
        stopBtn.style.display = 'none';
        processBtn.disabled = false;
        processBtn.textContent = '📊 Process Reports';
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

        const reportLinks = getReportLinks();
        const reportCount = reportLinks.length;

        const panel = document.createElement('div');
        panel.style.cssText = 'background:#f4e4bc;border:2px solid #7d510f;padding:15px;margin-bottom:15px;border-radius:5px;';

        panel.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
                <div>
                    <strong style="color:#7d510f;font-size:16px;">⚔️ TW High Command</strong>
                    <span style="color:#666;margin-left:10px;font-size:12px;">by ${CONFIG.author} | Found ${reportCount} village reports</span>
                </div>
                <div>
                    <button id="settingsBtn" class="btn" style="margin-right:5px;">⚙️ Settings</button>
                    <button id="processBtn" class="btn" style="background:#7d510f;color:white;">📊 Process Reports</button>
                    <button id="stopBtn" class="btn" style="background:#dc3545;color:white;display:none;margin-left:5px;">⏸️ Stop</button>
                </div>
            </div>
            <div id="statusText" style="font-size:12px;color:#666;">
                Ready. Rate limited to 5 reports/second (~${Math.ceil(reportCount/5)} seconds total). You can stop anytime for bot detection.
            </div>
        `;

        reportList.parentNode.insertBefore(panel, reportList);

        const statusDiv = document.getElementById('statusText');
        const processBtn = document.getElementById('processBtn');
        const stopBtn = document.getElementById('stopBtn');

        document.getElementById('settingsBtn').onclick = showSettings;
        
        processBtn.onclick = async () => {
            if (!CONFIG.apiEndpoint) {
                alert('Please configure your API endpoint first!');
                showSettings();
                return;
            }

            if (CONFIG.processing) return;

            const links = getReportLinks();
            if (links.length === 0) {
                alert('No village reports found on this page.');
                return;
            }

            processBtn.disabled = true;
            processBtn.textContent = '⏳ Processing...';
            stopBtn.style.display = 'inline-block';

            await processReports(links, statusDiv);
        };

        stopBtn.onclick = () => {
            CONFIG.processing = false;
            stopBtn.disabled = true;
            stopBtn.textContent = '⏸️ Stopping...';
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
        console.log(`[${CONFIG.scriptName} v${CONFIG.version}] Ready. Found ${getReportLinks().length} village reports.`);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
