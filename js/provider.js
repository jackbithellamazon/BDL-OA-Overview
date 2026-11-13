// ═══════════════════════════════════════════════════════════════════════════
//  PROVIDER PAGE
// ═══════════════════════════════════════════════════════════════════════════
const PROV_COLORS = ['#00f5a0','#3d9eff','#ffd166','#ff8c42','#ff4d6d','#c084fc','#66ffcc','#ff99cc','#ffcc00','#00ffff','#ff6b6b','#9b8cff','#4ade80','#f472b6','#38bdf8'];

function provSetT(id,v){ const el=document.getElementById(id); if(el) el.textContent=v; }
function provSetHTML(id,v){ const el=document.getElementById(id); if(el) el.innerHTML=v; }
function provSetPill(id,kind,txt){ const el=document.getElementById(id); if(!el) return; if(!txt){el.innerHTML='';return;} el.className='pill '+kind; el.textContent=txt; }

function provMaxStep(points, dir){
  let best=null;
  for(let i=1;i<points.length;i++){
    const d=points[i].skus-points[i-1].skus;
    if(dir==='inc' && d>0 && (!best||d>best.delta)) best={delta:d, from:points[i-1].date, to:points[i].date};
    if(dir==='dec' && d<0 && (!best||d<best.delta)) best={delta:d, from:points[i-1].date, to:points[i].date};
  }
  return best;
}

// Build a clean per-provider series with derived metrics
function buildProviderSeries(){
  const map={};
  PROVIDER_SNAPSHOTS.forEach(p=>{
    const key=(p.provider||'').trim();
    if(!key) return;
    if(!map[key]) map[key]={ provider:key, points:[] };
    map[key].points.push({ date:p.date, skus:p.skus||0, value:incVat(p.value||0), notes:p.notes||'' });   // £ shown VAT-inclusive
  });
  const allDates=[...new Set(PROVIDER_SNAPSHOTS.map(p=>p.date))].sort();
  const latestDate=allDates[allDates.length-1]||null;
  // better/worse like the rest of the app: last week's imports averaged vs the week two weeks before
  const w2 = (typeof ldWindows==='function' && allDates.length>1) ? ldWindows(allDates) : null;
  return Object.values(map).map(s=>{
    s.points.sort((a,b)=>a.date.localeCompare(b.date));
    const last=s.points[s.points.length-1];
    // missing from the latest import = sold out; its last count is not "now" (it used to freeze)
    const soldOut = !!(last && latestDate && last.date < latestDate);
    const cur = soldOut ? { date:latestDate, skus:0, value:0 } : last;
    const prev = soldOut ? last : (s.points.length>1?s.points[s.points.length-2]:null);
    const current=cur?cur.skus:0;
    const previous=prev?prev.skus:null;
    const byDate=new Map(s.points.map(p=>[p.date,p]));
    const at=(d,k)=>byDate.has(d)?(byDate.get(d)[k]||0):(d>s.points[0].date?0:null);
    const av=(ds,k)=>{ const v=ds.map(d=>at(d,k)).filter(x=>x!=null); return v.length?v.reduce((a,b)=>a+b,0)/v.length:null; };
    const two = w2&&w2.then ? { skusThen:av(w2.then,'skus'), skusNow:av(w2.now,'skus'), valThen:av(w2.then,'value'), valNow:av(w2.now,'value'), nowDates:w2.now, thenDates:w2.then } : null;
    const diff2 = two&&two.skusThen!=null&&two.skusNow!=null ? two.skusNow-two.skusThen : null;
    const valueDiff2 = two&&two.valThen!=null&&two.valNow!=null ? two.valNow-two.valThen : null;
    const diff=previous!=null?current-previous:null;
    const pct=(previous!=null&&previous!==0)?(diff/previous*100):null;
    const currentValue=cur?cur.value:0;
    const previousValue=prev?prev.value:null;
    const valueDiff=previousValue!=null?+(currentValue-previousValue).toFixed(2):null;
    const counts=s.points.map(p=>p.skus);
    const values=s.points.map(p=>p.value);
    return { ...s, current, previous, diff, pct, currentValue, previousValue, valueDiff, soldOut, soldOutSince: soldOut ? allDates.find(d=>d>last.date) : null, two, diff2, valueDiff2,
      firstDate:s.points[0].date, latestDate:cur?cur.date:null,
      isNew:(s.points[0].date===latestDate && s.points.length===1),
      maxInc:provMaxStep(s.points,'inc'), maxDec:provMaxStep(s.points,'dec'),
      peak:Math.max(...counts), low:Math.min(...counts),
      peakValue:Math.max(...values), lowValue:Math.min(...values),
      hasValuation: values.some(v=>v>0) };
  });
}

function trendGlyph(diff){
  if(diff==null) return '<span style="color:var(--muted2)">▬</span>';
  if(diff>0) return '<span style="color:var(--g)">▲</span>';
  if(diff<0) return '<span style="color:var(--r)">▼</span>';
  return '<span style="color:var(--muted2)">▬</span>';
}

// Master display order: defined providers first (in saved order), then any snapshot-only providers
function orderedProviderNames(series){
  const defs = PROVIDER_DEFS.slice();
  const blocked = new Set([...defs, ...ARCHIVED_PROVIDERS].map(n => n.toLowerCase()));
  const extras = series.map(s => s.provider).filter(n => !blocked.has(n.toLowerCase()))
    .sort((a,b) => a.localeCompare(b));
  return defs.concat(extras);
}
function isArchived(name){ return ARCHIVED_PROVIDERS.some(n => n.toLowerCase() === (name||'').toLowerCase()); }
function placeholderProvider(name){
  return { provider:name, points:[], current:0, previous:null, diff:null, pct:null,
    currentValue:0, previousValue:null, valueDiff:null, hasValuation:false,
    firstDate:null, latestDate:null, isNew:false, maxInc:null, maxDec:null, peak:0, low:0, peakValue:0, lowValue:0 };
}
// Returns provider series in display order, including defined providers that have no snapshots yet
function buildOrderedProviders(){
  const series = buildProviderSeries();
  const map = {}; series.forEach(s => map[s.provider.toLowerCase()] = s);
  return orderedProviderNames(series).map(name => map[name.toLowerCase()] || placeholderProvider(name));
}

