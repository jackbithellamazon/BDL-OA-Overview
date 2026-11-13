function openAvgOverlapModal(){
  const modal=document.getElementById('kpiModal'), title=document.getElementById('kpiModalTitle'), body=document.getElementById('kpiModalBody');
  if(!modal||!title||!body) return;
  const concernEl=document.getElementById('kpiModalConcern'); if(concernEl){ concernEl.textContent=''; concernEl.style.display='none'; }
  // Use compSessionsInRange() so the chart respects the current date range (e.g. Last 30d)
  const sessions=[...compSessionsInRange()].sort((a,b)=>a.date.localeCompare(b.date));
  const series=sessions.map(s=>{
    const active=(s.competitors||[]).filter(c=>(c.pct||0)>0);
    const avg=active.length?active.reduce((x,c)=>x+c.pct,0)/active.length:0;
    return {date:s.date, avg:parseFloat(avg.toFixed(1)), n:active.length};
  }).filter(x=>x.n>0);
  title.textContent='Average rival coverage — trend';
  modal.style.display='flex';
  if(series.length<1){ body.innerHTML='<div style="padding:30px;font-family:var(--mono);color:var(--muted2)">Not enough competitor sessions yet.</div>'; return; }
  const first=series[0].avg, last=series[series.length-1].avg, d=+(last-first).toFixed(1);
  body.innerHTML=`
    <div style="display:flex;align-items:baseline;gap:14px;margin-bottom:12px">
      <div style="font-family:var(--mono);font-size:38px;font-weight:700;color:var(--text)">${last}%</div>
      <div style="font-family:var(--mono);font-size:13px;font-weight:700;color:${d>0?'#22c55e':d<0?'#ef4444':'var(--muted2)'}">${d>0?'▲ +':d<0?'▼ ':'→ '}${Math.abs(d)}pp over ${series.length} sessions</div>
    </div>
    <div style="font-family:var(--mono);font-size:11px;color:var(--muted2);margin-bottom:14px">The average share of each rival's range that you already sell (sellers you share nothing with are excluded), every session on record. Rising = you now stock more of what they stock.</div>
    <div style="height:240px"><canvas id="avgOverlapChart"></canvas></div>`;
  destroyChart('avgOverlapChart');
  const cv=document.getElementById('avgOverlapChart'); if(!cv||typeof Chart==='undefined') return;
  const vals=series.map(s=>s.avg); const lo=Math.max(0,Math.floor(Math.min(...vals)-3)), hi=Math.min(100,Math.ceil(Math.max(...vals)+3));
  chartInstances.avgOverlapChart=new Chart(cv.getContext('2d'),{ type:'line',
    data:{ labels:series.map(s=>fmtShort(s.date)), datasets:[{ data:vals, borderColor:'#ffd166', borderWidth:1.6, tension:.25, fill:false, pointRadius:2.6, pointHoverRadius:5, pointBackgroundColor:'#ffd166', pointBorderColor:'#07090c', pointBorderWidth:1.5 }] },
    options:{ responsive:true, maintainAspectRatio:false, interaction:{mode:'index',intersect:false},
      plugins:{ legend:{display:false}, datalabels:{display:false},
        tooltip:{ callbacks:{ title:items=>fmt(series[items[0].dataIndex].date), label:item=>`Avg overlap: ${item.parsed.y}% · ${series[item.dataIndex].n} sellers` } } },
      scales:{ y:{min:lo,max:hi,grid:{color:'#1c2330'},ticks:{color:'#a7b4c4',callback:v=>v+'%'}}, x:{grid:{display:false},ticks:{color:'#a7b4c4',maxRotation:0,autoSkip:true,maxTicksLimit:10}} } } });
}

function compSessionsInRange(){
  let s=[...COMPETITOR_SESSIONS];
  if(rangeFrom && rangeTo) s=s.filter(x=>x.date>=rangeFrom && x.date<=rangeTo);
  return s;
}
// Sort and filter state for the competitor list. Both re-render in place.
let compSort = 'pct', compSortDir = 1, compFilter = 'all';   // Jack 26 Sep: highest % you're on at the top
function setCompSort(k){
  if (compSort === k) compSortDir = -compSortDir; else { compSort = k; compSortDir = 1; }
  renderCompTab();
}
function setCompFilter(f){ compFilter = f; renderCompTab(); }
window.setCompSort = setCompSort; window.setCompFilter = setCompFilter;

// How old is the newest reading? At twice a week these numbers go stale quickly, and a stale
// reading looks exactly like a current one unless the page says so.
function renderCompStale(){
  const el = document.getElementById('compStale');
  if (!el) return;
  const dates = COMPETITOR_SESSIONS.map(s=>s.date).filter(Boolean).sort();
  if (!dates.length) { el.innerHTML=''; return; }
  const last = dates[dates.length-1];
  const days = Math.floor((Date.now() - new Date(last+'T00:00:00').getTime())/86400000);
  if (days < 7) { el.innerHTML=''; return; }
  const cls = days >= 14 ? 'bad' : 'warn';
  el.innerHTML = `<div class="cmp-stale ${cls}">
    <span>Your last reading is <b>${days} days old</b> (${fmt(last)}). Overlap moves — these figures may no longer reflect what your rivals are doing.</span>
    <button class="btn-g" style="font-size:11px;padding:7px 14px" onclick="openKeepaFetch()">Fetch now</button>
  </div>`;
}

// Your ASINs ranked by how many rivals stock each one. Built from the shared-product lists
// a Keepa fetch stores — a percentage tells you a competitor is close, this tells you which
// products they are actually on.
// ── Overlap map ─────────────────────────────────────────────────────────
// Every ASIN in here is one Jack already sells; the count is how many of the
// tracked sellers are on the same listing. Kept deliberately unalarming: a
// crowded listing is a product the whole field agreed was worth stocking.
let OV_BAND='all', OV_SEARCH='', OV_LIMIT=40, OV_ROWS=[], OV_TOTALS={};

// Cool single-hue ramp — quiet slate through to busy violet. No traffic lights.
function ovTone(n){ return n>=8?'#c084fc' : n>=5?'#8b7cf6' : n>=2?'#3d9eff' : '#64748b'; }
function ovBandOf(n){ return n>=5?'hot' : n>=2?'mid' : 'solo'; }

function setOvBand(b){ OV_BAND=b; OV_LIMIT=40; ovPaint(); }
function ovMore(){ OV_LIMIT+=80; ovPaint(); }
function ovFind(v){ OV_SEARCH=(v||'').trim().toUpperCase(); OV_LIMIT=40; ovPaint(); }
let OV_RESIZE=null;
window.addEventListener('resize',()=>{ clearTimeout(OV_RESIZE); OV_RESIZE=setTimeout(()=>{ if(document.getElementById('ovList')) ovPaint(); },160); });

function ovFiltered(){
  let r=OV_ROWS;
  if(OV_BAND!=='all') r=r.filter(x=>ovBandOf(x.n)===OV_BAND);
  if(OV_SEARCH) r=r.filter(x=>x.asin.includes(OV_SEARCH) || x.who.some(w=>w.name.toUpperCase().includes(OV_SEARCH)));
  return r;
}

// Repaints the list and the band counts only, so the search box keeps focus.
function ovPaint(){
  const list=document.getElementById('ovList'), foot=document.getElementById('ovFoot');
  if(!list) return;
  document.querySelectorAll('.ov-band').forEach(b=>b.classList.toggle('on', b.dataset.band===OV_BAND));
  const rows=ovFiltered();
  const shown=rows.slice(0,OV_LIMIT);

  // Work out how many names fit on one line at the current width rather than guessing —
  // a fixed count clipped chips mid-word on a narrow screen.
  const narrow=window.matchMedia('(max-width:1150px)').matches;
  const fixed=narrow?(24+96+84):(26+104+96);
  const whoW=Math.max(110,(list.clientWidth||900)-fixed-12*3-16-14);
  const chipW=n=>n.length*6.1+18;                      // 10.5px text + 7px padding either side

  list.innerHTML = shown.length ? shown.map((r,i)=>{
    const tone=ovTone(r.n);
    const dots=Array.from({length:12},(_,d)=>`<span class="ov-dot${d<r.n?'':' off'}"></span>`).join('');
    let used=0, fit=0;
    for(const w of r.who){
      const need=chipW(w.name)+(fit?4:0);
      const tail=fit+1<r.who.length?58:0;              // room for the "+N more" tag
      if(used+need+tail>whoW) break;
      used+=need; fit++;
    }
    if(!fit) fit=1;
    const chips=r.who.slice(0,fit).map(w=>`<span class="ov-chip">${kfEsc(w.name)}</span>`).join('')
      + (r.who.length>fit?`<span class="ov-more">+${r.who.length-fit} more</span>`:'');
    return `<div class="ov-row" style="--tone:${tone}" title="${kfEsc(r.who.map(w=>w.name).join(', '))}">
      <div class="ov-n">${i+1}</div>
      <div><a class="ov-asin" href="https://www.amazon.co.uk/dp/${encodeURIComponent(r.asin)}" target="_blank" rel="noopener">${kfEsc(r.asin)}</a></div>
      <div class="ov-meter"><div class="ov-dots">${dots}</div><span class="ov-cnt">${r.n}</span></div>
      <div class="ov-who">${chips}</div>
    </div>`;
  }).join('') : `<div class="ov-none">Nothing matches${OV_SEARCH?` “${kfEsc(OV_SEARCH)}”`:''}.</div>`;

  foot.innerHTML = `<span>Showing ${shown.length.toLocaleString()} of ${rows.length.toLocaleString()}${OV_BAND!=='all'||OV_SEARCH?` (${OV_TOTALS.all.toLocaleString()} in total)`:''} · every ASIN listed is one you sell</span>`
    + (rows.length>shown.length?`<button onclick="ovMore()">Show ${Math.min(80,rows.length-shown.length)} more ↓</button>`:'');
}

function renderContested(){
  const card=document.getElementById('contestedCard');
  const body=document.getElementById('contestedBody');
  const tag=document.getElementById('contestedTag');
  if(!card||!body) return;

  const dates=Object.keys(COMPETITOR_ASINS||{}).sort();
  const latest=dates[dates.length-1];

  // Latest coverage reading per seller, so each row can name the biggest player on it.
  // The name map also falls back to the readings, so a seller taken off the list still
  // shows by name here rather than as a raw Amazon ID.
  const pctById={}, nameById={};
  SELLERS.forEach(x=>{ if(x.sellerId) nameById[x.sellerId]=x.name; });
  [...(COMPETITOR_SESSIONS||[])].sort((a,b)=>a.date.localeCompare(b.date)).forEach(ses=>{
    (ses.competitors||[]).forEach(c=>{ if(c.sellerId){ pctById[c.sellerId]=c.pct||0; if(!nameById[c.sellerId]) nameById[c.sellerId]=c.name; } });
  });

  const byAsin=new Map();
  if(latest){
    const trackedIds=new Set(SELLERS.map(x=>x.sellerId).filter(Boolean));
    Object.entries(COMPETITOR_ASINS[latest]||{}).forEach(([sellerId,rec])=>{
      if(trackedIds.size && !trackedIds.has(sellerId)) return;   // a rival you removed isn't in the field
      const nm=nameById[sellerId] || sellerId;
      const pct=pctById[sellerId]||0;
      (rec.asins||[]).forEach(a=>{ if(!byAsin.has(a)) byAsin.set(a,[]); byAsin.get(a).push({name:nm,pct}); });
    });
  }

  if(!byAsin.size){
    tag.textContent='no data yet';
    body.innerHTML=`<div class="cmp-empty">
      No shared-product data yet.<br>
      Run <b>⬇ Fetch from Keepa</b> with the shared-product lists ticked, then Save All.
      <div style="margin-top:10px"><button class="cmp-chip" onclick="openKeepaFetch()">Fetch now</button></div>
    </div>`;
    return;
  }

  OV_ROWS=[...byAsin.entries()].map(([asin,who])=>({
      asin, n:who.length,
      who: who.slice().sort((a,b)=>b.pct-a.pct || a.name.localeCompare(b.name))   // biggest player first
    }))
    .sort((a,b)=>b.n-a.n || a.asin.localeCompare(b.asin));

  OV_TOTALS={
    all:  OV_ROWS.length,
    solo: OV_ROWS.filter(r=>r.n===1).length,
    mid:  OV_ROWS.filter(r=>r.n>=2&&r.n<5).length,
    hot:  OV_ROWS.filter(r=>r.n>=5).length,
  };
  const peak=OV_ROWS[0].n;
  const sellersSeen=new Set(); OV_ROWS.forEach(r=>r.who.forEach(w=>sellersSeen.add(w.name)));
  tag.textContent=`${fmt(latest)} · ${sellersSeen.size} sellers`;

  const band=(key,val,label,tone)=>`<button class="ov-band${OV_BAND===key?' on':''}" data-band="${key}" style="--tone:${tone}" onclick="setOvBand('${key}')">
      <div class="ov-band-v">${val.toLocaleString()}</div><div class="ov-band-l">${label}</div></button>`;

  body.innerHTML=`<div class="ov-wrap">
    <div class="ov-top">
      <div class="ov-lede">Products <b>you already sell</b> that these sellers stock too. The number is how many of them are on the same listing — <b>1</b> means you have it close to yourself, <b>${peak}</b> is the busiest listing in your range.</div>
      <input class="ov-search" id="ovSearch" value="${kfEsc(OV_SEARCH)}" placeholder="ASIN or seller" oninput="ovFind(this.value)">
    </div>
    <div class="ov-bands">
      ${band('all', OV_TOTALS.all,  'shared with the field', '#3d9eff')}
      ${band('solo',OV_TOTALS.solo, 'just one of them on it','#64748b')}
      ${band('mid', OV_TOTALS.mid,  '2 to 4 on it',          '#3d9eff')}
      ${band('hot', OV_TOTALS.hot,  '5 or more on it',       '#c084fc')}
    </div>
    <div class="ov-colhead"><span></span><span>Your ASIN</span><span>Sellers on it</span><span>Which sellers</span></div>
    <div class="ov-list" id="ovList"></div>
    <div class="ov-foot" id="ovFoot"></div>
  </div>`;
  ovPaint();
}

