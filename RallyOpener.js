// Rally Opener - Direct execution version (no IIFE)
if(window.__tw_helper_loaded) { console.log('Already loaded'); } else {
window.__tw_helper_loaded = true;

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
var container = el('div',{id:'tw_open_tabs_ui', style:'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:99999;background:#1a1a1a;color:#fff;padding:0;border-radius:8px;font-family:Arial, Helvetica, sans-serif;font-size:13px;width:680px;box-shadow:0 8px 24px rgba(0,0,0,0.8);resize:both;overflow:auto;border:2px solid #333;'});

var titleBar = el('div',{style:'cursor:move;padding:16px;background:linear-gradient(135deg, #2a2a2a 0%, #1a1a1a 100%);border-top-left-radius:6px;border-top-right-radius:6px;user-select:none;border-bottom:2px solid #444;'});
var titleWrapper = el('div',{style:'text-align:center;position:relative;'});
var title = el('div',{style:'font-size:22px;font-weight:bold;color:#e0e0e0;text-shadow:2px 2px 4px rgba(0,0,0,0.6);letter-spacing:1px;'});
title.textContent = 'RALLY OPENER';
var closeBtn = el('button',{innerText:'✕', title:'Close', style:'position:absolute;right:0;top:50%;transform:translateY(-50%);cursor:pointer;padding:4px 10px;background:#444;color:#fff;border:1px solid #666;border-radius:4px;font-size:16px;font-weight:bold;'});
titleWrapper.appendChild(title);
titleWrapper.appendChild(closeBtn);
titleBar.appendChild(titleWrapper);
container.appendChild(titleBar);

var body = el('div',{style:'padding:16px;display:block;'});
container.appendChild(body);

var columnsWrapper = el('div',{style:'display:flex;gap:12px;margin-bottom:12px;'});
body.appendChild(columnsWrapper);

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

var row = el('div',{style:'display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;justify-content:center;'});
body.appendChild(row);

var btnCalculate = el('button',{innerText:'Calculate', style:'cursor:pointer;padding:8px 16px;background:#5a2a5a;color:#fff;border:1px solid #7a3a7a;border-radius:4px;font-weight:bold;', type:'button'});
var btnTestData = el('button',{innerText:'Load Test Data', style:'cursor:pointer;padding:8px 16px;background:#2a4a5a;color:#fff;border:1px solid #3a6a7a;border-radius:4px;', type:'button'});
var btnPasteAttackPlan = el('button',{innerText:'Paste Attack Plan', style:'cursor:pointer;padding:8px 16px;background:#5a3a2a;color:#fff;border:1px solid #7a5a3a;border-radius:4px;', type:'button'});
var btnLoadAttackPlan = el('button',{innerText:'Load Attack Plan', style:'cursor:pointer;padding:8px 16px;background:#3a2a5a;color:#fff;border:1px solid #5a3a7a;border-radius:4px;', type:'button'});
var btnConfig = el('button',{innerText:'⚙', title:'Config', style:'cursor:pointer;padding:8px 12px;background:#2a2a2a;color:#fff;border:1px solid #4a4a4a;border-radius:4px;font-size:16px;', type:'button'});
var btnGet = el('button',{innerText:'Get village.txt', style:'cursor:pointer;padding:8px 16px;background:#2a4a5a;color:#fff;border:1px solid #3a6a7a;border-radius:4px;'});

row.appendChild(btnCalculate);
row.appendChild(btnTestData);
row.appendChild(btnPasteAttackPlan);
row.appendChild(btnLoadAttackPlan);
row.appendChild(btnConfig);
row.appendChild(btnGet);

var openTabsContainer = el('div',{style:'margin-bottom:12px;text-align:center;'});
body.appendChild(openTabsContainer);

var attackPlanContainer = el('div',{id:'attack_plan_groups', style:'margin-bottom:12px;display:none;'});
body.appendChild(attackPlanContainer);

msgBox = el('div',{style:'margin-bottom:12px;color:#9f9f9f;min-height:18px;text-align:center;padding:6px;background:#0a0a0a;border-radius:4px;border:1px solid #2a2a2a;'});
body.appendChild(msgBox);

var footer = el('div',{style:'padding:12px;background:linear-gradient(135deg, #1a1a1a 0%, #0a0a0a 100%);border-bottom-left-radius:6px;border-bottom-right-radius:6px;border-top:2px solid #444;text-align:center;'});
var author = el('div',{style:'font-size:12px;color:#888;text-shadow:1px 1px 2px rgba(0,0,0,0.6);letter-spacing:0.5px;'});
author.textContent = 'Created by NeilB';
footer.appendChild(author);
container.appendChild(footer);

document.body.appendChild(container);

// Close button
closeBtn.addEventListener('click', function(){ container.parentNode && container.parentNode.removeChild(container); });

// Data
var villagesArr = parseVillagesTxt(loadVillagesText());
var villagesIndex = buildCoordIndex(villagesArr);

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
var url = buildRallyUrl(fromId, toId);
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
var groupTitle = el('div',{style:'font-weight:bold;margin-bottom:8px;color:#aaa;text-align:center;font-size:14px;'});
groupTitle.textContent = 'Attack Plan Groups';
attackPlanContainer.appendChild(groupTitle);
var groupKeys = Object.keys(attackPlanGroups).sort(function(a,b){ return Number(a) - Number(b); });
for(var i=0;i<groupKeys.length;i++){
var groupNum = groupKeys[i];
var group = attackPlanGroups[groupNum];
var btnGroup = document.createElement('button');
btnGroup.className = 'group-btn';
btnGroup.dataset.group = groupNum;
btnGroup.style.cssText = 'cursor:pointer;padding:10px 20px;background:#3a5a3a;color:#fff;border:1px solid #4a7a4a;border-radius:4px;font-weight:bold;margin:5px;display:inline-block;min-width:150px;';
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
var url = buildRallyUrl(fromId, toId);
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
btnCalculate.onclick = function(){
console.log('Calculate clicked');
let fromCoords = parseCoordinateList(fromTextarea.value);
let toCoords = parseCoordinateList(toTextarea.value);
if(fromCoords.length === 0 || toCoords.length === 0){ 
showMessage('Please enter coordinates in both FROM and TO columns'); 
return; 
}
let preparedUrls = prepareTabsFromPairs(fromCoords, toCoords);
if(preparedUrls.length === 0) return;

openTabsContainer.innerHTML = '';
let btnOpen = document.createElement('button');
btnOpen.innerText = 'Open ' + preparedUrls.length + ' Tabs';
btnOpen.className = 'btn evt-confirm-btn btn-confirm-yes open_tab';
btnOpen.style.cssText = 'cursor:pointer;padding:10px 20px;background:#2a5a2a;color:#fff;border:1px solid #3a7a3a;border-radius:4px;font-weight:bold;font-size:16px;';
btnOpen.onclick = function(){
console.log('Opening tabs NOW');
let current_hrefs = preparedUrls;
btnOpen.classList.remove("evt-confirm-btn");
btnOpen.classList.remove("btn-confirm-yes");
btnOpen.classList.add("btn-confirm-no");
let delayTab = 200;
for(let j=0;j<current_hrefs.length;j++){
window.setTimeout(()=>{
window.open(current_hrefs[j], '_blank');
console.log(new Date().getTime());
}, delayTab*j);
}
document.querySelectorAll('.open_tab').forEach(btn => btn.disabled = true);
window.setTimeout(()=>{
document.querySelectorAll('.open_tab').forEach(btn => btn.disabled = false);
}, delayTab*current_hrefs.length);
};
openTabsContainer.appendChild(btnOpen);
showMessage('Ready! Click "Open ' + preparedUrls.length + ' Tabs" button');
};

btnTestData.onclick = function(){
fromTextarea.value = '524|496\n524|496\n524|496';
toTextarea.value = '523|496\n525|496\n522|495';
showMessage('Test data loaded');
openTabsContainer.innerHTML = '';
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
showMessage('Loading attack plans from GitHub...');
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
}