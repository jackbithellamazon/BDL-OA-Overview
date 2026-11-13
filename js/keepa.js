// ══ KEEPA FETCH ═════════════════════════════════════════════════════════════
// Two clicks by design: this fills the boxes, you press Save All. Nothing reaches the
// database without you looking at it.
//
// Two sources, in priority order:
//   1. Keepa's own `competitors` figure — the number that used to be read off the seller
//      page by hand. One batched request for all sellers, ~1 token each.
//   2. For sellers Keepa does not rank against Lavarion, the overlap is computed from the
//      two storefront ASIN lists (10 tokens each). Only your ASINs verified within
//      KEEPA_FRESH_DAYS are counted — Keepa's list carries listings you no longer stock,
//      and counting those inflated every calculated figure by roughly 2pp.
const KEEPA_ME = 'A142PBK7GX1DM8';   // Lavarion
const KEEPA_DOMAIN = 2;              // amazon.co.uk
const KEEPA_FRESH_DAYS = 4;          // measured: closest match to Keepa's own numbers
let KEEPA_WANT_DETAIL = true;        // always on: full shelves for everyone, which is what finds new leads
const KEEPA_PROXY = 'https://keepa.jackbithellbusiness.workers.dev';   // holds the Keepa key as a secret
let KEEPA_RUNNING = false;           // blocks a second run from doubling the token spend
let KEEPA_CANCELLED = false;         // set by Cancel; checked after every await
// Keepa error text and seller names are third-party strings going into innerHTML.
const kfEsc = t => String(t == null ? '' : t)
  .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const keepaToMs = m => (m + 21564000) * 60000;

// Closing the window used to leave the fetch running: it kept spending tokens and then
// re-opened the review modal on its own, wiping anything typed in the meantime.
function cancelKeepaFetch(){
  if(KEEPA_RUNNING){ KEEPA_CANCELLED = true; kfLog('Cancelling…','warn'); }
  closeOverlay('keepaModal');
}

function openKeepaFetch(){
  if(!SELLERS.length){ alert('No competitors set up yet — add them in ⚙ Manage competitors first.'); return; }
  if(KEEPA_RUNNING){ document.getElementById('keepaModal').classList.add('open'); return; }
  const log=document.getElementById('keepaFetchLog'); log.style.display='none'; log.innerHTML='';
  const pw=document.getElementById('keepaProgWrap'); if(pw) pw.style.display='none';
  document.getElementById('keepaRunBtn').disabled=false;
  document.getElementById('keepaRunBtn').textContent='Fetch & save';
  // Always the full pull now: every rival's whole shelf is what finds their new leads.
  KEEPA_WANT_DETAIL = true;
  document.getElementById('keepaCost').textContent =
    `${SELLERS.length} competitors · about ${SELLERS.length + 10 + SELLERS.length*10} tokens · pulls every rival's full shelf.`;
  document.getElementById('keepaModal').classList.add('open');
}

// The run takes a few seconds pulling one storefront at a time. Without this it looks frozen.
function kfProgress(done, total, label){
  const wrap=document.getElementById('keepaProgWrap');
  if(!wrap) return;
  wrap.style.display='';
  const pct = total ? Math.round((done/total)*100) : 0;
  document.getElementById('keepaProgBar').style.width = pct + '%';
  document.getElementById('keepaProgCount').textContent = total ? `${done} of ${total}` : '';
  document.getElementById('keepaProgLabel').textContent = label || '';
}

function kfLog(msg,cls){
  const el=document.getElementById('keepaFetchLog'); if(!el) return;
  el.style.display='';
  el.innerHTML += `${el.innerHTML?'\n':''}<span style="color:${cls==='ok'?'var(--g)':cls==='bad'?'var(--r)':cls==='warn'?'var(--y)':'var(--muted2)'}">${kfEsc(msg)}</span>`;
  el.scrollTop=el.scrollHeight;
}

async function keepaCall(params){
  const res = await fetch(`${KEEPA_PROXY}/keepa/seller?${params}`, { headers:{ 'x-bdl-app':'oa' }, cache:'no-store' });
  let j; try{ j=await res.json(); }catch(e){ throw new Error(`HTTP ${res.status} — response was not JSON`); }
  if(!res.ok || j.error) throw new Error(j.error ? (j.error.message||JSON.stringify(j.error)) : `HTTP ${res.status}`);
  return j;
}

// Writes a completed fetch straight to the readings tables. Deliberately mirrors the manual
// path — same session handling, same persist(), same ASIN write — so there is only ever one
// way readings reach the database, and it rolls the whole thing back if the save fails.
async function applyKeepaFetch(fetched){
  const today = new Date().toLocaleDateString('en-CA');
  const prevSessions = COMPETITOR_SESSIONS.map(x => ({...x, competitors:(x.competitors||[]).slice()}));

  const existing = COMPETITOR_SESSIONS.find(x => x.date === today);
  const before = {};
  (existing?.competitors||[]).forEach(c => { if(c.sellerId) before[c.sellerId] = c.pct; });

  const competitors = [];
  let changed=0, added=0, same=0;
  SELLERS.forEach(sel => {
    if(!sel.sellerId) return;
    const f = fetched[sel.sellerId];
    if(!f || f.pct == null){
      // Keepa had nothing for this seller — keep whatever was already recorded today rather
      // than dropping it.
      if(before[sel.sellerId] != null) competitors.push({name:sel.name, sellerId:sel.sellerId, pct:before[sel.sellerId], isMe:false});
      return;
    }
    const prev = before[sel.sellerId];
    if(prev == null) added++; else if(+prev !== +f.pct) changed++; else same++;
    competitors.push({name:sel.name, sellerId:sel.sellerId, pct:f.pct, isMe:false});
  });
  if(!competitors.length) return {ok:false, error:'nothing to save'};

  let session = existing;
  if(!session){
    session = { date: today, competitors: [], createdAt: new Date().toISOString() };
    COMPETITOR_SESSIONS.push(session);
    COMPETITOR_SESSIONS.sort((a,b)=>a.date.localeCompare(b.date));
  }
  session.competitors = competitors;
  session.updatedAt = new Date().toISOString();

  // One press writes straight to the database, so there is no human eye between Keepa and
  // your history any more. This is the replacement for that eye: if a run looks nothing like
  // the last one, stop and ask rather than overwriting good readings with a bad fetch.
  // A shrinking fetch is the failure that actually happened: on 28/08 the storefront step
  // produced nothing, so the 11 sellers Keepa cannot rank came back null, were skipped on
  // save, and 39 quietly became 28. Nothing on screen said so. Count first, values second.
  {
    const wasTracked = Object.keys(before).length;
    const nowSaving  = competitors.length;
    const dropped    = wasTracked - nowSaving;
    if (wasTracked >= 5 && dropped >= Math.max(3, wasTracked * 0.1)) {
      const lostNames = Object.keys(before)
        .filter(id => !competitors.some(c => c.sellerId === id))
        .map(id => (SELLERS.find(x => x.sellerId === id) || {}).name || id);
      const goOn = confirm(
        `\u26A0 This fetch covered fewer competitors than last time.\n\n` +
        `Last reading: ${wasTracked}. This one: ${nowSaving}. ${dropped} missing:\n` +
        lostNames.slice(0, 12).join(', ') + (lostNames.length > 12 ? `, +${lostNames.length - 12} more` : '') +
        `\n\nKeepa could not rank these against you, and the storefront step that normally ` +
        `works them out did not return anything. Saving now leaves them with a gap for today.\n\n` +
        `OK = save the ${nowSaving} anyway.\nCancel = discard and try the fetch again.`
      );
      if (!goOn) { COMPETITOR_SESSIONS = prevSessions; return {ok:false, error:`discarded — ${dropped} competitors missing from the fetch`}; }
    }
  }

  if (Object.keys(before).length >= 5) {
    const comparable = competitors.filter(c => before[c.sellerId] != null);
    const wild = comparable.filter(c => Math.abs(c.pct - before[c.sellerId]) >= 20).length;
    const zeroed = comparable.filter(c => +c.pct === 0 && +before[c.sellerId] > 0).length;
    if (comparable.length >= 5 && (wild > comparable.length/2 || zeroed > comparable.length/2)) {
      const goOn = confirm(
        `\u26A0 This fetch looks wrong.\n\n` +
        (wild > comparable.length/2
          ? `${wild} of ${comparable.length} sellers moved by 20pp or more.`
          : `${zeroed} of ${comparable.length} sellers came back as 0%.`) +
        `\n\nThat usually means Keepa returned bad data, not that your market changed overnight.\n\n` +
        `OK = save it anyway.\nCancel = discard this fetch and keep what you already had.`
      );
      if (!goOn) { COMPETITOR_SESSIONS = prevSessions; return {ok:false, error:'discarded — the fetch looked wrong'}; }
    }
  }

  const ok = await persist();
  if(!ok){
    COMPETITOR_SESSIONS = prevSessions;   // put memory back exactly as it was
    return {ok:false, error:(LAST_SAVE_ERRORS[0]||'the save did not complete')};
  }

  const asinRows = window.__keepaAsinRows;
  if(asinRows && asinRows.length){
    const aok = await window._supabaseSaveCompetitorAsins(today, asinRows);
    if(aok){
      COMPETITOR_ASINS[today] = COMPETITOR_ASINS[today] || {};
      asinRows.forEach(r => { COMPETITOR_ASINS[today][r.sellerId] = {size:r.size, asins:r.asins}; });
    }
    window.__keepaAsinRows = null;
  }

  // Rival shelves last, and never allowed to fail the fetch — the readings are already safe.
  const shelf = window.__keepaShelf; window.__keepaShelf = null;
  if (shelf && shelf.length && window._shelfApply) {
    const sr = await window._shelfApply(today, shelf);
    if (sr.ok) {
      const firstTime = sr.baselined && !sr.added;
      kfLog(firstTime
        ? `Rival shelves: first look at ${sr.rivals} — ${sr.baselined.toLocaleString()} products recorded. New leads start from the next fetch.`
        : `Rival shelves: ${sr.added} new lines added by rivals · ${sr.gone} gone${sr.back ? ` · ${sr.back} back` : ''}`, 'ok');
      if (sr.skipped.length) kfLog(`${sr.skipped.length} shelf${sr.skipped.length!==1?'s':''} came back short and ${sr.skipped.length!==1?'were':'was'} left as it was.`, 'warn');
      if (sr.newAsins && sr.newAsins.length && window._detailsForNew) {
        kfLog(`Loading product details for ${[...new Set(sr.newAsins)].length} new rival lines…`);
        const dr = await window._detailsForNew(sr.newAsins);
        if (dr.ok) kfLog(`Product details: fetched ${dr.fetched} (${dr.tokens} tokens) · already had ${dr.known} · skipped for tokens ${dr.skipped}`, dr.skipped ? 'warn' : 'ok');
        else kfLog(`Product details not saved: ${dr.error}. Everything else is saved — the Sourcing app loads them itself when you open a rival.`, 'warn');
      }
    } else {
      kfLog(`Rival shelves not saved: ${sr.error}. Your readings are saved.`, 'warn');
    }
  }

  const mine = window.__keepaMine; window.__keepaMine = null;
  if (mine && mine.length && window._myShelfApply) {
    const mr = await window._myShelfApply(today, mine);
    if (mr.ok && mr.skipped) kfLog(`Your storefront: Keepa sent ${mr.now} products against ${mr.was} last time — left as it was.`, 'warn');
    else if (mr.ok) kfLog(mr.firstTime || mr.baseline
        ? `Your storefront: on ${mr.onNow ? mr.onNow.toLocaleString() : mr.listed.toLocaleString()} products now — saved. New and left start from the next fetch.`
        : `Your storefront: on ${mr.onNow.toLocaleString()} products now · ▲ ${mr.added} on · ▼ ${mr.left} off`, 'ok');
    else kfLog(`Your storefront not saved: ${mr.error}. Your readings are saved.`, 'warn');
  }

  try{
    const data = await window._supabaseLoad();
    if(data){
      COMPETITOR_SESSIONS = data.competitorSessions || COMPETITOR_SESSIONS;
      COMPETITOR_ASINS   = data.competitorAsins   || COMPETITOR_ASINS;
    }
  }catch(e){ console.error('reload after Keepa save failed', e); }
  await loadShelfLeads(true);

  renderCompTab(); renderCompHistory(); renderCompInsights(filteredSnaps());
  setKpiCompAvg(); renderBadges();
  return {ok:true, saved:competitors.length, changed, added, same};
}