function renderProviderKpis({series, totalSkus, totalValuation, largest, grower, decliner, newCount, concPct, sortedByCurrent, top3Sum}){
  const row = document.getElementById('provKpiRow');
  if (!row) return;
  const moneyFmt=v=>'£'+(v||0).toLocaleString(undefined,{maximumFractionDigits:0});
  const concCol = concPct==null?'var(--muted2)':concPct>=70?'#ff8c42':concPct>=50?'#ffd166':'#22c55e';
  const concVerdict = concPct==null?'No data yet':concPct>=70?'High risk — concentrated':concPct>=50?'Moderate concentration':'Well diversified';
  const namesTop3 = sortedByCurrent.slice(0,3).map(s=>s.provider).filter(Boolean);

  // Overall health signal: are more providers growing than declining this period?
  // counted on the 2-week average, by £ where there is £ (one import is mostly noise)
  const mv = s => s.valueDiff2!=null && s.hasValuation ? s.valueDiff2 : s.diff2;
  const withDiff = series.filter(s=>mv(s)!=null && (s.current>0 || s.soldOut));
  const growing = withDiff.filter(s=>mv(s)>=1).length;
  const declining = withDiff.filter(s=>mv(s)<=-1).length;
  const flat = withDiff.length - growing - declining;
  const healthDir = growing>declining?'improving':declining>growing?'declining':'mixed';
  const healthCol = healthDir==='improving'?'#22c55e':healthDir==='declining'?'#ff4d6d':'#a7b4c4';
  const healthVerdict = healthDir==='improving'
    ? `${growing} growing · ${declining} shrinking · ${flat} flat (stock £, 2 weeks averaged)`
    : healthDir==='declining'
    ? `${declining} shrinking · ${growing} growing · ${flat} flat (stock £, 2 weeks averaged) — selling down or not restocked`
    : `${growing} growing · ${declining} shrinking · ${flat} flat (stock £, 2 weeks averaged)`;

  // Grower/decliner sparkline data
  const growerCounts = grower ? grower.points.map(p=>p.skus) : [];
  const declinerCounts = decliner ? decliner.points.map(p=>p.skus) : [];

  row.innerHTML = `
    <!-- Row 1: 4 tiles -->
    <div style="background:var(--s1);border:1px solid var(--border);border-top:3px solid ${healthCol};border-radius:12px;padding:18px 20px">
      <div style="font-family:var(--mono);font-size:10px;letter-spacing:.09em;text-transform:uppercase;color:var(--muted2);margin-bottom:10px">Portfolio health</div>
      <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:6px">
        <span style="font-family:var(--mono);font-size:34px;font-weight:700;color:var(--text);line-height:1">${totalSkus.toLocaleString()}</span>
        <span style="font-family:var(--mono);font-size:12px;color:var(--muted2)">SKUs · ${series.filter(s=>s.current>0).length} providers</span>
      </div>
      ${totalValuation>0?`<div style="font-family:var(--mono);font-size:13px;color:#3d9eff;margin-bottom:10px;font-weight:600">${moneyFmt(totalValuation)} matched to providers</div>`:'<div style="margin-bottom:10px"></div>'}
      <div style="font-family:var(--mono);font-size:10px;color:${healthCol};line-height:1.5">${healthVerdict}</div>
    </div>

    <div onclick="${largest?`openProviderDetail('${largest.provider.replace(/'/g,"\\'")}')`:''}" style="background:var(--s1);border:1px solid var(--border);border-top:3px solid #ffd166;border-radius:12px;padding:18px 20px;${largest?'cursor:pointer;transition:background .15s':''}">
      <div style="font-family:var(--mono);font-size:10px;letter-spacing:.09em;text-transform:uppercase;color:#ffd166;margin-bottom:10px">Largest provider</div>
      ${largest ? `
        <div style="font-size:16px;font-weight:700;color:var(--text);margin-bottom:4px">${largest.provider}</div>
        <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:6px">
          <span style="font-family:var(--mono);font-size:28px;font-weight:700;color:var(--text)">${largest.current.toLocaleString()}</span>
          <span style="font-family:var(--mono);font-size:11px;color:var(--muted2)">SKUs</span>
          ${largest.diff!=null?`<span style="font-family:var(--mono);font-size:12px;font-weight:700;color:${largest.diff>0?'#22c55e':largest.diff<0?'#ff4d6d':'var(--muted2)'};margin-left:auto">${largest.diff>0?'▲ +':'▼ '}${Math.abs(largest.diff)}</span>`:''}
        </div>
        <div style="font-family:var(--mono);font-size:10px;color:var(--muted2)">${largest.pct!=null?(largest.pct>0?'+':'')+largest.pct.toFixed(1)+'% vs last · ':''} ${Math.round((largest.current/totalSkus)*100)}% of total SKUs</div>
      ` : '<div style="color:var(--muted2);font-family:var(--mono);font-size:11px">No data yet</div>'}
    </div>

    <div onclick="${grower&&grower.diff>0?`openProviderDetail('${grower.provider.replace(/'/g,"\\'")}')`:''}" style="background:var(--s1);border:1px solid var(--border);border-top:3px solid #22c55e;border-radius:12px;padding:18px 20px;${grower&&grower.diff>0?'cursor:pointer;transition:background .15s':''}">
      <div style="font-family:var(--mono);font-size:10px;letter-spacing:.09em;text-transform:uppercase;color:#00f5a0;margin-bottom:10px">Fastest growing · 2 weeks</div>
      ${grower&&grower.diff>0 ? `
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px">
          <div>
            <div style="font-size:15px;font-weight:700;color:var(--text);margin-bottom:4px">${grower.provider}</div>
            <div style="font-family:var(--mono);font-size:26px;font-weight:700;color:#00f5a0;line-height:1">${grower.moveVal!=null?'+'+moneyFmt(grower.moveVal):(grower.diff>0?'+':'')+grower.diff+' SKUs'}</div>
            <div style="font-family:var(--mono);font-size:10px;color:var(--muted2);margin-top:4px">${grower.diff>0?'+':grower.diff<0?'−':''}${Math.abs(grower.diff)} SKUs · now ${grower.current} SKUs${grower.currentValue?' · '+moneyFmt(grower.currentValue):''}</div>
          </div>
          <div style="height:52px;width:80px;flex:none"><canvas id="provKpiGrowerSpark"></canvas></div>
        </div>
      ` : `<div style="color:var(--muted2);font-family:var(--mono);font-size:11px;margin-top:8px">No growth this period</div>`}
    </div>

    <div onclick="${decliner&&decliner.diff<0?`openProviderDetail('${decliner.provider.replace(/'/g,"\\'")}')`:''}" style="background:var(--s1);border:1px solid var(--border);border-top:3px solid #ff4d6d;border-radius:12px;padding:18px 20px;${decliner&&decliner.diff<0?'cursor:pointer;transition:background .15s':''}">
      <div style="font-family:var(--mono);font-size:10px;letter-spacing:.09em;text-transform:uppercase;color:#ff8c42;margin-bottom:10px">Biggest fall · 2 weeks</div>
      ${decliner&&decliner.diff<0 ? `
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px">
          <div>
            <div style="font-size:15px;font-weight:700;color:var(--text);margin-bottom:4px">${decliner.provider}</div>
            <div style="font-family:var(--mono);font-size:26px;font-weight:700;color:#ff8c42;line-height:1">${decliner.moveVal!=null?'−'+moneyFmt(Math.abs(decliner.moveVal)):decliner.diff+' SKUs'}</div>
            <div style="font-family:var(--mono);font-size:10px;color:var(--muted2);margin-top:4px">${decliner.diff>0?'+':decliner.diff<0?'−':''}${Math.abs(decliner.diff)} SKUs · now ${decliner.current} SKUs${decliner.currentValue?' · '+moneyFmt(decliner.currentValue):''}${decliner.soldOut?' · sold out':''}</div>
          </div>
          <div style="height:52px;width:80px;flex:none"><canvas id="provKpiDeclinerSpark"></canvas></div>
        </div>
      ` : `<div style="color:var(--muted2);font-family:var(--mono);font-size:11px;margin-top:8px">No declines this period</div>`}
    </div>
  `;

  // Row 2 — separate grid so grid-column spans work correctly.
  // Remove any previously-inserted row2 first, or it stacks a new copy every re-render.
  const oldRow2 = document.getElementById('provKpiRow2');
  if (oldRow2) oldRow2.remove();
  const row2 = document.createElement('div');
  row2.id = 'provKpiRow2';
  row2.style.cssText = `display:grid;grid-template-columns:2fr 1fr 1fr;gap:12px;margin-bottom:16px`;
  row2.innerHTML = `
    <div style="background:var(--s1);border:1px solid var(--border);border-top:3px solid ${concCol};border-radius:12px;padding:18px 20px">
      <div style="font-family:var(--mono);font-size:10px;letter-spacing:.09em;text-transform:uppercase;color:${concCol};margin-bottom:10px">Supplier concentration — top 3 coverage</div>
      <div style="display:flex;align-items:center;gap:16px">
        <div style="font-family:var(--mono);font-size:38px;font-weight:700;color:${concCol};line-height:1;flex:none">${concPct!=null?concPct+'%':'—'}</div>
        <div>
          <div style="font-family:var(--mono);font-size:11px;color:var(--text);margin-bottom:4px">${concVerdict}</div>
          <div style="font-family:var(--mono);font-size:10px;color:var(--muted2)">${namesTop3.length?namesTop3.join(', ')+' → '+top3Sum.toLocaleString()+' SKUs':''}</div>
        </div>
      </div>
    </div>

    <div style="background:var(--s1);border:1px solid var(--border);border-top:3px solid var(--p);border-radius:12px;padding:18px 20px">
      <div style="font-family:var(--mono);font-size:10px;letter-spacing:.09em;text-transform:uppercase;color:var(--p);margin-bottom:10px">Providers tracked</div>
      <div style="font-family:var(--mono);font-size:34px;font-weight:700;color:var(--text);line-height:1;margin-bottom:10px">${series.filter(s=>s.current>0).length}</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <div style="font-family:var(--mono);font-size:11px;color:#22c55e;font-weight:600">${growing} growing</div>
        <div style="font-family:var(--mono);font-size:11px;color:#ff8c42;font-weight:600">${declining} shrinking</div>
        <div style="font-family:var(--mono);font-size:11px;color:var(--muted2)">${flat} flat</div>
      </div>
    </div>

    ${totalValuation>0?(()=>{ const entered=(typeof DB!=='undefined'?[...DB].sort((a,b)=>a.date.localeCompare(b.date)).pop():null)?.stockValue||0;
      // Jack's rule: the figure you entered is the total; providers only cover what was matched
      return `<div style="background:var(--s1);border:1px solid var(--border);border-top:3px solid #3d9eff;border-radius:12px;padding:18px 20px">
      <div style="font-family:var(--mono);font-size:10px;letter-spacing:.09em;text-transform:uppercase;color:#3d9eff;margin-bottom:10px">Stock value</div>
      <div style="font-family:var(--mono);font-size:26px;font-weight:700;color:#3d9eff;line-height:1;margin-bottom:8px">${entered?moneyFmt(entered):moneyFmt(totalValuation)}</div>
      <div style="font-family:var(--mono);font-size:10px;color:var(--muted2)">${entered?(()=>{ const c = coverExVat(totalValuation, entered); return `your entered figure · ${moneyFmt(totalValuation)} matched to ${series.filter(s=>s.currentValue>0).length} providers = <b style="color:${coverCol(c)}">${c!=null?c.toFixed(1)+'%':'—'}</b> of it (the rest is N/A or stuck stock)`; })():`across ${series.filter(s=>s.currentValue>0).length} providers`}</div>
    </div>`; })():`<div style="background:var(--s2);border:1px dashed var(--border);border-radius:12px;padding:18px 20px;display:flex;align-items:center;justify-content:center">
      <div style="font-family:var(--mono);font-size:10px;color:var(--muted);text-align:center">Valuation available after<br>importing a SellerToolKit file</div>
    </div>`}
  `;
  row.parentNode.insertBefore(row2, row.nextSibling);

  // Draw inline sparklines for grower/decliner tiles
  setTimeout(()=>{
    const drawMini=(id, data, col)=>{
      const cv=document.getElementById(id); if(!cv||!data.length) return;
      destroyChart(id);
      const spread = Math.max(...data)-Math.min(...data);
      const pad = Math.max(1, Math.round(spread*0.4));
      chartInstances[id]=new Chart(cv.getContext('2d'),{
        type:'line',
        data:{ labels:data.map((_,k)=>k), datasets:[{ data, borderColor:col, backgroundColor:col+'18', borderWidth:2.2, tension:.3, pointRadius:ctx=>ctx.dataIndex===ctx.dataset.data.length-1?3:0, pointHoverRadius:4, pointBackgroundColor:col, pointBorderColor:'#07090c', pointBorderWidth:1, tension:.4, fill:true }] },
        options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{display:false}, datalabels:{display:false}, tooltip:{enabled:false} },
          scales:{ x:{display:false}, y:{ display:false, min:Math.max(0,Math.min(...data)-pad), max:Math.max(...data)+pad } } }
      });
    };
    if(grower&&grower.diff>0) drawMini('provKpiGrowerSpark', growerCounts, '#22c55e');
    if(decliner&&decliner.diff<0) drawMini('provKpiDeclinerSpark', declinerCounts, '#ff4d6d');
  },0);
}

function renderProviderTab(){
  providerSearch=(document.getElementById('provSearch')?.value||'').toLowerCase();
  const series=buildProviderSeries().filter(s=>!isArchived(s.provider));
  const ordered=buildOrderedProviders();
  const totalProviders=ordered.length;

  // the nav badge counts providers with stock now, not every name ever defined
  const badge=document.getElementById('providerNavBadge'); if(badge) badge.textContent=series.filter(s=>s.current>0).length;

  const totalSkus=series.reduce((a,s)=>a+s.current,0);
  const totalValuation=series.reduce((a,s)=>a+(s.currentValue||0),0);
  const largest=series.slice().sort((a,b)=>b.current-a.current)[0]||null;
  // movers on the 2-week average (by £ where there is £), never one import
  const mv = s => s.valueDiff2!=null && s.hasValuation ? s.valueDiff2 : s.diff2;
  const withDiff=series.filter(s=>mv(s)!=null);
  const pick = (s, sign) => s ? { ...s, diff: Math.round(s.diff2??0), pct: s.two&&s.two.skusThen ? (s.diff2/s.two.skusThen*100) : null, moveVal: s.valueDiff2 } : null;
  const gTop=withDiff.slice().sort((a,b)=>mv(b)-mv(a))[0]; const dTop=withDiff.slice().sort((a,b)=>mv(a)-mv(b))[0];
  const grower = gTop && mv(gTop) > 0.5 ? pick(gTop) : null;
  const decliner = dTop && mv(dTop) < -0.5 ? pick(dTop) : null;
  const newCount=series.filter(s=>s.isNew).length;
  const sortedByCurrent=series.slice().sort((a,b)=>b.current-a.current);
  const top3Sum=sortedByCurrent.slice(0,3).reduce((a,s)=>a+s.current,0);
  const concPct=totalSkus>0?Math.round((top3Sum/totalSkus)*100):null;

  renderProviderKpis({series, totalSkus, totalValuation, largest, grower, decliner, newCount, concPct, sortedByCurrent, top3Sum});
  const snapDates = new Set((DB||[]).map(x=>x.date));
  const orphans = [...new Set(PROVIDER_SNAPSHOTS.map(p=>p.date))].filter(d=>!snapDates.has(d)).sort();
  const orphEl = document.getElementById('provOrphanNote') || (() => { const el=document.createElement('div'); el.id='provOrphanNote'; const kr=document.getElementById('provKpiRow'); kr?.parentNode?.insertBefore(el, kr); return el; })();
  orphEl.innerHTML = orphans.length ? `<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;background:rgba(255,209,102,.08);border:1px solid rgba(255,209,102,.35);border-radius:10px;padding:10px 14px;margin-bottom:12px;font-family:var(--mono);font-size:12px;color:var(--y)"><span style="flex:1;min-width:280px">${orphans.length} provider import${orphans.length!==1?'s have':' has'} no matching inventory snapshot (${orphans.map(fmt).join(', ')}) — left over from deleted snapshots, and still counted in the charts here.</span><button class="cmp-chip" onclick="removeOrphanProviderDates()">Remove them</button></div>` : '';

  let rows=ordered.slice();
  if(providerSearch) rows=rows.filter(s=>s.provider.toLowerCase().includes(providerSearch));
  provSetT('provMeta', `${rows.filter(s=>s.points.length).length} of ${totalProviders} providers with data`);

  // Sync toggle button state
  const hasAnyVal = rows.some(s=>s.hasValuation && s.currentValue>0);
  const tog = document.getElementById('provMetricToggle');
  if (tog) tog.style.display = hasAnyVal ? '' : 'none';
  ['skus','val','both'].forEach(m=>{
    const btn=document.getElementById('provMetricBtn'+m.charAt(0).toUpperCase()+m.slice(1));
    if (!btn) return;
    const active = (m==='val'&&provCardMetric==='value')||(m==='skus'&&provCardMetric==='skus')||(m==='both'&&provCardMetric==='both');
    btn.style.background = active ? (m==='val'?'#3d9eff':'var(--g)') : 'none';
    btn.style.color = active ? (m==='val'?'#07090c':'var(--bg)') : 'var(--muted2)';
    btn.style.fontWeight = active ? '700' : '400';
  });

  const withData = rows.filter(s=>s.points.length>0 && !(s.current===0 && !s.soldOut && s.points.every(p=>!p.skus))).slice().sort((a,b)=>{
    if (provCardMetric==='value') return (b.currentValue||0)-(a.currentValue||0);
    return b.current-a.current;
  });
  // no stock in the latest import (never had any, or sold out / zero every time)
  const noData = rows.filter(s=>s.points.length===0 || (s.current===0 && !s.soldOut && s.points.every(p=>!p.skus)));

  const cardGrid = document.getElementById('provCardGrid');
  const noDataSection = document.getElementById('provNoDataSection');
  const noDataList = document.getElementById('provNoDataList');

  if (cardGrid){
    if (!withData.length){
      cardGrid.innerHTML=`<div style="grid-column:1/-1;padding:40px;text-align:center;font-family:var(--mono);font-size:12px;color:var(--muted2)">${totalProviders?'No providers match your search.':'No providers yet — add them in Settings or in the snapshot form.'}</div>`;
    } else {
      const moneyFmt=v=>'£'+(v||0).toLocaleString(undefined,{maximumFractionDigits:0});
      const showSkus = provCardMetric==='skus'||provCardMetric==='both';
      const showVal  = (provCardMetric==='value'||provCardMetric==='both') && hasAnyVal;

      cardGrid.innerHTML = withData.map((s,i)=>{
        const col = provColor(s.provider);
        const n = s.points.length;
        const safe = s.provider.replace(/[^\w]/g,'_');
        const esc  = s.provider.replace(/'/g,"\\'");

        // vs last snapshot
        const diffSkus = s.diff;
        const pctSkus  = s.pct;
        const diffVal  = s.valueDiff;
        const diffCol  = diffSkus==null?'var(--muted2)':diffSkus>0?'var(--g)':diffSkus<0?'var(--r)':'var(--muted2)';
        const valDiffCol = diffVal==null?'var(--muted2)':diffVal>0?'#3d9eff':diffVal<0?'var(--r)':'var(--muted2)';
        // the chip is the 2-week change (by £ where there is £); the last import is a quiet number
        const m2 = s.valueDiff2!=null && s.hasValuation ? s.valueDiff2 : s.diff2;
        const m2Txt = m2==null ? '—' : Math.abs(m2) < (s.hasValuation?1:0.5) ? '→ flat' : (m2>0?'▲ +':'▼ −') + (s.hasValuation&&s.valueDiff2!=null ? moneyFmt(Math.abs(m2)) : Math.abs(Math.round(m2)) + ' SKUs');
        const badgeText = m2Txt + (m2!=null ? ' · 2 wks' : '');
        const badgeBg  = m2==null||Math.abs(m2)<1?'var(--s3)':m2>0?'rgba(0,245,160,.15)':'rgba(255,140,66,.15)';
        const badgeCol = m2==null||Math.abs(m2)<1?'var(--muted2)':m2>0?'var(--g)':'var(--o)';

        // vs 6 snapshots ago (or first if fewer)
        const p6ago = n>=7 ? s.points[n-7] : s.points[0];
        const vs6skus = p6ago && n>1 ? s.current - p6ago.skus : null;
        const vs6val  = p6ago && n>1 && showVal ? s.currentValue - (p6ago.value||0) : null;
        const vs6Label = n>=7 ? 'vs 6 ago' : n>1 ? `vs ${n-1} ago` : null;
        const vs6SCol = vs6skus==null?'var(--muted2)':vs6skus>0?'var(--g)':vs6skus<0?'var(--r)':'var(--muted2)';
        const vs6VCol = vs6val==null?'var(--muted2)':vs6val>0?'#3d9eff':vs6val<0?'var(--r)':'var(--muted2)';

        // streak and verdict
        const counts=s.points.map(p=>p.skus);
        let streak=0;
        for(let k=counts.length-1;k>=1;k--){
          const d=counts[k]-counts[k-1];
          if(k===counts.length-1) streak=d>0?1:d<0?-1:0;
          else if((streak>0&&d>0)||(streak<0&&d<0)) streak+=streak>0?1:-1;
          else break;
        }
        let verdict='', verdictCol='var(--muted2)';
        if(s.soldOut){ verdict=`Sold out — none in the ${fmt(s.soldOutSince)} import`; verdictCol='var(--o)'; }
        else if(n<2){ verdict='Baseline set'; }
        // the same 2-week read as the chip (the old "declining 3× in a row" counted single imports)
        else if(m2!=null && m2>=1){ verdict='▲ Growing over 2 weeks'; verdictCol='var(--g)'; }
        else if(m2!=null && m2<=-1){ verdict='▼ Shrinking over 2 weeks — selling down or not restocked'; verdictCol='var(--o)'; }
        else { verdict='→ Steady over 2 weeks'; }

        const skuLine = showSkus ? `
          <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:${showVal?'4px':'6px'}">
            <span style="font-family:var(--mono);font-size:${showVal?'22px':'28px'};font-weight:700;color:var(--text);line-height:1">${s.current.toLocaleString()}</span>
            <span style="font-family:var(--mono);font-size:10px;color:var(--muted2)">SKUs</span>
            ${diffSkus!=null?`<span style="font-family:var(--mono);font-size:11px;color:${diffCol};margin-left:auto">${diffSkus>0?'+':diffSkus<0?'−':'±'}${Math.abs(diffSkus)}</span>`:''}
          </div>` : '';

        const valLine = showVal && s.currentValue>0 ? `
          <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:6px">
            <span style="font-family:var(--mono);font-size:${showSkus?'16px':'28px'};font-weight:700;color:#3d9eff;line-height:1">${moneyFmt(s.currentValue)}</span>
            ${diffVal!=null&&showVal?`<span style="font-family:var(--mono);font-size:11px;color:${valDiffCol};margin-left:auto">${diffVal>0?'+':diffVal<0?'−':'±'}${moneyFmt(Math.abs(diffVal))}</span>`:''}
          </div>` : (showVal?`<div style="margin-bottom:6px;font-family:var(--mono);font-size:11px;color:var(--muted)">No valuation data</div>`:'');

        const vs6Row = `
          <div style="font-family:var(--mono);font-size:10px;color:var(--muted2);line-height:1.8;padding-top:6px;border-top:1px solid var(--border);margin-top:4px;display:flex;justify-content:space-between;gap:8px">
            <span>${diffSkus!=null?`last import <span style="color:${diffSkus>0?'var(--g)':diffSkus<0?'var(--o)':'var(--muted2)'}">${diffSkus>0?'+':diffSkus<0?'−':'±'}${Math.abs(diffSkus)} SKUs</span>${diffVal!=null&&showVal?` · <span style="color:${diffVal>0?'var(--g)':diffVal<0?'var(--o)':'var(--muted2)'}">${diffVal>0?'+':diffVal<0?'−':'±'}${moneyFmt(Math.abs(diffVal))}</span>`:''}`:''}</span>
            <span onclick="event.stopPropagation();shGoToProvider('${esc}')" style="color:var(--b);cursor:pointer;white-space:nowrap" title="Its stock past 90 days, on the Stock Health page">stale stock ›</span>
          </div>`;

        return `<div onclick="openProviderDetail('${esc}')" style="background:var(--s1);border:1px solid var(--border);border-top:3px solid ${col};border-radius:12px;padding:16px 18px;cursor:pointer;transition:background .15s;display:flex;flex-direction:column" onmouseover="this.style.background='var(--s2)'" onmouseout="this.style.background='var(--s1)'">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:10px">
            <div>
              <div style="font-weight:700;font-size:13px;color:var(--text)">${kfEsc(s.provider)}${s.isNew?` <span style="font-family:var(--mono);font-size:11px;background:rgba(255,209,102,.15);color:var(--y);padding:2px 6px;border-radius:3px">NEW</span>`:''}</div>
              <div style="font-family:var(--mono);font-size:10px;color:var(--muted2);margin-top:2px">${s.soldOut?`<span style="color:var(--o)">sold out since ${fmt(s.soldOutSince)}</span>`:`since ${fmt(s.firstDate)}`}${s.current>0&&s.currentValue>0?` · ${moneyFmt(s.currentValue/s.current)} per SKU`:''}</div>
            </div>
            <div style="font-family:var(--mono);font-size:11px;font-weight:700;padding:4px 9px;border-radius:6px;background:${badgeBg};color:${badgeCol};flex:none;white-space:nowrap" title="${s.two?`Average of imports ${fmtShort(s.two.nowDates[0])}–${fmtShort(s.two.nowDates[s.two.nowDates.length-1])} vs ${fmtShort(s.two.thenDates[0])}–${fmtShort(s.two.thenDates[s.two.thenDates.length-1])}`:''}">${badgeText}</div>
          </div>
          ${skuLine}${valLine}
          <div style="height:52px;margin-bottom:6px"><canvas id="provspark_${safe}" style="display:block;width:100%;height:100%"></canvas></div>
          <div style="font-family:var(--mono);font-size:10px;color:${verdictCol};margin-bottom:2px">${verdict}</div>
          ${vs6Row}
        </div>`;
      }).join('');

      // Draw sparklines — zoomed in tightly to actual data range
      setTimeout(()=>{
        withData.forEach(s=>{
          if(!s.points.length) return;
          const col = provColor(s.provider);
          const safe = s.provider.replace(/[^\w]/g,'_');
          const cv = document.getElementById('provspark_'+safe);
          if(!cv) return;
          const id='provspark_'+safe;
          destroyChart(id);
          const useVal = provCardMetric==='value' && s.hasValuation;
          const data = useVal ? s.points.map(p=>p.value||0) : s.points.map(p=>p.skus);
          const dlabels = s.points.map(p=>fmtShort(p.date));
          const spread = Math.max(...data)-Math.min(...data);
          // Tight zoom: 20% padding on spread (not 40%), minimum 1 unit
          const pad = Math.max(useVal?50:1, Math.round(spread*0.2));
          const ymin = Math.max(0, Math.min(...data)-pad);
          const ymax = Math.max(...data)+pad;
          const moneyFmt=v=>'£'+(v||0).toLocaleString(undefined,{maximumFractionDigits:0});
          chartInstances[id]=new Chart(cv.getContext('2d'),{
            type:'line',
            data:{ labels:dlabels, datasets:[{ data, borderColor:col, backgroundColor:col+'18', borderWidth:2.2, tension:.3, pointRadius:ctx=>ctx.dataIndex===ctx.dataset.data.length-1?3:0, pointHoverRadius:4, pointBackgroundColor:col, pointBorderColor:'#07090c', pointBorderWidth:1, tension:.4, fill:true }] },
            options:{ responsive:true, maintainAspectRatio:false, interaction:{mode:'index',intersect:false},
              plugins:{ legend:{display:false}, datalabels:{display:false},
                tooltip:{ backgroundColor:'rgba(7,9,12,.98)', titleColor:'#dce6f0', bodyColor:'#dce6f0', borderColor:col, borderWidth:1, padding:8, displayColors:false,
                  callbacks:{ title:items=>dlabels[items[0].dataIndex]||'', label:ctx=>useVal?moneyFmt(ctx.parsed.y):`${ctx.parsed.y.toLocaleString()} SKUs` } } },
              scales:{ x:{display:false}, y:{ display:false, min:ymin, max:ymax } } }
          });
        });
      },0);
    }
  }

  // "Not yet tracked" compact pill list
  if (noDataSection && noDataList){
    if (noData.length && !providerSearch){
      noDataSection.style.display='';
      noDataList.innerHTML = noData.map(s=>{
        const esc=s.provider.replace(/'/g,"\\'");
        return `<span onclick="openProviderDetail('${esc}')" style="font-family:var(--mono);font-size:11px;color:var(--muted2);border:1px solid var(--border);border-radius:6px;padding:4px 10px;cursor:pointer;transition:all .15s" onmouseover="this.style.borderColor='var(--border2)';this.style.color='var(--text)'" onmouseout="this.style.borderColor='var(--border)';this.style.color='var(--muted2)'">${s.provider}</span>`;
      }).join('');
    } else {
      noDataSection.style.display='none';
    }
  }

  renderProviderTrendChart(ordered);
  renderProviderShareChart(ordered);
}

// Provider figures whose inventory snapshot was deleted before deleting took them too.
async function removeOrphanProviderDates(){
  const snapDates = new Set((DB||[]).map(x=>x.date));
  const orphans = [...new Set(PROVIDER_SNAPSHOTS.map(p=>p.date))].filter(d=>!snapDates.has(d)).sort();
  if (!orphans.length) return;
  const n = PROVIDER_SNAPSHOTS.filter(p => orphans.includes(p.date)).length;
  if (!confirm(`Remove ${n} provider figures for ${orphans.map(fmt).join(', ')}?\n\nThese dates have no inventory snapshot. Nothing else is touched. This can't be undone.`)) return;
  showSyncStatus('loading');
  let failed = [];
  for (const d of orphans) {
    try { const { error } = await supabase.from('bdl_provider_snapshots').delete().eq('date', d); if (error) failed.push(fmt(d)); }
    catch(e) { failed.push(fmt(d)); }
  }
  const ok = orphans.filter(d => !failed.includes(fmt(d)));
  PROVIDER_SNAPSHOTS = PROVIDER_SNAPSHOTS.filter(p => !ok.includes(p.date));
  showSyncStatus(failed.length ? 'error' : 'saved');
  renderProviderTab(); renderHistory();
  if (failed.length) alert(`⚠ Couldn't remove ${failed.join(', ')} — nothing else changed. Try again in a moment.`);
  else showToast(`✓ Removed the leftover provider figures for ${orphans.map(fmt).join(', ')}`);
  setTimeout(() => showSyncStatus(''), 1500);
}
function setProvCardMetric(m){
  provCardMetric = m;
  renderProviderTab();
}

// ── Provider tab: per-provider mini trend cards, Stock Health zone-card style ──
const PROV_MINI_PALETTE = ['#00f5a0','#3d9eff','#ffd166','#c084fc','#ff8c42','#22c55e','#ef4444','#ca8a04','#2dd4bf','#f472b6'];
function provMiniColor(i){ return PROV_MINI_PALETTE[i % PROV_MINI_PALETTE.length]; }
// One colour per provider, from its name — the same on the cards, both charts and the Stock Health
// table. Kept out of the pure green / red bands, which mean up / down everywhere else.
function provHue(name){ let h = typeof ldHue === 'function' ? ldHue(name) : 0; if (h < 22 || h > 335) h = (h + 45) % 360; if (h > 135 && h < 175) h += 45; return h; }
function provColor(name){
  if (name === 'Other') return '#5a6478';
  const h = provHue(name), sat = .78, l = .63, a = sat * Math.min(l, 1 - l), k = n => (n + h / 30) % 12;
  const f = n => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))))).toString(16).padStart(2, '0');
  return '#' + f(0) + f(8) + f(4);
}
const provAvatar = name => { const h = provHue(name), L = String(name).replace(/[^A-Za-z0-9 ]/g,'').split(/\s+/).filter(Boolean).slice(0,2).map(w => w[0].toUpperCase()).join('') || '?';
  return `<span class="ld-av" style="background:hsla(${h},75%,55%,.16);color:hsl(${h},85%,72%);border-color:hsla(${h},75%,60%,.35)">${L}</span>`; };