// Newest stored ASIN detail for a seller, whichever date it was captured on.
function compAsinFor(sellerId){
  const hit = compAsinDatedFor(sellerId);
  return hit ? hit.rec : null;
}

// The detail from the fetch BEFORE the newest one. Their range and your shared count are
// levels; without this they never showed movement, so "61 listings" looked the same whether
// they had just added 40 lines or trimmed 40.
// ── Are we gaining on them? ─────────────────────────────────────────────
// The one question the tab exists to answer. Two rules make it honest:
//   1. Like for like. The roster went 30 -> 39 sellers in a fortnight; comparing totals
//      across that shows "growth" that is just new names being added. Only sellers present
//      on BOTH dates count.
//   2. Split earned from handed. Coverage rises either because you picked lines up, or
//      because they cut their range. Those are not the same achievement.
function renderSourcingScore(){
  const box=document.getElementById('sourcingScore'); if(!box) return;
  const dates=Object.keys(COMPETITOR_ASINS||{}).sort();
  if(dates.length<2){ box.innerHTML=''; return; }
  const tracked=new Set((SELLERS||[]).map(s=>s.sellerId).filter(Boolean));
  // Each step compared like for like: only rivals present on both fetches count, so adding a
  // rival to your list never shows up as leads you won.
  const steps=[];
  for(let i=Math.max(1,dates.length-8); i<dates.length; i++){
    const both=Object.keys(COMPETITOR_ASINS[dates[i]]||{}).filter(id=>COMPETITOR_ASINS[dates[i-1]]?.[id] && (!tracked.size||tracked.has(id)));
    // each product once, however many rivals sell it
    const on=d=>{ const s=new Set(); both.forEach(id=>((COMPETITOR_ASINS[d][id].asins)||[]).forEach(a=>s.add(a))); return s.size; };
    steps.push({date:dates[i], prev:dates[i-1], d:on(dates[i])-on(dates[i-1]), split:ldSplit(dates[i-1], dates[i])});
  }
  const net=steps.reduce((t,s)=>t+s.d,0);
  const col=v=>v>0?'var(--g)':v<0?'var(--r)':'var(--muted2)';
  const sg=v=>v>0?'▲ ':v<0?'▼ ':'→ ';
  box.innerHTML=`<div class="ld-steps">
    <div class="ld-steps-l"><b>Products you're on, fetch by fetch</b><span>last ${steps.length} fetches · net <span class="ld-chg ${net>0?'up':net<0?'down':'zero'}" style="font-size:12px;padding:2px 8px">${sg(net)}${Math.abs(net)}</span> · hover one to see why</span></div>
    <div class="ld-steps-chips">${steps.map(s=>`<span class="ld-step ${s.d>0?'up':s.d<0?'down':'flat'}"><em>${fmtShort(s.date)}</em><b>${sg(s.d)}${Math.abs(s.d)}</b>${ldStepTip(s)}</span>`).join('')}</div>
    <button class="cmp-chip" onclick="openAvgOverlapModal()" title="Keepa's own average % over time">Keepa % history ›</button>
  </div>`;
}

// The hover card on a fetch chip: the move split into what you did and what they did.
function ldStepTip(s){
  const x = s.split;
  const head = `<b>${fmt(s.date)} vs ${fmt(s.prev)} · ${s.d > 0 ? '▲' : s.d < 0 ? '▼' : '→'}${Math.abs(s.d)}</b>`;
  if (!x) return `<span class="ld-tip">${head}The split shows once the rivals' shelves have loaded.</span>`;
  const line = (n, cls, sign, txt) => n ? `<div><i class="${cls}">${sign}${n}</i>${txt}</div>` : '';
  const body = line(x.newToYou, 'g', '+', 'new to you — first time')
    + line(x.back, 'g', '+', 'you came back in stock')
    + line(x.gotOn, 'g', '+', 'you got on (new or restock)')
    + line(x.rivalsAdded, 'g', '+', 'rivals started one you sell')
    + line(x.soldOut, 'r', '−', 'you sold out / went off')
    + line(x.rivalsDropped, 'r', '−', 'rivals dropped one you sell');
  return `<span class="ld-tip">${head}${body || '<div>Nothing moved.</div>'}${x.gotOn ? '<small>Before 26 Sep your storefront wasn\'t saved, so new and restocked can\'t be told apart.</small>' : ''}</span>`;
}

function compAsinPrevFor(sellerId){
  if(!sellerId) return null;
  const dates = Object.keys(COMPETITOR_ASINS||{}).sort();
  const hits = dates.filter(d=>COMPETITOR_ASINS[d]?.[sellerId]);
  if(hits.length<2) return null;
  const d = hits[hits.length-2];
  return {rec: COMPETITOR_ASINS[d][sellerId], date: d};
}

// Same lookup, but keeps the date — Quick check needs to say what it is comparing against.
function compAsinDatedFor(sellerId){
  if(!sellerId) return null;
  const dates = Object.keys(COMPETITOR_ASINS||{}).sort();
  for(let i=dates.length-1;i>=0;i--){
    const rec = COMPETITOR_ASINS[dates[i]]?.[sellerId];
    if(rec) return {rec, date:dates[i]};
  }
  return null;
}

let COMP_SHOW_UNTRACKED = false;
function toggleUntracked(){ COMP_SHOW_UNTRACKED = !COMP_SHOW_UNTRACKED; renderCompTab(); }

// ── Leads model ─────────────────────────────────────────────────────────────────────────────
// A rival's products are leads. What matters is how many of THEIR leads you are on, and whether
// that number is going up. Up or down is decided by the count, never by the %: 19 of 95 is the
// same 20% as 20 of 100, but it is one lead fewer, and that is the one that counts.
let SHELF_NEW = {};            // sellerId -> [{asin, first_seen}] newest first: lines they added, still listed
let SHELF_LOADED = false;
let SHELF_UNIQUE_TOTAL = null;
let MY_SHELF = null;              // your own storefront rows (bdl_my_shelf)
let MY_SHELF_OPEN = null;         // 'new' | 'left' | null — which list is expanded   // different products across all rivals' shelves (needs saved shelves)
let LD_OPEN = null;            // sellerId of the row opened underneath
let SHELF_ROWS = null;         // rival shelf rows open at any point in the last few weeks
let SHELF_BY_ASIN = null;      // asin -> those rows
let SHELF_START = {};          // sellerId -> first day their shelf was saved
const SRC_DETAILS = {};        // asin -> {title, image, price, ...} from src_products
const _srcAsked = new Set();
const LD_LEAD_DAYS = 21;       // fallback only, before there are 6 fetches
const LD_LEAD_FETCHES = 6;     // Jack (14 Oct): "new leads" = what rivals added over your last 6 fetches
const ldToday = () => new Date().toLocaleDateString('en-CA');
// The first day of the new-leads window: the 6th most recent fetch (a product's first-seen date is
// the fetch that spotted it, so this covers everything added across the last 6 fetches).
function ldLeadSince(){
  const fd = Object.keys(COMPETITOR_ASINS||{}).sort();
  return fd.length ? fd[Math.max(0, fd.length - LD_LEAD_FETCHES)] : new Date(Date.now() - LD_LEAD_DAYS*864e5).toISOString().slice(0,10);
}
const LD_NOW_DAYS = 7;         // "now" = the fetches in the last 7 days…
const LD_BACK_DAYS = 14;       // …against the fetches in the week that ended 14 days before
const _ldDay = d => Date.parse(d + 'T00:00:00Z');

async function loadShelfLeads(){
  if (!window._shelfLoadRecent) return;
  const since = ldLeadSince();
  const rows = await window._shelfLoadRecent(since);
  const map = {};
  (rows||[]).forEach(r => { (map[r.seller_id] = map[r.seller_id] || []).push({ asin:r.asin, first_seen:r.first_seen }); });
  Object.values(map).forEach(a => a.sort((x,y) => y.first_seen.localeCompare(x.first_seen)));
  SHELF_NEW = map;
  // Far enough back to rebuild the fetch-by-fetch strip and both trend weeks.
  const fd = Object.keys(COMPETITOR_ASINS||{}).sort();
  const back = fd.length ? [fd[Math.max(0, fd.length-9)], _ldShift(fd[fd.length-1], -(LD_BACK_DAYS + LD_NOW_DAYS + 3))].sort()[0] : since;
  SHELF_ROWS = window._shelfLoadWindow ? await window._shelfLoadWindow(_ldShift(back, -1)) : null;
  window._shelfWindowFrom = _ldShift(back, -1);   // Comp History only splits fetches inside this window
  ldIndexShelf();
  // Today's shelves, each product once — tracked rivals only (a rival you removed is not "theirs").
  const trackedNow = new Set((SELLERS||[]).map(s => s.sellerId).filter(Boolean));
  SHELF_UNIQUE_TOTAL = SHELF_ROWS
    ? new Set(SHELF_ROWS.filter(r => !r.gone_on && (!trackedNow.size || trackedNow.has(r.seller_id))).map(r => r.asin)).size
    : null;
  MY_SHELF = window._myShelfLoad ? await window._myShelfLoad() : null;
  SHELF_LOADED = true;
  try {
    if (document.getElementById('tab-competitors')) renderCompTab();
    if (document.getElementById('tab-comp-history')?.classList.contains('active')) renderCompHistory();
    setKpiCompAvg();
    if (typeof filteredSnaps === 'function') renderCompInsights(filteredSnaps());
    if (document.getElementById('tab-daily')?.classList.contains('active') && typeof filteredSnaps === 'function') renderDailySummary(filteredSnaps());
  } catch(e) { console.error(e); }
}

// The fetch nearest to N days before `from`, within ±3 days — fetches land Mon/Wed/Fri, never
// exactly 14 days apart.
function ldNearest(dates, from, daysBack){
  const target = _ldDay(from) - daysBack*864e5;
  let best = null, gap = Infinity;
  dates.forEach(d => { if (d >= from) return; const g = Math.abs(_ldDay(d) - target); if (g <= 3*864e5 && g < gap) { gap = g; best = d; } });
  return best;
}