// The 2am fetch (the keepa Worker, Mon/Wed/Fri) saves straight to the database. A page left open
// since before it ran doesn't have those readings, so "Enter manually" would save over them with
// what's on this stale page. Check first; if the database has a newer fetch, reload and stop.
async function compFreshen(){
  if(!window._compLatestDate) return false;
  const d = await window._compLatestDate();
  if(!d || COMPETITOR_SESSIONS.some(s => s.date === d)) return false;
  alert(`Newer competitor readings are saved (${fmt(d)}, probably the 2am fetch) that this page hasn't loaded yet.\n\nThe page will reload now so nothing gets overwritten. Then press the button again.`);
  location.reload();
  return true;
}

async function runKeepaFetch(){
  if(KEEPA_RUNNING) return;            // a second run would bill the whole thing again
  if(await compFreshen()) return;       // the 2am fetch ran since this page was opened
  KEEPA_RUNNING = true; KEEPA_CANCELLED = false;
  window.__keepaMine = null;           // never save a list left over from an earlier run
  let handedOff = false;
  const btn=document.getElementById('keepaRunBtn');
  btn.disabled=true; btn.textContent='Fetching…';
  document.getElementById('keepaFetchLog').innerHTML='';

  const fetched = {};        // sellerId -> { pct, source }
  let tokens = 0;
  try{
    // 1 ── Keepa's own overlap figures, all sellers in one request
    const ids = SELLERS.map(s=>s.sellerId).filter(Boolean);
    kfProgress(0, ids.length + 1, 'Asking Keepa for the overlap figures…');
    kfLog(`Requesting ${ids.length} sellers in one call…`);
    const batch = await keepaCall(`seller=${ids.map(encodeURIComponent).join(',')}`);
    tokens += batch.tokensConsumed||0;
    const map = batch.sellers||{};
    const gaps = [];
    SELLERS.forEach(s=>{
      if(!s.sellerId) return;
      const rec = map[s.sellerId];
      if(!rec){ fetched[s.sellerId]={pct:null,source:'none',note:'not in Keepa'}; return; }
      const m = (rec.competitors||[]).find(c=>c.sellerId===KEEPA_ME);
      const p = m ? Number(m.percent) : NaN;
      // A non-numeric percent used to sail through as NaN, render a blank box, and a blank
      // box means "skip" on save — quietly deleting that seller's reading for the day.
      if(Number.isFinite(p)) fetched[s.sellerId]={pct:p, source:'keepa'};
      else gaps.push(s);
    });
    kfLog(`${Object.keys(fetched).filter(k=>fetched[k].source==='keepa').length} returned a percentage. ${gaps.length} not ranked against Lavarion.`, 'ok');

    if(KEEPA_CANCELLED){ kfLog('Cancelled — nothing applied.','warn'); return; }

    // 2 ── ASIN detail. Needed for the gap sellers to get a percentage at all, and wanted for
    // everyone else so the shared-product lists are complete. Wrapped separately so a failure
    // here keeps the step 1 figures, which have already been paid for.
    const needAsins = KEEPA_WANT_DETAIL ? SELLERS.filter(x=>x.sellerId) : gaps;
    try{
    if(needAsins.length){
      kfLog(`Pulling storefronts to calculate the remaining ${gaps.length}…`);
      kfProgress(1, needAsins.length + 2, 'Reading your own catalogue…');
      const mine = await keepaCall(`seller=${KEEPA_ME}&storefront=1`);
      tokens += mine.tokensConsumed||0;
      const meRec=(mine.sellers||{})[KEEPA_ME];
      const list=meRec?.asinList||[], seen=meRec?.asinListLastSeen||[];
      // Your own storefront, with Keepa's last-seen date per product. Saved after the readings.
      window.__keepaMine = list.map((a,i) => ({ asin:a,
        seen: seen[i]!=null ? new Date(keepaToMs(seen[i])).toISOString().slice(0,10) : null }));
      const cut = Date.now() - KEEPA_FRESH_DAYS*86400000;
      const fresh = new Set();
      list.forEach((a,i)=>{ if(seen[i]!=null && keepaToMs(seen[i])>=cut) fresh.add(a); });
      kfLog(`Your catalogue: ${list.length} listings, ${fresh.size} verified in the last ${KEEPA_FRESH_DAYS} days.`,'ok');

      // The 4-day filter is an accuracy tweak, not a requirement. It used to be treated as one:
      // if Keepa had not re-verified anything recently, `fresh` was empty and the whole loop
      // was skipped, so every seller Keepa cannot rank got no reading at all. That is what
      // turned 39 competitors into 28 on 28/08. Fall back to the full list instead — a figure
      // roughly 2pp high is worth far more than a blank.
      let matchSet = fresh, usedStale = false;
      if(!fresh.size && list.length){
        matchSet = new Set(list); usedStale = true;
        kfLog(`Nothing verified in the last ${KEEPA_FRESH_DAYS} days — using all ${list.length} listings instead. Figures may read about 2pp high.`,'warn');
      }

      if(!matchSet.size){
        kfLog('Your storefront came back empty, so the remainder cannot be worked out. Try again in a minute.','bad');
      } else for(let gi=0; gi<needAsins.length; gi++){
        const g = needAsins[gi];
        kfProgress(gi + 2, needAsins.length + 2, `Reading ${g.name}…`);
        if(KEEPA_CANCELLED){ kfLog('Cancelled part-way — stopping.','warn'); break; }
        // One retry each: a dropped request should not cost a seller their reading for the day.
        let theirs = null, lastErr = null;
        for(let attempt=1; attempt<=2 && theirs===null; attempt++){
          try{
            const r = await keepaCall(`seller=${encodeURIComponent(g.sellerId)}&storefront=1`);
            tokens += r.tokensConsumed||0;
            const got = ((r.sellers||{})[g.sellerId]||{}).asinList||[];
            if(got.length) theirs = got;
            else if(attempt===1){ lastErr='no storefront data'; kfLog(`${g.name}: nothing came back, retrying…`,'warn'); }
            else lastErr='no storefront data';
          }catch(e){
            lastErr = e.message;
            if(attempt===1) kfLog(`${g.name}: ${e.message} — retrying…`,'warn');
          }
        }
        if(theirs===null){
          if(!fetched[g.sellerId] || fetched[g.sellerId].pct==null) fetched[g.sellerId]={pct:null,source:'none',note:lastErr||'no storefront'};
          kfLog(`${g.name}: ${lastErr||'no storefront data'}`,'bad'); continue;
        }
        const sharedList=[]; for(const a of theirs) if(matchSet.has(a)) sharedList.push(a);
        const shared=sharedList.length;
        const prior = fetched[g.sellerId];
        if (prior && prior.pct != null && prior.source === 'keepa') {
          // Keepa's own figure stays authoritative; we are only adding the detail here.
          prior.size = theirs.length; prior.asins = sharedList; prior.full = theirs;
          kfLog(`${g.name}: ${shared} shared of ${theirs.length} (Keepa says ${prior.pct}%)`);
        } else {
          fetched[g.sellerId]={pct:+(shared/theirs.length*100).toFixed(1), source: usedStale?'calc~':'calc',
                               size:theirs.length, asins:sharedList, full:theirs};
          kfLog(`${g.name}: ${shared}/${theirs.length} shared = ${fetched[g.sellerId].pct}%${usedStale?' (unverified listings)':''}`);
        }
      }
    }

    }catch(stepTwoErr){
      kfLog(`Could not calculate the remainder: ${stepTwoErr.message}`,'bad');
      kfLog('Keeping the figures Keepa returned in step 1.','warn');
    }

    if(KEEPA_CANCELLED){ kfLog('Cancelled — nothing applied.','warn'); return; }

    const got = Object.values(fetched).filter(f=>f.pct!=null).length;
    if(!got){ kfLog('\nNothing usable came back — nothing applied.','bad'); return; }
    // Say plainly whether everyone got a number, and name anyone who did not — a short
    // fetch used to look identical to a full one once the log scrolled past.
    const withNumber = SELLERS.filter(x => x.sellerId && fetched[x.sellerId] && fetched[x.sellerId].pct != null);
    const noNumber   = SELLERS.filter(x => x.sellerId && (!fetched[x.sellerId] || fetched[x.sellerId].pct == null));
    if (noNumber.length) {
      kfLog(`\n\u26A0 ${noNumber.length} of ${SELLERS.length} got no reading: ${noNumber.map(x=>x.name).join(', ')}`,'bad');
      kfLog(`They will show their previous reading until the next fetch picks them up.`,'warn');
    } else {
      kfLog(`\n\u2713 All ${SELLERS.length} competitors got a reading.`,'ok');
    }
    kfLog(`Fetched ${withNumber.length} of ${SELLERS.length} in ${tokens} tokens. Saving…`,'ok');
    window.__keepaAsinRows = Object.entries(fetched)
      .filter(([,v]) => Array.isArray(v.asins))
      .map(([sellerId,v]) => ({ sellerId, size:v.size, asins:v.asins }));
    // Their whole shelf, not just the overlap — already downloaded, so saving it costs no tokens.
    window.__keepaShelf = Object.entries(fetched)
      .filter(([,v]) => Array.isArray(v.full) && v.full.length)
      .map(([sellerId,v]) => ({ sellerId, asins:v.full }));

    // One press does the whole job. The review modal is still there under "Enter manually"
    // if a number ever needs amending after the fact.
    kfProgress(1, 1, 'Saving to the database…');
    btn.textContent = 'Saving…';
    const res = await applyKeepaFetch(fetched);
    if(!res.ok){
      kfLog(`Save failed: ${res.error}`,'bad');
      kfLog('Nothing was written — your existing readings are untouched.','warn');
      kfProgress(0, 1, 'Save failed');
      return;
    }
    kfProgress(1, 1, `Saved \u2014 ${res.saved} readings recorded`);
    kfLog(`Saved. ${res.changed} changed, ${res.added} new, ${res.same} unchanged.`,'ok');
    handedOff = true;                  // the timer below owns the guard now
    setTimeout(()=>{
      KEEPA_RUNNING = false;
      if(KEEPA_CANCELLED) return;
      closeOverlay('keepaModal');
      showToast(`\u2713 Keepa: ${res.saved} readings saved \u00B7 ${res.changed} changed`);
    }, 1400);
  }catch(e){
    kfLog(`FAILED: ${e.message}`,'bad');
    kfLog('Nothing was applied. Check the key and try again.','warn');
  }finally{
    if(!handedOff) KEEPA_RUNNING = false;
    btn.disabled=false; btn.textContent='Fetch & save';
  }
}

