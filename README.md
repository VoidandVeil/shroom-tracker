# shroom-tracker – non‑coder bundle

This page contains everything a non‑coder needs: **files** and **click-by-click steps**. Copy/paste the files into Apps Script, then run one menu item.

---

## ✅ One‑time steps (no coding)

1. **Make/Link a Google Form** for your entries (any fields; responses will land in a sheet tab named **Form Responses 1**).
2. In the linked Sheet: **Extensions → Apps Script**.
3. Create two files in Apps Script:

   * `Code.gs` → paste the code below.
   * `Web.html` → paste the HTML below.
4. Apps Script → **Project Settings** → **Time zone** = `Europe/Stockholm`.
5. Back in the Sheet, a new menu **Tracker** will appear.
6. Click **Tracker → Setup**. It will:

   * Set spreadsheet **locale = en\_US** and **timezone = Europe/Stockholm**
   * Ensure the responses tab has **J1 = CalendarEventId**
   * Create a dashboard tab **Sheet1** and insert all formulas automatically
   * Install triggers (Form submit, Edit, Daily 18:00 digest)
7. Submit a test Form entry (Next check = tomorrow). You should see a **Calendar event 18:00–19:00**, and column **J** gets an event ID.

---

## 📄 Code.gs (paste entire file)

```javascript
/***** CONFIG *****/
const CAL_ID     = 'primary';             // or a specific calendar ID
const EVENT_HOUR = 18;                    // 18:00 local time
const EVENT_DURATION_MIN = 60;            // minutes
const POPUP_MIN_BEFORE = 10;              // reminder minutes before (null to disable)

const DEFAULT_TZ     = 'Europe/Stockholm';
const DEFAULT_LOCALE = 'en_US';

// Responses tab name (English default)
const RESP_SHEET_NAME = 'Form Responses 1';

// Column mapping (0-based) for A..J in responses tab
const COL = { ID:1, STRAIN:3, NEXT_CHECK:5, STATUS:6, EVENT_ID:9 };

/***** MENU *****/
function onOpen(){
  SpreadsheetApp.getUi().createMenu('Tracker')
    .addItem('Setup','setup_')
    .addItem('Open GUI','openGui_')
    .addItem('Reinstall triggers','installTriggers_')
    .addToUi();
}

/***** SETUP *****/
function setup_(){
  const ss = SpreadsheetApp.getActive();
  ensureLocaleAndTimezone_(ss);
  const resp = getRespSheet_();
  if (!resp) throw new Error('Could not find responses tab "' + RESP_SHEET_NAME + '". Link your Google Form to this sheet first.');

  // Ensure CalendarEventId header in J1
  const j1 = String(resp.getRange(1, COL.EVENT_ID+1).getValue()||'').trim();
  if (j1 !== 'CalendarEventId') resp.getRange(1, COL.EVENT_ID+1).setValue('CalendarEventId');

  // Create/refresh dashboard with formulas
  ensureDashboard_(ss, resp);

  // Triggers
  installTriggers_();

  SpreadsheetApp.getUi().alert('Setup complete!\n\n• Locale/timezone set\n• Dashboard ready (Sheet1)\n• Triggers installed (submit/edit/daily 18:00)\n\nSubmit a test form with a Next check date to see a 18:00 calendar event.');
}

/***** LOCALE & TIMEZONE *****/
function ensureLocaleAndTimezone_(ss){
  try{
    if (ss.getSpreadsheetTimeZone() !== DEFAULT_TZ){ ss.setSpreadsheetTimeZone(DEFAULT_TZ); }
    const meta = Sheets.Spreadsheets.get(ss.getId(), {fields:'properties.locale'});
    const currLocale = meta && meta.properties && meta.properties.locale;
    if (currLocale !== DEFAULT_LOCALE){
      Sheets.Spreadsheets.batchUpdate({
        requests:[{ updateSpreadsheetProperties:{ properties:{ locale: DEFAULT_LOCALE }, fields:'locale' } }]
      }, ss.getId());
    }
  }catch(e){ Logger.log('ensureLocaleAndTimezone_ error: '+e); }
}

/***** DASHBOARD (Sheet1 + formulas) *****/
function ensureDashboard_(ss, resp){
  const name = 'Sheet1';
  let dash = ss.getSheetByName(name);
  if (!dash) dash = ss.insertSheet(name);

  const headers = ['Timestamp','ID','Type','Strain','Date_Inoculated','Next_Check','Status','Notes','Photo','CalendarEventId','Days_Since','Overdue?'];
  dash.getRange(1,1,1,headers.length).setValues([headers]);

  // Mirror responses A..J
  dash.getRange('A2').setFormula("=ARRAYFORMULA('"+RESP_SHEET_NAME+"'!A2:J)");
  // Days since E (Date_Inoculated)
  dash.getRange('K2').setFormula("=ARRAYFORMULA(IF(E2:E=\"\",\"\",TODAY()-E2:E))");
  // Overdue flag if F < today and Status != Retired
  dash.getRange('L2').setFormula("=ARRAYFORMULA(IF(F2:F=\"\",\"\",IF((F2:F<TODAY())*(G2:G<>\"Retired\"),\"⚠️\",\"\")))");
}

/***** TRIGGERS *****/
function installTriggers_(){
  ScriptApp.getProjectTriggers().forEach(t=>ScriptApp.deleteTrigger(t));
  const ssId = SpreadsheetApp.getActive().getId();
  ScriptApp.newTrigger('onFormSubmit_').forSpreadsheet(ssId).onFormSubmit().create();
  ScriptApp.newTrigger('onEditInstallable_').forSpreadsheet(ssId).onEdit().create();
  ScriptApp.newTrigger('sendDailyDigest_').timeBased().everyDays(1).atHour(EVENT_HOUR).create();
}

/***** EVENT HANDLERS *****/
function onFormSubmit_(e){ if (e && e.range) processRow_(e.range.getRow()); }
function onEditInstallable_(e){
  const sh = e.range.getSheet();
  if (sh.getName() !== RESP_SHEET_NAME) return;
  const c = e.range.getColumn();
  if (![COL.ID+1, COL.STRAIN+1, COL.NEXT_CHECK+1, COL.STATUS+1].includes(c)) return;
  processRow_(e.range.getRow());
}

/***** CORE: responses row → Calendar event *****/
function processRow_(row){
  const sh = getRespSheet_();
  const v = sh.getRange(row,1,1,10).getValues()[0]; // A..J
  const id=v[COL.ID], strain=v[COL.STRAIN], next=v[COL.NEXT_CHECK], status=v[COL.STATUS], existing=v[COL.EVENT_ID];
  const cal = CalendarApp.getCalendarById(CAL_ID);

  // Retired: remove event and clear J
  if (status === 'Retired'){
    if (existing){ try{ const ev=cal.getEventById(existing); if(ev) ev.deleteEvent(); }catch(e){} }
    sh.getRange(row, COL.EVENT_ID+1).clearContent();
    return;
  }

  if (!id || !next) return;
  const d = (next instanceof Date) ? next : new Date(next);
  if (isNaN(d)) return;
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), EVENT_HOUR, 0, 0);
  const end   = new Date(start.getTime() + EVENT_DURATION_MIN * 60000);
  const title = `Check ${id}${strain ? ' – ' + strain : ''}`;

  let ev=null; if (existing){ try{ ev = cal.getEventById(existing); }catch(e){} }
  if (ev){ ev.setTitle(title); ev.setTime(start,end); }
  else {
    ev = cal.createEvent(title, start, end, { description:`Auto for ${id}` });
    if (POPUP_MIN_BEFORE != null) ev.addPopupReminder(POPUP_MIN_BEFORE);
    sh.getRange(row, COL.EVENT_ID+1).setValue(ev.getId());
  }
}

/***** DAILY DIGEST (18:00) *****/
function sendDailyDigest_(){
  const sh = getRespSheet_();
  const vals = sh.getDataRange().getValues().slice(1);
  const tz = SpreadsheetApp.getActive().getSpreadsheetTimeZone();
  const today = new Date(); today.setHours(0,0,0,0);
  const due=[], overdue=[];

  vals.forEach(r=>{
    const id=r[COL.ID], type=r[2], strain=r[COL.STRAIN], next=r[COL.NEXT_CHECK], status=r[COL.STATUS];
    if (!id || !next || status==='Retired') return;
    const d = (next instanceof Date) ? new Date(next) : new Date(next);
    if (isNaN(d)) return; d.setHours(0,0,0,0);
    if (d.getTime()===today.getTime()) due.push({id,type,strain});
    else if (d<today) overdue.push({id,type,strain,when:d});
  });

  if (!due.length && !overdue.length) return;
  const fmt = d=>Utilities.formatDate(d, tz, 'yyyy-MM-dd');
  let html = '<h3>Shroom Tracker – checks</h3>';
  if (due.length)     html += '<h4>Due today</h4><ul>'+due.map(x=>`<li><b>${x.id}</b> – ${x.strain||''} (${x.type})</li>`).join('')+'</ul>';
  if (overdue.length) html += '<h4>Overdue</h4><ul>'+overdue.map(x=>`<li><b>${x.id}</b> – ${x.strain||''} (${x.type}) • was '+fmt(x.when)+'</li>`).join('')+'</ul>';
  MailApp.sendEmail({ to:Session.getActiveUser().getEmail(), subject:'Shroom Tracker – daily digest', htmlBody: html });
}

/***** WEB APP + IN-SHEET GUI *****/
function doGet(){ return HtmlService.createHtmlOutputFromFile('Web').setTitle('Shroom Tracker'); }
function openGui_(){ SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutputFromFile('Web').setWidth(1100).setHeight(700), 'Shroom Tracker'); }

// Return JSON to avoid transport quirks
function getRows(){
  const sh = getRespSheet_(); const vals = sh.getDataRange().getValues(); if (vals.length<2) return JSON.stringify([]);
  const out=[]; for (let r=1;r<vals.length;r++){ const v=vals[r]; out.push({ row:r+1, id:v[COL.ID], strain:v[COL.STRAIN], nextCheck:v[COL.NEXT_CHECK], status:v[COL.STATUS], notes:v[7], photo:v[8], eventId:v[COL.EVENT_ID] }); }
  return JSON.stringify(out);
}
function updateStatus(id,s){ const row=findRowById_(id); if(!row) return getRows(); const sh=getRespSheet_(); sh.getRange(row,COL.STATUS+1).setValue(s); processRow_(row); return getRows(); }
function setNextCheck(id,iso){ const row=findRowById_(id); if(!row) return getRows(); const d=new Date(iso); if(isNaN(d)) return getRows(); const sh=getRespSheet_(); sh.getRange(row,COL.NEXT_CHECK+1).setValue(d); processRow_(row); return getRows(); }
function snoozeDays(id,days){ const row=findRowById_(id); if(!row) return getRows(); const sh=getRespSheet_(); let c=sh.getRange(row,COL.NEXT_CHECK+1).getValue(); if(!(c instanceof Date)) c=new Date(); const next=new Date(c.getFullYear(),c.getMonth(),c.getDate()+Number(days)); sh.getRange(row,COL.NEXT_CHECK+1).setValue(next); processRow_(row); return getRows(); }
function appendPhotoLink(id,url){ const row=findRowById_(id); if(!row) return getRows(); const sh=getRespSheet_(); const cell=sh.getRange(row,9); const link=String(url||'').trim(); if(!link) return getRows(); const prev=String(cell.getValue()||'').trim(); cell.setValue(prev? (prev+'\n'+link) : link); return getRows(); }
function saveNotes(id,notes){ const row=findRowById_(id); if(!row) return getRows(); getRespSheet_().getRange(row,8).setValue(notes); return getRows(); }
function deleteItem(id){ const row=findRowById_(id); if(!row) return getRows(); const sh=getRespSheet_(); const evId=sh.getRange(row,COL.EVENT_ID+1).getValue(); if(evId){ try{ CalendarApp.getCalendarById(CAL_ID).getEventById(evId).deleteEvent(); }catch(e){} } sh.deleteRow(row); return getRows(); }

/***** HELPERS *****/
function getRespSheet_(){ return SpreadsheetApp.getActive().getSheetByName(RESP_SHEET_NAME); }
function findRowById_(id){ const sh=getRespSheet_(); const ids=sh.getRange(2, COL.ID+1, Math.max(sh.getLastRow()-1,0), 1).getValues().flat(); const idx=ids.findIndex(v=>String(v).trim()===String(id).trim()); return idx===-1?null:idx+2; }
```

