/* ═══════════════════════════════════════════════
   CliniQ — app.js  v7
   JSONBin as single source of truth — no localStorage
═══════════════════════════════════════════════ */
'use strict';

// ══════════════════════════════════════════════════
//  ▼▼▼  PASTE YOUR JSONBIN CREDENTIALS HERE  ▼▼▼
// ══════════════════════════════════════════════════
const JSONBIN_ID  = '6a031e81250b1311c33bc607';   // e.g. '6650a1e2ad19ca34f8a1b2c3'
const JSONBIN_KEY = '$2a$10$6YUxFYON7tl.lHl13unwY.JY7BTEdnDYxnRzbS2pZriMdq5EdLEM2'; // e.g. '$2a$10$AbCdEf...'
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
 
const STAFF_ACCOUNTS = [
  { username: 'admin',      password: 'dentis2026', role: 'Owner' },
  { username: 'reception',  password: 'front2026',  role: 'Receptionist' },
  { username: 'chrisrocero',  password: 'ampogiko',  role: 'Programmer' },
];
const CLINIC_OPEN  = 8;
const CLINIC_CLOSE = 16;  // 4 PM closing time
 
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
//  JSONBIN — LOAD FROM CLOUD (single source of truth)
// ══════════════════════════════════════════════════
async function cloudLoad() {
  showLoadingOverlay(true);
 
  if (!JSONBIN_ID || JSONBIN_ID === 'YOUR_BIN_ID_HERE') {
    showLoadingOverlay(false);
    showToast('⚠️ JSONBin credentials not set. Please configure app.js.');
    setSyncStatus('error', 'No credentials set');
    checkSeedNeeded();
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
 
    if (!data || !data.nextId) {
      // Bin exists but is empty — seed demo data and push it up
      checkSeedNeeded();
      await _pushToCloud();
    } else {
      applyData(data);
 
      // Auto-recover: create patient accounts for anyone in queue/completed
      // who doesn't have one — fixes accounts that were never properly saved
      let recovered = false;
      [...S.queue, ...S.completed].forEach(appt => {
        if (!appt.contact || !appt.name) return;
        const hasAccount = S.patients.find(p => p.contact === appt.contact);
        if (!hasAccount) {
          S.patients.push({
            id:         S.nextId++,
            name:       appt.name,
            contact:    appt.contact,
            age:        appt.age    || '',
            gender:     appt.gender || '',
            joinedDate: appt.joinedAt
              ? new Date(appt.joinedAt).toISOString().split('T')[0]
              : new Date().toISOString().split('T')[0],
          });
          recovered = true;
        }
      });
 
      if (recovered) {
        S.queue.sort((a,b) => new Date(a.apptDT) - new Date(b.apptDT));
        setSyncStatus('syncing', 'Recovering accounts…');
        await _pushToCloud();
        setSyncStatus('ok', 'Accounts recovered ✓');
      }
    }
 
    _syncOnline = true;
    setSyncStatus('ok', 'Live sync active');
    startPolling();
  } catch (e) {
    console.warn('JSONBin load failed:', e);
    _syncOnline = false;
    setSyncStatus('error', 'Cannot connect to cloud — check credentials');
    showToast('❌ Could not connect to JSONBin. Check your credentials.');
    checkSeedNeeded();
  } finally {
    showLoadingOverlay(false);
  }
}
 
// ── Loading overlay ────────────────────────────────
function showLoadingOverlay(show) {
  let el = document.getElementById('loading-overlay');
  if (!el) {
    el = document.createElement('div');
    el.id = 'loading-overlay';
    el.style.cssText = `
      position:fixed;inset:0;background:#0d2b26;z-index:99999;
      display:flex;flex-direction:column;align-items:center;justify-content:center;
      font-family:'DM Sans',sans-serif;color:#fff;gap:16px;
      transition:opacity .3s ease;
    `;
    el.innerHTML = `
      <div style="font-size:3rem;animation:spin 1s linear infinite">🦷</div>
      <div style="font-family:'DM Serif Display',serif;font-size:1.8rem">CliniQ</div>
      <div style="font-size:.9rem;color:rgba(255,255,255,.5)">Connecting to cloud…</div>
      <style>@keyframes spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}</style>
    `;
    document.body.appendChild(el);
  }
  if (show) {
    el.style.opacity = '1';
    el.style.pointerEvents = 'all';
    el.style.display = 'flex';
  } else {
    el.style.opacity = '0';
    el.style.pointerEvents = 'none';
    setTimeout(() => { if (el) el.style.display = 'none'; }, 350);
  }
}
 
