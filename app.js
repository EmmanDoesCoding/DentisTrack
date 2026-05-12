/* ═══════════════════════════════════════════════
   CliniQ — app.js  v6
   JSONBin real-time sync + localStorage fallback
═══════════════════════════════════════════════ */
'use strict';

// ══════════════════════════════════════════════════
//  ▼▼▼  PASTE YOUR JSONBIN CREDENTIALS HERE  ▼▼▼
// ══════════════════════════════════════════════════
const JSONBIN_ID  = 'YOUR_BIN_ID_HERE';   // e.g. '6650a1e2ad19ca34f8a1b2c3'
const JSONBIN_KEY = 'YOUR_MASTER_KEY_HERE'; // e.g. '$2a$10$AbCdEf...'
// ══════════════════════════════════════════════════
//  ▲▲▲  PASTE YOUR JSONBIN CREDENTIALS HERE  ▲▲▲
// ══════════════════════════════════════════════════

const JSONBIN_URL = `https://api.jsonbin.io/v3/b/${JSONBIN_ID}`;

// ══════════════════════════════════════════════════
//  SERVICES
// ══════════════════════════════════════════════════
const SERVICES = [
  { id:'s1', name:'Dental Cleaning',        icon:'🪥', price:1000,  priceDisplay:'₱1,000',         fixed:true,  durMin:30,  durMax:60,  note:'' },
  { id:'s2', name:'Pasta (Tooth Filling)',   icon:'🦷', price:1000,  priceDisplay:'₱1,000',         fixed:true,  durMin:60,  durMax:60,  note:'' },
  { id:'s3', name:'Temporary Pasta',         icon:'🩹', price:800,   priceDisplay:'₱800',           fixed:true,  durMin:45,  durMax:45,  note:'' },
  { id:'s4', name:'Tooth Extraction',        icon:'🔧', price:1000,  priceDisplay:'₱1,000',         fixed:true,  durMin:60,  durMax:60,  note:'' },
  { id:'s5', name:'Denture Fitting',         icon:'😁', price:10000, priceDisplay:'₱10,000',        fixed:true,  durMin:60,  durMax:60,  note:'' },
  { id:'s6', name:'Braces',                  icon:'✨', price:50000, priceDisplay:'₱50,000+',       fixed:false, durMin:120, durMax:120, note:'Final price varies by teeth complexity.' },
  { id:'s7', name:'Braces Adjustment',       icon:'⚙️', price:1000,  priceDisplay:'₱1,000',         fixed:true,  durMin:60,  durMax:60,  note:'' },
  { id:'s8', name:'Wisdom Tooth Extraction', icon:'💎', price:8000,  priceDisplay:'₱8,000–₱15,000', fixed:false, durMin:90,  durMax:120, note:'Final price depends on case complexity.' },
];

const ADMIN_CREDS  = { username:'admin', password:'dentis2024' };
const CLINIC_OPEN  = 8;
const CLINIC_CLOSE = 16;  // 4 PM closing time

// localStorage fallback keys
const LS = {
  CACHE:   'dt_cache',       // full state snapshot
  SYNCED:  'dt_last_synced', // ISO timestamp of last successful sync
};

// ══════════════════════════════════════════════════
//  STATE
// ══════════════════════════════════════════════════
let S = {
  queue:         [],
  completed:     [],
  patients:      [],
  nextId:        1,
  dentistStatus: 'available',
  notifTimers:   {},
};

let selectedSvcs    = new Set();
let currentPatient  = null;
let _syncTimer      = null;   // debounce handle
let _pollTimer      = null;   // auto-poll handle
let _syncOnline     = false;  // are we connected to JSONBin?

// ══════════════════════════════════════════════════
//  SYNC STATUS UI
// ══════════════════════════════════════════════════
function setSyncStatus(status, msg) {
  // status: 'syncing' | 'ok' | 'offline' | 'error'
  const el = document.getElementById('sync-status');
  if (!el) return;
  const icons  = { syncing:'⏳', ok:'🟢', offline:'🟡', error:'🔴' };
  const colors = {
    syncing: 'rgba(255,255,255,.5)',
    ok:      '#27ae60',
    offline: '#e67e22',
    error:   '#e05757',
  };
  el.textContent  = `${icons[status]} ${msg}`;
  el.style.color  = colors[status];
  el.style.display = 'block';
}

// Inject the sync status bar into the admin sidebar bottom once DOM is ready
function injectSyncBar() {
  const sb = document.querySelector('.sidebar-bottom');
  if (!sb || document.getElementById('sync-status')) return;
  const bar = document.createElement('div');
  bar.id = 'sync-status';
  bar.style.cssText = 'font-size:.72rem;padding:6px 4px 2px;text-align:left;display:none;font-weight:600;transition:color .3s';
  sb.insertBefore(bar, sb.firstChild);
}

