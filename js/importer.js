let impIgnoredCodes = new Set(); // misc code -> ignored (folded into N/A on save)
let impComputed = null;
let impHasImport = false;   // true once a file/paste has been ingested this modal session
let impHasValuation = false; // true if the imported file had a "Total Valuation" column
let impHasDisposition = false; // true if the imported file had a "Disposition" column
let impExcludedRows = 0; // rows dropped because their Disposition wasn't "Available"
let impExistingData = null; // {providers, totalSkus, hasVal} — set when editing a past snapshot with saved provider data
let impItemTab = 'unresolved'; // 'unresolved' | 'ignored' (ignored = sent to N/A)
let impItemSearch = '';
let impSelectedSkus = new Set(); // checked rows in the current items tab, bulk-actioned via the toolbar

function impRulesFor(name){
  return PROVIDER_RULES.find(r => r.name.toLowerCase() === name.toLowerCase());
}
function impBuildLookup(){
  const exact = new Map(); const stems = []; const titleRules = [];
  const names = new Set([...PROVIDER_DEFS, NA_PROVIDER]);
  for (const name of names) {
    exact.set(name.toLowerCase(), name);
    const r = impRulesFor(name);
    if (r) {
      for (const a of (r.aliases||[])) if (a) exact.set(a.toLowerCase(), name);
      for (const s of (r.stems||[])) if (s) stems.push({ s: s.toLowerCase(), prov: name });
      for (const k of (r.titleKeywords||[])) if (k) titleRules.push({ kw: k.toLowerCase(), prov: name });
    }
  }
  stems.sort((a,b)=>b.s.length-a.s.length);
  titleRules.sort((a,b)=>b.kw.length-a.kw.length);
  return { exact, stems, titleRules };
}
function impStripDigits(t){ return t.replace(/\d+$/,''); }
function impIsNoise(t){
  if (t==='') return true;
  if (/^[\d.]+$/.test(t)) return true;
  if (IMP_HOUSEKEEP.has(t.toLowerCase())) return true;
  if (IMP_GENERIC_WORDS.has(t.toLowerCase())) return true;
  if (/^B0[A-Z0-9]{8}$/i.test(t)) return true;
  return false;
}
function impMatchTitle(title, titleRules){
  const t=(title||'').toLowerCase();
  if (!t) return null;
  for (const r of titleRules) if (t.includes(r.kw)) return r.prov;
  return null;
}
function impClassify(rawSku, lk){
  const sku=(rawSku||'').trim().replace(/^"|"$/g,'');
  if (!sku) return { misc:'Blank' };
  const parts=sku.split('_');
  if (parts.length===1) return { misc:'No naming format' };
  let match=null;
  for (let i=1;i<parts.length;i++){
    const base=impStripDigits(parts[i]).toLowerCase();
    if (!base) continue;
    if (lk.exact.has(base)){ match=lk.exact.get(base); continue; }
    for (const st of lk.stems){ if (base.startsWith(st.s)){ match=st.prov; break; } }
  }
  if (match) return { provider: match };
  for (let i=parts.length-1;i>=1;i--){
    const stripped=impStripDigits(parts[i]);
    if (impIsNoise(parts[i]) || impIsNoise(stripped)) continue;
    return { misc: stripped || parts[i] };
  }
  return { misc:'Unrecognised format' };
}
function impParseTable(text){
  text=text.replace(/^\uFEFF/,'');
  const delim=(text.split(/\r?\n/,1)[0]||'').includes('\t')?'\t':',';
  const recs=[]; let row=[], f='', q=false;
  for (let i=0;i<text.length;i++){
    const c=text[i];
    if (q){ if (c==='"'){ if (text[i+1]==='"'){ f+='"'; i++; } else q=false; } else f+=c; }
    else {
      if (c==='"') q=true;
      else if (c===delim){ row.push(f); f=''; }
      else if (c==='\n'){ row.push(f); recs.push(row); row=[]; f=''; }
      else if (c==='\r'){}
      else f+=c;
    }
  }
  if (f.length||row.length){ row.push(f); recs.push(row); }
  return recs.filter(r=>r.length && !(r.length===1 && r[0].trim()===''));
}
function impParseMoney(raw){
  if (raw==null) return 0;
  const n = parseFloat(String(raw).replace(/[£$,\s]/g,''));
  return isFinite(n) ? n : 0;
}