async function openBulkUpdate() {
  if(!window.__keepaFetched && await compFreshen()) return;   // the 2am fetch ran since this page was opened
  const today = new Date().toLocaleDateString('en-CA');
  document.getElementById('bulkDateLabel').textContent = 'Date: ' + fmt(today);
  const wrap = document.getElementById('bulkRows');
  if (!SELLERS.length) {
    wrap.innerHTML = '<div style="font-family:var(--mono);font-size:11px;color:var(--muted2);padding:20px 0;text-align:center">No sellers yet — use ⚙ Manage competitors to add your list first.</div>';
    document.getElementById('bulkUpdateModal').classList.add('open');
    window.__keepaFetched = null;   // do not let a fetch linger and get applied later
    return;
  }
  
  // Check if there's existing data for today
  const todaySession = COMPETITOR_SESSIONS.find(s => s.date === today);
  const todayData = {};
  if (todaySession && todaySession.competitors) {
    todaySession.competitors.forEach(c => {
      // Keyed by ID first — a renamed seller kept its reading under the OLD name,
      // so the box came up blank and the next Save All dropped it.
      if (c.sellerId) todayData['id:' + c.sellerId] = c.pct;
      todayData['nm:' + c.name] = c.pct;
    });
  }
  
  wrap.innerHTML = SELLERS.map((s,i) => {
    // `|| ''` turned a genuine 0 into a blank box. Blank means "skip this seller" on
    // save, so every real 0% reading was silently deleted on the next Save All.
    const byId = s.sellerId ? todayData['id:' + s.sellerId] : undefined;
    const stored = byId != null ? byId : todayData['nm:' + s.name];
    // A Keepa fetch takes priority over whatever is already stored — that is the point of it —
    // but the box stays editable, so anything that looks wrong can be typed over.
    const kf = window.__keepaFetched ? window.__keepaFetched[s.sellerId] : null;
    const existing = (kf && kf.pct != null) ? kf.pct : stored;
    const existingValue = existing == null ? '' : existing;
    const wasVal = (kf && kf.pct != null && stored != null && +stored !== +kf.pct) ? +stored : null;
    const srcTag = !kf ? ''
      : kf.source === 'keepa' ? '<span class="kf-src keepa">KEEPA</span>'
      : kf.source === 'calc'  ? '<span class="kf-src calc">CALCULATED</span>'
      : kf.source === 'calc~' ? '<span class="kf-src calc" title="Worked out against listings Keepa has not re-checked recently — may read about 2pp high">CALCULATED ~</span>'
      : `<span class="kf-src none">${kf.note || 'no data'}</span>`;
    const deltaTag = wasVal === null ? '' :
      `<span style="font-family:var(--mono);font-size:9.5px;color:var(--muted);margin-left:6px">was ${wasVal}%</span>`;
    return `<div style="display:grid;grid-template-columns:1fr 140px;gap:10px;align-items:center;padding:10px 12px;background:var(--s2);border:1px solid var(--border)">
      <div>
        <div style="font-size:13px;font-weight:600">${s.name}${srcTag}${deltaTag}</div>
        <div style="font-family:var(--mono);font-size:10px;color:var(--muted2);margin-top:2px">${s.sellerId||'No ID set'}</div>
      </div>
      <div style="display:flex;align-items:center;gap:6px">
        <input type="number" step="0.1" id="bulk_${i}" placeholder="% e.g. 42.5" value="${existingValue}"
          style="background:var(--s1);border:1px solid var(--border);color:var(--text);font-family:var(--mono);font-size:13px;padding:8px 10px;outline:none;width:100%;transition:border-color .15s"
          onfocus="this.style.borderColor='var(--g)'" onblur="this.style.borderColor='var(--border)'">
        <span style="font-family:var(--mono);font-size:11px;color:var(--muted2)">%</span>
      </div>
    </div>`;
  }).join('');
  document.getElementById('bulkUpdateModal').classList.add('open');

  const kfCount = window.__keepaFetched ? Object.values(window.__keepaFetched).filter(f=>f.pct!=null).length : 0;
  const dl = document.getElementById('bulkDateLabel');
  if (dl && kfCount) dl.innerHTML += ` <span style="color:var(--g);font-family:var(--mono);font-size:10.5px">\u00B7 ${kfCount} filled from Keepa \u2014 review, then Save All</span>`;
  // A fetch is one moment in time. Clear it once used, so opening the modal manually later
  // shows what is actually stored rather than stale fetched numbers.
  window.__keepaFetched = null;
}

async function saveBulkUpdate() {
  const today = new Date().toLocaleDateString('en-CA');
  const competitors = [];
  let saved = 0;
  
  SELLERS.forEach((s,i) => {
    const val = document.getElementById('bulk_'+i)?.value;
    if (val==='' || val===null || val===undefined) return;
    const pct = parseFloat(val);
    if (isNaN(pct)) return;
    competitors.push({name:s.name, sellerId:s.sellerId||'', pct, isMe:false});
    saved++;
  });
  
  if (saved > 0) {
    // Create/update competitor session for today
    let session = COMPETITOR_SESSIONS.find(s => s.date === today);
    if (!session) {
      session = { date: today, competitors: [], createdAt: new Date().toISOString() };
      COMPETITOR_SESSIONS.push(session);
      COMPETITOR_SESSIONS.sort((a,b) => a.date.localeCompare(b.date));
    }
    session.competitors = competitors;
    session.updatedAt = new Date().toISOString();
  }
  
  showSyncStatus('loading');
  // Hold the fetch detail so it can be written with the readings, on the same button press.
  const asinRows = window.__keepaAsinRows || null;
  const bulkOk = await persist();
  if (!bulkOk) {
    // Don't reload — that would replace the readings just typed with the old stored ones
    // and the modal would close as if it had worked.
    showSyncStatus('error');
    alert('⚠ These readings did NOT save.\n\nThey are still on screen — check your internet connection and press Save again. Do not close this window, or they will be lost.');
    return;
  }

  // Reload from Supabase to ensure fresh data
  try {
    const data = await window._supabaseLoad();
    if (data) {
      COMPETITOR_SESSIONS = data.competitorSessions || [];
    }
  } catch (err) {
    console.error('Auto-refresh failed:', err);
  }

  if (asinRows && asinRows.length) {
    const ok = await window._supabaseSaveCompetitorAsins(today, asinRows);
    if (ok) {
      COMPETITOR_ASINS[today] = {};
      asinRows.forEach(r => { COMPETITOR_ASINS[today][r.sellerId] = { size:r.size, asins:r.asins }; });
    }
    window.__keepaAsinRows = null;
  }

  closeOverlay('bulkUpdateModal');
  
  // Render all competitor pages with fresh data
  renderCompTab();
  renderCompHistory();
  renderCompInsights(filteredSnaps());
  setKpiCompAvg();   // the Overview tile reads competitor data, so it goes stale otherwise
  renderBadges();
  showSyncStatus('saved');
  
  if (saved) showToast(`✓ Saved ${saved} overlap reading${saved!==1?'s':''} for ${fmt(today)}`);
}

