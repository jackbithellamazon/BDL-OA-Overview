function toggleSide(){
  const shell=document.querySelector('.shell');
  const min=!shell.classList.contains('side-min');
  shell.classList.toggle('side-min',min);
  const b=document.getElementById('sideToggle');
  if(b){ b.innerHTML=min?'\u27E9':'\u27E8 collapse'; b.title=min?'Expand the sidebar':'Collapse the sidebar'; }
  try{ localStorage.setItem('sideMin',min?'1':'0'); }catch(e){}
}
(function(){ try{ if(localStorage.getItem('sideMin')==='1') toggleSide(); }catch(e){} })();

let DB = [];
let SELLERS = [];
let DATA_LOADED = false;   // false until a load actually returns; nothing may prune before then
let COMPETITOR_SESSIONS = [];
let PROVIDER_SNAPSHOTS = [];
let PROVIDER_DEFS = []; // ordered master list of ACTIVE provider names (from bdl_providers)
let ARCHIVED_PROVIDERS = []; // provider names archived (hidden from active views, data retained)
let COMPETITOR_ASINS = {};   // { date: { sellerId: {size, asins[]} } } from Keepa fetches
let PROVIDER_RULES = []; // [{name, aliases, stems, titleKeywords}] classification rules for the SKU importer (from bdl_provider_rules)
let editIdx = null;
let rangeFrom = null, rangeTo = null;
let chartInstances = {};
let compFieldCount = 0;
let chartMetric = 'units';
let highlightedSeller = null;
let trackedProviders = new Set(); // Track which providers are visible on the trend chart
let providerSearch = '';
let provCardMetric = 'value'; // 'skus' | 'value' | 'both' — £ first (falls back to SKUs when no £ is saved)

function showSyncStatus(state) {
  let el = document.getElementById('syncStatus');
  if (!el) {
    el = document.createElement('div');
    el.id = 'syncStatus';
    el.style.cssText = 'position:fixed;top:14px;right:20px;font-family:var(--mono);font-size:10px;padding:5px 10px;z-index:8000;border-radius:2px;transition:all .3s';
    document.body.appendChild(el);
  }
  if (state==='loading') { el.style.background='var(--s3)'; el.style.color='var(--muted2)'; el.textContent='⟳ Syncing...'; el.style.opacity='1'; }
  else if (state==='saved') { el.style.background='var(--g2)'; el.style.color='var(--g)'; el.textContent='✓ Saved'; el.style.opacity='1'; setTimeout(()=>el.style.opacity='0',2000); }
  // Nothing is kept locally — if the sync fails the data is gone on refresh, so say so plainly.
  else if (state==='error') { el.style.background='var(--r2)'; el.style.color='var(--r)'; el.textContent='⚠ NOT SAVED — sync failed'; el.style.opacity='1'; setTimeout(()=>el.style.opacity='0',8000); }
}
function hideSyncStatus() { showSyncStatus(''); const el=document.getElementById('syncStatus'); if(el) el.style.opacity='0'; }

// ── Save progress popup ──────────────────────────────────────────────────────
// Each step maps to a real write, so the tick only appears once that write has
// actually come back clean. The last step is a read-back from Supabase, so
// "Saved" means the row was found in the database, not just that we sent it.
const SV_STEPS = [
  { key:'snapshot',    label:'Inventory snapshot' },
  { key:'providers',   label:'Provider breakdown' },
  { key:'competitors', label:'Competitors & sellers' },
  { key:'verify',      label:'Confirming in database' }
];
let _svEl = null, _svMinUntil = 0;

function svBuild() {
  if (_svEl) return _svEl;
  const el = document.createElement('div');
  el.className = 'sv-ov';
  el.id = 'saveProgressOverlay';
  el.innerHTML = `
    <div class="sv-card" id="svCard">
      <div class="sv-ringwrap" id="svRingWrap">
        <svg class="sv-ring" viewBox="0 0 96 96"><circle class="bg" cx="48" cy="48" r="42"/><circle class="fg" id="svRingFg" cx="48" cy="48" r="42"/></svg>
        <div class="sv-glyph" id="svGlyph"></div>
      </div>
      <div class="sv-title" id="svTitle">Saving snapshot</div>
      <div class="sv-sub" id="svSub"></div>
      <div class="sv-steps" id="svSteps"></div>
      <div id="svExtra"></div>
    </div>`;
  document.body.appendChild(el);
  _svEl = el;
  return el;
}

function svOpen(dateStr) {
  const el = svBuild();
  document.getElementById('svCard').classList.remove('is-err');
  document.getElementById('svTitle').textContent = 'Saving snapshot';
  document.getElementById('svSub').innerHTML = `for <b>${fmt(dateStr)}</b>`;
  document.getElementById('svGlyph').innerHTML = '0/4';
  document.getElementById('svRingFg').style.strokeDashoffset = 264;
  document.getElementById('svRingWrap').classList.add('spin');
  document.getElementById('svExtra').innerHTML = '';
  document.getElementById('svSteps').innerHTML = SV_STEPS.map(s =>
    `<div class="sv-step" id="svStep-${s.key}"><div class="sv-dot"></div><div class="sv-step-txt">${s.label}</div></div>`
  ).join('');
  requestAnimationFrame(() => el.classList.add('open'));
  _svMinUntil = performance.now() + 900; // never flash past too fast to read
  svStep('snapshot', 'active');
}

function svStep(key, state, note) {
  const row = document.getElementById('svStep-' + key);
  if (!row) return;
  row.className = 'sv-step ' + (state === 'active' ? 'active' : state === 'fail' ? 'fail' : 'done');
  const dot = row.querySelector('.sv-dot');
  dot.textContent = state === 'done' ? '✓' : state === 'fail' ? '✕' : '';
  if (note) {
    let n = row.querySelector('.sv-step-note');
    if (!n) { n = document.createElement('div'); n.className = 'sv-step-note'; row.appendChild(n); }
    n.textContent = note;
  }
  const done = SV_STEPS.filter(s => document.getElementById('svStep-' + s.key)?.classList.contains('done')).length;
  document.getElementById('svRingFg').style.strokeDashoffset = 264 - (264 * done / SV_STEPS.length);
  const glyph = document.getElementById('svGlyph');
  if (glyph && !glyph.querySelector('svg')) glyph.textContent = `${done}/${SV_STEPS.length}`;
}

// Handed to persist() — fires as each real write comes back, then lights up
// whichever step is next in the list.
function svOnStep(key, state, note) {
  if (state === 'fail') { svStep(key, 'fail'); return; }
  svStep(key, 'done', note);
  const next = SV_STEPS[SV_STEPS.findIndex(s => s.key === key) + 1];
  if (next) svStep(next.key, 'active');
}

async function svSuccess(dateStr, counts) {
  const wait = _svMinUntil - performance.now();
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  document.getElementById('svRingWrap').classList.remove('spin');
  document.getElementById('svGlyph').innerHTML =
    `<svg class="sv-tick" viewBox="0 0 52 52"><path d="M14 27l8.5 8.5L38 18"/></svg>`;
  document.getElementById('svTitle').textContent = 'Snapshot saved';
  document.getElementById('svSub').innerHTML =
    `<b>${fmt(dateStr)}</b> is stored and confirmed in the database.${counts ? `<br>${counts}` : ''}`;
  setTimeout(svClose, 1700);
}