// ── Better or worse? ─────────────────────────────────────────────────────────────────────────
// Every fetch is counted exactly as it is — sold out = off, back in stock = on again. What the
// arrow compares is averages: the fetches in the last 7 days against the fetches in the week that
// ended 14 days earlier. Both of you sell out and restock all the time, so one fetch that happens
// to land on a sell-out day must not flip the answer (8 Oct alone read ▼14; averaged it is ▲14).
//   better = on more of their leads, and your share of their shelf held or rose
//   worse  = on fewer, and your share did not rise
//   mixed  = the two disagree — e.g. more leads, but their shelf grew faster — said in words
function ldWindows(dates){
  if (!dates.length) return null;
  const L = dates[dates.length-1], l = _ldDay(L);
  const now = dates.filter(d => _ldDay(d) > l - LD_NOW_DAYS*864e5);
  const tEnd = l - LD_BACK_DAYS*864e5, tStart = tEnd - LD_NOW_DAYS*864e5;
  let then = dates.filter(d => _ldDay(d) > tStart && _ldDay(d) <= tEnd);
  if (!then.length) { const n = ldNearest(dates, L, LD_BACK_DAYS); if (n) then = [n]; }
  return { now, then: then.length ? then : null };
}
const _ldAvg = (list, f) => list.reduce((t, d) => t + f(d), 0) / list.length;
const LD_STEADY = 2;   // within 2 leads either way over the two weeks = steady (rivals wobble 1–4 between fetches)
function ldVerdict(onThen, onNow, totThen, totNow, plural){
  const n = Math.round(onNow - onThen);
  const r1 = v => Math.round(v * 10) / 10;
  const pThen = totThen ? onThen / totThen * 100 : null, pNow = totNow ? onNow / totNow * 100 : null;
  const dp = pThen != null && pNow != null ? r1(r1(pNow) - r1(pThen)) : 0;
  // With leads unchanged, only a clear move in share (a whole point) counts as mixed.
  const pUp = n !== 0 ? dp > 0 : dp >= 1, pDown = n !== 0 ? dp < 0 : dp <= -1;
  const v = Math.abs(n) <= LD_STEADY ? 'same' : n > 0 ? (pDown ? 'mixed' : 'better') : (pUp ? 'mixed' : 'worse');
  const shelf = plural ? 'their shelves' : 'their shelf';
  const why = v !== 'mixed' ? ''
    : n > 0 ? `but ${shelf} grew faster`
    : n < 0 ? `but you hold more of ${shelf}`
    : pDown ? `no new leads while ${shelf} grew` : `same leads, ${shelf} shrank`;
  return { n, onThen, onNow, totThen, totNow, pThen, pNow, dp, v, why };
}
function ldTrendTitle(t){
  if (!t) return 'Needs two weeks of fetches';
  const f = d => fmtShort(d);
  const span = l => l.length > 1 ? `${f(l[0])}–${f(l[l.length-1])}` : f(l[0]);
  return `Average of fetches ${span(t.nowDates)} vs ${span(t.thenDates)}: on ${t.onThen.toFixed(1)} → ${t.onNow.toFixed(1)} leads`
    + (t.totThen ? ` · shelf ${Math.round(t.totThen).toLocaleString()} → ${Math.round(t.totNow).toLocaleString()}` : '')
    + (t.pThen != null ? ` · share ${t.pThen.toFixed(1)}% → ${t.pNow.toFixed(1)}%` : '');
}

// Rival shelves by product, so any recent fetch day can be rebuilt: who had what, when.
function ldIndexShelf(){
  SHELF_BY_ASIN = null; SHELF_START = {};
  if (!SHELF_ROWS) return;
  SHELF_BY_ASIN = new Map();
  for (const r of SHELF_ROWS) {
    let a = SHELF_BY_ASIN.get(r.asin); if (!a) SHELF_BY_ASIN.set(r.asin, a = []); a.push(r);
    if (!SHELF_START[r.seller_id] || r.first_seen < SHELF_START[r.seller_id]) SHELF_START[r.seller_id] = r.first_seen;
  }
}
const _ldOpenOn = (r, d) => r.first_seen <= d && (!r.gone_on || r.gone_on > d);
const ldRivalHas = (asin, d, idSet) => { const rs = SHELF_BY_ASIN && SHELF_BY_ASIN.get(asin); return !!rs && rs.some(r => idSet.has(r.seller_id) && _ldOpenOn(r, d)); };
// Different products on these rivals' shelves on day d — null before their shelves were saved.
function ldShelfUnique(d, idSet){
  if (!SHELF_ROWS) return null;
  for (const id of idSet) if (SHELF_START[id] && SHELF_START[id] > d) return null;
  const s = new Set(); for (const r of SHELF_ROWS) if (idSet.has(r.seller_id) && _ldOpenOn(r, d)) s.add(r.asin);
  return s.size;
}
// Your storefront's first-seen dates. Before the first save (26 Sep) a restock and a first-time
// product look the same, so those fetches are not split.
function ldMyFirst(){
  const first = {}; let base = null;
  (MY_SHELF||[]).forEach(r => { first[r.asin] = r.first_seen; if (!base || r.first_seen < base) base = r.first_seen; });
  return { first, base };
}
const ldIsNew = (asin, since, mf) => mf.base && since >= mf.base ? (mf.first[asin] && mf.first[asin] > since ? 'new' : 'back') : null;

// What moved between two fetches, split into what you did and what they did. Each product once,
// however many rivals sell it; only rivals read on both fetches count.
function ldSplit(P, L){
  if (!SHELF_BY_ASIN || !P || !L) return null;
  const tracked = new Set((SELLERS||[]).map(s => s.sellerId).filter(Boolean));
  const ids = Object.keys(COMPETITOR_ASINS[L]||{}).filter(id => COMPETITOR_ASINS[P]?.[id] && (!tracked.size || tracked.has(id)));
  const idSet = new Set(ids);
  const u = d => { const s = new Set(); ids.forEach(id => (COMPETITOR_ASINS[d][id].asins||[]).forEach(a => s.add(a))); return s; };
  const UP = u(P), UL = u(L), mf = ldMyFirst();
  const o = { newToYou:0, back:0, gotOn:0, rivalsAdded:0, soldOut:0, rivalsDropped:0, net: UL.size - UP.size };
  UL.forEach(a => {
    if (UP.has(a)) return;
    if (!ldRivalHas(a, P, idSet)) { o.rivalsAdded++; return; }
    const k = ldIsNew(a, P, mf); if (k === 'new') o.newToYou++; else if (k === 'back') o.back++; else o.gotOn++;
  });
  UP.forEach(a => { if (!UL.has(a)) { if (ldRivalHas(a, L, idSet)) o.soldOut++; else o.rivalsDropped++; } });
  return o;
}

function leadStats(sellerId){
  if (!sellerId) return null;
  const all = Object.keys(COMPETITOR_ASINS||{}).sort();
  const mine = all.filter(d => COMPETITOR_ASINS[d]?.[sellerId]);
  if (!mine.length) return null;
  const L = mine[mine.length-1], rec = COMPETITOR_ASINS[L][sellerId];
  const onList = rec.asins || [], on = onList.length;
  const total = rec.size != null ? rec.size : null;
  const P = mine.length > 1 ? mine[mine.length-2] : null;
  const W = ldNearest(mine, L, 14);
  const count = d => (COMPETITOR_ASINS[d][sellerId].asins || []).length;
  const onSet = new Set(onList);
  const prevSet = P ? new Set(COMPETITOR_ASINS[P][sellerId].asins || []) : null;
  const latestFetch = all[all.length-1];
  const leads = (SHELF_NEW[sellerId] || []).filter(x => !onSet.has(x.asin));
  const win = ldWindows(mine);
  let trend = null;
  if (win && win.then) {
    const tot = d => COMPETITOR_ASINS[d][sellerId].size || 0;
    trend = ldVerdict(_ldAvg(win.then, count), _ldAvg(win.now, count), _ldAvg(win.then, tot), _ldAvg(win.now, tot), false);
    trend.nowDates = win.now; trend.thenDates = win.then;
  }
  return {
    date:L, on, total, pct: total ? on/total*100 : null,
    prevDate:P, vsLast: P ? on - count(P) : null,
    w2Date:W, vs2w: trend ? trend.n : null, trend,
    toGet: total != null ? Math.max(0, total - on) : null,
    gotOn: prevSet ? onList.filter(a => !prevSet.has(a)) : [],
    // "today" means today: added on a fetch made today (none if you haven't fetched yet today)
    leads, newSinceLast: leads.filter(x => x.first_seen === ldToday()).length,
    stale: L !== latestFetch
  };
}

// Totals across tracked rivals, like for like: a rival added last week must not look like
// leads you gained.
function leadTotals(){
  const all = Object.keys(COMPETITOR_ASINS||{}).sort();
  if (!all.length) return null;
  const L = all[all.length-1];
  const tracked = new Set((SELLERS||[]).map(s => s.sellerId).filter(Boolean));
  const ids = Object.keys(COMPETITOR_ASINS[L]).filter(id => !tracked.size || tracked.has(id));
  const sum = (d, list) => list.reduce((t, id) => { const r = COMPETITOR_ASINS[d][id]; return { on:t.on + (r.asins||[]).length, total:t.total + (r.size||0) }; }, { on:0, total:0 });
  const cur = sum(L, ids);
  const change = d => { if (!d) return null; const both = ids.filter(id => COMPETITOR_ASINS[d]?.[id]); return both.length ? sum(L, both).on - sum(d, both).on : null; };
  const P = all.length > 1 ? all[all.length-2] : null, W = ldNearest(all, L, 14);
  // Unique: a product five rivals sell is one lead you're on, not five.
  const uni = (d, list) => { const s = new Set(); list.forEach(id => (COMPETITOR_ASINS[d][id].asins || []).forEach(a => s.add(a))); return s.size; };
  const uChange = d => { if (!d) return null; const both = ids.filter(id => COMPETITOR_ASINS[d]?.[id]); return both.length ? uni(L, both) - uni(d, both) : null; };
  const snap = [...(DB||[])].filter(x => x.asins).sort((a,b) => a.date.localeCompare(b.date)).pop();
  const uOn = uni(L, ids);
  // The trend: only rivals read on every fetch in both weeks, so adding or removing a rival never
  // looks like leads won or lost. Their side counted once per product, from the saved shelves.
  const win = ldWindows(all);
  let trend = null;
  if (win && win.then) {
    const span = [...win.then, ...win.now];
    const lfl = ids.filter(id => span.every(d => COMPETITOR_ASINS[d]?.[id]));
    if (lfl.length) {
      const idSet = new Set(lfl);
      const shelfAvg = list => { const v = list.map(d => ldShelfUnique(d, idSet)).filter(x => x != null); return v.length ? v.reduce((a,b) => a+b, 0) / v.length : null; };
      let tThen = shelfAvg(win.then), tNow = shelfAvg(win.now);
      if (tThen == null || tNow == null) { const sz = d => lfl.reduce((t, id) => t + (COMPETITOR_ASINS[d][id].size || 0), 0); tThen = _ldAvg(win.then, sz); tNow = _ldAvg(win.now, sz); }
      trend = ldVerdict(_ldAvg(win.then, d => uni(d, lfl)), _ldAvg(win.now, d => uni(d, lfl)), tThen, tNow, true);
      trend.nowDates = win.now; trend.thenDates = win.then; trend.rivals = lfl.length;
    }
  }
  return { date:L, rivals:ids.length, on:cur.on, total:cur.total, pct: cur.total ? cur.on/cur.total*100 : null,
           prevDate:P, vsLast:change(P), w2Date:W, vs2w:change(W),
           uOn, uVsLast:uChange(P), uVs2w: trend ? trend.n : null, trend,
           uTotal: SHELF_UNIQUE_TOTAL, myAsins: ldMyCount() || (snap ? snap.asins : null) };
}

const ldChange = (v, unit=true) => {
  if (v == null) return '<span class="ld-chg na" title="Nothing to compare with yet">—</span>';
  if (v === 0) return '<span class="ld-chg zero">no change</span>';
  const cls = v > 0 ? 'up' : v < 0 ? 'down' : 'same';
  const arrow = v > 0 ? '▲' : v < 0 ? '▼' : '→';
  const n = Math.abs(v);
  return `<span class="ld-chg ${cls}">${arrow} ${n.toLocaleString()}${unit ? ` <small>${n === 1 ? 'lead' : 'leads'}</small>` : ''}</span>`;
};
// The verdict as a chip: arrow + leads, coloured by better / worse / mixed / same.
const LD_VCLS = { better:'up', worse:'down', mixed:'mixed', same:'same' };
const ldTrendChip = t => {
  if (!t) return '<span class="ld-chg na" title="Needs two weeks of fetches">—</span>';
  const a = Math.abs(t.n), arrow = t.n > 0 ? '▲' : t.n < 0 ? '▼' : '→';
  if (t.v === 'same') return `<span class="ld-chg same" title="${kfEsc(ldTrendTitle(t))} — within ${LD_STEADY} leads either way counts as steady">● steady${t.n ? ` <small>${t.n > 0 ? '+' : '−'}${a}</small>` : ''}</span>`;
  return `<span class="ld-chg ${LD_VCLS[t.v]}" title="${kfEsc(ldTrendTitle(t))}">${`${arrow} ${a.toLocaleString()} <small>${a === 1 ? 'lead' : 'leads'}</small>`}</span>`;
};
// One short line under the chip: why it's mixed, or how your share moved.
const ldTrendWhy = t => !t ? '' : t.v === 'mixed' ? t.why
  : t.pThen != null ? `share ${t.pThen.toFixed(1)}% → ${t.pNow.toFixed(1)}%` : '';