// ── Manage competitors ──────────────────────────────────────────────────
// Removing a seller only takes them off the fetch list. Their readings live in
// bdl_competitor_readings keyed by session, untouched by anything here, unless the
// row is explicitly marked for a purge — which is a separate, red, spelled-out choice.
let MC_PURGE = new Set();       // seller_ids whose history the user asked to delete
let MC_ORIGINAL = new Map();    // seller_id -> name at open, so renames can follow the history

// Everything we know about a seller's readings, for the status column.
function mcHistory(sellerId){
  if(!sellerId) return {n:0,last:null,lastDate:null};
  let n=0,last=null,lastDate=null;
  [...COMPETITOR_SESSIONS].sort((a,b)=>a.date.localeCompare(b.date)).forEach(ses=>{
    (ses.competitors||[]).forEach(c=>{ if(c.sellerId===sellerId){ n++; last=c.pct; lastDate=ses.date; } });
  });
  return {n,last,lastDate};
}

// Accepts a bare ID, a storefront link, or anything with one buried in it.
const MARKETPLACE_IDS = new Set(['A1F83G8C2ARO7P','ATVPDKIKX0DER','A1PA6795UKMFR9','A13V1IB3VIYZZH',
  'APJ6JRA9NG5V4','A1RKKUPIHCS9HS','A1805IZSGTT6HS','A2NODRKZP88ZB9','A1F83G8C2ARO7P']);
// ── Quick check ─────────────────────────────────────────────────────────
// A read-only look-up. Runs the same two-step Keepa logic as the real fetch, but writes
// nothing: no session, no reading, no persist(). "vs last" stays anchored to the last
// proper Mon/Wed/Fri fetch, so spot-checking a seller mid-week cannot distort the history.
let QC_PICKED = new Set();
let QC_RUNNING = false;

// ── Total ASINs, without anyone here holding a Keepa key ────────────────
// The app never talks to Keepa for this. It asks Jack's Cloudflare Worker, which already
// holds the key as a secret, and gets back a single number. Sarah needs no key and no Keepa
// account. The endpoint is read-only and cached Worker-side, so it cannot be hammered into
// a token bill — worst case someone learns how many ASINs the storefront has.
const ASIN_COUNT_URL = 'https://keepa.jackbithellbusiness.workers.dev/asin-count?app=oa';   // 9 Nov: app=oa for the Keepa token audit

async function fetchAsinCount(){
  const btn=document.getElementById('asinFetchBtn');
  const note=document.getElementById('asinFetchNote');
  const field=document.getElementById('fAsins');
  if(!btn||!field) return;
  btn.disabled=true; btn.textContent='…';
  note.textContent=''; note.style.color='';
  try{
    const r=await fetch(ASIN_COUNT_URL, {cache:'no-store'});
    if(!r.ok) throw new Error(`the counter replied ${r.status}`);
    const j=await r.json();
    const n=Number(j.count);
    if(!Number.isFinite(n) || n<=0) throw new Error('no number came back');
    field.value=n;
    field.dispatchEvent(new Event('input',{bubbles:true}));   // keep avg-cost in step
    const age=j.asOf ? ` · read ${fmt(String(j.asOf).slice(0,10))}` : '';
    note.style.color='var(--g)';
    note.textContent=`✓ ${n.toLocaleString()} from Keepa${j.cached?' (cached)':''}${age}`;
  }catch(e){
    // Never block the snapshot on this. The field stays typeable and Sarah carries on.
    note.style.color='var(--o)';
    note.textContent=`Couldn't fetch — type it in as usual (${e.message})`;
  }finally{
    btn.disabled=false; btn.textContent='Fetch';
  }
}

function openQuickCheck(){
  QC_PICKED = new Set();
  const box=document.getElementById('qcIds'); if(box) box.value='';
  const out=document.getElementById('qcOut'); if(out) out.innerHTML='';
  document.getElementById('qcProgWrap').style.display='none';
  const pick=document.getElementById('qcPicker');
  pick.innerHTML = SELLERS.filter(x=>x.sellerId).map(x=>
    `<button class="qc-chip" data-id="${kfEsc(x.sellerId)}" onclick="qcToggle(this)">${kfEsc(x.name)}</button>`).join('');
  qcCost();
  document.getElementById('qcIds').addEventListener('input', qcCost);
  document.getElementById('quickModal').classList.add('open');
}

function qcToggle(btn){
  const id=btn.dataset.id;
  if(QC_PICKED.has(id)) QC_PICKED.delete(id); else QC_PICKED.add(id);
  btn.classList.toggle('on', QC_PICKED.has(id));
  qcCost();
}

// Typed IDs and tapped chips, de-duplicated.
function qcTargets(){
  const typed=(document.getElementById('qcIds')?.value||'').split(/\r?\n/)
    .map(l=>mcExtractId(l)).filter(Boolean);
  return [...new Set([...QC_PICKED, ...typed])];
}

function qcCost(){
  const n=qcTargets().length;
  const el=document.getElementById('qcCost'); if(!el) return;
  el.textContent = !n ? 'Pick someone to see the token cost.'
    : `${n} seller${n!==1?'s':''} · ${n} token${n!==1?'s':''} to ask Keepa, plus 10 for your own catalogue and 10 each for any Keepa cannot rank. Worst case about ${n + 10 + n*10}.`;
}

async function runQuickCheck(){
  if(QC_RUNNING) return;
  const ids=qcTargets();
  const out=document.getElementById('qcOut');
  const btn=document.getElementById('qcRunBtn');
  if(!ids.length){ out.innerHTML='<div class="kf-note" style="margin-top:14px">Tap a competitor or paste a seller ID first.</div>'; return; }
  if(KEEPA_RUNNING){ out.innerHTML='<div class="kf-note" style="margin-top:14px">A real fetch is running — let it finish first.</div>'; return; }

  QC_RUNNING=true;
  btn.disabled=true; btn.textContent='Checking…';
  out.innerHTML='';
  const prog=(done,total,label)=>{
    document.getElementById('qcProgWrap').style.display='';
    document.getElementById('qcProgLabel').textContent=label;
    document.getElementById('qcProgCount').textContent=`${done} / ${total}`;
    document.getElementById('qcProgBar').style.width=Math.round((done/Math.max(total,1))*100)+'%';
  };

  const res={}; let tokens=0;
  try{
    prog(0, ids.length+1, 'Asking Keepa…');
    const batch = await keepaCall(`seller=${ids.map(encodeURIComponent).join(',')}`);
    tokens += batch.tokensConsumed||0;
    const map = batch.sellers||{};
    const gaps=[];
    ids.forEach(id=>{
      const rec=map[id];
      const nm = rec?.sellerName || (SELLERS.find(x=>x.sellerId===id)||{}).name || id;
      if(!rec){ res[id]={name:nm, pct:null, note:'not in Keepa'}; return; }
      const m=(rec.competitors||[]).find(c=>c.sellerId===KEEPA_ME);
      const pv=m?Number(m.percent):NaN;
      if(Number.isFinite(pv)) res[id]={name:nm, pct:pv, source:'keepa'};
      else { res[id]={name:nm, pct:null}; gaps.push(id); }
    });

    // Only pay for the catalogue pull if something actually needs calculating.
    if(gaps.length){
      prog(1, gaps.length+2, 'Reading your own catalogue…');
      const mine = await keepaCall(`seller=${KEEPA_ME}&storefront=1`);
      tokens += mine.tokensConsumed||0;
      const meRec=(mine.sellers||{})[KEEPA_ME];
      const list=meRec?.asinList||[], seen=meRec?.asinListLastSeen||[];
      const cut=Date.now()-KEEPA_FRESH_DAYS*86400000;
      const fresh=new Set();
      list.forEach((a,i)=>{ if(seen[i]!=null && keepaToMs(seen[i])>=cut) fresh.add(a); });
      // Same rule as the real fetch: never give up because nothing is freshly verified.
      let matchSet=fresh, stale=false;
      if(!fresh.size && list.length){ matchSet=new Set(list); stale=true; }
      for(let i=0;i<gaps.length;i++){
        const id=gaps[i];
        prog(i+2, gaps.length+2, `Reading ${res[id].name}…`);
        try{
          const r=await keepaCall(`seller=${encodeURIComponent(id)}&storefront=1`);
          tokens += r.tokensConsumed||0;
          const theirs=((r.sellers||{})[id]||{}).asinList||[];
          if(!theirs.length){ res[id].note='no storefront'; continue; }
          const shared=theirs.filter(a=>matchSet.has(a)).length;
          res[id].pct=+(shared/theirs.length*100).toFixed(1);
          res[id].source= stale?'calc~':'calc';
          res[id].size=theirs.length; res[id].shared=shared;
        }catch(e){ res[id].note=e.message; }
      }
    }

    // Fill range/shared for the Keepa-ranked ones too, so the table reads consistently.
    ids.forEach(id=>{
      if(res[id] && res[id].size==null){
        const det=compAsinFor(id);
        if(det){ res[id].size=det.size; res[id].shared=(det.asins||[]).length; res[id].stored=true; }
      }
    });

    document.getElementById('qcProgWrap').style.display='none';
    out.innerHTML = qcTable(ids, res, tokens);
  }catch(e){
    document.getElementById('qcProgWrap').style.display='none';
    out.innerHTML=`<div class="kf-note" style="margin-top:14px;border-color:rgba(255,77,109,.5);color:var(--r)">Keepa said: ${kfEsc(e.message||String(e))}</div>`;
  }finally{
    QC_RUNNING=false; btn.disabled=false; btn.textContent='Check — nothing saved';
  }
}

