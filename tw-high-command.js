/*
 * Script Name: TW High Command
 * Author: NeilB
 * Version: 1.0.0
 * Description: Track and analyze combat reports with external database storage (Rule Compliant)
 * 
 * COMPLIANCE NOTES:
 * - This script does NOT send player names, player IDs, tribe names, or tribe IDs to external servers
 * - Only sends village coordinates and battle statistics (non-identifying data)
 * - Requires manual user action (button click) to send data
 * - Does not interact with Farm Assistant
 * - Does not auto-send attacks or interact with rally point buttons
 * - Does not exceed action limitations
 * - Not obfuscated
 */

(function() {
    'use strict';

    // Configuration
    const CONFIG = {
        scriptName: 'TW High Command',
        version: '1.0.0',
        author: 'NeilB',
        apiEndpoint: '', // User must configure this
        localStorageKey: 'twHighCommand_config'
    };

    // Load user configuration
    function loadConfig() {
        const saved = localStorage.getItem(CONFIG.localStorageKey);
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                CONFIG.apiEndpoint = parsed.apiEndpoint || '';
            } catch (e) {
                console.error('Failed to load config:', e);
            }
        }
    }

    // Save user configuration
    function saveConfig() {
        const config = {
            apiEndpoint: CONFIG.apiEndpoint
        };
        localStorage.setItem(CONFIG.localStorageKey, JSON.stringify(config));
    }

    // Extract world ID from current URL
    function getWorldId() {
        const match = window.location.hostname.match(/([a-z]+\d+)/);
        return match ? match[1] : 'unknown';
    }

    // Extract report data from the page (ONLY non-identifying data)
    function extractReportData() {
        // Verify we're on a report page
        if (!window.location.href.includes('screen=report')) {
            return null;
        }

        const urlParams = new URLSearchParams(window.location.search);
        const reportId = urlParams.get('view');
        
        if (!reportId) {
            return null;
        }

        const report = {
            // Safe to send - not identifying
            reportId: reportId,
            worldId: getWorldId(),
            timestamp: Date.now(),
            
            // Coordinates only (PUBLIC data from map)
            attackerCoords: null,
            defenderCoords: null,
            
            // Battle data (non-identifying)
            attackerTroops: {},
            defenderTroops: {},
            attackerLosses: {},
            defenderLosses: {},
            attackerSurvivors: {},
            defenderSurvivors: {},
            
            // Results (non-identifying)
            haul: { wood: 0, clay: 0, iron: 0 },
            maxHaul: 0,
            loyalty: null,
            loyaltyChange: null,
            morale: null,
            luck: null,
            outcome: null,
            espionageLevel: null
        };

        try {
            // Extract attacker village coordinates
            const contentValue = document.getElementById('content_value');
            if (!contentValue) return null;

            // Find coordinate links - these are public information
            const villageLinks = contentValue.querySelectorAll('a[href*="screen=info_village"]');
            
            if (villageLinks.length >= 2) {
                // First is attacker, second is defender
                const attackerMatch = villageLinks[0].textContent.match(/(\d+)\|(\d+)/);
                const defenderMatch = villageLinks[1].textContent.match(/(\d+)\|(\d+)/);
                
                if (attackerMatch) report.attackerCoords = `${attackerMatch[1]}|${attackerMatch[2]}`;
                if (defenderMatch) report.defenderCoords = `${defenderMatch[1]}|${defenderMatch[2]}`;
            }

            // Extract troop data from tables
            const unitTypes = ['spear', 'sword', 'axe', 'archer', 'spy', 'light', 'marcher', 'heavy', 'ram', 'catapult', 'knight', 'snob'];
            
            // Find attacker and defender unit rows
            const tables = contentValue.querySelectorAll('table.vis');
            
            tables.forEach(table => {
                const headerRow = table.querySelector('tr:first-child');
                if (!headerRow) return;
                
                const headerText = headerRow.textContent.toLowerCase();
                
                // Determine if this is attacker or defender table
                const isAttacker = headerText.includes('attacker') || table.querySelector('.attack_label');
                const isDefender = headerText.includes('defender') || table.querySelector('.defense_label');
                
                if (!isAttacker && !isDefender) return;
                
                // Parse unit rows
                const unitRows = table.querySelectorAll('tr');
                unitRows.forEach(row => {
                    const cells = Array.from(row.querySelectorAll('td'));
                    
                    cells.forEach((cell, idx) => {
                        const unitImg = cell.querySelector('img');
                        if (!unitImg) return;
                        
                        // Determine unit type from image
                        const unitType = unitTypes.find(type => unitImg.src.includes(type));
                        if (!unitType) return;
                        
                        // Get count from next cell
                        const countCell = cells[idx + 1];
                        if (!countCell) return;
                        
                        const count = parseInt(countCell.textContent.replace(/\D/g, '')) || 0;
                        
                        // Store in appropriate object
                        if (row.textContent.toLowerCase().includes('quantity') || row.textContent.toLowerCase().includes('actual')) {
                            if (isAttacker) report.attackerTroops[unitType] = count;
                            if (isDefender) report.defenderTroops[unitType] = count;
                        } else if (row.textContent.toLowerCase().includes('losses')) {
                            if (isAttacker) report.attackerLosses[unitType] = count;
                            if (isDefender) report.defenderLosses[unitType] = count;
                        }
                    });
                });
            });

            // Calculate survivors
            for (const unit in report.attackerTroops) {
                report.attackerSurvivors[unit] = 
                    (report.attackerTroops[unit] || 0) - (report.attackerLosses[unit] || 0);
            }
            for (const unit in report.defenderTroops) {
                report.defenderSurvivors[unit] = 
                    (report.defenderTroops[unit] || 0) - (report.defenderLosses[unit] || 0);
            }

            // Extract haul/loot
            const haulText = contentValue.textContent;
            const haulMatch = haulText.match(/Haul:\s*(\d+)\/(\d+)/i);
            if (haulMatch) {
                report.maxHaul = parseInt(haulMatch[2]);
            }

            // Extract individual resources
            const woodMatch = haulText.match(/(\d+)\s*wood/i) || haulText.match(/wood"\s*\/>\s*(\d+)/i);
            const clayMatch = haulText.match(/(\d+)\s*clay/i) || haulText.match(/clay"\s*\/>\s*(\d+)/i);
            const ironMatch = haulText.match(/(\d+)\s*iron/i) || haulText.match(/iron"\s*\/>\s*(\d+)/i);
            
            if (woodMatch) report.haul.wood = parseInt(woodMatch[1]);
            if (clayMatch) report.haul.clay = parseInt(clayMatch[1]);
            if (ironMatch) report.haul.iron = parseInt(ironMatch[1]);

            // Extract loyalty
            const loyaltyMatch = haulText.match(/Loyalty:\s*(\d+)\s*→\s*(\d+)/i);
            if (loyaltyMatch) {
                const before = parseInt(loyaltyMatch[1]);
                const after = parseInt(loyaltyMatch[2]);
                report.loyalty = after;
                report.loyaltyChange = before - after;
            }

            // Extract morale and luck
            const moraleMatch = haulText.match(/Morale:\s*(\d+)%/i);
            const luckMatch = haulText.match(/Luck:\s*([-\d.]+)%/i);
            
            if (moraleMatch) report.morale = parseInt(moraleMatch[1]);
            if (luckMatch) report.luck = parseFloat(luckMatch[1]);

            // Determine outcome
            const bodyText = contentValue.textContent.toLowerCase();
            if (bodyText.includes('the attacker has won') || bodyText.includes('won')) {
                report.outcome = 'attacker_won';
            } else if (bodyText.includes('the defender has won') || bodyText.includes('lost')) {
                report.outcome = 'defender_won';
            } else if (bodyText.includes('both sides')) {
                report.outcome = 'draw';
            }

            // Check if espionage report
            if (bodyText.includes('espionage') || bodyText.includes('scout')) {
                report.espionageLevel = bodyText.includes('resources') ? 'resources' : 'basic';
            }

            return report;

        } catch (error) {
            console.error('[TW High Command] Error extracting report:', error);
            return null;
        }
    }

    // Send report data to backend API
    async function sendReportData(reportData) {
        if (!CONFIG.apiEndpoint) {
            alert('Please configure your API endpoint first!\n\nGo to Settings to set up TW High Command.');
            return false;
        }

        if (!reportData || !reportData.attackerCoords || !reportData.defenderCoords) {
            alert('Could not extract complete report data. Please ensure you are viewing a valid combat report.');
            return false;
        }

        try {
            const response = await fetch(`${CONFIG.apiEndpoint}/api/report`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(reportData)
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const result = await response.json();
            return result;

        } catch (error) {
            console.error('[TW High Command] Failed to send report:', error);
            throw error;
        }
    }

    // Create settings dialog
    function showSettings() {
        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.7);
            z-index: 10000;
            display: flex;
            align-items: center;
            justify-content: center;
        `;

        const dialog = document.createElement('div');
        dialog.style.cssText = `
            background: #f4e4bc;
            border: 2px solid #7d510f;
            padding: 20px;
            border-radius: 8px;
            max-width: 500px;
            width: 90%;
        `;

        dialog.innerHTML = `
            <h2 style="margin-top: 0; color: #7d510f;">⚔️ TW High Command Settings</h2>
            <p style="margin: 10px 0; color: #333;">
                <strong>Note:</strong> This script only sends coordinates and battle statistics to your backend.
                Player names and IDs are added by your backend using villages.txt.
            </p>
            
            <label style="display: block; margin: 15px 0 5px; font-weight: bold; color: #7d510f;">
                API Endpoint:
            </label>
            <input type="text" id="apiEndpointInput" 
                   value="${CONFIG.apiEndpoint}" 
                   placeholder="https://your-api.vercel.app"
                   style="width: 100%; padding: 8px; border: 1px solid #7d510f; border-radius: 4px;">
            
            <div style="margin-top: 20px; text-align: right;">
                <button id="cancelBtn" style="margin-right: 10px; padding: 8px 16px; background: #ccc; border: none; border-radius: 4px; cursor: pointer;">
                    Cancel
                </button>
                <button id="saveBtn" style="padding: 8px 16px; background: #7d510f; color: white; border: none; border-radius: 4px; cursor: pointer;">
                    Save
                </button>
            </div>
        `;

        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        // Event listeners
        document.getElementById('saveBtn').onclick = () => {
            CONFIG.apiEndpoint = document.getElementById('apiEndpointInput').value.trim();
            saveConfig();
            alert('Settings saved!');
            overlay.remove();
        };

        document.getElementById('cancelBtn').onclick = () => {
            overlay.remove();
        };

        overlay.onclick = (e) => {
            if (e.target === overlay) {
                overlay.remove();
            }
        };
    }

    // Create UI elements
    function createUI() {
        // Only show UI on report pages
        if (!window.location.href.includes('screen=report')) {
            return;
        }

        const reportHeader = document.querySelector('#content_value h2');
        if (!reportHeader) return;

        // Create button container
        const buttonContainer = document.createElement('div');
        buttonContainer.style.cssText = 'display: inline-block; margin-left: 15px;';

        // Save Report button
        const saveButton = document.createElement('button');
        saveButton.textContent = '📊 Save to High Command';
        saveButton.className = 'btn';
        saveButton.style.cssText = 'margin-right: 5px;';
        saveButton.onclick = async function() {
            this.disabled = true;
            this.textContent = '⏳ Saving...';
            
            try {
                const reportData = extractReportData();
                
                if (!reportData) {
                    alert('Could not extract report data. Please ensure this is a valid combat report.');
                    return;
                }

                const result = await sendReportData(reportData);
                
                if (result && result.success) {
                    this.textContent = '✓ Saved!';
                    this.style.background = '#28a745';
                    
                    // Show enriched player names if available
                    if (result.enriched) {
                        setTimeout(() => {
                            alert(`Report saved!\n\nAttacker: ${result.enriched.attackerPlayer}\nDefender: ${result.enriched.defenderPlayer}`);
                        }, 200);
                    }
                    
                    setTimeout(() => {
                        this.textContent = '📊 Save to High Command';
                        this.style.background = '';
                        this.disabled = false;
                    }, 2000);
                } else {
                    throw new Error('Failed to save report');
                }
                
            } catch (error) {
                alert(`Failed to save report:\n${error.message}\n\nPlease check your API endpoint in Settings.`);
                this.textContent = '❌ Failed';
                this.style.background = '#dc3545';
                
                setTimeout(() => {
                    this.textContent = '📊 Save to High Command';
                    this.style.background = '';
                    this.disabled = false;
                }, 2000);
            }
        };

        // Settings button
        const settingsButton = document.createElement('button');
        settingsButton.textContent = '⚙️ Settings';
        settingsButton.className = 'btn';
        settingsButton.onclick = showSettings;

        buttonContainer.appendChild(saveButton);
        buttonContainer.appendChild(settingsButton);
        reportHeader.appendChild(buttonContainer);
    }

    // Initialize script
    function init() {
        loadConfig();
        
        // Prompt for API endpoint on first run
        if (!CONFIG.apiEndpoint) {
            const endpoint = prompt(
                '🎮 TW High Command - First Time Setup\n\n' +
                'Enter your API endpoint URL:\n' +
                '(e.g., http://localhost:3000 for local setup)\n\n' +
                'You can change this later in Settings.',
                'http://localhost:3000'
            );
            
            if (endpoint) {
                CONFIG.apiEndpoint = endpoint.trim();
                saveConfig();
                alert('✓ API endpoint saved!\n\nYou can now save reports to your database.');
            }
        }
        
        createUI();
        
        console.log(`[${CONFIG.scriptName} v${CONFIG.version}] Loaded by ${CONFIG.author}`);
        console.log(`[TW High Command] API endpoint: ${CONFIG.apiEndpoint || 'Not configured'}`);
    }

    // Wait for page load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
