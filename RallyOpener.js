(function(){
if(window.__tw_helper_loaded) return; 
window.__tw_helper_loaded = true;
console.log('Rally Opener script loading - timestamp:', Date.now());

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
function showMessage(msg,timeout){ timeout = timeout || 3000; if(msgBox){ msgBox.textContent = msg; if(msgBox._t) clearTimeout(msgBox._t); msgBox._t = setTimeout(function(){ msgBox.textContent = ''; }, timeout); } }
function getCurrentVillageIdFromUrl(){ var m = location.search.match(/[?&]village=(\d+)/); return m?m[1]:null; }
function tryFetchVillagesFromServer(){
var base = location.origin;
var plain = base + '/map/village.txt';
return fetch(plain).then(function(r){ 
if(!r.ok) throw new Error('Failed to fetch village.txt'); 
return r.text(); 
});
}

/* --- Build UI --- */
var container = el('div',{id:'tw_open_tabs_ui', style:'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:99999;background:#1a1a1a;color:#fff;padding:0;border-radius:8px;font-family:Arial, Helvetica, sans-serif;font-size:13px;width:680px;box-shadow:0 8px 24px rgba(0,0,0,0.8);resize:both;overflow:auto;border:2px solid #333;'});

// Title bar (drag handle)
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

// Two column layout for coordinate pairs
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

function setupTextareaPasteHandler(textarea){
textarea.addEventListener('paste', function(e){
e.preventDefault();
var pastedText = (e.clipboardData || window.clipboardData).getData('text');
var coords = pastedText.split(/[\s,]+/).filter(function(t){ return t && t.match(/\d+\|\d+/); });
if(coords.length === 0) return;
var currentVal = textarea.value.trim();
var lines = currentVal ? currentVal.split('\n') : [];
for(var i=0;i<coords.length;i++){
lines.push(coords[i]);
}
textarea.value = lines.join('\n');
});
}

setupTextareaPasteHandler(fromTextarea);
setupTextareaPasteHandler(toTextarea);

fromColumn.appendChild(fromLabel);
fromColumn.appendChild(fromTextarea);
toColumn.appendChild(toLabel);
toColumn.appendChild(toTextarea);

columnsWrapper.appendChild(fromColumn);
columnsWrapper.appendChild(toColumn);

// Search fields for From and To
var searchWrapper = el('div',{style:'display:flex;gap:12px;margin-bottom:12px;'});
body.appendChild(searchWrapper);

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

// Buttons row
var row = el('div',{style:'display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;justify-content:center;'});
body.appendChild(row);

var btnCalculate = el('button',{innerText:'Calculate', style:'cursor:pointer;padding:8px 16px;background:#5a2a5a;color:#fff;border:1px solid #7a3a7a;border-radius:4px;font-weight:bold;', type:'button'});
var btnTestData = el('button',{innerText:'Load Test Data', style:'cursor:pointer;padding:8px 16px;background:#2a4a5a;color:#fff;border:1px solid #3a6a7a;border-radius:4px;', type:'button'});
var btnGet = el('button',{innerText:'Get village.txt', style:'cursor:pointer;padding:8px 16px;background:#2a4a5a;color:#fff;border:1px solid #3a6a7a;border-radius:4px;'});
var btnUpload = el('button',{innerText:'Upload village.txt', style:'cursor:pointer;padding:8px 16px;background:#5a4a2a;color:#fff;border:1px solid #7a6a3a;border-radius:4px;'});
var fileInput = el('input',{type:'file', accept:'.txt', style:'display:none'});
row.appendChild(btnCalculate);
row.appendChild(btnTestData);
row.appendChild(btnGet);
row.appendChild(btnUpload);
row.appendChild(fileInput);

var openTabsContainer = el('div',{style:'margin-bottom:12px;text-align:center;'});
body.appendChild(openTabsContainer);

var msgBox = el('div',{style:'margin-bottom:12px;color:#9f9f9f;min-height:18px;text-align:center;padding:6px;background:#0a0a0a;border-radius:4px;border:1px solid #2a2a2a;'});
body.appendChild(msgBox);

// Footer with author
var footer = el('div',{style:'padding:12px;background:linear-gradient(135deg, #1a1a1a 0%, #0a0a0a 100%);border-bottom-left-radius:6px;border-bottom-right-radius:6px;border-top:2px solid #444;text-align:center;'});
var author = el('div',{style:'font-size:12px;color:#888;text-shadow:1px 1px 2px rgba(0,0,0,0.6);letter-spacing:0.5px;'});
author.textContent = 'Created by NeilB';
footer.appendChild(author);
container.appendChild(footer);

document.body.appendChild(container);

// Make draggable via titleBar
(function(){
var dragging=false, offsetX=0, offsetY=0;
titleBar.addEventListener('mousedown', function(e){
if(e.target === closeBtn) return;
dragging=true;
var rect = container.getBoundingClientRect();
offsetX = e.clientX - rect.left;
offsetY = e.clientY - rect.top;
document.addEventListener('mousemove', onMouseMove);
document.addEventListener('mouseup', onMouseUp);
e.preventDefault();
});
function onMouseMove(e){
if(!dragging) return;
var x = e.clientX - offsetX;
var y = e.clientY - offsetY;
container.style.left = x + 'px';
container.style.top = y + 'px';
container.style.transform = 'none';
}
function onMouseUp(){
dragging=false;
document.removeEventListener('mousemove', onMouseMove);
document.removeEventListener('mouseup', onMouseUp);
}
})();

// Close button
closeBtn.addEventListener('click', function(){ container.parentNode && container.parentNode.removeChild(container); });

// Ensure file input works
btnUpload.addEventListener('click', function(){ try{ fileInput.click(); }catch(e){} });

// Data structures
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
var href = location.href.split('?')[0];
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

function openTabsFromUrls(urls){
console.log('Opening ' + urls.length + ' tabs');
var delayTab = 100;
var opened = 0;
for(var j=0;j<urls.length;j++){
(function(currentUrl, index, totalUrls){
window.setTimeout(function(){
try{
var win = window.open(currentUrl, '_blank');
console.log('Tab ' + (index + 1) + ' at ' + new Date().getTime() + ' - ' + (win ? 'SUCCESS' : 'BLOCKED'));
if(win) opened++;
}catch(err){
console.error('Exception tab ' + (index + 1), err);
}
if(index === totalUrls - 1){
window.setTimeout(function(){
showMessage('Opened ' + opened + ' of ' + totalUrls + ' tabs');
}, 200);
}
}, delayTab * index);
})(urls[j], j, urls.length);
}
}

// Button handlers
btnCalculate.addEventListener('click', function(e){
e.preventDefault();
console.log('Calculate clicked');
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

openTabsContainer.innerHTML = '';
var btnOpen = document.createElement('button');
btnOpen.innerText = 'Open ' + preparedUrls.length + ' Tabs';
btnOpen.className = 'btn evt-confirm-btn btn-confirm-yes';
btnOpen.style.cssText = 'cursor:pointer;padding:10px 20px;background:#2a5a2a;color:#fff;border:1px solid #3a7a3a;border-radius:4px;font-weight:bold;font-size:16px;';
btnOpen.onclick = function(){
for(let j=0;j<preparedUrls.length;j++){
window.setTimeout(()=>{
window.open(preparedUrls[j], '_blank');
console.log(new Date().getTime());
}, 200*j);
}
};
btnOpen.classList.add('open_tab');
openTabsContainer.appendChild(btnOpen);
showMessage('Ready! Click "Open ' + preparedUrls.length + ' Tabs" button below');
}, false);

btnTestData.addEventListener('click', function(){
fromTextarea.value = '524|496\n524|496\n524|496';
toTextarea.value = '523|496\n525|496\n522|495';
showMessage('Test data loaded');
openTabsContainer.innerHTML = '';
});

btnGet.addEventListener('click', function(){
var lastFetch = localStorage.getItem('tw_villages_updated');
var now = Date.now();
var oneHour = 60 * 60 * 1000;
if(lastFetch){
var timeSince = now - Number(lastFetch);
if(timeSince < oneHour){
var minutesLeft = Math.ceil((oneHour - timeSince) / 60000);
var confirmed = confirm('WARNING: Script rules require at least 1 hour between fetches from server.\n\nLast fetch was ' + Math.floor(timeSince / 60000) + ' minutes ago.\nPlease wait ' + minutesLeft + ' more minute(s).\n\nDo you want to fetch anyway? (Not recommended - may violate rules)');
if(!confirmed) return;
}
}
showMessage('Fetching village.txt from server...');
tryFetchVillagesFromServer().then(function(txt){
if(!txt) throw new Error('Empty response');
saveVillagesText(txt);
villagesArr = parseVillagesTxt(txt);
villagesIndex = buildCoordIndex(villagesArr);
showMessage('village.txt saved locally (' + villagesArr.length + ' entries)');
}).catch(function(err){
showMessage('Failed to fetch: ' + (err && err.message ? err.message : String(err)));
});
});

fileInput.addEventListener('change', function(ev){
var f = ev.target.files && ev.target.files[0];
if(!f) return;
var r = new FileReader();
r.onload = function(){ try{ saveVillagesText(String(r.result)); villagesArr = parseVillagesTxt(String(r.result)); villagesIndex = buildCoordIndex(villagesArr); showMessage('village.txt uploaded ('+villagesArr.length+' entries)'); }catch(e){ showMessage('Failed to parse uploaded file'); } };
r.onerror = function(){ showMessage('Failed to read file'); };
r.readAsText(f);
fileInput.value = '';
});

// Search
function setupSearch(inputEl, dropdownEl, targetTextarea){
var searchTimeout = 0;
inputEl.addEventListener('input', function(){
if(searchTimeout) clearTimeout(searchTimeout);
searchTimeout = setTimeout(function(){
var q = (inputEl.value||'').trim().toLowerCase();
if(!q){ dropdownEl.style.display='none'; dropdownEl.innerHTML=''; return; }
if(!villagesArr || villagesArr.length===0){ 
dropdownEl.style.display='block'; 
dropdownEl.innerHTML = '<div style="padding:6px;color:#888;">No villages.txt loaded</div>'; 
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

window.__tw_villages_helper = {
loadVillagesText: loadVillagesText,
parseVillagesTxt: parseVillagesTxt,
buildCoordIndex: buildCoordIndex,
coordToVillageId: coordToVillageId,
getCurrentVillageIdFromUrl: getCurrentVillageIdFromUrl
};

showMessage('Rally Opener ready! Load or upload village.txt to begin.');
})();
