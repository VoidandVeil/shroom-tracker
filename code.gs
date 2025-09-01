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