function svFailure(errors, failedKey) {
  document.getElementById('svRingWrap').classList.remove('spin');
  document.getElementById('svCard').classList.add('is-err');
  document.getElementById('svGlyph').innerHTML =
    `<svg class="sv-tick" viewBox="0 0 52 52"><path d="M17 17l18 18M35 17L17 35"/></svg>`;
  document.getElementById('svTitle').textContent = 'Not saved';
  document.getElementById('svSub').innerHTML = 'This snapshot did <b>not</b> reach the database.';
  if (failedKey) svStep(failedKey, 'fail');
  SV_STEPS.forEach(s => {
    const row = document.getElementById('svStep-' + s.key);
    if (row && !row.classList.contains('done') && !row.classList.contains('fail')) row.className = 'sv-step';
  });
  const list = [...new Set(errors || [])];
  document.getElementById('svExtra').innerHTML = `
    <div class="sv-err">
      <b>Your entry has not been lost</b>
      It is still in the form behind this window. Check your internet connection and press
      <strong>Save Snapshot</strong> again. Do not close the form — nothing is stored on this
      computer, so closing it now would lose the entry.
      ${list.length ? `<div class="detail">${list.map(e => `• ${e}`).join('<br>')}</div>` : ''}
    </div>
    <div class="sv-actions"><button class="sv-btn primary" onclick="svClose()">Back to the form</button></div>`;
}

function svClose() {
  if (!_svEl) return;
  _svEl.classList.remove('open');
}
window.svClose = svClose;

// Set while a save is in flight so a refresh/close mid-write warns instead of silently
// losing the entry.
let SAVE_IN_FLIGHT = false;
window.addEventListener('beforeunload', e => {
  if (!SAVE_IN_FLIGHT) return;
  e.preventDefault();
  e.returnValue = 'A save is still in progress — leaving now will lose it.';
  return e.returnValue;
});

// Errors from the most recent persist(), for callers that present their own failure UI.
let LAST_SAVE_ERRORS = [];

// onStep  — optional (key, state, note) callback for the save progress popup.
// quiet   — skip the corner badge and legacy error popup when a caller shows its own.
async function persist(onStep, quiet, opts) {
  LAST_SAVE_ERRORS = [];
  if (!window._supabaseSave) {
    LAST_SAVE_ERRORS = ['Save function unavailable — the page did not load correctly. Reload and try again.'];
    if (!quiet) { showSyncStatus('error'); showSaveErrorPopup(LAST_SAVE_ERRORS); }
    return false;
  }
  SAVE_IN_FLIGHT = true;
  try {
    if (!quiet) showSyncStatus('loading');
    const result = await window._supabaseSave(DB, SELLERS, COMPETITOR_SESSIONS, PROVIDER_SNAPSHOTS, onStep, opts || {});
    const ok = result === true;
    if (!ok) LAST_SAVE_ERRORS = (result && result.errors && result.errors.length) ? result.errors : ['The save did not complete.'];
    if (!quiet) {
      showSyncStatus(ok ? 'saved' : 'error');
      if (!ok) showSaveErrorPopup(LAST_SAVE_ERRORS);
    }
    return ok;
  } catch (e) {
    LAST_SAVE_ERRORS = [e?.message || String(e)];
    if (!quiet) { showSyncStatus('error'); showSaveErrorPopup(LAST_SAVE_ERRORS); }
    return false;
  } finally {
    SAVE_IN_FLIGHT = false;
  }
}

function showSaveErrorPopup(errors) {
  // Remove any existing popup
  const old = document.getElementById('saveErrPopup');
  if (old) old.remove();
  const el = document.createElement('div');
  el.id = 'saveErrPopup';
  el.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:9999;background:var(--s1);border:1px solid var(--r);border-radius:12px;padding:18px 22px;max-width:560px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,.5)';
  const uniqueErrors = [...new Set(errors)];
  const isColMissing = uniqueErrors.some(e => /column|does not exist|42703/i.test(e));
  el.innerHTML = `
    <div style="display:flex;align-items:flex-start;gap:12px">
      <div style="font-size:20px;line-height:1;flex:none">⚠</div>
      <div style="flex:1;min-width:0">
        <div style="font-family:var(--mono);font-size:12px;font-weight:700;color:var(--r);margin-bottom:6px">Save failed — ${uniqueErrors.length} error${uniqueErrors.length!==1?'s':''}</div>
        ${isColMissing ? `<div style="font-family:var(--mono);font-size:11px;color:var(--y);margin-bottom:8px;line-height:1.5">Missing database columns detected. You need to run the SQL migration in your Supabase SQL editor for the columns named below. Your data was NOT lost (it's saved in-session), but it won't persist across refresh until the migration is run.</div>` : ''}
        <div style="font-family:var(--mono);font-size:10px;color:var(--muted2);max-height:120px;overflow-y:auto;line-height:1.6">${uniqueErrors.map(e=>`<div>• ${e}</div>`).join('')}</div>
      </div>
      <button onclick="document.getElementById('saveErrPopup').remove()" style="background:none;border:none;color:var(--muted2);font-size:18px;cursor:pointer;flex:none;line-height:1;padding:2px">×</button>
    </div>`;
  document.body.appendChild(el);
  // Auto-dismiss after 12 seconds unless they've already closed it
  setTimeout(() => { const p = document.getElementById('saveErrPopup'); if (p) p.remove(); }, 12000);
}

