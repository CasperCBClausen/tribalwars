// Rally Opener - Direct execution version (no IIFE)
if(window.__tw_helper_loaded) { console.log('Already loaded'); } else {
window.__tw_helper_loaded = true;

// Check if we're on the combined overview page
var currentUrl = window.location.href;
var isOverviewPage = currentUrl.indexOf('screen=overview_villages') !== -1 && currentUrl.indexOf('mode=combined') !== -1;

if(!isOverviewPage){
var confirmRedirect = confirm('Rally Opener works best on the Combined Village Overview page.\n\nWould you like to be redirected there now?');
if(confirmRedirect){
try{
var baseUrl = window.location.origin + window.location.pathname;
var newUrl = baseUrl + '?screen=overview_villages&mode=combined';
window.location.href = newUrl;
}catch(e){
alert('Could not redirect. Please navigate to:\nOverview → Combined → Village Overview');
}
} else {
alert('Script will continue, but unit templates may not work correctly.\n\nFor best results, use on: Overview → Combined → Village Overview');
}
}

/* --- Utilities --- */
function qs(sel,root){ root = root || document; return root.querySelector(sel); }
function el(tag,opts){ var e=document.createElement(tag); if(opts){ for(var k in opts) if(opts.hasOwnProperty(k)) e[k]=opts[k]; } return e; }
function saveVillagesText(txt){ try{ localStorage.setItem('tw_villages_txt', txt); localStorage.setItem('tw_villages_updated', String(Date.now())); }catch(e){} }
function loadVillagesText(){ try{ return localStorage.getItem('tw_villages_txt') || null; }catch(e){ return null; } }
function parseVillagesTxt(txt){
var out=[]; if(!txt) return out;
var lines = txt.split(/\r?\n/);
for(var i=0;i<lines.length;i++){
var L = lines[i];
if(!L || !L.trim) continue;
if(!L.trim()) continue;
var parts = L.split(',');
if(parts.length < 4) continue;
var id = parts[0];
var name = (parts[1]||'').replace(/\+/g,' ');
try{ name = decodeURIComponent(name); }catch(e){}
var x = parts[2] && parts[2].replace(/\D/g,'') ? Number(parts[2]) : null;
var y = parts[3] && parts[3].replace(/\D/g,'') ? Number(parts[3]) : null;
if(id && x!=null && y!=null) out.push({id:id,name:name,x:x,y:y,raw:L});
}
return out;
}
function coordKey(x,y){ return x + '|' + y; }
function buildCoordIndex(arr){
if(typeof Map !== 'undefined'){ var m=new Map(); for(var i=0;i<arr.length;i++){ var v=arr[i]; m.set(coordKey(v.x,v.y), v); } return m; }
var obj={}; for(var j=0;j<arr.length;j++){ var vv=arr[j]; obj[coordKey(vv.x,vv.y)]=vv; } return obj;
}
function lookupIndex(idx,key){ if(typeof Map !== 'undefined' && idx instanceof Map) return idx.get(key); return idx[key]; }

var msgBox;
function showMessage(msg,timeout){ 
timeout = timeout || 3000; 
if(msgBox){ 
msgBox.textContent = msg; 
if(msgBox._t) clearTimeout(msgBox._t); 
msgBox._t = setTimeout(function(){ msgBox.textContent = ''; }, timeout); 
} 
}

function tryFetchVillagesFromServer(){
var base = location.origin;
var plain = base + '/map/village.txt';
return fetch(plain).then(function(r){ 
if(!r.ok) throw new Error('Failed to fetch village.txt'); 
return r.text(); 
});
}

// Remove existing UI if present
if(document.getElementById('tw_open_tabs_ui')) {
document.getElementById('tw_open_tabs_ui').remove();
}

/* --- Build UI --- */
var container = el('div',{id:'tw_open_tabs_ui', style:'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:99999;background:#1a1a1a;color:#fff;padding:0;border-radius:8px;font-family:Arial, Helvetica, sans-serif;font-size:13px;width:880px;box-shadow:0 8px 24px rgba(0,0,0,0.8);resize:both;overflow:auto;border:2px solid #333;'});

// Create all buttons first before using them
btnDeleteTemplate.onclick = function(){
var selected = templateSelect.value;
if(!selected){
showMessage('Please select a template to delete');
return;
}
if(confirm('Delete template "' + selected + '"?')){
delete unitTemplates[selected];
saveTemplates();
if(currentTemplate === selected) currentTemplate = null;
refreshTemplateSelect();
showMessage('Template deleted');
}
};

templateSelect.onchange = function(){
currentTemplate = templateSelect.value || null;
if(currentTemplate){
showMessage('Template "' + currentTemplate + '" selected');
} else {
showMessage('No template selected');
}
};

// Load templates on start
loadTemplates();
refreshTemplateSelect();

// Function to build URL with unit template
function buildRallyUrlWithTemplate(forVillageId, targetVillageId){
var baseUrl = buildRallyUrl(forVillageId, targetVillageId);
  
if(!currentTemplate || !unitTemplates[currentTemplate]){
return baseUrl;
}
  
// Add template data to URL as a hash fragment that our script can read
var templateData = encodeURIComponent(JSON.stringify({
template: currentTemplate,
config: unitTemplates[currentTemplate]
}));
  
return baseUrl + '#twtemplate=' + templateData;
}

function parseCoordinateList(text){
if(!text) return [];
var lines = text.trim().split(/\r?\n/);
var coords = [];
for(var i=0;i<lines.length;i++){
var line = lines[i].trim();
if(!line) continue;
line = line.replace(',', '|');
if(line.match(/\d+\|\d+/)){
coords.push(line);
}
}
return coords;
}

function coordToVillageId(coord){
if(!coord) return null;
var m = coord.match(/(\d+)\|(\d+)/);
if(!m) return null;
var key = coordKey(Number(m[1]), Number(m[2]));
var v = lookupIndex(villagesIndex, key);
return v ? v.id : null;
}

function buildRallyUrl(forVillageId, targetVillageId){
try{
var u = new URL(location.href);
u.searchParams.set('screen','place');
u.searchParams.set('village', forVillageId);
u.searchParams.set('target', targetVillageId);
return u.toString();
}catch(e){
return location.origin + '/game.php?village=' + encodeURIComponent(forVillageId) + '&screen=place&target=' + encodeURIComponent(targetVillageId);
}
}

function prepareTabsFromPairs(fromCoords, toCoords){
var maxLen = Math.max(fromCoords.length, toCoords.length);
var urls = [];
var failed = [];
for(var i=0;i<maxLen;i++){
var fromCoord = fromCoords[i] || null;
var toCoord = toCoords[i] || null;
if(!fromCoord || !toCoord){ 
failed.push('Row ' + (i+1) + ': missing From or To coordinate');
continue; 
}
var fromId = coordToVillageId(fromCoord);
var toId = coordToVillageId(toCoord);
if(!fromId || !toId){ 
failed.push('Row ' + (i+1) + ': village not found for ' + fromCoord + ' -> ' + toCoord);
continue; 
}
var url = buildRallyUrlWithTemplate(fromId, toId);
urls.push(url);
}
if(urls.length === 0){
showMessage('No valid pairs found - check your coordinates');
if(failed.length > 0){
console.log('Rally Opener failures:', failed);
}
return [];
}
showMessage('Prepared ' + urls.length + ' tab' + (urls.length > 1 ? 's' : '') + ' - ready to open!');
if(failed.length > 0){
console.log('Rally Opener warnings:', failed);
}
return urls;
}

// Attack Plan functions
var attackPlanGroups = {};
var attackPlanConfig = {
defaultUrl: 'https://api.github.com/repos/CasperCBClausen/tribalwars/contents/Attackplans'
};

function loadConfig(){
try{
var saved = localStorage.getItem('tw_rally_config');
if(saved){
var config = JSON.parse(saved);
attackPlanConfig.defaultUrl = config.defaultUrl || attackPlanConfig.defaultUrl;
}
}catch(e){}
}

function saveConfig(){
try{
localStorage.setItem('tw_rally_config', JSON.stringify(attackPlanConfig));
}catch(e){}
}

loadConfig();

function parseAttackPlan(text){
console.log('Parsing attack plan, text length:', text.length);
var lines = text.split(/\r?\n/).filter(function(l){ return l.trim(); });
console.log('Lines found:', lines.length);
var groups = {};
for(var i=0;i<lines.length;i++){
var line = lines[i].trim();
if(!line || line.match(/^-+$/)) continue;
if(line.match(/Group.*From.*To/i)){
console.log('Skipping header line');
continue;
}
var parts = line.split(/\s{2,}|\t/);
console.log('Line parts:', parts);
if(parts.length < 3) continue;
var groupNum = parts[0].trim();
var fromVillage = parts[1].trim();
var toTarget = parts[2].trim();
console.log('Parsed:', groupNum, fromVillage, toTarget);
if(!groupNum.match(/^\d+$/)){
console.log('Group number invalid:', groupNum);
continue;
}
if(!fromVillage.match(/\d+\|\d+/)){
console.log('From village invalid:', fromVillage);
continue;
}
if(!toTarget.match(/\d+\|\d+/)){
console.log('To target invalid:', toTarget);
continue;
}
var launchTime = null;
if(parts.length >= 6){
var launchStr = parts[5].trim();
if(launchStr.match(/\d{4}-\d{2}-\d{2}/)){
launchTime = new Date(launchStr);
console.log('Launch time:', launchTime);
}
}
if(!groups[groupNum]){
groups[groupNum] = {
attacks: [],
launchTime: launchTime
};
}
groups[groupNum].attacks.push({
from: fromVillage,
to: toTarget
});
}
console.log('Groups parsed:', Object.keys(groups).length, groups);
return groups;
}

function parseHTMLAttackPlan(html){
var parser = new DOMParser();
var doc = parser.parseFromString(html, 'text/html');
var rows = doc.querySelectorAll('table tbody tr');
var groups = {};
for(var i=0;i<rows.length;i++){
var cells = rows[i].querySelectorAll('td');
if(cells.length < 3) continue;
var groupNum = cells[0].textContent.trim();
var fromVillage = cells[1].textContent.trim();
var toTarget = cells[2].textContent.trim();
if(!groupNum.match(/^\d+$/)) continue;
if(!fromVillage.match(/\d+\|\d+/)) continue;
if(!toTarget.match(/\d+\|\d+/)) continue;
var launchTime = null;
if(cells.length >= 6){
var launchStr = cells[5].textContent.trim();
if(launchStr.match(/\d{4}-\d{2}-\d{2}/)){
launchTime = new Date(launchStr);
}
}
if(!groups[groupNum]){
groups[groupNum] = {
attacks: [],
launchTime: launchTime
};
}
groups[groupNum].attacks.push({
from: fromVillage,
to: toTarget
});
}
return groups;
}

function createGroupButtons(){
attackPlanContainer.innerHTML = '';
attackPlanContainer.style.display = 'block';
var groupKeys = Object.keys(attackPlanGroups).sort(function(a,b){ return Number(a) - Number(b); });
for(var i=0;i<groupKeys.length;i++){
var groupNum = groupKeys[i];
var group = attackPlanGroups[groupNum];
var btnGroup = document.createElement('button');
btnGroup.className = 'group-btn';
btnGroup.dataset.group = groupNum;
btnGroup.style.cssText = 'cursor:pointer;padding:10px 20px;background:#3a5a3a;color:#fff;border:1px solid #4a7a4a;border-radius:4px;font-weight:bold;margin:5px;display:inline-block;min-width:180px;';
var attackCount = group.attacks.length;
btnGroup.innerHTML = 'Group ' + groupNum + '<br><span style="font-size:11px;">(' + attackCount + ' attack' + (attackCount > 1 ? 's' : '') + ')</span>';
if(group.launchTime){
var now = new Date();
var isExpired = group.launchTime <= now;
var countdownSpan = document.createElement('span');
countdownSpan.className = 'countdown';
countdownSpan.style.cssText = 'font-size:10px;display:block;margin-top:4px;';
if(isExpired){
countdownSpan.textContent = 'LAUNCH EXCEEDED';
countdownSpan.style.color = '#ff4444';
countdownSpan.style.fontWeight = 'bold';
} else {
countdownSpan.textContent = 'Calculating...';
countdownSpan.style.color = '#aaffaa';
}
btnGroup.appendChild(document.createElement('br'));
btnGroup.appendChild(countdownSpan);
}
btnGroup.onclick = (function(grp){
return function(){
openGroupAttacks(grp);
};
})(group);
attackPlanContainer.appendChild(btnGroup);
}
startCountdowns();
}

function startCountdowns(){
if(window._countdownInterval){
clearInterval(window._countdownInterval);
}
window._countdownInterval = setInterval(function(){
var countdowns = document.querySelectorAll('.countdown');
for(var i=0;i<countdowns.length;i++){
var btn = countdowns[i].closest('.group-btn');
if(!btn) continue;
var groupNum = btn.dataset.group;
var group = attackPlanGroups[groupNum];
if(!group || !group.launchTime) continue;
var now = new Date();
var diff = group.launchTime - now;
if(diff <= 0){
countdowns[i].textContent = 'LAUNCH EXCEEDED';
countdowns[i].style.color = '#ff4444';
countdowns[i].style.fontWeight = 'bold';
continue;
}
var hours = Math.floor(diff / 3600000);
var minutes = Math.floor((diff % 3600000) / 60000);
var seconds = Math.floor((diff % 60000) / 1000);
countdowns[i].textContent = hours + 'h ' + minutes + 'm ' + seconds + 's';
countdowns[i].style.color = '#aaffaa';
}
}, 1000);
}

function openGroupAttacks(group){
var attacks = group.attacks;
var urls = [];
for(var i=0;i<attacks.length;i++){
var fromId = coordToVillageId(attacks[i].from);
var toId = coordToVillageId(attacks[i].to);
if(!fromId || !toId){
console.log('Could not find village ID for', attacks[i].from, '->', attacks[i].to);
continue;
}
var url = buildRallyUrlWithTemplate(fromId, toId);
urls.push(url);
}
if(urls.length === 0){
showMessage('No valid attacks in this group');
return;
}
showMessage('Opening ' + urls.length + ' tabs for group...');
var delayTab = 200;
for(var j=0;j<urls.length;j++){
(function(url, idx){
window.setTimeout(function(){
window.open(url, '_blank');
console.log('Opened attack ' + (idx + 1) + ' at ' + new Date().getTime());
}, delayTab * idx);
})(urls[j], j);
}
}

// Button handlers
btnOpenTabs.onclick = function(){
console.log('Open Tabs clicked');
var fromCoords = parseCoordinateList(fromTextarea.value);
var toCoords = parseCoordinateList(toTextarea.value);
console.log('From coords:', fromCoords);
console.log('To coords:', toCoords);
if(fromCoords.length === 0 || toCoords.length === 0){ 
showMessage('Please enter coordinates in both FROM and TO columns'); 
return; 
}
var preparedUrls = prepareTabsFromPairs(fromCoords, toCoords);
console.log('PreparedUrls:', preparedUrls.length);
if(preparedUrls.length === 0){
return;
}

showMessage('Opening ' + preparedUrls.length + ' tabs...');
var delayTab = 200;
for(var j=0;j<preparedUrls.length;j++){
(function(url, idx){
window.setTimeout(function(){
window.open(url, '_blank');
console.log('Opened tab ' + (idx + 1) + ' at ' + new Date().getTime());
}, delayTab * idx);
})(preparedUrls[j], j);
}
};

btnTestData.onclick = function(){
fromTextarea.value = '524|496\n524|496\n524|496';
toTextarea.value = '523|496\n525|496\n522|495';
showMessage('Test data loaded');
};

btnPasteAttackPlan.onclick = function(){
var pasteArea = prompt('Paste your attack plan (ASCII or copied from HTML table):');
if(!pasteArea) return;
try{
attackPlanGroups = parseAttackPlan(pasteArea);
if(Object.keys(attackPlanGroups).length === 0){
showMessage('No valid groups found in attack plan');
return;
}
createGroupButtons();
showMessage('Loaded ' + Object.keys(attackPlanGroups).length + ' groups from attack plan');
}catch(e){
showMessage('Error parsing attack plan: ' + e.message);
console.error(e);
}
};

btnLoadAttackPlan.onclick = function(){
var url = attackPlanConfig.defaultUrl;
showMessage('Loading attack plans...');
fetch(url)
.then(function(r){ return r.json(); })
.then(function(files){
var htmlFiles = files.filter(function(f){ return f.name.match(/\.html$/i); });
if(htmlFiles.length === 0){
showMessage('No HTML attack plans found');
return;
}
var fileList = htmlFiles.map(function(f, idx){ return (idx+1) + '. ' + f.name; }).join('\n');
var choice = prompt('Choose an attack plan:\n\n' + fileList + '\n\nEnter number (1-' + htmlFiles.length + '):');
if(!choice) return;
var fileIdx = parseInt(choice) - 1;
if(fileIdx < 0 || fileIdx >= htmlFiles.length){
showMessage('Invalid choice');
return;
}
var selectedFile = htmlFiles[fileIdx];
showMessage('Loading ' + selectedFile.name + '...');
return fetch(selectedFile.download_url);
})
.then(function(r){ if(r) return r.text(); })
.then(function(html){
if(!html) return;
attackPlanGroups = parseHTMLAttackPlan(html);
if(Object.keys(attackPlanGroups).length === 0){
showMessage('No valid groups found in attack plan');
return;
}
createGroupButtons();
showMessage('Loaded ' + Object.keys(attackPlanGroups).length + ' groups from attack plan');
})
.catch(function(err){
showMessage('Error loading attack plan: ' + err.message);
console.error(err);
});
};

btnConfig.onclick = function(){
var newUrl = prompt('Enter the URL to fetch attack plans from:\n\nThis should be an API endpoint that returns a list of HTML files.\n\nFor GitHub: https://api.github.com/repos/USER/REPO/contents/FOLDER\nFor other services: provide the appropriate API URL\n\nCurrent URL:', attackPlanConfig.defaultUrl);
if(newUrl && newUrl.trim()){
attackPlanConfig.defaultUrl = newUrl.trim();
saveConfig();
showMessage('Config saved');
}
};

btnGet.onclick = function(){
var lastFetch = localStorage.getItem('tw_villages_updated');
var now = Date.now();
var oneHour = 60 * 60 * 1000;
if(lastFetch){
var timeSince = now - Number(lastFetch);
if(timeSince < oneHour){
var minutesLeft = Math.ceil((oneHour - timeSince) / 60000);
var confirmed = confirm('WARNING: Script rules require at least 1 hour between fetches.\n\nLast fetch: ' + Math.floor(timeSince / 60000) + ' min ago.\nWait ' + minutesLeft + ' more min.\n\nFetch anyway?');
if(!confirmed) return;
}
}
showMessage('Fetching village.txt...');
tryFetchVillagesFromServer().then(function(txt){
if(!txt) throw new Error('Empty');
saveVillagesText(txt);
villagesArr = parseVillagesTxt(txt);
villagesIndex = buildCoordIndex(villagesArr);
showMessage('village.txt saved (' + villagesArr.length + ' entries)');
}).catch(function(err){
showMessage('Failed: ' + (err && err.message ? err.message : String(err)));
});
};

showMessage('Rally Opener ready!');
}Config = el('button',{innerText:'⚙', title:'Config', style:'position:absolute;left:10px;top:50%;transform:translateY(-50%);cursor:pointer;padding:6px 10px;background:#2a2a2a;color:#fff;border:1px solid #4a4a4a;border-radius:4px;font-size:14px;z-index:10;', type:'button'});
var closeBtn = el('button',{innerText:'✕', title:'Close', style:'position:absolute;right:0;top:50%;transform:translateY(-50%);cursor:pointer;padding:4px 10px;background:#444;color:#fff;border:1px solid #666;border-radius:4px;font-size:16px;font-weight:bold;z-index:10;'});