---

## 🧩 Web.html (paste entire file)

```html
<!doctype html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Shroom Tracker</title>
  <style>
    :root{--bg:#fff;--text:#111;--surface:#fff;--muted:#f6f6f6;--border:#ddd;--pill:#eee;--accent:#4c8bf5;--overdue:#fff3f0;--input:#fafafa;--link:#1a73e8;--danger:#c62828;--dangerText:#fff}
    [data-theme="dark"]{--bg:#0f1115;--text:#e8eaed;--surface:#1a1d24;--muted:#222633;--border:#2b3040;--pill:#30364a;--accent:#8ab4f8;--overdue:#1f2738;--input:#141822;--link:#8ab4f8;--danger:#d64545;--dangerText:#fff}
    body{font-family:system-ui;margin:16px;max-width:1100px;background:var(--bg);color:var(--text)}
    header{display:flex;justify-content:space-between;align-items:center;gap:8px}
    table{width:100%;border-collapse:collapse;margin-top:12px;background:var(--surface)}
    th,td{border:1px solid var(--border);padding:6px;font-size:13px;vertical-align:top}
    th{background:var(--muted);position:sticky;top:0}
    .btn{background:var(--accent);color:#fff;border:none;padding:6px 10px;cursor:pointer;border-radius:6px}
    .btn-danger{background:var(--danger);color:var(--dangerText)}
    .overdue{background:var(--overdue)}
    input,select,textarea{border:1px solid var(--border);border-radius:6px;padding:6px;background:var(--input);color:var(--text)}
  </style>
</head>
<body onload="initTheme(); reload()">
  <header>
    <h2>Shroom Tracker</h2>
    <div style="display:flex;gap:8px;align-items:center">
      <a class="btn" href="#" onclick="openForm()">+ New entry (Form)</a>
      <button id="themeBtn" class="btn">🌙</button>
      <span id="count"></span>
    </div>
  </header>

  <div style="margin:8px 0; display:flex; gap:8px; flex-wrap:wrap">
    <input id="search" placeholder="Search ID / Strain" oninput="render()" />
    <select id="byStatus" onchange="render()">
      <option value="">All statuses</option>
      <option>Planned</option><option>Incubating</option><option>Fruiting</option><option>Ready</option><option>Retired</option>
    </select>
    <button class="btn" onclick="reload()">Reload</button>
    <span id="err" style="color:#b00020"></span>
  </div>

  <table id="grid">
    <thead>
      <tr><th>ID</th><th>Strain</th><th>Next check</th><th>Status</th><th>Notes</th><th>Photos</th><th>Actions</th></tr>
    </thead>
    <tbody></tbody>
  </table>

<script>
let ROWS=[]; const THEME_KEY='mt_theme';
function setTheme(t){document.documentElement.dataset.theme=t;localStorage.setItem(THEME_KEY,t);document.getElementById('themeBtn').textContent=(t==='dark'?'☀️':'🌙');}
function initTheme(){const s=localStorage.getItem(THEME_KEY); const sys=matchMedia('(prefers-color-scheme: dark)').matches; setTheme(s|| (sys?'dark':'light')); document.getElementById('themeBtn').onclick=()=>setTheme(document.documentElement.dataset.theme==='dark'?'light':'dark');}
function openForm(){ alert('Open your Google Form from your bookmarks. (If you want, replace openForm() with a hard-coded URL.)'); }

function reload(){
  document.getElementById('err').textContent='';
  google.script.run.withSuccessHandler(j=>{ try{ ROWS=(typeof j==='string')?JSON.parse(j):[]; }catch(e){ ROWS=[]; } render(); })
                   .withFailureHandler(e=>document.getElementById('err').textContent='Server: '+e.message)
                   .getRows();
}
function render(){
  const q=(document.getElementById('search').value||'').toLowerCase();
  const s=document.getElementById('byStatus').value;
  const tbody=document.querySelector('#grid tbody'); tbody.innerHTML='';
  const rows=(ROWS||[]).filter(r=>{ const hit=String(r.id||'').toLowerCase().includes(q)||String(r.strain||'').toLowerCase().includes(q); const st=!s||r.status===s; return hit&&st; });
  document.getElementById('count').textContent=rows.length+' items';
  rows.forEach(r=>{
    const tr=document.createElement('tr'); if(isOverdue(r.nextCheck,r.status)) tr.classList.add('overdue');
    tr.innerHTML=
      `<td>${esc(r.id||'')}</td>
       <td>${esc(r.strain||'')}</td>
       <td><input type="date" value="${dateVal(r.nextCheck)}" onchange="uiNext('${enc(r.id)}', this.value)"></td>
       <td><select onchange="uiStat('${enc(r.id)}', this.value)">${opts(r.status)}</select></td>
       <td><textarea rows="2" style="width:220px" onblur="uiNote('${enc(r.id)}', this.value)">${r.notes?esc(r.notes):''}</textarea></td>
       <td>${linksHtml(r.photo)}<div style="margin-top:4px"><input placeholder="paste URL" style="width:180px" onkeydown="if(event.key==='Enter'){uiPhoto('${enc(r.id)}', this.value); this.value='';}"></div></td>
       <td><button class="btn" onclick="uiSnooze('${enc(r.id)}',2)">+2d</button> <button class="btn" onclick="uiSnooze('${enc(r.id)}',5)">+5d</button> <button class="btn" onclick="uiSnooze('${enc(r.id)}',7)">+7d</button> <button class="btn btn-danger" onclick="uiDel('${enc(r.id)}')">Delete</button></td>`;
    tbody.appendChild(tr);
  });
}
function linksHtml(txt){ if(!txt) return ''; return String(txt).split(/\r?\n+/).filter(Boolean).map(u=>`<div><a href="${esc(u)}" target="_blank" rel="noopener">link</a></div>`).join(''); }
function esc(s){return String(s||'').replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[m]));}
function enc(s){return encodeURIComponent(s);}
function dateVal(d){ if(!d) return ''; const dt=new Date(d); return isNaN(dt)?'':dt.toISOString().slice(0,10); }
function isOverdue(d,status){ if(!d||status==='Retired') return false; const dt=new Date(d); const t=new Date(); dt.setHours(0,0,0,0); t.setHours(0,0,0,0); return dt<t; }

function opts(curr){ return ['Planned','Incubating','Fruiting','Ready','Retired'].map(x=>`<option ${curr===x?'selected':''}>${x}</option>`).join(''); }
function uiStat(id,val){ id=decodeURIComponent(id); google.script.run.withSuccessHandler(reload).updateStatus(id,val); }
function uiNext(id,iso){ id=decodeURIComponent(id); google.script.run.withSuccessHandler(reload).setNextCheck(id,iso); }
function uiSnooze(id,d){ id=decodeURIComponent(id); google.script.run.withSuccessHandler(reload).snoozeDays(id,d); }
function uiNote(id,n){ id=decodeURIComponent(id); google.script.run.saveNotes(id,n); }
function uiPhoto(id,url){ id=decodeURIComponent(id); if(!url) return; google.script.run.withSuccessHandler(reload).appendPhotoLink(id,url); }
function uiDel(id){ id=decodeURIComponent(id); if(confirm('Delete '+id+'? This also removes its calendar event.')) google.script.run.withSuccessHandler(reload).deleteItem(id); }
</script>
</body>
</html>
```

---

## 🧾 appsscript.json (optional, for advanced users)

If you also manage the manifest, use this (adds Sheets Advanced Service for locale updates):

```json
{
  "timeZone": "Europe/Stockholm",
  "runtimeVersion": "V8",
  "oauthScopes": [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/script.scriptapp",
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/mail.send"
  ],
  "advancedServices": {
    "sheets": { "version": "v4", "enabled": true }
  }
}
```

---

## Notes

* The script expects the responses tab to be named **Form Responses 1**.
* Dashboard lives in **Sheet1** (auto-created).
* Events are timed at **18:00–19:00** in your spreadsheet’s timezone.
* Status **Retired** deletes the linked calendar event.
* Daily digest email goes to your account at **18:00**.