function qcTable(ids, res, tokens){
  // Last stored reading, so movement is visible without recording anything.
  const lastByName={};
  [...COMPETITOR_SESSIONS].sort((a,b)=>a.date.localeCompare(b.date)).forEach(ses=>{
    (ses.competitors||[]).forEach(c=>{ if(c.sellerId) lastByName[c.sellerId]={pct:c.pct, date:ses.date}; });
  });
  // A coverage % can only move two ways: you gained or lost shared products (the top of the
  // fraction), or they grew or shrank their range (the bottom). Showing the percentage alone
  // hides which — and "they added 40 products" reads very differently to "you dropped 4".
  const delta = (now, then, goodUp) => {
    if(now==null || then==null) return {txt:'', col:'var(--muted)', d:null};
    const d = now - then;
    if(Math.abs(d) < 0.5) return {txt:'→ same', col:'var(--muted2)', d:0};
    const col = goodUp===null ? 'var(--muted2)' : (goodUp ? d>0 : d<0) ? '#00f5a0' : '#ff8c42';
    return {txt:`${d>0?'▲ +':'▼ '}${Math.abs(Math.round(d)).toLocaleString()}`, col, d};
  };

  const rows = ids.map(id=>{
    const r=res[id]||{};
    const prev=lastByName[id];
    const tracked=SELLERS.some(x=>x.sellerId===id);
    const col = r.pct==null?'var(--muted)':r.pct>=25?'var(--g)':r.pct>=15?'#7bd88f':r.pct>=7?'var(--y)':'var(--o)';
    let move='—', mcol='var(--muted)', pctD=null;
    if(r.pct!=null && prev && prev.pct!=null){
      pctD=+(r.pct-prev.pct).toFixed(1);
      mcol = Math.abs(pctD)<0.05?'var(--muted2)':pctD>0?'#00f5a0':'#ff8c42';
      move = `${Math.abs(pctD)<0.05?'→':pctD>0?'▲ +':'▼ '}${Math.abs(pctD)<0.05?'0.0':Math.abs(pctD).toFixed(1)}pp`;
    }
    const gap = (r.size!=null && r.shared!=null) ? r.size-r.shared : null;

    // What we last stored for them, so range and shared-count can be compared too.
    const stored = compAsinDatedFor(id);
    const sizeThen  = stored ? stored.rec.size : null;
    const sharedThen= stored ? (stored.rec.asins||[]).length : null;
    const dSize   = delta(r.size,   r.stored?null:sizeThen,   null);   // their range: neither good nor bad on its own
    const dShared = delta(r.shared, r.stored?null:sharedThen, true);   // you selling more of theirs is good

    // The verdict: name the cause, not just the direction.
    let verdict='', vcol='var(--muted)';
    if(pctD!=null && dSize.d!=null && dShared.d!=null){
      const grew=dSize.d>0, shrank=dSize.d<0, won=dShared.d>0, lost=dShared.d<0;
      if(won && !shrank){ verdict=`Real gain — you picked up ${Math.abs(Math.round(dShared.d))} of their lines`; vcol='#00f5a0'; }
      else if(won && shrank){ verdict=`You gained ${Math.abs(Math.round(dShared.d))} and they trimmed ${Math.abs(Math.round(dSize.d))} — flattering`; vcol='#00f5a0'; }
      else if(!won && !lost && shrank){ verdict=`Only up because they cut ${Math.abs(Math.round(dSize.d))} lines — you added nothing`; vcol='var(--y)'; }
      else if(!won && !lost && grew){ verdict=`Slipped because they added ${Math.abs(Math.round(dSize.d))} you don't stock`; vcol='#ff8c42'; }
      else if(lost && grew){ verdict=`Losing ground — they grew ${Math.abs(Math.round(dSize.d))}, you dropped ${Math.abs(Math.round(dShared.d))}`; vcol='#ff4d6d'; }
      else if(lost){ verdict=`You dropped ${Math.abs(Math.round(dShared.d))} of their lines`; vcol='#ff8c42'; }
      else { verdict='Nothing moved either side'; vcol='var(--muted)'; }
    } else if(!tracked){ verdict='First look — nothing stored to compare against'; }
    else if(r.stored){ verdict='No product detail from this check — percentage only'; }

    return `<div class="qc-row">
      <div><span class="qc-nm">${kfEsc(r.name||id)}</span>${tracked?'':'<span class="qc-new">not tracked</span>'}
        <div class="qc-sub">${kfEsc(id)}${r.source==='calc~'?' · from unverified listings':r.note?' · '+kfEsc(r.note):''}</div></div>
      <div class="qc-pct" style="color:${col}">${r.pct==null?'—':r.pct.toFixed(1)+'%'}</div>
      <div class="qc-mono" style="color:${mcol}">${move}<div class="qc-sub">${prev?'vs '+fmt(prev.date):'no history'}</div></div>
      <div class="qc-mono">${r.size!=null?r.size.toLocaleString():'—'}<div class="qc-sub" style="color:${dSize.col}">${dSize.txt||'&nbsp;'}</div></div>
      <div class="qc-mono" style="color:${r.shared?'var(--g)':'var(--muted)'}">${r.shared!=null?r.shared.toLocaleString():'—'}<div class="qc-sub" style="color:${dShared.col}">${dShared.txt||'&nbsp;'}</div></div>
      <div class="qc-mono" style="color:${gap?'var(--b)':'var(--muted)'}">${gap!=null?gap.toLocaleString():'—'}</div>
      ${verdict?`<div class="qc-verdict" style="color:${vcol}">${kfEsc(verdict)}${stored&&!r.stored?` <span style="color:var(--muted)">· their detail last read ${fmt(stored.date)}</span>`:''}</div>`:''}
    </div>`;
  }).join('');
  const untracked = ids.filter(id=>!SELLERS.some(x=>x.sellerId===id));

  // Your own side of the equation. Coverage is a fraction of THEIR range, so your catalogue
  // growing does not move it on its own — but it says whether you have been buying at all.
  const mineNow = DB.length ? DB[DB.length-1] : null;
  const mineWk  = snapDaysBack(DB, 7, 4, x=>x.asins);
  let mineLine = '';
  if(mineNow){
    const dA = mineWk ? (mineNow.asins||0)-(mineWk.asins||0) : null;
    const dS = mineWk ? (mineNow.skus||0)-(mineWk.skus||0) : null;
    const seg = (label,val,d) => `<span class="qc-mine-seg"><b>${val.toLocaleString()}</b> ${label}`
      + (d==null?'' : ` <span style="color:${d>0?'#00f5a0':d<0?'#ff8c42':'var(--muted2)'}">${d>0?'▲ +':d<0?'▼ ':'→ '}${Math.abs(d).toLocaleString()}</span>`)
      + `</span>`;
    mineLine = `<div class="qc-mine">Your catalogue on ${fmt(mineNow.date)}: `
      + seg('ASINs', mineNow.asins||0, dA) + seg('SKUs', mineNow.skus||0, dS)
      + (mineWk?`<span class="qc-sub">vs ${fmt(mineWk.date)}</span>`:'<span class="qc-sub">no earlier snapshot to compare</span>')
      + `</div>`;
  }

  return mineLine + `<div class="qc-res">
      <div class="qc-hd"><span>Seller</span><span>Coverage</span><span>vs stored</span><span>Their range</span><span>You sell</span><span>To go after</span></div>
      ${rows}
    </div>
    <div class="kf-cost" style="margin-top:10px">Used ${tokens} token${tokens!==1?'s':''} · <b style="color:#3d9eff">nothing was saved</b> — your history and “vs last” are unchanged.</div>
    ${untracked.length?`<div style="margin-top:10px"><button class="cmp-chip" onclick="qcAddTracked()">+ Add ${untracked.length} new seller${untracked.length!==1?'s':''} to your tracked list</button></div>`:''}`;
}

// The only thing here that writes anything — and it opens the normal manage screen so the
// save is still a deliberate press, not a side effect of looking someone up.
function qcAddTracked(){
  const untracked=qcTargets().filter(id=>!SELLERS.some(x=>x.sellerId===id));
  if(!untracked.length) return;
  closeOverlay('quickModal');
  openManageSellers();
  untracked.forEach(id=>addManageRow('', id, true));
  mcPaintAll();
  showToast(`${untracked.length} added — give them names and press Save list`);
}

function mcExtractId(txt){
  const t=String(txt||'');
  // seller=/smid= wins wherever it sits. A bare scan used to grab whichever id came first,
  // so a link with marketplaceID before seller returned the marketplace instead — a valid
  // looking id that Keepa returns nothing for, for good.
  const keyed=t.match(/(?:seller=|smid=|sellerId=)(A[A-Z0-9]{9,19})\b/);
  if(keyed) return keyed[1];
  const all=t.match(/\bA[A-Z0-9]{9,19}\b/g)||[];
  return all.find(id=>!MARKETPLACE_IDS.has(id)) || '';
}

