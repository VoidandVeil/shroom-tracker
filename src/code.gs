/***** CONFIG *****/
const CAL_ID     = 'primary';             // or a specific calendar ID
const EVENT_HOUR = 18;                    // 18:00 local time
const EVENT_DURATION_MIN = 60;            // minutes
const POPUP_MIN_BEFORE = 10;              // reminder minutes before

const DEFAULT_TZ     = 'Europe/Stockholm';
const DEFAULT_LOCALE = 'en_US';

/***** AUTO-DETECT RESPONSE SHEET *****/
const RESP_NAME_CANDIDATES = ['Formulärsvar 1','Form Responses 1'];
const COL = { ID:1, STRAIN:3, NEXT_CHECK:5, STATUS:6, EVENT_ID:9 };

/***** LOCALE & TZ *****/
function ensureLocaleAndTimezone_(ss){
  try{
    if (ss.getSpreadsheetTimeZone() !== DEFAULT_TZ){
      ss.setSpreadsheetTimeZone(DEFAULT_TZ);
    }
    const meta = Sheets.Spreadsheets.get(ss.getId(), {fields:'properties.locale'});
    const currLocale = meta.properties.locale;
    if (currLocale !== DEFAULT_LOCALE){
      Sheets.Spreadsheets.batchUpdate({
        requests:[{updateSpreadsheetProperties:{properties:{locale:DEFAULT_LOCALE},fields:'locale'}}]
      }, ss.getId());
    }
  }catch(e){ Logger.log('Locale/TZ check: '+e); }
}

function getRespSheet_(){
  const ss=SpreadsheetApp.getActive();
  for(const name of RESP_NAME_CANDIDATES){ const sh=ss.getSheetByName(name); if(sh) return sh; }
  return ss.getSheets()[0];
}

/***** MENU *****/
function onOpen(){
  SpreadsheetApp.getUi().createMenu('Tracker')
    .addItem('Setup','setup_')
    .addItem('Open GUI','openGui_')
    .addToUi();
}

/***** SETUP *****/
function setup_(){
  const ss=SpreadsheetApp.getActive(); ensureLocaleAndTimezone_(ss);
  const sh=getRespSheet_();
  if(sh.getRange(1,COL.EVENT_ID+1).getValue()!=='CalendarEventId'){
    sh.getRange(1,COL.EVENT_ID+1).setValue('CalendarEventId');
  }
  installTriggers_();
  SpreadsheetApp.getUi().alert('Setup complete! New form entries will make 18:00 calendar events.');
}

/***** TRIGGERS *****/
function installTriggers_(){
  ScriptApp.getProjectTriggers().forEach(t=>ScriptApp.deleteTrigger(t));
  const ssId=SpreadsheetApp.getActive().getId();
  ScriptApp.newTrigger('onFormSubmit_').forSpreadsheet(ssId).onFormSubmit().create();
  ScriptApp.newTrigger('onEditInstallable_').forSpreadsheet(ssId).onEdit().create();
  ScriptApp.newTrigger('sendDailyDigest_').timeBased().everyDays(1).atHour(EVENT_HOUR).create();
}

/***** EVENT HANDLERS *****/
function onFormSubmit_(e){ processRow_(e.range.getRow()); }
function onEditInstallable_(e){
  if(e.range.getSheet().getName()!==getRespSheet_().getName()) return;
  if([COL.ID+1,COL.STRAIN+1,COL.NEXT_CHECK+1,COL.STATUS+1].includes(e.range.getColumn()))
    processRow_(e.range.getRow());
}

/***** CORE: row → calendar *****/
function processRow_(row){
  const sh=getRespSheet_(); const v=sh.getRange(row,1,1,10).getValues()[0];
  const id=v[COL.ID], strain=v[COL.STRAIN], next=v[COL.NEXT_CHECK], status=v[COL.STATUS], existing=v[COL.EVENT_ID];
  const cal=CalendarApp.getCalendarById(CAL_ID);
  if(status==='Retired'){ if(existing){try{cal.getEventById(existing).deleteEvent();}catch(e){}} sh.getRange(row,COL.EVENT_ID+1).clearContent(); return; }
  if(!id||!next) return;
  const d=(next instanceof Date)?next:new Date(next); if(isNaN(d)) return;
  const start=new Date(d.getFullYear(),d.getMonth(),d.getDate(),EVENT_HOUR,0,0);
  const end=new Date(start.getTime()+EVENT_DURATION_MIN*60000);
  const title=`Check ${id}${strain?' – '+strain:''}`;
  let ev=null; if(existing){try{ev=cal.getEventById(existing);}catch(e){}}
  if(ev){ ev.setTitle(title); ev.setTime(start,end); }
  else{ ev=cal.createEvent(title,start,end,{description:`Auto for ${id}`}); if(POPUP_MIN_BEFORE) ev.addPopupReminder(POPUP_MIN_BEFORE); sh.getRange(row,COL.EVENT_ID+1).setValue(ev.getId()); }
}