var titleBar = el('div',{style:'cursor:move;padding:16px;background:linear-gradient(135deg, #2a2a2a 0%, #1a1a1a 100%);border-top-left-radius:6px;border-top-right-radius:6px;user-select:none;border-bottom:2px solid #444;position:relative;'});
var titleWrapper = el('div',{style:'text-align:center;position:relative;'});
var title = el('div',{style:'font-size:22px;font-weight:bold;color:#e0e0e0;text-shadow:2px 2px 4px rgba(0,0,0,0.6);letter-spacing:1px;'});
title.textContent = 'RALLY OPENER';
titleBar.appendChild(btnConfig);
titleWrapper.appendChild(title);
titleWrapper.appendChild(closeBtn);
titleBar.appendChild(titleWrapper);
container.appendChild(titleBar);

var body = el('div',{style:'padding:16px;display:block;'});
container.appendChild(body);

// Unit Templates section
var templatesSection = el('div',{style:'margin-bottom:12px;padding:12px;background:#0f0f0f;border-radius:6px;border:1px solid #333;'});
var templatesSectionTitle = el('div',{style:'font-weight:bold;margin-bottom:8px;color:#aaa;text-align:center;font-size:13px;'});
templatesSectionTitle.textContent = 'Unit Templates';
templatesSection.appendChild(templatesSectionTitle);