// ══════════════════════════════════════════════════
//  JSONBIN — SAVE TO CLOUD
//  force=true  → immediate, bypasses debounce
//  force=false → debounced 400ms
// ══════════════════════════════════════════════════
function cloudSave(force = false) {
  if (!JSONBIN_ID || JSONBIN_ID === 'YOUR_BIN_ID_HERE') return;
  if (force) return _pushToCloud();
  clearTimeout(_syncTimer);
  _syncTimer = setTimeout(() => _pushToCloud(), 400);
}
 
async function _pushToCloud() {
  setSyncStatus('syncing', 'Saving…');
  try {
    const res = await fetch(JSONBIN_URL, {
      method:  'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Master-Key': JSONBIN_KEY,
      },
      body: JSON.stringify(buildPayload()),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    _syncOnline = true;
    setSyncStatus('ok', `Synced ${fmtSyncTime()}`);
    broadcastToBoard();
  } catch (e) {
    console.warn('JSONBin save failed:', e);
    _syncOnline = false;
    setSyncStatus('error', 'Sync failed — please check connection');
  }
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
        // Re-render whatever is currently visible
        const dash  = document.getElementById('page-admin-dashboard');
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
 
function checkSeedNeeded() {
  if (S.queue.length === 0 && S.completed.length === 0 && S.patients.length === 0) {
    seedDemo();
  }
}
 
function fmtSyncTime() {
  return new Date().toLocaleTimeString('en-PH', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
}
 
// Returns today's date as YYYY-MM-DD using LOCAL timezone (not UTC)
// This prevents midnight timezone bugs where toISOString() returns yesterday
function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
 
// Unified save — debounced for normal interactions
function save() { cloudSave(false); }
 
// ══════════════════════════════════════════════════
//  BOOT
// ══════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
  // Wipe any old localStorage data from previous versions — JSONBin is now the only source of truth
  try { localStorage.clear(); } catch(e) { /* ignore */ }
  injectSyncBar();
  await cloudLoad();
});
 
// ══════════════════════════════════════════════════
//  PAGE NAVIGATION
// ══════════════════════════════════════════════════
function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const pg = document.getElementById(id);
  if (!pg) return;
  pg.classList.add('active');
  if (id === 'page-admin-dashboard')   { injectSyncBar(); renderDashboard(); applyTierUI(); }
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
 
  err.textContent = '';
 
  // Always pull fresh data from cloud before checking
  if (_syncOnline) {
    try {
      const res  = await fetch(JSONBIN_URL + '/latest', { headers: { 'X-Master-Key': JSONBIN_KEY } });
      const json = await res.json();
      if (json.record?.nextId) { applyData(json.record); lsCacheWrite(); }
    } catch(e) { /* use cached data */ }
  }
 
  // Primary check — look in registered patients list
  let found = S.patients.find(p =>
    p.contact === contact && p.name.toLowerCase() === name
  );
 
  // Fallback — if not found in patients, check the queue and completed lists
  // This handles the case where an account was created before sync was working
  if (!found) {
    const inQueue     = S.queue.find(p => p.contact === contact && p.name.toLowerCase() === name);
    const inCompleted = S.completed.find(p => p.contact === contact && p.name.toLowerCase() === name);
    const match       = inQueue || inCompleted;
 
    if (match) {
      // Auto-recover — create the missing patient account from queue data
      const recovered = {
        id:         S.nextId++,
        name:       match.name,
        contact:    match.contact,
        age:        match.age        || '',
        gender:     match.gender     || '',
        joinedDate: match.joinedAt
          ? new Date(match.joinedAt).toISOString().split('T')[0]
          : new Date().toISOString().split('T')[0],
      };
      S.patients.push(recovered);
      save(); // push the recovered account to cloud so it works on all devices next time
      found = recovered;
      showToast('👋 Account recovered! You\'re signed back in.');
    }
  }
 
  if (!found) {
    err.textContent = 'No account found. Please check your name and contact number, or register as a new patient.';
    return;
  }
 
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
  await _pushToCloud(); // force immediate cloud save
 
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
  renderFollowupBanner();
  renderActiveAppt();
  selectedSvcs.clear();
  renderServicesGrid('pd-services-grid', 'pd-');
  setMinDate('pd-date');
  resetPdSlots();
  updateBill('pd-');
  renderPatientHistory();
}
 