// Products on your storefront now (the Keepa list), before falling back to Sarah's inventory count.
function ldMyCount(){
  if (!MY_SHELF || !MY_SHELF.length) return null;
  return window._myShelfHasOn ? MY_SHELF.filter(r => r.on_now).length : null;
}
function ldEnsureDetails(asins){
  const need = asins.filter(a => !_srcAsked.has(a));
  if (!need.length || !window._srcDetails) return;
  need.forEach(a => _srcAsked.add(a));
  window._srcDetails(need).then(got => { Object.assign(SRC_DETAILS, got); if (LD_OPEN) renderCompTab(); });
}
// A product line: picture, name, facts — falls back to the bare ASIN until details exist.
const ldItem = (asin, right, cls) => {
  const p = SRC_DETAILS[asin];
  const img = p && p.image ? `<img class="ld-img" src="${kfEsc(p.image)}" alt="" loading="lazy">` : '<span class="ld-img none"></span>';
  const facts = p ? [p.price != null ? '£' + Number(p.price).toFixed(2) : '', p.rank ? 'rank ' + Number(p.rank).toLocaleString() : '', p.mo ? Number(p.mo).toLocaleString() + '+ sold/mo' : ''].filter(Boolean) : [];
  const asinTag = `<span class="ld-asin${cls ? ' ' + cls : ''}">${kfEsc(asin)}</span>`;
  return `<li class="ld-li">${img}<div class="ld-li-mid">
      <div class="ld-li-title">${p && p.title ? kfEsc(p.title) : asinTag}</div>
      <div class="ld-li-sub">${p && p.title ? asinTag : 'no details saved yet'}${p && p.brand ? ` · ${kfEsc(p.brand)}` : ''}${facts.length ? ` · ${facts.join(' · ')}` : ''}</div></div>
    <span class="ld-links"><a href="https://www.amazon.co.uk/dp/${encodeURIComponent(asin)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Amazon ↗</a><a href="https://keepa.com/#!product/2-${encodeURIComponent(asin)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Keepa ↗</a><a href="https://sas.selleramp.com/sas/lookup?SasLookup%5Bsearch_term%5D=${encodeURIComponent(asin)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">SAS ↗</a></span>${right}</li>`;
};

// Calendar days, not hours — a line from yesterday afternoon is "yesterday", not "2 days ago".
// A product's first-seen date is the fetch that spotted it. After a gap (no fetch 15–21 Oct) that fetch
// holds a week of additions, so "added today" would claim too much — say the span instead.
function ldPrevFetch(d){ const fd = Object.keys(COMPETITOR_ASINS||{}).sort().filter(x => x < d); return fd.length ? fd[fd.length-1] : null; }
const ldGapDays = d => { const p = ldPrevFetch(d); return p ? Math.round((_ldDay(d) - _ldDay(p)) / 864e5) : 0; };
const ldAgo = d => { if (ldGapDays(d) > 3) { const p = ldPrevFetch(d); return `added ${fmtShort(_ldShift(p, 1))}–${fmtShort(d)}`; } return ldAgoDay(d); };
const ldAgoDay = d => { const n = Math.round((_ldDay(new Date().toLocaleDateString('en-CA')) - _ldDay(d)) / 864e5); return n <= 0 ? 'added today' : n === 1 ? 'added yesterday' : `added ${n} days ago`; };

// A steady colour per rival so the eye can find them again — same name, same colour, every time.
const ldHue = s => { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };
const _ldShift = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const ldAvatar = (name, fixed) => {
  const h = ldHue(name), letters = fixed || String(name).replace(/[^A-Za-z0-9 ]/g,'').split(/\s+/).filter(Boolean).slice(0,2).map(w => w[0].toUpperCase()).join('') || '?';
  return `<span class="ld-av" style="background:hsla(${h},75%,55%,.16);color:hsl(${h},85%,72%);border-color:hsla(${h},75%,60%,.35)">${letters}</span>`;
};
// How much of their shelf you're on: amber = barely started, blue = getting there, green = strong.
const ldBand = pct => pct == null ? 'var(--muted)' : pct >= 20 ? 'var(--g)' : pct >= 12 ? '#2dd4bf' : pct >= 6 ? 'var(--b)' : 'var(--y)';

// Your storefront, on its own strip — never a row in the rival table, where it would read as
// a rival covering 100% of you and pull every average.
function renderMyShelf(){
  const el = document.getElementById('myShelf'); if (!el) return;
  if (window._hasMyShelf === false) {
    el.innerHTML = `<div class="ms-strip muted">${ldAvatar('Lavarion','LV')}<div class="ms-who"><b>Your storefront</b><span>Not being saved yet — run the "my storefront" SQL in Supabase, then fetch.</span></div></div>`;
    return;
  }
  const rows = MY_SHELF || [];
  if (!rows.length) {
    el.innerHTML = MY_SHELF ? `<div class="ms-strip muted">${ldAvatar('Lavarion','LV')}<div class="ms-who"><b>Your storefront</b><span>Saved from your next Keepa fetch.</span></div></div>` : '';
    return;
  }
  const dates = [...new Set(rows.map(r => r.listed_on))].sort();
  const L = dates[dates.length-1], P = dates.length > 1 ? dates[dates.length-2] : null;
  // Only one question per product: are you on it now? It flips as you go in and out of stock.
  const hasOn = window._myShelfHasOn;
  const onNow = hasOn ? rows.filter(r => r.on_now) : rows.filter(r => r.last_seen >= _ldShift(L, -4));
  const fresh = hasOn ? rows.filter(r => r.on_now && r.on_changed === L) : [];
  const left  = hasOn ? rows.filter(r => !r.on_now && r.on_changed === L) : [];
  const chip = (key, n, cls, label) => n
    ? `<button class="ms-chip ${cls}${MY_SHELF_OPEN===key?' on':''}" onclick="MY_SHELF_OPEN=MY_SHELF_OPEN==='${key}'?null:'${key}';renderMyShelf()">${label}</button>`
    : `<span class="ms-chip ${cls} none">${label}</span>`;
  const list = MY_SHELF_OPEN === 'new' ? fresh : MY_SHELF_OPEN === 'left' ? left : null;
  el.innerHTML = `<div class="ms-strip">
      ${ldAvatar('Lavarion','LV')}
      <div class="ms-who"><b>Your storefront</b><span>Lavarion · checked ${fmt(L)}</span></div>
      <div class="ms-big">${onNow.length.toLocaleString()}<small>products you're on now</small></div>
      <div class="ms-chips">
        ${hasOn ? chip('new', fresh.length, 'up', `▲ ${fresh.length} on`) + chip('left', left.length, 'down', `▼ ${left.length} off`)
                : `<span class="ms-chip none">run the "on-now" SQL to see on / off</span>`}
      </div>
    </div>
    ${list ? `<div class="ms-list"><div class="ms-list-hd">${MY_SHELF_OPEN === 'new' ? `You're on these now — you weren't at the fetch before ${fmt(L)}` : `You were on these before, not at the ${fmt(L)} fetch`}</div>
      <ul class="ld-list">${list.map(r => `<li><span class="ld-asin">${kfEsc(r.asin)}</span><a href="https://www.amazon.co.uk/dp/${encodeURIComponent(r.asin)}" target="_blank" rel="noopener">Open on Amazon ↗</a><span class="ld-when">Keepa last saw you ${fmt(r.last_seen)}</span></li>`).join('')}</ul></div>` : ''}`;
}
window.renderMyShelf = renderMyShelf;

function toggleLeadRow(id){ LD_OPEN = LD_OPEN === id ? null : id; renderCompTab(); }
window.toggleLeadRow = toggleLeadRow;