var templateControls = el('div',{style:'display:flex;gap:8px;margin-bottom:8px;align-items:center;justify-content:center;flex-wrap:wrap;'});
templatesSection.appendChild(templateControls);

var templateSelect = el('select',{style:'padding:6px;background:#0f0f0f;color:#fff;border:1px solid #444;border-radius:4px;min-width:150px;'});
var noneOption = el('option',{value:'', innerText:'No Template'});
templateSelect.appendChild(noneOption);
templateControls.appendChild(templateSelect);

var btnNewTemplate = el('button',{innerText:'New Template', style:'cursor:pointer;padding:6px 12px;background:#2a5a2a;color:#fff;border:1px solid #3a7a3a;border-radius:4px;font-size:12px;', type:'button'});
var btnEditTemplate = el('button',{innerText:'Edit', style:'cursor:pointer;padding:6px 12px;background:#5a5a2a;color:#fff;border:1px solid #7a7a3a;border-radius:4px;font-size:12px;', type:'button'});
var btnDeleteTemplate = el('button',{innerText:'Delete', style:'cursor:pointer;padding:6px 12px;background:#5a2a2a;color:#fff;border:1px solid #7a3a3a;border-radius:4px;font-size:12px;', type:'button'});

templateControls.appendChild(btnNewTemplate);
templateControls.appendChild(btnEditTemplate);
templateControls.appendChild(btnDeleteTemplate);