// ── Follow-up Banner ─────────────────────────────
// Shows when the dentist has set a recommended return date for this patient
function renderFollowupBanner() {
  // Find or create the banner element
  let banner = document.getElementById('pd-followup-banner');
  if (!banner) {
    // Insert it just before the pd-active-appt div
    const activeAppt = document.getElementById('pd-active-appt');
    if (!activeAppt) return;
    banner = document.createElement('div');
    banner.id = 'pd-followup-banner';
    activeAppt.parentNode.insertBefore(banner, activeAppt);
  }
 
  if (!currentPatient) { banner.innerHTML = ''; return; }
 
  // Find the most recent completed appointment for this patient that has a follow-up date
  const withFollowup = S.completed
    .filter(p => p.patientId === currentPatient.id && p.followupDate)
    .sort((a,b) => b.followupDate.localeCompare(a.followupDate));
 
  if (withFollowup.length === 0) { banner.innerHTML = ''; return; }
 
  const latest   = withFollowup[0];
  const today    = localToday();
  const isOverdue = latest.followupDate < today;
  const daysUntil = Math.ceil((new Date(latest.followupDate) - new Date(today)) / 86400000);
 
  // Don't show if they already have an active booking
  const hasActive = S.queue.find(p => p.patientId === currentPatient.id && p.status === 'waiting');
  if (hasActive) { banner.innerHTML = ''; return; }
 
  const urgencyColor = isOverdue ? 'var(--danger)'  : daysUntil <= 7 ? 'var(--warn)'  : 'var(--teal)';
  const urgencyBg    = isOverdue ? 'var(--danger-bg)': daysUntil <= 7 ? 'var(--warn-bg)': 'var(--teal-xlt)';
  const urgencyIcon  = isOverdue ? '⚠️' : daysUntil <= 7 ? '🔔' : '📆';
  const urgencyMsg   = isOverdue
    ? `Your follow-up was recommended for ${formatDate(latest.followupDate)}. Please book as soon as possible.`
    : daysUntil === 0
      ? `Your dentist recommends a follow-up today.`
      : daysUntil <= 7
        ? `Your dentist recommends a follow-up in ${daysUntil} day${daysUntil>1?'s':''}  (by ${formatDate(latest.followupDate)}).`
        : `Your dentist recommends a follow-up by ${formatDate(latest.followupDate)}.`;
 
  banner.innerHTML = `
    <div style="
      background:${urgencyBg};
      border:1.5px solid ${urgencyColor};
      border-radius:var(--r-lg);
      padding:16px 18px;
      margin-bottom:14px;
      display:flex;
      align-items:center;
      justify-content:space-between;
      flex-wrap:wrap;
      gap:12px;
      animation:fadeUp .4s ease both;
    ">
      <div style="display:flex;align-items:flex-start;gap:12px;flex:1;min-width:0">
        <span style="font-size:1.5rem;flex-shrink:0">${urgencyIcon}</span>
        <div>
          <div style="font-weight:700;font-size:.92rem;color:${urgencyColor};margin-bottom:3px">
            Dentist Recommended Follow-up
          </div>
          <div style="font-size:.83rem;color:var(--slate);line-height:1.5">${urgencyMsg}</div>
          ${latest.followupNote ? `<div style="font-size:.78rem;color:var(--muted);margin-top:4px">📝 ${esc(latest.followupNote)}</div>` : ''}
        </div>
      </div>
      <button class="btn btn-primary btn-sm"
              style="flex-shrink:0;white-space:nowrap"
              onclick="bookFollowupAppointment('${latest.id}','${latest.followupDate}')">
        📅 Book Follow-up
      </button>
    </div>`;
}
 
