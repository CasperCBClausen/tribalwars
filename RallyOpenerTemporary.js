// Rally Opener - Direct execution version (no IIFE)
if(window.__tw_helper_loaded) { console.log('Already loaded'); } else {
window.__tw_helper_loaded = true;

// Check if we're on the combined overview page
var currentUrl = window.location.href;
var isOverviewPage = currentUrl.indexOf('screen=overview_villages') !== -1 && currentUrl.indexOf('mode=combined') !== -1;

var confirmRedirect = false;
if(!isOverviewPage){
confirmRedirect = confirm('Rally Opener works best on the Combined Village Overview page.\n\nWould you like to be redirected there now?');
if(confirmRedirect){
try{
var baseUrl = window.location.origin + window.location.pathname;
var newUrl = baseUrl + '?screen=overview_villages&mode=combined';
window.location.href = newUrl;
}catch(e){
alert('Could not redirect. Please navigate to:\nOverview → Combined → Village Overview');
}
}
}

// Only continue if on correct page or user chose to stay
if(isOverviewPage || !confirmRedirect){

/* --- Utilities --- */
function qs(sel,root){ root = root || document; return root.querySelector(sel); }
function el(tag,opts){ var e=document.createElement(tag); if(opts){ for(var k in opts) if(opts.hasOwnProperty(k)) e[k]=opts[k]; } return e; }
function saveVillagesText(txt){ try{ localStorage.setItem('tw_villages_txt', txt); localStorage.setItem('tw_villages_updated', String(Date.now())); }catch(e){} }
function loadVillagesText(){ try{ return localStorage.getItem('tw_villages_txt') || null; }catch(e){ return null; } }

// Unit type definitions - must be early in script
var UNIT_TYPES = ['spear','sword','axe','archer','spy','light','marcher','heavy','ram','catapult','knight','snob'];
var UNIT_NAMES = {
spear:'Spear', sword:'Sword', axe:'Axe', archer:'Archer', spy:'Scout', 
light:'Light Cav', marcher:'Mounted Archer', heavy:'Heavy Cav', 
ram:'Ram', catapult:'Catapult', knight:'Paladin', snob:'Noble'
};

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

var titleBar = el('div',{style:'cursor:move;padding:16px;background:linear-gradient(135deg, #2a2a2a 0%, #1a1a1a 100%);border-top-left-radius:6px;border-top-right-radius:6px;user-select:none;border-bottom:2px solid #444;position:relative;'});
var titleWrapper = el('div',{style:'text-align:center;position:relative;'});
var title = el('div',{style:'font-size:22px;font-weight:bold;color:#e0e0e0;text-shadow:2px 2px 4px rgba(0,0,0,0.6);letter-spacing:1px;'});
title.textContent = 'RALLY OPENER';

// Create buttons for title bar
var btnConfig = el('button',{innerText:'⚙', title:'Config', style:'position:absolute;left:10px;top:50%;transform:translateY(-50%);cursor:pointer;padding:6px 10px;background:#2a2a2a;color:#fff;border:1px solid #4a4a4a;border-radius:4px;font-size:14px;z-index:10;', type:'button'});
var closeBtn = el('button',{innerText:'✕', title:'Close', style:'position:absolute;right:0;top:50%;transform:translateY(-50%);cursor:pointer;padding:4px 10px;background:#444;color:#fff;border:1px solid #666;border-radius:4px;font-size:16px;font-weight:bold;z-index:10;'});

titleBar.appendChild(btnConfig);
titleWrapper.appendChild(title);
titleWrapper.appendChild(closeBtn);
titleBar.appendChild(titleWrapper);
container.appendChild(titleBar);

var body = el('div',{style:'padding:16px;display:block;'});
container.appendChild(body);

// Unit Templates section
var templatesSection = el('div',{style:'margin-bottom:12px;padding:12px;background:#0f0f0f;border-radius:6px;border:1px solid #333;'});
var templatesSectionHeader = el('div',{style:'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;'});
var templatesSectionTitle = el('div',{style:'font-weight:bold;color:#aaa;text-align:center;font-size:13px;flex:1;'});
templatesSectionTitle.textContent = 'Unit Templates';
var templatesCollapseBtn = el('button',{innerText:'−', style:'cursor:pointer;padding:2px 8px;background:#2a2a2a;color:#fff;border:1px solid #4a4a4a;border-radius:3px;font-size:16px;font-weight:bold;line-height:1;', type:'button'});
templatesSectionHeader.appendChild(templatesSectionTitle);
templatesSectionHeader.appendChild(templatesCollapseBtn);
templatesSection.appendChild(templatesSectionHeader);

var templatesContent = el('div',{style:'display:block;'});
templatesSection.appendChild(templatesContent);

var templateControls = el('div',{style:'display:flex;gap:8px;margin-bottom:8px;align-items:center;justify-content:center;flex-wrap:wrap;'});
templatesContent.appendChild(templateControls);

var templateSelect = el('select',{style:'padding:6px;background:#0f0f0f;color:#fff;border:1px solid #444;border-radius:4px;min-width:150px;'});
var noneOption = el('option',{value:'', innerText:'-- Select Template --'});
templateSelect.appendChild(noneOption);
templateControls.appendChild(templateSelect);

var btnNewTemplate = el('button',{innerText:'New', style:'cursor:pointer;padding:6px 12px;background:#2a5a2a;color:#fff;border:1px solid #3a7a3a;border-radius:4px;font-size:12px;', type:'button'});
templateControls.appendChild(btnNewTemplate);

var btnDeleteTemplate = el('button',{innerText:'Delete', style:'cursor:pointer;padding:6px 12px;background:#5a2a2a;color:#fff;border:1px solid #7a3a3a;border-radius:4px;font-size:12px;', type:'button'});
templateControls.appendChild(btnDeleteTemplate);

// Template editor (inline) - ultra-compact version with one line per mode
var templateEditor = el('div',{style:'display:none;margin-top:6px;padding:6px;background:#0a0a0a;border-radius:4px;border:1px solid #333;'});
templatesContent.appendChild(templateEditor);

// Add CSS to remove spinner arrows from number inputs
var styleEl = document.createElement('style');
styleEl.textContent = '#tw_open_tabs_ui input[type=number]::-webkit-inner-spin-button, #tw_open_tabs_ui input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; } #tw_open_tabs_ui input[type=number] { -moz-appearance: textfield; }';
document.head.appendChild(styleEl);

// Unit labels row (above both send and keep)
var labelsRow = el('div',{style:'display:flex;align-items:center;gap:6px;margin-bottom:3px;padding-left:9px;'});
templateEditor.appendChild(labelsRow);

// Add spacers to match the radio button and "Send:"/"Keep:" label width
var radioSpacer = el('span',{style:'width:15px;flex-shrink:0;'}); // Match radio button width
var labelSpacer = el('span',{style:'width:45px;flex-shrink:0;'}); // Match "Send:"/"Keep:" label width
labelsRow.appendChild(radioSpacer);
labelsRow.appendChild(labelSpacer);

for(var i=0;i<UNIT_TYPES.length;i++){
var unitType = UNIT_TYPES[i];
var unitLabel = el('span',{style:'color:#888;font-size:9px;white-space:nowrap;width:50px;min-width:50px;text-align:center;display:block;flex-shrink:0;'});
var abbrev = UNIT_NAMES[unitType];
// Custom abbreviations
if(unitType === 'spear') abbrev = 'Spear';
else if(unitType === 'sword') abbrev = 'Sword';
else if(unitType === 'axe') abbrev = 'Axe';
else if(unitType === 'archer') abbrev = 'Archer';
else if(unitType === 'spy') abbrev = 'Scout';
else if(unitType === 'light') abbrev = 'LC';
else if(unitType === 'marcher') abbrev = 'MA';
else if(unitType === 'heavy') abbrev = 'HC';
else if(unitType === 'ram') abbrev = 'Ram';
else if(unitType === 'catapult') abbrev = 'Cata';
else if(unitType === 'knight') abbrev = 'Pala';
else if(unitType === 'snob') abbrev = 'Noble';
unitLabel.textContent = abbrev;
unitLabel.title = UNIT_NAMES[unitType];
labelsRow.appendChild(unitLabel);
}

// Send mode row
var sendModeRow = el('label',{style:'display:flex;align-items:center;gap:6px;margin-bottom:4px;padding:4px;background:#0f0f0f;border-radius:3px;cursor:pointer;'});
templateEditor.appendChild(sendModeRow);

var sendModeRadio = el('input',{type:'radio', name:'template_mode', value:'send', style:'cursor:pointer;flex-shrink:0;'});
var sendModeText = el('span',{innerText:'Send:', style:'color:#bbb;font-size:11px;min-width:45px;flex-shrink:0;'});
sendModeRow.appendChild(sendModeRadio);
sendModeRow.appendChild(sendModeText);

// Keep mode row
var keepModeRow = el('label',{style:'display:flex;align-items:center;gap:6px;padding:4px;background:#0f0f0f;border-radius:3px;cursor:pointer;'});
templateEditor.appendChild(keepModeRow);

var keepModeRadio = el('input',{type:'radio', name:'template_mode', value:'keep', style:'cursor:pointer;flex-shrink:0;'});
var keepModeText = el('span',{innerText:'Keep:', style:'color:#bbb;font-size:11px;min-width:45px;flex-shrink:0;'});
keepModeRow.appendChild(keepModeRadio);
keepModeRow.appendChild(keepModeText);

var unitInputs = {};
var keepUnitInputs = {};

for(var i=0;i<UNIT_TYPES.length;i++){
var unitType = UNIT_TYPES[i];

// Create for Send row
var sendUnitInput = el('input',{type:'number', min:'0', value:'', placeholder:'0', style:'width:50px;min-width:50px;padding:3px 4px;background:#1a1a1a;color:#fff;border:1px solid #444;border-radius:2px;box-sizing:border-box;font-size:11px;text-align:center;flex-shrink:0;'});
unitInputs[unitType] = sendUnitInput;
sendModeRow.appendChild(sendUnitInput);

// Create for Keep row
var keepUnitInput = el('input',{type:'number', min:'0', value:'', placeholder:'0', style:'width:50px;min-width:50px;padding:3px 4px;background:#1a1a1a;color:#fff;border:1px solid #444;border-radius:2px;box-sizing:border-box;font-size:11px;text-align:center;flex-shrink:0;'});
keepUnitInputs[unitType] = keepUnitInput;
keepModeRow.appendChild(keepUnitInput);
}

// Auto-save on input change
for(var unitType in unitInputs){
(function(ut){
unitInputs[ut].addEventListener('input', function(){
if(currentTemplate) saveCurrentTemplate();
});
keepUnitInputs[ut].addEventListener('input', function(){
if(currentTemplate) saveCurrentTemplate();
});
})(unitType);
}

// Visual feedback for which mode is active
sendModeRadio.addEventListener('change', function(){
if(sendModeRadio.checked){
sendModeRow.style.background = '#1a3a1a';
keepModeRow.style.background = '#0f0f0f';
if(currentTemplate) saveCurrentTemplate();
}
});
keepModeRadio.addEventListener('change', function(){
if(keepModeRadio.checked){
keepModeRow.style.background = '#1a3a1a';
sendModeRow.style.background = '#0f0f0f';
if(currentTemplate) saveCurrentTemplate();
}
});

body.appendChild(templatesSection);

// Templates collapse handler
templatesCollapseBtn.onclick = function(){
if(templatesContent.style.display === 'none'){
templatesContent.style.display = 'block';
templatesCollapseBtn.innerText = '−';
} else {
templatesContent.style.display = 'none';
templatesCollapseBtn.innerText = '+';
}
};

// Rally Point Opener section with FROM/TO coordinates
var rallySection = el('div',{style:'margin-bottom:12px;padding:12px;background:#0f0f0f;border-radius:6px;border:1px solid #333;position:relative;'});
var rallySectionHeader = el('div',{style:'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;'});
var rallySectionTitle = el('div',{style:'font-weight:bold;color:#aaa;text-align:center;font-size:13px;flex:1;'});
rallySectionTitle.textContent = 'Rally Point Opener';
var rallyCollapseBtn = el('button',{innerText:'−', style:'cursor:pointer;padding:2px 8px;background:#2a2a2a;color:#fff;border:1px solid #4a4a4a;border-radius:3px;font-size:16px;font-weight:bold;line-height:1;', type:'button'});
rallySectionHeader.appendChild(rallySectionTitle);
rallySectionHeader.appendChild(rallyCollapseBtn);
rallySection.appendChild(rallySectionHeader);

var rallyContent = el('div',{style:'display:block;'});
rallySection.appendChild(rallyContent);

// Use current group checkbox (top left)
var useGroupWrapper = el('label',{style:'position:absolute;top:8px;left:8px;display:flex;align-items:center;gap:6px;color:#bbb;font-size:11px;cursor:pointer;'});
var useGroupCheckbox = el('input',{type:'checkbox', style:'cursor:pointer;'});
var useGroupLabel = el('span',{innerText:'Use current group'});
useGroupWrapper.appendChild(useGroupCheckbox);
useGroupWrapper.appendChild(useGroupLabel);
rallySectionHeader.appendChild(useGroupWrapper);

var btnTestData = el('button',{innerText:'Test', title:'Load Test Data', style:'position:absolute;top:8px;right:40px;cursor:pointer;padding:4px 8px;background:#2a4a5a;color:#fff;border:1px solid #3a6a7a;border-radius:3px;font-size:11px;', type:'button'});
rallySectionHeader.appendChild(btnTestData);

var columnsWrapper = el('div',{style:'display:flex;gap:12px;margin-bottom:12px;'});
rallyContent.appendChild(columnsWrapper);

var fromColumn = el('div',{style:'flex:1;display:flex;flex-direction:column;position:relative;'});
var toColumn = el('div',{style:'flex:1;display:flex;flex-direction:column;'});

var fromLabel = el('div',{style:'font-weight:bold;margin-bottom:6px;color:#aaa;text-align:center;font-size:14px;'});
fromLabel.textContent = 'FROM Coordinates';

var fromTextarea = el('textarea',{rows:8, style:'width:100%;box-sizing:border-box;background:#0f0f0f;color:#fff;border:1px solid #444;padding:8px;border-radius:4px;resize:vertical;font-family:monospace;', placeholder:'111|222\n222|111\n223|111'});

// Overlay for "Using current group"
var fromOverlay = el('div',{style:'position:absolute;top:30px;left:0;right:0;bottom:0;background:rgba(15,15,15,0.95);border:1px solid #444;border-radius:4px;display:none;align-items:center;justify-content:center;color:#4a9eff;font-weight:bold;font-size:14px;pointer-events:none;'});
fromOverlay.textContent = 'Using current group';

fromColumn.appendChild(fromLabel);
fromColumn.appendChild(fromTextarea);
fromColumn.appendChild(fromOverlay);

var toLabel = el('div',{style:'font-weight:bold;margin-bottom:6px;color:#aaa;text-align:center;font-size:14px;'});
toLabel.textContent = 'TO Coordinates';
var toTextarea = el('textarea',{rows:8, style:'width:100%;box-sizing:border-box;background:#0f0f0f;color:#fff;border:1px solid #444;padding:8px;border-radius:4px;resize:vertical;font-family:monospace;', placeholder:'123|234\n112|223\n112|224'});

fromColumn.appendChild(fromLabel);
fromColumn.appendChild(fromTextarea);
toColumn.appendChild(toLabel);
toColumn.appendChild(toTextarea);

columnsWrapper.appendChild(fromColumn);
columnsWrapper.appendChild(toColumn);

// Handle "Use current group" checkbox
useGroupCheckbox.addEventListener('change', function(){
if(useGroupCheckbox.checked){
fromTextarea.disabled = true;
fromTextarea.style.opacity = '0.5';
fromOverlay.style.display = 'flex';
} else {
fromTextarea.disabled = false;
fromTextarea.style.opacity = '1';
fromOverlay.style.display = 'none';
}
});

// Search fields for From and To
var searchWrapper = el('div',{style:'display:flex;gap:12px;margin-bottom:12px;'});
rallyContent.appendChild(searchWrapper);

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
var openTabsRow = el('div',{style:'display:flex;gap:8px;justify-content:center;align-items:center;flex-wrap:wrap;'});

var fakeModeWrapper = el('label',{style:'display:flex;align-items:center;gap:6px;color:#bbb;font-size:12px;cursor:pointer;'});
var fakeModeCheckbox = el('input',{type:'checkbox', style:'cursor:pointer;'});
var fakeModeLabel = el('span',{innerText:'Fake Mode (limit by available units)'});
fakeModeWrapper.appendChild(fakeModeCheckbox);
fakeModeWrapper.appendChild(fakeModeLabel);

var btnOpenTabs = el('button',{innerText:'Open Tabs', style:'cursor:pointer;padding:10px 24px;background:#2a5a2a;color:#fff;border:1px solid #3a7a3a;border-radius:4px;font-weight:bold;font-size:14px;', type:'button'});

openTabsRow.appendChild(fakeModeCheckbox);
openTabsRow.appendChild(fakeModeLabel);
openTabsRow.appendChild(btnOpenTabs);
rallyContent.appendChild(openTabsRow);

body.appendChild(rallySection);

// Rally collapse handler
rallyCollapseBtn.onclick = function(){
if(rallyContent.style.display === 'none'){
rallyContent.style.display = 'block';
rallyCollapseBtn.innerText = '−';
} else {
rallyContent.style.display = 'none';
rallyCollapseBtn.innerText = '+';
}
};

// Attack Plan section
var attackPlanSection = el('div',{style:'margin-bottom:12px;padding:12px;background:#0f0f0f;border-radius:6px;border:1px solid #333;'});
var attackPlanHeader = el('div',{style:'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;'});
var attackPlanTitle = el('div',{style:'font-weight:bold;color:#aaa;text-align:center;font-size:13px;flex:1;'});
attackPlanTitle.textContent = 'Attack Plans';
var attackPlanCollapseBtn = el('button',{innerText:'+', style:'cursor:pointer;padding:2px 8px;background:#2a2a2a;color:#fff;border:1px solid #4a4a4a;border-radius:3px;font-size:16px;font-weight:bold;line-height:1;', type:'button'});
attackPlanHeader.appendChild(attackPlanTitle);
attackPlanHeader.appendChild(attackPlanCollapseBtn);
attackPlanSection.appendChild(attackPlanHeader);

var attackPlanContent = el('div',{style:'display:none;'});
attackPlanSection.appendChild(attackPlanContent);

var attackPlanRow = el('div',{style:'display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-bottom:8px;'});
attackPlanContent.appendChild(attackPlanRow);

body.appendChild(attackPlanSection);

var btnPasteAttackPlan = el('button',{innerText:'Paste Attack Plan', style:'cursor:pointer;padding:8px 16px;background:#5a3a2a;color:#fff;border:1px solid #7a5a3a;border-radius:4px;', type:'button'});
var btnLoadAttackPlan = el('button',{innerText:'Load Attack Plan', style:'cursor:pointer;padding:8px 16px;background:#3a2a5a;color:#fff;border:1px solid #5a3a7a;border-radius:4px;', type:'button'});
attackPlanRow.appendChild(btnPasteAttackPlan);
attackPlanRow.appendChild(btnLoadAttackPlan);

var attackPlanContainer = el('div',{id:'attack_plan_groups', style:'display:none;margin-top:8px;'});
attackPlanContent.appendChild(attackPlanContainer);

// Attack Plan collapse handler
attackPlanCollapseBtn.onclick = function(){
if(attackPlanContent.style.display === 'none'){
attackPlanContent.style.display = 'block';
attackPlanCollapseBtn.innerText = '−';
} else {
attackPlanContent.style.display = 'none';
attackPlanCollapseBtn.innerText = '+';
}
};

msgBox = el('div',{style:'margin-bottom:12px;color:#9f9f9f;min-height:18px;text-align:center;padding:6px;background:#0a0a0a;border-radius:4px;border:1px solid #2a2a2a;'});
body.appendChild(msgBox);

var footer = el('div',{style:'padding:12px;background:linear-gradient(135deg, #1a1a1a 0%, #0a0a0a 100%);border-bottom-left-radius:6px;border-bottom-right-radius:6px;border-top:2px solid #444;text-align:center;'});
var author = el('div',{style:'font-size:12px;color:#888;text-shadow:1px 1px 2px rgba(0,0,0,0.6);letter-spacing:0.5px;'});
author.textContent = 'Created by NeilB';
footer.appendChild(author);
container.appendChild(footer);

document.body.appendChild(container);

// Make draggable - title bar and body (excluding interactive elements)
(function(){
var isDragging = false;
var startX = 0;
var startY = 0;
var initialLeft = 0;
var initialTop = 0;

function startDrag(e) {
e = e || window.event;
var target = e.target || e.srcElement;
// Don't drag if clicking on buttons, inputs, textareas, selects, or labels
if(target === closeBtn || target === btnConfig) return;
if(target.tagName === 'BUTTON' || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.tagName === 'LABEL') return;
// Don't drag if clicking inside sections with interactive content
if(target.closest && (target.closest('input') || target.closest('textarea') || target.closest('button') || target.closest('select') || target.closest('label'))) return;
e.preventDefault();
isDragging = true;
startX = e.clientX;
startY = e.clientY;
var rect = container.getBoundingClientRect();
initialLeft = rect.left;
initialTop = rect.top;
document.onmousemove = onMouseMove;
document.onmouseup = onMouseUp;
}

titleBar.onmousedown = startDrag;
body.onmousedown = startDrag;

function onMouseMove(e) {
if(!isDragging) return;
e = e || window.event;
e.preventDefault();
var deltaX = e.clientX - startX;
var deltaY = e.clientY - startY;
var newLeft = initialLeft + deltaX;
var newTop = initialTop + deltaY;
// Keep window visible - prevent dragging completely off screen
var minVisible = 50; // pixels
var maxLeft = window.innerWidth - minVisible;
var maxTop = window.innerHeight - minVisible;
newLeft = Math.max(-container.offsetWidth + minVisible, Math.min(newLeft, maxLeft));
newTop = Math.max(0, Math.min(newTop, maxTop));
container.style.left = newLeft + 'px';
container.style.top = newTop + 'px';
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

// Auto-fetch village.txt if older than 24 hours
(function(){
try{
var lastFetch = localStorage.getItem('tw_villages_updated');
if(!lastFetch){
// Never fetched, try to fetch now
showMessage('Fetching village.txt (first time)...');
tryFetchVillagesFromServer().then(function(txt){
if(!txt) throw new Error('Empty');
saveVillagesText(txt);
villagesArr = parseVillagesTxt(txt);
villagesIndex = buildCoordIndex(villagesArr);
showMessage('village.txt loaded (' + villagesArr.length + ' entries)');
}).catch(function(err){
showMessage('Could not auto-fetch village.txt');
});
} else {
var timeSince = Date.now() - Number(lastFetch);
var twentyFourHours = 24 * 60 * 60 * 1000;
if(timeSince > twentyFourHours){
showMessage('Fetching village.txt (24h update)...');
tryFetchVillagesFromServer().then(function(txt){
if(!txt) throw new Error('Empty');
saveVillagesText(txt);
villagesArr = parseVillagesTxt(txt);
villagesIndex = buildCoordIndex(villagesArr);
showMessage('village.txt updated (' + villagesArr.length + ' entries)');
}).catch(function(err){
showMessage('Auto-update failed, using cached data');
});
}
}
}catch(e){
console.error('Auto-fetch error:', e);
}
})();

// Server time utilities - DEFINE FUNCTION FIRST
function getServerTime(){
try{
// Parse from the game header - time and date are in separate elements
var serverTimeEl = document.getElementById('serverTime');
var serverDateEl = document.getElementById('serverDate');
if(serverTimeEl && serverDateEl){
var timeText = serverTimeEl.textContent.trim();
var dateText = serverDateEl.textContent.trim();
// Parse time format like "16:39:47"
var timeMatch = timeText.match(/(\d{2}):(\d{2}):(\d{2})/);
// Parse date format like "26/01/2026"
var dateMatch = dateText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
if(timeMatch && dateMatch){
var day = parseInt(dateMatch[1]);
var month = parseInt(dateMatch[2]) - 1;
var year = parseInt(dateMatch[3]);
var hour = parseInt(timeMatch[1]);
var minute = parseInt(timeMatch[2]);
var second = parseInt(timeMatch[3]);
return new Date(year, month, day, hour, minute, second);
}
}

// Fallback to local time if server time unavailable
console.warn('Server time not found, using local time');
return new Date();
}catch(e){
console.error('Error getting server time:', e);
return new Date();
}
}

// Store server time offset - CALL AFTER FUNCTION IS DEFINED
var serverTimeOffset = 0;
(function(){
try{
var serverTime = getServerTime();
var localTime = new Date();
if(serverTime && serverTime.getTime){
// Server time - Local time gives us the offset
// If server is GMT+0 and local is GMT+1, server is 1 hour behind
// So serverTime - localTime will be negative (e.g., -3600000 ms = -1 hour)
var rawOffset = serverTime.getTime() - localTime.getTime();
// Round to nearest hour since timezones are always in whole hours
var oneHour = 60 * 60 * 1000; // 3600000 ms
serverTimeOffset = Math.round(rawOffset / oneHour) * oneHour;
console.log('Local time:', localTime.toISOString());
console.log('Server time:', serverTime.toISOString());
console.log('Server time offset (raw):', rawOffset, 'ms');
console.log('Server time offset (rounded to hour):', serverTimeOffset, 'ms', '(' + (serverTimeOffset / oneHour) + ' hours)');
} else {
console.warn('Could not calculate server time offset - serverTime invalid');
}
}catch(e){
console.error('Error calculating server time offset:', e);
}
})();

function getCurrentServerTime(){
var now = new Date();
return new Date(now.getTime() + serverTimeOffset);
}

// Template System
var unitTemplates = {};
var currentTemplate = null;

// Load templates from localStorage
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
var noneOpt = el('option',{value:'', innerText:'-- Select Template --'});
templateSelect.appendChild(noneOpt);
var keys = Object.keys(unitTemplates).sort();
for(var i=0;i<keys.length;i++){
var opt = el('option',{value:keys[i], innerText:keys[i]});
templateSelect.appendChild(opt);
}
if(currentTemplate && unitTemplates[currentTemplate]){
templateSelect.value = currentTemplate;
loadTemplateIntoEditor(currentTemplate);
} else {
templateSelect.value = '';
currentTemplate = null;
templateEditor.style.display = 'none';
}
}

function loadTemplateIntoEditor(templateName){
if(!templateName || !unitTemplates[templateName]){
templateEditor.style.display = 'none';
return;
}
  
var template = unitTemplates[templateName];
templateEditor.style.display = 'block';
  
// Set mode
if(template.mode === 'send'){
sendModeRadio.checked = true;
sendModeRow.style.background = '#1a3a1a';
keepModeRow.style.background = '#0f0f0f';
} else {
keepModeRadio.checked = true;
keepModeRow.style.background = '#1a3a1a';
sendModeRow.style.background = '#0f0f0f';
}
  
// Clear all inputs first
for(var unitType in unitInputs){
unitInputs[unitType].value = '';
keepUnitInputs[unitType].value = '';
}
  
// Set unit values in the correct input set based on mode
var inputsToSet = template.mode === 'send' ? unitInputs : keepUnitInputs;
for(var unitType in inputsToSet){
inputsToSet[unitType].value = template.units[unitType] || '';
}
}

function saveCurrentTemplate(){
if(!currentTemplate) return;
  
var mode = sendModeRadio.checked ? 'send' : 'keep';
var units = {};
  
// Get values from the appropriate input set based on mode
var inputsToRead = mode === 'send' ? unitInputs : keepUnitInputs;
  
for(var unitType in inputsToRead){
var val = inputsToRead[unitType].value.trim();
if(val && val !== '0'){
units[unitType] = parseInt(val);
}
}
  
unitTemplates[currentTemplate] = {
mode: mode,
units: units
};
  
saveTemplates();
}

function showTemplateEditor(templateName){
// This function is now obsolete - keeping for compatibility
}

// Template button handlers
btnNewTemplate.onclick = function(){
var name = prompt('Enter template name:');
if(!name || !name.trim()){
return;
}
name = name.trim();
if(unitTemplates[name]){
alert('A template with this name already exists');
return;
}
  
// Create new template with defaults
unitTemplates[name] = {
mode: 'send',
units: {}
};
saveTemplates();
currentTemplate = name;
refreshTemplateSelect();
showMessage('Template "' + name + '" created');
};

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
var selected = templateSelect.value;
if(selected){
currentTemplate = selected;
loadTemplateIntoEditor(selected);
showMessage('Template "' + currentTemplate + '" selected');
} else {
currentTemplate = null;
templateEditor.style.display = 'none';
showMessage('No template selected');
}
};

// Load templates on start
loadTemplates();
refreshTemplateSelect();

// Function to read units from combined overview for a specific village
function getVillageUnitsFromOverview(villageId){
var units = {};
try{
// Find the row in combined table for this village
var combinedTable = document.getElementById('combined_table');
if(!combinedTable){
console.log('Combined table not found');
return units;
}
  
// Find the row with this village ID
var rows = combinedTable.querySelectorAll('tr');
for(var i=0;i<rows.length;i++){
var row = rows[i];
// Look for village link with matching ID
var villageSpan = row.querySelector('span.quickedit-vn[data-id="' + villageId + '"]');
if(!villageSpan) continue;
  
console.log('Found village row for ID:', villageId);
  
// Extract unit counts from cells with class "unit-item"
var unitCells = row.querySelectorAll('td.unit-item');
console.log('Found unit cells:', unitCells.length);
  
// Map each cell to corresponding unit type
for(var j=0;j<unitCells.length && j<UNIT_TYPES.length;j++){
var count = parseInt(unitCells[j].textContent.trim()) || 0;
units[UNIT_TYPES[j]] = count;
console.log('Unit:', UNIT_TYPES[j], '=', count);
}
  
break;
}
  
console.log('Units extracted for village', villageId, ':', units);
}catch(e){
console.error('Error reading units from overview:', e);
}
return units;
}

// Function to calculate units to send based on template
function calculateUnitsToSend(availableUnits, template){
var unitsToSend = {};
var mode = template.mode;
var config = template.units;
  
for(var unitType in availableUnits){
var available = availableUnits[unitType] || 0;
var templateValue = config[unitType] || 0;
var toSend = 0;
  
if(mode === 'send'){
// Send X units - send exactly the amount specified (or all if less available)
toSend = Math.min(templateValue, available);
} else if(mode === 'keep'){
// Keep X units at home - send everything except the reserve
toSend = Math.max(0, available - templateValue);
}
  
if(toSend > 0){
unitsToSend[unitType] = toSend;
}
}
  
return unitsToSend;
}

// Function to build URL with unit template
function buildRallyUrlWithTemplate(forVillageId, targetVillageId){
var baseUrl = buildRallyUrl(forVillageId, targetVillageId);
  
if(!currentTemplate || !unitTemplates[currentTemplate]){
return baseUrl;
}
  
// Read available units from the overview page
var availableUnits = getVillageUnitsFromOverview(forVillageId);
console.log('Available units for village ' + forVillageId + ':', availableUnits);
  
// Calculate units to send
var unitsToSend = calculateUnitsToSend(availableUnits, unitTemplates[currentTemplate]);
console.log('Units to send:', unitsToSend);
  
// Add units as URL parameters
try{
var url = new URL(baseUrl);
for(var unitType in unitsToSend){
url.searchParams.set(unitType, unitsToSend[unitType]);
}
return url.toString();
}catch(e){
// Fallback for older browsers
var params = [];
for(var ut in unitsToSend){
params.push(ut + '=' + unitsToSend[ut]);
}
return baseUrl + (baseUrl.indexOf('?') > -1 ? '&' : '?') + params.join('&');
}
}

// Function to get villages from current in-game group
function getVillagesFromCurrentGroup(){
var villages = [];
try{
// Method 1: Check URL for current group
var currentUrl = window.location.href;
var groupMatch = currentUrl.match(/[?&]group=(\d+)/);
var currentGroupId = groupMatch ? groupMatch[1] : '0';
console.log('Current group ID:', currentGroupId);
    
// Method 2: Check for selected group in dropdown
var groupSelect = document.getElementById('group_id');
if(groupSelect){
currentGroupId = groupSelect.value;
console.log('Group from dropdown:', currentGroupId);
}
    
// Get villages from combined table that belong to this group
var combinedTable = document.getElementById('combined_table');
if(!combinedTable){
console.log('Combined table not found');
return villages;
}
    
var rows = combinedTable.querySelectorAll('tr');
for(var i=0;i<rows.length;i++){
var row = rows[i];
var villageSpan = row.querySelector('span.quickedit-vn[data-id]');
if(!villageSpan) continue;
      
var villageId = villageSpan.getAttribute('data-id');
var villageName = villageSpan.textContent.trim();
      
// Extract coordinates from village name
var coordMatch = villageName.match(/\((\d+)\|(\d+)\)/);
if(coordMatch){
var x = coordMatch[1];
var y = coordMatch[2];
villages.push({
id: villageId,
coord: x + '|' + y,
name: villageName
});
console.log('Found village in group:', villageId, x + '|' + y);
}
}
    
console.log('Total villages in current group:', villages.length);
}catch(e){
console.error('Error getting villages from group:', e);
}
return villages;
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
var baseUrl = window.location.origin + window.location.pathname;
var url = new URL(baseUrl);
url.searchParams.set('screen','place');
url.searchParams.set('village', forVillageId);
url.searchParams.set('target', targetVillageId);
return url.toString();
}catch(e){
return location.origin + '/game.php?village=' + encodeURIComponent(forVillageId) + '&screen=place&target=' + encodeURIComponent(targetVillageId);
}
}

function prepareTabsFromPairs(fromCoords, toCoords){
var maxLen = Math.max(fromCoords.length, toCoords.length);
var pairs = [];
var failed = [];
  
// First, create all coordinate pairs
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
pairs.push({fromId: fromId, toId: toId, fromCoord: fromCoord, toCoord: toCoord, index: i+1});
}
  
if(pairs.length === 0){
showMessage('No valid pairs found - check your coordinates');
if(failed.length > 0){
console.log('Rally Opener failures:', failed);
}
return [];
}
  
// Check if Fake Mode is enabled
var isFakeMode = fakeModeCheckbox.checked;
  
if(isFakeMode && currentTemplate && unitTemplates[currentTemplate]){
console.log('Fake Mode enabled - checking unit availability');
    
// Group pairs by FROM village
var villageGroups = {};
for(var j=0;j<pairs.length;j++){
var pair = pairs[j];
if(!villageGroups[pair.fromId]){
villageGroups[pair.fromId] = [];
}
villageGroups[pair.fromId].push(pair);
}
    
// For each village, calculate how many attacks we can afford
var finalPairs = [];
for(var villageId in villageGroups){
var villagePairs = villageGroups[villageId];
var availableUnits = getVillageUnitsFromOverview(villageId);
var template = unitTemplates[currentTemplate];
      
// Calculate how many attacks this village can support
var maxAttacks = calculateMaxAttacks(availableUnits, template);
console.log('Village', villageId, 'can support', maxAttacks, 'attacks out of', villagePairs.length, 'requested');
      
if(maxAttacks >= villagePairs.length){
// Can do all attacks
finalPairs = finalPairs.concat(villagePairs);
} else if(maxAttacks > 0){
// Randomly select which attacks to do
var shuffled = villagePairs.slice();
// Fisher-Yates shuffle
for(var k=shuffled.length-1;k>0;k--){
var randIdx = Math.floor(Math.random() * (k+1));
var temp = shuffled[k];
shuffled[k] = shuffled[randIdx];
shuffled[randIdx] = temp;
}
// Take only the first maxAttacks
for(var m=0;m<maxAttacks;m++){
finalPairs.push(shuffled[m]);
}
// Log skipped attacks
for(var n=maxAttacks;n<shuffled.length;n++){
failed.push('Row ' + shuffled[n].index + ': insufficient units (randomly skipped in Fake Mode)');
}
} else {
// Can't do any attacks from this village
for(var p=0;p<villagePairs.length;p++){
failed.push('Row ' + villagePairs[p].index + ': insufficient units in village');
}
}
}
    
pairs = finalPairs;
}
  
// Build URLs
var urls = [];
for(var q=0;q<pairs.length;q++){
var url = buildRallyUrlWithTemplate(pairs[q].fromId, pairs[q].toId);
urls.push(url);
}
  
if(urls.length === 0){
showMessage('No valid pairs found - check your coordinates and available units');
if(failed.length > 0){
console.log('Rally Opener failures:', failed);
}
return [];
}
  
var msg = 'Prepared ' + urls.length + ' tab' + (urls.length > 1 ? 's' : '');
if(isFakeMode && failed.length > 0){
msg += ' (skipped ' + failed.length + ' due to unit limits)';
}
showMessage(msg + ' - ready to open!');
  
if(failed.length > 0){
console.log('Rally Opener warnings:', failed);
}
return urls;
}

// Calculate maximum number of attacks a village can support with given template
function calculateMaxAttacks(availableUnits, template){
if(!template || !template.units) return 0;
  
var mode = template.mode;
var config = template.units;
var maxAttacks = Infinity;
  
for(var unitType in config){
var required = config[unitType];
if(!required || required === 0) continue;
    
var available = availableUnits[unitType] || 0;
var possibleAttacks = 0;
    
if(mode === 'send'){
// Need exactly 'required' units per attack
possibleAttacks = Math.floor(available / required);
} else if(mode === 'keep'){
// Need to keep 'required' at home, send the rest
var canSend = Math.max(0, available - required);
possibleAttacks = canSend > 0 ? Infinity : 0;
}
    
maxAttacks = Math.min(maxAttacks, possibleAttacks);
}
  
return maxAttacks === Infinity ? 0 : maxAttacks;
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

// Config modal - create after attackPlanConfig is loaded
var configModal = el('div',{style:'position:fixed;left:0;top:0;width:100%;height:100%;background:rgba(0,0,0,0.7);z-index:100000;display:none;align-items:center;justify-content:center;'});
var configContent = el('div',{style:'background:#1a1a1a;color:#fff;padding:20px;border-radius:8px;border:2px solid #444;min-width:400px;max-width:600px;'});
var configTitle = el('div',{style:'font-size:18px;font-weight:bold;margin-bottom:16px;color:#e0e0e0;text-align:center;'});
configTitle.textContent = 'Settings';
configContent.appendChild(configTitle);

// Village data section
var villageDataSection = el('div',{style:'margin-bottom:16px;padding:12px;background:#0f0f0f;border-radius:6px;border:1px solid #333;'});
var villageDataTitle = el('div',{style:'font-weight:bold;margin-bottom:8px;color:#aaa;font-size:13px;'});
villageDataTitle.textContent = 'Village Data';
villageDataSection.appendChild(villageDataTitle);

var villageDataInfo = el('div',{style:'margin-bottom:8px;font-size:11px;color:#888;'});
villageDataSection.appendChild(villageDataInfo);

var villageDataButtons = el('div',{style:'display:flex;gap:8px;flex-wrap:wrap;'});
var btnGetConfig = el('button',{innerText:'Fetch village.txt', style:'cursor:pointer;padding:6px 12px;background:#2a5a2a;color:#fff;border:1px solid #3a7a3a;border-radius:4px;font-size:12px;', type:'button'});
var btnUploadConfig = el('button',{innerText:'Upload village.txt', style:'cursor:pointer;padding:6px 12px;background:#2a4a5a;color:#fff;border:1px solid:#3a6a7a;border-radius:4px;font-size:12px;', type:'button'});
var fileInput = el('input',{type:'file', accept:'.txt', style:'display:none'});
villageDataButtons.appendChild(btnGetConfig);
villageDataButtons.appendChild(btnUploadConfig);
villageDataButtons.appendChild(fileInput);
villageDataSection.appendChild(villageDataButtons);
configContent.appendChild(villageDataSection);

// Attack plan URL section
var attackPlanUrlSection = el('div',{style:'margin-bottom:16px;padding:12px;background:#0f0f0f;border-radius:6px;border:1px solid #333;'});
var attackPlanUrlTitle = el('div',{style:'font-weight:bold;margin-bottom:8px;color:#aaa;font-size:13px;'});
attackPlanUrlTitle.textContent = 'Attack Plan URL';
attackPlanUrlSection.appendChild(attackPlanUrlTitle);

var attackPlanUrlInput = el('input',{type:'text', value:attackPlanConfig.defaultUrl, placeholder:'API URL', style:'width:100%;padding:6px;background:#0a0a0a;color:#fff;border:1px solid #444;border-radius:4px;box-sizing:border-box;margin-bottom:8px;'});
attackPlanUrlSection.appendChild(attackPlanUrlInput);

var btnSaveUrl = el('button',{innerText:'Save URL', style:'cursor:pointer;padding:6px 12px;background:#2a5a2a;color:#fff;border:1px solid #3a7a3a;border-radius:4px;font-size:12px;', type:'button'});
attackPlanUrlSection.appendChild(btnSaveUrl);
configContent.appendChild(attackPlanUrlSection);

// Close config button
var configCloseRow = el('div',{style:'display:flex;justify-content:center;margin-top:16px;'});
var btnCloseConfig = el('button',{innerText:'Close', style:'cursor:pointer;padding:8px 24px;background:#444;color:#fff;border:1px solid #666;border-radius:4px;font-size:12px;', type:'button'});
configCloseRow.appendChild(btnCloseConfig);
configContent.appendChild(configCloseRow);

configModal.appendChild(configContent);
document.body.appendChild(configModal);

// Update village data info
function updateVillageDataInfo(){
var lastFetch = localStorage.getItem('tw_villages_updated');
if(!lastFetch){
villageDataInfo.textContent = 'No village data loaded';
villageDataInfo.style.color = '#cc6666';
} else {
var timeSince = Date.now() - Number(lastFetch);
var hours = Math.floor(timeSince / (60 * 60 * 1000));
var minutes = Math.floor((timeSince % (60 * 60 * 1000)) / (60 * 1000));
var timeStr = hours > 0 ? hours + 'h ' + minutes + 'm ago' : minutes + 'm ago';
villageDataInfo.textContent = 'Last updated: ' + timeStr + ' (' + villagesArr.length + ' villages)';
villageDataInfo.style.color = '#88cc88';
}
}

// Config button handler
btnConfig.addEventListener('click', function(){
updateVillageDataInfo();
attackPlanUrlInput.value = attackPlanConfig.defaultUrl;
configModal.style.display = 'flex';
});

// Close config modal
btnCloseConfig.addEventListener('click', function(){
configModal.style.display = 'none';
});

configModal.addEventListener('click', function(e){
if(e.target === configModal){
configModal.style.display = 'none';
}
});

// Save URL button
btnSaveUrl.addEventListener('click', function(){
var newUrl = attackPlanUrlInput.value.trim();
if(newUrl){
attackPlanConfig.defaultUrl = newUrl;
saveConfig();
showMessage('Attack plan URL saved');
} else {
showMessage('Please enter a valid URL');
}
});

// Upload button (in config)
btnUploadConfig.addEventListener('click', function(){ try{ fileInput.click(); }catch(e){} });

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
updateVillageDataInfo();
}catch(e){ 
showMessage('Failed to parse uploaded file'); 
} 
};
r.onerror = function(){ showMessage('Failed to read file'); };
r.readAsText(f);
fileInput.value = '';
});

// Get village.txt button (in config)
btnGetConfig.addEventListener('click', function(){
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
updateVillageDataInfo();
}).catch(function(err){
showMessage('Failed: ' + (err && err.message ? err.message : String(err)));
});
});

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
var now = getCurrentServerTime();
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
var now = getCurrentServerTime();
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
  
var fromCoords;
var toCoords = parseCoordinateList(toTextarea.value);
  
// Check if "Use current group" is enabled
if(useGroupCheckbox.checked){
console.log('Using current group for FROM coordinates');
var groupVillages = getVillagesFromCurrentGroup();
if(groupVillages.length === 0){
showMessage('No villages found in current group');
return;
}
fromCoords = groupVillages.map(function(v){ return v.coord; });
console.log('From group coords:', fromCoords);
} else {
fromCoords = parseCoordinateList(fromTextarea.value);
console.log('From manual coords:', fromCoords);
}
  
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

showMessage('Rally Opener ready!');

} // End of page check

}