var templateInfo = el('div',{style:'font-size:11px;color:#888;text-align:center;padding:4px;'});
templateInfo.textContent = 'Select a template to auto-fill units when opening tabs';
templatesSection.appendChild(templateInfo);

body.appendChild(templatesSection);

// Rally Point Opener section with FROM/TO coordinates
var rallySection = el('div',{style:'margin-bottom:12px;padding:12px;background:#0f0f0f;border-radius:6px;border:1px solid #333;position:relative;'});
var rallySectionTitle = el('div',{style:'font-weight:bold;margin-bottom:8px;color:#aaa;text-align:center;font-size:13px;'});
rallySectionTitle.textContent = 'Rally Point Opener';
rallySection.appendChild(rallySectionTitle);

var btnTestData = el('button',{innerText:'Test', title:'Load Test Data', style:'position:absolute;top:8px;right:8px;cursor:pointer;padding:4px 8px;background:#2a4a5a;color:#fff;border:1px solid #3a6a7a;border-radius:3px;font-size:11px;', type:'button'});
rallySection.appendChild(btnTestData);

var columnsWrapper = el('div',{style:'display:flex;gap:12px;margin-bottom:12px;'});
rallySection.appendChild(columnsWrapper);

var fromColumn = el('div',{style:'flex:1;display:flex;flex-direction:column;'});
var toColumn = el('div',{style:'flex:1;display:flex;flex-direction:column;'});