// ── Pre-fill booking form from follow-up ─────────
function bookFollowupAppointment(completedId, suggestedDate) {
  const completed = S.completed.find(p => p.id === parseInt(completedId));
 
  // Switch to the Book tab
  switchPdTab('book');
 
  // Pre-select the same services from their last visit
  selectedSvcs.clear();
  if (completed) {
    completed.svcs.forEach(s => selectedSvcs.add(s.id));
  }
 
  // Re-render services grid with pre-selections
  renderServicesGrid('pd-services-grid', 'pd-');
 
  // Pre-fill the date with the suggested follow-up date
  // (but only if it's in the future — otherwise use today)
  const today = localToday();
  const dateToUse = suggestedDate >= today ? suggestedDate : today;
  const dateInput = document.getElementById('pd-date');
  if (dateInput) {
    dateInput.value = dateToUse;
    // Trigger slot refresh
    refreshTimeSlots('pd-');
  }
 
  // Update bill
  updateBill('pd-');
 
  // Show a helpful tip in the slot info
  const infoEl = document.getElementById('pd-slot-info');
  if (infoEl && suggestedDate < today) {
    infoEl.className = 'slot-info warn';
    infoEl.style.display = 'block';
    infoEl.textContent = `⚠️ Your recommended follow-up date has passed. We've set today as the starting date — feel free to pick any available date.`;
  }
 
  // Scroll booking form into view smoothly
  document.getElementById('pdt-book-panel')?.scrollIntoView({ behavior:'smooth', block:'start' });
 
  showToast('📅 Services from your last visit pre-selected. Choose a date and time!');
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
      ${p.followupDate ? `
      <div class="ph-row" style="border-top:1px solid var(--mint);margin-top:4px;padding-top:8px">
        <span class="ph-label" style="color:var(--teal)">📆 Dentist Follow-up</span>
        <span class="ph-val" style="color:var(--teal)">${formatDate(p.followupDate)}${p.followupNote?' · '+esc(p.followupNote):''}</span>
      </div>` : ''}
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
  if (d) d.min = localToday();
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
  await _pushToCloud(); // immediate — don't debounce queue bookings
 
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
  const match = STAFF_ACCOUNTS.find(a => a.username === u && a.password === p);
  if (match) {
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
  'tab-history':   { title:'History Log',          sub:'Daily patient & dentist records · Premium' },
  'tab-revenue':   { title:'Revenue Overview',     sub:'Earnings from completed appointments · Premium' },
  'tab-analytics': { title:'Analytics Dashboard',  sub:'Clinic performance insights · Premium' },
  'tab-feedback':  { title:'Patient Feedback',      sub:'Ratings and comments from patients · Premium' },
  'tab-followup':  { title:'Follow-up Scheduling',  sub:'Manage recommended return visits · Premium' },
  'tab-dentist':   { title:'Dentist Availability',  sub:'Set current dentist status' },
};
 
function switchTab(btn, tabId) {
  document.querySelectorAll('.nav-item').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById(tabId)?.classList.add('active');
  const m = TAB_META[tabId] || { title: tabId, sub: '' };
  document.getElementById('dash-title').textContent = m.title;
  document.getElementById('dash-sub').textContent   = m.sub;
  renderDashboard(); closeSidebar();
}
 
// ══════════════════════════════════════════════════
//  RENDER DASHBOARD
// ══════════════════════════════════════════════════
function renderDashboard() {
  renderChips(); renderQueueTab(); renderCompletedTab();
  renderHistoryTab(); renderRevenueTab();
  renderAnalyticsTab(); renderFeedbackTab(); renderFollowupTab();
  renderDentistTab(); updateNavBadges();
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
  const today = localToday();
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
    const hasFollowup = p.followupDate;
    return `<div class="q-card">
      <div class="q-num" style="background:var(--success-bg);color:var(--success);border-color:var(--success)">✓</div>
      <div class="q-info">
        <div class="q-name">${esc(p.name)}</div>
        <div class="q-svcs">${p.svcs.map(s=>`${s.icon} ${s.name}`).join(' · ')}</div>
        <div class="q-meta">📅 ${formatDate(p.date)} · ⏰ ${formatTime(p.time)} · 📞 ${esc(p.contact)}</div>
        ${hasFollowup ? `<div class="q-meta" style="color:var(--teal)">📆 Follow-up: ${formatDate(p.followupDate)}${p.followupNote?' · '+esc(p.followupNote):''}</div>` : ''}
      </div>
      <div class="q-right">
        <div class="q-amt">${amt}</div>
        <span class="badge b-done">Completed</span>
        <div class="q-actions">
          <button class="btn btn-sm btn-outline" onclick="openReceipt(${p.id},true)">🧾 Receipt</button>
          ${currentTier==='premium'
            ? `<button class="btn btn-sm" style="background:var(--teal-xlt);color:var(--teal-dk)" onclick="openFollowup(${p.id})">📆 ${hasFollowup?'Edit':'Set'} Follow-up</button>`
            : ''}
        </div>
      </div>
    </div>`;
  }).join('');
}
 
// ── History Tab ────────────────────────────────────
function renderHistoryTab() {
  const wrap = document.getElementById('history-wrap'); if (!wrap) return;
  if (currentTier !== 'premium') { wrap.innerHTML = ''; return; }
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
  const today = localToday();
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
  if (currentTier !== 'premium') { el.innerHTML = ''; return; }
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
  const today = localToday();
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
  // Push current state to sessionStorage so board.html can read it immediately
  try {
    sessionStorage.setItem('cliniq_board', JSON.stringify(buildPayload()));
    sessionStorage.setItem('cliniq_dentist', S.dentistStatus);
  } catch(e) { /* ignore */ }
 
  const win = window.open('board.html', 'CliniQ_Board', 'width=1280,height=720,scrollbars=no');
  if (!win) {
    showToast('⚠️ Please allow popups for the Queue Board.');
    return;
  }
 
  // Keep pushing fresh data to sessionStorage every 5s so board auto-updates
  const iv = setInterval(() => {
    if (win.closed) { clearInterval(iv); return; }
    try {
      sessionStorage.setItem('cliniq_board', JSON.stringify(buildPayload()));
      sessionStorage.setItem('cliniq_dentist', S.dentistStatus);
    } catch(e) { /* ignore */ }
  }, 5000);
}
 