function renderProviderShareChart(series){
  const box=document.getElementById('provShareList'); if(!box) return;
  const tag=document.getElementById('provShareTag');
  const useV = provCardMetric!=='skus' && series.some(s=>s.currentValue>0);
  const amt = s => useV ? (s.currentValue||0) : s.current;
  const rows=series.filter(s=>amt(s)>0 && !isArchived(s.provider)).sort((a,b)=>amt(b)-amt(a));
  if(!rows.length){ box.innerHTML='<div style="padding:18px;color:var(--muted2);font-size:12px">No provider import yet.</div>'; if(tag) tag.textContent='No data'; return; }
  const total=rows.reduce((t,s)=>t+amt(s),0)||1, top=amt(rows[0])||1;
  if(tag) tag.textContent = useV ? `${fmtGBP(total)} across ${rows.length} providers` : `${total.toLocaleString()} SKUs across ${rows.length} providers`;
  const chg = s => { const d = useV ? s.valueDiff2 : s.diff2; if(d==null) return '<span class="pv-chg flat">—</span>';
    const r = useV ? Math.round(d) : Math.round(d); if(!r) return '<span class="pv-chg flat">no change</span>';
    return `<span class="pv-chg ${r>0?'up':'down'}" title="2-week average, like the rest of the app">${r>0?'▲':'▼'} ${useV?fmtGBPAbs(r):Math.abs(r).toLocaleString()+' SKUs'}</span>`; };
  box.innerHTML = `<div class="pv-stack">${rows.map(s=>`<i style="flex:${amt(s)};background:${provColor(s.provider)}" title="${kfEsc(s.provider)} · ${(amt(s)/total*100).toFixed(1)}%"></i>`).join('')}</div>
    <div class="pv-rows">${rows.map(s=>{ const c=provColor(s.provider), share=amt(s)/total*100;
      return `<div class="pv-row" onclick="openProviderDetail('${s.provider.replace(/'/g,"\\'")}')" title="Open ${kfEsc(s.provider)}">
        <span class="pv-name"><i style="background:${c}"></i>${kfEsc(s.provider)}</span>
        <span class="pv-amt">${useV?fmtGBP(amt(s)):amt(s).toLocaleString()}<em>${useV?`${s.current.toLocaleString()} SKUs`:'SKUs'}</em></span>
        <span class="pv-bar"><b style="width:${Math.max(1.5,amt(s)/top*100)}%;background:${c}"></b></span>
        <span class="pv-share">${share.toFixed(1)}%</span>
        ${chg(s)}
      </div>`; }).join('')}</div>`;
}
function renderProviderTrendChart(){}   // retired: the 11-line chart; each provider card below has its own trend
function toggleProvider(){}