var fromLabel = el('div',{style:'font-weight:bold;margin-bottom:6px;color:#aaa;text-align:center;font-size:14px;'});
fromLabel.textContent = 'FROM Coordinates';
var fromTextarea = el('textarea',{rows:8, style:'width:100%;box-sizing:border-box;background:#0f0f0f;color:#fff;border:1px solid #444;padding:8px;border-radius:4px;resize:vertical;font-family:monospace;', placeholder:'111|222\n222|111\n223|111'});

var toLabel = el('div',{style:'font-weight:bold;margin-bottom:6px;color:#aaa;text-align:center;font-size:14px;'});
toLabel.textContent = 'TO Coordinates';
var toTextarea = el('textarea',{rows:8, style:'width:100%;box-sizing:border-box;background:#0f0f0f;color:#fff;border:1px solid #444;padding:8px;border-radius:4px;resize:vertical;font-family:monospace;', placeholder:'123|234\n112|223\n112|224'});

fromColumn.appendChild(fromLabel);
fromColumn.appendChild(fromTextarea);
toColumn.appendChild(toLabel);
toColumn.appendChild(toTextarea);

columnsWrapper.appendChild(fromColumn);
columnsWrapper.appendChild(toColumn);

// Search fields for From and To
var searchWrapper = el('div',{style:'display:flex;gap:12px;margin-bottom:12px;'});
rallySection.appendChild(searchWrapper);

var fromSearchWrap = el('div',{style:'flex:1;display:flex;flex-direction:column;gap:4px;'});
var fromSearchLabel = el('div',{style:'font-size:11px;color:#888;'});
fromSearchLabel.textContent = 'Search FROM:';
var fromSearchInput = el('input',{placeholder:'Search coords or names', style:'width:100%;padding:6px;background:#0f0f0f;color:#fff;border:1px solid #444;border-radius:4px;box-sizing:border-box;'});
var fromSearchResults = el('div',{style:'position:relative;'});
var fromDropdown = el('div',{style:'position:absolute;left:0;right:0;max-height:200px;overflow:auto;background:#1a1a1a;border:1px solid #444;border-radius:4px;padding:4px;display:none;z-index:100000;'});
fromSearchResults.appendChild(fromDropdown);
fromSearchWrap.appendChild(fromSearchLabel);
fromSearchWrap.appendChild(fromSearchInput);
fromSearchWrap.appendChild(fromSearchResults);