function broadcastToBoard() {
  // Push latest state whenever data changes so board reflects it quickly
  try {
    sessionStorage.setItem('cliniq_board', JSON.stringify(buildPayload()));
    sessionStorage.setItem('cliniq_dentist', S.dentistStatus);
  } catch(e) { /* ignore */ }
}
 
function renderBoardInWindow(win) {
  const nowDate  = new Date();
  // Use local date string to avoid UTC timezone mismatch at midnight
  const today    = `${nowDate.getFullYear()}-${String(nowDate.getMonth()+1).padStart(2,'0')}-${String(nowDate.getDate()).padStart(2,'0')}`;
  // Only show today's waiting patients on the board, up to 10
  const waiting  = S.queue.filter(p => p.status==='waiting' && p.date===today).slice(0, 10);
  const next     = waiting[0];
  const upcoming = waiting.slice(1, 10);
  const nowStr   = nowDate.toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'});
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
    padding:5px 18px;border-radius:999px;
    font-size:clamp(.75rem,1.6vw,.95rem);font-weight:700;letter-spacing:.1em;text-transform:uppercase;
    margin-bottom:clamp(12px,2vw,22px);
    animation:pulse 2s ease-in-out infinite;
  }
  /* BIG name */
  .cname{
    font-family:'DM Serif Display',serif;
    font-size:clamp(2.8rem,8vw,7rem);
    color:#fff;margin-bottom:clamp(8px,1.5vw,18px);line-height:1.1;
    word-break:break-word;
  }
  .csvcs{
    font-size:clamp(.85rem,2vw,1.2rem);
    color:rgba(255,255,255,.65);margin-bottom:clamp(10px,1.8vw,20px);
  }
  /* BIG time */
  .cmeta{
    font-size:clamp(1.2rem,3.2vw,2.6rem);
    color:rgba(255,255,255,.55);font-weight:700;letter-spacing:.02em;
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
  <div class="bt">🕐 ${nowStr}</div>
</div>
 
<div class="bb">
  <div class="bl-l">
    <div class="sl">Now Serving</div>
    ${next
      ? `<div class="cc">
          <div class="nl">Now Serving</div>
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
//  PREMIUM TAB RENDERERS
// ══════════════════════════════════════════════════
 
function renderAnalyticsTab() {
  const el = document.getElementById('analytics-grid');
  if (!el || currentTier !== 'premium') return;
 
  const today     = localToday();
  const thisMonth = today.slice(0,7);
  const allDone   = S.completed;
  const todayPts  = allDone.filter(p=>p.date===today);
  const monthPts  = allDone.filter(p=>p.date?.startsWith(thisMonth));
 
  // Peak hour
  const hourCounts = {};
  allDone.forEach(p => {
    if (!p.time) return;
    const h = parseInt(p.time.split(':')[0]);
    hourCounts[h] = (hourCounts[h]||0) + 1;
  });
  const peakHour  = Object.keys(hourCounts).sort((a,b)=>hourCounts[b]-hourCounts[a])[0];
  const peakLabel = peakHour ? formatTime(`${String(peakHour).padStart(2,'0')}:00`) : '—';
 
  // Top service
  const svcCount = {};
  allDone.forEach(p=>p.svcs.forEach(s=>{ svcCount[s.id]=(svcCount[s.id]||0)+1; }));
  const topSvcId = Object.keys(svcCount).sort((a,b)=>svcCount[b]-svcCount[a])[0];
  const topSvc   = SERVICES.find(s=>s.id===topSvcId);
 
  // Retention
  const patientVisits = {};
  allDone.forEach(p=>{ patientVisits[p.contact]=(patientVisits[p.contact]||0)+1; });
  const returning    = Object.values(patientVisits).filter(v=>v>1).length;
  const totalUnique  = Object.keys(patientVisits).length;
  const retentionPct = totalUnique ? Math.round((returning/totalUnique)*100) : 0;
 
  // ── Daily patients bar chart (last 7 days) ────────
  const days = [];
  for (let i=6; i>=0; i--) {
    const d   = new Date(Date.now() - i*86400000);
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const lbl = d.toLocaleDateString('en-PH',{weekday:'short'});
    const cnt = allDone.filter(p=>p.date===key).length;
    days.push({ key, lbl, cnt });
  }
  const maxCnt  = Math.max(...days.map(d=>d.cnt), 1);
  const barW    = 36;
  const barGap  = 18;
  const chartH  = 120;
  const chartW  = days.length * (barW + barGap) + barGap;
  const barsSVG = days.map((d,i) => {
    const bh  = Math.max(4, Math.round((d.cnt / maxCnt) * chartH));
    const bx  = barGap + i*(barW+barGap);
    const by  = chartH - bh;
    const isToday = d.key === today;
    return `
      <rect x="${bx}" y="${by}" width="${barW}" height="${bh}"
        fill="${isToday?'#1a8a78':'#c2ede5'}" rx="5"/>
      ${d.cnt > 0 ? `<text x="${bx+barW/2}" y="${by-5}" text-anchor="middle"
        font-size="11" fill="${isToday?'#126b5e':'#7a9993'}" font-family="DM Sans,sans-serif" font-weight="600">${d.cnt}</text>` : ''}
      <text x="${bx+barW/2}" y="${chartH+16}" text-anchor="middle"
        font-size="10" fill="#7a9993" font-family="DM Sans,sans-serif">${d.lbl}</text>
      ${isToday ? `<text x="${bx+barW/2}" y="${chartH+28}" text-anchor="middle"
        font-size="8" fill="#1a8a78" font-family="DM Sans,sans-serif" font-weight="700">TODAY</text>` : ''}`;
  }).join('');
 
  el.innerHTML = `
    <!-- Stat chips -->
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;margin-bottom:4px">
      <div class="rev-card hl"><div class="rev-lbl">Today&#39;s Patients</div><div class="rev-val">${todayPts.length}</div></div>
      <div class="rev-card"><div class="rev-lbl">This Month</div><div class="rev-val">${monthPts.length}</div></div>
      <div class="rev-card"><div class="rev-lbl">Patient Retention</div><div class="rev-val">${retentionPct}%</div></div>
      <div class="rev-card"><div class="rev-lbl">Peak Hour</div><div class="rev-val" style="font-size:1.3rem">${peakLabel}</div></div>
      <div class="rev-card"><div class="rev-lbl">Top Service</div><div class="rev-val" style="font-size:1rem;line-height:1.3">${topSvc?topSvc.icon+' '+topSvc.name:'—'}</div></div>
      <div class="rev-card"><div class="rev-lbl">Total Served</div><div class="rev-val">${allDone.length}</div></div>
    </div>
 
    <!-- Bar chart -->
    <div class="rev-card" style="grid-column:1/-1">
      <div class="rev-lbl" style="margin-bottom:18px">📊 Patients Per Day — Last 7 Days</div>
      <div style="overflow-x:auto">
        <svg width="${chartW}" height="${chartH+40}" viewBox="0 0 ${chartW} ${chartH+40}"
             style="display:block;min-width:${chartW}px">
          <!-- Gridlines -->
          ${[0.25,0.5,0.75,1].map(frac=>{
            const y = chartH - Math.round(frac*chartH);
            const v = Math.round(frac*maxCnt);
            return `
              <line x1="0" y1="${y}" x2="${chartW}" y2="${y}" stroke="#e8f7f4" stroke-width="1"/>
              <text x="2" y="${y-3}" font-size="9" fill="#b5d4cf" font-family="DM Sans,sans-serif">${v}</text>`;
          }).join('')}
          ${barsSVG}
        </svg>
      </div>
      ${allDone.length===0?`<p style="text-align:center;color:var(--muted);font-size:.84rem;margin-top:8px">Complete some appointments to see data here.</p>`:''}
    </div>`;
}
 
function renderFeedbackTab() {
  const el = document.getElementById('feedback-wrap');
  if (!el || currentTier !== 'premium') return;
  // Get completed patients with feedback
  const withFeedback = S.completed.filter(p=>p.rating);
  const avgRating = withFeedback.length
    ? (withFeedback.reduce((a,p)=>a+p.rating,0)/withFeedback.length).toFixed(1)
    : null;
 
  el.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:14px">
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;margin-bottom:4px">
        <div class="rev-card hl">
          <div class="rev-lbl">Average Rating</div>
          <div class="rev-val">${avgRating ? '⭐ '+avgRating : '—'}</div>
        </div>
        <div class="rev-card">
          <div class="rev-lbl">Reviews Received</div>
          <div class="rev-val">${withFeedback.length}</div>
        </div>
      </div>
      ${withFeedback.length === 0
        ? `<div class="empty-state"><span class="ei">⭐</span><h3>No feedback yet</h3><p>Patient ratings appear here after visits are completed.</p></div>`
        : withFeedback.slice().reverse().map(p=>`
          <div class="q-card">
            <div class="q-info">
              <div class="q-name">${esc(p.name)}</div>
              <div class="q-svcs">${p.svcs.map(s=>s.icon+' '+s.name).join(' · ')}</div>
              <div class="q-meta">📅 ${formatDate(p.date)}</div>
              ${p.comment ? `<div class="q-meta" style="color:var(--slate);margin-top:4px">"${esc(p.comment)}"</div>` : ''}
            </div>
            <div class="q-right">
              <div style="font-size:1.3rem">${'⭐'.repeat(p.rating)}${'☆'.repeat(5-p.rating)}</div>
            </div>
          </div>`).join('')}
    </div>`;
}
 
function renderFollowupTab() {
  const el = document.getElementById('followup-wrap');
  if (!el || currentTier !== 'premium') return;
  const withFollowup = S.completed.filter(p=>p.followupDate);
  const today = localToday();
  const overdue   = withFollowup.filter(p=>p.followupDate < today);
  const upcoming  = withFollowup.filter(p=>p.followupDate >= today).sort((a,b)=>a.followupDate.localeCompare(b.followupDate));
 
  el.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:16px">
      ${overdue.length > 0 ? `
        <div>
          <div class="rev-th" style="color:var(--danger);margin-bottom:10px">⚠️ Overdue Follow-ups (${overdue.length})</div>
          ${overdue.map(p=>`
            <div class="q-card" style="border-color:var(--danger-bg)">
              <div class="q-num" style="background:var(--danger-bg);color:var(--danger);border-color:var(--danger)">!</div>
              <div class="q-info">
                <div class="q-name">${esc(p.name)}</div>
                <div class="q-svcs">${p.svcs.map(s=>s.icon+' '+s.name).join(' · ')}</div>
                <div class="q-meta">Follow-up was: 📅 ${formatDate(p.followupDate)} · 📞 ${esc(p.contact)}</div>
              </div>
            </div>`).join('')}
        </div>` : ''}
      ${upcoming.length > 0 ? `
        <div>
          <div class="rev-th" style="margin-bottom:10px">📆 Upcoming Follow-ups (${upcoming.length})</div>
          ${upcoming.map(p=>`
            <div class="q-card">
              <div class="q-num" style="background:var(--teal-xlt);color:var(--teal-dk);border-color:var(--mint)">📅</div>
              <div class="q-info">
                <div class="q-name">${esc(p.name)}</div>
                <div class="q-svcs">${p.svcs.map(s=>s.icon+' '+s.name).join(' · ')}</div>
                <div class="q-meta">Scheduled: ${formatDate(p.followupDate)} · 📞 ${esc(p.contact)}</div>
              </div>
            </div>`).join('')}
        </div>` : ''}
      ${withFollowup.length === 0
        ? `<div class="empty-state"><span class="ei">📆</span><h3>No follow-ups scheduled</h3><p>Set a recommended return date when completing a patient to see it here.</p></div>`
        : ''}
    </div>`;
}
 
// ══════════════════════════════════════════════════
//  FOLLOW-UP MODAL
// ══════════════════════════════════════════════════
let _followupPatientId = null;
 
function openFollowup(patientId) {
  const p = S.completed.find(q=>q.id===patientId);
  if (!p) return;
  _followupPatientId = patientId;
 
  // Pre-fill if follow-up already set
  document.getElementById('followup-date-input').value  = p.followupDate || '';
  document.getElementById('followup-note-input').value  = p.followupNote || '';
  document.getElementById('followup-err').textContent   = '';
  document.getElementById('followup-date-input').min    = localToday();
 
  document.getElementById('followup-patient-info').innerHTML = `
    <strong>${esc(p.name)}</strong> &nbsp;·&nbsp; 📅 ${formatDate(p.date)}<br/>
    <span style="color:var(--muted)">${p.svcs.map(s=>s.icon+' '+s.name).join(' · ')}</span>`;
 
  document.getElementById('followup-overlay').classList.add('open');
}
 
function saveFollowup() {
  const date = document.getElementById('followup-date-input').value;
  const note = document.getElementById('followup-note-input').value.trim();
  const err  = document.getElementById('followup-err');
 
  if (!date) { err.textContent = 'Please select a return date.'; return; }
  if (date <= localToday()) { err.textContent = 'Follow-up date must be in the future.'; return; }
 
  const p = S.completed.find(q=>q.id===_followupPatientId);
  if (!p) return;
 
  p.followupDate = date;
  p.followupNote = note;
  save();
 
  closeFollowup();
  showToast(`📆 Follow-up set for ${p.name} on ${formatDate(date)}`);
  renderDashboard();
}
 
function closeFollowup() {
  document.getElementById('followup-overlay').classList.remove('open');
  _followupPatientId = null;
}
function closeFollowupOnBg(e) {
  if (e.target===document.getElementById('followup-overlay')) closeFollowup();
}
 
// ══════════════════════════════════════════════════
//  ABOUT MODAL
// ══════════════════════════════════════════════════
function openAbout() {
  document.getElementById('about-overlay').classList.add('open');
}
function closeAbout() {
  document.getElementById('about-overlay').classList.remove('open');
}
function closeAboutOnBg(e) {
  if (e.target === document.getElementById('about-overlay')) closeAbout();
}
 
// ══════════════════════════════════════════════════
//  PRICING MODAL
// ══════════════════════════════════════════════════
function openPricing() {
  document.getElementById('pricing-overlay').classList.add('open');
}
function closePricing() {
  document.getElementById('pricing-overlay').classList.remove('open');
}
function closePricingOnBg(e) {
  if (e.target === document.getElementById('pricing-overlay')) closePricing();
}
 
// ══════════════════════════════════════════════════
//  TIER SYSTEM
//  currentTier: 'free' | 'premium'
//  Toggle with the button in the sidebar for demo purposes
// ══════════════════════════════════════════════════
let currentTier = 'free';
 
const PREMIUM_TABS = ['tab-history','tab-revenue','tab-analytics','tab-feedback','tab-followup'];
const LOCK_LABELS  = {
  'tab-history':   { icon:'📅', title:'History Log',          desc:'Upgrade to Premium to access full daily patient records and dentist history.' },
  'tab-revenue':   { icon:'💰', title:'Revenue Overview',     desc:'Upgrade to Premium to track total earnings, service breakdowns, and average billing.' },
  'tab-analytics': { icon:'📊', title:'Analytics Dashboard',  desc:'Upgrade to Premium to see peak hours, patient retention, and monthly trends.' },
  'tab-feedback':  { icon:'⭐', title:'Patient Feedback',      desc:'Upgrade to Premium to collect star ratings and comments from patients after each visit.' },
  'tab-followup':  { icon:'📆', title:'Follow-up Scheduling', desc:'Upgrade to Premium to set recommended return dates for patients and track upcoming follow-ups.' },
};
 
function toggleTier() {
  currentTier = currentTier === 'free' ? 'premium' : 'free';
  applyTierUI();
  showToast(currentTier === 'premium' ? '⭐ Switched to Premium Plan' : '🔒 Switched to Free Plan');
}
 
function applyTierUI() {
  const isPremium = currentTier === 'premium';
 
  // Tier badge in sidebar
  const badge = document.getElementById('tier-badge-wrap');
  if (badge) {
    badge.innerHTML = `
      <div class="tier-badge ${isPremium ? 'premium' : 'free'}">
        <div class="tier-dot ${isPremium ? 'premium' : 'free'}"></div>
        ${isPremium ? '⭐ Premium Plan' : 'Starter Plan · Free'}
      </div>`;
  }
 
  // Toggle button text + icon
  const toggleBtn  = document.getElementById('btn-tier-toggle');
  const toggleIcon = document.getElementById('tier-toggle-icon');
  const toggleLbl  = document.getElementById('tier-toggle-label');
  if (toggleBtn) {
    toggleBtn.classList.toggle('is-premium', isPremium);
    if (toggleIcon) toggleIcon.textContent = isPremium ? '🔽' : '⭐';
    if (toggleLbl)  toggleLbl.textContent  = isPremium ? 'Switch to Free Plan' : 'Switch to Premium';
  }
 
  // Nav item locks
  PREMIUM_TABS.forEach(tabId => {
    const key    = tabId.replace('tab-','');
    const navBtn = document.querySelector(`.nav-item[data-tab="${tabId}"]`);
    const lockEl = document.getElementById(`nl-${key}`);
    if (navBtn)  navBtn.classList.toggle('unlocked', isPremium);
    if (lockEl)  lockEl.style.display = isPremium ? 'none' : '';
  });
 
  // Lock/unlock premium tab content
  PREMIUM_TABS.forEach(tabId => {
    const tabEl = document.getElementById(tabId);
    if (!tabEl) return;
    // Remove existing overlay
    const existing = tabEl.querySelector('.lock-overlay');
    if (existing) existing.remove();
 
    if (!isPremium) {
      const info = LOCK_LABELS[tabId];
      const overlay = document.createElement('div');
      overlay.className = 'lock-overlay';
      overlay.innerHTML = `
        <div class="lock-icon">${info.icon}</div>
        <div class="lock-title">${info.title}</div>
        <p class="lock-desc">${info.desc}</p>
        <button class="btn btn-gold" onclick="openPricing()">💎 View Premium Plans</button>`;
      // Insert as first child so it sits above any inner content
      tabEl.insertBefore(overlay, tabEl.firstChild);
    }
  });
 
  // If currently on a premium tab and switched to free — jump back to queue
  const activeTab = document.querySelector('.tab.active');
  if (!isPremium && activeTab && PREMIUM_TABS.includes(activeTab.id)) {
    const queueBtn = document.querySelector('.nav-item[data-tab="tab-queue"]');
    if (queueBtn) switchTab(queueBtn, 'tab-queue');
  }
}
 
 
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
 
