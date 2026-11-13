// ===== STOCK HEALTH PAGE (injected) =====
// ════════════════════════════════════════════════════════════════════════
//  STOCK HEALTH — page + popup share these builders
//  Headline: clearing fast enough? + getting healthier or worse?
//  Count shown neutral; MOVEMENT shown as its own coloured number so it pops.
//  3 zones up top (10-sec read), 7 brackets as detail. Fresh on top → old below.
//  Colour: green = good · amber = aged/caution · red = bad. That's it.
// ════════════════════════════════════════════════════════════════════════

let SH_GOAL = 80, SH_FLOOR = 75;
(function shLoadThresholds(){
  try{ const g=parseFloat(localStorage.getItem('shGoal')); if(!isNaN(g)) SH_GOAL=g;
       const f=parseFloat(localStorage.getItem('shFloor')); if(!isNaN(f)) SH_FLOOR=f; }catch(e){}
})();
function shSaveSettings(){
  const g=parseFloat(document.getElementById('shGoalInput')?.value);
  const f=parseFloat(document.getElementById('shFloorInput')?.value);
  if(isNaN(g)||isNaN(f)||g<0||g>100||f<0||f>100){ if(typeof showToast==='function') showToast('Enter goal and floor as 0–100'); return; }
  if(f>g){ if(typeof showToast==='function') showToast('Floor should be at or below the goal'); return; }
  let kept = true;
  SH_GOAL=g; SH_FLOOR=f; try{ localStorage.setItem('shGoal',g); localStorage.setItem('shFloor',f); }catch(e){ kept = false; }
  if(typeof showToast==='function') showToast(kept ? `✓ Targets saved on this computer — ${g}% goal / ${f}% floor` : `⚠ Using ${g}% / ${f}% for now, but this browser wouldn't keep them — they'll reset on reload`);
  shSyncSettingsInputs();
  if(document.getElementById('tab-stockhealth')?.classList.contains('active')) renderStockHealth();
}
function shSyncSettingsInputs(){ const gi=document.getElementById('shGoalInput'),fi=document.getElementById('shFloorInput'); if(gi) gi.value=SH_GOAL; if(fi) fi.value=SH_FLOOR; }

// Colours
// The app's own colours (same as the Competitors tab): green on track, yellow missed 90,
// orange past 180, red past a year. One meaning per colour across the whole page.
const GOOD='#00f5a0', BAD='#ff4d6d', AMBER='#ffd166', ORANGE='#ff8c42', NEUT='#a7b4c4', TXT='#dce6f0';
const ZDOT={healthy:'#00f5a0',caution:'#ffd166',danger:'#ff8c42',critical:'#ff4d6d'};
const ZTINT={healthy:'rgba(0,245,160,.08)',caution:'rgba(255,209,102,.09)',danger:'rgba(255,140,66,.10)',critical:'rgba(255,77,109,.12)'};
const ZBAR={healthy:'rgba(0,245,160,.42)',caution:'rgba(255,209,102,.48)',danger:'rgba(255,140,66,.55)',critical:'rgba(255,77,109,.62)'};

let shFrom=null, shTo=null, shInit=false;

function shAllSnaps(){ return [...DB].sort((a,b)=>a.date.localeCompare(b.date)); }
function shFilteredSnaps(){ let d=shAllSnaps(); if(shFrom&&shTo) d=d.filter(s=>s.date>=shFrom&&s.date<=shTo); return d; }
function shBucketTotal(s){ const a=s.ageing||{}; return AG_BUCKETS.reduce((x,b)=>x+(a[b.key]||0),0); }
function shFlowPct(s){ const a=s.ageing||{}; const t=shBucketTotal(s)||1; return parseFloat((((a.a0||0)+(a.a31||0)+(a.a61||0))/t*100).toFixed(1)); }
function shZoneColor(pct){ return pct>=SH_GOAL?GOOD:pct>=SH_FLOOR?AMBER:BAD; }

function shComputeFlows(ag, prevAg){
  const keys=['a0','a31','a61','a91','a181','a271','a365']; const n=keys.length;
  const last=keys.map(k=>prevAg[k]||0); const now=keys.map(k=>ag[k]||0);
  const agedOn=new Array(n+1).fill(0); const sold=new Array(n).fill(0);
  for(let i=n-1;i>=0;i--){ const out=agedOn[i+1]; agedOn[i]=Math.max(0,(now[i]-last[i])+out); sold[i]=Math.max(0,last[i]+agedOn[i]-out-now[i]); }
  return keys.map((key,i)=>({ key,last:last[i],now:now[i],net:now[i]-last[i],
    agedIn:i===0?0:agedOn[i], agedOut:agedOn[i+1], sold:i===0?0:sold[i], newArrivals:i===0?agedOn[0]:0 }));
}
function shTrend(snaps){
  if(snaps.length<2) return null;
  const x0=new Date(snaps[0].date+'T00:00:00').getTime();
  const p=snaps.map(s=>({x:(new Date(s.date+'T00:00:00').getTime()-x0)/86400000,y:shFlowPct(s)}));
  const n=p.length,sx=p.reduce((a,q)=>a+q.x,0),sy=p.reduce((a,q)=>a+q.y,0),sxx=p.reduce((a,q)=>a+q.x*q.x,0),sxy=p.reduce((a,q)=>a+q.x*q.y,0);
  const den=n*sxx-sx*sx, slopeDay=den===0?0:(n*sxy-sx*sy)/den;
  return { slopeDay, perWeek:slopeDay*7 };
}
function shFlowLastWeek(snaps){
  if(snaps.length<2) return null;
  const latest=snaps[snaps.length-1]; const cut=new Date(latest.date+'T00:00:00'); cut.setDate(cut.getDate()-7);
  const cutStr=cut.toLocaleDateString('en-CA'); const c=snaps.filter(s=>s.date<=cutStr);
  const ref=c.length?c[c.length-1]:snaps[0]; return ref===latest?null:shFlowPct(ref);
}

// ── Each SKU's band per snapshot (bdl_snapshot_skus) — exact movement instead of guesses ──
let SNAP_SKUS = {};   // date -> [[sku, asin, band 0-6, £, units, oldest received, title], …]
let SNAP_SKU_DATES = new Set();
async function loadSnapSkus(){
  if (!window._snapSkusLoad) return;
  const rows = await window._snapSkusLoad(2);
  if (rows) rows.forEach(r => { SNAP_SKUS[r.date] = r.rows || []; });
  const ds = window._snapSkusDates ? await window._snapSkusDates() : null;
  if (ds) { SNAP_SKU_DATES = new Set(ds); if (document.getElementById('tab-history')?.classList.contains('active')) renderHistory(); }
  if (document.getElementById('tab-stockhealth')?.classList.contains('active')) renderStockHealth();
}
// What happened to every SKU between two snapshots. Null unless both have their SKU detail —
// totals per band alone cannot tell "sold out" from "aged into the next band".
function shExactMoves(prevDate, curDate){
  const P = SNAP_SKUS[prevDate], L = SNAP_SKUS[curDate];
  if (!P || !L) return null;
  const mp = new Map(P.map(r => [r[0], r])), ml = new Map(L.map(r => [r[0], r]));
  const band = AG_BUCKETS.map(() => ({ newIn:0, inYounger:0, inOlder:0, outOlder:0, outYounger:0, gone:0 }));
  const o = { newIn:[], gone:[], agedOn:0, younger:0, past90:[], past180:[], band };
  ml.forEach((r, sku) => {
    const p = mp.get(sku), b = r[2];
    if (!p) { band[b].newIn++; o.newIn.push(r); return; }
    const pb = p[2];
    if (b > pb) { band[b].inYounger++; band[pb].outOlder++; o.agedOn++; if (pb <= 2 && b >= 3) o.past90.push(r); if (pb <= 3 && b >= 4) o.past180.push(r); }
    else if (b < pb) { band[b].inOlder++; band[pb].outYounger++; o.younger++; }   // its oldest units sold, newer ones left
  });
  mp.forEach((p, sku) => { if (!ml.has(sku)) { band[p[2]].gone++; o.gone.push(p); } });
  return o;
}
// From the oldest-received date: what goes past 90 / 180 days in the next 14 days.
function shUpcoming(date){
  const rows = SNAP_SKUS[date]; if (!rows) return null;
  const t = Date.parse(date + 'T00:00:00Z');
  const age = r => r[5] ? Math.round((t - Date.parse(r[5] + 'T00:00:00Z')) / 864e5) : null;
  const within = (r, lo, hi) => { const a = age(r); return a != null && a >= lo && a <= hi; };
  return { age, soon90: rows.filter(r => r[2] <= 2 && within(r, 76, 90)), soon180: rows.filter(r => r[2] === 3 && within(r, 166, 180)) };
}