var toSearchWrap = el('div',{style:'flex:1;display:flex;flex-direction:column;gap:4px;'});
var toSearchLabel = el('div',{style:'font-size:11px;color:#888;'});
toSearchLabel.textContent = 'Search TO:';
var toSearchInput = el('input',{placeholder:'Search coords or names', style:'width:100%;padding:6px;background:#0f0f0f;color:#fff;border:1px solid #444;border-radius:4px;box-sizing:border-box;'});
var toSearchResults = el('div',{style:'position:relative;'});
var toDropdown = el('div',{style:'position:absolute;left:0;right:0;max-height:200px;overflow:auto;background:#1a1a1a;border:1px solid #444;border-radius:4px;padding:4px;display:none;z-index:100000;'});
toSearchResults.appendChild(toDropdown);
toSearchWrap.appendChild(toSearchLabel);
toSearchWrap.appendChild(toSearchInput);
toSearchWrap.appendChild(toSearchResults);

searchWrapper.appendChild(fromSearchWrap);
searchWrapper.appendChild(toSearchWrap);

// Open Tabs button centered below search
var openTabsRow = el('div',{style:'display:flex;gap:8px;justify-content:center;'});
var btnOpenTabs = el('button',{innerText:'Open Tabs', style:'cursor:pointer;padding:10px 24px;background:#2a5a2a;color:#fff;border:1px solid #3a7a3a;border-radius:4px;font-weight:bold;font-size:14px;', type:'button'});
openTabsRow.appendChild(btnOpenTabs);
rallySection.appendChild(openTabsRow);

body.appendChild(rallySection);

// Attack Plan section
var attackPlanSection = el('div',{style:'margin-bottom:12px;padding:12px;background:#0f0f0f;border-radius:6px;border:1px solid #333;'});
var attackPlanTitle = el('div',{style:'font-weight:bold;margin-bottom:8px;color:#aaa;text-align:center;font-size:13px;'});
attackPlanTitle.textContent = 'Attack Plans';
var attackPlanRow = el('div',{style:'display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-bottom:8px;'});
body.appendChild(attackPlanSection);
attackPlanSection.appendChild(attackPlanTitle);
attackPlanSection.appendChild(attackPlanRow);

var btnPasteAttackPlan = el('button',{innerText:'Paste Attack Plan', style:'cursor:pointer;padding:8px 16px;background:#5a3a2a;color:#fff;border:1px solid #7a5a3a;border-radius:4px;', type:'button'});
var btnLoadAttackPlan = el('button',{innerText:'Load Attack Plan', style:'cursor:pointer;padding:8px 16px;background:#3a2a5a;color:#fff;border:1px solid #5a3a7a;border-radius:4px;', type:'button'});
attackPlanRow.appendChild(btnPasteAttackPlan);
attackPlanRow.appendChild(btnLoadAttackPlan);

var attackPlanContainer = el('div',{id:'attack_plan_groups', style:'display:none;margin-top:8px;'});
attackPlanSection.appendChild(attackPlanContainer);

// Village.txt utilities (minimized footer section)
var utilsSection = el('div',{style:'margin-bottom:8px;padding:8px;background:#0a0a0a;border-radius:4px;border:1px solid #222;'});
var utilsRow = el('div',{style:'display:flex;gap:6px;justify-content:center;flex-wrap:wrap;align-items:center;'});
var utilsLabel = el('span',{style:'font-size:11px;color:#666;margin-right:8px;'});
utilsLabel.textContent = 'Village data:';
body.appendChild(utilsSection);
utilsSection.appendChild(utilsRow);
utilsRow.appendChild(utilsLabel);

var btnGet = el('button',{innerText:'Get village.txt', style:'cursor:pointer;padding:4px 10px;background:#2a2a2a;color:#999;border:1px solid #3a3a3a;border-radius:3px;font-size:11px;', type:'button'});
var btnUpload = el('button',{innerText:'Upload village.txt', style:'cursor:pointer;padding:4px 10px;background:#2a2a2a;color:#999;border:1px solid #3a3a3a;border-radius:3px;font-size:11px;', type:'button'});
var fileInput = el('input',{type:'file', accept:'.txt', style:'display:none'});
utilsRow.appendChild(btnGet);
utilsRow.appendChild(btnUpload);
utilsRow.appendChild(fileInput);

msgBox = el('div',{style:'margin-bottom:12px;color:#9f9f9f;min-height:18px;text-align:center;padding:6px;background:#0a0a0a;border-radius:4px;border:1px solid #2a2a2a;'});
body.appendChild(msgBox);

var footer = el('div',{style:'padding:12px;background:linear-gradient(135deg, #1a1a1a 0%, #0a0a0a 100%);border-bottom-left-radius:6px;border-bottom-right-radius:6px;border-top:2px solid #444;text-align:center;'});
var author = el('div',{style:'font-size:12px;color:#888;text-shadow:1px 1px 2px rgba(0,0,0,0.6);letter-spacing:0.5px;'});
author.textContent = 'Created by NeilB';
footer.appendChild(author);
container.appendChild(footer);

document.body.appendChild(container);