function renderCompTab() {
  const search = (document.getElementById('compSearch')?.value || '').toLowerCase().trim();
  const tbody = document.getElementById('compTableBody');
  const meta = document.getElementById('compMeta');
  if (!tbody) return;

  const sessionsSorted = [...COMPETITOR_SESSIONS].sort((a,b) => a.date.localeCompare(b.date));
  const nameById = {}, keepaById = {};
  sessionsSorted.forEach(ses => (ses.competitors||[]).forEach(c => {
    if (!c.sellerId) return;
    nameById[c.sellerId] = c.name.trim();
    keepaById[c.sellerId] = { pct:c.pct, date:ses.date };
  }));
  (SELLERS||[]).forEach(s => { if (s.sellerId) nameById[s.sellerId] = s.name; });

  // Banners: rivals missed by the latest fetch, and rivals never fetched at all.
  const newestDate = sessionsSorted.length ? sessionsSorted[sessionsSorted.length-1].date : null;
  const inNewest = new Set(((sessionsSorted[sessionsSorted.length-1]||{}).competitors||[]).map(c => c.sellerId).filter(Boolean));
  const staleNames = newestDate ? (SELLERS||[]).filter(x => x.sellerId && !inNewest.has(x.sellerId) && keepaById[x.sellerId]).map(x => x.name) : [];
  const staleEl = document.getElementById('compFetchGap');
  if (staleEl) {
    if (staleNames.length) {
      staleEl.style.display = '';
      staleEl.innerHTML = `<span><b>${staleNames.length}</b> rival${staleNames.length!==1?'s were':' was'} not covered by the ${fmt(newestDate)} fetch — showing older numbers: ${staleNames.slice(0,8).map(kfEsc).join(', ')}${staleNames.length>8?`, +${staleNames.length-8} more`:''}</span><button class="cmp-chip" onclick="openKeepaFetch()">Fetch again</button>`;
    } else staleEl.style.display = 'none';
  }
  const pending = (SELLERS||[]).filter(x => x.sellerId && !keepaById[x.sellerId] && !leadStats(x.sellerId));
  const pendEl = document.getElementById('compPending');
  if (pendEl) {
    if (pending.length) {
      pendEl.style.display = '';
      pendEl.innerHTML = `<span><b>${pending.length}</b> waiting for their first fetch: ${pending.map(x => kfEsc(x.name)).join(', ')}</span><button class="cmp-chip" onclick="openKeepaFetch()">Fetch now</button>`;
    } else pendEl.style.display = 'none';
  }

  // Who is in the table: your list, plus anyone no longer on it when asked for.
  const tracked = (SELLERS||[]).filter(s => s.sellerId).map(s => s.sellerId);
  const trackedSet = new Set(tracked);
  const latestAsinDate = Object.keys(COMPETITOR_ASINS||{}).sort().pop();
  const untracked = [...new Set([...Object.keys((latestAsinDate && COMPETITOR_ASINS[latestAsinDate]) || {}), ...Object.keys(keepaById)])]
    .filter(id => trackedSet.size && !trackedSet.has(id));
  const untrackedChip = document.getElementById('cfUntracked');
  if (untrackedChip) {
    untrackedChip.style.display = untracked.length || COMP_SHOW_UNTRACKED ? '' : 'none';
    untrackedChip.classList.toggle('on', COMP_SHOW_UNTRACKED);
    untrackedChip.textContent = COMP_SHOW_UNTRACKED ? `Hide ${untracked.length} untracked` : `+ ${untracked.length} untracked`;
  }
  const ids = COMP_SHOW_UNTRACKED ? [...tracked, ...untracked] : tracked;

  let rows = ids.map(id => ({ id, name: nameById[id] || id, keepa: keepaById[id] || null, st: leadStats(id) }));

  // ── Summary tiles ──
  const T = leadTotals();
  const withSt = rows.filter(r => r.st && trackedSet.has(r.id));
  const byV = v => withSt.filter(r => r.st.trend && r.st.trend.v === v);
  const better2 = byV('better'), worse2 = byV('worse'), mixed2 = byV('mixed'), same2 = byV('same');
  const card = (key, label, valueHtml, subHtml) => {
    const v = document.getElementById('compKpi'+key), p = document.getElementById('compKpi'+key+'Pill'), s = document.getElementById('compKpi'+key+'Sub');
    const l = document.getElementById('compKpi'+key+'Label');
    if (l) l.textContent = label;
    if (v) v.innerHTML = valueHtml;
    if (p) p.innerHTML = '';
    if (s) s.innerHTML = subHtml;
  };
  if (T) {
    const ofTxt = T.uTotal ? `of ${T.uTotal.toLocaleString()} different products they sell · ${(T.uOn/T.uTotal*100).toFixed(1)}%`
      : T.myAsins ? `${Math.round(T.uOn/T.myAsins*100)}% of your ${T.myAsins.toLocaleString()} ASINs` : `across ${T.rivals} rivals`;
    const tr = T.trend;
    card('Highest', "Their leads you're on", `${T.uOn.toLocaleString()}<span class="ld-tile-unit">products</span>`,
      `${ofTxt}<div class="ld-tile-rows"><span>2 weeks ${ldTrendChip(tr)}</span></div>${tr && tr.v === 'mixed' ? `<div class="ld-tile-why">${tr.why}</div>` : ''}`);
    const hiTile = document.getElementById('compKpiHighest')?.closest('.kpi-tile');
    if (hiTile) { hiTile.classList.remove('ct-green','ct-red','ct-orange','ct-grey'); hiTile.classList.add(!tr ? 'ct-green' : { better:'ct-green', worse:'ct-red', mixed:'ct-orange', same:'ct-grey' }[tr.v]); hiTile.title = ldTrendTitle(tr); }
    const anyT = withSt.some(r => r.st.trend);
    const segN = [['better', better2.length, 'var(--g)'], ['steady', same2.length, 'var(--b)'], ['mixed', mixed2.length, 'var(--o)'], ['worse', worse2.length, 'var(--r)']];
    card('Avg', 'Rivals · 2 weeks', anyT
      ? `<div class="cp-seg">${segN.filter(x => x[1]).map(x => `<i style="flex:${x[1]};background:${x[2]}" title="${x[1]} ${x[0]}"></i>`).join('')}</div>`
      : '—', anyT ? `<div class="cp-segl">${segN.map(x => `<span onclick="event.stopPropagation();setCompFilter('${{better:'closing',steady:'same',mixed:'mixed',worse:'backing'}[x[0]]}')"><b style="color:${x[2]}">${x[1]}</b> ${x[0]}</span>`).join('')}</div>` : 'needs 2 weeks of fetches');
    const byGain = [...withSt].filter(r => r.st.vs2w != null).sort((a,b) => b.st.vs2w - a.st.vs2w);
    const g = byGain[0], d = byGain[byGain.length-1];
    const shr = t => t && t.pThen != null ? ` · share ${t.pThen.toFixed(1)}% → ${t.pNow.toFixed(1)}%` : '';
    card('Riser', 'Biggest gain · 2 weeks', g && g.st.vs2w > 0 ? `<span style="color:var(--g)">+${g.st.vs2w}</span><span class="ld-tile-unit">leads</span>` : '<span style="color:var(--muted)">nobody</span>',
      g && g.st.vs2w > 0 ? `<b style="color:var(--text)">${kfEsc(g.name)}</b>${shr(g.st.trend)}` : 'no rival gained');
    card('Dropper', 'Biggest drop · 2 weeks', d && d.st.vs2w < 0 ? `<span style="color:var(--r)">${d.st.vs2w}</span><span class="ld-tile-unit">leads</span>` : '<span style="color:var(--muted)">nobody</span>',
      d && d.st.vs2w < 0 ? `<b style="color:var(--text)">${kfEsc(d.name)}</b>${shr(d.st.trend)}` : 'no rival dropped');
    const riserTile = document.getElementById('compKpiRiser')?.closest('.kpi-tile');
    if (riserTile) riserTile.onclick = g && g.st.vs2w > 0 ? () => { LD_OPEN = g.id; renderCompTab(); } : null;
    const dropTile = document.getElementById('compKpiDropper')?.closest('.kpi-tile');
    if (dropTile) dropTile.onclick = d && d.st.vs2w < 0 ? () => { LD_OPEN = d.id; renderCompTab(); } : null;
  } else {
    card('Highest', "Their leads you're on", '—', 'no fetch yet');
    card('Avg', 'Over 2 weeks you are', '—', 'no fetch yet');
    card('Riser', 'Biggest gain · 2 weeks', '—', '');
    card('Dropper', 'Biggest drop · 2 weeks', '—', '');
  }
  // Each product once — two rivals adding the same line is one lead, not two.
  const latestF = Object.keys(COMPETITOR_ASINS||{}).sort().pop();
  const fetchedToday = latestF === ldToday();
  const newLeadsTotal = new Set(withSt.flatMap(r => r.st.leads.filter(x => x.first_seen === ldToday()).map(x => x.asin))).size;
  card('Momentum', 'New leads · today',
    window._hasShelfTable === false ? '—' : `<span style="color:var(--p)">${newLeadsTotal.toLocaleString()}</span>`,
    window._hasShelfTable === false ? 'run the SQL to start' : !window._shelfRowCount ? 'starts after your next fetch' : fetchedToday ? (ldGapDays(latestF) > 3 ? `today's fetch covers ${ldGapDays(latestF)} days (since ${fmt(ldPrevFetch(latestF))}) · you're not on them` : "added by rivals today · you're not on them") : 'no fetch yet today');

  renderCompHero(T);
  renderSourcingScore();
  renderMyShelf();
  renderBadges();

  // ── Search, filter, sort ──
  if (search) rows = rows.filter(r => r.name.toLowerCase().includes(search) || r.id.toLowerCase().includes(search));
  if (compFilter === 'closing')      rows = rows.filter(r => r.st && r.st.trend && r.st.trend.v === 'better');
  else if (compFilter === 'mixed')   rows = rows.filter(r => r.st && r.st.trend && r.st.trend.v === 'mixed');
  else if (compFilter === 'same')    rows = rows.filter(r => r.st && r.st.trend && r.st.trend.v === 'same');
  else if (compFilter === 'backing') rows = rows.filter(r => r.st && r.st.trend && r.st.trend.v === 'worse');
  else if (compFilter === 'threat')  rows = rows.filter(r => r.st && r.st.leads.length);
  ['all','closing','mixed','same','backing','threat'].forEach(f => document.getElementById('cf-'+f)?.classList.toggle('on', compFilter === f));

  const key = {
    name:   r => r.name.toLowerCase(),
    on:     r => r.st ? r.st.on : -Infinity,
    pct:    r => r.st && r.st.pct != null ? r.st.pct : -Infinity,
    vs2w:   r => r.st && r.st.vs2w != null ? r.st.vs2w : -Infinity,
    toget:  r => r.st && r.st.toGet != null ? r.st.toGet : -Infinity,
    leads:  r => r.st ? r.st.leads.length : -Infinity
  }[compSort] || (r => r.st && r.st.pct != null ? r.st.pct : -Infinity);
  rows.sort((a, b) => {
    // rivals with no shelf data yet always sit at the bottom
    if (!!a.st !== !!b.st) return a.st ? -1 : 1;
    const x = key(a), y = key(b);
    if (typeof x === 'string') return x.localeCompare(y) * compSortDir;
    return ((y - x) * compSortDir) || a.name.localeCompare(b.name);
  });

  const head = document.getElementById('compHead');
  if (head) {
    head.classList.remove('cmp-grid-full','cmp-grid-lean'); head.classList.add('ld-grid');
    head.querySelectorAll('span').forEach(h => h.classList.toggle('act', h.dataset.sort === compSort));
  }
  renderCompStale();
  renderContested();
  // the header said 14/10 after a 22/10 fetch — it only refreshed on a page switch
  if (typeof updateLastUpdated === 'function') updateLastUpdated();

  if (meta) meta.textContent = search ? `${rows.length} matching` : `${rows.length} rivals`;
  const shelfLive = window._hasShelfTable !== false && window._shelfRowCount > 0;
  const keyEl = document.getElementById('ldKey');
  if (keyEl) keyEl.innerHTML = `
    <span class="ld-key"><i style="background:var(--b)"></i><b>You're on</b> how many of their products you also sell</span>
    <span class="ld-key"><i style="background:var(--g)"></i><b>2-week trend</b> <span style="color:var(--g)">better</span> · <span style="color:var(--o)">mixed</span> · <span style="color:var(--r)">worse</span> — last week's fetches vs two weeks before</span>
    <span class="ld-key"><i style="background:var(--y)"></i><b>Still to get</b> their products you don't sell yet</span>
    <span class="ld-key"><i style="background:var(--p)"></i><b>New leads</b> products they added over your last ${LD_LEAD_FETCHES} fetches (since ${fmtShort(ldLeadSince())}) that you don't sell · <b>today</b> = added on today's fetch${shelfLive ? '' : ' <em>— starts after your next fetch</em>'}</span>`;
  if (!rows.length) {
    tbody.innerHTML = search
      ? `<div class="cmp-empty">No rival matches “${kfEsc(search)}”.</div>`
      : compFilter !== 'all'
      ? `<div class="cmp-empty">Nobody fits that filter right now.<br><button class="cmp-chip" style="margin-top:10px" onclick="setCompFilter('all')">Show all</button></div>`
      : '<div class="cmp-empty">No rivals yet.<br>Use ⚙ Manage competitors to add them, then ⬇ Fetch from Keepa.</div>';
    return;
  }

  const latestFetch = Object.keys(COMPETITOR_ASINS||{}).sort().pop();
  const gapDays = latestFetch ? ldGapDays(latestFetch) : 0;
  tbody.innerHTML = rows.map((r, i) => {
    const s = r.st, open = LD_OPEN === r.id;
    const idArg = r.id.replace(/'/g, "\\'");
    const subLine = !s ? 'waiting for the first fetch'
      : s.stale ? `<span style="color:var(--o)">⚠ not in the latest fetch · last read ${fmt(s.date)}</span>`
      : kfEsc(r.id);
    const band = ldBand(s && s.pct);
    const onCell = !s ? '<span class="ld-dim">—</span>' : `
      <div class="ld-on-top"><span class="ld-count">${s.on.toLocaleString()} <span>of ${s.total != null ? s.total.toLocaleString() : '—'}</span></span><span class="ld-pct" style="color:${band}">${s.pct != null ? s.pct.toFixed(1)+'%' : ''}</span></div>
      <div class="ld-bar"><i style="width:${Math.max(2, Math.min(100, (s.pct || 0) / 40 * 100))}%;background:${band}"></i></div>`;
    const leadsCell = !s ? '<span class="ld-dim">—</span>'
      : window._hasShelfTable === false || !window._shelfRowCount ? '<span class="ld-soon" title="Starts after your next fetch">soon</span>'
      : s.leads.length ? `<span class="ld-leads">${s.leads.length}</span>${s.newSinceLast ? `<span class="ld-new" title="${gapDays > 3 ? `Spotted on today's fetch — the first since ${fmt(ldPrevFetch(latestFetch))}, so it covers ${gapDays} days` : "Spotted on today's fetch"}">${s.newSinceLast} ${gapDays > 3 ? `in ${gapDays} days` : 'today'}</span>` : ''}`
      : '<span class="ld-zero">0</span>';

    let detail = '';
    if (open) {
      const leadBody = window._hasShelfTable === false
        ? `<p class="ld-empty">Rival shelves aren't being saved yet. Run the SQL file in Supabase, then fetch.</p>`
        : !window._shelfRowCount
        ? `<div class="ld-howto">
             <div class="ld-step-n done">✓</div><div><b>Set up</b><span>Their shelf is ready to be saved.</span></div>
             <div class="ld-step-n">1</div><div><b>Your next fetch</b><span>Records everything on their shelf right now.</span></div>
             <div class="ld-step-n">2</div><div><b>The fetch after</b><span>Anything they've added since shows up here — products you don't sell yet.</span></div>
           </div>`
        : !s || !s.leads.length
        ? `<p class="ld-empty">Nothing new from them over your last ${LD_LEAD_FETCHES} fetches that you're not already on.</p>`
        : `<ul class="ld-list">${s.leads.map(x => ldItem(x.asin, `<span class="ld-when${x.first_seen === ldToday() ? ' fresh' : ''}">${ldAgo(x.first_seen)}</span>`)).join('')}</ul>
           <div class="ld-warn">⚠ Keepa can't see stock you've bought that isn't live yet — check it isn't already on its way in.</div>`;
      const got = s ? s.gotOn : [];
      if (s) ldEnsureDetails([...s.leads.map(x => x.asin), ...got]);
      const mf = ldMyFirst();
      const tag = a => { const k = s && s.prevDate ? ldIsNew(a, s.prevDate, mf) : null;
        return k === 'new' ? '<span class="ld-tag new" title="First time on your storefront">NEW</span>' : k === 'back' ? '<span class="ld-tag back" title="You had it before — back in stock">BACK</span>' : `<span class="ld-when">${fmtShort(s.date)}</span>`; };
      const gotBody = !s || !s.prevDate
        ? `<p class="ld-empty">Needs two fetches to compare.</p>`
        : !got.length
        ? `<p class="ld-empty">None of their leads went live on your storefront since ${fmt(s.prevDate)}.</p>`
        : `<ul class="ld-list tight">${got.map(a => ldItem(a, tag(a), 'got')).join('')}</ul>`;
      detail = `<div class="ld-detail" onclick="event.stopPropagation()">
        <div class="ld-box leads">
          <div class="ld-box-hd"><div><h3>New ${kfEsc(r.name)} leads you're not on</h3><p>Added to their shelf over your last ${LD_LEAD_FETCHES} fetches (since ${fmt(ldLeadSince())}). Newest first.</p></div>
            ${s && window._shelfRowCount ? `<div class="ld-box-n" style="color:var(--p)">${s.leads.length}</div>` : ''}</div>
          ${leadBody}
        </div>
        <div class="ld-box">
          <div class="ld-box-hd"><div><h3 style="color:var(--g)">You got on this fetch</h3><p>${s && s.prevDate ? `Their leads that went live on your storefront since ${fmt(s.prevDate)}.` : 'Their leads that went live on your storefront.'}</p></div>
            <div class="ld-box-n" style="color:var(--g)">${s && s.prevDate ? got.length : '—'}</div></div>
          ${gotBody}
          <div class="ld-keepa">Keepa's own figure: <b>${r.keepa ? r.keepa.pct + '%' : '—'}</b>${r.keepa ? ` · ${fmt(r.keepa.date)}` : ''}
            ${r.keepa ? `<button class="cmp-chip" onclick="openCompetitorDetail('${kfEsc(r.keepa && nameOfReading(r.id)).replace(/'/g,"\\'")}')">Keepa % history ›</button>` : ''}</div>
        </div>
      </div>`;
    }

    const dir = !s || !s.trend ? 'none' : LD_VCLS[s.trend.v];
    return `<div class="ld-row ld-grid dir-${dir}${open ? ' open' : ''}" onclick="toggleLeadRow('${idArg}')">
      <div class="ld-rank">${i+1}</div>
      <div class="ld-who">${ldAvatar(r.name)}<div style="min-width:0"><div class="ld-name">${kfEsc(r.name)}</div><div class="ld-sub">${subLine}</div></div></div>
      <div class="ld-oncell">${onCell}</div>
      <div class="ld-sparkc">${s ? ldSpark(r.id, { better:'#00f5a0', worse:'#ff4d6d', mixed:'#ff8c42', same:'#3d9eff' }[s.trend ? s.trend.v : 'same']) : ''}</div>
      <div class="ld-r">${s ? `${ldTrendChip(s.trend)}${s.trend ? `<div class="ld-why ${s.trend.v}">${ldTrendWhy(s.trend)}</div>` : ''}` : '<span class="ld-dim">—</span>'}</div>
      <div class="ld-r"><span class="ld-num togo">${s && s.toGet != null ? s.toGet.toLocaleString() : '—'}</span></div>
      <div class="ld-r">${leadsCell}</div>
      <div class="ld-caret">${open ? '⌄' : '›'}</div>
    </div>${detail}`;
  }).join('');
}

// The name a seller's readings are stored under — the history popup looks readings up by name.
function nameOfReading(id){
  let nm = '';
  COMPETITOR_SESSIONS.forEach(s => (s.competitors||[]).forEach(c => { if (c.sellerId === id) nm = c.name.trim(); }));
  return nm;
}

function highlightCompetitor(sellerName) {
  highlightedSeller = highlightedSeller === sellerName ? null : sellerName;
  const snaps = filteredSnaps();
}

let _compDetailAllPts = []; // all-time pts for currently-open competitor
let _compDetailPeak = 0, _compDetailLow = 0;

function openCompetitorDetail(name){
  const sessions = [...COMPETITOR_SESSIONS].sort((a,b)=>a.date.localeCompare(b.date));
  const pts = [];
  sessions.forEach(sess=>{
    const c=(sess.competitors||[]).find(c=>c.name.trim()===name);
    if (c) pts.push({ date:sess.date, pct:+(c.pct||0) });
  });
  if (!pts.length) return;

  _compDetailAllPts = pts;
  const sellerId = (sessions.flatMap(s=>s.competitors||[]).find(c=>c.name.trim()===name)||{}).sellerId||'';
  const latest = pts[pts.length-1].pct;
  const prev   = pts.length>1 ? pts[pts.length-2].pct : null;
  const diff   = prev!=null ? +(latest-prev).toFixed(1) : null;
  const pcts   = pts.map(p=>p.pct);
  _compDetailPeak = Math.max(...pcts);
  _compDetailLow  = Math.min(...pcts);
  const peak = _compDetailPeak, low = _compDetailLow;
  const peakDate = pts[pcts.indexOf(peak)]?.date;
  const lowDate  = pts[pcts.indexOf(low)]?.date;
  const net    = pts.length>=2 ? +(pcts[pcts.length-1]-pcts[0]).toFixed(1) : null;
  const avg    = +(pcts.reduce((a,b)=>a+b,0)/pcts.length).toFixed(1);
  const last3  = pcts.slice(-3);
  const trend3 = last3.length>=2 ? +(last3[last3.length-1]-last3[0]).toFixed(1) : null;

  let streak=0;
  for(let i=pcts.length-1;i>=1;i--){
    const d=pcts[i]-pcts[i-1];
    if(i===pcts.length-1) streak=d>0.1?1:d<-0.1?-1:0;
    else if((streak>0&&d>0.1)||(streak<0&&d<-0.1)) streak+=streak>0?1:-1;
    else break;
  }

  const diffCol  = diff==null?NEUT:diff>0?'#00f5a0':diff<0?'#ff4d6d':NEUT;
  const diffStr  = diff==null?'—':(diff>0?'▲ +':'▼ ')+Math.abs(diff)+'pp vs last';
  // Coverage of their range: more is better. Identical ramp to the Competitors table.
  const coverCol = latest>=25?'#00f5a0':latest>=15?'#7bd88f':latest>=7?'#ca8a04':'#ff8c42';

  let verdict='';
  if(pts.length<2) verdict='First reading — baseline set.';
  else if(streak>=3) verdict=`↑ Rising ${streak} sessions in a row.`;
  else if(streak<=-3) verdict=`↓ Falling ${Math.abs(streak)} sessions in a row.`;
  else if(diff!=null&&diff>5) verdict=`Large jump this entry (+${diff}pp) — watch next session.`;
  else if(diff!=null&&diff<-5) verdict=`Sharp drop this entry (${diff}pp) — confirm next session.`;
  else if(trend3!=null&&trend3>2) verdict=`Gradual climb over last 3 (+${trend3}pp).`;
  else if(trend3!=null&&trend3<-2) verdict=`Gradual decline over last 3 (${trend3}pp).`;
  else if(diff!=null&&Math.abs(diff)<=0.5) verdict='Flat this session — no meaningful movement.';
  else verdict='Mixed movement — no clear trend yet.';

  document.getElementById('compDetailTitle').textContent = name;
  document.getElementById('compDetailSub').textContent   = sellerId ? `Seller ID: ${sellerId}` : '';

  const card=(label,val,sub,col)=>`
    <div style="background:var(--s1);border:1px solid var(--border);border-top:3px solid ${col};border-radius:12px;padding:14px 16px">
      <div style="font-family:var(--mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:${col};margin-bottom:6px">${label}</div>
      <div style="font-family:var(--mono);font-size:26px;font-weight:700;color:var(--text);line-height:1">${val}</div>
      <div style="font-family:var(--mono);font-size:10px;color:var(--muted2);margin-top:6px">${sub}</div>
    </div>`;

  const statGrid=`<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px">
    ${card('Your coverage of them', latest.toFixed(1)+'%', diffStr, coverCol)}
    ${card('Best ever', peak.toFixed(1)+'%', fmt(peakDate), '#00f5a0')}
    ${card('Lowest ever', low.toFixed(1)+'%', fmt(lowDate), '#ff4d6d')}
    ${card('All-time avg', avg.toFixed(1)+'%', `${pts.length} session${pts.length!==1?'s':''}`, NEUT)}
  </div>
  ${(peak!==low) ? `<div style="font-family:var(--mono);font-size:11px;color:var(--muted2);margin:-6px 0 14px;padding:9px 13px;
    background:var(--s2);border:1px solid var(--border);border-radius:9px">
    At <b style="color:${coverCol}">${latest.toFixed(1)}%</b> this is
    <b style="color:var(--text)">${(() => {
      const p = Math.round(((latest-low)/(peak-low))*100);
      return p>=98?'the most of their range you have ever covered'
        : p>=65?'high against your own record with them'
        : p>=35?'about your usual with them'
        : p>2  ?'low against your own record with them'
        : 'the least of their range you have ever covered';
    })()}</b> \u2014 your readings on them have ranged ${low.toFixed(1)}% to ${peak.toFixed(1)}%.
  </div>` : ''}`;

  const metaRow=`<div style="display:flex;gap:20px;flex-wrap:wrap;margin-bottom:14px;padding:10px 14px;background:var(--s2);border:1px solid var(--border);border-radius:10px">
    ${net!=null?`<span style="font-family:var(--mono);font-size:11px;color:var(--muted2)">Net all-time: <b style="color:${net>0?'#00f5a0':net<0?'#ff4d6d':NEUT}">${net>0?'+':''}${net}pp</b></span>`:''}
    ${trend3!=null?`<span style="font-family:var(--mono);font-size:11px;color:var(--muted2)">Last 3: <b style="color:${trend3>0?'#00f5a0':trend3<0?'#ff4d6d':NEUT}">${trend3>0?'+':''}${trend3}pp</b></span>`:''}
    ${streak!==0?`<span style="font-family:var(--mono);font-size:11px;color:var(--muted2)">Streak: <b style="color:${streak>0?'#00f5a0':'#ff4d6d'}">${streak>0?'↑':'↓'} ${Math.abs(streak)}×</b></span>`:''}
    <span style="font-family:var(--mono);font-size:11px;color:${diffCol}">${verdict}</span>
  </div>`;

  const presets=[{k:'7d',l:'Last 7d'},{k:'30d',l:'Last 30d'},{k:'90d',l:'Last 3m'},{k:'all',l:'All time'}];
  const presetBtns=presets.map(r=>`<button onclick="setCompDetailRange('${r.k}')" id="compDetailRangeBtn_${r.k}" style="font-family:var(--mono);font-size:10px;padding:5px 11px;border-radius:6px;cursor:pointer;border:1px solid ${r.k==='30d'?'var(--g)':'var(--border)'};background:${r.k==='30d'?'var(--g2)':'none'};color:${r.k==='30d'?'var(--g)':'var(--muted2)'};transition:all .15s">${r.l}</button>`).join('');

  const chartSection=`<div style="background:var(--s2);border:1px solid var(--border);border-radius:10px;padding:14px;margin-bottom:16px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:8px">
      <div style="font-family:var(--mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted2)" id="compDetailChartLabel">Your coverage of their range — last 30 days</div>
      <div style="display:flex;gap:6px">${presetBtns}</div>
    </div>
    <div style="height:180px"><canvas id="compDetailChart"></canvas></div>
  </div>`;

  const tableRows=pts.slice().reverse().map((p,ri)=>{
    const realIdx=pts.length-1-ri;
    const prevPt=realIdx>0?pts[realIdx-1]:null;
    const d=prevPt!=null?+(p.pct-prevPt.pct).toFixed(1):null;
    // you gained coverage on them = green, same as everywhere else
    const dCol=d==null?NEUT:d>0?'#00f5a0':d<0?'#ff4d6d':NEUT;
    const dStr=d==null?'—':(d>0?'+':'')+d+'pp';
    const pCol=p.pct>=25?'#00f5a0':p.pct>=15?'#7bd88f':p.pct>=7?'#ca8a04':'var(--muted2)';
    const isPeak=p.pct===peak, isLow=p.pct===low;
    return `<tr>
      <td style="color:var(--g)">${fmt(p.date)}</td>
      <td style="font-weight:700;color:${pCol}">${p.pct.toFixed(1)}%${isPeak?' <span style="font-family:var(--mono);font-size:9px;color:#00f5a0;background:rgba(0,245,160,.12);padding:1px 5px;border-radius:3px">BEST</span>':isLow?' <span style="font-family:var(--mono);font-size:9px;color:#ff4d6d;background:rgba(255,77,109,.12);padding:1px 5px;border-radius:3px">LOWEST</span>':''}</td>
      <td style="font-family:var(--mono);font-size:11px;color:${dCol}">${dStr}</td>
    </tr>`;
  }).join('');

  // The read-out that used to sit under every table row, now shown only for the seller you opened.
  const readOut = (window.__cmpAnalysis && window.__cmpAnalysis[name])
    ? `<div style="font-family:var(--mono);font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);margin-bottom:8px">Read-out</div>
       <div style="background:var(--s2);border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin-bottom:18px">${window.__cmpAnalysis[name]}</div>`
    : '';

  // The products you both sell — the thing a percentage cannot tell you.
  const detail = compAsinFor(sellerId);
  const asinBlock = (detail && detail.asins && detail.asins.length) ? `
    <div style="font-family:var(--mono);font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);margin-bottom:8px">
      Products you both sell — ${detail.asins.length} of their ${detail.size ? detail.size.toLocaleString() : '?'} listings
    </div>
    <div style="background:var(--s2);border:1px solid var(--border);border-radius:10px;padding:11px 13px;margin-bottom:18px;max-height:170px;overflow-y:auto">
      ${detail.asins.map(a=>`<a href="https://www.amazon.co.uk/dp/${encodeURIComponent(a)}" target="_blank" rel="noopener"
        style="display:inline-block;font-family:ui-monospace,Menlo,monospace;font-size:11px;background:var(--s3);color:var(--b);
        padding:3px 7px;border-radius:4px;margin:2px;text-decoration:none">${kfEsc(a)}</a>`).join('')}
    </div>` : '';

  document.getElementById('compDetailBody').innerHTML=statGrid+metaRow+asinBlock+readOut+chartSection+
    `<div style="font-family:var(--mono);font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);margin-bottom:8px">Session history — all time</div>
    <div style="max-height:240px;overflow-y:auto"><table class="history-table">
      <thead><tr><th>Date</th><th>Overlap %</th><th>vs Previous</th></tr></thead>
      <tbody>${tableRows}</tbody>
    </table></div>`;

  document.getElementById('compDetailModal').classList.add('open');
  setTimeout(()=>drawCompDetailChart('30d'), 60);
}

function setCompDetailRange(range){
  const labels={'7d':'last 7 days','30d':'last 30 days','90d':'last 3 months','all':'all time'};
  ['7d','30d','90d','all'].forEach(k=>{
    const btn=document.getElementById('compDetailRangeBtn_'+k);
    if(!btn) return;
    const active=k===range;
    btn.style.borderColor=active?'var(--g)':'var(--border)';
    btn.style.background=active?'var(--g2)':'none';
    btn.style.color=active?'var(--g)':'var(--muted2)';
  });
  const lbl=document.getElementById('compDetailChartLabel');
  if(lbl) lbl.textContent=`Overlap % — ${labels[range]||range}`;
  drawCompDetailChart(range);
}

function drawCompDetailChart(range){
  destroyChart('compDetailChart');
  const cv=document.getElementById('compDetailChart');
  if(!cv||typeof Chart==='undefined') return;
  let filtered=_compDetailAllPts;
  if(range!=='all'){
    const days={'7d':7,'30d':30,'90d':90}[range]||30;
    const cutoff=new Date(); cutoff.setDate(cutoff.getDate()-days);
    const cutoffStr=cutoff.toLocaleDateString('en-CA');
    filtered=_compDetailAllPts.filter(p=>p.date>=cutoffStr);
  }
  if(!filtered.length) filtered=_compDetailAllPts;
  const vals=filtered.map(p=>p.pct);
  const labels=filtered.map(p=>fmtShort(p.date));
  const peak=_compDetailPeak, low=_compDetailLow;
  const lo=Math.max(0,Math.min(...vals)-Math.max(3,(Math.max(...vals)-Math.min(...vals))*0.3));
  const hi=Math.min(100,Math.max(...vals)+Math.max(3,(Math.max(...vals)-Math.min(...vals))*0.3));
  chartInstances['compDetailChart']=new Chart(cv.getContext('2d'),{
    type:'line',
    data:{ labels, datasets:[{ data:vals, borderColor:'#ffd166', backgroundColor:'rgba(255,209,102,.1)',
      borderWidth:2, tension:.3, fill:true, pointRadius:3, pointHoverRadius:5,
      pointBackgroundColor:vals.map(v=>v===peak?'#22c55e':v===low?'#ff4d6d':'#ffd166'),
      pointBorderColor:'#07090c', pointBorderWidth:1.5 }]},
    options:{ responsive:true, maintainAspectRatio:false, interaction:{mode:'index',intersect:false},
      plugins:{ legend:{display:false}, datalabels:{display:false},
        tooltip:{ backgroundColor:'rgba(7,9,12,.98)', titleColor:'#dce6f0', bodyColor:'#dce6f0',
          borderColor:'#ffd166', borderWidth:1, padding:8, displayColors:false,
          callbacks:{ title:items=>fmt(filtered[items[0].dataIndex].date),
            label:ctx=>`${ctx.parsed.y.toFixed(1)}% overlap${ctx.parsed.y===peak?' ← all-time high':ctx.parsed.y===low?' ← all-time low':''}` } } },
      scales:{ y:{ min:lo,max:hi,grid:{color:'#1c2330'},ticks:{color:'#a7b4c4',callback:v=>v+'%'} },
        x:{ grid:{display:false},ticks:{color:'#a7b4c4',maxRotation:0,autoSkip:true,maxTicksLimit:10} } }
    }
  });
}
function renderCompInsights(snaps) {
  const box = document.getElementById('compInsightInner');
  if (!box) return;
  const hd = `<div class="insight-hd"><span class="insight-badge">✦ Competitor Analysis</span></div>`;
  const T = typeof leadTotals === 'function' ? leadTotals() : null;
  if (!T) {
    box.innerHTML = `${hd}<div style="color:var(--muted2);font-family:var(--mono);font-size:12px">Fetch from Keepa to start tracking how many of their leads you're on.</div>`;
    return;
  }

  // Same rule as the table: up or down is the number of their leads you're on. The old panel
  // ran on Keepa's %, so it could list a rival under "gained" while the table showed ▼ leads.
  const nameById = {};
  COMPETITOR_SESSIONS.forEach(s => (s.competitors||[]).forEach(c => { if (c.sellerId) nameById[c.sellerId] = c.name.trim(); }));
  (SELLERS||[]).forEach(s => { if (s.sellerId) nameById[s.sellerId] = s.name; });
  const rows = (SELLERS||[]).filter(s => s.sellerId).map(s => ({ id:s.sellerId, name:nameById[s.sellerId]||s.sellerId, st:leadStats(s.sellerId) })).filter(r => r.st);
  const with2 = rows.filter(r => r.st.trend);
  const gained = with2.filter(r => r.st.vs2w > 0).sort((a,b) => b.st.vs2w - a.st.vs2w);
  const lost   = with2.filter(r => r.st.vs2w < 0).sort((a,b) => a.st.vs2w - b.st.vs2w);
  const still  = with2.filter(r => r.st.trend.v === 'same');
  const nV = v => with2.filter(r => r.st.trend.v === v).length;

  const row = (name, right, tone, id) => {
    const c = tone==='bad' ? 'var(--r)' : tone==='good' ? 'var(--g)' : 'var(--muted2)';
    const click = id ? ` onclick="LD_OPEN='${id.replace(/'/g,"\\'")}';renderCompTab();document.getElementById('compHead')?.scrollIntoView({behavior:'smooth'})" style="cursor:pointer"` : '';
    return `<div${click} class="ci-row"><span class="ci-name">${name}</span><span class="ci-val" style="color:${c}">${right}</span></div>`;
  };
  const panel = (title, accent, bodyHtml, emptyMsg) =>
    `<div class="ci-panel" style="border-top-color:${accent}">
      <div class="ci-title" style="color:${accent}">${title}</div>
      ${bodyHtml || `<div class="ci-empty">${emptyMsg}</div>`}
    </div>`;

  const tr = T.trend, vCol = { better:'var(--g)', worse:'var(--r)', mixed:'var(--o)', same:'var(--b)' };
  const netTxt = !tr ? '' : `<b style="color:${vCol[tr.v]}">${tr.n > 0 ? '▲ ' + tr.n : tr.n < 0 ? '▼ ' + Math.abs(tr.n) : 'no change in'} lead${Math.abs(tr.n) === 1 ? '' : 's'}</b>`
    + (tr.v === 'mixed' ? `, <span style="color:var(--o)">${tr.why}</span>` : tr.pThen != null ? ` (share ${tr.pThen.toFixed(1)}% → ${tr.pNow.toFixed(1)}%)` : '');
  const headline = `<div class="ci-head">
      You're on <b style="color:var(--b)">${T.uOn.toLocaleString()}</b> different products your ${T.rivals} rivals sell${T.uTotal ? ` — out of <b>${T.uTotal.toLocaleString()}</b> on their shelves (${(T.uOn/T.uTotal*100).toFixed(1)}%)` : T.myAsins ? ` — <b>${Math.round(T.uOn/T.myAsins*100)}%</b> of the ${T.myAsins.toLocaleString()} on your storefront` : ''}.
      ${with2.length ? `Over 2 weeks: <b style="color:var(--g)">${nV('better')}</b> rivals better, <b style="color:var(--o)">${nV('mixed')}</b> mixed, <b style="color:var(--r)">${nV('worse')}</b> worse${tr ? ` — overall ${netTxt}` : ''}.` : 'Two weeks of fetches are needed to show movement.'}
      ${gained.length ? ` Biggest gain: <b style="color:var(--g)">${kfEsc(gained[0].name)}</b> (▲ ${gained[0].st.vs2w}).` : ''}
    </div>`;

  const mover = (r, tone) => {
    const band = ldBand(r.st.pct);
    return `<div class="ci-mover" onclick="LD_OPEN='${r.id.replace(/'/g,"\\'")}';renderCompTab();document.getElementById('compHead')?.scrollIntoView({behavior:'smooth'})">
      ${ldAvatar(r.name)}
      <div class="ci-mv-mid"><div class="ci-mv-top"><span class="ci-name">${kfEsc(r.name)}</span><span class="ci-mv-of">${r.st.on} of ${r.st.total}</span></div>
        <div class="ci-mv-bar"><i style="width:${Math.max(2,Math.min(100,r.st.pct||0))}%;background:${band}"></i></div></div>
      <span class="ld-chg ${LD_VCLS[r.st.trend.v]}" title="${kfEsc(r.st.trend.why || ldTrendTitle(r.st.trend))}">${tone==='up'?'▲':'▼'} ${Math.abs(r.st.vs2w)}</span>
    </div>`;
  };
  const gBody = gained.slice(0,7).map(r => mover(r,'up')).join('');
  const lBody = lost.slice(0,7).map(r => mover(r,'down')).join('');
  const closest = [...rows].filter(r => r.st.pct != null).sort((a,b) => b.st.pct - a.st.pct)[0];
  const mostToGet = [...rows].filter(r => r.st.toGet != null).sort((a,b) => b.st.toGet - a.st.toGet)[0];
  // Pulling away = their shelf grew faster than your leads on it, so your share of it fell.
  const pulling = with2.filter(r => r.st.trend.pThen != null && r.st.trend.dp < 0).sort((a,b) => a.st.trend.dp - b.st.trend.dp);
  const leadsTotal = new Set(rows.flatMap(r => r.st.leads.map(x => x.asin))).size;
  const fieldBody = `
    ${row('Rivals tracked', `${rows.length}`, 'neutral')}
    ${closest ? row('Closest to all their leads', `${kfEsc(closest.name)} · ${closest.st.pct.toFixed(1)}%`, 'neutral', closest.id) : ''}
    ${mostToGet ? row('Most still to get', `${kfEsc(mostToGet.name)} · ${mostToGet.st.toGet.toLocaleString()}`, 'neutral', mostToGet.id) : ''}
    ${with2.length ? row('Pulling away from you', pulling.length ? `${pulling.length} rival${pulling.length!==1?'s':''}` : 'nobody', pulling.length ? 'bad' : 'good', pulling[0] && pulling[0].id) : ''}
    ${window._shelfRowCount ? row('New leads to look at', `${leadsTotal}`, 'neutral') : ''}
    ${still.length ? row('Not moving', still.slice(0,3).map(r => kfEsc(r.name)).join(', '), 'neutral') : ''}`;

  box.innerHTML = `
    <div class="ci-top">${hd}${headline}</div>
    <div class="ci-grid">
      ${panel('▲ You gained leads · 2 weeks','var(--g)',gBody,'No rival gained over 2 weeks.').replace('class="ci-panel"','class="ci-panel good"')}
      ${panel('▼ You lost leads · 2 weeks','var(--r)',lBody,'No rival lost over 2 weeks.').replace('class="ci-panel"','class="ci-panel bad"')}
      ${panel('The field','var(--b)',fieldBody,'No data yet.').replace('class="ci-panel"','class="ci-panel field"')}
    </div>`;
}

async function deleteCompetitorSession(date) {
  const sess = COMPETITOR_SESSIONS.find(s => s.date === date);
  const n = sess ? (sess.competitors||[]).length : 0;
  if (!confirm(`Delete the competitor session from ${fmt(date)}? This removes ${n} reading${n!==1?'s':''} for that date. This can't be undone.`)) return;
  const removedSession = sess;
  COMPETITOR_SESSIONS = COMPETITOR_SESSIONS.filter(s => s.date !== date);
  if (window._supabaseDeleteSession) {
    showSyncStatus('loading');
    const ok = await window._supabaseDeleteSession(date);
    if (!ok) {
      // Restore it — the session is still in the database.
      if (removedSession) {
        COMPETITOR_SESSIONS.push(removedSession);
        COMPETITOR_SESSIONS.sort((a,b) => a.date.localeCompare(b.date));
      }
      renderCompHistory(); renderCompTab();
      showSyncStatus('error');
      alert(`⚠ Could not delete the session from ${fmt(date)}.\n\nIt is still in the database — nothing was removed. Check your internet connection and try again.`);
      return;
    }
    showSyncStatus('saved');
    // Drop the change-detection signature too — otherwise re-entering readings for this
    // same date looks "unchanged" to the save path and is silently never written.
    if (window._readingSigs) window._readingSigs.delete(date);
  }
  renderCompHistory();
  renderCompTab();
  renderBadges();   // was writing the session count into the competitors badge
  showToast(`Deleted session from ${fmt(date)}`);
}

// ── The answer first: are you on more of their products than two weeks ago? ─────────────────────
// A per-fetch line (same rivals all the way through, so adding a rival never looks like a win), the
// two compared weeks shaded, and a warning when this week rests on one fetch.
function ldSpark(id, col){
  const fd = Object.keys(COMPETITOR_ASINS||{}).sort().filter(d => COMPETITOR_ASINS[d][id]).slice(-12);
  if (fd.length < 2) return '';
  const v = fd.map(d => (COMPETITOR_ASINS[d][id].asins || []).length), lo = Math.min(...v), hi = Math.max(...v) === lo ? lo + 1 : Math.max(...v);
  const W = 128, H = 30, pts = v.map((x, i) => [3 + i / (v.length - 1) * (W - 9), 4 + (1 - (x - lo) / (hi - lo)) * (H - 8)]);
  const last = pts[pts.length - 1];
  return `<svg viewBox="0 0 ${W} ${H}" class="ld-spark" aria-label="last ${v.length} fetches: ${v[0]} to ${v[v.length-1]}"><title>${fd.map((d, i) => fmtShort(d) + ': ' + v[i]).join(' · ')}</title>`
    + `<polyline points="${pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ')}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" opacity=".9"/>`
    + `<circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="3" fill="${col}"/></svg>`;
}
function renderCompHero(T){
  const el = document.getElementById('compHero'); if (!el) return;
  const all = Object.keys(COMPETITOR_ASINS||{}).sort();
  if (!T || all.length < 2) { el.innerHTML = ''; return; }
  const tracked = new Set((SELLERS||[]).map(s => s.sellerId).filter(Boolean));
  // Every rival you track, as read on each fetch, so the line ends on the same number as the big one.
  // Starts once most of today's rivals were being read; a fetch that added rivals is marked on the line.
  const nOn = d => Object.keys(COMPETITOR_ASINS[d]).filter(id => tracked.has(id)).length;
  const dates = all.filter(d => nOn(d) >= tracked.size - 3).slice(-26);
  const ids = null;
  const uni = d => { const s = new Set(); Object.keys(COMPETITOR_ASINS[d]).filter(id => tracked.has(id)).forEach(id => ((COMPETITOR_ASINS[d][id]||{}).asins || []).forEach(a => s.add(a))); return s.size; };
  const ser = dates.map((d, i) => ({ d, u: uni(d), add: i ? nOn(d) - nOn(dates[i - 1]) : 0 }));
  const tr = T.trend, V = tr ? tr.v : 'same';
  const VC = { better:['▲ Getting better','#00f5a0'], worse:['▼ Getting worse','#ff4d6d'], mixed:['◆ Mixed','#ff8c42'], same:['● Steady','#3d9eff'] }[V];
  const prevHigh = Math.max(...ser.slice(0, -1).map(x => x.u)), last = ser[ser.length - 1];
  const record = ser.length > 3 && last.u > prevHigh && (!ids || ids.length === tracked.size || true);
  // chart
  const W = 760, H = 216, PL = 40, PR = 14, PT = 24, PB = 26, day = d => Date.parse(d + 'T00:00:00Z');
  const x0 = day(dates[0]), x1 = day(dates[dates.length - 1]), X = d => PL + (day(d) - x0) / Math.max(1, x1 - x0) * (W - PL - PR);
  const ax = niceAxis(Math.min(...ser.map(x => x.u)) * 0.92, Math.max(...ser.map(x => x.u)) * 1.04);
  const Y = v => PT + (1 - (v - ax.min) / (ax.max - ax.min)) * (H - PT - PB);
  let g = '';
  const band = (list, col, lab) => { if (!list || !list.length) return; const a = X(list[0]) - 6, b = X(list[list.length - 1]) + 6;
    g += `<rect x="${a.toFixed(1)}" y="${PT}" width="${Math.max(12, b - a).toFixed(1)}" height="${H - PT - PB}" rx="5" fill="${col}" opacity=".11"/><text x="${Math.min(W - PR - 2, (a + b) / 2).toFixed(1)}" y="${PT - 8}" text-anchor="${(a + b) / 2 > W - PR - 40 ? 'end' : 'middle'}" class="ch-band" fill="${col}">${lab}</text>`; };
  if (tr) { band(tr.thenDates.filter(d => d >= dates[0]), '#3d9eff', 'two weeks before'); band(tr.nowDates, VC[1], 'this week'); }
  for (let v = ax.min; v <= ax.max + 1e-9; v += ax.step) g += `<line x1="${PL}" x2="${W - PR}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" class="ch-grid"/><text x="${PL - 7}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end" class="ch-ax">${Math.round(v)}</text>`;
  const months = [...new Set(dates.map(d => d.slice(0, 7)))];
  months.forEach(m => { const d = m + '-01'; if (d >= dates[0]) g += `<text x="${X(d).toFixed(1)}" y="${H - 7}" text-anchor="middle" class="ch-ax">${new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { month:'short', timeZone:'UTC' })}</text>`; });
  const line = ser.map(p => `${X(p.d).toFixed(1)},${Y(p.u).toFixed(1)}`).join(' ');
  g += `<polygon points="${X(dates[0]).toFixed(1)},${H - PB} ${line} ${X(last.d).toFixed(1)},${H - PB}" fill="url(#cpFill)"/>`;
  g += `<polyline points="${line}" fill="none" stroke="#00f5a0" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/>`;
  ser.filter(p => p.add > 0).forEach(p => { g += `<line x1="${X(p.d).toFixed(1)}" x2="${X(p.d).toFixed(1)}" y1="${PT}" y2="${H - PB}" stroke="#c084fc" stroke-width="1" stroke-dasharray="2 3" opacity=".7"/><text x="${(X(p.d) + 4).toFixed(1)}" y="${H - PB - 4}" class="ch-add">+${p.add} rival${p.add > 1 ? 's' : ''}</text>`; });
  ser.forEach(p => { g += `<circle cx="${X(p.d).toFixed(1)}" cy="${Y(p.u).toFixed(1)}" r="3" fill="#07090c" stroke="#00f5a0" stroke-width="1.8"><title>${fmt(p.d)} · on ${p.u} of their products</title></circle>`; });
  g += `<circle cx="${X(last.d).toFixed(1)}" cy="${Y(last.u).toFixed(1)}" r="5" fill="#00f5a0"/><text x="${(X(last.d) - 9).toFixed(1)}" y="${(Y(last.u) - 9).toFixed(1)}" text-anchor="end" class="ch-last">${last.u}</text>`;
  const P = dates[dates.length - 2], gap = Math.round((day(last.d) - day(P)) / 864e5);
  if (gap > 3) g += `<line x1="${(X(P) + 5).toFixed(1)}" x2="${(X(last.d) - 5).toFixed(1)}" y1="${H - PB - 9}" y2="${H - PB - 9}" stroke="#ffd166" stroke-width="1.4" stroke-dasharray="2 3"/><text x="${((X(P) + X(last.d)) / 2).toFixed(1)}" y="${H - PB - 14}" text-anchor="middle" class="ch-gap">${gap} days, no fetch</text>`;
  const chart = `<svg viewBox="0 0 ${W} ${H}" class="cp-chart" role="img" aria-label="Their products you're on, fetch by fetch"><defs><linearGradient id="cpFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#00f5a0" stop-opacity=".22"/><stop offset="1" stop-color="#00f5a0" stop-opacity="0"/></linearGradient></defs>${g}</svg>`;
  // your storefront this fetch
  const rows = MY_SHELF || [], hasOn = window._myShelfHasOn;
  const Lm = rows.length ? [...new Set(rows.map(r => r.listed_on))].sort().pop() : null;
  const on = hasOn && Lm ? rows.filter(r => r.on_now && r.on_changed === Lm).length : null, off = hasOn && Lm ? rows.filter(r => !r.on_now && r.on_changed === Lm).length : null;
  const why = [];
  if (on != null && (on || off)) why.push(`<b>${on}</b> of your products came on at the ${fmt(Lm)} fetch (new or back in stock) and <b>${off}</b> went off — net ${on - off >= 0 ? '+' : '−'}${Math.abs(on - off)} on your storefront.`);
  if (tr && tr.totThen) why.push(`Their shelves went ${Math.round(tr.totThen).toLocaleString()} → ${Math.round(tr.totNow).toLocaleString()} products${tr.pNow > tr.pThen ? ', but you grew faster, so your share rose' : tr.pNow < tr.pThen ? ', faster than you did, so your share fell' : ''}.`);
  const thin = tr && tr.nowDates.length === 1;
  el.innerHTML = `<div class="cp-hero" style="--vc:${VC[1]}">
    <div class="cp-hl">
      <span class="cp-v">${VC[0]}</span>
      <div class="cp-big">${T.uOn.toLocaleString()}<small>of their products you're on</small></div>
      <div class="cp-sub">${record ? `<b style="color:var(--g)">Most ever</b> — previous high ${prevHigh}.` : `Previous high ${prevHigh}.`}${tr ? ` Two weeks ago you averaged <b>${Math.round(tr.onThen)}</b>.` : ''}</div>
      ${tr ? `<div class="cp-facts">
        <div><span>vs two weeks ago</span><b style="color:${VC[1]}">${tr.n > 0 ? '+' : tr.n < 0 ? '−' : '±'}${Math.abs(tr.n)}</b><em>leads</em></div>
        <div><span>share of their shelves</span><b>${tr.pNow != null ? tr.pNow.toFixed(1) + '%' : '—'}</b><em>${tr.pThen != null ? 'was ' + tr.pThen.toFixed(1) + '%' : ''}</em></div>
      </div>` : ''}
    </div>
    <div class="cp-hr">
      <div class="cp-legend"><span><i></i>Their products you're on, each fetch · all ${tracked.size} rivals you track</span></div>
      ${chart}
    </div>
    ${why.length ? `<div class="cp-why"><b>Why:</b> ${why.join(' ')}</div>` : ''}
    ${thin ? `<div class="cp-warn"><span>⚠ This week is <b>1 fetch</b> (${fmt(tr.nowDates[0])}) against ${tr.thenDates.length} two weeks before${gap > 3 ? ` — nothing was fetched ${fmtShort(_ldShift(P, 1))}–${fmtShort(_ldShift(last.d, -1))}` : ''}. One reading can land on a sell-out day; the next fetch confirms it.</span><button class="cmp-chip" onclick="openKeepaFetch()">Fetch now</button></div>` : ''}
  </div>`;
}