// ── Provider detail popup ──
let _provDetailMetric = 'skus'; // 'skus' | 'value' — which series the main chart shows
function openProviderDetail(name){
  const s=buildProviderSeries().find(x=>x.provider===name);
  if(!s) return;
  _provDetailCurrent = s;
  _provDetailMetric = 'skus';
  document.getElementById('provDetailTitle').innerHTML = s.provider + (isArchived(s.provider) ? ' <span class="pill" style="background:var(--s3);color:var(--muted2);font-size:10px;padding:2px 7px;vertical-align:middle">ARCHIVED</span>' : '');
  document.getElementById('provDetailBody').innerHTML = provDetailHtml(s);
  document.getElementById('providerDetailModal').classList.add('open');
  provDrawDetailChart(s);
}
let _provDetailCurrent = null;

function provDetailHtml(s){
  const diffColor=s.diff==null?NEUT:s.diff>0?GOOD:s.diff<0?BAD:NEUT;
  const diffGlyph=s.diff==null?'·':s.diff>0?'▲':s.diff<0?'▼':'→';
  const diffStr=s.diff==null?'—':(s.diff>0?'+':'')+s.diff;
  const pctStr=s.pct==null?'':` (${s.pct>0?'+':''}${s.pct.toFixed(1)}%)`;

  const valDiffColor=s.valueDiff==null?NEUT:s.valueDiff>0?GOOD:s.valueDiff<0?BAD:NEUT;
  const valDiffGlyph=s.valueDiff==null?'·':s.valueDiff>0?'▲':s.valueDiff<0?'▼':'→';
  const valDiffStr=s.valueDiff==null?'—':(s.valueDiff>0?'+£':'£')+Math.abs(s.valueDiff).toLocaleString(undefined,{maximumFractionDigits:0});
  const moneyFmt=v=>'£'+(v||0).toLocaleString(undefined,{maximumFractionDigits:0});

  const card=(label,sub,val,col,glyph,deltaStr,deltaCol)=>`
    <div style="background:var(--s1);border:1px solid var(--border);border-top:3px solid ${col};border-radius:12px;padding:16px 18px">
      <div style="font-family:var(--mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:${col}">${label}</div>
      <div style="font-family:var(--mono);font-size:10px;color:var(--muted2);margin-bottom:10px">${sub}</div>
      <div style="font-family:var(--mono);font-size:30px;font-weight:700;color:var(--text);line-height:1">${val}</div>
      <div style="font-family:var(--mono);font-size:11px;margin-top:8px;color:${deltaCol}">${glyph} ${deltaStr}</div>
    </div>`;

  const statCards = `<div style="display:grid;grid-template-columns:${s.hasValuation?'1fr 1fr':'1fr'};gap:16px;margin-bottom:16px">
    ${card('SKUs', s.points.length+' snapshot'+(s.points.length!==1?'s':''), s.current.toLocaleString(), GOOD, diffGlyph, diffStr+pctStr+' vs last', diffColor)}
    ${s.hasValuation ? card('Total Valuation', 'stock value, this provider', moneyFmt(s.currentValue), '#3d9eff', valDiffGlyph, valDiffStr+' vs last', valDiffColor) : ''}
  </div>`;

  // The two small charts repeated the big one below. In their place: how old this provider's stock is,
  // from Sarah's latest ageing file — the thing you open a provider to act on.
  const miniCards = (() => {
    if (typeof shProvGroups !== 'function' || typeof SNAP_SKUS === 'undefined') return '';
    const latest = shAllSnaps().filter(x => SNAP_SKUS[x.date]).slice(-1)[0]; if (!latest) return '';
    const o = shProvGroups(SNAP_SKUS[latest.date], impBuildLookup(), shUpcoming(latest.date).age).get(s.provider);
    if (!o || !o.n) return '';
    const u90 = o.val ? (o.val - o.val90) / o.val * 100 : 0, col = u90 >= SH_GOAL ? 'var(--g)' : u90 >= SH_FLOOR ? 'var(--y)' : 'var(--r)';
    const tile = (k, v, sub, c) => `<div style="background:var(--s2);border:1px solid var(--border);border-radius:10px;padding:12px 14px"><div style="font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted2);font-weight:600">${k}</div><div style="font-size:20px;font-weight:700;margin-top:4px;color:${c||'var(--text)'}">${v}</div><div style="font-size:11.5px;color:var(--muted2);margin-top:2px">${sub}</div></div>`;
    return `<div style="display:flex;align-items:baseline;justify-content:space-between;margin:0 0 8px"><div style="font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);font-weight:600">Age of this stock · Sarah's ${fmt(latest.date)} file</div>
      ${o.p90 ? `<button class="cmp-chip" onclick="closeOverlay('providerDetailModal');shGoToProvider('${s.provider.replace(/'/g,"\\'")}')">See its ${o.p90} SKUs past 90 days ›</button>` : ''}</div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px">
      ${tile('Under 90 days', u90.toFixed(0) + '%', `of its ${fmtGBP(o.val)} by £`, col)}
      ${tile('Past 90 days', fmtGBP(o.val90), `${o.p90} SKU${o.p90 !== 1 ? 's' : ''}`, o.val90 ? 'var(--y)' : '')}
      ${tile('Past 180 days', fmtGBP(o.val180), `${o.p180} SKU${o.p180 !== 1 ? 's' : ''}`, o.val180 ? 'var(--o)' : '')}
      ${tile('Average age', o.avgAge != null ? Math.round(o.avgAge) + ' days' : '—', o.oldest != null ? `oldest ${Math.round(o.oldest)} days` : '', o.avgAge == null ? '' : o.avgAge <= 90 ? 'var(--g)' : o.avgAge <= 180 ? 'var(--y)' : 'var(--o)')}
    </div>`;
  })();

  const peakLowRow = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:16px">
    <div style="background:var(--s2);border:1px solid var(--border);border-radius:10px;padding:12px 14px"><div style="font-family:var(--mono);font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted2);margin-bottom:6px">Peak SKUs</div><div style="font-size:17px;font-weight:700">${s.peak.toLocaleString()}</div></div>
    <div style="background:var(--s2);border:1px solid var(--border);border-radius:10px;padding:12px 14px"><div style="font-family:var(--mono);font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted2);margin-bottom:6px">Low SKUs</div><div style="font-size:17px;font-weight:700">${s.low.toLocaleString()}</div></div>
    ${s.hasValuation?`<div style="background:var(--s2);border:1px solid var(--border);border-radius:10px;padding:12px 14px"><div style="font-family:var(--mono);font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted2);margin-bottom:6px">Peak Valuation</div><div style="font-size:17px;font-weight:700">${moneyFmt(s.peakValue)}</div></div>`:''}
    <div style="background:var(--s2);border:1px solid var(--border);border-radius:10px;padding:12px 14px"><div style="font-family:var(--mono);font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted2);margin-bottom:6px">First Seen</div><div style="font-size:17px;font-weight:700">${fmtShort(s.firstDate)}</div></div>
  </div>`;

  const metricToggle = s.hasValuation ? `<div style="display:inline-flex;border:1px solid var(--border);border-radius:8px;overflow:hidden">
      <button onclick="provSetDetailMetric('skus')" id="provDetBtnSkus" style="font-family:var(--mono);font-size:10px;padding:6px 12px;background:${_provDetailMetric==='skus'?'var(--g)':'none'};color:${_provDetailMetric==='skus'?'var(--bg)':'var(--muted2)'};border:none;cursor:pointer;font-weight:700">SKUs</button>
      <button onclick="provSetDetailMetric('value')" id="provDetBtnValue" style="font-family:var(--mono);font-size:10px;padding:6px 12px;background:${_provDetailMetric==='value'?'#3d9eff':'none'};color:${_provDetailMetric==='value'?'#07090c':'var(--muted2)'};border:none;cursor:pointer;font-weight:700">Valuation</button>
    </div>` : '';

  let body = statCards + miniCards + peakLowRow + `
  <div class="card" style="padding:14px;margin-bottom:18px">
    <div class="card-hd" style="margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
      <div class="card-title" id="provDetailChartTitle">${_provDetailMetric==='value'?'Valuation':'SKU'} Over Time</div>
      ${metricToggle}
    </div>
    <div class="chart-wrap" style="height:220px;position:relative"><canvas id="provDetailChart"></canvas></div>
  </div>
  <div style="font-family:var(--mono);font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);margin-bottom:8px">Historical Snapshots</div>
  <div class="history-table-wrap"><table class="history-table">
    <thead><tr><th>Date</th><th>SKUs</th><th>Δ vs Prev</th>${s.hasValuation?'<th>Valuation</th>':''}<th>Notes</th><th>Action</th></tr></thead><tbody>`;

  const pts=s.points.slice().reverse();
  body+=pts.map((p,ri)=>{
    const realIdx=s.points.length-1-ri;
    const prevPt=realIdx>0?s.points[realIdx-1]:null;
    const d=prevPt?p.skus-prevPt.skus:null;
    const dColor=d==null?'var(--muted2)':d>0?'var(--g)':d<0?'var(--r)':'var(--muted2)';
    const dStr=d==null?'—':(d>0?'+':'')+d;
    return `<tr>
      <td style="color:var(--g)">${fmt(p.date)}</td>
      <td style="font-weight:700">${p.skus.toLocaleString()}</td>
      <td style="color:${dColor}">${dStr}</td>
      ${s.hasValuation?`<td style="color:var(--muted2)">${p.value?moneyFmt(p.value):'—'}</td>`:''}
      <td style="color:var(--muted2)">${p.notes?escapeHtmlImp(p.notes):'—'}</td>
      <td><button class="tbl-btn del" onclick="deleteProviderReading('${p.date}','${s.provider.replace(/'/g,"\\'")}')">Delete</button></td>
    </tr>`;
  }).join('');
  body+=`</tbody></table></div>
  <div style="display:flex;justify-content:space-between;align-items:center;margin-top:16px;gap:10px;flex-wrap:wrap">
    ${isArchived(s.provider)
      ? `<button class="btn-g" onclick="unarchiveProvider('${s.provider.replace(/'/g,"\\'")}')" style="font-size:11px">↩ Restore to Active</button>`
      : `<button class="btn" onclick="archiveProvider('${s.provider.replace(/'/g,"\\'")}')">📦 Archive (keep data)</button>`}
    <button class="btn" onclick="deleteProviderAll('${s.provider.replace(/'/g,"\\'")}')" style="border-color:var(--r);color:var(--r)">Delete All Snapshots</button>
  </div>`;
  return body;
}

function provSetDetailMetric(metric){
  _provDetailMetric = metric;
  if (!_provDetailCurrent) return;
  document.getElementById('provDetailChartTitle').textContent = (metric==='value'?'Valuation':'SKU')+' Over Time';
  const sB=document.getElementById('provDetBtnSkus'), vB=document.getElementById('provDetBtnValue');
  if (sB){ sB.style.background = metric==='skus'?'var(--g)':'none'; sB.style.color = metric==='skus'?'var(--bg)':'var(--muted2)'; }
  if (vB){ vB.style.background = metric==='value'?'#3d9eff':'none'; vB.style.color = metric==='value'?'#07090c':'var(--muted2)'; }
  provDrawDetailChart(_provDetailCurrent);
}

function provDrawDetailChart(s){
  destroyChart('provDetail');
  const dc=document.getElementById('provDetailChart');
  if(!dc) return;
  const isValue = _provDetailMetric==='value';
  const col = isValue ? '#3d9eff' : '#00f5a0';
  const data = s.points.map(p=>isValue?(p.value||0):p.skus);
  const labels = s.points.map(p=>fmtShort(p.date));
  const dates  = s.points.map(p=>p.date);
  const peak = Math.max(...data), low = Math.min(...data);
  const peakIdx = data.indexOf(peak), lowIdx = data.indexOf(low);

  // Tight zoom so real movement is visible (not crushed by a 0-based axis)
  const spread = peak - low;
  const pad = isValue ? Math.max(spread*0.25, peak*0.03, 100) : Math.max(spread*0.25, 2);
  const _nice = niceAxis(Math.max(0, low - pad), peak + pad);   // whole steps — it showed 253.25 / 77.75
  const ymin = _nice.min;
  const ymax = _nice.max;

  // Gradient fill under the line
  const ctx = dc.getContext('2d');
  const grad = ctx.createLinearGradient(0,0,0,240);
  grad.addColorStop(0, col+'40');
  grad.addColorStop(1, col+'03');

  const moneyFmt=v=>'£'+(v||0).toLocaleString(undefined,{maximumFractionDigits:0});

  chartInstances['provDetail']=new Chart(ctx,{
    type:'line',
    data:{ labels, datasets:[{
      label:isValue?'Valuation':'SKUs',
      data,
      borderColor:col,
      backgroundColor:grad,
      fill:true,
      tension:.35,
      borderWidth:2.5,
      pointRadius: data.map((_,i)=> i===peakIdx||i===lowIdx ? 5 : 3),
      pointHoverRadius:7,
      pointBackgroundColor: data.map((_,i)=> i===peakIdx?(isValue?'#3d9eff':GOOD) : i===lowIdx?BAD : col),
      pointBorderColor:'#07090c',
      pointBorderWidth:1.5,
    }]},
    options:{
      responsive:true, maintainAspectRatio:false,
      interaction:{mode:'index',intersect:false},
      plugins:{
        legend:{display:false},
        datalabels:{display:false},
        tooltip:{
          backgroundColor:'rgba(7,9,12,.98)', titleColor:'#dce6f0', bodyColor:'#dce6f0',
          borderColor:col, borderWidth:1, padding:10, displayColors:false, cornerRadius:8,
          titleFont:{size:12,weight:'700'}, bodyFont:{size:12},
          callbacks:{
            title:items=>fmt(dates[items[0].dataIndex]),
            label:ctx=>{
              const v=ctx.parsed.y;
              const base = isValue ? moneyFmt(v) : v.toLocaleString()+' SKUs';
              const tag = v===peak?'  ▲ peak' : v===low?'  ▼ low' : '';
              return base+tag;
            },
            afterLabel:ctx=>{
              const i=ctx.dataIndex;
              if(i===0) return 'First reading';
              const d=data[i]-data[i-1];
              if(d===0) return 'No change vs previous';
              const arrow=d>0?'▲':'▼';
              return `${arrow} ${d>0?'+':''}${isValue?moneyFmt(d):d} vs previous`;
            }
          }
        }
      },
      scales:{
        y:{ min:ymin, max:ymax, grid:{color:'rgba(255,255,255,.05)'},
            ticks:{color:'#a7b4c4',font:{size:11},maxTicksLimit:6,
              callback:v=>isValue?fmtGBP(v):v} },
        x:{ grid:{display:false}, ticks:{color:'#a7b4c4',font:{size:11},maxRotation:0,autoSkip:true,maxTicksLimit:8} }
      }
    }
  });
}

function provDrawDetailMiniCharts(s){
  if (!s.hasValuation) return;
  const labels=s.points.map(p=>fmtShort(p.date));
  const dates=s.points.map(p=>p.date);
  const series=[
    {id:'provMiniSkus', data:s.points.map(p=>p.skus), col:GOOD, unit:' SKUs'},
    {id:'provMiniValue', data:s.points.map(p=>p.value||0), col:'#3d9eff', unit:'', prefix:'£'}
  ];
  series.forEach(cfg=>{
    const cv=document.getElementById(cfg.id);
    if(!cv||typeof Chart==='undefined') return;
    destroyChart(cfg.id);
    const peak=Math.max(...cfg.data), low=Math.min(...cfg.data);
    const peakIdx=cfg.data.indexOf(peak), lowIdx=cfg.data.indexOf(low);
    const spread=peak-low;
    const pad=Math.max(spread*0.25, cfg.prefix?peak*0.03:2, cfg.prefix?100:1);
    const lo=Math.max(0,low-pad), hi=peak+pad;
    const ctx=cv.getContext('2d');
    const grad=ctx.createLinearGradient(0,0,0,140);
    grad.addColorStop(0,cfg.col+'38'); grad.addColorStop(1,cfg.col+'02');
    chartInstances[cfg.id]=new Chart(ctx,{
      type:'line',
      data:{ labels, datasets:[{ data:cfg.data, borderColor:cfg.col, backgroundColor:grad, borderWidth:2, tension:.35, fill:true,
        pointRadius:cfg.data.map((_,i)=>i===peakIdx||i===lowIdx?4:2), pointHoverRadius:5,
        pointBackgroundColor:cfg.data.map((_,i)=>i===peakIdx?cfg.col:i===lowIdx?BAD:cfg.col),
        pointBorderColor:'#07090c', pointBorderWidth:1.5 }] },
      options:{ responsive:true, maintainAspectRatio:false, interaction:{mode:'index',intersect:false},
        plugins:{ legend:{display:false}, datalabels:{display:false},
          tooltip:{ backgroundColor:'rgba(7,9,12,.98)', titleColor:'#dce6f0', bodyColor:'#dce6f0', borderColor:cfg.col, borderWidth:1, padding:8, displayColors:false, cornerRadius:6,
            callbacks:{ title:items=>fmt(dates[items[0].dataIndex]), label:item=>`${cfg.prefix||''}${item.parsed.y.toLocaleString()}${cfg.unit||''}` } } },
        scales:{ y:{ min:lo, max:hi, display:true, grid:{color:'rgba(255,255,255,.04)'}, ticks:{color:'#a7b4c4',font:{size:10},maxTicksLimit:4, callback:v=>cfg.prefix?fmtGBP(v):v} },
          x:{ display:false } } }
    });
  });
}

async function deleteProviderReading(date, provider){
  if(!confirm(`Delete ${provider}'s snapshot for ${fmt(date)}?`)) return;
  const prevProviderSnaps = PROVIDER_SNAPSHOTS.slice();
  PROVIDER_SNAPSHOTS=PROVIDER_SNAPSHOTS.filter(p=>!(p.date===date && p.provider===provider));
  showSyncStatus('loading');
  const ok = await window._supabaseDeleteProvider(date, provider);
  if(!ok){
    PROVIDER_SNAPSHOTS = prevProviderSnaps;
    renderProviderTab(); renderHistory();
    showSyncStatus('error');
    alert(`⚠ Could not delete ${provider}'s snapshot for ${fmt(date)}.\n\nIt is still in the database — nothing was removed. Check your internet connection and try again.`);
    return;
  }
  showSyncStatus('saved');
  renderProviderTab(); renderHistory();
  if(PROVIDER_SNAPSHOTS.find(p=>p.provider===provider)) openProviderDetail(provider);
  else closeOverlay('providerDetailModal');
  setTimeout(()=>showSyncStatus(''),1500);
}
async function deleteProviderAll(provider){
  if(!confirm(`Permanently DELETE all snapshots for "${provider}"?\n\nThis erases the data and cannot be undone. (To just stop tracking it while keeping the data, use Archive instead.)`)) return;
  const prevProviderSnaps=PROVIDER_SNAPSHOTS.slice(), prevDefs=PROVIDER_DEFS.slice(), prevArchived=ARCHIVED_PROVIDERS.slice();
  PROVIDER_SNAPSHOTS=PROVIDER_SNAPSHOTS.filter(p=>p.provider!==provider);
  const wasInList=PROVIDER_DEFS.some(n=>n.toLowerCase()===provider.toLowerCase())||ARCHIVED_PROVIDERS.some(n=>n.toLowerCase()===provider.toLowerCase());
  PROVIDER_DEFS=PROVIDER_DEFS.filter(n=>n.toLowerCase()!==provider.toLowerCase());
  ARCHIVED_PROVIDERS=ARCHIVED_PROVIDERS.filter(n=>n.toLowerCase()!==provider.toLowerCase());
  showSyncStatus('loading');
  const ok = await window._supabaseDeleteProviderAll(provider);
  if(!ok){
    PROVIDER_SNAPSHOTS=prevProviderSnaps; PROVIDER_DEFS=prevDefs; ARCHIVED_PROVIDERS=prevArchived;
    renderProviderTab(); renderHistory(); renderSettingsTab(); renderBadges();
    showSyncStatus('error');
    alert(`⚠ Could not delete "${provider}".\n\nIts data is still in the database — nothing was removed. Check your internet connection and try again.`);
    return;
  }
  // allowEmpty: removing the last provider legitimately leaves both lists empty.
  if(wasInList) await window._supabaseSaveProviderDefs(PROVIDER_DEFS, ARCHIVED_PROVIDERS, true);
  showSyncStatus('saved');
  closeOverlay('providerDetailModal');
  renderProviderTab(); renderHistory(); renderSettingsTab(); renderBadges();
  setTimeout(()=>showSyncStatus(''),1500);
}