// Make draggable
(function(){
var isDragging = false;
var startX = 0;
var startY = 0;
var initialLeft = 0;
var initialTop = 0;

titleBar.onmousedown = function(e) {
e = e || window.event;
var target = e.target || e.srcElement;
if(target === closeBtn || target === btnConfig) return;
e.preventDefault();
isDragging = true;
startX = e.clientX;
startY = e.clientY;
var rect = container.getBoundingClientRect();
initialLeft = rect.left;
initialTop = rect.top;
document.onmousemove = onMouseMove;
document.onmouseup = onMouseUp;
};

function onMouseMove(e) {
if(!isDragging) return;
e = e || window.event;
e.preventDefault();
var deltaX = e.clientX - startX;
var deltaY = e.clientY - startY;
container.style.left = (initialLeft + deltaX) + 'px';
container.style.top = (initialTop + deltaY) + 'px';
container.style.transform = 'none';
}

function onMouseUp() {
isDragging = false;
document.onmousemove = null;
document.onmouseup = null;
}
})();

// Close button
closeBtn.addEventListener('click', function(){ container.parentNode && container.parentNode.removeChild(container); });

// Upload button
btnUpload.addEventListener('click', function(){ try{ fileInput.click(); }catch(e){} });

fileInput.addEventListener('change', function(ev){
var f = ev.target.files && ev.target.files[0];
if(!f) return;
var r = new FileReader();
r.onload = function(){ 
try{ 
saveVillagesText(String(r.result)); 
villagesArr = parseVillagesTxt(String(r.result)); 
villagesIndex = buildCoordIndex(villagesArr); 
showMessage('village.txt uploaded (' + villagesArr.length + ' entries)'); 
}catch(e){ 
showMessage('Failed to parse uploaded file'); 
} 
};
r.onerror = function(){ showMessage('Failed to read file'); };
r.readAsText(f);
fileInput.value = '';
});

// Search functionality
function setupSearch(inputEl, dropdownEl, targetTextarea){
var searchTimeout = 0;
inputEl.addEventListener('input', function(){
if(searchTimeout) clearTimeout(searchTimeout);
searchTimeout = setTimeout(function(){
var q = (inputEl.value||'').trim().toLowerCase();
if(!q){ dropdownEl.style.display='none'; dropdownEl.innerHTML=''; return; }
if(!villagesArr || villagesArr.length===0){ 
dropdownEl.style.display='block'; 
dropdownEl.innerHTML = '<div style="padding:6px;color:#888;">No village.txt loaded</div>'; 
return; 
}
var results=[];
for(var i=0;i<villagesArr.length;i++){
if(results.length>=50) break;
var v = villagesArr[i];
var coord = coordKey(v.x,v.y);
if(coord.indexOf(q)!==-1 || String(v.x).indexOf(q)!==-1 || String(v.y).indexOf(q)!==-1 || (v.name && v.name.toLowerCase().indexOf(q)!==-1)){
results.push(v);
}
}
if(results.length===0){ 
dropdownEl.style.display='block'; 
dropdownEl.innerHTML = '<div style="padding:6px;color:#888;">No matches</div>'; 
return; 
}
dropdownEl.style.display='block';
dropdownEl.innerHTML='';
for(var j=0;j<Math.min(results.length,50);j++){
(function(r){
var item = el('div',{style:'padding:6px;border-bottom:1px solid rgba(255,255,255,0.05);cursor:pointer;transition:background 0.2s;'});
item.innerHTML = '<span style="color:#4a9eff;">' + r.x + '|' + r.y + '</span> — <span style="color:#bbb;">' + r.name + '</span>';
item.addEventListener('mouseenter', function(){ item.style.background = '#2a2a2a'; });
item.addEventListener('mouseleave', function(){ item.style.background = 'transparent'; });
item.addEventListener('click', function(){
var coordText = r.x + '|' + r.y;
var currentVal = targetTextarea.value.trim();
var lines = currentVal ? currentVal.split('\n') : [];
lines.push(coordText);
targetTextarea.value = lines.join('\n');
dropdownEl.style.display='none';
inputEl.value = '';
});
dropdownEl.appendChild(item);
})(results[j]);
}
}, 120);
});
}

setupSearch(fromSearchInput, fromDropdown, fromTextarea);
setupSearch(toSearchInput, toDropdown, toTextarea);

document.addEventListener('click', function(ev){ 
if(!container.contains(ev.target)) { 
fromDropdown.style.display='none'; 
toDropdown.style.display='none';
} 
});

// Data
var villagesArr = parseVillagesTxt(loadVillagesText());
var villagesIndex = buildCoordIndex(villagesArr);

// Template System
var unitTemplates = {};
var currentTemplate = null;

var UNIT_TYPES = ['spear','sword','axe','archer','spy','light','marcher','heavy','ram','catapult','knight','snob'];
var UNIT_NAMES = {
spear:'Spear', sword:'Sword', axe:'Axe', archer:'Archer', spy:'Scout', 
light:'Light Cav', marcher:'Mounted Archer', heavy:'Heavy Cav', 
ram:'Ram', catapult:'Catapult', knight:'Paladin', snob:'Noble'
};

function loadTemplates(){
try{
var saved = localStorage.getItem('tw_unit_templates');
if(saved){
unitTemplates = JSON.parse(saved);
}
}catch(e){
console.error('Error loading templates:', e);
}
}

function saveTemplates(){
try{
localStorage.setItem('tw_unit_templates', JSON.stringify(unitTemplates));
}catch(e){
console.error('Error saving templates:', e);
}
}