// ══════════════════════════════════════════════════
//  JSONBIN — LOAD FROM CLOUD
// ══════════════════════════════════════════════════
async function cloudLoad() {
  if (!JSONBIN_ID || JSONBIN_ID === 'YOUR_BIN_ID_HERE') {
    // No credentials set — fall back to localStorage only
    lsCacheLoad();
    return;
  }
  setSyncStatus('syncing', 'Connecting…');
  try {
    const res = await fetch(JSONBIN_URL + '/latest', {
      headers: { 'X-Master-Key': JSONBIN_KEY },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const data = json.record;

    // If bin is empty / first time
    if (!data || !data.nextId) {
      lsCacheLoad();
      // Push local data up if any
      await cloudSave(true);
      return;
    }

    applyData(data);
    lsCacheWrite();        // update local cache from cloud
    _syncOnline = true;
    setSyncStatus('ok', 'Live sync active');

    // Start polling every 6 seconds so admin sees patient bookings in real time
    startPolling();
  } catch (e) {
    console.warn('JSONBin load failed, using local cache:', e);
    _syncOnline = false;
    lsCacheLoad();
    setSyncStatus('offline', 'Offline — local data only');
  }
}

// ══════════════════════════════════════════════════
//  JSONBIN — SAVE TO CLOUD  (debounced 400ms)
// ══════════════════════════════════════════════════
function cloudSave(immediate = false) {
  if (!JSONBIN_ID || JSONBIN_ID === 'YOUR_BIN_ID_HERE') {
    lsCacheWrite(); // no credentials, just save locally
    return;
  }
  lsCacheWrite(); // always write local cache first (instant)
  clearTimeout(_syncTimer);
  const delay = immediate ? 0 : 400;
  _syncTimer = setTimeout(async () => {
    setSyncStatus('syncing', 'Saving…');
    try {
      const payload = buildPayload();
      const res = await fetch(JSONBIN_URL, {
        method:  'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Master-Key': JSONBIN_KEY,
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      _syncOnline = true;
      localStorage.setItem(LS.SYNCED, new Date().toISOString());
      setSyncStatus('ok', `Synced ${fmtSyncTime()}`);
      broadcastToBoard();
    } catch (e) {
      console.warn('JSONBin save failed:', e);
      _syncOnline = false;
      setSyncStatus('error', 'Sync failed — saved locally');
    }
  }, delay);
}

// ══════════════════════════════════════════════════
//  POLLING — pull cloud changes every 6s
//  Keeps admin dashboard live when patient books on phone
// ══════════════════════════════════════════════════
function startPolling() {
  stopPolling();
  _pollTimer = setInterval(async () => {
    if (!_syncOnline) return;
    try {
      const res = await fetch(JSONBIN_URL + '/latest', {
        headers: { 'X-Master-Key': JSONBIN_KEY },
      });
      if (!res.ok) return;
      const json = await res.json();
      const data = json.record;
      if (!data || !data.nextId) return;

      // Only update if remote nextId is ahead (means someone else wrote data)
      if (data.nextId > S.nextId || data.queue?.length !== S.queue.length || data.patients?.length !== S.patients.length) {
        applyData(data);
        lsCacheWrite();
        // Re-render whatever is currently visible
        const dash = document.getElementById('page-admin-dashboard');
        const pdash = document.getElementById('page-patient-dashboard');
        if (dash?.classList.contains('active'))  renderDashboard();
        if (pdash?.classList.contains('active')) renderPatientDashboard();
        setSyncStatus('ok', `Updated ${fmtSyncTime()}`);
        broadcastToBoard();
      }
    } catch (e) { /* silent — don't interrupt UX on poll failure */ }
  }, 6000);
}

function stopPolling() {
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
}

// ══════════════════════════════════════════════════
//  DATA HELPERS
// ══════════════════════════════════════════════════
function buildPayload() {
  const revive = arr => arr.map(p => ({
    ...p,
    apptDT:      p.apptDT instanceof Date      ? p.apptDT.toISOString()      : p.apptDT,
    joinedAt:    p.joinedAt instanceof Date    ? p.joinedAt.toISOString()    : p.joinedAt,
    completedAt: p.completedAt instanceof Date ? p.completedAt.toISOString() : p.completedAt,
  }));
  return {
    queue:         revive(S.queue),
    completed:     revive(S.completed),
    patients:      S.patients,
    nextId:        S.nextId,
    dentistStatus: S.dentistStatus,
  };
}

function applyData(data) {
  const hydrate = arr => (arr || []).map(p => ({
    ...p,
    apptDT:      p.apptDT      ? new Date(p.apptDT)      : new Date(`${p.date}T${p.time}`),
    joinedAt:    p.joinedAt    ? new Date(p.joinedAt)     : new Date(),
    completedAt: p.completedAt ? new Date(p.completedAt)  : null,
  }));
  S.queue         = hydrate(data.queue         || []);
  S.completed     = hydrate(data.completed     || []);
  S.patients      = data.patients      || [];
  S.nextId        = data.nextId        || 1;
  S.dentistStatus = data.dentistStatus || 'available';
}

// ══════════════════════════════════════════════════
//  LOCALSTORAGE CACHE  (fallback & speed layer)
// ══════════════════════════════════════════════════
function lsCacheWrite() {
  try {
    localStorage.setItem(LS.CACHE, JSON.stringify(buildPayload()));
  } catch(e) { console.warn('localStorage write failed', e); }
}

function lsCacheLoad() {
  try {
    const raw = localStorage.getItem(LS.CACHE);
    if (!raw) { checkSeedNeeded(); return; }
    applyData(JSON.parse(raw));
    const synced = localStorage.getItem(LS.SYNCED);
    setSyncStatus('offline', synced
      ? `Offline — last synced ${new Date(synced).toLocaleTimeString()}`
      : 'Offline — local data');
  } catch(e) {
    console.warn('localStorage read failed, starting fresh', e);
    checkSeedNeeded();
  }
}

function checkSeedNeeded() {
  if (S.queue.length === 0 && S.completed.length === 0 && S.patients.length === 0) {
    seedDemo();
  }
}

function fmtSyncTime() {
  return new Date().toLocaleTimeString('en-PH', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
}

// Unified save call — every write goes through here
function save() { cloudSave(); }

// ══════════════════════════════════════════════════
//  BOOT
// ══════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
  injectSyncBar();
  await cloudLoad();
  checkSeedNeeded();
});

// ══════════════════════════════════════════════════
//  PAGE NAVIGATION
// ══════════════════════════════════════════════════
function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const pg = document.getElementById(id);
  if (!pg) return;
  pg.classList.add('active');
  if (id === 'page-admin-dashboard')   { injectSyncBar(); renderDashboard(); }
  if (id === 'page-patient-dashboard') renderPatientDashboard();
  if (id === 'page-patient-portal')    resetPortal();
}

// ══════════════════════════════════════════════════
//  SIDEBAR
// ══════════════════════════════════════════════════
function openSidebar()  { document.getElementById('sidebar').classList.add('open');    document.getElementById('sb-overlay').classList.add('open'); }
function closeSidebar() { document.getElementById('sidebar').classList.remove('open'); document.getElementById('sb-overlay').classList.remove('open'); }

// ══════════════════════════════════════════════════
//  PATIENT PORTAL TABS
// ══════════════════════════════════════════════════
function resetPortal() {
  switchPortalTab('signin');
  document.getElementById('si-contact').value   = '';
  document.getElementById('si-name').value      = '';
  document.getElementById('si-err').textContent = '';
}

function switchPortalTab(tab) {
  document.getElementById('ptab-signin').classList.toggle('active',   tab==='signin');
  document.getElementById('ptab-register').classList.toggle('active', tab==='register');
  document.getElementById('portal-signin').style.display   = tab==='signin'   ? '' : 'none';
  document.getElementById('portal-register').style.display = tab==='register' ? '' : 'none';
  document.getElementById('si-err').textContent  = '';
  document.getElementById('reg-err').textContent = '';
}

// ══════════════════════════════════════════════════
//  PATIENT SIGN IN
// ══════════════════════════════════════════════════
async function patientSignIn() {
  const contact = document.getElementById('si-contact').value.trim();
  const name    = document.getElementById('si-name').value.trim().toLowerCase();
  const err     = document.getElementById('si-err');
  if (!contact || !name) { err.textContent = 'Please fill in both fields.'; return; }

  // Pull fresh data from cloud before checking — ensures phone registrations are visible
  if (_syncOnline) {
    err.textContent = '';
    try {
      const res  = await fetch(JSONBIN_URL + '/latest', { headers: { 'X-Master-Key': JSONBIN_KEY } });
      const json = await res.json();
      if (json.record?.nextId) { applyData(json.record); lsCacheWrite(); }
    } catch(e) { /* use cached data */ }
  }

  const found = S.patients.find(p => p.contact === contact && p.name.toLowerCase() === name);
  if (!found) { err.textContent = 'No account found. Check your details or register as a new patient.'; return; }
  currentPatient = found;
  showPage('page-patient-dashboard');
}

// ══════════════════════════════════════════════════
//  PATIENT REGISTER
// ══════════════════════════════════════════════════
async function patientRegister() {
  const name    = document.getElementById('reg-name').value.trim();
  const contact = document.getElementById('reg-contact').value.trim();
  const age     = document.getElementById('reg-age').value.trim();
  const gender  = document.getElementById('reg-gender').value;
  const err     = document.getElementById('reg-err');

  if (!name)    { err.textContent = 'Please enter your full name.';      return; }
  if (!contact) { err.textContent = 'Please enter your contact number.'; return; }
  if (!age)     { err.textContent = 'Please enter your age.';            return; }
  if (!gender)  { err.textContent = 'Please select your gender.';        return; }

  // Pull latest before checking for duplicates
  if (_syncOnline) {
    try {
      const res  = await fetch(JSONBIN_URL + '/latest', { headers: { 'X-Master-Key': JSONBIN_KEY } });
      const json = await res.json();
      if (json.record?.nextId) { applyData(json.record); lsCacheWrite(); }
    } catch(e) { /* use cache */ }
  }

  const dup = S.patients.find(p => p.contact === contact);
  if (dup) { err.textContent = 'An account with that contact number already exists. Please sign in instead.'; return; }

  const patient = { id: S.nextId++, name, contact, age, gender, joinedDate: new Date().toISOString().split('T')[0] };
  S.patients.push(patient);
  save();

  currentPatient = patient;
  showToast(`Welcome, ${patient.name}! 🦷`);
  showPage('page-patient-dashboard');
}

// ══════════════════════════════════════════════════
//  PATIENT LOGOUT
// ══════════════════════════════════════════════════
function patientLogout() { currentPatient = null; selectedSvcs.clear(); showPage('page-landing'); }

// ══════════════════════════════════════════════════
//  PATIENT DASHBOARD
// ══════════════════════════════════════════════════
function renderPatientDashboard() {
  if (!currentPatient) { showPage('page-landing'); return; }
  document.getElementById('pd-greeting').textContent = `Hello, ${currentPatient.name}! 👋`;
  document.getElementById('pd-sub').textContent = `${currentPatient.age ? currentPatient.age + ' yrs · ' : ''}${currentPatient.gender || ''} · Member since ${formatDate(currentPatient.joinedDate)}`;
  updateDentistBanner('pd-dentist-banner');
  renderActiveAppt();
  selectedSvcs.clear();
  renderServicesGrid('pd-services-grid', 'pd-');
  setMinDate('pd-date');
  resetPdSlots();
  updateBill('pd-');
  renderPatientHistory();
}

function renderActiveAppt() {
  const el = document.getElementById('pd-active-appt');
  if (!el || !currentPatient) return;
  const appt = S.queue.find(p => p.patientId === currentPatient.id && p.status === 'waiting');
  if (!appt) { el.innerHTML = ''; return; }
  const pos     = S.queue.filter(p=>p.status==='waiting').findIndex(p=>p.id===appt.id) + 1;
  const amt     = appt.hasVar ? `₱${appt.total.toLocaleString()}+` : `₱${appt.total.toLocaleString()}`;
  const paidBadge = appt.paid
    ? `<span class="aac-paid-badge">💳 Paid ✓</span>`
    : `<span class="aac-paid-badge">⏳ Payment pending</span>`;
  el.innerHTML = `
    <div class="active-appt-card">
      <div class="aac-label">Your Active Appointment</div>
      <div class="aac-name">📅 ${formatDate(appt.date)} at ${formatTime(appt.time)}</div>
      <div class="aac-detail">${appt.svcs.map(s=>`${s.icon} ${s.name}`).join(' · ')}</div>
      <div class="aac-detail">⏱ Est. ${durLabel(appt.durMin,appt.durMax)} &nbsp;·&nbsp; ${amt}</div>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:8px">
        <span class="aac-pos">Queue Position #${pos}</span>
        ${paidBadge}
      </div>
      <div class="aac-actions">
        <button class="btn btn-sm" style="background:rgba(255,255,255,.2);color:#fff;border:1.5px solid rgba(255,255,255,.3)" onclick="openReceipt(${appt.id},false)">🧾 View Receipt</button>
      </div>
    </div>`;
}

function renderPatientHistory() {
  const el = document.getElementById('pd-history-list');
  if (!el || !currentPatient) return;
  const history = S.completed
    .filter(p => p.patientId === currentPatient.id)
    .sort((a,b) => new Date(b.date) - new Date(a.date));
  if (history.length === 0) {
    el.innerHTML = `<div class="ph-empty"><span class="ei">🦷</span><p>No visit history yet. Book your first appointment!</p></div>`;
    return;
  }
  el.innerHTML = history.map(p => {
    const amt = p.hasVar ? `₱${p.total.toLocaleString()}+` : `₱${p.total.toLocaleString()}`;
    return `
    <div class="ph-card">
      <div class="ph-header">
        <div>
          <div class="ph-date">📅 ${formatDate(p.date)}</div>
          <div class="ph-svcs">${p.svcs.map(s=>`${s.icon} ${s.name}`).join(' · ')}</div>
        </div>
        <button class="btn btn-sm btn-outline" onclick="openReceipt(${p.id},true)">🧾 Receipt</button>
      </div>
      <div class="ph-row"><span class="ph-label">Appointment Time</span><span class="ph-val">${formatTime(p.time)}</span></div>
      <div class="ph-row"><span class="ph-label">Duration</span><span class="ph-val">${durLabel(p.durMin,p.durMax)}</span></div>
      <div class="ph-row"><span class="ph-label">Amount Paid</span><span class="ph-val ph-total">${amt}</span></div>
    </div>`;
  }).join('');
}

function switchPdTab(tab) {
  document.getElementById('pdt-book').classList.toggle('active',    tab==='book');
  document.getElementById('pdt-history').classList.toggle('active', tab==='history');
  document.getElementById('pdt-book-panel').style.display    = tab==='book'    ? '' : 'none';
  document.getElementById('pdt-history-panel').style.display = tab==='history' ? '' : 'none';
  if (tab==='history') renderPatientHistory();
}

// ══════════════════════════════════════════════════
//  SERVICES GRID
// ══════════════════════════════════════════════════
function renderServicesGrid(gridId='pd-services-grid', prefix='pd-') {
  const g = document.getElementById(gridId);
  if (!g) return;
  g.innerHTML = SERVICES.map(s => `
    <div class="svc-card ${selectedSvcs.has(s.id)?'selected':''}" id="sc-${prefix}${s.id}"
         onclick="toggleSvc('${s.id}','${prefix}')">
      <span class="svc-check">✓</span>
      <span class="svc-icon">${s.icon}</span>
      <div class="svc-name">${s.name}</div>
      <div class="svc-price">${s.priceDisplay}</div>
      <div class="svc-dur">⏱ ${durLabel(s.durMin,s.durMax)}</div>
    </div>`).join('');
  updateBill(prefix);
  refreshTimeSlots(prefix);
}

function toggleSvc(id, prefix='pd-') {
  selectedSvcs.has(id) ? selectedSvcs.delete(id) : selectedSvcs.add(id);
  document.getElementById(`sc-${prefix}${id}`)?.classList.toggle('selected', selectedSvcs.has(id));
  updateBill(prefix);
  refreshTimeSlots(prefix);
}

function updateBill(prefix='pd-') {
  const sel    = SERVICES.filter(s => selectedSvcs.has(s.id));
  const total  = sel.reduce((a,s)=>a+s.price,0);
  const hasVar = sel.some(s=>!s.fixed);
  const dMin   = sel.reduce((a,s)=>a+s.durMin,0);
  const dMax   = sel.reduce((a,s)=>a+s.durMax,0);
  document.getElementById(`${prefix}b-count`).textContent = sel.length;
  document.getElementById(`${prefix}b-dur`).textContent   = sel.length ? durLabel(dMin,dMax) : '—';
  document.getElementById(`${prefix}b-total`).textContent =
    sel.length===0 ? '₱0' : hasVar ? `₱${total.toLocaleString()}+` : `₱${total.toLocaleString()}`;
  document.getElementById(`${prefix}b-note`).textContent  =
    sel.filter(s=>!s.fixed).map(s=>`• ${s.name}: ${s.note}`).join('\n');
}

function setMinDate(fieldId='pd-date') {
  const d = document.getElementById(fieldId);
  if (d) d.min = new Date().toISOString().split('T')[0];
}

function resetPdSlots() {
  const sel = document.getElementById('pd-time');
  if (sel) sel.innerHTML = '<option value="">— Select services & date first —</option>';
  const si = document.getElementById('pd-slot-info');
  if (si) { si.className='slot-info'; si.style.display='none'; }
}

function refreshTimeSlots(prefix='pd-') {
  const date   = document.getElementById(`${prefix}date`)?.value;
  const sel    = document.getElementById(`${prefix}time`);
  const infoEl = document.getElementById(`${prefix}slot-info`);
  if (!sel || !infoEl) return;
  if (!date || selectedSvcs.size===0) {
    sel.innerHTML = '<option value="">— Select services & date first —</option>';
    infoEl.className='slot-info'; infoEl.style.display='none';
    return;
  }
  const durMax = SERVICES.filter(s=>selectedSvcs.has(s.id)).reduce((a,s)=>a+s.durMax,0);
  const slots  = getAvailableSlots(date, durMax);
  if (slots.length===0) {
    sel.innerHTML = '<option value="">No available slots on this date</option>';
    infoEl.className='slot-info err'; infoEl.style.display='block';
    infoEl.textContent=`⚠️ No available slots on ${formatDate(date)} for selected services (needs ${durLabel(0,durMax)}). Try another date.`;
    return;
  }
  infoEl.className='slot-info ok'; infoEl.style.display='block';
  infoEl.textContent=`✅ ${slots.length} slot${slots.length>1?'s':''} available on ${formatDate(date)}.`;
  sel.innerHTML = slots.map(t=>`<option value="${t}">${formatTime(t)}</option>`).join('');
}

function getAvailableSlots(date, durMins) {
  const booked = S.queue.filter(p=>p.date===date);
  const slots  = [];
  for (let h=CLINIC_OPEN*60; h+durMins<=CLINIC_CLOSE*60; h+=30) {
    const conflict = booked.some(p=>{
      const ps=timeToMins(p.time); const pe=ps+p.durMax;
      return h<pe && (h+durMins)>ps;
    });
    if (!conflict) slots.push(minsToTime(h));
  }
  return slots;
}

function timeToMins(t) { const [h,m]=t.split(':').map(Number); return h*60+m; }
function minsToTime(m) { return `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`; }

// ══════════════════════════════════════════════════
//  PATIENT JOIN QUEUE
// ══════════════════════════════════════════════════
async function patientJoinQueue() {
  if (!currentPatient) return;
  const existing = S.queue.find(p => p.patientId===currentPatient.id && p.status==='waiting');
  if (existing) { showToast('⚠️ You already have an active appointment in the queue.'); return; }

  const date = document.getElementById('pd-date').value;
  const time = document.getElementById('pd-time').value;
  if (!date)               { showToast('Please select a date.');        return; }
  if (!time)               { showToast('Please select a time slot.');   return; }
  if (selectedSvcs.size===0) { showToast('Please select at least one service.'); return; }

  // Pull latest data before booking to avoid race conditions across devices
  if (_syncOnline) {
    try {
      const res  = await fetch(JSONBIN_URL + '/latest', { headers: { 'X-Master-Key': JSONBIN_KEY } });
      const json = await res.json();
      if (json.record?.nextId) { applyData(json.record); lsCacheWrite(); }
    } catch(e) { /* proceed with cache */ }
  }

  const clash = S.queue.find(p=>p.date===date && p.time===time);
  if (clash) { showToast('⚠️ That slot was just taken. Please choose another.'); refreshTimeSlots('pd-'); return; }

  const svcs   = SERVICES.filter(s=>selectedSvcs.has(s.id));
  const total  = svcs.reduce((a,s)=>a+s.price,0);
  const hasVar = svcs.some(s=>!s.fixed);
  const durMin = svcs.reduce((a,s)=>a+s.durMin,0);
  const durMax = svcs.reduce((a,s)=>a+s.durMax,0);

  const appt = {
    id:          S.nextId++,
    patientId:   currentPatient.id,
    name:        currentPatient.name,
    contact:     currentPatient.contact,
    date, time,
    apptDT:      new Date(`${date}T${time}`),
    svcs, total, hasVar, durMin, durMax,
    paid:        false,
    status:      'waiting',
    confirmed:   false,
    skipped:     false,
    joinedAt:    new Date(),
    completedAt: null,
  };

  S.queue.push(appt);
  S.queue.sort((a,b)=>a.apptDT-b.apptDT);
  save();

  const pos = S.queue.filter(p=>p.status==='waiting').findIndex(p=>p.id===appt.id)+1;
  showConfirmPage(appt, pos);
  startNotifTimers(appt);
}

// ══════════════════════════════════════════════════
//  CONFIRMATION PAGE
// ══════════════════════════════════════════════════
function showConfirmPage(appt, pos) {
  const totalTxt = appt.hasVar ? `₱${appt.total.toLocaleString()}+ (estimate)` : `₱${appt.total.toLocaleString()}`;
  document.getElementById('confirm-body').innerHTML = `
    <div style="text-align:center;margin-bottom:12px"><span class="q-badge">Queue Position #${pos}</span></div>
    <div class="confirm-details">
      <div class="confirm-row"><span class="c-label">Name</span>        <span class="c-val">${esc(appt.name)}</span></div>
      <div class="confirm-row"><span class="c-label">Contact</span>     <span class="c-val">${esc(appt.contact)}</span></div>
      <div class="confirm-row"><span class="c-label">Appointment</span> <span class="c-val">${formatDate(appt.date)} at ${formatTime(appt.time)}</span></div>
      <div class="confirm-row"><span class="c-label">Services</span>    <span class="c-val">${appt.svcs.map(s=>s.name).join(', ')}</span></div>
      <div class="confirm-row"><span class="c-label">Duration</span>    <span class="c-val">${durLabel(appt.durMin,appt.durMax)}</span></div>
      <div class="confirm-row"><span class="c-label">Est. Total</span>  <span class="c-val">${totalTxt}</span></div>
    </div>`;
  const log = document.getElementById('notif-log');
  log.innerHTML = '';
  addNotifLog(log,'📩 Booking confirmed!', `Appointment on ${formatDate(appt.date)} at ${formatTime(appt.time)}.`, 'info', 0);
  addNotifLog(log,'🔔 Reminder set',       `You'll be notified when you're next in queue.`, 'info', 900);
  showPage('page-patient-confirm');
}

function addNotifLog(container, title, body, type, delay) {
  setTimeout(()=>{
    const el = document.createElement('div');
    el.className = `notif-item ${type}`;
    el.innerHTML = `<strong>${title}</strong> ${body}<div class="notif-time">Just now</div>`;
    container.appendChild(el);
  }, delay);
}

// ══════════════════════════════════════════════════
//  DENTIST BANNER
// ══════════════════════════════════════════════════
function updateDentistBanner(elId='pd-dentist-banner') {
  const b = document.getElementById(elId);
  if (!b) return;
  b.className = 'dentist-banner';
  const labels = {
    available:   '🟢 Dentist is available and ready to see patients.',
    busy:        '🟡 Dentist is currently with a patient — you may still book.',
    unavailable: '🔴 Dentist is currently unavailable. Appointments are still being accepted.',
  };
  b.classList.add(S.dentistStatus);
  b.textContent = labels[S.dentistStatus];
}

// ══════════════════════════════════════════════════
//  NOTIFICATION TIMERS
// ══════════════════════════════════════════════════
function startNotifTimers(appt) {
  const poll = setInterval(()=>{
    const pos = S.queue.filter(p=>p.status==='waiting').findIndex(p=>p.id===appt.id);
    if (pos===-1) { clearInterval(poll); return; }
    const p = S.queue.find(q=>q.id===appt.id);
    if (!p||p.status!=='waiting') { clearInterval(poll); return; }
    if (pos===1&&!p._nextNotif) { p._nextNotif=true; inAppNotif(`📣 ${p.name} — You're next! Please get ready.`); startConfirmCountdown(p.id); }
    if (pos===0&&!p._nowNotif)  { p._nowNotif=true;  inAppNotif(`🚨 ${p.name} — It's your turn! Please proceed.`); }
  }, 8000);
  S.notifTimers[appt.id] = { poll };
}

function startConfirmCountdown(id) {
  const t = S.notifTimers[id] || {};
  t.followup = setTimeout(()=>{
    const p = S.queue.find(q=>q.id===id);
    if (!p||p.confirmed||p.status!=='waiting') return;
    inAppNotif(`⏰ Follow-up for ${p.name}: please check in — 5 minutes elapsed.`);
  }, 5*60*1000);
  t.skip = setTimeout(()=>{
    const idx = S.queue.findIndex(q=>q.id===id);
    if (idx===-1) return;
    const p = S.queue[idx];
    if (p.confirmed||p.status!=='waiting') return;
    p.status='skipped'; p.skipped=true;
    S.queue.splice(idx,1); S.queue.push(p);
    save();
    inAppNotif(`❌ ${p.name} did not check in in 10 minutes — moved to end of queue.`);
    renderDashboard(); broadcastToBoard();
  }, 10*60*1000);
  S.notifTimers[id] = t;
}

function inAppNotif(msg) {
  showToast(msg);
  if (document.getElementById('page-admin-dashboard')?.classList.contains('active')) renderDashboard();
}
function clearNotifTimers(id) {
  if (!S.notifTimers[id]) return;
  clearTimeout(S.notifTimers[id].followup);
  clearTimeout(S.notifTimers[id].skip);
  clearInterval(S.notifTimers[id].poll);
  delete S.notifTimers[id];
}

// ══════════════════════════════════════════════════
//  ADMIN LOGIN / LOGOUT
// ══════════════════════════════════════════════════
function adminLogin() {
  const u = document.getElementById('a-user').value.trim();
  const p = document.getElementById('a-pass').value;
  const e = document.getElementById('a-err');
  if (u===ADMIN_CREDS.username && p===ADMIN_CREDS.password) {
    e.textContent=''; document.getElementById('a-user').value=''; document.getElementById('a-pass').value='';
    showPage('page-admin-dashboard');
  } else { e.textContent='Invalid username or password.'; document.getElementById('a-pass').value=''; }
}
function adminLogout() { stopPolling(); showPage('page-landing'); }

// ══════════════════════════════════════════════════
//  ADMIN TABS
// ══════════════════════════════════════════════════
const TAB_META = {
  'tab-queue':     { title:'Queue Management',    sub:'Active patients sorted by appointment time' },
  'tab-completed': { title:'Completed Patients',   sub:'Paid & treated patients' },
  'tab-history':   { title:'History Log',          sub:'Daily patient & dentist records' },
  'tab-revenue':   { title:'Revenue Overview',     sub:'Earnings from completed appointments' },
  'tab-dentist':   { title:'Dentist Availability', sub:'Set current dentist status' },
};

function switchTab(btn, tabId) {
  document.querySelectorAll('.nav-item').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById(tabId)?.classList.add('active');
  const m = TAB_META[tabId];
  document.getElementById('dash-title').textContent = m.title;
  document.getElementById('dash-sub').textContent   = m.sub;
  renderDashboard(); closeSidebar();
}

// ══════════════════════════════════════════════════
//  RENDER DASHBOARD
// ══════════════════════════════════════════════════
function renderDashboard() {
  renderChips(); renderQueueTab(); renderCompletedTab();
  renderHistoryTab(); renderRevenueTab(); renderDentistTab(); updateNavBadges();
}

function renderChips() {
  const w = S.queue.filter(p=>p.status==='waiting').length;
  const r = S.completed.reduce((a,p)=>a+p.total,0);
  document.getElementById('dash-chips').innerHTML = `
    <div class="chip"><span class="chip-n">${w}</span><span class="chip-l">Waiting</span></div>
    <div class="chip"><span class="chip-n">${S.completed.length}</span><span class="chip-l">Done</span></div>
    <div class="chip"><span class="chip-n">₱${r.toLocaleString()}</span><span class="chip-l">Revenue</span></div>`;
}

function updateNavBadges() {
  document.getElementById('nb-queue').textContent = S.queue.length;
  document.getElementById('nb-done').textContent  = S.completed.length;
}

// ── Queue Tab ──────────────────────────────────────
function renderQueueTab() {
  const el = document.getElementById('queue-list'); if (!el) return;
  if (S.queue.length===0) { el.innerHTML=emptyState('📋','No patients in queue','Patients will appear here after check-in.'); return; }

  // Find index of last patient scheduled for TODAY (for last-patient indicator)
  const today = new Date().toISOString().split('T')[0];
  const todayWaiting = S.queue.filter(p=>p.status==='waiting'&&p.date===today);
  const lastTodayId  = todayWaiting.length > 0 ? todayWaiting[todayWaiting.length-1].id : null;

  el.innerHTML = S.queue.map((p,i) => {
    const isNext   = i===0&&p.status==='waiting';
    const isLast   = p.id===lastTodayId && !p.skipped;
    const amt      = p.hasVar?`₱${p.total.toLocaleString()}+`:`₱${p.total.toLocaleString()}`;
    const bc       = p.skipped?'b-skipped':p.paid?'b-paid':'b-waiting';
    const bt       = p.skipped?'Skipped':p.paid?'Paid ✓':'Waiting';
    const isFuture = p.date !== today;
    return `
    <div class="q-card ${isLast?'last-patient-card':''} ${isFuture?'future-card':''}" id="qc-${p.id}">
      <div class="q-num ${isNext?'is-next':''}">${p.skipped?'↩':i+1}</div>
      <div class="q-info">
        ${isNext?'<div class="q-next-tag">⚡ Next Up</div>':''}
        ${isLast?'<div class="q-last-tag">🔚 Last Patient Today</div>':''}
        ${isFuture?`<div class="q-future-tag">📅 ${formatDate(p.date)}</div>`:''}
        <div class="q-name">${esc(p.name)}</div>
        <div class="q-svcs">${p.svcs.map(s=>`${s.icon} ${s.name}`).join(' · ')}</div>
        <div class="q-meta">⏰ ${formatTime(p.time)} · ⏱ ${durLabel(p.durMin,p.durMax)}</div>
        <div class="q-meta">📞 ${esc(p.contact)}</div>
      </div>
      <div class="q-right">
        <div class="q-amt">${amt}</div>
        <span class="badge ${bc}">${bt}</span>
        <div class="q-actions">${actionBtns(p)}</div>
      </div>
    </div>`;
  }).join('');
}

function actionBtns(p) {
  if (p.skipped) return `<button class="btn btn-sm btn-outline" onclick="restorePatient(${p.id})">↩ Restore</button><button class="btn btn-sm btn-danger" onclick="removePatient(${p.id})">🗑</button>`;
  if (!p.paid)   return `<button class="btn btn-sm btn-gold" onclick="markPaid(${p.id})">💳 Mark Paid</button><button class="btn btn-sm btn-danger" onclick="removePatient(${p.id})">🗑</button>`;
  return `<button class="btn btn-sm" style="background:var(--teal-xlt);color:var(--teal-dk)" onclick="openReceipt(${p.id},false)">🧾 Receipt</button><button class="btn btn-sm btn-success" onclick="markCompleted(${p.id})">✅ Complete</button>`;
}

// ── Completed Tab ──────────────────────────────────
function renderCompletedTab() {
  const el = document.getElementById('completed-list'); if (!el) return;
  if (S.completed.length===0) { el.innerHTML=emptyState('✅','No completed patients','Completed patients will appear here.'); return; }
  el.innerHTML = [...S.completed].reverse().map(p => {
    const amt = p.hasVar?`₱${p.total.toLocaleString()}+`:`₱${p.total.toLocaleString()}`;
    return `<div class="q-card">
      <div class="q-num" style="background:var(--success-bg);color:var(--success);border-color:var(--success)">✓</div>
      <div class="q-info">
        <div class="q-name">${esc(p.name)}</div>
        <div class="q-svcs">${p.svcs.map(s=>`${s.icon} ${s.name}`).join(' · ')}</div>
        <div class="q-meta">📅 ${formatDate(p.date)} · ⏰ ${formatTime(p.time)} · 📞 ${esc(p.contact)}</div>
      </div>
      <div class="q-right">
        <div class="q-amt">${amt}</div>
        <span class="badge b-done">Completed</span>
        <div class="q-actions"><button class="btn btn-sm btn-outline" onclick="openReceipt(${p.id},true)">🧾 Receipt</button></div>
      </div>
    </div>`;
  }).join('');
}

// ── History Tab ────────────────────────────────────
function renderHistoryTab() {
  const wrap = document.getElementById('history-wrap'); if (!wrap) return;
  const byDate = {};
  S.completed.forEach(p=>{ if(!byDate[p.date])byDate[p.date]=[]; byDate[p.date].push(p); });
  const dates = Object.keys(byDate).sort((a,b)=>b.localeCompare(a));
  wrap.innerHTML = `
    <div class="history-filters">
      <label>Filter by Date</label>
      <input type="date" id="hist-filter" onchange="applyHistoryFilter()"/>
      <button class="btn btn-sm btn-outline" onclick="clearHistoryFilter()">Clear</button>
    </div>
    <div id="history-days"></div>`;
  renderHistoryDays(dates, byDate);
}

function applyHistoryFilter() {
  const val = document.getElementById('hist-filter')?.value;
  const byDate = {};
  S.completed.forEach(p=>{ if(!byDate[p.date])byDate[p.date]=[]; byDate[p.date].push(p); });
  const dates = Object.keys(byDate).filter(d=>!val||d===val).sort((a,b)=>b.localeCompare(a));
  renderHistoryDays(dates, byDate);
}
function clearHistoryFilter() { const f=document.getElementById('hist-filter'); if(f)f.value=''; applyHistoryFilter(); }

function renderHistoryDays(dates, byDate) {
  const container = document.getElementById('history-days'); if (!container) return;
  if (dates.length===0) {
    container.innerHTML=`<div style="text-align:center;padding:40px 16px;color:var(--muted)"><span style="font-size:2.5rem;display:block;margin-bottom:10px;opacity:.38">📅</span><p>No appointment history yet.</p></div>`;
    return;
  }
  const today = new Date().toISOString().split('T')[0];
  container.innerHTML = dates.map((date,di) => {
    const pts = byDate[date];
    const rev = pts.reduce((a,p)=>a+p.total,0);
    const hv  = pts.some(p=>p.hasVar);
    const rt  = hv?`₱${rev.toLocaleString()}+`:`₱${rev.toLocaleString()}`;
    return `<div class="history-day-card">
      <div class="history-day-header" onclick="toggleHistoryDay('hd-${di}','hc-${di}')">
        <div class="history-day-title">
          📅 ${formatDate(date)}
          ${date===today?'<span style="background:rgba(255,255,255,.2);color:#fff;font-family:var(--fb);font-size:.66rem;padding:2px 8px;border-radius:999px;font-weight:700">TODAY</span>':''}
        </div>
        <div style="display:flex;align-items:center;gap:14px">
          <div class="history-day-stats">
            <div class="hd-stat"><span class="hd-stat-n">${pts.length}</span><span class="hd-stat-l">Patients</span></div>
            <div class="hd-stat"><span class="hd-stat-n">${rt}</span><span class="hd-stat-l">Revenue</span></div>
          </div>
          <span class="history-chevron ${di===0?'open':''}" id="hc-${di}">▼</span>
        </div>
      </div>
      <div class="history-day-body ${di===0?'open':''}" id="hd-${di}">
        ${pts.map((p,pi)=>{
          const amt=p.hasVar?`₱${p.total.toLocaleString()}+`:`₱${p.total.toLocaleString()}`;
          return `<div class="history-patient-row">
            <div class="hp-num">${pi+1}</div>
            <div class="hp-info"><div class="hp-name">${esc(p.name)}</div><div class="hp-svcs">${p.svcs.map(s=>`${s.icon} ${s.name}`).join(' · ')}</div></div>
            <div class="hp-time">⏰ ${formatTime(p.time)}</div>
            <div class="hp-amt">${amt}</div>
            <button class="btn btn-sm btn-outline" style="margin-left:8px;flex-shrink:0" onclick="openReceipt(${p.id},true)">🧾</button>
          </div>`;
        }).join('')}
        <div style="padding:11px 15px;background:var(--teal-xlt);display:flex;justify-content:space-between;font-size:.84rem;font-weight:700;color:var(--teal-dk)">
          <span>Daily Total — ${pts.length} patient${pts.length>1?'s':''}</span><span>${rt}</span>
        </div>
      </div>
    </div>`;
  }).join('');
}

function toggleHistoryDay(bodyId, chevId) {
  const b=document.getElementById(bodyId); const c=document.getElementById(chevId);
  if (!b) return; const o=b.classList.toggle('open'); if(c)c.classList.toggle('open',o);
}

// ── Revenue Tab ────────────────────────────────────
function renderRevenueTab() {
  const el = document.getElementById('rev-grid'); if (!el) return;
  const total  = S.completed.reduce((a,p)=>a+p.total,0);
  const avg    = S.completed.length ? Math.round(total/S.completed.length) : 0;
  const svcRev={}, svcCnt={};
  S.completed.forEach(p=>p.svcs.forEach(s=>{ svcRev[s.id]=(svcRev[s.id]||0)+s.price; svcCnt[s.id]=(svcCnt[s.id]||0)+1; }));
  const top = SERVICES.filter(s=>svcRev[s.id]).sort((a,b)=>(svcRev[b.id]||0)-(svcRev[a.id]||0));
  el.innerHTML = `
    <div class="rev-card hl"><div class="rev-lbl">Total Revenue</div><div class="rev-val">₱${total.toLocaleString()}</div></div>
    <div class="rev-card"><div class="rev-lbl">Completed Patients</div><div class="rev-val">${S.completed.length}</div></div>
    <div class="rev-card"><div class="rev-lbl">Avg. Bill</div><div class="rev-val">₱${avg.toLocaleString()}</div></div>
    <div class="rev-card" style="grid-column:1/-1">
      <div class="rev-lbl">Revenue by Service</div>
      ${top.length===0?'<p style="color:var(--muted);font-size:.85rem;margin-top:8px">No data yet.</p>':`
        <div class="rev-table"><div class="rev-th">Service · Bookings</div>
          ${top.map(s=>`<div class="rev-r"><span class="rev-r-l">${s.icon} ${s.name} <span style="color:var(--muted);font-weight:400">(×${svcCnt[s.id]})</span></span><span class="rev-r-v">₱${(svcRev[s.id]||0).toLocaleString()}</span></div>`).join('')}
        </div>`}
    </div>`;
}

// ── Dentist Tab ────────────────────────────────────
function renderDentistTab() {
  const el = document.getElementById('dentist-mgr'); if (!el) return;
  const sl={available:'🟢 Available',busy:'🟡 With Patient',unavailable:'🔴 Unavailable'};
  const sc={available:'var(--success-bg)',busy:'var(--warn-bg)',unavailable:'var(--danger-bg)'};
  el.innerHTML = `
    <div class="dentist-card">
      <h3>Set Dentist Status</h3>
      <p>Patients see this on the booking screen in real time.</p>
      <div class="status-btns">
        <button class="status-btn available ${S.dentistStatus==='available'?'active':''}"    onclick="setDentistStatus('available')">🟢 Available</button>
        <button class="status-btn busy ${S.dentistStatus==='busy'?'active':''}"              onclick="setDentistStatus('busy')">🟡 With Patient</button>
        <button class="status-btn unavailable ${S.dentistStatus==='unavailable'?'active':''}" onclick="setDentistStatus('unavailable')">🔴 Unavailable</button>
      </div>
      <div class="dentist-status-display" style="background:${sc[S.dentistStatus]}">
        <span class="status-dot ${S.dentistStatus}"></span>
        <span style="color:var(--slate)">${sl[S.dentistStatus]}</span>
      </div>
    </div>
    <div class="dentist-card">
      <h3>Today's Schedule</h3><p>All appointments scheduled for today.</p>
      ${renderTodaySchedule()}
    </div>`;
}

function renderTodaySchedule() {
  const today = new Date().toISOString().split('T')[0];
  const all   = [...S.completed.filter(p=>p.date===today), ...S.queue.filter(p=>p.date===today&&p.status==='waiting')]
    .sort((a,b)=>a.time.localeCompare(b.time));
  if (!all.length) return '<p style="color:var(--muted);font-size:.85rem">No appointments today.</p>';
  return `<div class="rev-table">${all.map(p=>`
    <div class="rev-r">
      <span class="rev-r-l">${formatTime(p.time)} · ${esc(p.name)} ${p.status==='completed'?'<span style="color:var(--success)">✓</span>':''}</span>
      <span class="rev-r-v" style="font-size:.77rem">${p.svcs.map(s=>s.icon).join('')} ${durLabel(p.durMin,p.durMax)}</span>
    </div>`).join('')}</div>`;
}

function setDentistStatus(st) {
  S.dentistStatus = st; save(); renderDentistTab();
  showToast(`Dentist status → ${st}`); updateDentistBanner('pd-dentist-banner');
}

// ══════════════════════════════════════════════════
//  ADMIN ACTIONS
// ══════════════════════════════════════════════════
function markPaid(id) {
  const p = S.queue.find(q=>q.id===id); if (!p) return;
  p.paid = true; save();
  showToast(`💳 ${p.name} marked as paid!`); renderDashboard(); broadcastToBoard();
}

function markCompleted(id) {
  const idx = S.queue.findIndex(q=>q.id===id); if (idx===-1) return;
  const p = S.queue[idx];
  if (!p.paid) { showToast('⚠️ Patient must be paid first!'); return; }
  p.status='completed'; p.completedAt=new Date();
  S.queue.splice(idx,1); S.completed.push(p);
  clearNotifTimers(id); save();
  showToast(`✅ ${p.name} completed!`); renderDashboard(); broadcastToBoard();
}

function removePatient(id) {
  const idx = S.queue.findIndex(q=>q.id===id); if (idx===-1) return;
  const name = S.queue[idx].name; S.queue.splice(idx,1);
  clearNotifTimers(id); save();
  showToast(`🗑 ${name} removed.`); renderDashboard(); broadcastToBoard();
}

function restorePatient(id) {
  const p = S.queue.find(q=>q.id===id); if (!p) return;
  p.skipped=false; p.status='waiting'; S.queue.sort((a,b)=>a.apptDT-b.apptDT);
  save(); showToast(`↩ ${p.name} restored.`); renderDashboard(); broadcastToBoard();
}

// ══════════════════════════════════════════════════
//  RECEIPT
// ══════════════════════════════════════════════════
function openReceipt(id, fromCompleted=false) {
  const p = fromCompleted
    ? S.completed.find(q=>q.id===id)
    : (S.queue.find(q=>q.id===id) || S.completed.find(q=>q.id===id));
  if (!p) return;
  const now = new Date();
  const rNo = `DT-${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}-${String(id).padStart(4,'0')}`;
  const tt  = p.hasVar ? `₱${p.total.toLocaleString()}+ (est.)` : `₱${p.total.toLocaleString()}`;
  document.getElementById('receipt-content').innerHTML = `
    <div class="receipt-header">
      <div class="receipt-logo">🦷 CliniQ</div>
      <div class="receipt-sub">Smart Dental Queue Management</div>
      <div class="receipt-sub">Printed: ${now.toLocaleDateString('en-PH',{year:'numeric',month:'long',day:'numeric'})} at ${now.toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'})}</div>
      <div class="receipt-id">Receipt #${rNo}</div>
    </div>
    <div class="receipt-section">
      <div class="receipt-section-title">Patient Information</div>
      <div class="receipt-row"><span>Name</span><span>${esc(p.name)}</span></div>
      <div class="receipt-row"><span>Contact</span><span>${esc(p.contact)}</span></div>
      <div class="receipt-row"><span>Appointment</span><span>${formatDate(p.date)} at ${formatTime(p.time)}</span></div>
      <div class="receipt-row"><span>Status</span><span>${p.status==='completed'?'✅ Completed':'💳 Paid'}</span></div>
    </div>
    <div class="receipt-section">
      <div class="receipt-section-title">Services Rendered</div>
      ${p.svcs.map(s=>`<div class="receipt-row"><span>${s.icon} ${s.name}</span><span>${s.fixed?`₱${s.price.toLocaleString()}`:s.priceDisplay}</span></div>`).join('')}
    </div>
    <div class="receipt-total-row"><span>TOTAL</span><span>${tt}</span></div>
    ${p.hasVar?`<p style="font-size:.69rem;color:var(--muted);text-align:right;margin-top:3px">*Final amount may vary.</p>`:''}
    <div class="receipt-footer">Thank you for choosing CliniQ!<br/>Present this receipt at the front desk.<br/>Keep this copy for your records.</div>`;
  document.getElementById('receipt-overlay').classList.add('open');
}
function closeReceipt() { document.getElementById('receipt-overlay').classList.remove('open'); }
function closeReceiptOnBg(e) { if (e.target===document.getElementById('receipt-overlay')) closeReceipt(); }

// ══════════════════════════════════════════════════
//  QUEUE BOARD
// ══════════════════════════════════════════════════
function openQueueBoard() {
  const win = window.open('','DentisTrack_Board','width=1280,height=720,scrollbars=no');
  if (!win) { showToast('Please allow popups for the Queue Board.'); return; }
  renderBoardInWindow(win);
  const iv = setInterval(()=>{ if(win.closed){clearInterval(iv);return;} renderBoardInWindow(win); }, 5000);
}
function broadcastToBoard() { /* board auto-polls every 5s */ }

function renderBoardInWindow(win) {
  const today   = new Date().toISOString().split('T')[0];
  // Only show today's waiting patients on the board, up to 10
  const waiting = S.queue.filter(p => p.status==='waiting' && p.date===today).slice(0, 10);
  const next     = waiting[0];
  const upcoming = waiting.slice(1, 10);
  const now      = new Date().toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'});
  const dc = {available:'#27ae60',busy:'#e67e22',unavailable:'#e05757'}[S.dentistStatus];
  const dl = {available:'🟢 Dentist Available',busy:'🟡 Dentist With Patient',unavailable:'🔴 Dentist Unavailable'}[S.dentistStatus];

  // Build upcoming rows — last one in today's list gets a 🔚 tag
  const upcomingRows = upcoming.map((p,i) => {
    const isLast = i === upcoming.length - 1 && waiting.length > 1;
    return `<div class="ui ${isLast?'ui-last':''}">
      <div class="un">${i+2}</div>
      <div class="uinfo">
        <div class="uname">${esc(p.name)} ${isLast?'<span class="last-lbl">🔚 Last</span>':''}</div>
        <div class="usvcs">${p.svcs.map(s=>s.name).join(', ')}</div>
      </div>
      <div class="utime">${formatTime(p.time)}</div>
    </div>`;
  }).join('');

  win.document.open();
  win.document.write(`<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>CliniQ — Queue Board</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:opsz,wght@9..40,400;9..40,600;9..40,700&display=swap" rel="stylesheet"/>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{height:100%;width:100%}
  body{
    font-family:'DM Sans',sans-serif;
    background:#0d2b26;color:#fff;
    min-height:100vh;display:flex;flex-direction:column;
    overflow-x:hidden;
  }

  /* ── Header ── */
  .bh{
    display:flex;align-items:center;justify-content:space-between;
    padding:14px 28px;background:rgba(0,0,0,.25);
    border-bottom:1px solid rgba(255,255,255,.07);flex-shrink:0;
  }
  .bl{font-family:'DM Serif Display',serif;font-size:clamp(1.2rem,3vw,1.7rem);display:flex;align-items:center;gap:10px}
  .bt{font-size:clamp(.85rem,2vw,1.05rem);color:rgba(255,255,255,.45);font-weight:600}

  /* ── Body — side by side on desktop, stacked on mobile ── */
  .bb{
    flex:1;display:grid;
    grid-template-columns:1.4fr 1fr;
    overflow:hidden;
    min-height:0;
  }
  .bl-l{
    padding:clamp(16px,3vw,32px) clamp(16px,3vw,36px);
    display:flex;flex-direction:column;
    border-right:1px solid rgba(255,255,255,.06);
    overflow:hidden;
  }
  .bl-r{
    padding:clamp(14px,2.5vw,28px) clamp(14px,2.5vw,30px);
    background:rgba(0,0,0,.12);overflow-y:auto;
  }

  /* ── Section label ── */
  .sl{
    font-size:clamp(.6rem,1.2vw,.75rem);font-weight:700;text-transform:uppercase;
    letter-spacing:.1em;color:rgba(255,255,255,.3);margin-bottom:clamp(10px,2vw,18px);
  }

  /* ── Now Serving card ── */
  .cc{
    background:linear-gradient(135deg,#1a8a78,#126b5e);
    border-radius:clamp(14px,2vw,22px);
    padding:clamp(18px,3vw,32px);
    flex:1;display:flex;flex-direction:column;justify-content:center;
    box-shadow:0 16px 48px rgba(26,138,120,.3);
    overflow:hidden;
  }
  .nl{
    display:inline-block;background:rgba(255,255,255,.18);color:#fff;
    padding:4px 14px;border-radius:999px;
    font-size:clamp(.7rem,1.5vw,.85rem);font-weight:700;letter-spacing:.08em;text-transform:uppercase;
    margin-bottom:clamp(8px,1.5vw,16px);
    animation:pulse 2s ease-in-out infinite;
  }
  /* BIG ⚡ emoji */
  .ns-icon{
    font-size:clamp(3rem,8vw,7rem);
    display:block;line-height:1;margin-bottom:clamp(4px,1vw,10px);
    animation:pulse 2s ease-in-out infinite;
  }
  /* BIG name */
  .cname{
    font-family:'DM Serif Display',serif;
    font-size:clamp(1.8rem,5.5vw,4.5rem);
    color:#fff;margin-bottom:clamp(6px,1.2vw,14px);line-height:1.15;
    word-break:break-word;
  }
  .csvcs{
    font-size:clamp(.78rem,1.8vw,1.05rem);
    color:rgba(255,255,255,.6);margin-bottom:clamp(8px,1.5vw,16px);
  }
  /* BIG time */
  .cmeta{
    font-size:clamp(1rem,2.5vw,1.8rem);
    color:rgba(255,255,255,.5);font-weight:600;
  }
  .ec{
    font-family:'DM Serif Display',serif;
    font-size:clamp(1.1rem,3vw,1.6rem);
    color:rgba(255,255,255,.2);text-align:center;margin:auto;
  }

  /* ── Upcoming rows ── */
  .ui{
    display:flex;align-items:center;gap:clamp(8px,1.5vw,14px);
    padding:clamp(9px,1.5vw,13px) clamp(10px,1.5vw,14px);
    border-radius:clamp(8px,1.5vw,13px);
    background:rgba(255,255,255,.05);margin-bottom:clamp(6px,1vw,9px);
    transition:.2s;
  }
  .ui-last{border:1.5px solid rgba(255,184,75,.3);background:rgba(255,184,75,.07)}
  .un{
    width:clamp(28px,4vw,38px);height:clamp(28px,4vw,38px);
    border-radius:50%;background:rgba(255,255,255,.1);
    display:flex;align-items:center;justify-content:center;
    font-family:'DM Serif Display',serif;
    font-size:clamp(.8rem,1.5vw,1rem);color:rgba(255,255,255,.55);flex-shrink:0;
  }
  .uinfo{flex:1;min-width:0}
  .uname{
    font-weight:600;font-size:clamp(.82rem,1.8vw,1rem);
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
    display:flex;align-items:center;gap:6px;
  }
  .last-lbl{
    background:rgba(255,184,75,.25);color:#e8b84b;
    font-size:clamp(.6rem,1.2vw,.72rem);font-weight:700;
    padding:2px 7px;border-radius:999px;white-space:nowrap;flex-shrink:0;
  }
  .usvcs{
    font-size:clamp(.68rem,1.3vw,.8rem);color:rgba(255,255,255,.38);
    margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
  }
  .utime{font-size:clamp(.72rem,1.4vw,.85rem);color:rgba(255,255,255,.4);flex-shrink:0;font-weight:600}

  /* ── Footer ── */
  .bf{
    padding:clamp(8px,1.5vw,12px) clamp(16px,3vw,34px);
    background:rgba(0,0,0,.25);
    display:flex;align-items:center;justify-content:space-between;
    border-top:1px solid rgba(255,255,255,.05);flex-shrink:0;flex-wrap:wrap;gap:8px;
  }
  .ds{display:flex;align-items:center;gap:8px;font-size:clamp(.78rem,1.6vw,.92rem);font-weight:600;color:${dc}}
  .dot{width:10px;height:10px;border-radius:50%;background:${dc};flex-shrink:0}
  .bfr{font-size:clamp(.62rem,1.2vw,.74rem);color:rgba(255,255,255,.2)}

  /* ── Animations ── */
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.55}}

  /* ── MOBILE: stack vertically ── */
  @media(max-width:640px){
    .bb{grid-template-columns:1fr;grid-template-rows:auto auto;overflow:visible}
    .bl-l{border-right:none;border-bottom:1px solid rgba(255,255,255,.07);max-height:55vh}
    .bl-r{max-height:35vh;overflow-y:auto}
    .cc{min-height:160px}
  }
</style>
</head>
<body>

<div class="bh">
  <div class="bl">🦷 CliniQ — Queue Display</div>
  <div class="bt">🕐 ${now}</div>
</div>

<div class="bb">
  <div class="bl-l">
    <div class="sl">Now Serving</div>
    ${next
      ? `<div class="cc">
          <div class="nl">Now Serving</div>
          <span class="ns-icon">⚡</span>
          <div class="cname">${esc(next.name)}</div>
          <div class="csvcs">${next.svcs.map(s=>`${s.icon} ${s.name}`).join('  ·  ')}</div>
          <div class="cmeta">⏰ ${formatTime(next.time)}</div>
        </div>`
      : `<div class="cc"><div class="ec">No patients scheduled today</div></div>`
    }
  </div>

  <div class="bl-r">
    <div class="sl">Up Next Today${waiting.length>1?` (${waiting.length-1} remaining)`:''}</div>
    ${upcoming.length===0
      ? '<p style="color:rgba(255,255,255,.22);font-size:.87rem">No more patients today.</p>'
      : upcomingRows
    }
  </div>
</div>

<div class="bf">
  <div class="ds"><div class="dot"></div>${dl}</div>
  <div class="bfr">Showing today's queue only · Auto-refreshes every 5s · CliniQ v6</div>
</div>

<script>
  function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
  function formatDate(d){if(!d)return'';return new Date(d+'T00:00:00').toLocaleDateString('en-PH',{year:'numeric',month:'short',day:'numeric'})}
  function formatTime(t){if(!t)return'';const[h,m]=t.split(':').map(Number);return(h%12||12)+':'+String(m).padStart(2,'0')+' '+(h>=12?'PM':'AM')}
<\/script>
</body>
</html>`);
  win.document.close();
}

// ══════════════════════════════════════════════════
//  TOAST
// ══════════════════════════════════════════════════
let _tt;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent=msg; t.classList.add('show');
  clearTimeout(_tt); _tt=setTimeout(()=>t.classList.remove('show'),3500);
}

// ══════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════
function esc(s)  { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function formatDate(d) { if(!d)return''; return new Date(d+'T00:00:00').toLocaleDateString('en-PH',{year:'numeric',month:'short',day:'numeric'}); }
function formatTime(t) { if(!t)return''; const[h,m]=t.split(':').map(Number); return`${h%12||12}:${String(m).padStart(2,'0')} ${h>=12?'PM':'AM'}`; }
function durLabel(mn,mx) { const fmt=m=>m>=60?`${Math.floor(m/60)}h${m%60?` ${m%60}m`:''}`:` ${m}m`; return mn===mx?fmt(mn):`${fmt(mn)}–${fmt(mx)}`; }
function emptyState(icon,title,desc) { return`<div class="empty-state"><span class="ei">${icon}</span><h3>${title}</h3><p>${desc}</p></div>`; }

// ══════════════════════════════════════════════════
//  DEMO DATA SEED
// ══════════════════════════════════════════════════
function seedDemo() {
  const today     = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now()-86400000).toISOString().split('T')[0];
  const twoDays   = new Date(Date.now()-172800000).toISOString().split('T')[0];
  const tomorrow  = new Date(Date.now()+86400000).toISOString().split('T')[0];

  const demoPatients = [
    {id:S.nextId++,name:'Maria Santos',   contact:'09171234567',age:'32',gender:'Female',joinedDate:twoDays},
    {id:S.nextId++,name:'Jose Reyes',     contact:'09281234567',age:'45',gender:'Male',  joinedDate:twoDays},
    {id:S.nextId++,name:'Ana Cruz',       contact:'09991234567',age:'28',gender:'Female',joinedDate:yesterday},
    {id:S.nextId++,name:'Pedro Bautista', contact:'09451234567',age:'38',gender:'Male',  joinedDate:yesterday},
    {id:S.nextId++,name:'Rosa Dela Cruz', contact:'09121234567',age:'55',gender:'Female',joinedDate:twoDays},
    {id:S.nextId++,name:'Carlos Reyes',   contact:'09331234567',age:'29',gender:'Male',  joinedDate:yesterday},
    {id:S.nextId++,name:'Lilia Gomez',    contact:'09651234567',age:'41',gender:'Female',joinedDate:today},
    {id:S.nextId++,name:'Nena Villanueva',contact:'09551234567',age:'60',gender:'Female',joinedDate:twoDays},
    {id:S.nextId++,name:'Ben Santos',     contact:'09441234567',age:'34',gender:'Male',  joinedDate:twoDays},
    {id:S.nextId++,name:'Josie Tan',      contact:'09881234567',age:'26',gender:'Female',joinedDate:twoDays},
  ];
  S.patients.push(...demoPatients);

  function book(contact, date, sids, completed=false) {
    const pt = demoPatients.find(p=>p.contact===contact); if (!pt) return;
    const svcs   = SERVICES.filter(s=>sids.includes(s.id));
    const total  = svcs.reduce((a,s)=>a+s.price,0);
    const hasVar = svcs.some(s=>!s.fixed);
    const durMin = svcs.reduce((a,s)=>a+s.durMin,0);
    const durMax = svcs.reduce((a,s)=>a+s.durMax,0);
    const pool   = completed ? S.completed : S.queue;
    const dayOcc = [...S.queue,...S.completed].filter(p=>p.date===date);
    let time = null;
    for (let h=CLINIC_OPEN*60; h+durMax<=CLINIC_CLOSE*60; h+=30) {
      const c=dayOcc.some(p=>{const ps=timeToMins(p.time);const pe=ps+p.durMax;return h<pe&&(h+durMax)>ps;});
      if (!c) { time=minsToTime(h); break; }
    }
    if (!time) return;
    pool.push({id:S.nextId++,patientId:pt.id,name:pt.name,contact:pt.contact,date,time,apptDT:new Date(`${date}T${time}`),svcs,total,hasVar,durMin,durMax,paid:completed,status:completed?'completed':'waiting',confirmed:false,skipped:false,joinedAt:new Date(),completedAt:completed?new Date():null});
    if (!completed) S.queue.sort((a,b)=>a.apptDT-b.apptDT);
  }

  book('09881234567',twoDays,   ['s6'],       true);
  book('09441234567',twoDays,   ['s5'],       true);
  book('09171234567',twoDays,   ['s1'],       true);
  book('09551234567',yesterday, ['s2'],       true);
  book('09331234567',yesterday, ['s4'],       true);
  book('09991234567',yesterday, ['s8'],       true);
  book('09121234567',today,     ['s1'],       true);
  book('09281234567',today,     ['s3'],       true);
  book('09171234567',today,     ['s1','s4'],  false);
  book('09991234567',today,     ['s2'],       false);
  book('09451234567',today,     ['s7'],       false);
  book('09651234567',tomorrow,  ['s8'],       false);

  save();
}