/***** DIGEST *****/
function sendDailyDigest_(){
  const sh=getRespSheet_(); const vals=sh.getDataRange().getValues().slice(1); const tz=sh.getParent().getSpreadsheetTimeZone();
  const today=new Date(); today.setHours(0,0,0,0); const due=[],over=[];
  vals.forEach(r=>{const id=r[COL.ID],strain=r[COL.STRAIN],next=r[COL.NEXT_CHECK],status=r[COL.STATUS]; if(!id||!next||status==='Retired')return; const d=(next instanceof Date)?new Date(next):new Date(next); if(isNaN(d))return; d.setHours(0,0,0,0); if(d.getTime()===today.getTime()) due.push({id,strain}); else if(d<today) over.push({id,strain,when:d});});
  if(!due.length&&!over.length) return;
  const fmt=d=>Utilities.formatDate(d,tz,'yyyy-MM-dd');
  let html='<h3>Mycology checks</h3>'; if(due.length) html+='<h4>Due today</h4><ul>'+due.map(x=>`<li>${x.id} – ${x.strain||''}</li>`).join('')+'</ul>'; if(over.length) html+='<h4>Overdue</h4><ul>'+over.map(x=>`<li>${x.id} – ${x.strain||''} (was '+fmt(x.when)+')</li>`).join('')+'</ul>';
  MailApp.sendEmail({to:Session.getActiveUser().getEmail(),subject:'Daily checks',htmlBody:html});
}

/***** WEB APP *****/
function doGet(){ return HtmlService.createHtmlOutputFromFile('Web'); }
function getRows(){ const sh=getRespSheet_(); const vals=sh.getDataRange().getValues(); if(vals.length<2) return JSON.stringify([]); const out=[]; for(let r=1;r<vals.length;r++){const v=vals[r]; out.push({row:r+1,id:v[COL.ID],strain:v[COL.STRAIN],nextCheck:v[COL.NEXT_CHECK],status:v[COL.STATUS],notes:v[7],photo:v[8],eventId:v[COL.EVENT_ID]});} return JSON.stringify(out); }
function updateStatus(id,s){const row=findRowById_(id); if(!row) return getRows(); const sh=getRespSheet_(); sh.getRange(row,COL.STATUS+1).setValue(s); processRow_(row); return getRows();}
function setNextCheck(id,iso){const row=findRowById_(id); if(!row) return getRows(); const d=new Date(iso); if(isNaN(d)) return getRows(); const sh=getRespSheet_(); sh.getRange(row,COL.NEXT_CHECK+1).setValue(d); processRow_(row); return getRows();}
function snoozeDays(id,days){const row=findRowById_(id); if(!row) return getRows(); const sh=getRespSheet_(); let c=sh.getRange(row,COL.NEXT_CHECK+1).getValue(); if(!(c instanceof Date)) c=new Date(); const next=new Date(c.getFullYear(),c.getMonth(),c.getDate()+Number(days)); sh.getRange(row,COL.NEXT_CHECK+1).setValue(next); processRow_(row); return getRows();}
function appendPhotoLink(id,url){const row=findRowById_(id); if(!row) return getRows(); const sh=getRespSheet_(); const cell=sh.getRange(row,9); const link=String(url||'').trim(); if(!link) return getRows(); const prev=String(cell.getValue()||'').trim(); cell.setValue(prev?prev+'\n'+link:link); return getRows();}
function saveNotes(id,notes){const row=findRowById_(id); if(!row) return getRows(); getRespSheet_().getRange(row,8).setValue(notes); return getRows();}
function deleteItem(id){const row=findRowById_(id); if(!row) return getRows(); const sh=getRespSheet_(); const evId=sh.getRange(row,COL.EVENT_ID+1).getValue(); if(evId){try{CalendarApp.getCalendarById(CAL_ID).getEventById(evId).deleteEvent();}catch(e){}} sh.deleteRow(row); return getRows();}
function findRowById_(id){const sh=getRespSheet_(); const ids=sh.getRange(2,COL.ID+1,Math.max(sh.getLastRow()-1,0),1).getValues().flat(); const idx=ids.findIndex(v=>String(v).trim()===String(id).trim()); return idx===-1?null:idx+2;}