const TITLES = { overview:'Overview', daily:'Business Brief', stockhealth:'Stock Health', provider:'Provider', repricer:'Repricer', competitors:'Competitors', 'comp-history':'Competitor History', history:'History', settings:'Settings' };
function switchTab(id, el) {
  document.querySelectorAll('.tab-page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('tab-' + id).classList.add('active');
  el.classList.add('active');
  document.getElementById('pageTitle').textContent = TITLES[id];
  if (id === 'competitors') renderCompTab();
  if (id === 'comp-history') renderCompHistory();
  if (id === 'history') renderHistory();
  if (id === 'provider') renderProviderTab();
  if (id === 'settings') renderSettingsTab();
  if (id === 'stockhealth') renderStockHealth();
  // Stock Health has its own range picker; the header one does nothing there, so hide it.
  const ownRange = ['stockhealth','history','comp-history','settings','competitors','provider'].includes(id);   // Competitors and Provider never used it   // pages with their own range (or none)
  const rp = document.querySelector('.range-presets'); if (rp) rp.style.display = ownRange ? 'none' : '';
  if (ownRange) { const dw = document.getElementById('dateRangeWrap'); if (dw) dw.style.display = 'none'; }
  updateLastUpdated();
}

function switchTabMobile(id) {
  document.querySelectorAll('.tab-page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.mobile-nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('tab-' + id).classList.add('active');
  const mn = document.getElementById('mn-' + id);
  if (mn) mn.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('pageTitle').textContent = TITLES[id];
  if (id === 'competitors') renderCompTab();
  if (id === 'comp-history') renderCompHistory();
  if (id === 'history') renderHistory();
  if (id === 'provider') renderProviderTab();
  if (id === 'stockhealth') renderStockHealth();
}

function setDatePreset(p, e) {
  e.preventDefault();
  const dateWrap = document.getElementById('dateRangeWrap');
  
  if (p === 'custom') {
    dateWrap.style.display = 'flex';
    document.querySelectorAll('header .range-preset').forEach(b => b.classList.remove('active'));
    e.target.classList.add('active');
    return;
  }
  
  dateWrap.style.display = 'none';
  document.querySelectorAll('header .range-preset').forEach(b => b.classList.remove('active'));
  e.target.classList.add('active');

  const now = new Date();
  const sorted = [...DB].sort((a,b)=>a.date.localeCompare(b.date));
  if (!sorted.length) { rangeFrom=null; rangeTo=null; return; }

  if (p === 'last30') {
    const d = new Date(now);
    d.setDate(d.getDate()-30);
    rangeFrom = d.toLocaleDateString('en-CA');
    rangeTo = now.toLocaleDateString('en-CA');
  } else if (p === 'mtd') {
    const mtdStart = new Date(now.getFullYear(), now.getMonth(), 1);
    rangeFrom = mtdStart.toLocaleDateString('en-CA');
    rangeTo = now.toLocaleDateString('en-CA');
  } else if (p === 'last7') {
    const d = new Date(now);
    d.setDate(d.getDate()-7);
    rangeFrom = d.toLocaleDateString('en-CA');
    rangeTo = now.toLocaleDateString('en-CA');
  } else if (p === 'lastmonth') {
    const d = new Date(now.getFullYear(), now.getMonth()-1, 1);
    const d2 = new Date(now.getFullYear(), now.getMonth(), 0);
    rangeFrom = d.toLocaleDateString('en-CA');
    rangeTo = d2.toLocaleDateString('en-CA');
  } else if (p === 'ytd') {
    const ytdStart = new Date(now.getFullYear(), 0, 1);
    rangeFrom = ytdStart.toLocaleDateString('en-CA');
    rangeTo = now.toLocaleDateString('en-CA');
  } else if (p === 'last3m') {
    const d = new Date(now);
    d.setMonth(d.getMonth()-3);
    rangeFrom = d.toLocaleDateString('en-CA');
    rangeTo = now.toLocaleDateString('en-CA');
  }
  document.getElementById('rangeFrom').value = rangeFrom || '';
  document.getElementById('rangeTo').value = rangeTo || '';
  renderAll();
}

function applyRange() {
  rangeFrom = document.getElementById('rangeFrom').value || null;
  rangeTo = document.getElementById('rangeTo').value || null;
  document.querySelectorAll('header .range-preset').forEach(b => b.classList.remove('active'));
  renderAll();
}

function filteredSnaps() {
  let d = [...DB].sort((a,b) => a.date.localeCompare(b.date));
  // Only filter by range if both are set
  if (rangeFrom && rangeTo) {
    d = d.filter(s => s.date >= rangeFrom && s.date <= rangeTo);
  } else if (DB.length > 0) {
    // If no range set, show all data
    // (do nothing, return all)
  }
  return d;
}

// Helper: get 4 comparison snapshots for trend analysis
function getComparisonSnapshots(snaps) {
  if (snaps.length < 2) return { current: null, eightDaysAgo: null, monthStart: null, thirtyDaysAgo: null };
  
  const current = snaps[snaps.length - 1];
  const currentDate = new Date(current.date + 'T00:00:00');
  
  // 8+ days ago
  const eightDaysBack = new Date(currentDate);
  eightDaysBack.setDate(eightDaysBack.getDate() - 8);
  let eightDaysAgo = snaps.filter(s => new Date(s.date + 'T00:00:00') <= eightDaysBack).pop() || snaps[0];
  
  // 1st of current month (if exists and not current), else 1st of previous month
  const monthStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
  // the first entry of this month (only 3 of 81 entries were ever dated the 1st)
  let monthStartSnap = snaps.filter(s => {
    const d = new Date(s.date + 'T00:00:00');
    return d.getFullYear() === monthStart.getFullYear() && d.getMonth() === monthStart.getMonth();
  })[0];
  if (monthStartSnap === current) monthStartSnap = null;
  
  if (!monthStartSnap && currentDate.getDate() > 1) {
    // Try previous month's 1st
    const prevMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1);
    monthStartSnap = snaps.filter(s => {
      const d = new Date(s.date + 'T00:00:00');
      return d.getFullYear() === prevMonth.getFullYear() && d.getMonth() === prevMonth.getMonth();
    })[0];
  }
  
  // 30 days ago
  const thirtyDaysBack = new Date(currentDate);
  thirtyDaysBack.setDate(thirtyDaysBack.getDate() - 30);
  let thirtyDaysAgo = snaps.filter(s => new Date(s.date + 'T00:00:00') <= thirtyDaysBack).pop();
  
  return { current, eightDaysAgo, monthStart: monthStartSnap, thirtyDaysAgo };
}

function renderAll() {
  const snaps = filteredSnaps();
  renderKpis(snaps);
  initPopouts();  // Setup popout listeners
  renderInsights(snaps);
  renderOverviewChart(snaps);
  renderAgeing(snaps);
  renderAgingChart(snaps); // Add to Overview
  try {
    renderDailySummary(snaps); // Add Daily Summary tab
  } catch (e) {
    console.error('Daily Summary error:', e);
  }
  renderRepricerTab(snaps);
  renderCompTab();
  renderCompInsights(snaps);
  renderBadges();
  updateLastUpdated();
}

function renderDailySummary(snaps) {
  const container = document.getElementById('dailySummaryContainer');
  if (!container) return;
  if (!window._briefDate) window._briefDate = null;
  const snapDates = [...new Set(snaps.map(s=>s.date))].sort();
  const defaultDate = snapDates[snapDates.length-1] || null;
  const selectedDate = window._briefDate && snapDates.includes(window._briefDate) ? window._briefDate : defaultDate;
  if (!snaps.length || !selectedDate) {
    container.innerHTML = `<div style="text-align:center;padding:80px 20px;color:var(--muted2);font-family:var(--mono)"><div style="font-size:18px;margin-bottom:12px;color:var(--g)">◎</div><div>No snapshots yet — add your first snapshot to see your Business Brief.</div></div>`;
    return;
  }
  // Every comparison uses all entries up to the chosen date (not just the range on screen), and
  // better/worse is judged like the rest of the app: last week's entries averaged against the week
  // two weeks before. Your entered figures come first (Jack's rule: what you input beats anything else).
  const ALL = shAllSnaps(), idx = ALL.findIndex(s => s.date === selectedDate);
  const snap = ALL[idx], prev = idx > 0 ? ALL[idx-1] : null, upto = selectedDate;
  const daysBetween = prev ? Math.round((Date.parse(snap.date) - Date.parse(prev.date)) / 864e5) : null;
  const T = g => kpiTrend2w(g, upto);
  const GOOD_='#00f5a0', WARN='#ffd166', ORNG='#ff8c42', BAD_='#ff4d6d';
  const winNow = repPct(snap,'win'), matchNow = repPct(snap,'match');
  const tWin = T(s => repPct(s,'win')), tMatch = T(s => repPct(s,'match'));
  const tSV = T(s => s.stockValue || null), tUnits = T(s => s.totalUnits || null), tCost = T(s => s.avgCost || null);
  const tInbV = T(s => s.inboundValue ?? null), tInbU = T(s => s.inboundUnits ?? null), tSkus = T(s => s.skus || null);
  const hasVal = shHasValuation(snap), z = shZones(snap), zv = hasVal ? shZoneValues(snap) : null;
  const share = shBucketTotal(snap) ? shShare90(snap, hasVal ? 'gbp' : 'sku') : null;
  const shareSku = shBucketTotal(snap) ? shShare90(snap, 'sku') : null, shareAsin = snap.ageingAsin ? shShare90(snap, 'asin') : null;
  const tShare = T(s => shBucketTotal(s) ? shShare90(s, shHasValuation(s) ? 'gbp' : 'sku') : null);
  const tP90 = T(s => shHasValuation(s) ? (v => v.caution + v.action)(shZoneValues(s)) : null);
  const tP180 = T(s => shHasValuation(s) ? shZoneValues(s).action : null);
  const V = typeof shVerdict === 'function' ? shVerdict(upto) : null;
  const byLbl = hasVal ? 'stock value' : 'SKUs';

  // ── Status: the worst thing on the page, from the same signals the rest of the page shows ──
  let level = 0; const lift = l => { level = Math.max(level, l); };
  const concerns = [], positives = [], actions = [];
  const add = (lvl, area, text) => { lift(lvl); concerns.push({ lvl, area, text }); };
  if (winNow != null) {
    if (winNow < 5) add(3, 'Repricer', `Win BB ${winNow.toFixed(1)}% — under 5%, your listings are close to invisible.`);
    else if (winNow < BB_TARGET) add(1, 'Repricer', `Win BB ${winNow.toFixed(1)}% — under your ${BB_TARGET}% target${tWin ? ` (2-week average ${tWin.then.toFixed(1)}% → ${tWin.now.toFixed(1)}%)` : ''}.`);
    else positives.push(`Win BB ${winNow.toFixed(1)}% — at or above your ${BB_TARGET}% target.`);
    if (tWin && tWin.d >= 0.3) positives.push(`Win BB improving — 2-week average ${tWin.then.toFixed(1)}% → ${tWin.now.toFixed(1)}%.`);
    else if (tWin && tWin.d <= -0.3) add(1, 'Repricer', `Win BB falling — 2-week average ${tWin.then.toFixed(1)}% → ${tWin.now.toFixed(1)}%.`);
  }
  if (matchNow != null) {
    if (tMatch && tMatch.d <= -0.3) add(1, 'Repricer', `Match BB falling — 2-week average ${tMatch.then.toFixed(1)}% → ${tMatch.now.toFixed(1)}%.`);
    else if (tMatch && tMatch.d >= 0.3) positives.push(`Match BB improving — 2-week average ${tMatch.then.toFixed(1)}% → ${tMatch.now.toFixed(1)}%.`);
  }
  if (V) {
    const facts = kfEsc(shVerdictTitle(V).split(' · ').slice(1).join(' · '));
    if (V.v === 'worse') add(2, 'Stock health', `Getting worse over 2 weeks — ${facts}.`);
    else if (V.v === 'mixed') add(1, 'Stock health', `Mixed over 2 weeks — ${V.why}.`);
    else if (V.v === 'better') positives.push(`Stock health getting healthier — ${facts}.`);
  }
  if (share != null) {
    if (share < SH_FLOOR) add(2, 'Stock health', `${share.toFixed(1)}% of your ${byLbl} is under 90 days old — below your ${SH_FLOOR}% floor.`);
    else if (share < SH_GOAL) add(1, 'Stock health', `${share.toFixed(1)}% of your ${byLbl} is under 90 days old — above the ${SH_FLOOR}% floor, under the ${SH_GOAL}% goal.`);
    else positives.push(`${share.toFixed(1)}% of your ${byLbl} is under 90 days old — at or above your ${SH_GOAL}% goal.`);
  }
  if (z.action > 0) {
    const up = tP180 && tP180.d >= 0.5, down = tP180 && tP180.d <= -0.5;
    if (down) positives.push(`${zv ? fmtGBP(zv.action) + ' ' : ''}past your 180-day limit (${z.action} SKUs) — 2-week average down ${fmtGBP(Math.abs(tP180.d))}.`);
    else add(up ? 1 : 0, 'Stock health', `${zv ? fmtGBP(zv.action) + ' ' : ''}past your 180-day limit (${z.action} SKUs)${tP180 ? ` — 2-week average ${tP180.d >= 0 ? 'up' : 'down'} ${fmtGBP(Math.abs(tP180.d))}` : ''}.`);
    actions.push(`Reprice or clear the ${z.action} SKUs past 180 days${zv ? ` (${fmtGBP(zv.action)})` : ''} — Stock Health → Stock by provider lists them by source, biggest £ first.`);
  } else if (shBucketTotal(snap)) positives.push('Nothing past your 180-day limit.');
  if (tSV && tInbV && tSV.d < -0.5 && tInbV.d < -0.5) add(1, 'Buying', `Stock value and inbound both down over 2 weeks (stock ${fmtGBP(tSV.then)} → ${fmtGBP(tSV.now)}, inbound ${fmtGBP(tInbV.then)} → ${fmtGBP(tInbV.now)}) — buying isn't keeping pace with selling.`);
  else if (tSV && tSV.d >= 0.5) positives.push(`Stock value up over 2 weeks — ${fmtGBP(tSV.then)} → ${fmtGBP(tSV.now)}.`);
  if (winNow != null && matchNow != null && winNow < BB_TARGET && matchNow > winNow + 5) actions.push(`Win BB (${winNow.toFixed(1)}%) is well below Match BB (${matchNow.toFixed(1)}%) — a small floor-price cut could turn matches into wins.`);
  concerns.sort((x, y) => y.lvl - x.lvl);
  const groups = [];
  concerns.forEach(c => { let g = groups.find(x => x.area === c.area); if (!g) groups.push(g = { area: c.area, lvl: c.lvl, texts: [] }); g.texts.push(c.text); });
  const STATUS = [
    { label:'All good',        color:GOOD_, bg:'rgba(0,245,160,.12)',  border:'rgba(0,245,160,.35)' },
    { label:'Worth watching',  color:WARN,  bg:'rgba(255,209,102,.12)', border:'rgba(255,209,102,.35)' },
    { label:'Needs attention', color:ORNG,  bg:'rgba(255,140,66,.13)',  border:'rgba(255,140,66,.38)' },
    { label:'Urgent',          color:BAD_,  bg:'rgba(255,77,109,.13)',  border:'rgba(255,77,109,.4)' } ];
  const sc = STATUS[level];
  const focusOn = concerns.length ? `<b style="color:${sc.color}">${groups[0].area}:</b> ${groups[0].texts[0]}${concerns.length > 1 ? ` <span style="color:var(--muted2)">+ ${concerns.length - 1} more below</span>` : ''}`
    : 'Nothing over the line — Buy Box, stock health and buying all look fine.';

  // ── numbers: last entry, and the 2-week average ──
  const sgn = (d, f) => d > 0 ? '+' + f(d) : d < 0 ? '−' + f(-d) : '±0';
  const diffSpan = (d, f, goodUp, label) => d == null ? '' : `<span style="color:${Math.abs(d) < 1e-9 || goodUp == null ? 'var(--muted2)' : (d > 0) === goodUp ? GOOD_ : ORNG}">${sgn(d, f)}</span> <span style="color:var(--muted)">${label}</span>`;
  const n0 = v => Math.round(v).toLocaleString(), pp = v => v.toFixed(1) + 'pp', gbp = v => fmtGBP(v), gbp2 = v => '£' + v.toFixed(2);
  const pv = f => prev ? f(prev) : null;
  const kpi = (label, val, cur, prv, t, f, goodUp, alert) => ({ label, val, alert,
    l1: cur != null && prv != null ? diffSpan(cur - prv, f, goodUp, 'vs last') : '',
    l2: t ? diffSpan(t.d, f, goodUp, 'vs 2 wks') : '' });
  const kpis = [
    kpi('Stock value', fmtGBP(snap.stockValue||0), snap.stockValue, pv(x=>x.stockValue), tSV, gbp, true),
    kpi('Units', n0(snap.totalUnits||0), snap.totalUnits, pv(x=>x.totalUnits), tUnits, n0, true),
    kpi('SKUs', n0(snap.skus||0), snap.skus, pv(x=>x.skus), tSkus, n0, true),
    kpi('Avg unit cost', gbp2(snap.avgCost||0), snap.avgCost, pv(x=>x.avgCost), tCost, gbp2, null),
    kpi('Win BB', winNow != null ? winNow.toFixed(1) + '%' : '—', winNow, prev ? repPct(prev,'win') : null, tWin, pp, true, winNow != null && winNow < BB_TARGET),
    kpi('Match BB', matchNow != null ? matchNow.toFixed(1) + '%' : '—', matchNow, prev ? repPct(prev,'match') : null, tMatch, pp, true),
    kpi('£ past 90 days', zv ? fmtGBP(zv.caution + zv.action) : `${z.caution + z.action} SKUs`, zv ? zv.caution + zv.action : null, prev && zv && shHasValuation(prev) ? (v => v.caution + v.action)(shZoneValues(prev)) : null, tP90, gbp, false),
    kpi('£ past 180 days', zv ? fmtGBP(zv.action) : `${z.action} SKUs`, zv ? zv.action : null, prev && zv && shHasValuation(prev) ? shZoneValues(prev).action : null, tP180, gbp, false, z.action > 0),
  ];
  // ── better or worse · 2 weeks ──
  const bw = [
    ['Under 90 days (' + (hasVal ? '£' : 'SKUs') + ')', tShare, v => v.toFixed(1) + '%', true],
    ['£ past 90 days', tP90, gbp, false], ['£ past 180 days', tP180, gbp, false],
    ['Win BB', tWin, v => v.toFixed(1) + '%', true], ['Match BB', tMatch, v => v.toFixed(1) + '%', true],
    ['Stock value', tSV, gbp, true], ['Units', tUnits, n0, true], ['Inbound £', tInbV, gbp, null], ['Avg unit cost', tCost, gbp2, null],
  ].filter(r => r[1]);
  const bwRow = ([lab, t, f, goodUp]) => { const flat = Math.abs(t.d) < (f === gbp || f === n0 ? 0.5 : 0.05);
    const fd = f(1).endsWith('%') ? pp : f;   // a change in a % is percentage points
    const col = flat || goodUp == null ? 'var(--muted2)' : (t.d > 0) === goodUp ? GOOD_ : ORNG;
    const read = flat ? '→ flat' : goodUp == null ? (t.d > 0 ? '▲ up' : '▼ down') : (t.d > 0) === goodUp ? '▲ better' : '▼ worse';
    return `<tr><td>${lab}</td><td>${f(t.then)}</td><td>${f(t.now)}</td><td style="color:${col}">${sgn(t.d, fd)}</td><td style="color:${col};font-weight:700">${read}</td></tr>`; };
  const anyT = bw.find(r => r[1]);
  const span = anyT ? kpiSpan(anyT[1]).replace('Average of entries ', '') : '';

  // ── Repricer pulse ──
  const tot = snap.repricer?.total || 0;
  const needN = tot ? Math.ceil(tot * BB_TARGET / 100) : null, haveN = snap.repricer?.winning ?? null;
  const repricerPulse = winNow == null ? 'No repricer figures on this entry.'
    : `${winNow >= BB_TARGET ? `At or above your ${BB_TARGET}% target.` : `Under your ${BB_TARGET}% target${needN != null && haveN != null ? ` — ${BB_TARGET}% of ${tot.toLocaleString()} listings is ${needN} winning; you have ${haveN} (${needN - haveN} to go)` : ''}.`}`
      + `${tWin ? ` 2-week average ${tWin.then.toFixed(1)}% → ${tWin.now.toFixed(1)}%.` : ''}`
      + `${matchNow != null ? ` Combined coverage (win + match) ${(winNow + matchNow).toFixed(1)}%.` : ''}`;
  // ── Stock pulse ──
  const lowSince = (() => { if (share == null) return ''; const earlier = ALL.slice(0, idx).filter(s => shBucketTotal(s)).reverse();
    const hit = earlier.find(s => shShare90(s, shHasValuation(s) ? 'gbp' : 'sku') <= share); return hit ? (hit === earlier[0] ? '' : `lowest since ${fmt(hit.date)}`) : 'lowest on record'; })();
  const vInfo = V ? SH_VMAP[V.v] : null;
  const stockHead = share == null ? 'No ageing figures on this entry' : `${share.toFixed(1)}% under 90 days ${hasVal ? 'by £' : 'by SKUs'}${vInfo ? ` · ${vInfo[1].charAt(0) + vInfo[1].slice(1).toLowerCase()}` : ''}`;
  const stockCol = share == null ? 'var(--muted2)' : shZoneColor(share);
  const stockPulse = share == null ? '' : `Goal ${SH_GOAL}%, floor ${SH_FLOOR}%.${lowSince ? ` That's the ${lowSince}.` : ''}`
    + `${shareSku != null ? ` By SKUs ${shareSku.toFixed(1)}%` : ''}${shareAsin != null ? `, by ASINs ${shareAsin.toFixed(1)}%` : ''}.`
    + `${zv ? ` ${fmtGBP(zv.caution + zv.action)} past 90 days (${z.caution + z.action} SKUs) · ${fmtGBP(zv.action)} past 180 days (${z.action} SKUs).` : ` ${z.caution + z.action} SKUs past 90 days · ${z.action} past 180.`}`
    + `${V && V.why ? ` ${V.why}.` : ''}`;
  // ── Competitor pulse: the leads model, same as the Competitors page ──
  let compHead = '', compPulse = '';
  const LT = typeof leadTotals === 'function' ? leadTotals() : null;
  if (LT) {
    const t = LT.trend, vMap = { better:['▲','better',GOOD_], worse:['▼','worse',BAD_], mixed:['◆','mixed',ORNG], same:['●','steady','var(--b)'] };
    const rv = { better:0, worse:0, mixed:0, same:0 }; (SELLERS||[]).forEach(x => { const st = x.sellerId && leadStats(x.sellerId); if (st && st.trend) rv[st.trend.v]++; });
    compHead = `On ${LT.uOn.toLocaleString()} of their leads${t ? ` · <span style="color:${vMap[t.v][2]}">${vMap[t.v][0]} ${Math.abs(t.n)} vs 2 weeks</span>` : ''}`;
    compPulse = `${t && t.v === 'mixed' ? t.why.charAt(0).toUpperCase() + t.why.slice(1) + ' (share ' + t.pThen.toFixed(1) + '% → ' + t.pNow.toFixed(1) + '%). ' : t && t.pThen != null ? `Share of their products ${t.pThen.toFixed(1)}% → ${t.pNow.toFixed(1)}%. ` : ''}`
      + `Rivals: <b style="color:${GOOD_}">${rv.better}</b> better · <b style="color:${ORNG}">${rv.mixed}</b> mixed · <b style="color:${BAD_}">${rv.worse}</b> worse. <span style="color:var(--muted)">As of the ${fmt(LT.date)} fetch.</span>`;
  }
  // ── Provider movers: 2-week average £ per provider ──
  let provHtml = '';
  if (typeof PROVIDER_SNAPSHOTS !== 'undefined' && PROVIDER_SNAPSHOTS.length && typeof ldWindows === 'function') {
    const pd = [...new Set(PROVIDER_SNAPSHOTS.filter(r => r.date <= upto).map(r => r.date))].sort();
    const w = pd.length > 1 ? ldWindows(pd) : null;
    if (w && w.then) {
      const avgOf = (name, ds) => ds.reduce((t, d) => t + incVat(PROVIDER_SNAPSHOTS.find(r => r.date === d && r.provider === name)?.value || 0), 0) / ds.length;
      const names = [...new Set(PROVIDER_SNAPSHOTS.map(r => r.provider))].filter(n => n !== NA_PROVIDER);
      const mv = names.map(n => ({ n, then: avgOf(n, w.then), now: avgOf(n, w.now) })).map(o => ({ ...o, d: o.now - o.then })).filter(o => Math.abs(o.d) >= 1);
      const up = mv.filter(o => o.d > 0).sort((x, y) => y.d - x.d).slice(0, 3), dn = mv.filter(o => o.d < 0).sort((x, y) => x.d - y.d).slice(0, 3);
      const li = (o, col) => `<div class="brief-item" style="padding:7px 0"><span style="color:${col};font-weight:700;min-width:90px">${o.d > 0 ? '▲ +' : '▼ −'}${fmtGBP(Math.abs(o.d))}</span><span style="color:var(--text)">${kfEsc(o.n)}</span><span style="margin-left:auto;color:var(--muted)">${fmtGBP(o.then)} → ${fmtGBP(o.now)}</span></div>`;
      provHtml = `<div class="brief-section"><div class="brief-section-title">Providers · stock £ over 2 weeks (averaged)</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
          <div class="brief-panel" style="background:var(--s2);border:1px solid var(--border)"><div style="color:${GOOD_};font-weight:700;margin-bottom:4px">Growing</div>${up.map(o => li(o, GOOD_)).join('') || '<div style="color:var(--muted)">None</div>'}</div>
          <div class="brief-panel" style="background:var(--s2);border:1px solid var(--border)"><div style="color:${ORNG};font-weight:700;margin-bottom:4px">Shrinking (selling down or not restocked)</div>${dn.map(o => li(o, ORNG)).join('') || '<div style="color:var(--muted)">None</div>'}</div>
        </div></div>`;
    }
  }

  const dateOptions = snapDates.map(d=>`<option value="${d}" ${d===selectedDate?'selected':''}>${fmt(d)}</option>`).reverse().join('');
  const lvlCol = l => [GOOD_, WARN, ORNG, BAD_][l];
  const glyph = l => ['●','▲','▲','■'][l];
  container.innerHTML = `
  <style>
    .brief-section{margin-bottom:20px}
    .brief-section-title{font-family:var(--mono);font-size:11px;text-transform:uppercase;letter-spacing:.12em;color:var(--muted2);margin-bottom:10px}
    .brief-panel{padding:14px 16px;border-radius:8px;font-family:var(--mono);font-size:12px;color:var(--muted2);line-height:1.7}
    .brief-col{display:flex;flex-direction:column}
    .brief-col > .brief-panel{flex:1}
    .brief-item{display:flex;align-items:flex-start;gap:10px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.05)}
    .brief-item:last-child{border-bottom:none}
    .brief-bw{width:100%;border-collapse:collapse;font-family:var(--mono);font-size:12px}
    .brief-bw th{padding:6px 10px;text-align:left;color:var(--muted2);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid var(--border)}
    .brief-bw td{padding:7px 10px;color:var(--text);border-bottom:1px solid rgba(255,255,255,.04);white-space:nowrap}
  </style>
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
    <div>
      <div style="font-size:18px;font-weight:700;color:var(--text);margin-bottom:2px">Business Brief</div>
      <div style="font-family:var(--mono);font-size:11.5px;color:var(--muted2)">Entry: ${fmt(snap.date)}${prev?` · ${daysBetween} day${daysBetween===1?'':'s'} since the one before`:''} · better/worse = last week averaged vs two weeks before</div>
    </div>
    <div style="display:flex;align-items:center;gap:12px">
      <select onchange="window._briefDate=this.value;renderDailySummary(filteredSnaps())" style="background:var(--s2);border:1px solid var(--border);color:var(--text);font-family:var(--mono);font-size:12px;padding:6px 10px;border-radius:6px;cursor:pointer">${dateOptions}</select>
      <div style="padding:8px 16px;background:${sc.bg};border:1px solid ${sc.border};border-radius:8px;font-family:var(--mono);font-size:12px;font-weight:700;color:${sc.color}">${sc.label}</div>
    </div>
  </div>
  <div style="padding:16px 20px;background:${sc.bg};border:1px solid ${sc.border};border-radius:10px;margin-bottom:20px">
    <div style="font-family:var(--mono);font-size:11px;text-transform:uppercase;letter-spacing:.12em;color:${sc.color};margin-bottom:8px">Focus for today</div>
    <div style="font-family:var(--mono);font-size:13px;color:var(--text);line-height:1.65;font-weight:500">${focusOn}</div>
  </div>
  <div class="brief-section">
    <div class="brief-section-title">This entry at a glance</div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">
      ${kpis.map(k=>`<div style="background:var(--s2);padding:12px 14px;border-radius:8px;border:1px solid ${k.alert?'rgba(255,140,66,.45)':'var(--border)'}">
        <div style="font-family:var(--mono);font-size:11px;color:var(--muted2);margin-bottom:4px;text-transform:uppercase">${k.label}</div>
        <div style="font-size:17px;font-weight:700;color:${k.alert?ORNG:'var(--text)'}">${k.val}</div>
        <div style="font-family:var(--mono);font-size:11.5px;margin-top:4px;line-height:1.5">${k.l1}${k.l1&&k.l2?'<br>':''}${k.l2}</div>
      </div>`).join('')}
    </div>
  </div>
  ${bw.length ? `<div class="brief-section"><div class="brief-section-title">Better or worse · 2 weeks <span style="text-transform:none;letter-spacing:0;color:var(--muted)">(${span})</span></div>
    <div style="background:var(--s2);border:1px solid var(--border);border-radius:8px;padding:6px 8px;overflow-x:auto"><table class="brief-bw"><thead><tr><th>Measure</th><th>Two weeks ago</th><th>Last week</th><th>Change</th><th></th></tr></thead><tbody>${bw.map(bwRow).join('')}</tbody></table></div></div>` : ''}
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">
    <div class="brief-col">
      <div class="brief-section-title">Concerns & watches</div>
      <div class="brief-panel" style="background:var(--s2);border:1px solid var(--border);padding:4px 14px">
        ${groups.length ? groups.map(c=>`<div class="brief-item">
          <span style="flex-shrink:0;font-size:12px;color:${lvlCol(c.lvl)}">${glyph(c.lvl)}</span>
          <div><div style="font-size:11px;color:${lvlCol(c.lvl)};text-transform:uppercase;letter-spacing:.08em;margin-bottom:2px">${c.area}</div>
          ${c.texts.map(t => `<div style="color:var(--text);line-height:1.55;margin-top:2px">${t}</div>`).join('')}</div></div>`).join('') : `<div class="brief-item" style="color:${GOOD_}">✓ Nothing to worry about on this entry.</div>`}
      </div>
    </div>
    <div class="brief-col">
      <div class="brief-section-title">What's going well</div>
      <div class="brief-panel" style="background:var(--s2);border:1px solid var(--border);padding:4px 14px">
        ${positives.length ? positives.map(p=>`<div class="brief-item"><span style="flex-shrink:0;color:${GOOD_}">✓</span><div style="color:var(--text);line-height:1.55">${p}</div></div>`).join('') : `<div class="brief-item" style="color:var(--muted2)">Nothing standing out on this entry.</div>`}
      </div>
    </div>
  </div>
  ${actions.length ? `<div class="brief-section"><div class="brief-section-title">Suggested actions</div>
    <div style="background:rgba(255,140,66,.07);border:1px solid rgba(255,140,66,.28);border-radius:8px;padding:2px 14px">
      ${actions.map((a,i)=>`<div class="brief-item"><span style="font-family:var(--mono);font-size:12px;font-weight:700;color:${ORNG};flex-shrink:0">${i+1}.</span><div style="font-family:var(--mono);font-size:12px;color:var(--text);line-height:1.55">${a}</div></div>`).join('')}
    </div></div>` : ''}
  <div style="display:grid;grid-template-columns:repeat(${compPulse?3:2},1fr);gap:16px;margin-bottom:20px">
    <div class="brief-col"><div class="brief-section-title">Repricer</div>
      <div class="brief-panel" style="background:var(--s2);border:1px solid var(--border)">
        <div style="font-size:13px;font-weight:700;color:${winNow==null?'var(--muted2)':winNow>=BB_TARGET?GOOD_:winNow<5?BAD_:WARN};margin-bottom:8px">Win BB ${winNow!=null?winNow.toFixed(1)+'%':'—'} · Match BB ${matchNow!=null?matchNow.toFixed(1)+'%':'—'}</div>${repricerPulse}</div></div>
    <div class="brief-col"><div class="brief-section-title">Stock health</div>
      <div class="brief-panel" style="background:var(--s2);border:1px solid var(--border)">
        <div style="font-size:13px;font-weight:700;color:${stockCol};margin-bottom:8px">${stockHead}</div>${stockPulse}</div></div>
    ${compPulse?`<div class="brief-col"><div class="brief-section-title">Competitors</div>
      <div class="brief-panel" style="background:var(--s2);border:1px solid var(--border)">
        <div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:8px">${compHead}</div>${compPulse}</div></div>`:''}
  </div>
  ${provHtml}
  <div class="brief-section">
    <div class="brief-section-title">Last ${Math.min(6, idx + 1)} entries</div>
    <div style="overflow-x:auto">
      <table class="brief-bw">
        <thead><tr>${['Date','SKUs','ASINs','Units','Stock value','Avg cost','Win BB','Match BB','Under 90 days','£ past 180'].map(h=>`<th>${h}</th>`).join('')}</tr></thead>
        <tbody>${ALL.slice(Math.max(0, idx - 5), idx + 1).reverse().map(s => {
          const sel = s.date === selectedDate, sW = repPct(s,'win'), sM = repPct(s,'match');
          const sh = shBucketTotal(s) ? shShare90(s, shHasValuation(s) ? 'gbp' : 'sku') : null, p180 = shHasValuation(s) ? shZoneValues(s).action : null;
          const bbc = v => v == null ? 'var(--muted)' : v >= BB_TARGET ? GOOD_ : v < 5 ? BAD_ : WARN;
          return `<tr style="background:${sel?'rgba(0,245,160,.05)':'transparent'}">
            <td style="color:${sel?'var(--g)':'var(--muted2)'};${sel?'font-weight:700':''}">${fmt(s.date)}${sel?' ◂':''}</td>
            <td>${(s.skus||0).toLocaleString()}</td><td>${(s.asins||0).toLocaleString()}</td><td>${(s.totalUnits||0).toLocaleString()}</td>
            <td>${fmtGBP(s.stockValue||0)}</td><td>£${(s.avgCost||0).toFixed(2)}</td>
            <td style="color:${bbc(sW)}">${sW!=null?sW.toFixed(1)+'%':'—'}</td><td style="color:${bbc(sM)}">${sM!=null?sM.toFixed(1)+'%':'—'}</td>
            <td style="color:${sh==null?'var(--muted)':shZoneColor(sh)}">${sh!=null?sh.toFixed(1)+'%':'—'}</td>
            <td style="color:${p180?ORNG:'var(--muted2)'}">${p180!=null?fmtGBP(p180):'—'}</td></tr>`; }).join('')}</tbody>
      </table>
    </div>
  </div>`;
}

// Helper to calculate aged risk
function calcAgedRisk(snap) {
  if (!snap || !snap.ageing) return 0;
  const ag = snap.ageing;
  const totalUnits = (ag.a0||0)+(ag.a31||0)+(ag.a61||0)+(ag.a91||0)+(ag.a181||0)+(ag.a271||0)+(ag.a365||0);
  const agedUnits = (ag.a181||0)+(ag.a271||0)+(ag.a365||0);
  return totalUnits > 0 ? ((agedUnits/totalUnits)*100).toFixed(1) : 0;
}

const BB_TARGET = 10;   // one Buy Box target everywhere (tiles, Repricer page, popups, Brief)
function renderKpis(snaps) {
  if (!snaps.length) { 
    ['kAsins','kSkus','kCost','kUnits','kStockValue','kRepWinPct','kRepMatchPct','kAgedRisk','kInbound','kCompAvg'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = '—';
    });
    // the ninth tile also carries a pill, an insight line and a better/worse border
    ['kInboundPill','kInboundInsight'].forEach(id => { const el=document.getElementById(id); if (el) el.innerHTML=''; });
    const inbTile = document.getElementById('kInbound')?.closest('.kpi-tile');
    if (inbTile) inbTile.classList.remove('better','worse','same');
    return; 
  }
  const latest = snaps[snaps.length-1];
  const prev = snaps.length > 1 ? snaps[snaps.length-2] : null;
  
  const avgUnits = snaps.reduce((sum,s)=>sum+(s.totalUnits||0),0) / snaps.length;
  const avgAsins = snaps.reduce((sum,s)=>sum+(s.asins||0),0) / snaps.length;
  const avgSkus = snaps.reduce((sum,s)=>sum+(s.skus||0),0) / snaps.length;
  const avgCost = snaps.reduce((sum,s)=>sum+(s.avgCost||0),0) / snaps.length;
  const avgStockValue = snaps.reduce((sum,s)=>sum+(s.stockValue||0),0) / snaps.length;
  
  // Repricer metrics — one definition everywhere (repPct: winning ÷ total)
  const repWinPct = repPct(latest,'win') != null ? repPct(latest,'win').toFixed(1) : 0;
  const repMatchPct = repPct(latest,'match') != null ? repPct(latest,'match').toFixed(1) : 0;
  const prevRepWinPct = repPct(prev,'win') != null ? repPct(prev,'win').toFixed(1) : null;
  const prevRepMatchPct = repPct(prev,'match') != null ? repPct(prev,'match').toFixed(1) : null;
  const avgRepWinPct = snaps.filter(s => s.repricer?.winPct).length > 0 
    ? (snaps.filter(s => s.repricer?.winPct).reduce((sum,s)=>sum+parseFloat(s.repricer.winPct),0) / snaps.filter(s => s.repricer?.winPct).length).toFixed(1) 
    : 0;
  const avgRepMatchPct = snaps.filter(s => s.repricer?.matchPct).length > 0 
    ? (snaps.filter(s => s.repricer?.matchPct).reduce((sum,s)=>sum+parseFloat(s.repricer.matchPct),0) / snaps.filter(s => s.repricer?.matchPct).length).toFixed(1) 
    : 0;
  
  // Aged risk (181+ days)
  const ag = latest.ageing || {};
  const totalUnits = (ag.a0||0)+(ag.a31||0)+(ag.a61||0)+(ag.a91||0)+(ag.a181||0)+(ag.a271||0)+(ag.a365||0);
  const agedUnits = (ag.a181||0)+(ag.a271||0)+(ag.a365||0);
  const agedRiskPct = totalUnits > 0 ? ((agedUnits / totalUnits) * 100).toFixed(1) : 0;
  const unitsDiff = (latest.totalUnits||0) - (prev?.totalUnits||0);
  const stockValDiff = (latest.stockValue||0) - (prev?.stockValue||0);
  const skuDiff = (latest.skus||0) - (prev?.skus||0);
  const winDiff = parseFloat(repWinPct) - (prev?.repricer?.winPct ? parseFloat(prev.repricer.winPct) : 0);
  const matchDiff = parseFloat(repMatchPct) - (prev?.repricer?.matchPct ? parseFloat(prev.repricer.matchPct) : 0);
  const prevAg = prev?.ageing || {};
  const prevTotalUnits = (prevAg.a0||0)+(prevAg.a31||0)+(prevAg.a61||0)+(prevAg.a91||0)+(prevAg.a181||0)+(prevAg.a271||0)+(prevAg.a365||0);
  const prevAgedUnits = (prevAg.a181||0)+(prevAg.a271||0)+(prevAg.a365||0);
  const prevAgedRiskPct = prevTotalUnits > 0 ? ((prevAgedUnits / prevTotalUnits) * 100).toFixed(1) : null;
  const avgAgedRiskPct = snaps.filter(s => {
    const a = s.ageing||{}; 
    const tot = (a.a0||0)+(a.a31||0)+(a.a61||0)+(a.a91||0)+(a.a181||0)+(a.a271||0)+(a.a365||0);
    return tot > 0;
  }).reduce((sum,s) => {
    const a = s.ageing||{};
    const tot = (a.a0||0)+(a.a31||0)+(a.a61||0)+(a.a91||0)+(a.a181||0)+(a.a271||0)+(a.a365||0);
    const aged = (a.a181||0)+(a.a271||0)+(a.a365||0);
    return sum + (tot > 0 ? (aged/tot)*100 : 0);
  }, 0) / snaps.filter(s => {
    const a = s.ageing||{}; 
    const tot = (a.a0||0)+(a.a31||0)+(a.a61||0)+(a.a91||0)+(a.a181||0)+(a.a271||0)+(a.a365||0);
    return tot > 0;
  }).length;
  
  setKpi('kAsins','kAsinsPill','_', latest.asins, prev?.asins, '', true, avgAsins);
  setKpi('kSkus','kSkusPill','_', latest.skus, prev?.skus, '', true, avgSkus);
  setKpi('kCost','kCostPill','_', latest.avgCost, prev?.avgCost, '£', null, avgCost);   // neutral: no right direction
  setKpi('kUnits','kUnitsPill','_', latest.totalUnits, prev?.totalUnits, '', true, avgUnits);
  setKpi('kStockValue','kStockValuePill','_', latest.stockValue, prev?.stockValue, '£', true, avgStockValue);
  setKpiInbound(latest, prev);
  setKpiCompAvg();
  setKpiPercent('kRepWinPct','kRepWinPctPill','_', repWinPct, prevRepWinPct, true, avgRepWinPct);
  setKpiPercent('kRepMatchPct','kRepMatchPctPill','_', repMatchPct, prevRepMatchPct, true, avgRepMatchPct);

  // SKU counts winning / matching buy box (from snapshot)
  (function(){
    const repTot = latest.repricer?.total || 0;
    const winN = latest.repricer?.winning;
    const matchN = latest.repricer?.matching;
    const prevWinN = prev?.repricer?.winning;
    const prevMatchN = prev?.repricer?.matching;
    const fmtDelta = (curr, prv) => {
      if (prv === null || prv === undefined || curr === null || curr === undefined) return '';
      const d = curr - prv;
      if (d === 0) return ' <span style="color:var(--muted)">±0</span>';
      const col = d > 0 ? '#22c55e' : '#dc2626';
      return ` <span style="color:${col}">${d>0?'+':''}${d}</span>`;
    };
    const winEl = document.getElementById('kRepWinSkus');
    const matchEl = document.getElementById('kRepMatchSkus');
    if (winEl) winEl.innerHTML = (winN !== undefined && winN !== null)
      ? `${winN} SKUs${fmtDelta(winN, prevWinN)}` : '';
    if (matchEl) matchEl.innerHTML = (matchN !== undefined && matchN !== null)
      ? `${matchN} SKUs${fmtDelta(matchN, prevMatchN)}` : '';
  })();

  // setTileColor — must be defined before any calls below
  const setTileColor = (tileId, curr, prevVal) => {
    const el = document.getElementById(tileId);
    const tile = el?.closest('.kpi-tile') || document.querySelector(`.kpi-tile [id="${tileId}"]`)?.closest('.kpi-tile');
    if (!tile || prevVal === null || prevVal === undefined) return;
    const improved = curr > prevVal;
    const declined = curr < prevVal;
    tile.classList.remove('better', 'worse', 'same');
    if (improved) tile.classList.add('better');
    else if (declined) tile.classList.add('worse');
    else tile.classList.add('same');
  };

  // Stock Health KPI — show 0-90d flow % (target 80%+), not 181d+ risk
  const ag0 = latest.ageing||{};
  const agTotal = AG_BUCKETS.reduce((s,b)=>s+(ag0[b.key]||0),0)||1;
  // £ first (money you can't reinvest); SKUs where an entry has no £ values
  const fresh90pctKpi = shShare90(latest, shHasValuation(latest) ? 'gbp' : 'sku');
  let prevFresh90pctKpi = null;
  if(prev){
    const prevAg0 = prev.ageing||{};
    const prevAgTotal = AG_BUCKETS.reduce((s,b)=>s+(prevAg0[b.key]||0),0)||1;
    prevFresh90pctKpi = shShare90(prev, shHasValuation(prev) && shHasValuation(latest) ? 'gbp' : 'sku');
  }
  setKpiPercent('kAgedRisk','kAgedRiskPill','_', fresh90pctKpi, prevFresh90pctKpi, true, 0);

  // Apply colours — up = better for all KPIs
  setTileColor('kSkus', latest.skus, prev?.skus);
  setTileColor('kAsins', latest.asins, prev?.asins);
  // Deliberately uncoloured. The popup itself says avg cost "doesn't have a simple higher
  // is better or lower is better rule" — painting a fall red contradicted that every render.
  const costTile = document.getElementById('kCost')?.closest('.kpi-tile');
  if (costTile) costTile.classList.remove('better','worse','same');
  setTileColor('kStockValue', latest.stockValue, prev?.stockValue);
  setTileColor('kUnits', latest.totalUnits, prev?.totalUnits);
  const inbTileEl = document.getElementById('kInbound')?.closest('.kpi-tile');
  if (latest.inboundUnits == null || prev?.inboundUnits == null) {
    // No comparison is possible — drop any border left over from a previous render rather
    // than leaving a green/red ring that refers to data no longer on screen.
    if (inbTileEl) inbTileEl.classList.remove('better','worse','same');
  } else {
    setTileColor('kInbound', latest.inboundUnits, prev.inboundUnits);
  }
  // Win/Match BB — dual signal: background tint = target status, border = direction
  const setDualTileColor = (tileId, curr, prevVal, target) => {
    const el = document.getElementById(tileId);
    const tile = el?.closest('.kpi-tile');
    if (!tile) return;
    // Tint = target status
    tile.classList.remove('tint-green','tint-red');
    tile.classList.add(curr >= target ? 'tint-green' : 'tint-red');
    // Border = direction
    tile.classList.remove('better','worse','same');
    if (prevVal===null||prevVal===undefined) return;
    if (curr > prevVal) tile.classList.add('better');
    else if (curr < prevVal) tile.classList.add('worse');
    else tile.classList.add('same');
  };

  const prevWinForTile = prev ? repPct(prev,'win') : null;
  const prevMatchForTile = prev ? repPct(prev,'match') : null;
  // a snapshot saved without repricer figures must not paint the tiles red
  if (latest.repricer?.total > 0 || repPct(latest,'win') != null) {
    setDualTileColor('kRepWinPct', parseFloat(repWinPct), prevWinForTile, BB_TARGET);
    setDualTileColor('kRepMatchPct', parseFloat(repMatchPct), prevMatchForTile, BB_TARGET);
  }
  setDualTileColor('kAgedRisk', fresh90pctKpi, prevFresh90pctKpi, SH_GOAL);
  shOverviewTile();   // pill + border = the same 2-week verdict as the Stock Health page
  ovTrendTiles();     // every other tile: pill + border from the 2-week average, not one entry
  
  // Update popouts with rich click popup content
  updatePopouts(filteredSnaps());
  updateKpiMiniInsights(filteredSnaps());
  
  
  // Update bottom bar chart
  const winRate = latest.repricer?.winPct ? parseFloat(latest.repricer.winPct) : 0;
  const matchRate = latest.repricer?.matchPct ? parseFloat(latest.repricer.matchPct) : 0;
  const stockHealth = 100 - parseFloat(agedRiskPct); // Inverse: lower aged = healthier
  
  const barWin = document.getElementById('barWin');
  const barMatch = document.getElementById('barMatch');
  const barStock = document.getElementById('barStock');
  const barWinText = document.getElementById('barWinText');
  const barMatchText = document.getElementById('barMatchText');
  const barStockText = document.getElementById('barStockText');
  
  if (barWin) barWin.style.width = Math.min(winRate * 5, 100) + '%';
  if (barMatch) barMatch.style.width = Math.min(matchRate * 5, 100) + '%';
  if (barStock) barStock.style.width = Math.min(stockHealth * 1, 100) + '%';
  
  if (barWinText) barWinText.textContent = winRate.toFixed(1) + '%';
  if (barMatchText) barMatchText.textContent = matchRate.toFixed(1) + '%';
  if (barStockText) barStockText.textContent = stockHealth.toFixed(0) + '%';
}

function initPopouts() { /* replaced by modal system */ }

function closeKpiModal() {
  const m = document.getElementById('kpiModal');
  if (m) m.style.display = 'none';
  if (chartInstances._kpiModalChart) { chartInstances._kpiModalChart.destroy(); delete chartInstances._kpiModalChart; }
}
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  closeKpiModal();
  const zm=document.getElementById('shZoneModal'); if(zm) zm.style.display='none';
  // A fetch in flight must be cancelled, not just hidden, or it keeps spending tokens.
  const km=document.getElementById('keepaModal');
  if (km && km.classList.contains('open')) { if (typeof cancelKeepaFetch==='function') cancelKeepaFetch(); return; }
  ['compDetailModal','bulkUpdateModal','manageModal','snapModal','impModal','providerDetailModal'].forEach(id=>{
    const el=document.getElementById(id);
    if (el && el.classList.contains('open') && el.dataset.noDismiss !== 'true') el.classList.remove('open');
  });
});

// Round an axis to whole steps (1, 2, 5 × 10ⁿ). Charts were given their raw data range and printed
// ticks like "3,557.8" that the left edge then cut off.
function niceAxis(min, max){
  if (!(isFinite(min) && isFinite(max))) return { min, max, step: undefined };
  if (max === min) { max = min + 1; }
  const rough = (max - min) / 5, mag = Math.pow(10, Math.floor(Math.log10(rough))), n = rough / mag;
  const step = (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  return { min: min >= 0 ? Math.max(0, lo) : lo, max: hi, step };
}