function refreshTemplateSelect(){
templateSelect.innerHTML = '';
var noneOpt = el('option',{value:'', innerText:'No Template'});
templateSelect.appendChild(noneOpt);
var keys = Object.keys(unitTemplates).sort();
for(var i=0;i<keys.length;i++){
var opt = el('option',{value:keys[i], innerText:keys[i]});
templateSelect.appendChild(opt);
}
if(currentTemplate && unitTemplates[currentTemplate]){
templateSelect.value = currentTemplate;
} else {
templateSelect.value = '';
currentTemplate = null;
}
}

function showTemplateEditor(templateName){
var isEdit = templateName && unitTemplates[templateName];
var template;
if(isEdit){
template = {
name: templateName,
mode: unitTemplates[templateName].mode,
units: unitTemplates[templateName].units
};
} else {
template = {name:'', mode:'send', units:{}};
}
  
var modal = el('div',{style:'position:fixed;left:0;top:0;width:100%;height:100%;background:rgba(0,0,0,0.8);z-index:999999;display:flex;align-items:center;justify-content:center;'});
var editor = el('div',{style:'background:#1a1a1a;color:#fff;padding:20px;border-radius:8px;border:2px solid #444;max-width:500px;width:90%;max-height:80vh;overflow:auto;'});
  
var editorTitle = el('div',{style:'font-size:18px;font-weight:bold;margin-bottom:16px;text-align:center;color:#e0e0e0;'});
editorTitle.textContent = isEdit ? 'Edit Template: ' + templateName : 'New Template';
editor.appendChild(editorTitle);
  
var nameLabel = el('div',{style:'font-weight:bold;margin-bottom:4px;color:#aaa;'});
nameLabel.textContent = 'Template Name:';
editor.appendChild(nameLabel);
  
var nameInput = el('input',{value:template.name, style:'width:100%;padding:8px;background:#0f0f0f;color:#fff;border:1px solid #444;border-radius:4px;margin-bottom:12px;box-sizing:border-box;'});
if(isEdit) nameInput.disabled = true;
editor.appendChild(nameInput);
  
var modeLabel = el('div',{style:'font-weight:bold;margin-bottom:4px;color:#aaa;'});
modeLabel.textContent = 'Mode:';
editor.appendChild(modeLabel);
  
var modeSelect = el('select',{style:'width:100%;padding:8px;background:#0f0f0f;color:#fff;border:1px solid #444;border-radius:4px;margin-bottom:12px;'});
var sendOpt = el('option',{value:'send', innerText:'Send X units'});
var keepOpt = el('option',{value:'keep', innerText:'Keep X units at home'});
modeSelect.appendChild(sendOpt);
modeSelect.appendChild(keepOpt);
modeSelect.value = template.mode;
editor.appendChild(modeSelect);
  
var unitsLabel = el('div',{style:'font-weight:bold;margin-bottom:8px;color:#aaa;'});
unitsLabel.textContent = 'Unit Configuration:';
editor.appendChild(unitsLabel);
  
var unitsGrid = el('div',{style:'display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px;'});
editor.appendChild(unitsGrid);
  
var unitInputs = {};
for(var i=0;i<UNIT_TYPES.length;i++){
var unitType = UNIT_TYPES[i];
var unitRow = el('div',{style:'display:flex;align-items:center;gap:6px;'});
var unitLabel = el('label',{style:'flex:1;color:#bbb;font-size:12px;'});
unitLabel.textContent = UNIT_NAMES[unitType] + ':';
var unitInput = el('input',{type:'number', min:'0', value:template.units[unitType]||'', placeholder:'0', style:'width:70px;padding:4px;background:#0f0f0f;color:#fff;border:1px solid #444;border-radius:3px;'});
unitInputs[unitType] = unitInput;
unitRow.appendChild(unitLabel);
unitRow.appendChild(unitInput);
unitsGrid.appendChild(unitRow);
}
  
var btnRow = el('div',{style:'display:flex;gap:8px;justify-content:center;margin-top:16px;'});
editor.appendChild(btnRow);
  
var btnSave = el('button',{innerText:'Save', style:'cursor:pointer;padding:8px 20px;background:#2a5a2a;color:#fff;border:1px solid #3a7a3a;border-radius:4px;font-weight:bold;'});
var btnCancel = el('button',{innerText:'Cancel', style:'cursor:pointer;padding:8px 20px;background:#5a2a2a;color:#fff;border:1px solid #7a3a3a;border-radius:4px;'});
  
btnRow.appendChild(btnSave);
btnRow.appendChild(btnCancel);
  
modal.appendChild(editor);
document.body.appendChild(modal);
  
btnCancel.onclick = function(){ document.body.removeChild(modal); };
  
btnSave.onclick = function(){
var name = nameInput.value.trim();
if(!name){
alert('Please enter a template name');
return;
}
if(!isEdit && unitTemplates[name]){
alert('A template with this name already exists');
return;
}
var units = {};
for(var unitType in unitInputs){
var val = unitInputs[unitType].value.trim();
if(val && val !== '0'){
units[unitType] = parseInt(val);
}
}
unitTemplates[name] = {
mode: modeSelect.value,
units: units
};
saveTemplates();
refreshTemplateSelect();
currentTemplate = name;
templateSelect.value = name;
showMessage('Template "' + name + '" saved');
document.body.removeChild(modal);
};
}

// Template button handlers
btnNewTemplate.onclick = function(){
showTemplateEditor(null);
};

btnEditTemplate.onclick = function(){
var selected = templateSelect.value;
if(!selected){
showMessage('Please select a template to edit');
return;
}
showTemplateEditor(selected);
};