function openManageSellers() {
  manageRowCount = 0;
  MC_PURGE = new Set();
  MC_ORIGINAL = new Map(SELLERS.filter(s=>s.sellerId).map(s=>[s.sellerId, s.name]));
  const wrap = document.getElementById('manageRows');
  wrap.innerHTML = '';
  SELLERS.forEach(s => addManageRow(s.name, s.sellerId));
  if (!SELLERS.length) addManageRow('','',true);
  const box=document.getElementById('mcPaste'); if(box) box.classList.remove('open');
  const pb=document.getElementById('mcPasteBox'); if(pb) pb.value='';
  // Stale suggestions carry "already tracked" flags from the previous session; ticking one
  // that is now on the list makes the whole save refuse for a duplicate id.
  const fp=document.getElementById('mcFind'); if(fp) fp.classList.remove('open');
  const fo=document.getElementById('mcFindOut'); if(fo) fo.innerHTML='';
  const sb=document.getElementById('mcSearch'); if(sb) sb.value='';
  mcCount();
  document.getElementById('manageModal').classList.add('open');
}

function mcCount(){
  const el=document.getElementById('mcCount'); if(!el) return;
  const rows=[...document.querySelectorAll('[id^=mr_]')];
  const dupes=rows.filter(r=>r.classList.contains('dupe')).length;
  const queued=MC_PURGE.size;
  el.innerHTML = `${rows.length} in the list`
    + (queued?` · <span style="color:var(--r)">${queued} to delete</span>`:'')
    + (dupes?` · <span style="color:var(--o)">${dupes} duplicate${dupes!==1?'s':''}</span>`:'');
}

function mcFilter(q){
  const t=(q||'').trim().toLowerCase();
  document.querySelectorAll('[id^=mr_]').forEach(r=>{
    const i=r.id.split('_')[1];
    const n=(document.getElementById('mn_'+i)?.value||'').toLowerCase();
    const id=(document.getElementById('mid_'+i)?.value||'').toLowerCase();
    r.style.display = (!t || n.includes(t) || id.includes(t)) ? '' : 'none';
    r.draggable = !t;                       // reordering while filtered would drop rows in odd places
  });
}

function mcTogglePaste(){
  const b=document.getElementById('mcPaste');
  b.classList.toggle('open');
  if(b.classList.contains('open')) document.getElementById('mcPasteBox').focus();
  else document.getElementById('mcPasteBox').value='';
}

function mcAddPasted(){
  const raw=document.getElementById('mcPasteBox').value.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  if(!raw.length){ mcTogglePaste(); return; }
  // Matched on seller ID, never on name — the same business shows up under different
  // trading names, so the name is no use for telling whether it is already there.
  const nameById={};
  document.querySelectorAll('[id^=mr_]').forEach(r=>{
    const k=r.id.split('_')[1];
    const v=(document.getElementById('mid_'+k)?.value||'').trim();
    if(v) nameById[v]=(document.getElementById('mn_'+k)?.value||'').trim()||v;
  });
  const have=new Set(Object.keys(nameById));
  let added=0, noId=0; const dupeNames=[];
  raw.forEach(line=>{
    const id=mcExtractId(line);
    if(!id){ noId++; return; }
    if(have.has(id)){ dupeNames.push(nameById[id]); return; }
    // name = whatever sits before the ID or the link, tidied up
    let name=line.replace(/https?:\/\/\S+/g,'').replace(id,'').replace(/[,\t|;]+/g,' ').trim();
    have.add(id); addManageRow(name,id,true); added++;      // blank name is fine — flagged below
  });
  document.getElementById('mcPasteBox').value='';
  mcTogglePaste(); mcCount();
  const bits=[`${added} added`];
  if(dupeNames.length) bits.push(`already there: ${dupeNames.join(', ')}`);
  if(noId)  bits.push(`${noId} had no seller ID`);
  showToast('✓ '+bits.join(' · '));
}

// Removal is a question, not a click. Rows with no readings just go.
function mcRemove(i){
  const row=document.getElementById('mr_'+i); if(!row) return;
  const id=(document.getElementById('mid_'+i)?.value||'').trim();
  const name=(document.getElementById('mn_'+i)?.value||'').trim()||'this seller';
  const h=mcHistory(id);
  if(!h.n){ row.remove(); mcPaintAll(); return; }
  if(row.querySelector('.mc-ask')) return;
  const ask=document.createElement('div');
  ask.className='mc-ask';
  ask.innerHTML=`<div class="mc-ask-t">Remove <b>${kfEsc(name)}</b>? They have <b>${h.n}</b> reading${h.n!==1?'s':''} on record back to ${fmt(mcFirstSeen(id))}.</div>
    <button class="mc-mini keep" onclick="mcDrop(${i},false)">Stop tracking · keep history</button>
    <button class="mc-mini wipe" onclick="mcDrop(${i},true)">Delete history too</button>
    <button class="mc-mini" onclick="this.parentElement.remove()">Cancel</button>`;
  row.appendChild(ask);
}

function mcFirstSeen(sellerId){
  const d=[...COMPETITOR_SESSIONS].filter(s=>(s.competitors||[]).some(c=>c.sellerId===sellerId))
    .map(s=>s.date).sort();
  return d[0]||'';
}

function mcDrop(i, purge){
  const row=document.getElementById('mr_'+i); if(!row) return;
  const id=(document.getElementById('mid_'+i)?.value||'').trim();
  const name=(document.getElementById('mn_'+i)?.value||'').trim()||id;
  if(purge){
    const h=mcHistory(id);
    if(!confirm(`Permanently delete ${name}?\n\nThis removes all ${h.n} readings and their shared-product lists from the database. It cannot be undone — the only way back is to re-add them and fetch from scratch.\n\nPress Cancel to keep the history instead.`)) return;
    if(id) MC_PURGE.add(id);
  }
  row.remove(); mcPaintAll();
  showToast(purge?`✓ ${name} will be deleted on save`:`✓ ${name} removed — history kept`);
}

// Ask Keepa who actually overlaps this catalogue rather than guessing at the list by hand.
// Its seller record carries a `competitors` array — the sellers sharing the most products
// with you, with the percentage — which is the same field the overlap fetch already reads.
function mcToggleFind(){
  const b=document.getElementById('mcFind');
  b.classList.toggle('open');
  if(!b.classList.contains('open')) document.getElementById('mcFindOut').innerHTML='';
}

async function mcFindCompetitors(){
  const out=document.getElementById('mcFindOut');
  const btn=document.getElementById('mcFindBtn');
  if(KEEPA_RUNNING){ out.innerHTML='<div class="mc-hint" style="color:var(--y)">A Keepa fetch is running. Let it finish first.</div>'; return; }
  btn.disabled=true; btn.textContent='Asking…';
  out.innerHTML='<div class="mc-hint">Reading your seller record…</div>';
  try{
    const mine=await keepaCall(`seller=${KEEPA_ME}`);
    const rec=(mine.sellers||{})[KEEPA_ME];
    const list=(rec&&rec.competitors)||[];
    if(!list.length){
      out.innerHTML='<div class="mc-hint" style="color:var(--y)">Keepa returned no competitor list for your seller account. That usually means it has not indexed enough of your storefront yet — try again after your next Keepa fetch.</div>';
      return;
    }
    // Whatever is in the open list already, with the nickname the user gave it — Keepa's
    // trading name is often nothing like it, so both are worth showing side by side.
    const yourNames={};
    document.querySelectorAll('[id^=mr_]').forEach(r=>{
      const i=r.id.split('_')[1];
      const id=(document.getElementById('mid_'+i)?.value||'').trim();
      if(id) yourNames[id]=(document.getElementById('mn_'+i)?.value||'').trim();
    });
    const have=new Set(Object.keys(yourNames));
    const usable=list.filter(c=>c.sellerId&&c.sellerId!==KEEPA_ME)
      .map(c=>({id:c.sellerId, pct:Number(c.percent)}))
      .filter(c=>Number.isFinite(c.pct))
      .sort((a,b)=>b.pct-a.pct);
    const ranked=usable.slice(0,40);
    const capped=usable.length-ranked.length;
    out.innerHTML=`<div class="mc-hint">Keepa listed ${usable.length}${capped?`, showing the top ${ranked.length}`:''}. Looking up their trading names…</div>`;
    const names={};
    if(ranked.length){
      // Names for everyone, tracked included — that is how a nickname gets matched to the
      // real business behind it. One token each, so a handful of tokens in total.
      const batch=await keepaCall(`seller=${ranked.map(c=>encodeURIComponent(c.id)).join(',')}`);
      Object.entries(batch.sellers||{}).forEach(([id,r])=>{ names[id]=r.sellerName||''; });
    }
    const rows=ranked.map(c=>{
      const keepaName=names[c.id]||'';
      const yours=yourNames[c.id]||'';
      return {...c, name:keepaName||yours||c.id, yours,
              have:have.has(c.id), amz:mcIsAmazon(keepaName||yours, c.id, c.pct)};
    });
    rows.forEach(r=>{ r.bucket = r.amz ? 'amz' : r.have ? 'have' : 'new'; });
    const addable=rows.filter(r=>r.bucket==='new');
    const amzTop=rows.filter(r=>r.amz).sort((a,b)=>b.pct-a.pct)[0];
    if(!rows.length){
      out.innerHTML='<div class="mc-hint" style="color:var(--y)">Keepa returned a list but none of it was usable — no seller IDs or no percentages.</div>';
      return;
    }
    out.innerHTML=`
      <div class="mc-sug-hd">
        <span>${addable.length} worth adding · ${rows.filter(r=>r.bucket==='have').length} already tracked${rows.filter(r=>r.bucket==='amz').length?` · ${rows.filter(r=>r.bucket==='amz').length} Amazon`:''}${capped?` · ${capped} below the cut`:''}</span>
        <span><button class="mc-mini" onclick="mcSugAll(true)">Tick all new</button>
              <button class="mc-mini" onclick="mcSugAll(false)">Clear</button></span>
      </div>
      <div class="mc-hint" style="margin:8px 0 4px">This percentage runs <b>the opposite way</b> to the Competitors table: it is how much of <b>your</b> range that seller is on${amzTop?` — ${kfEsc(amzTop.name)} is on ${amzTop.pct.toFixed(0)}% of your catalogue`:''}. Keepa counts it over everything it has ever seen you list, so treat it as a ranking, not a precise figure.</div>
      <div class="mc-sug-cols"><span></span><span>Seller</span><span>Seller ID</span><span>% of your range</span></div>
      <div class="mc-sug">${rows.map(r=>`
        <label class="mc-sug-row${r.have||r.amz?' have':''}">
          <input type="checkbox" class="mc-sug-cb" data-id="${kfEsc(r.id)}" data-name="${kfEsc(r.name)}" ${r.have||r.amz?'disabled':''}>
          <span>${kfEsc(r.name)}${r.have?` <span class="mc-sug-tag">${r.yours&&r.yours!==r.name?`you call them ${kfEsc(r.yours)}`:'already tracked'}</span>`
                                 :r.amz?' <span class="mc-sug-tag">Amazon itself — not trackable</span>':''}</span>
          <span class="mc-sug-id">${kfEsc(r.id)}</span>
          <span class="mc-sug-pct">${Math.round(r.pct)}%</span>
        </label>`).join('')}</div>
      <div style="display:flex;gap:8px;margin-top:10px">
        <button class="mc-btn" onclick="mcSugAdd()">Add ticked to the list</button>
      </div>
      <div class="mc-hint">The Competitors table shows how much of <b>their</b> range <b>you</b> cover, so each number will change once they are fetched. Nothing is saved until you press Save list.</div>`;
  }catch(e){
    out.innerHTML=`<div class="mc-hint" style="color:var(--r)">Keepa said: ${kfEsc(e.message||String(e))}</div>`;
  }finally{
    btn.disabled=false; btn.textContent='Ask Keepa';
  }
}