// ── Getting healthier or worse? ────────────────────────────────────────────────────────────
// Same rule as the leads on the Competitors tab: the snapshots in the last 7 days averaged,
// against the week that ended 14 days earlier — one delivery landing (5 Oct: +30 fresh SKUs)
// must not swing the answer. Three signals:
//   share under 90 days by SKUs (up = good) · by £ (up = good) · SKUs past 90 days (down = good)
// All agree = better / worse. They disagree = mixed, said in words.
function shVerdict(upto){
  const all = shAllSnaps().filter(s => shBucketTotal(s) > 0 && (!upto || s.date <= upto));
  if (all.length < 2 || typeof ldWindows !== 'function') return null;
  const w = ldWindows(all.map(s => s.date));
  if (!w || !w.then) return null;
  const pick = ds => ds.map(d => all.find(s => s.date === d));
  const N = pick(w.now), T = pick(w.then);
  const avg = (list, f) => { const v = list.map(f).filter(x => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const skuPct = s => shZones(s).healthy / shBucketTotal(s) * 100;
  const valPct = s => { if (!shHasValuation(s)) return null; const v = shZoneValues(s), t = v.healthy + v.caution + v.action; return t ? v.healthy / t * 100 : null; };
  const p90 = s => { const z = shZones(s); return z.caution + z.action; };
  const p90v = s => { if (!shHasValuation(s)) return null; const v = shZoneValues(s); return v.caution + v.action; };
  const m = f => ({ then: avg(T, f), now: avg(N, f) });
  const V = { sku: m(skuPct), val: m(valPct), p90: m(p90), p90v: m(p90v), nowDates: w.now, thenDates: w.then };
  const r1 = x => Math.round(x * 10) / 10;
  const a = Math.sign(r1(V.sku.now) - r1(V.sku.then));
  const b = V.val.then != null && V.val.now != null ? Math.sign(r1(V.val.now) - r1(V.val.then)) : 0;
  const n90 = Math.round(V.p90.now) - Math.round(V.p90.then), c = -Math.sign(n90);
  const pos = [a, b, c].some(x => x > 0), neg = [a, b, c].some(x => x < 0);
  V.v = !pos && !neg ? 'same' : pos && !neg ? 'better' : neg && !pos ? 'worse' : 'mixed';
  V.n90 = n90;
  V.why = V.v !== 'mixed' ? ''
    : c >= 0 && (a < 0 || b < 0) ? (c > 0 ? `the % dipped from fewer fresh SKUs — and ${Math.abs(n90)} fewer are past 90 days` : 'the % dipped from fewer fresh SKUs — nothing more went past 90 days')
    : c < 0 && (a > 0 || b > 0) ? `new stock lifted the %, but ${Math.abs(n90)} more SKUs went past 90 days`
    : a > 0 ? 'more of your SKUs are fresh, but less of your money is'
    : 'fewer of your SKUs are fresh, but more of your money is';
  return V;
}
function shVerdictTitle(V){
  if (!V) return 'Needs two weeks of entries';
  const f = d => fmtShort(d), span = l => l.length > 1 ? `${f(l[0])}–${f(l[l.length-1])}` : f(l[0]);
  return `Average of entries ${span(V.nowDates)} vs ${span(V.thenDates)} · under 90 days ${V.sku.then.toFixed(1)}% → ${V.sku.now.toFixed(1)}% of SKUs`
    + (V.val.then != null ? `, ${V.val.then.toFixed(1)}% → ${V.val.now.toFixed(1)}% of £` : '')
    + ` · past 90 days ${Math.round(V.p90.then)} → ${Math.round(V.p90.now)} SKUs`;
}
const SH_VMAP = { better:['▲','GETTING HEALTHIER',GOOD], worse:['▼','GETTING WORSE',BAD], mixed:['◆','MIXED','#ff8c42'], same:['→','HOLDING STEADY',NEUT] };
// The Overview tile: same verdict, same words.
function shOverviewTile(){
  const pill = document.getElementById('kAgedRiskPill'), tile = document.getElementById('kAgedRisk')?.closest('.kpi-tile');
  const V = shVerdict(); if (!pill || !tile || !V) return;
  const byVal = V.val.then != null && V.val.now != null;
  const d = +((byVal ? V.val.now - V.val.then : V.sku.now - V.sku.then)).toFixed(1);
  pill.innerHTML = `<span class="pill ${{better:'up',worse:'down',mixed:'mixed',same:'flat'}[V.v]}" title="${kfEsc(shVerdictTitle(V))}">${d > 0 ? '▲ +' : d < 0 ? '▼ −' : '→ '}${Math.abs(d)}pp vs 2 weeks</span>`;
  tile.classList.remove('better','worse','same','mixed');
  tile.classList.add(V.v);
}
function shOverviewRows(){
  const latest = shAllSnaps().filter(s => shBucketTotal(s) > 0).pop(); if (!latest) return '';
  const V = shVerdict(), z = shZones(latest), t = shBucketTotal(latest);
  const M = shHasValuation(latest) ? 'gbp' : 'sku', zm = shZonesBy(latest, M);
  const in180 = zm.total ? (zm.healthy + zm.caution) / zm.total * 100 : 0;
  const zv = shHasValuation(latest) ? shZoneValues(latest) : null;
  const row = (l, v, col, tip) => `<span class="kpi-cmp-row" title="${tip}"><span class="kpi-cmp-l">${l}</span><span class="kpi-cmp-v" style="color:${col}">${v}</span></span>`;
  const n = V ? V.n90 : null;
  return `<span class="kpi-cmp">`
    + (latest.ageingAsin ? (() => { const za = shZonesBy(latest, 'asin'); return row('ASINs', `${(za.healthy / za.total * 100).toFixed(1)}% · ${za.healthy.toLocaleString()}/${za.total.toLocaleString()}`, 'var(--text)', 'The same stock counted by product — an ASIN is as old as its oldest SKU'); })() : '')
    + row('SKUs', `${(z.healthy / t * 100).toFixed(1)}% · ${z.healthy.toLocaleString()}/${t.toLocaleString()}`, 'var(--text)', 'The same stock counted by SKU (each buy)')
    + row('past 90 days', `${zv ? fmtGBP(zv.caution + zv.action) + ' · ' : ''}${V ? `${n > 0 ? '↑ +' : n < 0 ? '↓ −' : '→ '}${Math.abs(n)} SKUs` : (z.caution + z.action) + ' SKUs'}`, n > 0 ? '#ff8c42' : n < 0 ? '#00f5a0' : 'var(--muted2)', 'Money past 90 days now · SKUs past 90 days, last week averaged vs two weeks before')
    + row('within 180 days', in180.toFixed(1) + '%', in180 >= 99.5 ? '#00f5a0' : '#ff8c42', 'Your limit: everything sold within 180 days')
    + (V && V.v === 'mixed' ? `<span style="font-size:10.5px;line-height:1.35;color:#ff8c42;margin-top:2px">${V.why}</span>` : '')
    + `</span>`;
}
// A list of SKUs: name, SKU · ASIN, units, £, age.
function shSkuList(title, rows, col, ageOf){
  if (!rows || !rows.length) return '';
  const list = rows.slice().sort((a, b) => (b[3] || 0) - (a[3] || 0));
  const tot = list.reduce((t, r) => t + skuVal(r), 0);
  return `<div class="sh-lst"><div class="sh-lst-hd"><span style="color:${col}">${title}</span><b>${list.length}</b><em>${fmtGBP(tot)}</em></div>
    <div class="sh-lst-body">${list.map(r => { const a = ageOf ? ageOf(r) : null; return `<div class="sh-lst-row">
      <div class="sh-lst-name"><span title="${kfEsc(r[6] || r[0])}">${kfEsc(r[6] || r[0])}</span><small>${kfEsc(r[0])}${r[1] ? ` · <a href="https://www.amazon.co.uk/dp/${encodeURIComponent(r[1])}" target="_blank" rel="noopener">${kfEsc(r[1])}</a>` : ''}</small></div>
      <span>${(r[4] || 0).toLocaleString()} unit${r[4] === 1 ? '' : 's'}</span><span>${fmtGBP(skuVal(r))}</span><span class="sh-lst-age">${a != null ? a + ' days' : ''}</span></div>`; }).join('')}</div></div>`;
}

// ── Stock by provider ────────────────────────────────────────────────────────────────────────
// Each SKU's provider comes from its name, by the same rules the inventory import uses (title
// keywords as the fallback). Three views: Overview (stock, money, ages — sortable), Age bands (every
// provider across all 7 bands, heat-shaded) and Biggest £ stuck (single SKUs). Open a provider in
// Overview for its stale SKUs, biggest £ first, with cost per unit, to reprice or clear.
let SH_PROV_OPEN = null, SH_PROV_TAB = 'prov', SH_PROV_SORT = { key:'val90', dir:-1 };
const _shProvRedraw = () => { const el = document.getElementById('shProvWrap'); if (el) el.outerHTML = shProviderHtml(shFilteredSnaps()); };
function shProvTab(t){ SH_PROV_TAB = t; _shProvRedraw(); }
function shProvToggle(name){ SH_PROV_OPEN = SH_PROV_OPEN === name ? null : name; _shProvRedraw(); }
function shProvSort(k){ SH_PROV_SORT = SH_PROV_SORT.key === k ? { key:k, dir:-SH_PROV_SORT.dir } : { key:k, dir: k === 'name' ? 1 : -1 }; _shProvRedraw(); }
const shProvName = (r, lk) => r[7] || impClassify(r[0], lk).provider || impMatchTitle(r[6], lk.titleRules) || 'Not matched';
function shProvGroups(rows, lk, ageOf){
  const g = new Map(), zero = () => AG_BUCKETS.map(() => 0);
  for (const r of rows) {
    const name = shProvName(r, lk);
    let o = g.get(name);
    if (!o) g.set(name, o = { name, n:0, p90:0, p180:0, val:0, val90:0, val180:0, u:0, u90:0, asins:new Map(), stale:[],
      bSku:zero(), bVal:zero(), bUnits:zero(), ageW:0, ageV:0, oldest:null });
    const v = skuVal(r), u = r[4] || 0, b = r[2];
    o.n++; o.val += v; o.u += u; o.bSku[b]++; o.bVal[b] += v; o.bUnits[b] += u;
    if (r[1]) o.asins.set(r[1], Math.max(o.asins.get(r[1]) ?? -1, b));   // an ASIN is as old as its oldest SKU
    if (b >= 3) { o.p90++; o.val90 += v; o.u90 += u; o.stale.push(r); }
    if (b >= 4) { o.p180++; o.val180 += v; }
    const a = ageOf ? ageOf(r) : null;   // days since its oldest unit reached Amazon
    if (a != null) { o.ageW += a * (v || 1); o.ageV += v || 1; if (o.oldest == null || a > o.oldest) o.oldest = a; }
  }
  g.forEach(o => { o.bAsin = zero(); o.asins.forEach(b => { o.bAsin[b]++; }); o.nAsin = o.asins.size; o.avgAge = o.ageV ? o.ageW / o.ageV : null; });
  return g;
}
function shGoToProvider(name){
  const nav = [...document.querySelectorAll('.nav-item')].find(n => (n.getAttribute('onclick')||'').includes("'stockhealth'"));
  SH_PROV_TAB = 'prov'; SH_PROV_OPEN = name;
  if (nav) switchTab('stockhealth', nav);
  setTimeout(() => document.getElementById('shProvWrap')?.scrollIntoView({ behavior:'smooth', block:'start' }), 150);
}
function shProvCopy(name){
  const latest = shFilteredSnaps().slice(-1)[0], rows = latest && SNAP_SKUS[latest.date];
  if (!rows) return;
  const o = shProvGroups(rows, impBuildLookup()).get(name); if (!o) return;
  const text = o.stale.slice().sort((a, b) => (b[3]||0) - (a[3]||0)).map(r => r[0]).join('\n');
  const done = () => { if (typeof showToast === 'function') showToast(`✓ Copied ${o.stale.length} SKU${o.stale.length!==1?'s':''} from ${name}`); };
  if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, () => prompt('Copy these SKUs:', text)); else prompt('Copy these SKUs:', text);
}
const SH_BAND_RGB = ['0,245,160','0,245,160','0,245,160','255,209,102','255,140,66','255,140,66','255,77,109'];
const shAgeCol = a => a == null ? 'var(--muted)' : a <= 90 ? 'var(--g)' : a <= 180 ? 'var(--y)' : 'var(--o)';
function shProviderHtml(snaps){
  const latest = snaps[snaps.length-1];
  const rows = latest && SNAP_SKUS[latest.date];
  const subs = { prov:"Every provider's stock, money and ages · click a column to sort · open one to see what to reprice or clear",
    bands:'Every provider across all seven age bands · darker = more of that provider\'s stock sits there', top:'The single SKUs with the most money past 90 days, whoever they came from' };
  const head = `<div class="shp-hd"><div><div class="shp-title">Stock by provider</div><div class="shp-sub">${subs[SH_PROV_TAB]}</div></div>
      ${rows ? `<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;justify-content:flex-end"><div class="sh-tabs">
        <button class="${SH_PROV_TAB==='prov'?'on':''}" onclick="shProvTab('prov')">Overview</button>
        <button class="${SH_PROV_TAB==='bands'?'on':''}" onclick="shProvTab('bands')">Age bands</button>
        <button class="${SH_PROV_TAB==='top'?'on':''}" onclick="shProvTab('top')">Biggest £ stuck</button></div>
        <div class="shp-as">from Sarah's ${fmt(latest.date)} file</div></div>` : ''}</div>`;
  if (!rows) return `<div id="shProvWrap" class="shp-card">${head}<div class="shp-empty">${window._hasSnapSkus===false
      ? 'Starts once the stock-health SQL is run in Supabase and Sarah drops in her next ageing file.'
      : "Starts with Sarah's next ageing file — each SKU is saved from then on."}</div></div>`;
  const lk = impBuildLookup();
  const age = shUpcoming(latest.date).age;
  const M = shM(latest), fm = v => shFmtM(v, M);
  const all = [...shProvGroups(rows, lk, age).values()];
  const prevSnap = snaps.length > 1 ? snaps[snaps.length-2] : null;
  const prevG = prevSnap && SNAP_SKUS[prevSnap.date] ? shProvGroups(SNAP_SKUS[prevSnap.date], lk) : null;
  const bandsOf = o => ({ gbp:o.bVal, sku:o.bSku, asin:o.bAsin, units:o.bUnits })[M];
  const sum = a => a.reduce((x, y) => x + y, 0);
  const share = o => { const b = bandsOf(o), t = sum(b); return t ? (b[0] + b[1] + b[2]) / t * 100 : 0; };
  const shareCol = v => v >= SH_GOAL ? 'var(--g)' : v >= SH_FLOOR ? 'var(--y)' : 'var(--r)';
  const T = all.reduce((t, o) => { t.n += o.n; t.u += o.u; t.val += o.val; t.val90 += o.val90; t.val180 += o.val180; t.p90 += o.p90; t.p180 += o.p180;
    t.ageW += o.ageW; t.ageV += o.ageV; t.oldest = Math.max(t.oldest, o.oldest ?? 0); bandsOf(o).forEach((x, i) => { t.b[i] += x; }); return t; },
    { n:0, u:0, val:0, val90:0, val180:0, p90:0, p180:0, ageW:0, ageV:0, oldest:0, b:AG_BUCKETS.map(() => 0) });
  const nAsinAll = new Set(rows.map(r => r[1]).filter(Boolean)).size;
  // sorting
  const key = SH_PROV_SORT.key, dir = SH_PROV_SORT.dir;
  const sv = { name:o => o.name.toLowerCase(), val:o => o.val, u90:o => share(o), val90:o => o.val90, val180:o => o.val180,
    age:o => o.avgAge ?? -1, oldest:o => o.oldest ?? -1, tot:o => sum(bandsOf(o)) };
  AG_BUCKETS.forEach((b, i) => { sv['b' + i] = o => bandsOf(o)[i]; });
  const f = sv[key] || sv.val90;
  const groups = all.slice().sort((a, b) => { const x = f(a), y = f(b); return (typeof x === 'string' ? x.localeCompare(y) : (x - y)) * dir || b.val90 - a.val90; });
  const sh = (k, label, cls) => `<span class="shp-sort${key === k ? ' on' : ''}${cls ? ' ' + cls : ''}" onclick="shProvSort('${k}')">${label}${key === k ? (dir > 0 ? ' ▲' : ' ▼') : ''}</span>`;

  if (SH_PROV_TAB === 'top') {
    const top = rows.filter(r => r[2] >= 3).sort((a, b) => (b[3]||0) - (a[3]||0)).slice(0, 20);
    return `<div id="shProvWrap" class="shp-card">${head}
      <div class="shp-list" style="max-height:none">${top.map((r, i) => { const a = age(r), u = r[4] || 0;
        return `<div class="shp-item" style="grid-template-columns:28px minmax(0,1fr) 110px 78px 70px 66px 86px 74px">
          <span style="text-align:left;color:var(--muted)">${i + 1}</span>
          <div class="shp-item-name"><span title="${kfEsc(r[6] || r[0])}">${kfEsc(r[6] || r[0])}</span><small>${kfEsc(r[0])}${r[1] ? ` · <a href="https://www.amazon.co.uk/dp/${encodeURIComponent(r[1])}" target="_blank" rel="noopener">${kfEsc(r[1])} ↗</a>` : ''}</small></div>
          <span style="text-align:left;color:var(--text)">${kfEsc(shProvName(r, lk))}</span>
          <span class="shp-band ${r[2] >= 4 ? 'b180' : 'b90'}">${AG_BUCKETS[r[2]].label}</span>
          <span>${a != null ? a + ' days' : ''}</span>
          <span>${u.toLocaleString()} unit${u === 1 ? '' : 's'}</span>
          <span>${u ? '£' + (skuVal(r) / u).toFixed(2) + '/unit' : ''}</span>
          <b>${fmtGBP(skuVal(r))}</b></div>`; }).join('') || '<p class="shp-dim">Nothing is past 90 days.</p>'}</div></div>`;
  }

  if (SH_PROV_TAB === 'bands') {
    const cell = (v, i, t) => { if (!v) return '<span class="shp-cell zero">—</span>';
      const a = t ? Math.min(.62, .08 + v / t * .7) : .08;
      return `<span class="shp-cell" style="background:rgba(${SH_BAND_RGB[i]},${a.toFixed(2)})" title="${AG_BUCKETS[i].label}: ${(v / t * 100).toFixed(0)}% of this provider">${fm(v)}</span>`; };
    return `<div id="shProvWrap" class="shp-card">${head}
      <div class="shp-bgrid shp-colhd">${sh('name','Provider')}${AG_BUCKETS.map((b, i) => sh('b' + i, b.label, 'r')).join('')}${sh('tot','Total','r')}</div>
      ${groups.map(o => { const b = bandsOf(o), t = sum(b); return `<div class="shp-bgrid shp-brow">
        <div class="shp-who">${provAvatar(o.name)}<b>${kfEsc(o.name)}</b></div>
        ${b.map((v, i) => cell(v, i, t)).join('')}<span class="shp-cell tot">${fm(t)}</span></div>`; }).join('')}
      <div class="shp-bgrid shp-btot"><span>All providers</span>${T.b.map((v, i) => `<span class="shp-cell" style="color:${ZDOT[AG_BUCKETS[i].zone]}">${fm(v)}</span>`).join('')}<span class="shp-cell tot">${fm(sum(T.b))}</span></div>
      <div class="shp-foot">Counted ${SH_METRICS[M].by} — use the switch at the top to recount in £, ASINs, SKUs or units.</div>
    </div>`;
  }

  const RU = typeof rpRollup === 'function' ? rpRollup() : null;
  const BUYC = { good:['good','var(--g)'], bad:['bad buy','var(--r)'], miss:['missed window','var(--o)'], luck:['bad luck','var(--y)'], slow:['slow','var(--muted2)'] };
  const row = o => {
    const s90 = share(o), open = SH_PROV_OPEN === o.name, p = prevG && prevG.get(o.name);
    const d = p ? o.p90 - p.p90 : null;
    const nameArg = o.name.replace(/\\/g,'\\\\').replace(/'/g, "\\'");
    const rp = RU && RU.prov[o.name];
    const tally = rp && rp.checked ? Object.entries(rp.buys).sort((a, b) => b[1] - a[1]).map(([v, n]) => `<span style="color:${BUYC[v][1]}">${n} ${BUYC[v][0]}</span>`).join(' · ')
      : '<span class="shp-dim">not checked in Repricer</span>';
    const worst = rp && rp.worst[0];
    const say = !o.val ? 'No stock.' : s90 >= SH_GOAL ? `${s90.toFixed(0)}% ${SH_METRICS[M].by} is inside 90 days — on track.`
      : s90 >= SH_FLOOR ? `${s90.toFixed(0)}% is inside 90 days — under your ${SH_GOAL}% goal.` : `Only ${s90.toFixed(0)}% is inside 90 days — ${fmtGBP(o.val90)} has missed it.`;
    const list = !open ? '' : `<div class="shp-open" onclick="event.stopPropagation()">
          <div class="shp-open-hd"><b>${o.stale.length ? `${o.stale.length} SKU${o.stale.length!==1?'s':''} past 90 days · ${fmtGBP(o.val90)}` : 'Nothing past 90 days'}</b>
            <span>average age ${o.avgAge != null ? Math.round(o.avgAge) + ' days' : '—'} · oldest ${o.oldest != null ? o.oldest + ' days' : '—'}${d != null ? ` · ${d === 0 ? 'no change' : (d > 0 ? '+' : '−') + Math.abs(d) + ' past 90'} since ${fmt(prevSnap.date)}` : ''}</span>
            ${o.stale.length ? `<button class="cmp-chip" onclick="shProvCopy('${nameArg}')">Copy SKUs</button>` : ''}
            <button class="cmp-chip" onclick="rpGoTo('${nameArg}')">Reprice ${kfEsc(o.name)} ›</button></div>
          ${rp && rp.worst.length ? `<div class="shp-worst">${rp.worst.slice(0, 5).map(w => `<div><b style="color:${BUYC[w.v][1]}">${BUYC[w.v][0]}</b> ${kfEsc(w.title.slice(0, 70))} · ${fmtGBP(w.value)}<small>${kfEsc(w.t.replace(/^[^—]+— /, ''))}</small></div>`).join('')}</div>` : ''}
          ${o.stale.length ? `<div class="shp-list">${o.stale.slice().sort((a, b) => (b[3]||0) - (a[3]||0)).map(r => { const a = age(r), u = r[4] || 0;
            return `<div class="shp-item">
              <div class="shp-item-name"><span title="${kfEsc(r[6] || r[0])}">${kfEsc(r[6] || r[0])}</span><small>${kfEsc(r[0])}${r[1] ? ` · <a href="https://www.amazon.co.uk/dp/${encodeURIComponent(r[1])}" target="_blank" rel="noopener">${kfEsc(r[1])} ↗</a>` : ''}</small></div>
              <span class="shp-band ${r[2] >= 4 ? 'b180' : 'b90'}">${AG_BUCKETS[r[2]].label}</span>
              <span>${a != null ? a + ' days' : ''}</span>
              <span>${u.toLocaleString()} unit${u === 1 ? '' : 's'}</span>
              <span title="Your cost per unit">${u ? '£' + (skuVal(r) / u).toFixed(2) + '/unit' : ''}</span>
              <b>${fmtGBP(skuVal(r))}</b></div>`; }).join('')}</div>` : ''}</div>`;
    return `<div class="shp-sc shp-row${open ? ' open' : ''}${o.p90 ? '' : ' clean'}" onclick="shProvToggle('${nameArg}')">
        <div class="shp-who">${provAvatar(o.name)}<div><b>${kfEsc(o.name)}</b><small>${fmtGBP(o.val)} · ${o.n} SKUs</small></div></div>
        <div class="shp-say"><div class="shp-bar"><i style="width:${Math.max(2, s90)}%;background:${shareCol(s90)}"></i></div><span style="color:${shareCol(s90)}">${say}</span></div>
        <div class="shp-num2">${o.val90 ? `<b style="color:var(--y)">${fmtGBP(o.val90)}</b><small>${o.p90} SKU${o.p90===1?'':'s'} past 90</small>` : '<span class="shp-dim">£0</span>'}</div>
        <div class="shp-num2">${o.val180 ? `<b style="color:var(--o)">${fmtGBP(o.val180)}</b><small>${o.p180} past 180</small>` : '<span class="shp-dim">£0</span>'}</div>
        <div class="shp-tally">${tally}${worst ? `<small title="${kfEsc(worst.t)}">worst: ${kfEsc(worst.title.slice(0, 34))}…</small>` : ''}</div>
        <span class="shp-caret">${open ? '⌄' : '›'}</span>
      </div>${list}`;
  };
  const avgAll = T.ageV ? Math.round(T.ageW / T.ageV) : null;
  const ranked = groups.filter(o => o.val >= 2000).map(o => ({ o, s: share(o) })).sort((a, b) => a.s - b.s);   // only providers with real money in them
  const lead = ranked.length > 1 ? `Worst: <b>${kfEsc(ranked[0].o.name)}</b> — ${ranked[0].s.toFixed(0)}% inside 90 days, ${fmtGBP(ranked[0].o.val90)} past it. Best: <b>${kfEsc(ranked[ranked.length - 1].o.name)}</b> — ${ranked[ranked.length - 1].s.toFixed(0)}%.` : '';
  return `<div id="shProvWrap" class="shp-card">${head}
    ${lead ? `<div class="shp-lead">${lead} Click a provider to see what's stuck and how good their buys were.</div>` : ''}
    <div class="shp-sc shp-colhd">${sh('name','Provider')}${sh('u90','Inside 90 days · ' + SH_METRICS[M].by)}${sh('val90','Past 90 days','r')}${sh('val180','Past 180 days','r')}<span>Their buys (Repricer)</span><span></span></div>
    ${groups.map(row).join('')}
    <div class="shp-sc shp-total"><span>All providers · ${groups.length}<small style="display:block;color:var(--muted2);font-weight:400">${fmtGBP(T.val)} · ${T.n} SKUs · avg age ${avgAll != null ? avgAll + ' days' : '—'}</small></span>
      <span>${sum(T.b) ? ((T.b[0] + T.b[1] + T.b[2]) / sum(T.b) * 100).toFixed(0) : 0}% inside 90 days</span>
      <div class="shp-num2"><b style="color:var(--y)">${fmtGBP(T.val90)}</b><small>${T.p90} SKUs</small></div>
      <div class="shp-num2"><b style="color:var(--o)">${fmtGBP(T.val180)}</b><small>${T.p180} SKUs</small></div><span></span><span></span></div>
  </div>`;
}

// ── What "under 90 days" is counted in ─────────────────────────────────────────────────────
// £ is the headline (money you can't reinvest). The same stock can be counted as SKUs (each buy),
// ASINs (each product — an ASIN is as old as its oldest SKU) or units. The switch on the page and
// in the popup changes every count, bar and chart; the 2-week verdict never changes with it.
// Units come from each SKU's saved detail, so they exist from Sarah's first upload after the SQL.
const SH_METRICS = { gbp:{ label:'£', by:'by £' }, asin:{ label:'ASINs', by:'by ASINs' }, sku:{ label:'SKUs', by:'by SKUs' }, units:{ label:'Units', by:'by units' } };   // Jack's order
let SH_METRIC = (() => { try { const m = localStorage.getItem('shMetric'); return SH_METRICS[m] ? m : 'gbp'; } catch(e) { return 'gbp'; } })();
function shBands(s, m){
  if (!s) return null;
  if (m === 'sku')  return AG_BUCKETS.map(b => (s.ageing||{})[b.key] || 0);
  if (m === 'gbp')  return shHasValuation(s) ? AG_BUCKETS.map(b => incVat((s.ageingValue||{})[b.key] || 0)) : null;
  if (m === 'asin') return s.ageingAsin ? AG_BUCKETS.map(b => s.ageingAsin[b.key] || 0) : null;
  if (m === 'units') { const rows = SNAP_SKUS[s.date]; if (!rows) return null; const a = AG_BUCKETS.map(() => 0); rows.forEach(r => { a[r[2]] += r[4] || 0; }); return a; }
  return null;
}
// The metric actually used for a snapshot: the chosen one if that entry has it, else SKUs.
const shM = s => shBands(s, SH_METRIC) ? SH_METRIC : 'sku';
function shZonesBy(s, m){ const b = shBands(s, m) || shBands(s, 'sku'); return { healthy:b[0]+b[1]+b[2], caution:b[3], action:b[4]+b[5]+b[6], total:b.reduce((x, y) => x + y, 0) }; }
function shShare90(s, m){ const z = shZonesBy(s, m || shM(s)); return z.total ? +(z.healthy / z.total * 100).toFixed(1) : 0; }
const shFmtM = (v, m) => m === 'gbp' ? fmtGBP(v) : Math.round(v || 0).toLocaleString();
const shUnitM = (m, n) => m === 'gbp' ? '' : ' ' + (m === 'sku' ? (n === 1 ? 'SKU' : 'SKUs') : m === 'asin' ? (n === 1 ? 'ASIN' : 'ASINs') : (n === 1 ? 'unit' : 'units'));
function shSetMetric(m){
  if (!SH_METRICS[m]) return;
  SH_METRIC = m; try { localStorage.setItem('shMetric', m); } catch(e) {}
  _shZoneMetric = { gbp:'value', sku:'skus', asin:'asins', units:'skus' }[m];
  if (document.getElementById('tab-stockhealth')?.classList.contains('active')) renderStockHealth();
  const md = document.getElementById('kpiModal');
  if (md && md.style.display === 'flex' && document.getElementById('kpiModalTitle')?.textContent === 'Stock Health') openKpiModal('agedrisk');
}
// The £ / SKUs / ASINs / Units switch. Options a snapshot can't give are shown but greyed.
function shMetricSwitch(latest){
  const why = { gbp:'This entry has no £ values', asin:'This entry was saved without ASINs', units:"Units start with Sarah's next ageing upload" };
  return `<div class="sh-seg" role="group" aria-label="Count by">${Object.entries(SH_METRICS).map(([k, o]) => {
    const ok = !!shBands(latest, k);
    return `<button class="${SH_METRIC === k ? 'on' : ''}" ${ok ? `onclick="event.stopPropagation();shSetMetric('${k}')"` : `disabled title="${why[k]}"`}>${o.label}</button>`; }).join('')}</div>`;
}
// SKU-by-SKU movement weighted by the metric (1 per SKU, £, or units) — for the pipeline tails.
function shBandFlows(prevDate, curDate, m){
  const P = SNAP_SKUS[prevDate], L = SNAP_SKUS[curDate];
  const w = m === 'sku' ? (() => 1) : m === 'gbp' ? (r => skuVal(r)) : m === 'units' ? (r => r[4] || 0) : null;
  if (!P || !L || !w) return null;
  const mp = new Map(P.map(r => [r[0], r])), ml = new Map(L.map(r => [r[0], r]));
  const band = AG_BUCKETS.map(() => ({ newIn:0, inYounger:0, inOlder:0, outOlder:0, outYounger:0, gone:0 }));
  ml.forEach((r, sku) => { const p = mp.get(sku), b = r[2];
    if (!p) { band[b].newIn += w(r); return; }
    if (b > p[2]) { band[b].inYounger += w(r); band[p[2]].outOlder += w(p); }
    else if (b < p[2]) { band[b].inOlder += w(r); band[p[2]].outYounger += w(p); } });
  mp.forEach((p, sku) => { if (!ml.has(sku)) band[p[2]].gone += w(p); });
  return band;
}
// Average of each calendar month's entries — the longer view beside the 2-week verdict.
function shMonths(m){
  const by = {};
  shAllSnaps().filter(s => shBucketTotal(s) > 0 && shBands(s, m)).forEach(s => { (by[s.date.slice(0, 7)] = by[s.date.slice(0, 7)] || []).push(shShare90(s, m)); });
  return Object.entries(by).sort().slice(-7).map(([k, v]) => ({ month:k, pct:v.reduce((a, b) => a + b, 0) / v.length, n:v.length }));
}

// presets
function shComputePreset(p){ const s=shAllSnaps(); if(!s.length) return; const maxD=s[s.length-1].date;
  if(p==='all'){ shFrom=s[0].date; shTo=maxD; return; }
  if(p==='n6'){ shFrom=s[Math.max(0,s.length-6)].date; shTo=maxD; return; }
  const days={d7:7,d30:30,d90:90,d180:180,d365:365}[p]; if(!days) return;
  const d=new Date(maxD+'T00:00:00'); d.setDate(d.getDate()-days); shFrom=d.toLocaleDateString('en-CA'); shTo=maxD; }
function shPreset(p){ window._shPreset=p; shComputePreset(p); renderStockHealth(); }
function shApplyCustom(){ const f=document.getElementById('shFrom')?.value,t=document.getElementById('shTo')?.value; if(f&&t){ shFrom=f; shTo=t; window._shPreset='custom'; renderStockHealth(); } }

// zone aggregates
function shZones(s){ const a=s.ageing||{}; return {
  healthy:(a.a0||0)+(a.a31||0)+(a.a61||0),
  caution:(a.a91||0),
  action:(a.a181||0)+(a.a271||0)+(a.a365||0) }; }
function shZoneValues(s){ const v=s.ageingValue||{}; return {
  healthy:incVat((v.a0||0)+(v.a31||0)+(v.a61||0)),
  caution:incVat(v.a91||0),
  action:incVat((v.a181||0)+(v.a271||0)+(v.a365||0)) }; }
function shHasValuation(s){ const v=s.ageingValue||{}; return Object.values(v).some(x=>x>0); }

// ════════════════════════════════════ PAGE ════════════════════════════════════
function renderStockHealth(){
  const c=document.getElementById('stockHealthContainer'); if(!c) return;
  if(!shInit){ window._shPreset=window._shPreset||'n6'; shComputePreset(window._shPreset); shInit=true; }
  const snaps=shFilteredSnaps();
  if(!snaps.length){ c.innerHTML=shControlsHtml()+`<div style="text-align:center;padding:80px 20px;color:var(--muted2);font-family:var(--mono)"><div style="font-size:22px;margin-bottom:12px;color:var(--g)">▦</div>No snapshots in this date range.</div>`; return; }
  c.innerHTML =
    shControlsHtml() +
    shHeroHtml(snaps) +
    shZoneSummaryHtml(snaps) +
    shWhyContextHtml(snaps) +
    shProviderHtml(snaps) +
    shPipelineHtml(snaps) +
    shGraphContainerHtml('shTrendChart', snaps) +
    shRecentTableHtml(snaps);
  shDrawChart(snaps,'shTrendChart','shTrend');
}

function shControlsHtml(){
  const p=window._shPreset||'n6';
  const btn=(k,l)=>`<button onclick="shPreset('${k}')" style="font-family:var(--mono);font-size:11px;padding:7px 13px;border-radius:7px;cursor:pointer;border:1px solid ${p===k?'var(--g)':'var(--border)'};background:${p===k?'var(--g2)':'var(--s2)'};color:${p===k?'var(--g)':'var(--muted2)'}">${l}</button>`;
  return `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:18px">
    <span style="font-family:var(--mono);font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted2);margin-right:4px">Range</span>
    ${btn('n6','Last 6')}${btn('d7','7d')}${btn('d30','30d')}${btn('d90','90d')}${btn('d180','6m')}${btn('all','All')}
    <div style="display:flex;align-items:center;gap:6px;margin-left:8px">
      <input type="date" id="shFrom" value="${shFrom||''}" style="background:var(--s1);border:1px solid ${p==='custom'?'var(--g)':'var(--border)'};color:var(--text);font-family:var(--mono);font-size:11px;padding:6px 9px;border-radius:6px">
      <span style="color:var(--muted2);font-family:var(--mono);font-size:11px">→</span>
      <input type="date" id="shTo" value="${shTo||''}" style="background:var(--s1);border:1px solid ${p==='custom'?'var(--g)':'var(--border)'};color:var(--text);font-family:var(--mono);font-size:11px;padding:6px 9px;border-radius:6px">
      <button onclick="shApplyCustom()" style="font-family:var(--mono);font-size:11px;padding:6px 13px;border-radius:6px;cursor:pointer;border:1px solid var(--border);background:var(--s2);color:var(--text)">Apply</button>
    </div></div>`;
}

// Hero: clearing fast enough?  +  healthier or worse?
function shHeroHtml(snaps){
  const latest=snaps[snaps.length-1], M=shM(latest);
  const flowNow=shShare90(latest, M);
  const zCol=shZoneColor(flowNow);
  const clearWord=flowNow>=SH_GOAL?'Yes':flowNow>=SH_FLOOR?'Almost':'No';
  const clearSub=flowNow>=SH_GOAL?`At or above the ${SH_GOAL}% goal.`:flowNow>=SH_FLOOR?`Above the ${SH_FLOOR}% floor, under the ${SH_GOAL}% goal.`:`Below the ${SH_FLOOR}% floor — needs attention.`;
  const moneyFmt=v=>fmtGBP(v);
  const z=shZones(latest), tot=shBucketTotal(latest)||1;
  const hasVal = shHasValuation(latest);
  const zv = hasVal ? shZoneValues(latest) : null;
  const totalVal = zv ? zv.healthy+zv.caution+zv.action : 0;
  const zM = shZonesBy(latest, M);
  const in180 = zM.total ? (zM.healthy+zM.caution)/zM.total*100 : 0;
  const in180Col = in180>=99.5 ? GOOD : ORANGE;
  const prevVal = snaps.length>1 && shHasValuation(snaps[snaps.length-2]) ? (()=>{ const pzv=shZoneValues(snaps[snaps.length-2]); return pzv.healthy+pzv.caution+pzv.action; })() : null;
  const valDiff = prevVal!=null ? totalVal-prevVal : null;
  const dl=(d,goodUp,suffix)=>d==null||Math.abs(d)<0.5?'':`<span style="color:${(d>0)===goodUp?GOOD:BAD}">${d>0?'▲ +':'▼ −'}${moneyFmt(Math.abs(d))}</span> ${suffix}`;
  const V=shVerdict();
  // £ stuck past 180 days, averaged the same way as the verdict
  const p180v = V ? (()=>{ const a=l=>{ const v=l.map(d=>shAllSnaps().find(x=>x.date===d)).filter(shHasValuation).map(x=>shZoneValues(x).action); return v.length?v.reduce((q,w)=>q+w,0)/v.length:null; }; const t=a(V.thenDates), n=a(V.nowDates); return t!=null&&n!=null?n-t:null; })() : null;
  const lab='font-family:var(--mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted2)';
  const valRow = hasVal ? `<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin-top:14px;padding-top:12px;border-top:1px solid var(--border)">
    <div><div style="${lab}">Total stock value</div>
      <div style="font-family:var(--mono);font-size:18px;font-weight:700;color:#3d9eff;margin-top:3px">${moneyFmt(latest.stockValue || totalVal)}</div>
      <div style="font-family:var(--mono);font-size:10px;color:var(--muted2);margin-top:1px">${latest.stockValue ? (()=>{ const c = coverExVat(totalVal, latest.stockValue); return `your entered figure · the ageing file covers <b style="color:${coverCol(c)}">${c!=null?c.toFixed(1)+'%':'—'}</b> of it`; })() : `${dl(valDiff,true,'vs last')} · ${tot.toLocaleString()} SKUs`}</div></div>
    <div><div style="${lab}">Past 90 days</div>
      <div style="font-family:var(--mono);font-size:18px;font-weight:700;color:${AMBER};margin-top:3px">${moneyFmt(zv.caution+zv.action)}</div>
      <div style="font-family:var(--mono);font-size:10px;color:var(--muted2);margin-top:1px">${(z.caution+z.action).toLocaleString()} SKUs${V&&V.p90v.then!=null?` · ${dl(V.p90v.now-V.p90v.then,false,'vs 2 wks')}`:''}</div></div>
    <div><div style="${lab}">Past 180 days · your limit</div>
      <div style="font-family:var(--mono);font-size:18px;font-weight:700;color:${ORANGE};margin-top:3px">${moneyFmt(zv.action)}</div>
      <div style="font-family:var(--mono);font-size:10px;color:var(--muted2);margin-top:1px">${z.action.toLocaleString()} SKUs${p180v!=null?` · ${dl(p180v,false,'vs 2 wks')}`:''}</div></div>
  </div>` : '';
  // The same stock counted every way it can be — tap one to count the whole page that way.
  const chips = Object.keys(SH_METRICS).filter(k=>shBands(latest,k)).map(k=>{ const zk=shZonesBy(latest,k), pc=zk.total?zk.healthy/zk.total*100:0;
    const of = k==='gbp' ? '' : ` · ${Math.round(zk.healthy).toLocaleString()} of ${Math.round(zk.total).toLocaleString()}`;
    return `<button class="sh-chip${k===M?' on':''}" onclick="event.stopPropagation();shSetMetric('${k}')">${SH_METRICS[k].label}<b>${pc.toFixed(1)}%</b>${of}</button>`; }).join('');

  const [glyph,word,col]=V?SH_VMAP[V.v]:['·','NEED 2 WEEKS OF ENTRIES',NEUT];
  const mv=(label,a,b,fmtv,goodUp)=>{ if(a==null||b==null) return '';
    const d=+(b-a).toFixed(1), c=Math.abs(d)<0.05?NEUT:((d>0)===goodUp?GOOD:BAD);
    return `<div style="display:flex;justify-content:space-between;gap:14px;padding:7px 0;border-top:1px solid var(--border)"><span style="color:var(--muted2)">${label}</span><b style="color:${c};white-space:nowrap">${fmtv(a)} → ${fmtv(b)}</b></div>`; };
  const pc=v=>v.toFixed(1)+'%';
  const months=shMonths(M);
  const monthsHtml = months.length>1 ? `<div style="margin-top:14px"><div style="${lab}">By month · average ${SH_METRICS[M].by}</div>
      <div class="sh-months">${months.map(x=>`<div class="sh-month" title="${x.n} entr${x.n===1?'y':'ies'}"><em>${new Date(x.month+'-01T00:00:00').toLocaleDateString('en-GB',{month:'short'})}</em><b style="color:${shZoneColor(x.pct)}">${x.pct.toFixed(1)}%</b></div>`).join('')}</div></div>` : '';
  const vBody = V ? `
      ${V.why?`<div style="font-family:var(--mono);font-size:12.5px;color:${ORANGE};margin-top:8px">${V.why}</div>`:''}
      <div style="margin-top:12px;font-family:var(--mono);font-size:12px">
        ${mv('Under 90 days · share of £',V.val.then,V.val.now,pc,true)}
        ${mv('Under 90 days · share of SKUs',V.sku.then,V.sku.now,pc,true)}
        ${mv('£ past 90 days',V.p90v.then,V.p90v.now,v=>moneyFmt(v),false)}
        ${mv('SKUs past 90 days',V.p90.then,V.p90.now,v=>Math.round(v).toLocaleString(),false)}
      </div>
      <div style="font-family:var(--mono);font-size:10px;color:var(--muted);margin-top:8px">${kfEsc(shVerdictTitle(V).split(' · ')[0])} — averaged, so one delivery can't swing it</div>`
    : `<div style="font-family:var(--mono);font-size:11px;color:var(--muted2);margin-top:12px">Needs an entry from about two weeks ago to compare with.</div>`;

  return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
    <div style="background:var(--s1);border:1px solid var(--border);border-radius:14px;padding:20px 22px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px;flex-wrap:wrap">
        <div style="font-family:var(--mono);font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted2)">Clearing fast enough?</div>
        <div style="display:flex;gap:8px;align-items:center">${shMetricSwitch(latest)}<button class="sh-btn" onclick="event.stopPropagation();shOpenFlowDetail()">View graph ↗</button></div>
      </div>
      <div style="display:flex;align-items:baseline;gap:14px">
        <div style="font-size:46px;font-weight:700;line-height:1;color:${zCol}">${flowNow}%</div>
        <div><div style="font-size:17px;font-weight:600;color:${zCol}">${clearWord}</div>
        <div style="font-family:var(--mono);font-size:10px;color:var(--muted2);max-width:250px;line-height:1.4">${M==='gbp'?'of your stock value':`of your ${SH_METRICS[M].label}`} is under 90 days old · ${clearSub}</div></div>
      </div>
      <div class="sh-chips">${chips}</div>
      <div style="position:relative;height:14px;background:var(--s3);border-radius:7px;margin-top:12px">
        <div style="position:absolute;left:0;top:0;bottom:0;width:${Math.min(flowNow,100)}%;background:${zCol};border-radius:7px;transition:width .4s"></div>
        <div style="position:absolute;left:${SH_FLOOR}%;top:-5px;bottom:-5px;width:2px;background:${AMBER}"></div>
        <div style="position:absolute;left:${SH_GOAL}%;top:-5px;bottom:-5px;width:2px;background:${GOOD}"></div>
      </div>
      <div style="position:relative;height:14px;margin-top:3px;font-family:var(--mono);font-size:10px">
        <span style="position:absolute;left:${SH_FLOOR}%;transform:translateX(calc(-100% - 4px));color:${AMBER};white-space:nowrap">floor ${SH_FLOOR}%</span>
        <span style="position:absolute;left:${SH_GOAL}%;transform:translateX(4px);color:${GOOD};white-space:nowrap">goal ${SH_GOAL}%</span>
      </div>
      <div style="font-family:var(--mono);font-size:10.5px;color:var(--muted2);margin-top:8px">Within 180 days (your limit): <b style="color:${in180Col}">${in180.toFixed(1)}%</b> ${SH_METRICS[M].by} <span style="color:var(--muted)">— goal 100%</span></div>
      ${(() => { const RU = typeof rpRollup === 'function' ? rpRollup() : null; if (!RU || !RU.oc.all) return '';
        const oc = RU.oc, cov = oc.checked / oc.all * 100;
        if (!oc.of || cov < 30) return `<div class="sh-oncourse dim">On course for day 90: <b>not known yet</b> — ${cov ? `${cov.toFixed(0)}% of the stock inside 90 days has been checked; ` : ''}check providers on the Repricer page and this fills in from 30%.</div>`;
        const pc = oc.on / oc.of * 100, col = pc >= SH_GOAL ? 'var(--g)' : pc >= SH_FLOOR ? 'var(--y)' : 'var(--o)';
        return `<div class="sh-oncourse" title="Of the stock still inside 90 days, how much will sell by its day 90 at today's prices (the Repricer's calls: wait or raise, and the queue clears in time)">On course for day 90: <b style="color:${col}">${pc.toFixed(0)}%</b> of the £ still inside 90 days at today's prices <span>· from ${cov.toFixed(0)}% of it checked in the Repricer</span></div>`; })()}
      ${valRow}
    </div>
    <div style="background:var(--s1);border:1px solid var(--border);border-radius:14px;padding:20px 22px">
      <div style="font-family:var(--mono);font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted2);margin-bottom:8px">Getting healthier or worse? · 2 weeks</div>
      <div style="display:flex;align-items:center;gap:12px">
        <div style="font-size:30px;line-height:1;color:${col}">${glyph}</div>
        <div style="font-size:25px;font-weight:700;line-height:1.05;color:${col}">${word}</div>
      </div>
      ${vBody}
      ${monthsHtml}
    </div></div>`;
}

// ── Stock Health flow detail popup — full line graph over all history ──
let _shFlowDetailRange = 'period'; // 'period' | 'all'
function shOpenFlowDetail(){
  _shFlowDetailRange = 'period';
  shRenderFlowDetail();
  document.getElementById('shFlowDetailModal').classList.add('open');
}
function shSetFlowDetailRange(r){ _shFlowDetailRange=r; shRenderFlowDetail(); }

function shRenderFlowDetail(){
  const snaps = _shFlowDetailRange==='all' ? shAllSnaps() : shFilteredSnaps();
  if(!snaps.length) return;
  const M = shM(snaps[snaps.length-1]);
  const pts = snaps.filter(s=>shBands(s,M)).map(s=>({ date:s.date, flow:shShare90(s,M) }));
  if(!pts.length) return;
  const flows = pts.map(p=>p.flow);
  const latest = flows[flows.length-1];
  const first  = flows[0];
  const prev   = flows.length>1 ? flows[flows.length-2] : null;
  const diff   = prev!=null ? +(latest-prev).toFixed(1) : null;
  const peak   = Math.max(...flows), low = Math.min(...flows);
  const peakDate = pts[flows.indexOf(peak)]?.date, lowDate = pts[flows.indexOf(low)]?.date;
  const net    = flows.length>=2 ? +(latest-first).toFixed(1) : null;
  const avg    = +(flows.reduce((a,b)=>a+b,0)/flows.length).toFixed(1);

  // Trend direction (higher flow = healthier)
  const tr = (()=>{ if(pts.length<2) return null; const x0=new Date(pts[0].date+'T00:00:00').getTime(); const q=pts.map(p=>({x:(new Date(p.date+'T00:00:00').getTime()-x0)/864e5,y:p.flow})); const n=q.length,sx=q.reduce((a,b)=>a+b.x,0),sy=q.reduce((a,b)=>a+b.y,0),sxx=q.reduce((a,b)=>a+b.x*b.x,0),sxy=q.reduce((a,b)=>a+b.x*b.y,0),den=n*sxx-sx*sx; return {perWeek:den?((n*sxy-sx*sy)/den)*7:0}; })();
  const perWeek = tr?+tr.perWeek.toFixed(2):null;
  let dirWord,dirCol,dirGlyph;
  if(perWeek==null){dirWord='Not enough data';dirCol=NEUT;dirGlyph='·';}
  else if(perWeek>0.3){dirWord='Getting healthier';dirCol=GOOD;dirGlyph='▲';}
  else if(perWeek<-0.3){dirWord='Getting worse';dirCol=BAD;dirGlyph='▼';}
  else{dirWord='Holding steady';dirCol=NEUT;dirGlyph='→';}

  document.getElementById('shFlowDetailSub').textContent =
    `Under 90 days ${SH_METRICS[M].by} · ${fmt(pts[0].date)} → ${fmt(pts[pts.length-1].date)} · ${pts.length} entries · higher % = healthier`;

  const zCol = shZoneColor(latest);
  const diffCol = diff==null?NEUT:diff>0?GOOD:diff<0?BAD:NEUT;
  const diffStr = diff==null?'—':(diff>0?'▲ +':'▼ ')+Math.abs(diff)+'pp vs last';
  const card=(label,val,sub,col)=>`
    <div style="background:var(--s1);border:1px solid var(--border);border-top:3px solid ${col};border-radius:12px;padding:14px 16px">
      <div style="font-family:var(--mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:${col};margin-bottom:6px">${label}</div>
      <div style="font-family:var(--mono);font-size:24px;font-weight:700;color:var(--text);line-height:1">${val}</div>
      <div style="font-family:var(--mono);font-size:10px;color:var(--muted2);margin-top:6px">${sub}</div>
    </div>`;

  const statGrid=`<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px">
    ${card('Now · '+SH_METRICS[M].by, latest+'%', diffStr, zCol)}
    ${card('Record high', peak+'%', fmt(peakDate), GOOD)}
    ${card('Record low', low+'%', fmt(lowDate), BAD)}
    ${card('Average', avg+'%', `over ${pts.length} snapshots`, NEUT)}
  </div>`;

  const metaRow=`<div style="display:flex;align-items:center;gap:20px;flex-wrap:wrap;margin-bottom:14px;padding:12px 16px;background:${dirCol==GOOD?'rgba(34,197,94,.08)':dirCol==BAD?'rgba(255,77,109,.08)':'var(--s2)'};border:1px solid var(--border);border-radius:10px">
    <div style="display:flex;align-items:center;gap:8px">
      <span style="font-size:20px;color:${dirCol}">${dirGlyph}</span>
      <span style="font-size:16px;font-weight:700;color:${dirCol}">${dirWord}</span>
    </div>
    ${perWeek!=null?`<span style="font-family:var(--mono);font-size:11px;color:var(--muted2)">Trend: <b style="color:${dirCol}">${perWeek>0?'+':''}${perWeek}pp/wk</b></span>`:''}
    ${net!=null?`<span style="font-family:var(--mono);font-size:11px;color:var(--muted2)">Net over window: <b style="color:${net>0?GOOD:net<0?BAD:NEUT}">${net>0?'+':''}${net}pp</b></span>`:''}
  </div>`;

  const toggle=`<div style="display:inline-flex;border:1px solid var(--border);border-radius:8px;overflow:hidden">
    <button onclick="shSetFlowDetailRange('period')" style="font-family:var(--mono);font-size:10px;padding:6px 14px;background:${_shFlowDetailRange==='period'?'var(--g)':'none'};color:${_shFlowDetailRange==='period'?'var(--bg)':'var(--muted2)'};border:none;cursor:pointer;font-weight:${_shFlowDetailRange==='period'?700:400}">This period</button>
    <button onclick="shSetFlowDetailRange('all')" style="font-family:var(--mono);font-size:10px;padding:6px 14px;background:${_shFlowDetailRange==='all'?'var(--g)':'none'};color:${_shFlowDetailRange==='all'?'var(--bg)':'var(--muted2)'};border:none;cursor:pointer;font-weight:${_shFlowDetailRange==='all'?700:400}">All time</button>
  </div>`;

  const chartSection=`<div style="background:var(--s2);border:1px solid var(--border);border-radius:10px;padding:14px;margin-bottom:16px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:8px">
      <div style="font-family:var(--mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted2)">0–90d flow % over time</div>
      ${toggle}
    </div>
    <div style="height:260px"><canvas id="shFlowDetailChart"></canvas></div>
    <div style="display:flex;gap:16px;margin-top:10px;font-family:var(--mono);font-size:10px;color:var(--muted2)">
      <span><span style="display:inline-block;width:16px;height:2px;background:${GOOD};vertical-align:middle;margin-right:4px"></span>Goal ${SH_GOAL}%</span>
      <span><span style="display:inline-block;width:16px;height:2px;background:${AMBER};vertical-align:middle;margin-right:4px"></span>Floor ${SH_FLOOR}%</span>
    </div>
  </div>`;

  const tableRows=pts.slice().reverse().map((p,ri)=>{
    const realIdx=pts.length-1-ri;
    const prevPt=realIdx>0?pts[realIdx-1]:null;
    const d=prevPt!=null?+(p.flow-prevPt.flow).toFixed(1):null;
    const dCol=d==null?NEUT:d>0?GOOD:d<0?BAD:NEUT;
    const dStr=d==null?'—':(d>0?'+':'')+d+'pp';
    const fCol=shZoneColor(p.flow);
    const isPeak=p.flow===peak, isLow=p.flow===low;
    return `<tr>
      <td style="color:var(--g)">${fmt(p.date)}</td>
      <td style="font-weight:700;color:${fCol}">${p.flow}%${isPeak?' <span style="font-family:var(--mono);font-size:9px;color:'+GOOD+';background:rgba(34,197,94,.12);padding:1px 5px;border-radius:3px">HIGH</span>':isLow?' <span style="font-family:var(--mono);font-size:9px;color:'+BAD+';background:rgba(255,77,109,.12);padding:1px 5px;border-radius:3px">LOW</span>':''}</td>
      <td style="font-family:var(--mono);font-size:11px;color:${dCol}">${dStr}</td>
    </tr>`;
  }).join('');

  document.getElementById('shFlowDetailBody').innerHTML = statGrid+metaRow+chartSection+
    `<div style="font-family:var(--mono);font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);margin-bottom:8px">Snapshot history</div>
    <div style="max-height:220px;overflow-y:auto"><table class="history-table">
      <thead><tr><th>Date</th><th>Flow %</th><th>vs Previous</th></tr></thead>
      <tbody>${tableRows}</tbody>
    </table></div>`;

  setTimeout(()=>{
    destroyChart('shFlowDetailChart');
    const cv=document.getElementById('shFlowDetailChart');
    if(!cv||typeof Chart==='undefined') return;
    const vals=pts.map(p=>p.flow);
    const labels=pts.map(p=>fmtShort(p.date));
    const dataMin=Math.min(...vals,SH_FLOOR), dataMax=Math.max(...vals,SH_GOAL);
    const lo=Math.max(0,dataMin-5), hi=Math.min(100,dataMax+5);
    chartInstances['shFlowDetailChart']=new Chart(cv.getContext('2d'),{
      type:'line',
      data:{ labels, datasets:[
        { data:vals, borderColor:'#00f5a0', backgroundColor:'rgba(0,245,160,.1)',
          borderWidth:2.5, tension:.3, fill:true, pointRadius:4, pointHoverRadius:6,
          pointBackgroundColor:vals.map(v=>v===peak?GOOD:v===low?BAD:'#00f5a0'),
          pointBorderColor:'#07090c', pointBorderWidth:1.5, order:1 },
        { data:vals.map(()=>SH_GOAL), borderColor:GOOD, borderWidth:1, borderDash:[5,4], pointRadius:0, fill:false, order:2 },
        { data:vals.map(()=>SH_FLOOR), borderColor:AMBER, borderWidth:1, borderDash:[5,4], pointRadius:0, fill:false, order:3 }
      ]},
      options:{ responsive:true, maintainAspectRatio:false, interaction:{mode:'index',intersect:false},
        plugins:{ legend:{display:false}, datalabels:{display:false},
          tooltip:{ backgroundColor:'rgba(7,9,12,.98)', titleColor:'#dce6f0', bodyColor:'#dce6f0',
            borderColor:'#00f5a0', borderWidth:1, padding:8, displayColors:false,
            filter:item=>item.datasetIndex===0,
            callbacks:{ title:items=>fmt(pts[items[0].dataIndex].date),
              label:ctx=>{
                const v=ctx.parsed.y;
                const status=v>=SH_GOAL?'✓ above goal':v>=SH_FLOOR?'above floor':'below floor';
                return `${v}% flow — ${status}${v===peak?' · record high':v===low?' · record low':''}`;
              } } } },
        scales:{
          y:{ min:lo, max:hi, grid:{color:'#1c2330'}, ticks:{color:'#a7b4c4',callback:v=>v+'%'} },
          x:{ grid:{display:false}, ticks:{color:'#a7b4c4',maxRotation:0,autoSkip:true,maxTicksLimit:12} }
        }
      }
    });
  },60);
}

// 3-zone summary — clickable cards, each opens a trend popup for that zone
let _shZoneSnaps=null, _shZoneCurrent=null, _shZoneRange='n6';
const _shZoneGetters={
  healthy:s=>{const a=s.ageing||{};return (a.a0||0)+(a.a31||0)+(a.a61||0);},
  caution:s=>{const a=s.ageing||{};return a.a91||0;},
  action:s=>{const a=s.ageing||{};return (a.a181||0)+(a.a271||0)+(a.a365||0);}
};
const _shZoneCols={healthy:GOOD,caution:AMBER,action:ORANGE};
const _shZoneLabels={healthy:'Healthy 0–90d',caution:'Caution 91–180d',action:'Action 181d+'};
let _shZoneMetric=({ gbp:'value', sku:'skus', asin:'asins', units:'skus' })[SH_METRIC] || 'skus';   // opens on the page's own measure (£ by default), not SKUs // 'skus' | 'asins' | 'pct' | 'value' — what the zone popup chart shows
// % of total stock in this zone
const _shZonePctGetters={
  healthy:s=>{const t=shBucketTotal(s)||1;return +(( _shZoneGetters.healthy(s)/t)*100).toFixed(1);},
  caution:s=>{const t=shBucketTotal(s)||1;return +(( _shZoneGetters.caution(s)/t)*100).toFixed(1);},
  action:s=>{const t=shBucketTotal(s)||1;return +(( _shZoneGetters.action(s)/t)*100).toFixed(1);}
};
// £ valuation in this zone
const _shZoneValGetters={
  healthy:s=>shHasValuation(s)?shZoneValues(s).healthy:0,
  caution:s=>shHasValuation(s)?shZoneValues(s).caution:0,
  action:s=>shHasValuation(s)?shZoneValues(s).action:0
};
// ASIN-level ageing: an ASIN sits in the oldest bucket any of its SKUs reached, so an ASIN
// only counts as healthy when every one of its SKUs is. Harsher than the SKU count, because
// re-buying a product you already own mints a fresh SKU and pads the SKU figure.
function shHasAsins(s){ return !!(s && s.ageingAsin); }
function shAsinTotal(s){ const a=s.ageingAsin||{}; return AG_BUCKETS.reduce((n,b)=>n+(a[b.key]||0),0); }
const _shZoneAsinGetters={
  healthy:s=>{const a=s.ageingAsin;return a?(a.a0||0)+(a.a31||0)+(a.a61||0):null;},
  caution:s=>{const a=s.ageingAsin;return a?(a.a91||0):null;},
  action:s=>{const a=s.ageingAsin;return a?(a.a181||0)+(a.a271||0)+(a.a365||0):null;}
};

// Higher = better for Healthy; lower = better for Caution/Action
function _shZoneGoodCol(zone,net){ return zone==='healthy'?(net>0?GOOD:BAD):(net>0?BAD:GOOD); }

function shSetZoneRange(r){ _shZoneRange=r; shRenderZonePopup(); }

function shRenderZonePopup(){
  const zone=_shZoneCurrent; if(!zone||!_shZoneSnaps) return;
  const allSnaps=[..._shZoneSnaps].sort((a,b)=>a.date.localeCompare(b.date));
  // apply range
  let snaps=allSnaps;
  if(_shZoneRange==='n6'){
    snaps=allSnaps.slice(-6);            // last 6 snapshots by count, regardless of dates
  } else if(_shZoneRange!=='all'){
    const days={d30:30,d90:90,d180:180}[_shZoneRange]||9999;
    const maxD=allSnaps[allSnaps.length-1]?.date;
    if(maxD){const cut=new Date(maxD+'T00:00:00');cut.setDate(cut.getDate()-days);const cs=cut.toLocaleDateString('en-CA');snaps=allSnaps.filter(s=>s.date>=cs);}
  }
  if(!snaps.length) snaps=allSnaps;
  const col=_shZoneCols[zone];
  // Pick getter + formatter by metric. Fall back to SKUs if no valuation data.
  const hasVal  = snaps.some(s=>shHasValuation(s));
  const hasAsin = snaps.some(shHasAsins);
  let metric = _shZoneMetric;
  if (metric==='value' && !hasVal)  metric='skus';
  if (metric==='asins' && !hasAsin) metric='skus';

  // Exclude snapshots with no data for the chosen metric — those are pre-migration records
  // where it was never captured, not genuine zero readings. Plotting them as 0 drags the
  // line to the floor and invents a collapse that never happened.
  let chartSnaps = snaps;
  if (metric==='value') {
    const withVal = snaps.filter(s=>shHasValuation(s));
    if (withVal.length) chartSnaps = withVal;
  } else if (metric==='asins') {
    const withAsin = snaps.filter(shHasAsins);
    if (withAsin.length) chartSnaps = withAsin;
  }

  const getter = metric==='pct' ? _shZonePctGetters[zone]
               : metric==='value' ? _shZoneValGetters[zone]
               : metric==='asins' ? _shZoneAsinGetters[zone]
               : _shZoneGetters[zone];
  const moneyFmt=v=>'£'+(v||0).toLocaleString(undefined,{maximumFractionDigits:0});
  const fmtVal = metric==='pct' ? (v=>v+'%')
               : metric==='value' ? moneyFmt
               : (v=>v.toLocaleString());
  const unitLabel = metric==='pct' ? '% of stock' : metric==='value' ? 'valuation'
                  : metric==='asins' ? 'ASINs' : 'SKUs';

  const data=chartSnaps.map(getter);
  const pad = metric==='value' ? Math.max(500,(Math.max(...data)-Math.min(...data))*0.15) : metric==='pct' ? 3 : 5;
  const lo=Math.max(0,Math.min(...data)-pad), hi=Math.max(...data)+pad;
  const first=data[0],last=data[data.length-1],net=+(last-first).toFixed(metric==='pct'?1:0);
  const peak=Math.max(...data), trough=Math.min(...data);
  const missingN = chartSnaps.length<snaps.length ? snaps.length-chartSnaps.length : 0;
  const missingValNote = !missingN ? ''
    : metric==='value' ? ` · ${missingN} early snapshot${missingN!==1?'s':''} without £ data hidden`
    : metric==='asins' ? ` · ${missingN} snapshot${missingN!==1?'s':''} taken before ASINs were captured hidden`
    : '';
  const periodLabel=(_shZoneRange==='n6'?`Last ${chartSnaps.length} snapshots`
    :chartSnaps.length===allSnaps.length?`All data (${chartSnaps.length} snapshots)`
    :`${fmt(chartSnaps[0].date)} → ${fmt(chartSnaps[chartSnaps.length-1].date)} (${chartSnaps.length} snapshots)`)+missingValNote;

  // stats — peak/trough colour depends on zone direction
  const peakCol  = zone==='healthy'?GOOD:BAD;
  const troughCol= zone==='healthy'?BAD:GOOD;
  const netCol=_shZoneGoodCol(zone,net);

  const el=id=>document.getElementById(id);
  if(el('shZonePopupTitle')) el('shZonePopupTitle').textContent=_shZoneLabels[zone]+' '+unitLabel+' over time';
  if(el('shZonePopupTitle')) el('shZonePopupTitle').style.color=col;
  if(el('shZonePopupPeriod')) el('shZonePopupPeriod').textContent=periodLabel;

  // metric toggle active states — a button whose data does not exist yet is hidden rather
  // than shown dead, so nothing on screen offers a view it cannot draw
  const mBtnVal = el('shZM_value');
  if (mBtnVal) mBtnVal.style.display = hasVal ? '' : 'none';
  const mBtnAsin = el('shZM_asins');
  if (mBtnAsin){
    mBtnAsin.style.display = hasAsin ? '' : 'none';
    mBtnAsin.title = 'How many of your products are clean, not how many stock lines — an ASIN counts as old if any of its SKUs is';
  }
  ['skus','asins','pct','value'].forEach(m=>{
    const btn=el('shZM_'+m);
    if(btn){ const on=metric===m;
      btn.style.background=on?col+'28':'var(--s3)';
      btn.style.color=on?col:'var(--muted2)';
      btn.style.borderColor=on?col:'var(--border)'; }
  });

  // range button active states
  ['n6','all','d180','d90','d30'].forEach(r=>{
    const btn=el('shZRP_'+r);
    if(btn){ btn.style.background=_shZoneRange===r?col+'28':'var(--s3)';
      btn.style.color=_shZoneRange===r?col:'var(--muted2)';
      btn.style.borderColor=_shZoneRange===r?col:'var(--border)'; }
  });

  if(el('shZonePopupStats')) el('shZonePopupStats').innerHTML=
    `<div style="display:flex;gap:22px;flex-wrap:wrap">
      <span style="font-family:var(--mono);font-size:11px;color:var(--muted2)">First: <b style="color:var(--text)">${fmtVal(first)}</b></span>
      <span style="font-family:var(--mono);font-size:11px;color:var(--muted2)">Latest: <b style="color:${col}">${fmtVal(last)}</b></span>
      <span style="font-family:var(--mono);font-size:11px;color:var(--muted2)">Net: <b style="color:${netCol}">${net>0?'+':''}${metric==='value'?moneyFmt(net):net}${metric==='pct'?'pp':''}</b></span>
      <span style="font-family:var(--mono);font-size:11px;color:var(--muted2)">Peak: <b style="color:${peakCol}">${fmtVal(peak)}</b></span>
      <span style="font-family:var(--mono);font-size:11px;color:var(--muted2)">Trough: <b style="color:${troughCol}">${fmtVal(trough)}</b></span>
    </div>`;

  destroyChart('shZonePopup');
  setTimeout(()=>{
    const cv=el('shZonePopupChart'); if(!cv||typeof Chart==='undefined') return;
    chartInstances['shZonePopup']=new Chart(cv.getContext('2d'),{
      type:'line',
      data:{labels:chartSnaps.map(s=>fmtShort(s.date)),datasets:[{
        data, borderColor:col, backgroundColor:col+'18', borderWidth:2,
        tension:.3, fill:true, pointRadius:3.5, pointHoverRadius:6,
        pointBackgroundColor:col, pointBorderColor:'#07090c', pointBorderWidth:1.5
      }]},
      options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
        plugins:{legend:{display:false},datalabels:{display:false},
          tooltip:{callbacks:{title:items=>fmt(chartSnaps[items[0].dataIndex].date),label:ctx=>fmtVal(ctx.parsed.y)+(metric==='skus'?' SKUs':metric==='pct'?' of stock':'')}}},
        scales:{
          y:{min:lo,max:hi,grid:{color:'#1c2330'},ticks:{color:'#a7b4c4',callback:v=>metric==='value'?moneyFmt(v):metric==='pct'?v+'%':v}},
          x:{grid:{display:false},ticks:{color:'#a7b4c4',maxRotation:0,autoSkip:true,maxTicksLimit:10}}
        }}
    });
  },30);
}

function shSetZoneMetricPopup(m){ _shZoneMetric=m; shRenderZonePopup(); }

function shOpenZonePopup(zone){
  if(!_shZoneSnaps||!_shZoneSnaps.length) return;
  _shZoneCurrent=zone;
  _shZoneRange='n6';
  // Deliberately NOT resetting _shZoneMetric — picking ASINs and then opening another zone
  // used to silently drop you back to SKUs.
  let modal=document.getElementById('shZoneModal');
  if(!modal){
    modal=document.createElement('div');
    modal.id='shZoneModal';
    modal.style.cssText='display:none;position:fixed;inset:0;z-index:9999;background:rgba(7,9,12,.82);backdrop-filter:blur(4px);align-items:center;justify-content:center';
    const rBtn=(r,l)=>`<button id="shZRP_${r}" onclick="shSetZoneRange('${r}')" style="font-family:var(--mono);font-size:10px;padding:5px 11px;border-radius:5px;cursor:pointer;border:1px solid var(--border);background:var(--s3);color:var(--muted2)">${l}</button>`;
    const mBtn=(m,l)=>`<button id="shZM_${m}" onclick="shSetZoneMetricPopup('${m}')" style="font-family:var(--mono);font-size:10px;padding:5px 11px;border-radius:5px;cursor:pointer;border:1px solid var(--border);background:var(--s3);color:var(--muted2)">${l}</button>`;
    modal.innerHTML=`<div style="background:var(--s1);border:1px solid var(--border);border-radius:16px;padding:24px 26px;width:min(720px,92vw);box-shadow:0 24px 60px rgba(0,0,0,.6)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
        <span id="shZonePopupTitle" style="font-family:var(--mono);font-size:13px;letter-spacing:.1em;text-transform:uppercase;font-weight:700"></span>
        <button onclick="document.getElementById('shZoneModal').style.display='none'" style="background:var(--s3);border:1px solid var(--border);color:var(--muted2);font-size:18px;cursor:pointer;padding:4px 10px;border-radius:6px;line-height:1">×</button>
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:8px">
        <span id="shZonePopupPeriod" style="font-family:var(--mono);font-size:10px;color:var(--muted2)"></span>
        <div style="display:flex;gap:12px;flex-wrap:wrap">
          <div style="display:flex;gap:5px;padding-right:12px;border-right:1px solid var(--border)">${mBtn('skus','SKUs')}${mBtn('asins','ASINs')}${mBtn('pct','%')}${mBtn('value','£')}</div>
          <div style="display:flex;gap:6px">${rBtn('n6','Last 6')}${rBtn('d30','30d')}${rBtn('d90','90d')}${rBtn('d180','6m')}${rBtn('all','All')}</div>
        </div>
      </div>
      <div style="height:260px"><canvas id="shZonePopupChart"></canvas></div>
      <div id="shZonePopupStats" style="margin-top:14px;padding-top:12px;border-top:1px solid var(--border)"></div>
    </div>`;
    modal.addEventListener('click',e=>{if(e.target===modal) modal.style.display='none';});
    document.body.appendChild(modal);
  }
  modal.style.display='flex';
  shRenderZonePopup();
}
// A small trend line for a tile: area + line + last point, scaled to its own range.
function shSpark(vals, col){
  if (!vals || vals.length < 2) return '';
  const W = 300, H = 38, lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
  const pts = vals.map((v, i) => [i / (vals.length - 1) * W, H - 4 - (v - lo) / span * (H - 8)]);
  const line = pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
  const last = pts[pts.length - 1];
  return `<svg class="sh-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
    <polygon points="0,${H} ${line} ${W},${H}" fill="${col}" fill-opacity=".12"/>
    <polyline points="${line}" fill="none" stroke="${col}" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>
    <circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="3" fill="${col}"/></svg>`;
}
function shZoneSummaryHtml(snaps){
  _shZoneSnaps=snaps;
  const latest=snaps[snaps.length-1], prev=snaps.length>1?snaps[snaps.length-2]:null, M=shM(latest);
  const z=shZonesBy(latest,M), pz=prev&&shBands(prev,M)?shZonesBy(prev,M):null;
  const zs=shZones(latest), zv=shHasValuation(latest)?shZoneValues(latest):null;
  const card=(name,sub,zone,zoneCol,goodUp)=>{
    const val=z[zone], delta=pz?val-pz[zone]:null;
    let dHtml='';
    if(delta!=null){ const zero=Math.abs(delta)<(M==='gbp'?0.5:0.5); const c=zero?NEUT:(goodUp?(delta>0?GOOD:BAD):(delta>0?BAD:GOOD));
      dHtml=`<span style="color:${c};font-weight:700">${zero?'→ ':delta>0?'▲ +':'▼ −'}${zero?'0':shFmtM(Math.abs(delta),M)}</span> <span style="color:var(--muted2)">vs last</span>`; }
    // the other way of counting it, so £ and SKUs are always both on the tile
    const other = M==='gbp' ? `${zs[zone].toLocaleString()} SKUs` : (zv?fmtGBP(zv[zone]):'');
    return `<div onclick="shOpenZonePopup('${zone}')" style="background:var(--s1);border:1px solid var(--border);border-top:3px solid ${zoneCol};border-radius:12px;padding:16px 18px;cursor:pointer;transition:transform .15s,border-color .15s" onmouseover="this.style.borderColor='${zoneCol}';this.style.transform='translateY(-2px)'" onmouseout="this.style.borderColor='var(--border)';this.style.transform='none'">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:2px">
        <div style="font-family:var(--mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:${zoneCol}">${name}</div>
        <div style="font-family:var(--mono);font-size:10px;color:var(--muted2)">open ↗</div>
      </div>
      <div style="font-family:var(--mono);font-size:10px;color:var(--muted2);margin-bottom:10px">${sub}</div>
      <div style="font-family:var(--mono);font-size:30px;font-weight:700;color:var(--text);line-height:1">${shFmtM(val,M)}<span style="font-size:13px;color:var(--muted2);font-weight:600">${shUnitM(M,val)}</span></div>
      <div style="font-family:var(--mono);font-size:11px;color:var(--muted2);margin-top:8px">${z.total?((val/z.total)*100).toFixed(1):'0.0'}% of stock ${SH_METRICS[M].by}${other?` · <span style="color:${zoneCol}">${other}</span>`:''}</div>
      <div style="font-family:var(--mono);font-size:11px;margin-top:4px">${dHtml||'<span style="color:var(--muted2)">—</span>'}</div>
      ${shSpark(snaps.filter(x=>shBands(x,M)).map(x=>shZonesBy(x,M)[zone]), zoneCol)}
    </div>`;
  };
  return `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:16px">
    ${card('Healthy','under 90 days old · on track','healthy',GOOD,true)}
    ${card('Caution','91–180 days · missed 90, inside your 180','caution',AMBER,false)}
    ${card('Action','181+ days · past your 180-day limit','action',ORANGE,false)}
  </div>`;
}

function shGraphContainerHtml(canvasId, snaps){
  const M=snaps&&snaps.length?shM(snaps[snaps.length-1]):'sku';
  const LINE_COL={gbp:'#3d9eff',sku:'#00f5a0',asin:'#c084fc',units:'#ffd166'};
  const keys=Object.keys(SH_METRICS).filter(k=>(snaps||[]).some(s=>shBands(s,k)));
  return `<div style="background:var(--s1);border:1px solid var(--border);border-radius:14px;padding:18px 20px;margin-bottom:16px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;flex-wrap:wrap;gap:6px">
      <div style="font-family:var(--mono);font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--text)">Under 90 days, over time</div>
      <div class="sh-legend">${keys.map(k=>`<span style="${k===M?'color:var(--text);font-weight:600':''}"><i style="border-color:${LINE_COL[k]};${k===M?'border-top-width:3px':'border-top-style:dashed'}"></i>by ${SH_METRICS[k].label}</span>`).join('')}<span style="color:var(--muted)">hover a point for that entry</span></div>
    </div>
    <div style="height:240px"><canvas id="${canvasId}"></canvas></div>
  </div>`;
}

// Pipeline — bars + neutral count + movement as its own coloured number
// ── Pipeline compare toggle ──────────────────────────────────────────────
let _shCompare = false;
function shToggleCompare(){
  _shCompare = !_shCompare;
  const snaps = shFilteredSnaps();
  const el = document.getElementById('shPipelineWrap');
  if(el) el.outerHTML = shPipelineHtml(snaps);
}

function shPipelineHtml(snaps){
  const latest=snaps[snaps.length-1], prev=snaps.length>1?snaps[snaps.length-2]:null;
  // Bars in whatever the page is counted in (£ by default)
  const M=shM(latest), fm=v=>shFmtM(v,M);
  const toObj=b=>b?Object.fromEntries(AG_BUCKETS.map((x,i)=>[x.key,b[i]])):{};
  const ag=toObj(shBands(latest,M)); const total=AG_BUCKETS.reduce((t,x)=>t+(ag[x.key]||0),0)||1;
  const prevAg=prev?toObj(shBands(prev,M)||shBands(prev,'sku')):{};
  // Net change per band is exact (two totals). Where it came from is only shown when both entries
  // carry each SKU — never guessed.
  const ex=prev?shBandFlows(prev.date, latest.date, M):null;
  const flows=prev?AG_BUCKETS.map((b,i)=>{ const x=ex?ex[i]:null;
    return { net:(ag[b.key]||0)-(prevAg[b.key]||0), exact:!!x,
      agedIn:x?x.inYounger:0, younger:x?x.inOlder:0, newArrivals:x?x.newIn:0, agedOut:x?x.outOlder:0, refreshed:x?x.outYounger:0, sold:x?x.gone:0 }; }):null;

  // Ghost: the entry nearest 14 days back (entries are every 2–3 days, so not "6 entries ago")
  const allSnaps=shAllSnaps();
  const ghostSnap=snapDaysBack(allSnaps, 14, 4) || (allSnaps.length>=7?allSnaps[allSnaps.length-7]:allSnaps[0]);
  const ghostAg=ghostSnap?toObj(shBands(ghostSnap,M)||shBands(ghostSnap,'sku')):{};
  const ghostDate=ghostSnap?fmt(ghostSnap.date):'';
  const showGhost=_shCompare&&ghostSnap&&ghostSnap.date!==latest.date;

  const ghostCnts=AG_BUCKETS.map(b=>ghostAg[b.key]||0);
  const maxCnt=Math.max(1,...AG_BUCKETS.map(b=>ag[b.key]||0),...(showGhost?ghostCnts:[0]));
  const TAIL_COL='#3d9eff';   // blue = moved in — never a zone colour, so it reads on every bar

  // Valuation per bucket — only shown when latest snapshot has ageing value data
  const hasVal = shHasValuation(latest);
  const zv = hasVal ? shZoneValues(latest) : null;
  const moneyFmt=v=>'£'+(v||0).toLocaleString(undefined,{maximumFractionDigits:0});
  // Map each bucket key to its zone's total value
  // (buckets aggregate into zones: healthy=a0+a31+a61, caution=a91, action=a181+a271+a365)
  // Use per-bucket ratio of SKU count to attribute zone value to each bucket proportionally
  const ageingVal = hasVal ? (latest.ageingValue||{}) : null;
  const getBucketVal = (bkey) => {
    if (!ageingVal) return 0;
    const key = bkey.replace('a','a'); // already matches: a0, a31, etc
    return incVat(ageingVal[key]||0);
  };

  let rows='';
  AG_BUCKETS.forEach((b,idx)=>{
    const cnt=ag[b.key]||0; const f=flows?flows[idx]:null;
    const net=f?f.net:0;
    const ghostCnt=showGhost?(ghostAg[b.key]||0):0;
    const bucketVal = getBucketVal(b.key);

    const movedIn=f&&f.exact?f.agedIn+f.newArrivals+f.younger:0;
    const prevCnt=Math.max(0,cnt-movedIn);
    const mainW=(prevCnt/maxCnt)*100;
    const tailRaw=movedIn>0?(movedIn/maxCnt)*100:0;
    const tailW=tailRaw>0?Math.max(6,tailRaw):0;
    const totalW=Math.min(98,mainW+tailW);
    const adjMain=tailW>0?Math.min(mainW,totalW-tailW):mainW;
    const ghostW=showGhost?(ghostCnt/maxCnt)*100:0;

    const ghostDelta=showGhost?cnt-ghostCnt:null;
    const gdCol=ghostDelta==null?NEUT:b.zone==='healthy'?(ghostDelta>0?GOOD:ghostDelta<0?BAD:NEUT):(ghostDelta>0?BAD:ghostDelta<0?GOOD:NEUT);

    const dCol=b.zone==='healthy'?(net>0?GOOD:NEUT):(net>0?AMBER:GOOD);
    const deltaOutside=f&&Math.abs(net)>=0.5
      ?`<div style="font-family:var(--mono);font-size:16px;font-weight:700;color:${dCol};min-width:44px;text-align:right;flex-shrink:0;white-space:nowrap">${net>0?'+':'\u2212'}${fm(Math.abs(net))}</div>`
      :'<div style="min-width:44px"></div>';

    let cap='';
    if(f&&f.exact){
      const bits=[];
      if(f.newArrivals>0) bits.push(fm(f.newArrivals)+' came in');
      if(f.agedIn>0) bits.push(fm(f.agedIn)+' aged in');
      if(f.younger>0) bits.push(fm(f.younger)+' got younger (oldest units sold)');
      if(f.agedOut>0) bits.push(fm(f.agedOut)+' aged on');
      if(f.refreshed>0) bits.push(fm(f.refreshed)+' moved younger');
      if(f.sold>0) bits.push(fm(f.sold)+' sold out');
      cap=bits.join(' · ');
    }
    if(tailW>0) cap+=(cap?' ':'')+'<span style="color:'+TAIL_COL+';font-weight:600">(+'+fm(movedIn)+' in blue)</span>';
    if(showGhost&&ghostDelta!==null&&ghostDelta!==0) cap+=(cap?'  ':'')+'<span style="color:'+gdCol+';font-weight:600">vs 2wk ago: '+(ghostDelta>0?'+':'−')+fm(Math.abs(ghostDelta))+'</span>';

    // the other way of counting this band: SKUs when the bars are £, £ otherwise
    const skuN=(latest.ageing||{})[b.key]||0;
    const valBadge = M==='gbp'
      ? `<div style="font-family:var(--mono);font-size:10px;color:#3d9eff;margin-top:2px">${skuN.toLocaleString()} SKU${skuN===1?'':'s'}</div>`
      : (hasVal && bucketVal>0) ? `<div style="font-family:var(--mono);font-size:10px;color:#3d9eff;margin-top:2px">${moneyFmt(bucketVal)}</div>` : '';

    rows+=`<div style="display:grid;grid-template-columns:158px 1fr;gap:16px;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)">
      <div style="display:flex;align-items:center;gap:9px">
        <span style="width:9px;height:9px;border-radius:50%;background:${ZDOT[b.zone]};flex-shrink:0"></span>
        <div>
          <div style="font-family:var(--mono);font-size:12px;font-weight:700;color:var(--text)">${b.label}</div>
          <div style="font-family:var(--mono);font-size:10px;color:var(--muted2)">${((cnt/total)*100).toFixed(1)}% of stock</div>
          ${valBadge}
        </div>
      </div>
      <div>
        <div style="display:flex;align-items:center;gap:8px">
          <div style="flex:1;height:26px;background:${ZTINT[b.zone]};border-left:3px solid ${ZDOT[b.zone]};border-radius:0 6px 6px 0;position:relative;overflow:hidden">
            ${showGhost&&ghostW>0?`<div style="position:absolute;left:0;top:0;height:100%;width:${ghostW}%;background:${ZDOT[b.zone]};opacity:.2;z-index:0"></div>`:''}
            <div style="position:absolute;left:0;top:0;height:100%;width:${adjMain}%;background:${ZBAR[b.zone]};z-index:1"></div>
            ${tailW>0?`<div style="position:absolute;left:${adjMain}%;top:0;height:100%;width:${tailW}%;background:${TAIL_COL};border-left:2px solid rgba(0,0,0,.4);z-index:2">${tailW>=7?`<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-family:var(--mono);font-size:11px;font-weight:700;color:rgba(0,0,0,.75);white-space:nowrap;overflow:hidden">+${fm(movedIn)}</div>`:''}</div>`:''}
            ${showGhost&&ghostW>0?`<div style="position:absolute;left:${Math.min(ghostW,97)}%;top:3px;bottom:3px;width:2px;background:rgba(255,255,255,.55);z-index:4"></div>`:''}
            <div style="position:absolute;left:10px;top:0;bottom:0;display:flex;align-items:center;z-index:3">
              <span style="font-family:var(--mono);font-size:16px;font-weight:700;color:#fff;text-shadow:0 1px 4px rgba(0,0,0,.6)">${fm(cnt)}</span>
            </div>
          </div>
          ${deltaOutside}
        </div>
        ${cap?`<div style="margin-top:5px;font-family:var(--mono);font-size:10px;color:var(--muted2)">${cap}</div>`:''}
      </div>
    </div>`;
  });

  const ts='font-family:var(--mono);font-size:11px;padding:6px 13px;border-radius:7px;cursor:pointer;border:1px solid '+(_shCompare?'var(--g)':'var(--border)')+';background:'+(_shCompare?'var(--g2)':'var(--s2)')+';color:'+(_shCompare?'var(--g)':'var(--muted2)')+';transition:all .15s';
  return `<div id="shPipelineWrap" style="background:var(--s1);border:1px solid var(--border);border-radius:14px;padding:18px 20px;margin-bottom:16px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:8px">
      <div style="font-family:var(--mono);font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--text)">The pipeline — where stock sits &amp; what moved · ${SH_METRICS[M].by}</div>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        ${showGhost?`<span style="font-family:var(--mono);font-size:10px;color:var(--muted2)">ghost = ${ghostDate}</span>`:''}
        <button onclick="shToggleCompare()" style="${ts}">${_shCompare?'◉':'○'} vs 2 weeks ago</button>
        <div style="font-family:var(--mono);font-size:10px;color:var(--muted2)">${ex?`bar = stock already here · <span style="color:${TAIL_COL};font-weight:600">■ blue</span> = moved in since ${fmt(prev.date)}`:`change vs ${prev?fmt(prev.date):'last entry'} · where it came from shows once each SKU is saved`}${showGhost?' · <span style="color:rgba(255,255,255,.45)">| ghost line</span> = 2wk ago':''}</div>
      </div>
    </div>
    ${rows}
  </div>`;
}


// Context: what moved this entry + is the score inflated by new buying?
function shWhyContextHtml(snaps){
  if(snaps.length<2) return '';
  const latest=snaps[snaps.length-1], prev=snaps[snaps.length-2], first=snaps[0];
  const ag=latest.ageing||{};
  // Exact, SKU by SKU — or nothing. The old version guessed these from the band totals and
  // could not see anything sell from 0–30d (12 Oct: "0 new, 2 sold" while 15 SKUs had gone).
  const ex=shExactMoves(prev.date, latest.date);
  const newIn=ex?ex.newIn.length:0;
  const newHealthy=ex?ex.newIn.filter(r=>r[2]<=2).length:0;

  const total=shBucketTotal(latest)||1;
  const flowNow=shFlowPct(latest), flowPrev=shFlowPct(prev), entryD=+(flowNow-flowPrev).toFixed(1);

  // What would flow be WITHOUT this entry's new purchases?
  const fresh=(ag.a0||0)+(ag.a31||0)+(ag.a61||0);
  const denomEx=total-newIn, numEx=fresh-newHealthy;
  const flowExNew = denomEx>0 ? +((numEx/denomEx)*100).toFixed(1) : flowNow;
  const inflation = +(flowNow-flowExNew).toFixed(1);   // pp lifted purely by new buying

  // window dead-stock
  const oldN=(ag.a181||0)+(ag.a271||0)+(ag.a365||0);
  const fa=first.ageing||{}; const oldF=(fa.a181||0)+(fa.a271||0)+(fa.a365||0);

  let infVerdict, infCol;
  if(newIn>0 && inflation>=1){ infCol=AMBER; infVerdict=`Lifted by new buying`; }
  else if(newIn>0 && inflation<=-1){ infCol=NEUT; infVerdict=`New stock barely moved it`; }
  else { infCol=GOOD; infVerdict=`Reflects real stock movement`; }

  const stat=(glyph,label,val,col)=>`<div style="flex:1;min-width:120px">
    <div style="font-family:var(--mono);font-size:22px;font-weight:700;color:${col}">${glyph} ${val}</div>
    <div style="font-family:var(--mono);font-size:10px;letter-spacing:.04em;text-transform:uppercase;color:var(--muted2);margin-top:2px">${label}</div>
  </div>`;

  // Valuation context block — only shown when both snapshots have valuation data
  const moneyFmt=v=>'£'+(v||0).toLocaleString(undefined,{maximumFractionDigits:0});
  const hasVal = shHasValuation(latest) && shHasValuation(prev);
  let valContextHtml = '';
  if (hasVal){
    const zvNow=shZoneValues(latest), zvPrev=shZoneValues(prev);
    const actionValNow=zvNow.action, actionValPrev=zvPrev.action;
    const actionValDiff=actionValNow-actionValPrev;
    const healthyValNow=zvNow.healthy, healthyValPrev=zvPrev.healthy;
    const healthyValDiff=healthyValNow-healthyValPrev;
    const totalNow=zvNow.healthy+zvNow.caution+zvNow.action;
    const totalPrev=zvPrev.healthy+zvPrev.caution+zvPrev.action;
    const totalDiff=totalNow-totalPrev;
    const actionValPct=totalNow>0?((actionValNow/totalNow)*100).toFixed(1):'0';

    const valStat=(label,val,diff,goodUp)=>{
      const dCol=diff===0?NEUT:goodUp?(diff>0?GOOD:BAD):(diff>0?BAD:GOOD);
      const dStr=(diff>0?'▲ +':'▼ ')+moneyFmt(Math.abs(diff));
      return `<div style="min-width:140px">
        <div style="font-family:var(--mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted2)">${label}</div>
        <div style="font-family:var(--mono);font-size:18px;font-weight:700;margin-top:3px">${moneyFmt(val)}</div>
        ${diff!==0?`<div style="font-family:var(--mono);font-size:11px;color:${dCol};margin-top:1px">${dStr} vs last</div>`:`<div style="font-family:var(--mono);font-size:11px;color:var(--muted2)">→ no change</div>`}
      </div>`;
    };

    const urgencyMsg = actionValNow>5000
      ? `${moneyFmt(actionValNow)} (${actionValPct}% of total value) is past your 180-day limit. That's real capital you can't reinvest until it moves.`
      : actionValNow>0
      ? `${moneyFmt(actionValNow)} in 181d+ stock — relatively small, but worth clearing to free up reinvestment cash.`
      : `No value sitting in 181d+ stock — everything is in healthy or caution buckets.`;
    const urgencyCol = actionValNow>5000 ? ORANGE : actionValNow>0 ? AMBER : GOOD;

    valContextHtml = `<div style="background:var(--s2);border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin-top:14px">
      <div style="font-family:var(--mono);font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted2);margin-bottom:12px">Capital movement this entry</div>
      <div style="display:flex;gap:20px;flex-wrap:wrap;margin-bottom:12px">
        ${valStat('Total value', totalNow, totalDiff, true)}
        ${valStat('Healthy value', healthyValNow, healthyValDiff, true)}
        ${valStat('Past 180 days value', actionValNow, actionValDiff, false)}
      </div>
      <div style="font-family:var(--mono);font-size:12px;color:${urgencyCol};line-height:1.6;padding-top:10px;border-top:1px solid var(--border)">
        ${urgencyMsg}
      </div>
    </div>`;
  }

  const sep='<div style="width:1px;background:var(--border)"></div>';
  const zP=shZones(prev), zN=shZones(latest), tP=shBucketTotal(prev), tN=total;
  const sgn=v=>v>0?'+'+v:v<0?'\u2212'+Math.abs(v):'0';
  const up=shUpcoming(latest.date);
  const statsHtml = ex ? `<div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:16px">
      ${stat('✦', 'came in · new stock', newIn, GOOD)}${sep}
      ${stat('✓', 'sold out · gone', ex.gone.length, GOOD)}${sep}
      ${stat('↓', 'aged into an older band', ex.agedOn, AMBER)}${sep}
      ${stat('⚠', 'went past 90 days', ex.past90.length, ex.past90.length?ORANGE:GOOD)}${sep}
      ${stat('⛔', 'went past 180 days', ex.past180.length, ex.past180.length?BAD:GOOD)}
    </div>`
    : `<div style="font-family:var(--mono);font-size:12px;color:var(--text);line-height:1.7;margin-bottom:14px">
      Since ${fmt(prev.date)}: <b>${tP} → ${tN}</b> SKUs (${sgn(tN-tP)}) · under 90 days ${zP.healthy} → ${zN.healthy} · 91–180 ${zP.caution} → ${zN.caution} · 181+ ${zP.action} → ${zN.action}
      <div style="font-size:11px;color:var(--muted2);margin-top:4px">${window._hasSnapSkus===false
        ? 'Exact movement — what sold out, what aged, what just went past 90 days — needs the stock-health SQL run in Supabase.'
        : SNAP_SKUS[latest.date] ? 'Exact movement starts at the next upload: this is the first entry with each SKU saved.'
        : 'Exact movement starts from the next two uploads Sarah makes (each SKU is saved from then on).'}</div></div>`;
  const listsHtml = (ex || up) ? `<div class="sh-lsts">
      ${ex ? shSkuList('Just went past 90 days', ex.past90, ORANGE, up && up.age) : ''}
      ${ex ? shSkuList('Just went past 180 days', ex.past180, BAD, up && up.age) : ''}
      ${up ? shSkuList('Goes past 90 days in the next 14 days', up.soon90, AMBER, up.age) : ''}
      ${up ? shSkuList('Goes past 180 days in the next 14 days', up.soon180, ORANGE, up.age) : ''}
    </div>` : '';

  return `<div style="background:var(--s1);border:1px solid var(--border);border-radius:14px;padding:18px 20px;margin-bottom:16px">
    <div style="font-family:var(--mono);font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--text);margin-bottom:14px">What moved since the last entry</div>
    ${statsHtml}
    ${listsHtml}
    ${ex ? `<div style="background:var(--s2);border:1px solid var(--border);border-radius:10px;padding:14px 16px">` : `<div style="display:none">`}
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px">
        <span style="font-family:var(--mono);font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted2)">New-buying check</span>
        <span style="font-family:var(--mono);font-size:11px;font-weight:700;padding:3px 10px;border-radius:5px;background:${infCol}22;color:${infCol}">${infVerdict}</span>
      </div>
      <div style="font-family:var(--mono);font-size:12px;color:var(--text);line-height:1.7">
        Reported flow is <b style="color:${shZoneColor(flowNow)}">${flowNow}%</b>.
        ${newIn>0
          ? `Strip out the <b style="color:${GOOD}">${newIn}</b> SKU${newIn!==1?'s':''} that came in this entry and it would be <b style="color:${shZoneColor(flowExNew)}">${flowExNew}%</b> — so roughly <b style="color:${infCol}">${inflation>0?'+':''}${inflation}pp</b> of the score is new inventory landing in 0–30d, not older stock clearing.`
          : `No new SKUs came in this entry, so the score reflects genuine movement of existing stock.`}
      </div>
      </div><div style="font-family:var(--mono);font-size:10px;color:var(--muted2);margin-top:10px">Across the window: past 180 days ${oldF} → ${oldN} ${oldN<oldF?`<span style="color:${GOOD}">(clearing)</span>`:oldN>oldF?`<span style="color:${BAD}">(building up)</span>`:'(flat)'}.</div>
    ${valContextHtml}
  </div>`;
}

// ── Zone graphs section (Healthy / Caution / Action over time) ──────────────
let shZoneMetric = SH_METRIC === 'gbp' ? 'value' : 'skus'; // 'skus' | 'value' — which series the 3 mini zone charts show

function shZoneToggleHtml(pageId, metric){
  return `<div style="display:inline-flex;border:1px solid var(--border);border-radius:8px;overflow:hidden">
      <button onclick="shSetZoneMetric('skus','${pageId}')" id="shZMetricBtn_skus_${pageId}" style="font-family:var(--mono);font-size:10px;padding:6px 12px;background:${metric==='skus'?'var(--g)':'none'};color:${metric==='skus'?'var(--bg)':'var(--muted2)'};border:none;cursor:pointer;font-weight:700">SKUs</button>
      <button onclick="shSetZoneMetric('value','${pageId}')" id="shZMetricBtn_value_${pageId}" style="font-family:var(--mono);font-size:10px;padding:6px 12px;background:${metric==='value'?'#3d9eff':'none'};color:${metric==='value'?'#07090c':'var(--muted2)'};border:none;cursor:pointer;font-weight:700">Valuation</button>
    </div>`;
}

function shZoneGraphsHtml(pageId, snaps){
  // pageId differentiates canvas IDs between page and popup
  const latest = snaps && snaps.length ? snaps[snaps.length-1] : null;
  const hasVal = latest ? shHasValuation(latest) : false;
  const metric = hasVal ? shZoneMetric : 'skus';
  const toggle = hasVal ? shZoneToggleHtml(pageId, metric) : '';
  return `<div id="shZoneGraphsHost_${pageId}">${shZoneGraphsInnerHtml(pageId, metric, toggle)}</div>`;
}

function shZoneGraphsInnerHtml(pageId, metric, toggle){
  return `<div style="background:var(--s1);border:1px solid var(--border);border-radius:14px;padding:18px 20px;margin-bottom:16px">
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:14px">
      <div style="font-family:var(--mono);font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--text)">Zone ${metric==='value'?'valuation':'counts'} over time — click a zone to focus</div>
      ${toggle}
    </div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px">
      <div style="background:var(--s2);border:1px solid var(--border);border-top:2px solid ${GOOD};border-radius:10px;padding:12px 14px">
        <div style="font-family:var(--mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:${GOOD};margin-bottom:8px">Healthy 0–90d</div>
        <div style="height:90px"><canvas id="shZChart_healthy_${pageId}"></canvas></div>
      </div>
      <div style="background:var(--s2);border:1px solid var(--border);border-top:2px solid ${AMBER};border-radius:10px;padding:12px 14px">
        <div style="font-family:var(--mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:${AMBER};margin-bottom:8px">Caution 91–180d</div>
        <div style="height:90px"><canvas id="shZChart_caution_${pageId}"></canvas></div>
      </div>
      <div style="background:var(--s2);border:1px solid var(--border);border-top:2px solid ${ORANGE};border-radius:10px;padding:12px 14px">
        <div style="font-family:var(--mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:${ORANGE};margin-bottom:8px">Action 181d+</div>
        <div style="height:90px"><canvas id="shZChart_action_${pageId}"></canvas></div>
      </div>
    </div>
    <div style="font-family:var(--mono);font-size:10px;color:var(--muted2);margin-top:10px">
      ${metric==='value'
        ? 'Goal: Healthy ↑ over time · Caution &amp; Action ↓ over time. Capital tied up in Action stock is money not in your pocket.'
        : 'Goal: Healthy ↑ over time · Caution &amp; Action ↓ over time. If Healthy isn\'t rising but score improves, it may be new stock buying, not clearing.'}
    </div>
  </div>`;
}

function shSetZoneMetric(metric, pageId){
  shZoneMetric = metric;
  // Re-render just this section in place rather than the whole page, so scroll position/other state isn't disturbed
  const snaps = pageId==='popup' ? _shZoneSnaps : shFilteredSnaps();
  if (!snaps || !snaps.length) return;
  const host = document.getElementById('shZoneGraphsHost_'+pageId);
  const latest = snaps[snaps.length-1];
  const hasVal = shHasValuation(latest);
  const effMetric = hasVal ? metric : 'skus';
  const toggle = hasVal ? shZoneToggleHtml(pageId, effMetric) : '';
  if (host) host.innerHTML = shZoneGraphsInnerHtml(pageId, effMetric, toggle);
  setTimeout(()=>shDrawZoneCharts(snaps, pageId), 30);
}

function shDrawZoneCharts(snaps, pageId){
  const latest = snaps[snaps.length-1];
  // Was testing only the newest snapshot, so a window whose last entry happened to have
  // valuation drew £ for the whole range — including the months that have none.
  const hasVal = snaps.some(shHasValuation);
  const metric = hasVal ? shZoneMetric : 'skus';
  const labels=snaps.map(s=>fmtShort(s.date));
  const zones=['healthy','caution','action'];
  const cols={healthy:GOOD, caution:AMBER, action:ORANGE};
  const skuGetters={
    healthy:s=>{ const a=s.ageing||{}; return (a.a0||0)+(a.a31||0)+(a.a61||0); },
    caution:s=>{ const a=s.ageing||{}; return a.a91||0; },
    action:s=>{ const a=s.ageing||{}; return (a.a181||0)+(a.a271||0)+(a.a365||0); }
  };
  const valGetters={
    healthy:s=>shHasValuation(s)?shZoneValues(s).healthy:null,
    caution:s=>shHasValuation(s)?shZoneValues(s).caution:null,
    action:s=>shHasValuation(s)?shZoneValues(s).action:null
  };
  const getters = metric==='value' ? valGetters : skuGetters;
  const moneyFmt=v=>'£'+(v||0).toLocaleString(undefined,{maximumFractionDigits:0});
  zones.forEach(zone=>{
    const cv=document.getElementById(`shZChart_${zone}_${pageId}`);
    if(!cv||typeof Chart==='undefined') return;
    const id=`shZChart_${zone}_${pageId}`;
    destroyChart(id);
    const data=snaps.map(getters[zone]);
    const col=cols[zone];
    const lo=Math.max(0,Math.min(...data)-(metric==='value'?Math.max(...data)*0.1:5)), hi=Math.max(...data)+(metric==='value'?Math.max(...data)*0.1||1:5);
    chartInstances[id]=new Chart(cv.getContext('2d'),{
      type:'line',
      data:{ labels, datasets:[{ data, borderColor:col, backgroundColor:col+'18', borderWidth:1.6, tension:.3, fill:true, pointRadius:2, pointHoverRadius:4, pointBackgroundColor:col, pointBorderColor:'#07090c', pointBorderWidth:1.5, spanGaps:false }] },
      options:{ responsive:true, maintainAspectRatio:false, interaction:{mode:'index',intersect:false},
        plugins:{ legend:{display:false}, datalabels:{display:false},
          tooltip:{ callbacks:{ title:items=>fmt(snaps[items[0].dataIndex].date), label:item=>metric==='value'?moneyFmt(item.parsed.y):`${item.parsed.y} SKUs` } } },
        scales:{ y:{ min:lo, max:hi, display:true, grid:{color:'rgba(255,255,255,.04)'}, ticks:{color:'#a7b4c4',font:{size:10},maxTicksLimit:4,callback:v=>metric==='value'?moneyFmt(v):v} },
          x:{ display:false } } }
    });
  });
}

// ── Recent entries — last 6, each compared to the OLDEST of those 6 ─────────
function shRecentTableHtml(snaps){
  const last6=snaps.slice(-6);           // oldest → newest
  if(!last6.length) return '';
  const M=shM(last6[last6.length-1]), fm=v=>shFmtM(v,M);
  const shZones=s=>shZonesBy(s,M), shBucketTotal=s=>shZonesBy(s,M).total, shFlowPct=s=>shShare90(s,M);   // this table counts the page's way
  const baseline=last6[0];              // oldest of the 6 is the comparison point
  const bz=shZones(baseline), bTotal=shBucketTotal(baseline)||1, bFlow=shFlowPct(baseline);

  // Summary bar at bottom: newest vs oldest
  const latest=last6[last6.length-1];
  const lz=shZones(latest), lTotal=shBucketTotal(latest)||1, lFlow=shFlowPct(latest);
  const flowD=+(lFlow-bFlow).toFixed(1);
  const hD=lz.healthy-bz.healthy, cD=lz.caution-bz.caution, aD=lz.action-bz.action;
  const hPct=+(((lz.healthy/lTotal)-(bz.healthy/bTotal))*100).toFixed(1);
  const cPct=+(((lz.caution/lTotal)-(bz.caution/bTotal))*100).toFixed(1);
  const aPct=+(((lz.action/lTotal)-(bz.action/bTotal))*100).toFixed(1);
  const dStr=(v,p)=>`${v>0?'+':''}${fm(v)}${shUnitM(M,v)}  (${p>0?'+':''}${p}pp)`;
  const dCol=(v,goodUp)=>v===0?NEUT:goodUp?(v>0?GOOD:BAD):(v>0?BAD:GOOD);

  // Row for each of the 6 (newest first)
  let rows='';
  [...last6].reverse().forEach((s,i)=>{
    const flow=shFlowPct(s), z=shZones(s), total=shBucketTotal(s)||1;
    const isLatest=i===0, isBaseline=i===last6.length-1;
    const zD={ healthy:z.healthy-bz.healthy, caution:z.caution-bz.caution, action:z.action-bz.action };
    const flowDelta=+(flow-bFlow).toFixed(1);
    const accent=isBaseline?'var(--border2)':flowDelta>0?GOOD:flowDelta<0?BAD:'var(--muted2)';

    const zCell=(key,goodUp)=>{
      const v=z[key], d=isBaseline?null:zD[key];
      const col=d==null?NEUT:(goodUp?(d>0?GOOD:BAD):(d>0?BAD:GOOD));
      const pct=((v/total)*100).toFixed(0);
      return `<div style="text-align:center;font-family:var(--mono);white-space:nowrap">
        <b style="font-size:14px;color:var(--text)">${fm(v)}</b>
        <span style="font-size:11px;color:var(--muted2);margin-left:6px">${pct}%</span>
        <span style="font-size:11px;font-weight:700;margin-left:6px;color:${d!=null&&Math.abs(d)>=0.5?col:'var(--muted)'}">${d!=null&&Math.abs(d)>=0.5?(d>0?'+':'−')+fm(Math.abs(d)):'—'}</span>
      </div>`;
    };

    const vz=shHasValuation(s)?shZoneValues(s):null, vt=vz?vz.healthy+vz.caution+vz.action:0;
    const zt=z.healthy+z.caution+z.action||1;
    const splitBar=`<div title="Healthy ${(z.healthy/zt*100).toFixed(0)}% · Caution ${(z.caution/zt*100).toFixed(0)}% · Action ${(z.action/zt*100).toFixed(0)}%" style="display:flex;height:12px;border-radius:6px;overflow:hidden;background:var(--s3)">
        <i style="width:${z.healthy/zt*100}%;background:${ZBAR.healthy}"></i><i style="width:${z.caution/zt*100}%;background:${ZBAR.caution}"></i><i style="width:${z.action/zt*100}%;background:${ZBAR.danger}"></i></div>`;
    rows+=`<div style="display:grid;grid-template-columns:110px 130px minmax(160px,1.4fr) .8fr .8fr .8fr;gap:14px;align-items:center;padding:9px 14px;border-radius:8px;margin-bottom:3px;background:${isLatest?'rgba(0,245,160,.05)':isBaseline?'rgba(255,255,255,.02)':'transparent'};border-left:3px solid ${accent}">
      <div>
        <div style="font-family:var(--mono);font-size:12px;font-weight:${isLatest?700:500};color:${isLatest?'var(--g)':isBaseline?'var(--muted2)':'var(--text)'}">${fmt(s.date)}</div>
        <div style="font-family:var(--mono);font-size:10px;color:var(--muted2)">${isLatest?'latest':isBaseline?'baseline':''}</div>
      </div>
      <div>
        <div style="font-family:var(--mono);font-size:17px;font-weight:700;color:${shZoneColor(flow)}">${flow}%</div>
        <div style="font-family:var(--mono);font-size:11px;color:var(--muted2)">${!isBaseline&&flowDelta!==0?`<b style="color:${flowDelta>0?GOOD:BAD}">${flowDelta>0?'+':''}${flowDelta}pp</b>`:'—'}${M==='gbp'?` · SKUs ${shShare90(s,'sku').toFixed(1)}%`:vt?` · £ ${(vz.healthy/vt*100).toFixed(1)}%`:''}</div>
      </div>
      ${splitBar}
      ${zCell('healthy',true)}
      ${zCell('caution',false)}
      ${zCell('action',false)}
    </div>`;
  });

  // Summary comparison bar
  const sumCard=(label,delta,pctD,goodUp)=>`<div style="flex:1;min-width:100px">
    <div style="font-family:var(--mono);font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted2);margin-bottom:4px">${label}</div>
    <div style="font-family:var(--mono);font-size:16px;font-weight:700;color:${dCol(delta,goodUp)}">${delta>0?'+':delta<0?'−':''}${fm(Math.abs(delta))} <span style="font-size:11px">${shUnitM(M,Math.abs(delta)).trim()}</span></div>
    <div style="font-family:var(--mono);font-size:11px;color:${dCol(pctD,goodUp)}">${pctD>0?'+':''}${pctD}pp</div>
  </div>`;

  return `<div style="background:var(--s1);border:1px solid var(--border);border-radius:14px;padding:18px 20px">
    <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:8px">
      <div style="font-family:var(--mono);font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--text)">Last 6 entries · ${SH_METRICS[M].by}</div>
      <div style="font-family:var(--mono);font-size:10px;color:var(--muted2)">Comparing each entry to <span style="color:var(--text);font-weight:600">${fmt(baseline.date)}</span> (baseline)</div>
    </div>
    <div style="display:grid;grid-template-columns:110px 130px minmax(160px,1.4fr) .8fr .8fr .8fr;gap:14px;padding:0 14px 8px;border-bottom:1px solid var(--border);margin-bottom:8px">
      <div style="font-family:var(--mono);font-size:10px;color:var(--muted2)">DATE</div>
      <div style="font-family:var(--mono);font-size:10px;color:var(--muted2)">UNDER 90 DAYS</div>
      <div style="font-family:var(--mono);font-size:10px;color:var(--muted2)">SPLIT</div>
      <div style="font-family:var(--mono);font-size:10px;color:${GOOD};text-align:center">HEALTHY</div>
      <div style="font-family:var(--mono);font-size:10px;color:${AMBER};text-align:center">CAUTION</div>
      <div style="font-family:var(--mono);font-size:10px;color:${ORANGE};text-align:center">ACTION</div>
    </div>
    ${rows}
    <div style="border-top:1px solid var(--border);margin-top:12px;padding-top:14px">
      <div style="font-family:var(--mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted2);margin-bottom:10px">Net movement — latest vs baseline (${fmt(baseline.date)} → ${fmt(latest.date)})</div>
      <div style="display:flex;gap:14px;flex-wrap:wrap">
        <div style="flex:1;min-width:80px">
          <div style="font-family:var(--mono);font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted2);margin-bottom:4px">Under 90 days</div>
          <div style="font-family:var(--mono);font-size:18px;font-weight:700;color:${dCol(flowD,true)}">${flowD>0?'+':''}${flowD}pp</div>
        </div>
        <div style="width:1px;background:var(--border)"></div>
        ${sumCard('Healthy 0–90d', hD, hPct, true)}
        <div style="width:1px;background:var(--border)"></div>
        ${sumCard('Caution 91–180d', cD, cPct, false)}
        <div style="width:1px;background:var(--border)"></div>
        ${sumCard('Action 181d+', aD, aPct, false)}
      </div>
    </div>
  </div>`;
}


// Chart — thin line, small dots, hover tooltip, zoomed y
function shDrawChart(snaps, canvasId, instKey){
  const cv=document.getElementById(canvasId); if(!cv||typeof Chart==='undefined') return;
  destroyChart(instKey);
  const labels=snaps.map(s=>fmtShort(s.date));
  const M=shM(snaps[snaps.length-1]);
  const flow=snaps.map(s=>shBands(s,M)?shShare90(s,M):null);
  const ptCol=flow.map(v=>v==null?'transparent':shZoneColor(v));
  // £ share beside the SKU share, where the entry carries valuation
  // the other ways of counting, thin and dashed behind the chosen one
  const LINE_COL={gbp:'#3d9eff',sku:'#00f5a0',asin:'#c084fc',units:'#ffd166'};
  const others=Object.keys(SH_METRICS).filter(k=>k!==M&&snaps.some(s=>shBands(s,k))).map(k=>({k,data:snaps.map(s=>shBands(s,k)?shShare90(s,k):null)}));
  const vflow=others.flatMap(o=>o.data);
  const all=[...flow.filter(v=>v!=null), ...vflow.filter(v=>v!=null), SH_FLOOR, SH_GOAL];
  // A fair scale: always shows the floor and goal with room around them, in steps of 5, so a
  // one-point wobble looks like one point — not a cliff.
  const lo=Math.max(0,Math.floor((Math.min(...all)-4)/5)*5), hi=Math.min(100,Math.ceil((Math.max(...all)+3)/5)*5);
  const zoneArr=snaps.map(s=>shZones(s));
  const bands={ id:'shBands'+instKey, beforeDraw(ch){ const {ctx,chartArea,scales}=ch; if(!chartArea||!scales.y) return; const y=scales.y,xL=chartArea.left,xR=chartArea.right;
    const band=(a,b,col)=>{ if(b<lo||a>hi) return; const t=y.getPixelForValue(Math.min(b,hi)),bt=y.getPixelForValue(Math.max(a,lo)); ctx.save(); ctx.fillStyle=col; ctx.fillRect(xL,t,xR-xL,bt-t); ctx.restore(); };
    band(SH_GOAL,hi,'rgba(0,245,160,.05)'); band(SH_FLOOR,SH_GOAL,'rgba(255,209,102,.045)'); band(lo,SH_FLOOR,'rgba(255,77,109,.045)');
    const mark=(v,col,txt)=>{ if(v<lo||v>hi) return; const yy=y.getPixelForValue(v); ctx.save(); ctx.strokeStyle=col; ctx.globalAlpha=.7; ctx.setLineDash([5,4]); ctx.lineWidth=1.2; ctx.beginPath(); ctx.moveTo(xL,yy); ctx.lineTo(xR,yy); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha=1; ctx.fillStyle=col; ctx.font='600 11px Inter, system-ui, sans-serif'; ctx.textAlign='right'; ctx.fillText(txt, xR-4, yy-5); ctx.restore(); };
    mark(SH_GOAL,GOOD,`goal ${SH_GOAL}%`); mark(SH_FLOOR,AMBER,`floor ${SH_FLOOR}%`); } };
  chartInstances[instKey]=new Chart(cv.getContext('2d'),{
    type:'line',
    data:{ labels, datasets:[{ label:SH_METRICS[M].label, data:flow, borderColor:LINE_COL[M], borderWidth:2.6, tension:.25, fill:false, pointRadius:3.5, pointHoverRadius:6, pointBackgroundColor:ptCol, pointBorderColor:'#07090c', pointBorderWidth:1.5, spanGaps:true },
      ...others.map(o=>({ label:SH_METRICS[o.k].label, data:o.data, borderColor:LINE_COL[o.k], borderWidth:1.4, borderDash:[6,4], tension:.25, fill:false, pointRadius:0, pointHoverRadius:4, spanGaps:true }))] },
    options:{ responsive:true, maintainAspectRatio:false, interaction:{mode:'index',intersect:false},
      plugins:{ legend:{display:false}, datalabels:{display:false},
        tooltip:{ callbacks:{
          title:items=>{ const i=items[0].dataIndex; return fmt(snaps[i].date); },
          label:item=>`Under 90 days · by ${item.dataset.label}: ${item.parsed.y}%`,
          afterBody:items=>{ const s=snaps[items[0].dataIndex]; if(!shBands(s,M)) return []; const z=shZonesBy(s,M); return [`Healthy: ${shFmtM(z.healthy,M)}${shUnitM(M,z.healthy)}`,`Caution: ${shFmtM(z.caution,M)}${shUnitM(M,z.caution)}`,`Action: ${shFmtM(z.action,M)}${shUnitM(M,z.action)}`]; }
        } } },
      scales:{ y:{ min:lo, max:hi, grid:{color:'#1c2330'}, ticks:{color:'#a7b4c4',stepSize:5,font:{size:11.5},callback:v=>v+'%'} },
        x:{ grid:{display:false}, ticks:{color:'#a7b4c4',font:{size:11.5},maxRotation:0,autoSkip:true,maxTicksLimit:10} } } },
    plugins:[bands]
  });
}

// ════════════════════════════════════ POPUP ════════════════════════════════════
// Rebuilt to match the page — same components, no range controls
function openAgedStockModal(snaps, modal, title, body){
  const latest=snaps[snaps.length-1];
  const flowNow=shShare90(latest, shHasValuation(latest)?'gbp':'sku'); const z=shZones(latest); const total=shBucketTotal(latest)||1;
  const actionPct=(z.action/total)*100;
  const concernEl=document.getElementById('kpiModalConcern');
  if(concernEl){
    if(flowNow<SH_FLOOR||actionPct>10){ concernEl.textContent='⚠ Needs attention'; concernEl.style.cssText='margin-left:12px;font-size:11px;font-family:var(--mono);padding:3px 10px;border-radius:4px;background:rgba(255,77,109,.15);color:#ff4d6d;display:inline'; }
    else if(flowNow<SH_GOAL){ concernEl.textContent='Watch'; concernEl.style.cssText='margin-left:12px;font-size:11px;font-family:var(--mono);padding:3px 10px;border-radius:4px;background:rgba(255,209,102,.12);color:#ffd166;display:inline'; }
    else { concernEl.textContent='✓ Healthy'; concernEl.style.cssText='margin-left:12px;font-size:11px;font-family:var(--mono);padding:3px 10px;border-radius:4px;background:rgba(0,245,160,.12);color:#00f5a0;display:inline'; }
  }
  title.textContent='Stock Health';
  modal.style.display='flex';
  body.innerHTML =
    shHeroHtml(snaps) +
    shZoneSummaryHtml(snaps) +
    shGraphContainerHtml('shModalChart', snaps) +
    shZoneGraphsHtml('popup', snaps) +
    shWhyContextHtml(snaps) +
    shPipelineHtml(snaps) +
    shRecentTableHtml(snaps);
  shDrawChart(snaps,'shModalChart','shModalChart');
  setTimeout(()=>shDrawZoneCharts(snaps,'popup'),60);
}

// ===== END STOCK HEALTH PAGE =====
