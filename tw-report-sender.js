/*
 * Script Name: TW Report Sender
 * Author: NeilB
 * Version: 2.1.0
 * Description: Batch process combat reports from overview page (Rule Compliant)
 * 
 * API ENDPOINT:
 * Configure the full endpoint URL where reports should be sent.
 * 
 * Examples:
 * - http://localhost:3000/api/report
 * - https://your-domain.com/tw/reports
 * - http://192.168.1.100:8080/receive
 * 
 * The script will POST JSON data to whatever URL you specify.
 * 
 * COMPLIANCE NOTES:
 * - This script does NOT send player names, player IDs, tribe names, or tribe IDs
 * - Only sends coordinates and battle statistics (non-identifying data)
 * - Requires manual button click to start processing
 * - Rate limited to 5 reports per second (respects server rules)
 * - Allows stopping for bot detection
 * - Not obfuscated
 */

console.log('🎮 TW Report Sender v2.1 loaded!');

(function() {
    'use strict';

    const CONFIG = {
        scriptName: 'TW Report Sender',
        version: '2.1.0',
        author: 'NeilB',
        apiEndpoint: '',
        localStorageKey: 'twReportSender_config',
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
                row.style.display = 'none'; // Hide non-village reports
                return;
            }

            row.style.display = ''; // Ensure visible

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
                
                // Forward information
                forwardedOn: null,
                forwardedBy: null,
                
                // Battle modifiers
                morale: null,
                luck: null,
                
                // Military info
                attackerTroops: {},
                defenderTroops: {},
                attackerLosses: {},
                defenderLosses: {},
                defenderUnitsAway: {}, // Units outside village during scout
                
                // Scout/spy info
                buildingLevels: {}, // headquarters, barracks, stable, etc.
                resources: { wood: null, clay: null, iron: null },
                relic: null, // Relic level if scouted
                
                // Combat results
                haul: { wood: 0, clay: 0, iron: 0 },
                maxHaul: 0,
                loyalty: null,
                loyaltyChange: null,
                outcome: null,
                
                // Building/Wall damage
                wallBefore: null,
                wallAfter: null,
                buildingDamaged: null,
                buildingLevelBefore: null,
                buildingLevelAfter: null,
                
                // Paladin XP
                paladinName: null,
                paladinXP: null
            };

            const content = doc.getElementById('content_value');
            if (!content) return null;

            const text = content.textContent.toLowerCase();
            const fullHTML = content.innerHTML;

            // Extract report timestamp - battle time from the report
            let reportTimestamp = null;
            
            // Look for "Battle time" row in table
            const tables = content.querySelectorAll('table.vis');
            
            for (const table of tables) {
                const rows = table.querySelectorAll('tr');
                for (const row of rows) {
                    const cells = row.querySelectorAll('td');
                    if (cells.length === 2) {
                        const label = cells[0].textContent.trim().toLowerCase();
                        
                        if (label === 'battle time') {
                            const dateText = cells[1].textContent.trim();
                            
                            // Format: "Jan 28, 2026  00:47:45:749" or "Jan 28, 2026  00:47:45"
                            const dateMatch = dateText.match(/(\w+)\s+(\d+),\s+(\d+)\s+(\d+):(\d+):(\d+)/);
                            if (dateMatch) {
                                const [, monthStr, day, year, hour, min, sec] = dateMatch;
                                
                                const months = {
                                    'jan': 0, 'feb': 1, 'mar': 2, 'apr': 3, 'may': 4, 'jun': 5,
                                    'jul': 6, 'aug': 7, 'sep': 8, 'oct': 9, 'nov': 10, 'dec': 11
                                };
                                const month = months[monthStr.toLowerCase()];
                                if (month !== undefined) {
                                    reportTimestamp = new Date(year, month, day, hour, min, sec).getTime();
                                    break;
                                }
                            }
                        }
                    }
                }
                if (reportTimestamp) break;
            }
            
            report.reportTimestamp = reportTimestamp;

            // Determine report type from the outcome header (like in-game)
            // Look for <h3> tags which contain the battle result
            const outcomeHeaders = content.querySelectorAll('h3');
            let reportType = 'unknown';
            
            outcomeHeaders.forEach(h3 => {
                const headerText = h3.textContent.toLowerCase().trim();
                
                if (headerText.includes('has won') || headerText.includes('won')) {
                    if (headerText.includes('attacker')) {
                        reportType = 'attack_won';
                    } else if (headerText.includes('defender')) {
                        reportType = 'defense_won';
                    }
                } else if (headerText.includes('defeated')) {
                    reportType = 'defeated';
                } else if (headerText.includes('support')) {
                    reportType = 'support';
                }
            });
            
            // Check if it's a scout report (has espionage section)
            const hasEspionageSection = content.querySelector('#attack_spy_resources, #attack_spy_buildings_left, #attack_spy_away');
            if (hasEspionageSection) {
                // Scout with combat result
                if (reportType.includes('won') || reportType === 'defeated') {
                    reportType = 'scout_' + reportType;
                } else {
                    reportType = 'scout';
                }
            }
            
            report.reportType = reportType;

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

            // Extract building levels (from scout reports) - look in specific building tables
            const buildingTables = content.querySelectorAll('table#attack_spy_buildings_left, table#attack_spy_buildings_right');
            buildingTables.forEach(table => {
                const rows = table.querySelectorAll('tr');
                rows.forEach(row => {
                    const cells = row.querySelectorAll('td');
                    if (cells.length >= 2) {
                        const buildingText = cells[0].textContent.trim().toLowerCase();
                        const levelText = cells[1].textContent.trim();
                        const levelMatch = levelText.match(/^\d+$/); // Only pure numbers
                        
                        if (levelMatch && (
                            buildingText.includes('headquarters') ||
                            buildingText.includes('barracks') ||
                            buildingText.includes('stable') ||
                            buildingText.includes('workshop') ||
                            buildingText.includes('academy') ||
                            buildingText.includes('smithy') ||
                            buildingText.includes('rally') ||
                            buildingText.includes('statue') ||
                            buildingText.includes('market') ||
                            buildingText.includes('timber') ||
                            buildingText.includes('clay') ||
                            buildingText.includes('iron') ||
                            buildingText.includes('farm') ||
                            buildingText.includes('warehouse') ||
                            buildingText.includes('storage') ||
                            buildingText.includes('hiding') ||
                            buildingText.includes('wall')
                        )) {
                            // Clean up building name
                            const cleanName = buildingText
                                .replace(/\s+/g, '_')
                                .replace(/[^a-z_]/g, '')
                                .substring(0, 30); // Limit length
                            report.buildingLevels[cleanName] = parseInt(levelText);
                        }
                    }
                });
            });

            // Extract resources (from scout reports)
            const resourceMatch = content.innerHTML.match(/wood"\s*\/>\s*([\d.]+)/i);
            const clayMatch = content.innerHTML.match(/clay"\s*\/>\s*([\d.]+)/i);
            const ironMatch = content.innerHTML.match(/iron"\s*\/>\s*([\d.]+)/i);
            
            if (resourceMatch) report.resources.wood = parseInt(resourceMatch[1].replace(/\D/g, ''));
            if (clayMatch) report.resources.clay = parseInt(clayMatch[1].replace(/\D/g, ''));
            if (ironMatch) report.resources.iron = parseInt(ironMatch[1].replace(/\D/g, ''));

            // Extract morale and luck
            const moraleMatch = text.match(/morale:\s*(\d+)%/i);
            if (moraleMatch) report.morale = parseInt(moraleMatch[1]);
            
            const luckMatch = text.match(/luck[^\d]*([-\d.]+)%/i);
            if (luckMatch) report.luck = parseFloat(luckMatch[1]);
            
            // Extract forwarded information
            const forwardedOnMatch = text.match(/forwarded on:\s*([^<\n]+)/i);
            if (forwardedOnMatch) report.forwardedOn = forwardedOnMatch[1].trim();
            
            const forwardedByMatch = content.innerHTML.match(/forwarded by:.*?<a[^>]*>([^<]+)<\/a>/i);
            if (forwardedByMatch) report.forwardedBy = forwardedByMatch[1].trim();
            
            // Extract units away (from scout reports showing units outside village)
            // These should be stored as defender losses since they represent troops not in village
            const unitsAwayTable = content.querySelector('#attack_spy_away table.vis');
            if (unitsAwayTable) {
                const awayRows = Array.from(unitsAwayTable.querySelectorAll('tr'));
                if (awayRows.length >= 2) {
                    const cells = Array.from(awayRows[1].querySelectorAll('td'));
                    const unitTypes = ['spear', 'sword', 'axe', 'archer', 'spy', 'light', 'marcher', 'heavy', 'ram', 'catapult', 'knight', 'snob'];
                    
                    // Store in defenderLosses since these troops are away (not available for defense)
                    cells.forEach((cell, idx) => {
                        const count = parseInt(cell.textContent.replace(/\D/g, '')) || 0;
                        if (count > 0 && idx < unitTypes.length) {
                            report.defenderLosses[unitTypes[idx]] = (report.defenderLosses[unitTypes[idx]] || 0) + count;
                        }
                    });
                }
            }
            
            // Extract relic information (if scouted)
            // Qualities: Shoddy, Basic, Enhanced, Superior, Renowned
            // Types: Halberd, Longsword, Greataxe, Longbow, Shortspear, Shortbow, Banner, Bonfire, Morningstar, Dummy, Horseshoe, Wheel, Backpack, Chisel, Axe, Pickaxe, Telescope, Bell
            const relicDiv = content.querySelector('[class*="relic-quality-"]');
            if (relicDiv) {
                // Get the text content which includes relic name
                const relicText = relicDiv.textContent.trim();
                // Clean up the text (remove extra spaces)
                report.relic = relicText.replace(/\s+/g, ' ');
            } else {
                // Fallback: try to find "Relic scouted:" in HTML
                const relicMatch = fullHTML.match(/Relic scouted:.*?<div[^>]*>(.*?)<\/div>/is);
                if (relicMatch) {
                    const relicHTML = relicMatch[1];
                    // Extract just the text, removing HTML tags
                    const relicText = relicHTML.replace(/<[^>]*>/g, '').trim();
                    report.relic = relicText.replace(/\s+/g, ' ');
                }
            }

            // Extract troops (from combat and scout reports)
            const unitTypes = ['spear', 'sword', 'axe', 'archer', 'spy', 'light', 'marcher', 'heavy', 'ram', 'catapult', 'knight', 'snob', 'militia'];
            
            // Find troop tables - they have specific structure with unit icons
            const troopTables = content.querySelectorAll('table');
            troopTables.forEach(table => {
                const tableHTML = table.innerHTML.toLowerCase();
                
                // Skip if no unit images
                if (!tableHTML.includes('unit_')) return;
                
                // Determine if this is attacker or defender table
                let isAttackerTable = false;
                let isDefenderTable = false;
                
                // Check table ID first
                const tableId = table.id || '';
                if (tableId.includes('att')) isAttackerTable = true;
                if (tableId.includes('def')) isDefenderTable = true;
                
                // Check headers
                if (!isAttackerTable && !isDefenderTable) {
                    const headers = table.querySelectorAll('th');
                    headers.forEach(th => {
                        const text = th.textContent.toLowerCase();
                        if (text.includes('attacker')) isAttackerTable = true;
                        if (text.includes('defender')) isDefenderTable = true;
                    });
                }
                
                // Skip if we can't determine which table this is
                if (!isAttackerTable && !isDefenderTable) return;
                
                const rows = Array.from(table.querySelectorAll('tr'));
                
                // Find header row with unit images and build column mapping
                let headerRowIdx = -1;
                let unitColumns = []; // [{idx, unitType}]
                
                rows.forEach((row, rowIdx) => {
                    const cells = Array.from(row.querySelectorAll('th, td'));
                    
                    // Check if this row has unit icons
                    let hasUnitIcons = false;
                    cells.forEach(cell => {
                        const link = cell.querySelector('a.unit_link');
                        if (link && link.hasAttribute('data-unit')) {
                            hasUnitIcons = true;
                        }
                    });
                    
                    if (hasUnitIcons && headerRowIdx === -1) {
                        headerRowIdx = rowIdx;
                        
                        // Build column mapping using data-unit attribute
                        cells.forEach((cell, cellPos) => {
                            const link = cell.querySelector('a.unit_link');
                            if (link) {
                                const unitType = link.getAttribute('data-unit');
                                if (unitType && unitTypes.includes(unitType)) {
                                    unitColumns.push({idx: cellPos, unitType});
                                }
                            }
                        });
                    }
                });
                
                if (headerRowIdx === -1 || unitColumns.length === 0) return;
                
                // Parse data rows after header
                for (let i = headerRowIdx + 1; i < rows.length && i < headerRowIdx + 4; i++) {
                    const dataRow = rows[i];
                    const dataCells = Array.from(dataRow.querySelectorAll('td'));
                    const rowText = dataRow.textContent.toLowerCase();
                    
                    // Determine what type of data this row contains
                    const isQuantity = rowText.includes('quantity') || rowText.includes('actual');
                    const isLosses = rowText.includes('losses') || rowText.includes('lost');
                    
                    if (!isQuantity && !isLosses) continue;
                    
                    // Determine if this specific row is for attacker or defender
                    const rowIsAttacker = rowText.includes('attacker');
                    const rowIsDefender = rowText.includes('defender');
                    
                    unitColumns.forEach(({idx, unitType}) => {
                        if (dataCells[idx]) {
                            const value = parseInt(dataCells[idx].textContent.replace(/\D/g, '')) || 0;
                            
                            // Decision logic for which side this data belongs to
                            // Priority: table ID > row text
                            if (isAttackerTable) {
                                // Table is marked as attacker table
                                if (isQuantity) report.attackerTroops[unitType] = value;
                                if (isLosses) report.attackerLosses[unitType] = value;
                            } else if (isDefenderTable) {
                                // Table is marked as defender table
                                if (isQuantity) report.defenderTroops[unitType] = value;
                                if (isLosses) report.defenderLosses[unitType] = value;
                            } else {
                                // Table not clearly marked - use row text
                                if (rowIsAttacker) {
                                    if (isQuantity) report.attackerTroops[unitType] = value;
                                    if (isLosses) report.attackerLosses[unitType] = value;
                                } else if (rowIsDefender) {
                                    if (isQuantity) report.defenderTroops[unitType] = value;
                                    if (isLosses) report.defenderLosses[unitType] = value;
                                }
                            }
                        }
                    });
                }
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

            // Extract wall damage
            const wallMatch = fullHTML.match(/Wall has been damaged and downgraded from level\s+<b>(\d+)<\/b>\s+to level\s+<b>(\d+)<\/b>/i);
            if (wallMatch) {
                report.wallBefore = parseInt(wallMatch[1]);
                report.wallAfter = parseInt(wallMatch[2]);
            }
            
            // Extract building damage (not wall)
            const buildingMatch = fullHTML.match(/The\s+([\w\s]+)\s+has been damaged and downgraded from level\s+<b>(\d+)<\/b>\s+to level\s+<b>(\d+)<\/b>/i);
            if (buildingMatch && !buildingMatch[1].toLowerCase().includes('wall')) {
                report.buildingDamaged = buildingMatch[1].trim();
                report.buildingLevelBefore = parseInt(buildingMatch[2]);
                report.buildingLevelAfter = parseInt(buildingMatch[3]);
            }
            
            // Extract paladin XP - look for the paladin table
            const paladinXPMatch = fullHTML.match(/<img[^>]*unit_knight[^>]*[^>]*>\s*([^<]+)<\/th>\s*<td[^>]*>\s*<img[^>]*>\s*([\d,.]+)\s*XP/is);
            if (paladinXPMatch) {
                report.paladinName = paladinXPMatch[1].trim();
                report.paladinXP = parseInt(paladinXPMatch[2].replace(/[,.\s]/g, ''));
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
        // POST to the configured endpoint
        const response = await fetch(CONFIG.apiEndpoint, {
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

            // Mark row as processing with visible indicator
            link.row.style.backgroundColor = '#fff3cd';
            link.row.style.border = '2px solid #ffa726';
            
            // Add processing indicator text to the row
            const firstCell = link.row.querySelector('td');
            if (firstCell) {
                const originalContent = firstCell.innerHTML;
                firstCell.innerHTML = '⏳ Processing... ' + originalContent;
                link.row.originalContent = originalContent;
            }
            
            try {
                const reportData = await fetchReportData(link.url, link.reportId);
                
                if (reportData && reportData.defenderCoords) {
                    await sendReportData(reportData);
                    success++;
                    link.row.style.backgroundColor = '#d4edda';
                    link.row.style.border = '2px solid #28a745';
                    if (firstCell && link.row.originalContent) {
                        firstCell.innerHTML = '✓ ' + link.row.originalContent;
                    }
                    link.processed = true;
                } else {
                    failed++;
                    link.row.style.backgroundColor = '#f8d7da';
                    link.row.style.border = '2px solid #dc3545';
                    if (firstCell && link.row.originalContent) {
                        firstCell.innerHTML = '✗ ' + link.row.originalContent;
                    }
                }
            } catch (error) {
                console.error(`Failed to process report ${link.reportId}:`, error);
                failed++;
                link.row.style.backgroundColor = '#f8d7da';
                link.row.style.border = '2px solid #dc3545';
                if (firstCell && link.row.originalContent) {
                    firstCell.innerHTML = '✗ ' + link.row.originalContent;
                }
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
            <h2 style="margin-top:0;color:#7d510f;">⚙️ Settings</h2>
            <p style="color:#333;"><strong>Note:</strong> Only coordinates and battle stats are sent to your backend.</p>
            <label style="display:block;margin:15px 0 5px;font-weight:bold;color:#7d510f;">API Endpoint (Full URL):</label>
            <input type="text" id="apiInput" value="${CONFIG.apiEndpoint}" placeholder="http://localhost:3000/api/report" style="width:100%;padding:8px;border:1px solid #7d510f;border-radius:4px;">
            <p style="color:#666;font-size:12px;margin:5px 0 0 0;">
                Enter the complete URL where reports should be sent.<br>
                Examples:<br>
                • <code style="background:#e0d4b8;padding:2px 4px;border-radius:2px;">http://localhost:3000/api/report</code><br>
                • <code style="background:#e0d4b8;padding:2px 4px;border-radius:2px;">https://your-domain.com/tw/reports</code>
            </p>
            <div style="margin-top:20px;text-align:right;">
                <button id="cancelBtn" style="margin-right:10px;padding:8px 16px;background:#ccc;border:none;border-radius:4px;cursor:pointer;">Cancel</button>
                <button id="saveBtn" style="padding:8px 16px;background:#7d510f;color:white;border:none;border-radius:4px;cursor:pointer;">Save</button>
            </div>
        `;

        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        // Prevent clicks inside dialog from closing it
        dialog.onclick = (e) => e.stopPropagation();

        dialog.querySelector('#saveBtn').onclick = (e) => {
            e.stopPropagation();
            CONFIG.apiEndpoint = dialog.querySelector('#apiInput').value.trim();
            saveConfig();
            alert('Settings saved!');
            overlay.remove();
        };

        dialog.querySelector('#cancelBtn').onclick = (e) => {
            e.stopPropagation();
            overlay.remove();
        };

        overlay.onclick = () => overlay.remove();
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
                    <strong style="color:#7d510f;font-size:16px;">⚔️ TW Report Sender</strong>
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

        document.getElementById('settingsBtn').onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            showSettings();
            return false;
        };
        
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
            if (confirm('⚠️ TW Report Sender\n\nThis script must be run from the Reports Overview page.\n\nClick OK to go there now.')) {
                window.location.href = 'game.php?screen=report';
            }
            return;
        }

        if (!CONFIG.apiEndpoint) {
            const endpoint = prompt('🎮 TW Report Sender - Setup\n\nEnter your full API endpoint URL:\n(e.g., http://localhost:3000/api/report)', 'http://localhost:3000/api/report');
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