// Amazon's own retail accounts sit at the top of every overlap list — they are on most of
// what anyone sells. Tracking them would drag every average in the app down and there is
// nothing to act on, so they are shown for the fact and locked out of the list.
const AMAZON_IDS = new Set([
  'A3P5ROKL5A1OLE',   // Amazon
  'A2OAJ7377F756P',   // Amazon Resale
  'A30DC7701CXIBH',   // Amazon EU
  'A3P5T0KG8HPPPW',   // Amazon Warehouse
]);
function mcIsAmazon(name, id, pct){
  if(AMAZON_IDS.has(id)) return true;
  if(/^amazon\b/i.test(String(name||'').trim())) return true;
  // No name came back and it covers more of the range than any third-party seller
  // plausibly could — almost certainly another Amazon account under a new id.
  return !String(name||'').trim() && Number(pct) >= 50;
}

function mcSugAll(on){ document.querySelectorAll('.mc-sug-cb:not([disabled])').forEach(c=>c.checked=on); }

function mcSugAdd(){
  const picked=[...document.querySelectorAll('.mc-sug-cb:checked')];
  if(!picked.length){ showToast('Nothing ticked'); return; }
  // Re-read the list now: it may have gained rows since the suggestions were drawn.
  const have=new Set([...document.querySelectorAll('[id^=mid_]')].map(i=>i.value.trim()).filter(Boolean));
  let added=0, skipped=0;
  picked.forEach(c=>{
    if(have.has(c.dataset.id)){ skipped++; return; }
    have.add(c.dataset.id);
    addManageRow(c.dataset.name||c.dataset.id, c.dataset.id, true); added++;
  });
  mcToggleFind(); mcCount();
  showToast(added?`✓ ${added} added${skipped?` · ${skipped} already there`:''} — press Save list to keep them`
                 :'All of those are already on your list');
}

function addManageRow(name='', sellerId='', isNew=false) {
  manageRowCount++;
  const i = manageRowCount;
  const wrap = document.getElementById('manageRows');
  const row = document.createElement('div');
  row.id = 'mr_'+i;
  row.className = 'mc-row manage-row' + (isNew?' isnew':'');
  row.draggable = true;
  row.innerHTML = `
    <div class="mc-grip" title="Drag to reorder">⋮</div>
    <input class="mc-in" id="mn_${i}" value="${kfEsc(name)}" placeholder="Name you call them" oninput="mcPaintAll()">
    <input class="mc-in id" id="mid_${i}" value="${kfEsc(sellerId)}" placeholder="Seller ID or storefront link"
           oninput="mcPaintAll()" onblur="mcTidyId(${i})" onpaste="setTimeout(()=>mcTidyId(${i}),0)">
    <div class="mc-stat" id="mst_${i}"></div>
    <button class="mc-x" onclick="mcRemove(${i})" title="Remove from the list">×</button>`;
  wrap.appendChild(row);
  mcPaintRow(i);
  if(isNew){ wrap.scrollTop = wrap.scrollHeight; setTimeout(()=>document.getElementById('mn_'+i)?.focus(),30); }
  mcCount();

  row.addEventListener('dragstart', (e) => {
    if(e.target.tagName==='INPUT'){ e.preventDefault(); return; }
    draggedRow = row; row.style.opacity='0.5'; e.dataTransfer.effectAllowed='move';
  });
  row.addEventListener('dragover', (e) => {
    e.preventDefault(); e.dataTransfer.dropEffect='move';
    if (draggedRow && draggedRow !== row) row.style.borderTop='2px solid var(--g)';
  });
  row.addEventListener('dragleave', () => { row.style.borderTop=''; });
  row.addEventListener('drop', (e) => {
    e.preventDefault();
    if (draggedRow && draggedRow !== row) document.getElementById('manageRows').insertBefore(draggedRow, row);
  });
  row.addEventListener('dragend', () => {
    document.querySelectorAll('.manage-row').forEach(r => { r.style.borderTop=''; r.style.opacity='1'; });
    draggedRow = null;
  });
}

// Pull the ID out of a pasted storefront link and refresh the row's status.
function mcTidyId(i){
  const el=document.getElementById('mid_'+i); if(!el) return;
  const found=mcExtractId(el.value);
  if(found && found!==el.value.trim()) el.value=found;
  mcPaintRow(i);
  mcPaintAll();          // clearing a clash has to un-flag the row it was clashing with
}

// Every row is matched on seller ID, never on the name — the name is just what Jack calls
// them, and the same business turns up under a different trading name (Keepa's "J C Stores
// (VAT REG)" is his "Stu's"). Saying which row it already is beats a bare "duplicate".
function mcPaintRow(i){
  const el=document.getElementById('mid_'+i), st=document.getElementById('mst_'+i), row=document.getElementById('mr_'+i);
  if(!el||!st||!row) return;
  const id=el.value.trim();
  const badShape = !!id && !/^A[A-Z0-9]{9,19}$/.test(id);

  let clashWith=null;
  if(id){
    document.querySelectorAll('[id^=mid_]').forEach(other=>{
      if(other===el || clashWith) return;
      if(other.value.trim()===id){
        const j=other.id.split('_')[1];
        clashWith=(document.getElementById('mn_'+j)?.value||'').trim()||'another row';
      }
    });
  }

  el.classList.toggle('bad', badShape || !!clashWith);
  row.classList.toggle('dupe', !!clashWith);

  const h=mcHistory(id);
  if(clashWith){
    st.className='mc-stat warn';
    st.innerHTML=`<b>already added</b>as ${kfEsc(clashWith)}`;
  } else if(!id){
    st.className='mc-stat none'; st.innerHTML='<b>new</b>needs an ID';
  } else if(badShape){
    st.className='mc-stat warn'; st.innerHTML='<b>check this</b>not an Amazon ID';
  } else if(!(document.getElementById('mn_'+i)?.value||'').trim()){
    st.className='mc-stat warn'; st.innerHTML='<b>needs a name</b>what do you call them?';
  } else if(h.n){
    // A seller taken off the list keeps their readings, so re-adding them picks the history
    // straight back up — worth saying, because it looks like a brand new row otherwise.
    const known=SELLERS.some(x=>x.sellerId===id);
    st.className='mc-stat live';
    st.innerHTML=`<b>${h.last!=null?h.last.toFixed(1)+'%':'—'}</b>${known?`${h.n} reading${h.n!==1?'s':''}`:`${h.n} on record — history returns`}`;
  } else {
    st.className='mc-stat none'; st.innerHTML='<b>—</b>no readings yet';
  }
}

function mcPaintAll(){
  document.querySelectorAll('[id^=mr_]').forEach(r=>mcPaintRow(r.id.split('_')[1]));
  mcCount();
}

let draggedRow = null;

let MC_SAVING = false;
async function saveSellerList() {
  if (MC_SAVING) return;              // the whole save is async; a second click ran it twice
  MC_SAVING = true;
  try { await _saveSellerList(); }
  catch (e) {
    // Anything thrown after the writes have landed used to vanish as an unhandled rejection,
    // leaving the modal open as though nothing had happened.
    console.error('Seller list save failed late:', e);
    closeOverlay('manageModal');
    try { renderCompTab(); renderContested(); renderBadges(); } catch(_) {}
    alert(`⚠ The seller list saved, but the screen could not finish updating.\n\n${e?.message || e}\n\nReload the page to see the current state — your changes are already in the database.`);
  }
  finally { MC_SAVING = false; }
}