// ── Inventory Ageing file importer (Add Snapshot → Available FBA Stock) ──
// Separate from the SKU/provider importer above: this file has one row per SKU (no
// disposition duplication). Each bucket counts DISTINCT SKUs, not units — a SKU with
// 140 units sitting in one bucket is still 1 SKU, not 140. A SKU is assigned to exactly
// one bucket: if its stock spans more than one age range (rare — 4 of 638 SKUs in the
// reference file), it's counted in its OLDEST bucket, since that's the one that should
// drive attention, and its full valuation (summed across every bucket it touches) moves
// with it — so nothing is split or double-counted, and bucket counts always sum to the
// true SKU total. Valuation is the exact figure from the file, never rounded.
const AGE_BUCKET_COLS = [
  {field:'fA0',   ageCol:'age 0-30',   valCol:'value 0-30'},
  {field:'fA31',  ageCol:'age 31-60',  valCol:'value 31-60'},
  {field:'fA61',  ageCol:'age 61-90',  valCol:'value 61-90'},
  {field:'fA91',  ageCol:'age 91-180', valCol:'value 91-180'},
  {field:'fA181', ageCol:'age 181-270',valCol:'value 181-270'},
  {field:'fA271', ageCol:'age 271-365',valCol:'value 271-365'},
  {field:'fA365', ageCol:'age 365+',   valCol:'value 365+'},
];
let ageValuation = { a0:0, a31:0, a61:0, a91:0, a181:0, a271:0, a365:0 }; // picked up by saveSnap()
let ageHasValuation = false;
// Header names Amazon has used for the ASIN column across report versions and locales.
const ASIN_HEADERS = ['asin','asin1','product asin','child asin','asin (child)','child-asin','asin-code'];
let ageHasAsins = false;
let ageAsinCounts = {};   // per bucket, distinct ASINs — computed on import, not yet stored
let ageAsinValues = {};
let ageSkuRows = [];      // [sku, asin, band, £, units, oldest received, title] — saved to bdl_snapshot_skus
// SellerToolKit writes dates as dd/mm/yyyy.
const ageIsoDate = v => { const m = String(v||'').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}` : ''; };

function ageIngest(text, fname){
  const recs = impParseTable(text);
  if (!recs.length){ showToast('Nothing to read in that file'); return; }
  const header = recs[0].map(h=>h.trim().toLowerCase());
  const colIdx = {};
  AGE_BUCKET_COLS.forEach(b=>{ colIdx[b.field+'_age']=header.indexOf(b.ageCol); colIdx[b.field+'_val']=header.indexOf(b.valCol); });
  const skuIdx = header.indexOf('sku');
  // The ageing export is per-SKU, but several SKUs can sit on one ASIN. If the file carries
  // an ASIN column we can group by it as well — an ASIN inherits the age of its OLDEST SKU,
  // the same rule a SKU follows across its own buckets.
  const asinIdx = ASIN_HEADERS.map(h=>header.indexOf(h)).find(i=>i>=0) ?? -1;
  const titleIdx = header.indexOf('title'), oldestIdxCol = header.indexOf('oldest received');
  ageSkuRows = [];

  if (skuIdx===-1 || AGE_BUCKET_COLS.every(b=>colIdx[b.field+'_age']===-1)){
    showToast("That doesn't look like an Inventory Ageing export — couldn't find the age bucket columns");
    return;
  }

  const asinAgg = new Map();   // asin -> { oldest bucket index across its SKUs, total £ }
  const skuCounts = {}; AGE_BUCKET_COLS.forEach(b=>skuCounts[b.field]=0);   // distinct SKUs per bucket
  const valSums = {}; AGE_BUCKET_COLS.forEach(b=>valSums[b.field]=0);       // exact £ total per bucket, no rounding
  let skuCount = 0;
  let anyValuation = false;
  let splitSkuCount = 0;
  let blankSkuRows = 0;     // rows with no SKU value at all — skipped, can't be placed anywhere
  let zeroUnitSkus = 0;     // SKU present but every bucket showed 0 units (e.g. fully Inbound/Reserved, nothing Available)

  for (let i=1;i<recs.length;i++){
    const r = recs[i];
    const sku = (r[skuIdx]||'').trim();
    if (!sku){ if (r.join('').trim()!=='') blankSkuRows++; continue; }
    skuCount++;

    // Which buckets does this SKU have units in, and what's its full valuation across all of them?
    let bucketsWithUnits = [];
    let skuTotalValue = 0, skuUnits = 0;
    AGE_BUCKET_COLS.forEach((b,idx)=>{
      const ai = colIdx[b.field+'_age'];
      const units = ai>=0 ? (parseFloat(r[ai])||0) : 0;
      skuUnits += units;
      const vi = colIdx[b.field+'_val'];
      const val = vi>=0 ? impParseMoney(r[vi]) : 0;
      if (val>0) anyValuation = true;
      skuTotalValue += val;
      if (units>0) bucketsWithUnits.push(idx);
    });

    if (!bucketsWithUnits.length){ zeroUnitSkus++; continue; }
    if (bucketsWithUnits.length>1) splitSkuCount++;

    // Oldest bucket = highest index in AGE_BUCKET_COLS (0-30 is index 0, 365+ is index 6)
    const oldestIdx = Math.max(...bucketsWithUnits);
    const targetField = AGE_BUCKET_COLS[oldestIdx].field;
    skuCounts[targetField]++;
    valSums[targetField] += skuTotalValue;
    ageSkuRows.push([sku, asinIdx>=0 ? (r[asinIdx]||'').trim().toUpperCase() : '', oldestIdx, Math.round(skuTotalValue*100)/100, skuUnits,
      oldestIdxCol>=0 ? ageIsoDate(r[oldestIdxCol]) : '', titleIdx>=0 ? (r[titleIdx]||'').trim().replace(/^"|"$/g,'').slice(0,90) : '']);

    if (asinIdx>=0){
      const asin=(r[asinIdx]||'').trim().toUpperCase();
      if (asin){
        const cur = asinAgg.get(asin) || { oldest:-1, value:0, skus:0 };
        cur.oldest = Math.max(cur.oldest, oldestIdx);   // oldest SKU sets the ASIN's age
        cur.value += skuTotalValue;
        cur.skus++;
        asinAgg.set(asin, cur);
      }
    }
  }

  // Roll the per-ASIN aggregate into the same seven buckets.
  ageHasAsins = asinIdx>=0 && asinAgg.size>0;
  ageAsinCounts = {}; ageAsinValues = {};
  AGE_BUCKET_COLS.forEach(b=>{ ageAsinCounts[b.field]=0; ageAsinValues[b.field]=0; });
  asinAgg.forEach(v=>{
    const f = AGE_BUCKET_COLS[v.oldest].field;
    ageAsinCounts[f]++; ageAsinValues[f] += v.value;
  });

  AGE_BUCKET_COLS.forEach(b=>{ document.getElementById(b.field).value = skuCounts[b.field] || 0; });
  ageHasValuation = anyValuation;
  ageValuation = { a0:valSums.fA0, a31:valSums.fA31, a61:valSums.fA61, a91:valSums.fA91, a181:valSums.fA181, a271:valSums.fA271, a365:valSums.fA365 };

  // Per-bucket £ readout under each input, so the valuation being captured is visible before you even save
  AGE_BUCKET_COLS.forEach(b=>{
    const el=document.getElementById('ageVal'+b.field.replace('f',''));
    if (!el) return;
    el.textContent = (anyValuation && valSums[b.field]>0) ? fmtGBP(incVat(valSums[b.field]))+' inc VAT' : '';
  });

  document.getElementById('ageDrop').style.display = 'none';
  document.getElementById('ageLoadedWrap').style.display = '';
  document.getElementById('ageLoadedName').textContent = fname || 'pasted text';
  const placedCount = Object.values(skuCounts).reduce((s,v)=>s+v,0);
  document.getElementById('ageSkuCount').textContent = placedCount;

  // Errors/anomalies — shown persistently next to the loaded-file line, not just a toast that disappears
  const errParts = [];
  if (blankSkuRows>0) errParts.push(`${blankSkuRows} row${blankSkuRows!==1?'s':''} with no SKU skipped`);
  if (zeroUnitSkus>0) errParts.push(`${zeroUnitSkus} SKU${zeroUnitSkus!==1?'s':''} had 0 units in every bucket`);
  if (splitSkuCount>0) errParts.push(`${splitSkuCount} SKU${splitSkuCount!==1?'s':''} spanned multiple buckets (counted in oldest)`);
  if (!anyValuation) errParts.push(`no valuation columns found`);
  if (asinIdx===-1) errParts.push(`no ASIN column in this file — SKU level only`);
  const errEl=document.getElementById('ageErrSpan');
  errEl.textContent = errParts.length ? ` · ⚠ ${errParts.join(' · ')}` : '';
  errEl.style.color = errParts.length ? 'var(--y)' : '';

  // Show the ASIN read-out straight away — it needs no database change to be useful,
  // it just cannot be kept between snapshots until the columns exist.
  const asinEl = document.getElementById('ageAsinSpan');
  if (asinEl){
    if (ageHasAsins){
      const aged = ageAsinCounts.fA181 + ageAsinCounts.fA271 + ageAsinCounts.fA365;
      const tot  = AGE_BUCKET_COLS.reduce((n,b)=>n+ageAsinCounts[b.field],0);
      const multi = [...asinAgg.values()].filter(v=>v.skus>1).length;
      asinEl.innerHTML = ` · <span style="color:var(--b)">${tot.toLocaleString()} ASINs</span>`
        + ` · ${aged.toLocaleString()} at 181d+ (${tot?((aged/tot)*100).toFixed(1):'0.0'}%)`
        + (multi?` · ${multi} ASIN${multi!==1?'s':''} with more than one SKU`:'');
    } else asinEl.innerHTML='';
  }
  showToast(`Filled ageing buckets from ${placedCount.toLocaleString()} SKUs`
    + (ageHasAsins?` · ${AGE_BUCKET_COLS.reduce((n,b)=>n+ageAsinCounts[b.field],0).toLocaleString()} ASINs read`:''));
}

function ageReset(){
  document.getElementById('ageDrop').style.display = '';
  document.getElementById('ageLoadedWrap').style.display = 'none';
  document.getElementById('ageFile').value = '';
  ageValuation = { a0:0, a31:0, a61:0, a91:0, a181:0, a271:0, a365:0 };
  ageHasValuation = false;
  ageHasAsins = false; ageAsinCounts = {}; ageAsinValues = {}; ageSkuRows = [];
  const asinEl=document.getElementById('ageAsinSpan'); if (asinEl) asinEl.innerHTML='';
  AGE_BUCKET_COLS.forEach(b=>{ const el=document.getElementById('ageVal'+b.field.replace('f','')); if (el) el.textContent=''; });
  const errEl=document.getElementById('ageErrSpan'); if (errEl){ errEl.textContent=''; errEl.style.color=''; }
}

document.getElementById('ageDrop').addEventListener('dragover', e=>{ e.preventDefault(); document.getElementById('ageDrop').classList.add('drag'); });
document.getElementById('ageDrop').addEventListener('dragleave', ()=>document.getElementById('ageDrop').classList.remove('drag'));
document.getElementById('ageDrop').addEventListener('drop', e=>{
  e.preventDefault(); document.getElementById('ageDrop').classList.remove('drag');
  const f=e.dataTransfer.files[0]; if (f) f.text().then(t=>ageIngest(t, f.name));
});
document.getElementById('ageFile').addEventListener('change', e=>{
  const f=e.target.files[0]; if (f) f.text().then(t=>ageIngest(t, f.name));
});

const IMP_ACTIVE_DISPOSITIONS = new Set(['available']); // only disposition counted as real, sellable stock — excludes Inbound/Transfer/Processing/Customer Order/Stranded/Damaged/etc
function impIngest(text, fname){
  const recs=impParseTable(text);
  if (!recs.length){ showToast('Nothing to read in that file'); return; }
  const header=recs[0].map(h=>h.trim().toLowerCase());
  let skuIdx=header.indexOf('sku');
  let titleIdx=header.indexOf('title');
  let valIdx=header.indexOf('total valuation');
  let dispIdx=header.indexOf('disposition');
  let dataStart=1;
  if (skuIdx===-1){ skuIdx=recs[0].length>1?1:0; dataStart=0; titleIdx=-1; valIdx=-1; dispIdx=-1; }
  impRows=[];
  let excludedCount=0;
  for (let i=dataStart;i<recs.length;i++){
    const r=recs[i];
    const sku=(r[skuIdx]||'').trim();
    if (!sku && r.join('').trim()==='') continue;
    if (dispIdx>=0){
      const disp=(r[dispIdx]||'').trim().toLowerCase();
      if (!IMP_ACTIVE_DISPOSITIONS.has(disp)){ excludedCount++; continue; }
    }
    impRows.push({
      sku,
      title: titleIdx>=0?(r[titleIdx]||'').trim():'',
      value: valIdx>=0?impParseMoney(r[valIdx]):0
    });
  }
  impHasValuation = valIdx>=0;
  impHasDisposition = dispIdx>=0;
  impExcludedRows = excludedCount;
  impSkuOverride=new Map(); impIgnoredCodes=new Set();
  impFileName=fname||'pasted text';
  impHasImport=true;
  document.getElementById('impLoadedName').textContent=impFileName;
  document.getElementById('impLoadedWrap').style.display='';
  document.getElementById('impEditNote').style.display='none';
  document.getElementById('impStatUnres').style.display='';
  document.getElementById('impGate').style.display='';
  document.getElementById('impDropTitle').textContent='Drop another file to replace this import';
  const dispNote=document.getElementById('impDispNote');
  if (dispNote){
    if (impHasDisposition){
      document.getElementById('impDispExcluded').textContent=impExcludedRows;
      dispNote.style.display='';
    } else {
      dispNote.style.display='none';
    }
  }
  document.getElementById('impBtnReload').style.display='';
  impRender();
  showToast(impExcludedRows>0
    ? `Read ${impRows.length} Available SKUs from ${impFileName} (${impExcludedRows} non-Available row${impExcludedRows!==1?'s':''} excluded)`
    : `Read ${impRows.length} SKUs from ${impFileName}`);
}
function impOccMap(){
  const m=new Map();
  for (const r of impRows){ const k=r.sku.trim(); if (k) m.set(k,(m.get(k)||0)+1); }
  return m;
}
function impWorkingRows(){
  if (impCountMode!=='unique') return impRows;
  const seen=new Set(); const out=[];
  for (const r of impRows){
    const k=r.sku.trim();
    if (k && seen.has(k)) continue;
    if (k) seen.add(k);
    out.push(r);
  }
  return out;
}
const impSkuProv = new Map();   // sku -> provider, as classified on this import (saved with each SKU's row)
function impCompute(){
  const lookup=impBuildLookup();
  impSkuProv.clear();
  const wr=impWorkingRows();
  const occ=impOccMap();
  const pc=new Map(); PROVIDER_DEFS.forEach(n=>pc.set(n,0)); pc.set(NA_PROVIDER,0);
  const pv=new Map(); PROVIDER_DEFS.forEach(n=>pv.set(n,0)); pv.set(NA_PROVIDER,0);
  const unresCodes=new Map(); const unresItems=[]; const naItems=[];
  for (const r of wr){
    const sku=r.sku;
    const val=r.value||0;
    const ov=impSkuOverride.get(sku);
    if (ov && pc.has(ov)){ impSkuProv.set(sku.trim(), ov); pc.set(ov, pc.get(ov)+1); pv.set(ov, pv.get(ov)+val); if (ov===NA_PROVIDER) naItems.push({code:'manual',sku,title:r.title,occ:occ.get(sku.trim())||1}); continue; }
    const res=impClassify(sku, lookup);
    let prov=res.provider||null;
    if (!prov) prov=impMatchTitle(r.title, lookup.titleRules);
    if (prov) impSkuProv.set(sku.trim(), prov);
    if (prov && pc.has(prov)){ pc.set(prov, pc.get(prov)+1); pv.set(prov, pv.get(prov)+val); if (prov===NA_PROVIDER) naItems.push({code:res.misc||'matched',sku,title:r.title,occ:occ.get(sku.trim())||1}); continue; }
    const code=res.misc;
    if (impIgnoredCodes.has(code)){ impSkuProv.set(sku.trim(), NA_PROVIDER); pc.set(NA_PROVIDER, pc.get(NA_PROVIDER)+1); pv.set(NA_PROVIDER, pv.get(NA_PROVIDER)+val); naItems.push({code,sku,title:r.title,occ:occ.get(sku.trim())||1}); continue; }
    unresCodes.set(code,(unresCodes.get(code)||0)+1);
    unresItems.push({code,sku,title:r.title,occ:occ.get(sku.trim())||1});
  }
  const providerCounts=[...pc.entries()].map(([name,count])=>({name,count,value:pv.get(name)||0})).filter(p=>p.count>0 && p.name!==NA_PROVIDER);
  const unresolvedCodes=[...unresCodes.entries()].map(([name,count])=>({name,count,pseudo:IMP_PSEUDO.has(name),lowSignal:impIsGenericWord(name)})).sort((a,b)=>b.count-a.count);
  const matched=providerCounts.reduce((s,p)=>s+p.count,0);
  impComputed={ providerCounts, unresolvedCodes, unresItems, naItems, naCount: pc.get(NA_PROVIDER)||0,
    naValue: pv.get(NA_PROVIDER)||0, total: wr.length, matched, unresolved: unresItems.length };
}
function impRender(){
  impCompute();
  const c=impComputed;
  document.getElementById('impSTotal').textContent=c.total.toLocaleString();
  document.getElementById('impSMatched').textContent=c.matched.toLocaleString();
  document.getElementById('impSUnres').textContent=c.unresolved.toLocaleString();
  document.getElementById('impSIgnored').textContent=c.naCount.toLocaleString();
  document.getElementById('impStatUnres').classList.toggle('zero', c.unresolved===0);
  document.getElementById('impProvTag').textContent=`${c.providerCounts.length} provider${c.providerCounts.length!==1?'s':''}`;

  const gate=document.getElementById('impGate');
  const gateText=document.getElementById('impGateText');
  if (c.unresolved===0){
    gate.classList.add('done');
    gateText.innerHTML=`<b>0</b> unresolved — every SKU has a provider or is sent to N/A. Ready to save.`;
  } else {
    gate.classList.remove('done');
    gateText.innerHTML=`<b>${c.unresolved}</b> SKU${c.unresolved!==1?'s':''} still need a provider before this snapshot can be saved.`;
  }

  const provBody=document.getElementById('impProvBody');
  const provHead=document.querySelector('#impProvTable thead');
  const sorted=c.providerCounts.slice().sort((a,b)=>b.count-a.count);
  if (provHead) provHead.innerHTML = impHasValuation ? `<tr><th>Provider</th><th class="num">SKUs</th><th class="num">Valuation</th></tr>` : '';
  provBody.innerHTML = sorted.length
    ? sorted.map(p=>`<tr><td>${escapeHtmlImp(p.name)}</td><td class="num">${p.count}</td>${impHasValuation?`<td class="num">${fmtGBP(incVat(p.value||0))}</td>`:''}</tr>`).join('')
    : `<tr><td colspan="${impHasValuation?3:2}" class="imp-empty">${PROVIDER_DEFS.length ? 'No providers matched yet.' : 'No providers set up yet — add some in Settings → SKU Matching Rules.'}</td></tr>`;

  const miscList=document.getElementById('impMiscList');
  document.getElementById('impMiscTag').textContent=`${c.unresolvedCodes.length} code${c.unresolvedCodes.length!==1?'s':''}`;
  if (!c.unresolvedCodes.length){
    miscList.innerHTML=`<div class="imp-empty good">Nothing left — Unresolved is at zero ✓</div>`;
  } else {
    miscList.innerHTML=c.unresolvedCodes.map(m=>`
      <div class="imp-mrow">
        <span class="mname${(m.pseudo||m.lowSignal)?' pseudo':''}" title="${escapeHtmlImp(m.name)}${m.lowSignal?' — generic word, likely not a real provider code':''}">${escapeHtmlImp(m.name)}</span>
        <span class="mcount">${m.count}</span>
        <select data-imp-asg="${escapeHtmlImp(m.name)}" data-imp-pseudo="${m.pseudo?1:0}">
          <option value="">Assign →</option>${impProvOptions()}
        </select>
        <button type="button" class="imp-btn-ig" data-imp-ig="${escapeHtmlImp(m.name)}">→ N/A</button>
      </div>`).join('');
    miscList.querySelectorAll('[data-imp-asg]').forEach(s=>s.onchange=e=>{
      if (!e.target.value) return;
      const code=e.target.dataset.impAsg;
      const pseudo=e.target.dataset.impPseudo==='1';
      impAssignCode(code, e.target.value, pseudo);
    });
    miscList.querySelectorAll('[data-imp-ig]').forEach(b=>b.onclick=()=>impIgnoreCode(b.dataset.impIg));
  }

  const btn=document.getElementById('btnSaveSnap');
  if (btn) btn.disabled = impHasImport && c.unresolved>0;

  const footGate=document.getElementById('impFootGate');
  if (footGate){
    footGate.textContent = c.unresolved===0
      ? `${c.matched.toLocaleString()} matched, ${c.naCount.toLocaleString()} sent to N/A — ready to save.`
      : `${c.unresolved.toLocaleString()} SKU${c.unresolved!==1?'s':''} still need a provider before this snapshot can be saved.`;
  }
  updateImpSummaryCard();

  renderImpItems();
}

function renderImpItems(){
  const c=impComputed;
  const body=document.getElementById('impItemBody');
  if (!body || !c) return;
  const q=impItemSearch.trim().toLowerCase();
  let source = impItemTab==='ignored' ? c.naItems : c.unresItems;
  let list = source.slice();
  if (q) list = list.filter(it => (it.code+' '+it.sku+' '+(it.title||'')).toLowerCase().includes(q));
  document.getElementById('impItemTag').textContent = `${list.length} item${list.length!==1?'s':''}`;

  // Drop any selected SKUs no longer in the visible list (resolved/moved/filtered out)
  const visibleSkus = new Set(list.map(it=>it.sku));
  for (const sku of [...impSelectedSkus]) if (!visibleSkus.has(sku)) impSelectedSkus.delete(sku);

  if (!list.length){
    const msg = impItemTab==='ignored' ? 'Nothing sent to N/A yet.'
      : (c.unresolved===0 ? 'All resolved — zero unresolved items ✓' : `No items${q?` match "${escapeHtmlImp(q)}"`:''}.`);
    body.innerHTML = `<tr><td colspan="5" class="imp-empty${(impItemTab!=='ignored'&&c.unresolved===0)?' good':''}">${msg}</td></tr>`;
    renderImpBulkBar();
    return;
  }

  body.innerHTML = list.map(it=>{
    const pseudo = IMP_PSEUDO.has(it.code) || impIsGenericWord(it.code);
    const codeChip = `<span class="imp-chip-mini${pseudo?' pseudo':''}">${escapeHtmlImp(it.code)}</span>`;
    const checked = impSelectedSkus.has(it.sku) ? 'checked' : '';
    let action;
    if (impItemTab==='ignored'){
      action = `<button type="button" class="imp-item-restore" data-imp-restore="${escapeHtmlImp(it.sku)}">Restore</button>`;
    } else {
      action = `<div class="iwrap">
          <select data-imp-item-asg="${escapeHtmlImp(it.sku)}">
            <option value="">Assign →</option>${impProvOptions()}
          </select>
          <button type="button" class="imp-btn-ig" data-imp-item-ig="${escapeHtmlImp(it.sku)}">→ N/A</button>
        </div>`;
    }
    return `<tr>
      <td><input type="checkbox" class="imp-row-cb" data-imp-cb="${escapeHtmlImp(it.sku)}" ${checked}></td>
      <td class="code">${codeChip}</td>
      <td class="ttl" title="${escapeHtmlImp(it.title||'')}">${escapeHtmlImp(it.title||'—')}</td>
      <td class="sk" title="${escapeHtmlImp(it.sku)}">${escapeHtmlImp(it.sku)}${(impCountMode==='unique'&&it.occ>1)?` <span class="imp-occ" title="${it.occ} rows across dispositions, counted once">×${it.occ}</span>`:''}</td>
      <td class="act">${action}</td>
    </tr>`;
  }).join('');

  body.querySelectorAll('[data-imp-item-asg]').forEach(s=>s.onchange=e=>{
    if (!e.target.value) return;
    impAssignSku(e.target.dataset.impItemAsg, e.target.value);
  });
  body.querySelectorAll('[data-imp-item-ig]').forEach(b=>b.onclick=()=>impIgnoreSku(b.dataset.impItemIg));
  body.querySelectorAll('[data-imp-restore]').forEach(b=>b.onclick=()=>impRestoreSku(b.dataset.impRestore));
  body.querySelectorAll('[data-imp-cb]').forEach(cb=>cb.onchange=e=>{
    const sku=e.target.dataset.impCb;
    if (e.target.checked) impSelectedSkus.add(sku); else impSelectedSkus.delete(sku);
    renderImpBulkBar();
    syncImpHeadCb(list);
  });
  syncImpHeadCb(list);
  renderImpBulkBar();
}

function syncImpHeadCb(list){
  const head=document.getElementById('impHeadCb');
  if (!head) return;
  const allChecked = list.length>0 && list.every(it=>impSelectedSkus.has(it.sku));
  head.checked = allChecked;
  head.indeterminate = !allChecked && list.some(it=>impSelectedSkus.has(it.sku));
}

function renderImpBulkBar(){
  const bar=document.getElementById('impBulkBar');
  if (!bar) return;
  const n=impSelectedSkus.size;
  // Bulk assign/ignore only make sense on the Unresolved tab (Sent to N/A only offers Restore, handled per-row).
  if (n===0 || impItemTab==='ignored'){
    bar.style.display='none';
    return;
  }
  bar.style.display='';
  document.getElementById('impBulkCount').textContent=n;
  const sel=document.getElementById('impBulkAssignSel');
  sel.innerHTML = `<option value="">Assign selected →</option>${impProvOptions()}`;
}

function impBulkAssign(provName){
  if (!provName || !impSelectedSkus.size) return;
  const n=impSelectedSkus.size;
  for (const sku of impSelectedSkus) impSkuOverride.set(sku, provName);
  impSelectedSkus.clear();
  impRender();
  showToast(`${n} item${n!==1?'s':''} → ${escapeHtmlImp(provName)}`);
}
function impBulkSendNA(){
  if (!impSelectedSkus.size) return;
  const n=impSelectedSkus.size;
  for (const sku of impSelectedSkus) impSkuOverride.set(sku, NA_PROVIDER);
  impSelectedSkus.clear();
  impRender();
  showToast(`${n} item${n!==1?'s':''} → N/A`);
}

// Per-SKU assign/ignore/restore — for resolving one row out of the items table directly,
// independent of the bulk per-code actions above.
function impAssignSku(sku, provName){
  impSkuOverride.set(sku, provName);
  impRender();
  showToast(`Item → ${escapeHtmlImp(provName)}`);
}
function impIgnoreSku(sku){
  impSkuOverride.set(sku, NA_PROVIDER);
  impRender();
  showToast('Sent 1 item → N/A');
}
function impRestoreSku(sku){
  impSkuOverride.delete(sku);
  impRender();
  showToast('Restored 1 item');
}
function impProvOptions(){
  return PROVIDER_DEFS.map(n=>`<option value="${escapeHtmlImp(n)}">${escapeHtmlImp(n)}</option>`).join('');
}
function escapeHtmlImp(s){ return String(s??'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

async function impAssignCode(code, provName, pseudo){
  if (pseudo){
    // pseudo buckets (no real token) -> snapshot every current item to an override
    const items=impComputed.unresItems.filter(it=>it.code===code);
    items.forEach(it=>impSkuOverride.set(it.sku, provName));
  } else {
    // real token -> generalize as a permanent alias for next time, persisted to Supabase
    let r=impRulesFor(provName);
    if (!r){ r={ name: provName, aliases:[], stems:[], titleKeywords:[] }; PROVIDER_RULES.push(r); }
    const alias=code.toLowerCase();
    if (provName.toLowerCase()!==alias && !(r.aliases||[]).map(a=>a.toLowerCase()).includes(alias)){
      r.aliases=r.aliases||[]; r.aliases.push(code);
    }
    try { await window._supabaseSaveProviderRule(r); } catch(e){ console.error('rule save failed', e); }
  }
  impRender();
  showToast(`${escapeHtmlImp(code)} → ${escapeHtmlImp(provName)}`);
}
function impIgnoreCode(code){
  impIgnoredCodes.add(code);
  impRender();
  showToast(`Sent ${escapeHtmlImp(code)} → N/A`);
}
function impSendRemaining(){
  const items=impComputed.unresItems.slice();
  if (!items.length) return;
  items.forEach(it=>impSkuOverride.set(it.sku, NA_PROVIDER));
  impRender();
  showToast(`Sent ${items.length} remaining → N/A`);
}
function impResetModalState(){
  impRows=[]; impFileName=''; impCountMode='unique'; impSkuOverride=new Map();
  impIgnoredCodes=new Set(); impComputed=null; impHasImport=false; impHasValuation=false;
  impHasDisposition=false; impExcludedRows=0; impExistingData=null;
  impItemTab='unresolved'; impItemSearch=''; impSelectedSkus.clear();
  document.getElementById('impLoadedWrap').style.display='none';
  document.getElementById('impEditNote').style.display='none';
  document.getElementById('impStatUnres').style.display='';
  document.getElementById('impGate').style.display='';
  document.getElementById('impDropTitle').textContent='Drop the SellerToolKit file here';
  const dispNoteReset=document.getElementById('impDispNote'); if (dispNoteReset) dispNoteReset.style.display='none';
  document.getElementById('impBtnReload').style.display='none';
  document.getElementById('impPaste').value=''; document.getElementById('impPaste').classList.remove('show');
  document.getElementById('impFile').value='';
  document.querySelectorAll('#impModeSeg button').forEach(b=>b.classList.toggle('on', b.dataset.mode==='unique'));
  document.querySelectorAll('#impItemSeg button').forEach(b=>b.classList.toggle('on', b.dataset.tab==='unresolved'));
  const itemSearchEl=document.getElementById('impItemSearch'); if (itemSearchEl) itemSearchEl.value='';
  const itemBody=document.getElementById('impItemBody'); if (itemBody) itemBody.innerHTML='';
  const provHeadReset=document.querySelector('#impProvTable thead'); if (provHeadReset) provHeadReset.innerHTML='';
  const btn=document.getElementById('btnSaveSnap'); if (btn) btn.disabled=false;
  updateImpSummaryCard();
}
function impShowExistingSummary(date){
  const existing=PROVIDER_SNAPSHOTS.filter(p=>p.date===date);
  if (!existing.length) return;
  const hasVal = existing.some(p=>(p.value||0)>0);
  const totalSkus = existing.reduce((s,p)=>s+(p.skus||0),0);
  const totalVal = incVat(existing.reduce((s,p)=>s+(p.value||0),0));
  // Store so updateImpSummaryCard can show the filled card even without a live import
  impExistingData = { providers: existing, totalSkus, hasVal, totalVal };
  document.getElementById('impEditNote').style.display='';
  document.getElementById('impLoadedWrap').style.display='';
  document.getElementById('impLoadedName').textContent='saved snapshot (not re-imported)';
  document.getElementById('impStatUnres').style.display='none';
  document.getElementById('impGate').style.display='none';
  document.getElementById('impSTotal').textContent=existing.reduce((s,p)=>s+(p.skus||0),0).toLocaleString();
  document.getElementById('impSMatched').textContent=existing.reduce((s,p)=>s+(p.skus||0),0).toLocaleString();
  document.getElementById('impSIgnored').textContent='—';
  document.getElementById('impProvTag').textContent=`${existing.length} provider${existing.length!==1?'s':''}`;
  const provHead=document.querySelector('#impProvTable thead');
  if (provHead) provHead.innerHTML = hasVal ? `<tr><th>Provider</th><th class="num">SKUs</th><th class="num">Valuation</th></tr>` : '';
  document.getElementById('impProvBody').innerHTML=existing.slice().sort((a,b)=>b.skus-a.skus)
    .map(p=>`<tr><td>${escapeHtmlImp(p.provider)}</td><td class="num">${p.skus}</td>${hasVal?`<td class="num">${fmtGBP(incVat(p.value||0))}</td>`:''}</tr>`).join('');
  document.getElementById('impMiscTag').textContent='0 codes';
  document.getElementById('impMiscList').innerHTML=`<div class="imp-empty good">No unresolved items — these counts were already saved.</div>`;
  document.getElementById('impItemTag').textContent='0 items';
  document.getElementById('impItemBody').innerHTML=`<tr><td colspan="5" class="imp-empty">Nothing to review — import a file above to see individual items.</td></tr>`;
  const btn=document.getElementById('btnSaveSnap'); if (btn) btn.disabled=false;
  updateImpSummaryCard();
}