// ── History tab: view toggle (Inventory / Providers) ──
let histView='inventory';
function setHistView(v){
  histView=v;
  const inv=document.getElementById('histViewInv'), prov=document.getElementById('histViewProv');
  if(inv) inv.classList.toggle('active', v==='inventory');
  if(prov) prov.classList.toggle('active', v==='providers');
  const iw=document.getElementById('histInvWrap'), pw=document.getElementById('histProvWrap');
  if(iw) iw.style.display = v==='inventory'?'':'none';
  if(pw) pw.style.display = v==='providers'?'':'none';
  renderHistory();
}
function renderProviderHistoryTable(search, hFrom, hTo){
  const tbody=document.getElementById('histProvBody'); if(!tbody) return 0;
  // chronological per-provider delta
  const byProv={};
  PROVIDER_SNAPSHOTS.slice().sort((a,b)=>a.date.localeCompare(b.date)).forEach(p=>{
    (byProv[p.provider]=byProv[p.provider]||[]).push(p);
  });
  let rows=[];
  Object.values(byProv).forEach(arr=>{
    arr.forEach((p,i)=>{ rows.push({ ...p, delta:i>0?p.skus-arr[i-1].skus:null }); });
  });
  if(search) rows=rows.filter(r=>r.provider.toLowerCase().includes(search)||(r.notes||'').toLowerCase().includes(search));
  if(hFrom) rows=rows.filter(r=>r.date>=hFrom);
  if(hTo) rows=rows.filter(r=>r.date<=hTo);
  rows.sort((a,b)=>b.date.localeCompare(a.date)||a.provider.localeCompare(b.provider));

  const hasVal = rows.some(r=>(r.value||0)>0);
  const thead=document.querySelector('#histProvWrap thead tr');
  if (thead) thead.innerHTML = `<th>Date</th><th>Provider</th><th>SKUs</th><th>Δ vs Prev</th>${hasVal?'<th>Valuation</th>':''}<th>Notes</th><th>Actions</th>`;

  if(!rows.length){ tbody.innerHTML=`<tr class="empty-row"><td colspan="${hasVal?7:6}" style="text-align:center;padding:24px;color:var(--muted)">No provider snapshots match your filters.</td></tr>`; return 0; }
  tbody.innerHTML=rows.map(r=>{
    const dColor=r.delta==null?'var(--muted2)':r.delta>0?'var(--g)':r.delta<0?'var(--r)':'var(--muted2)';
    const dStr=r.delta==null?'—':(r.delta>0?'+':'')+r.delta;
    return `<tr>
      <td style="color:var(--g)">${fmt(r.date)}</td>
      <td style="color:var(--text);cursor:pointer" onclick="openProviderDetail('${r.provider.replace(/'/g,"\\'")}')"><strong>${r.provider}</strong>${isArchived(r.provider)?' <span class="pill" style="background:var(--s3);color:var(--muted2);font-size:10px;padding:1px 5px">ARCHIVED</span>':''}</td>
      <td style="font-weight:700">${(r.skus||0).toLocaleString()}</td>
      <td style="color:${dColor}">${dStr}</td>
      ${hasVal?`<td style="color:var(--muted2)">${r.value?fmtGBP(incVat(r.value)):'—'}</td>`:''}
      <td style="color:var(--muted2)">${r.notes||'—'}</td>
      <td><button class="tbl-btn del" onclick="deleteProviderReading('${r.date}','${r.provider.replace(/'/g,"\\'")}')">Delete</button></td>
    </tr>`;
  }).join('');
  return rows.length;
}