async function _saveSellerList() {
  const rows = document.querySelectorAll('[id^=mr_]');
  const prevSellers = SELLERS.slice();
  const blankNames = [];
  SELLERS = [];
  rows.forEach(row => {
    const i = row.id.split('_')[1];
    const name = document.getElementById('mn_'+i)?.value.trim();
    const sellerId = document.getElementById('mid_'+i)?.value.trim()||''
    if (name) SELLERS.push({name, sellerId});
    else if (sellerId) blankNames.push(sellerId);
  });
  if (blankNames.length) {
    // Nameless rows used to vanish without a word — and the prune then deleted them.
    SELLERS = prevSellers;
    alert(`⚠ ${blankNames.length} row${blankNames.length!==1?'s have':' has'} a seller ID but no name.\n\nMissing for: ${blankNames.join(', ')}\n\nNothing was saved — give them a name (anything you will recognise) and try again.`);
    return;
  }
  // Two sellers sharing an ID collapse to one on upsert, so one vanishes without a word.
  const idCounts = {};
  SELLERS.forEach(x => { const k=(x.sellerId||'').trim(); if(k) idCounts[k]=(idCounts[k]||0)+1; });
  const dupIds = Object.keys(idCounts).filter(k => idCounts[k] > 1);
  if (dupIds.length) {
    SELLERS = prevSellers;
    alert(`⚠ Two sellers share the same Seller ID.\n\nDuplicated: ${dupIds.join(', ')}\n\nNothing was saved — one of them would have been silently dropped.`);
    return;
  }
  const missingId = SELLERS.filter(x => !(x.sellerId || '').trim()).map(x => x.name);
  if (missingId.length) {
    // Without an ID the row cannot be upserted, so it falls out of the keep-set and the
    // prune deletes it. Refuse rather than silently remove the seller.
    SELLERS = prevSellers;
    alert(`⚠ Every seller needs a Seller ID.\n\nMissing for: ${missingId.join(', ')}\n\nAdd the ID (or paste their storefront link) and press Save list again.`);
    return;
  }
  if (!DATA_LOADED) {
    SELLERS = prevSellers;
    alert('⚠ Your data never loaded, so this list is not safe to save.\n\nSaving now would overwrite your real competitor list with an empty one. Reload the page, wait for the numbers to appear, then try again.');
    return;
  }
  if (!SELLERS.length && prevSellers.length) {
    if (!confirm(`⚠ The list is empty.\n\nSaving now removes all ${prevSellers.length} competitors. Readings already on record are kept unless you chose to delete them.\n\nSave an empty list?`)) {
      SELLERS = prevSellers; return;
    }
  }
  // Two sellers under one name merge into a single row — the tables group history by name.
  const nameCounts = {};
  SELLERS.forEach(x => { const k = x.name.trim().toLowerCase(); nameCounts[k] = (nameCounts[k]||0)+1; });
  const dupNames = Object.keys(nameCounts).filter(k => nameCounts[k] > 1);
  if (dupNames.length) {
    SELLERS = prevSellers;
    alert(`⚠ Two competitors have the same name.\n\nDuplicated: ${dupNames.join(', ')}\n\nNothing was saved — the tables group history by name, so they would merge into one row. Give them different names and try again.`);
    return;
  }
  const badId = SELLERS.filter(x => !/^A[A-Z0-9]{9,19}$/.test(x.sellerId));
  if (badId.length && !confirm(`These seller IDs don't look like Amazon IDs:\n\n${badId.map(x=>`${x.name} — ${x.sellerId}`).join('\n')}\n\nKeepa will return nothing for them. Save anyway?`)) {
    SELLERS = prevSellers; return;
  }

  const sellersOk = await persist(undefined, false, { pruneSellers: true });
  if (!sellersOk) {
    SELLERS = prevSellers;   // put the stored list back; the edits are still in the open form
    showSyncStatus('error');
    alert('⚠ The seller list did NOT save.\n\nYour changes are still in this window — check your internet connection and press Save list again.');
    return;
  }

  // Renames: history rows carry the name they were saved under, and the tables group by
  // name — so without this a rename splits one seller into two half-length series.
  const renames = SELLERS.filter(x => MC_ORIGINAL.has(x.sellerId) && MC_ORIGINAL.get(x.sellerId) !== x.name);
  let renamed = 0;
  for (const r of renames) {
    const ok = await window._supabaseRenameSellerHistory(r.sellerId, r.name);
    if (ok) renamed++;
    else alert(`⚠ ${r.name} was renamed in the list, but their older readings could not be updated.\n\nThey may show as two separate sellers until this is retried.`);
  }

  // Purges: only ids the user explicitly chose to wipe AND that are genuinely gone from the
  // saved list. Without the second half, deleting a seller, changing your mind and re-adding
  // them in the same sitting still wiped their history while they stayed tracked.
  const stillTracked = new Set(SELLERS.map(x => x.sellerId));
  const toPurge = [...MC_PURGE].filter(id => !stillTracked.has(id));
  const nameFor = id => (MC_ORIGINAL.get(id) || id);
  let purged = 0;
  const purgeFailed = new Set();
  for (const id of toPurge) {
    const ok = await window._supabaseDeleteSellerHistory(id);
    if (ok) purged++;
    else { purgeFailed.add(id); alert(`⚠ Could not delete the history for ${nameFor(id)}.\n\nThey are off your list but their readings are still in the database. Press Save list again to retry.`); }
  }
  // Failures stay queued so a retry actually retries; anything rescued stays out of the queue.
  MC_PURGE = purgeFailed;

  // Reload from Supabase to ensure order is correct
  try {
    const data = await window._supabaseLoad();
    if (data) {
      SELLERS = data.sellers || [];
      if (purged || renamed) {
        COMPETITOR_SESSIONS = data.competitorSessions || COMPETITOR_SESSIONS;
        if (data.competitorAsins) COMPETITOR_ASINS = data.competitorAsins;
      }
    }
  } catch (err) {
    console.error('Failed to reload sellers:', err);
  }
  // Outside the reload: if it failed, the in-memory readings were still edited by the rename
  // and purge helpers, and a stale signature sends the next save down the delete-and-reinsert
  // path this file goes out of its way to avoid.
  if (purged || renamed) window._refreshReadingSigs(COMPETITOR_SESSIONS);

  closeOverlay('manageModal');
  // Each redraw is isolated: the save has already landed, so one screen failing to refresh
  // must not stop the others — least of all the nav badge, which is how you tell it worked.
  [['competitors table', renderCompTab],
   ['overlap map',       renderContested],
   ['comp history',      renderCompHistory],
   ['insights',          () => renderCompInsights(filteredSnaps())],
   ['overview tile',     setKpiCompAvg],
   ['badges',            renderBadges]].forEach(([what, fn]) => {
    try { fn(); } catch (e) { console.error(`Saved, but the ${what} could not redraw:`, e); }
  });
  const extras = [renamed?`${renamed} renamed`:'', purged?`${purged} history deleted`:''].filter(Boolean);
  showToast(`✓ ${SELLERS.length} competitor${SELLERS.length!==1?'s':''} saved${extras.length?' · '+extras.join(' · '):''}`);
}

function showToast(msg) {
  let t = document.getElementById('toast');
  if (!t) { t=document.createElement('div'); t.id='toast'; t.style.cssText='position:fixed;bottom:24px;right:24px;background:var(--g);color:var(--bg);font-family:var(--mono);font-size:11px;font-weight:700;padding:10px 18px;z-index:9000;opacity:0;transition:opacity .2s'; document.body.appendChild(t); }
  t.textContent=msg; t.style.opacity='1';
  setTimeout(()=>t.style.opacity='0', 2800);
}

// ── SKU import / provider classification engine (inside Add/Edit Snapshot modal) ──
// Ported from the standalone SKU Provider Ledger tool. N/A is a fixed sink bucket:
// it is never written to bdl_providers and never shown on the Provider page.
const NA_PROVIDER = 'N/A';
const IMP_HOUSEKEEP = new Set(['ret','retu','uln','gr','ulnu','retx']);
const IMP_PSEUDO = new Set(['No naming format','Unrecognised format','Blank']);
// Generic filler words that sometimes survive as a misc key (e.g. "units", "qty", "pack") —
// not noise-filtered out of classify() itself (that would risk masking a real adjacent token,
// see dev spec on noise filtering), just flagged for display so they read as low-priority
// junk like the pseudo buckets do, instead of looking like a real unresolved provider code.
const IMP_GENERIC_WORDS = new Set(['units','unit','qty','quantity','pcs','pc','pack','packs','set','sets','item','items','box','boxes','bundle','bundles','each','ea','lot','lots']);
function impIsGenericWord(code){
  return IMP_GENERIC_WORDS.has(String(code||'').toLowerCase());
}
const IMP_IGNORE = '__IGNORE__';
// PROVIDER_RULES (classification rules: aliases/stems/titleKeywords per provider) declared globally above.

// Starting set of 17 known providers, ported from the standalone SKU Provider Ledger tool.
// Seeded once into Supabase on first load if bdl_providers is empty — after that, this constant
// is never consulted again; everything lives in PROVIDER_DEFS/PROVIDER_RULES and you fully
// control it from Settings (add, edit aliases/stems, archive, delete).
const DEFAULT_PROVIDERS = [
  { name:"Jack",       aliases:["jac"],            stems:["jac"] },
  { name:"ProfitPath", aliases:[],                 stems:["profitpath"] },
  { name:"Zette",      aliases:[],                 stems:["zette"] },
  { name:"PP",         aliases:["pp","spp","ppa"], stems:["spp"] },
  { name:"PPA2A",      aliases:[],                 stems:["ppa2a"] },
  { name:"Almera",     aliases:[],                 stems:["almera"] },
  { name:"Lavarion",   aliases:[],                 stems:["lavarion"], titleKeywords:["lavarion"] },
  { name:"Arbi",       aliases:[],                 stems:["arbi"] },
  { name:"PS",         aliases:[],                 stems:[] },
  { name:"Replen",     aliases:["repl"],           stems:["rep"] },
  { name:"THC",        aliases:[],                 stems:["thc"] },
  { name:"TFTJ",       aliases:["tfj"],            stems:["tftj"] },
  { name:"FFB",        aliases:[],                 stems:["ffb"] },
  { name:"HOR",        aliases:[],                 stems:["hor"] },
  { name:"VAA",        aliases:[],                 stems:["vaa"] },
  { name:"VAS",        aliases:[],                 stems:["vas"] },
];

let impRows = [];           // [{sku, title}] parsed from the imported file
let impFileName = '';
let impCountMode = 'unique';
let impSkuOverride = new Map();  // sku -> providerName | IMP_IGNORE