// ── Settings: provider order management ──
let provDefRowCount = 0;
function renderSettingsTab(){
  if(typeof shSyncSettingsInputs==='function') shSyncSettingsInputs();
  provDefRowCount = 0;
  const wrap = document.getElementById('provDefRows');
  if(!wrap) return;
  wrap.innerHTML='';
  const tag=document.getElementById('settingsProvTag');
  if(tag) tag.textContent = `${PROVIDER_DEFS.length} provider${PROVIDER_DEFS.length!==1?'s':''}`;
  if(PROVIDER_DEFS.length) PROVIDER_DEFS.forEach(n=>addProvDefRow(n));
  else addProvDefRow();
  renderProviderRules();

  // Archived section
  const aWrap=document.getElementById('archivedProvRows');
  const aTag=document.getElementById('settingsArchTag');
  if(aTag) aTag.textContent=`${ARCHIVED_PROVIDERS.length} archived`;
  if(aWrap){
    if(!ARCHIVED_PROVIDERS.length){
      aWrap.innerHTML='<div style="color:var(--muted);font-family:var(--mono);font-size:11px;padding:8px 2px">No archived providers. Archive one from its detail popup to stop tracking it while keeping the data.</div>';
    } else {
      aWrap.innerHTML=ARCHIVED_PROVIDERS.map(name=>{
        const snaps=PROVIDER_SNAPSHOTS.filter(p=>p.provider.toLowerCase()===name.toLowerCase()).length;
        const esc=name.replace(/'/g,"\\'");
        return `<div style="display:grid;grid-template-columns:1fr auto auto;gap:8px;align-items:center;padding:9px 11px;background:var(--s2);border:1px solid var(--border);border-radius:2px">
          <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><strong>${name}</strong> <span style="color:var(--muted2);font-family:var(--mono);font-size:10px">· ${snaps} snapshot${snaps!==1?'s':''}</span></div>
          <button class="btn" onclick="openProviderDetail('${esc}')" style="font-size:10px;padding:6px 12px">View</button>
          <button class="btn-g" onclick="unarchiveProvider('${esc}')" style="font-size:10px;padding:6px 12px">Restore</button>
        </div>`;
      }).join('');
    }
  }
}
function addProvDefRow(name=''){
  provDefRowCount++;
  const wrap=document.getElementById('provDefRows');
  if(!wrap) return;
  const id=provDefRowCount;
  const safe=String(name).replace(/"/g,'&quot;');
  const row=document.createElement('div');
  row.id='pdr_'+id;
  row.className='provdef-row';
  row.draggable=true;
  row.style.cssText='display:grid;grid-template-columns:20px 1fr 32px;gap:8px;align-items:center;padding:6px;background:var(--s2);border:1px solid var(--border);border-radius:2px;cursor:grab;transition:opacity .2s,background .15s';
  row.innerHTML=`
    <div style="display:flex;align-items:center;justify-content:center;color:var(--muted2);font-size:14px;user-select:none">⋮</div>
    <input type="text" value="${safe}" placeholder="Provider name" style="width:100%;background:var(--s1);border:1px solid var(--border);color:var(--text);font-family:var(--mono);font-size:12px;padding:9px 11px;outline:none" onfocus="this.style.borderColor='var(--g)'" onblur="this.style.borderColor='var(--border)'">
    <button class="comp-rm" onclick="document.getElementById('pdr_${id}').remove()" style="margin-bottom:0">×</button>`;
  // what each provider holds right now, so a dead name is easy to spot and archive
  const cur = name ? (typeof buildProviderSeries === 'function' ? buildProviderSeries().find(x => x.provider.toLowerCase() === String(name).toLowerCase()) : null) : null;
  if (cur) { const chip = document.createElement('span'); chip.className = 'pdr-chip' + (cur.current > 0 ? '' : ' none');
    chip.textContent = cur.current > 0 ? `${fmtGBP(cur.currentValue || 0)} · ${cur.current} SKUs` : 'no stock now'; row.insertBefore(chip, row.lastElementChild); row.style.gridTemplateColumns = '20px 1fr auto 32px'; }
  else if (name) { const chip = document.createElement('span'); chip.className = 'pdr-chip none'; chip.textContent = 'never imported'; row.insertBefore(chip, row.lastElementChild); row.style.gridTemplateColumns = '20px 1fr auto 32px'; }
  wrap.appendChild(row);
  row.addEventListener('dragstart',()=>{ draggedRow=row; row.style.opacity='0.5'; row.style.background='var(--s3)'; });
  row.addEventListener('dragover',e=>{ e.preventDefault(); if(draggedRow&&draggedRow!==row) row.style.borderTop='2px solid var(--g)'; });
  row.addEventListener('dragleave',()=>{ row.style.borderTop=''; });
  row.addEventListener('drop',e=>{ e.preventDefault(); if(draggedRow&&draggedRow!==row) wrap.insertBefore(draggedRow,row); });
  row.addEventListener('dragend',()=>{ document.querySelectorAll('.provdef-row').forEach(r=>{r.style.borderTop='';r.style.opacity='1';r.style.background='';}); draggedRow=null; });
}

// ── SKU matching rules editor (aliases/stems/title keywords per provider) ──
// PROVIDER_RULES is the live in-memory list; each change saves the single changed
// rule to bdl_provider_rules immediately via window._supabaseSaveProviderRule.
function getOrCreateRule(name){
  let r = PROVIDER_RULES.find(x => x.name.toLowerCase() === name.toLowerCase());
  if (!r) { r = { name, aliases: [], stems: [], titleKeywords: [] }; PROVIDER_RULES.push(r); }
  return r;
}
async function saveOneRule(rule){
  showSyncStatus('loading');
  try {
    const ok = await window._supabaseSaveProviderRule(rule);
    showSyncStatus(ok ? 'saved' : 'error');
    if (!ok) {
      // put the screen back to what is actually saved, rather than leave the unsaved change showing
      try { const data = await window._supabaseLoad(); if (data && data.providerRules) PROVIDER_RULES = data.providerRules; } catch(e) {}
      if (typeof renderProviderRules === 'function') renderProviderRules();
      alert('⚠ That matching rule did not save — it has been put back.\n\nCheck your internet connection and try again.');
    }
    setTimeout(()=>showSyncStatus(''),1200);
    return ok;
  }
  catch(e){ console.error('rule save failed', e); showSyncStatus('error'); setTimeout(()=>showSyncStatus(''),1200); return false; }
}
function renderProviderRules(){
  const wrap=document.getElementById('provRuleRows');
  if(!wrap) return;
  const tag=document.getElementById('settingsRulesTag');
  // Show a block for every active provider, even ones with no rules saved yet.
  const names=PROVIDER_DEFS.slice();
  if(tag) tag.textContent = `${names.length} provider${names.length!==1?'s':''}`;
  if(!names.length){
    wrap.innerHTML='<div style="color:var(--muted);font-family:var(--mono);font-size:11px;padding:8px 2px">Add a provider above first, then come back here to give it aliases/stems.</div>';
    return;
  }
  const countsBySnap={}; PROVIDER_SNAPSHOTS.forEach(p=>{ countsBySnap[p.provider.toLowerCase()]=(countsBySnap[p.provider.toLowerCase()]||0); });
  const emptyNames=[];
  wrap.innerHTML = names.map(name=>{
    const r = PROVIDER_RULES.find(x=>x.name.toLowerCase()===name.toLowerCase()) || {aliases:[],stems:[],titleKeywords:[]};
    const isEmpty = (!r.aliases||!r.aliases.length) && (!r.stems||!r.stems.length) && (!r.titleKeywords||!r.titleKeywords.length);
    if (isEmpty) emptyNames.push(name);
    const esc = name.replace(/'/g,"\\'");
    const chip = (val, idx, cls, removeFn) => `<span class="prule-chip ${cls}">${escapeHtmlImp(val)}<button onclick="${removeFn}('${esc}',${idx})">✕</button></span>`;
    return `<div class="prule-block">
      <div class="prule-row1">
        <span class="prule-name">${escapeHtmlImp(name)}</span>
        ${isEmpty ? '<span class="prule-empty-badge" title="No aliases, stems, or title keywords — this provider will only match on its exact name and will not auto-resolve real SKU tokens">No match rules yet</span>' : ''}
      </div>
      <div class="prule-grp">
        <span class="prule-lbl">aliases — exact segment match</span>
        <div class="prule-chips">
          ${(r.aliases||[]).map((a,i)=>chip(a,i,'','removeRuleAlias')).join('')}
          <span class="prule-add"><input placeholder="+ alias" onkeydown="if(event.key==='Enter')addRuleAlias('${esc}',this)"></span>
        </div>
      </div>
      <div class="prule-grp">
        <span class="prule-lbl">stems — segment starts-with</span>
        <div class="prule-chips">
          ${(r.stems||[]).map((s,i)=>chip(s,i,'stem','removeRuleStem')).join('')}
          <span class="prule-add"><input placeholder="+ stem" onkeydown="if(event.key==='Enter')addRuleStem('${esc}',this)"></span>
        </div>
      </div>
      <div class="prule-grp">
        <span class="prule-lbl">title contains — fallback only</span>
        <div class="prule-chips">
          ${(r.titleKeywords||[]).map((k,i)=>chip(k,i,'title','removeRuleTitle')).join('')}
          <span class="prule-add"><input placeholder="+ keyword" onkeydown="if(event.key==='Enter')addRuleTitle('${esc}',this)"></span>
        </div>
      </div>
    </div>`;
  }).join('');

  const banner=document.getElementById('settingsRulesWarning');
  if (banner){
    if (emptyNames.length){
      const fixableNames = emptyNames.filter(n => DEFAULT_PROVIDERS.some(p=>p.name.toLowerCase()===n.toLowerCase() && ((p.aliases||[]).length || (p.stems||[]).length || (p.titleKeywords||[]).length)));
      banner.style.display='';
      banner.innerHTML = `⚠ ${emptyNames.length} provider${emptyNames.length!==1?'s have':' has'} no match rules — ${escapeHtmlImp(emptyNames.join(', '))}. ${
        fixableNames.length ? `They'll only match their exact name and won't catch real SKU tokens. <button type="button" class="btn sm" onclick="fixEmptyProviderRules()" style="font-size:10px;padding:5px 11px;margin-left:6px">Fix from defaults</button>` : 'Add aliases/stems below.'
      }`;
    } else {
      banner.style.display='none';
      banner.innerHTML='';
    }
  }
}
async function fixEmptyProviderRules(){
  let fixed=0;
  for (const name of PROVIDER_DEFS){
    const def=DEFAULT_PROVIDERS.find(p=>p.name.toLowerCase()===name.toLowerCase());
    if (!def || !((def.aliases||[]).length || (def.stems||[]).length || (def.titleKeywords||[]).length)) continue;
    const r=getOrCreateRule(name);
    const isEmpty=(!r.aliases||!r.aliases.length)&&(!r.stems||!r.stems.length)&&(!r.titleKeywords||!r.titleKeywords.length);
    if (!isEmpty) continue;
    r.aliases=[...(def.aliases||[])]; r.stems=[...(def.stems||[])]; r.titleKeywords=[...(def.titleKeywords||[])];
    if (await saveOneRule(r)) fixed++;
  }
  renderProviderRules();
  showToast(fixed ? `✓ Restored match rules for ${fixed} provider${fixed!==1?'s':''}` : 'Nothing to fix');
}
async function addProviderRule(){
  const inp=document.getElementById('newRuleProvName');
  const v=(inp.value||'').trim();
  if(!v) return;
  if(PROVIDER_DEFS.some(n=>n.toLowerCase()===v.toLowerCase())){ showToast('That provider already exists'); return; }
  // Save the list with the new name straight in (the old path re-read the order rows on screen,
  // which didn't include it — so it was dropped while the toast still said saved).
  const before = PROVIDER_DEFS.slice();
  PROVIDER_DEFS.push(v);
  const r = getOrCreateRule(v);
  inp.value='';
  showSyncStatus('loading');
  const ok = await window._supabaseSaveProviderDefs(PROVIDER_DEFS, ARCHIVED_PROVIDERS);
  if(!ok){ PROVIDER_DEFS = before; showSyncStatus('error'); renderSettingsTab(); alert(`⚠ "${v}" did not save — nothing was added.\n\nCheck your internet connection and try again.`); return; }
  await saveOneRule(r);
  renderSettingsTab(); renderProviderTab(); renderBadges();
  showToast(`✓ Added ${v}`);
}
async function loadDefaultProviders(){
  const known=new Set([...PROVIDER_DEFS, ...ARCHIVED_PROVIDERS].map(n=>n.toLowerCase()));
  const missing=DEFAULT_PROVIDERS.filter(p=>!known.has(p.name.toLowerCase()));
  if(!missing.length){ showToast(`All ${DEFAULT_PROVIDERS.length} default providers are already set up`); return; }
  const beforeDefs = PROVIDER_DEFS.slice(), beforeRules = PROVIDER_RULES.slice();
  missing.forEach(p=>{
    PROVIDER_DEFS.push(p.name);
    PROVIDER_RULES.push({ name:p.name, aliases:[...(p.aliases||[])], stems:[...(p.stems||[])], titleKeywords:[...(p.titleKeywords||[])] });
  });
  showSyncStatus('loading');
  // check every save — this used to say "✓ Added" even when Supabase refused
  const defsOk = await window._supabaseSaveProviderDefs(PROVIDER_DEFS, ARCHIVED_PROVIDERS);
  if(!defsOk){ PROVIDER_DEFS = beforeDefs; PROVIDER_RULES = beforeRules; showSyncStatus('error'); renderSettingsTab(); alert('⚠ The default providers did not save — nothing was added.\n\nCheck your internet connection and try again.'); return; }
  let failed = 0;
  for(const p of missing){ try{ const ok = await window._supabaseSaveProviderRule(PROVIDER_RULES.find(r=>r.name===p.name)); if(!ok) failed++; }catch(e){ console.error(e); failed++; } }
  showSyncStatus(failed ? 'error' : 'saved');
  renderSettingsTab(); renderProviderTab(); renderBadges();
  if (failed) alert(`⚠ ${failed} of the ${missing.length} match rules did not save. The providers were added; reopen Settings and try "Fix from defaults".`);
  else showToast(`✓ Added ${missing.length} default provider${missing.length!==1?'s':''}`);
  setTimeout(()=>showSyncStatus(''),1500);
}
async function addRuleAlias(name, inputEl){
  const v=(inputEl.value||'').trim(); if(!v) return;
  const r=getOrCreateRule(name);
  if(!r.aliases.map(a=>a.toLowerCase()).includes(v.toLowerCase())) r.aliases.push(v);
  inputEl.value='';
  await saveOneRule(r);
  renderProviderRules();
}
async function removeRuleAlias(name, idx){
  const r=getOrCreateRule(name);
  r.aliases.splice(idx,1);
  await saveOneRule(r);
  renderProviderRules();
}
async function addRuleStem(name, inputEl){
  const v=(inputEl.value||'').trim(); if(!v) return;
  const r=getOrCreateRule(name);
  if(!r.stems.map(s=>s.toLowerCase()).includes(v.toLowerCase())) r.stems.push(v);
  inputEl.value='';
  await saveOneRule(r);
  renderProviderRules();
}
async function removeRuleStem(name, idx){
  const r=getOrCreateRule(name);
  r.stems.splice(idx,1);
  await saveOneRule(r);
  renderProviderRules();
}
async function addRuleTitle(name, inputEl){
  const v=(inputEl.value||'').trim(); if(!v) return;
  const r=getOrCreateRule(name);
  if(!r.titleKeywords.map(k=>k.toLowerCase()).includes(v.toLowerCase())) r.titleKeywords.push(v);
  inputEl.value='';
  await saveOneRule(r);
  renderProviderRules();
}
async function removeRuleTitle(name, idx){
  const r=getOrCreateRule(name);
  r.titleKeywords.splice(idx,1);
  await saveOneRule(r);
  renderProviderRules();
}

async function deleteAllProviderData(){
  const n = PROVIDER_SNAPSHOTS.length;
  const typed = prompt(`This deletes ALL ${n.toLocaleString()} provider figures across every date (your provider names and rules stay). It can't be undone.\n\nType DELETE to confirm.`);
  if ((typed||'').trim() !== 'DELETE') { if (typed !== null) showToast('Nothing deleted — you have to type DELETE'); return; }
  try{
    showToast('Deleting provider data...');
    const ok = await window._supabaseNukeProviderSnapshots();
    if(!ok) throw new Error('Delete failed — check console');
    PROVIDER_SNAPSHOTS=[];
    showToast('✓ All provider figures deleted. Your provider names are still set up — add a new snapshot to start fresh.');
    renderProviderTab(); renderHistory(); renderSettingsTab(); renderBadges();
  }catch(e){ showToast('Error: '+e.message); console.error(e); }
}
async function saveProviderDefs(){
  const rows=document.querySelectorAll('#provDefRows .provdef-row');
  const seen=new Set(); const defs=[];
  rows.forEach(row=>{
    const name=(row.querySelector('input')?.value||'').trim();
    if(name && !seen.has(name.toLowerCase())){ seen.add(name.toLowerCase()); defs.push(name); }
  });
  const prevDefsOrder = PROVIDER_DEFS.slice();
  PROVIDER_DEFS=defs;
  showSyncStatus('loading');
  const defsOk = await window._supabaseSaveProviderDefs(PROVIDER_DEFS, ARCHIVED_PROVIDERS);
  if(!defsOk){
    PROVIDER_DEFS = prevDefsOrder;
    showSyncStatus('error');
    renderSettingsTab();
    alert('⚠ The provider list did not save.\n\nCheck your internet connection and try again.');
    return;
  }
  try{ const data=await window._supabaseLoad(); if(data){ PROVIDER_DEFS=data.providerDefs||PROVIDER_DEFS; ARCHIVED_PROVIDERS=data.providerArchived||ARCHIVED_PROVIDERS; } }catch(e){ console.error('reload defs failed',e); }
  showSyncStatus('saved');
  renderSettingsTab(); renderProviderTab(); renderBadges();
  if(typeof showToast==='function') showToast(`✓ Provider order saved — ${PROVIDER_DEFS.length} provider${PROVIDER_DEFS.length!==1?'s':''}`);
  setTimeout(()=>showSyncStatus(''),1500);
}

// ── Archive / restore (hide from active views but keep all data) ──
async function archiveProvider(name){
  if(!confirm(`Archive "${name}"?\n\nIt will be hidden from the Provider page, charts and snapshot form, but all its snapshots are kept. You can restore it any time from Settings.`)) return;
  const preDefs=PROVIDER_DEFS.slice(), preArch=ARCHIVED_PROVIDERS.slice();
  PROVIDER_DEFS=PROVIDER_DEFS.filter(n=>n.toLowerCase()!==name.toLowerCase());
  if(!ARCHIVED_PROVIDERS.some(n=>n.toLowerCase()===name.toLowerCase())) ARCHIVED_PROVIDERS.push(name);
  showSyncStatus('loading');
  const archOk = await window._supabaseSaveProviderDefs(PROVIDER_DEFS, ARCHIVED_PROVIDERS);
  if(!archOk){
    PROVIDER_DEFS=preDefs; ARCHIVED_PROVIDERS=preArch;
    showSyncStatus('error'); renderProviderTab(); renderSettingsTab();
    alert(`⚠ Could not archive "${name}".\n\nNothing was changed. Check your internet connection and try again.`);
    return;
  }
  try{ const d=await window._supabaseLoad(); if(d){ PROVIDER_DEFS=d.providerDefs||PROVIDER_DEFS; ARCHIVED_PROVIDERS=d.providerArchived||ARCHIVED_PROVIDERS; } }catch(e){ console.error(e); }
  showSyncStatus('saved');
  closeOverlay('providerDetailModal');
  renderProviderTab(); renderSettingsTab(); renderHistory(); renderBadges();
  if(typeof showToast==='function') showToast(`✓ Archived "${name}" — data retained`);
  setTimeout(()=>showSyncStatus(''),1500);
}
async function unarchiveProvider(name){
  const preDefsU=PROVIDER_DEFS.slice(), preArchU=ARCHIVED_PROVIDERS.slice();
  ARCHIVED_PROVIDERS=ARCHIVED_PROVIDERS.filter(n=>n.toLowerCase()!==name.toLowerCase());
  if(!PROVIDER_DEFS.some(n=>n.toLowerCase()===name.toLowerCase())) PROVIDER_DEFS.push(name);
  showSyncStatus('loading');
  const unarchOk = await window._supabaseSaveProviderDefs(PROVIDER_DEFS, ARCHIVED_PROVIDERS);
  if(!unarchOk){
    PROVIDER_DEFS=preDefsU; ARCHIVED_PROVIDERS=preArchU;
    showSyncStatus('error'); renderProviderTab(); renderSettingsTab();
    alert(`⚠ Could not restore "${name}".\n\nNothing was changed. Check your internet connection and try again.`);
    return;
  }
  try{ const d=await window._supabaseLoad(); if(d){ PROVIDER_DEFS=d.providerDefs||PROVIDER_DEFS; ARCHIVED_PROVIDERS=d.providerArchived||ARCHIVED_PROVIDERS; } }catch(e){ console.error(e); }
  showSyncStatus('saved');
  closeOverlay('providerDetailModal');
  renderProviderTab(); renderSettingsTab(); renderHistory(); renderBadges();
  if(typeof showToast==='function') showToast(`✓ Restored "${name}" to active tracking`);
  setTimeout(()=>showSyncStatus(''),1500);
}

function renderBadges() {
  document.getElementById('histNavBadge').textContent = DB.length;
  document.getElementById('compNavBadge').textContent = SELLERS.length||0;
  const pBadge=document.getElementById('providerNavBadge');
  // Same count the Provider page shows ("11 of 16 providers with data"): providers holding stock on
  // the newest import. It used to say 16 until the page was opened, then 11.
  if(pBadge){ const dates=[...new Set(PROVIDER_SNAPSHOTS.map(p=>p.date))].sort(), last=dates[dates.length-1];
    pBadge.textContent = last ? new Set(PROVIDER_SNAPSHOTS.filter(p=>p.date===last && !(typeof isArchived==="function" && isArchived(p.provider)) && ((p.skus||0)>0 || (p.value||0)>0)).map(p=>p.provider.toLowerCase())).size : 0; }
  // Count total sessions (not competitor entries)
  document.getElementById('compHistNavBadge').textContent = COMPETITOR_SESSIONS.length;
}

