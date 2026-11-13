
// ── Full-screen importer modal open/close + compact summary card shown in Add Snapshot ──
function openImpModal(){
  document.getElementById('impModal').classList.add('open');
}
function closeImpModal(){
  document.getElementById('impModal').classList.remove('open');
  updateImpSummaryCard();
}
function updateImpSummaryCard(){
  const empty=document.getElementById('impSummaryEmpty');
  const filled=document.getElementById('impSummaryFilled');
  if (!empty || !filled) return;

  // Live import takes priority; fall back to saved snapshot data when editing
  if (!impHasImport || !impComputed){
    if (impExistingData){
      // Edit path — show the saved counts as the summary card
      empty.style.display='none';
      filled.style.display='';
      document.getElementById('impSumName').textContent='saved providers';
      document.getElementById('impSumMatched').textContent=impExistingData.totalSkus.toLocaleString();
      document.getElementById('impSumUnres').textContent='0';
      document.getElementById('impSumUnresWrap').classList.add('zero');
      const valWrap=document.getElementById('impSumValWrap');
      if (impExistingData.hasVal){
        document.getElementById('impSumVal').textContent='£'+impExistingData.totalVal.toLocaleString(undefined,{maximumFractionDigits:0});
        valWrap.style.display='';
      } else {
        valWrap.style.display='none';
      }
      const gate=document.getElementById('impSumGate');
      gate.textContent=`${impExistingData.providers.length} provider${impExistingData.providers.length!==1?'s':''} saved ✓`;
      gate.classList.add('done');
      const btn=document.getElementById('impSumOpenBtn');
      if (btn) btn.textContent='View / replace';
    } else {
      empty.style.display='';
      filled.style.display='none';
    }
    return;
  }

  empty.style.display='none';
  filled.style.display='';
  const openBtn=document.getElementById('impSumOpenBtn');
  if (openBtn) openBtn.textContent='Open importer';
  document.getElementById('impSumName').textContent=impFileName||'imported file';
  document.getElementById('impSumMatched').textContent=impComputed.matched.toLocaleString();
  document.getElementById('impSumUnres').textContent=impComputed.unresolved.toLocaleString();
  document.getElementById('impSumUnresWrap').classList.toggle('zero', impComputed.unresolved===0);
  const valWrap=document.getElementById('impSumValWrap');
  if (impHasValuation){
    const total=impComputed.providerCounts.reduce((s,p)=>s+(p.value||0),0)+(impComputed.naValue||0);
    document.getElementById('impSumVal').textContent=fmtGBP(incVat(total))+' inc VAT';
    valWrap.style.display='';
  } else {
    valWrap.style.display='none';
  }
  const gate=document.getElementById('impSumGate');
  if (impComputed.unresolved===0){
    gate.textContent='Ready to save ✓';
    gate.classList.add('done');
  } else {
    gate.textContent=`${impComputed.unresolved} need review`;
    gate.classList.remove('done');
  }
}

document.getElementById('impDrop').addEventListener('dragover', e=>{ e.preventDefault(); document.getElementById('impDrop').classList.add('drag'); });
document.getElementById('impDrop').addEventListener('dragleave', ()=>document.getElementById('impDrop').classList.remove('drag'));
document.getElementById('impDrop').addEventListener('drop', e=>{
  e.preventDefault(); document.getElementById('impDrop').classList.remove('drag');
  const f=e.dataTransfer.files[0]; if (f) f.text().then(t=>impIngest(t, f.name));
});
document.getElementById('impBtnPick').onclick=()=>document.getElementById('impFile').click();
document.getElementById('impFile').onchange=e=>{ const f=e.target.files[0]; if (f) f.text().then(t=>impIngest(t, f.name)); };
document.getElementById('impBtnPaste').onclick=()=>{
  const ta=document.getElementById('impPaste'); ta.classList.toggle('show'); if (ta.classList.contains('show')) ta.focus();
};
document.getElementById('impPaste').addEventListener('input', e=>{ const v=e.target.value; if (v.trim().length>20) impIngest(v, 'pasted text'); });
document.getElementById('impBtnReload').onclick=()=>impResetModalState();
document.getElementById('impBtnSendNA').onclick=impSendRemaining;
document.querySelectorAll('#impModeSeg button').forEach(b=>b.onclick=()=>{
  impCountMode=b.dataset.mode;
  document.querySelectorAll('#impModeSeg button').forEach(x=>x.classList.toggle('on', x===b));
  impRender();
});
document.querySelectorAll('#impItemSeg button').forEach(b=>b.onclick=()=>{
  impItemTab=b.dataset.tab;
  impSelectedSkus.clear();
  document.querySelectorAll('#impItemSeg button').forEach(x=>x.classList.toggle('on', x===b));
  renderImpItems();
});
document.getElementById('impItemSearch').addEventListener('input', e=>{ impItemSearch=e.target.value; renderImpItems(); });
document.getElementById('impHeadCb').addEventListener('change', e=>{
  const c=impComputed; if (!c) return;
  const q=impItemSearch.trim().toLowerCase();
  let source = impItemTab==='ignored' ? c.naItems : c.unresItems;
  let list = source.slice();
  if (q) list = list.filter(it => (it.code+' '+it.sku+' '+(it.title||'')).toLowerCase().includes(q));
  if (e.target.checked) list.forEach(it=>impSelectedSkus.add(it.sku));
  else list.forEach(it=>impSelectedSkus.delete(it.sku));
  renderImpItems();
});
document.getElementById('impBulkAssignSel').addEventListener('change', e=>{
  if (!e.target.value) return;
  impBulkAssign(e.target.value);
  e.target.value='';
});
document.getElementById('impBulkBtnNA').onclick=impBulkSendNA;
document.getElementById('impBulkBtnClear').onclick=()=>{ impSelectedSkus.clear(); renderImpItems(); };

function openSnap(prefill=null) {
  editIdx = null;
  const fd0 = document.getElementById('fDate'); if (fd0) { fd0.readOnly = false; fd0.title = ''; }
  const today = new Date().toLocaleDateString('en-CA');
  document.getElementById('snapModalTitle').textContent = 'Add Snapshot';
  
  // Clear all fields
  ['fAsins','fSkus','fUnits','fStockValue','fInboundUnits','fInboundValue','fA0','fA31','fA61','fA91','fA181','fA271','fA365','fRepTotal','fRepWinNum','fRepWinPct','fRepMatchNum','fRepMatchPct','fNotes'].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=''; });
  document.getElementById('fDate').value = today;
  document.getElementById('fCost').value='';
  document.getElementById('fCostDisplay').textContent='—';
  document.getElementById('fCostCalc').textContent='';
  
  // Check if today already logged
  const alreadyLogged = DB.find(s => s.date === today);
  if (alreadyLogged) {
    alert(`⚠ Already logged today (${fmt(today)}). You can edit the existing snapshot or enter a different date.`);
  }
  
  if (prefill) fillForm(prefill);
  document.getElementById('impStatUnres').style.display='';
  document.getElementById('impGate').style.display='';
  impResetModalState();
  ageReset();
  document.getElementById('snapModal').classList.add('open');
  { const m = document.querySelector('#snapModal .modal'); if (m) m.scrollTop = 0; }   // Edit opened wherever the last form was left (often the bottom)
}

function editSnap(idx) {
  editIdx = idx;
  const s = DB[idx];
  document.getElementById('snapModalTitle').textContent = 'Edit Snapshot';
  fillForm(s);
  // Changing the date here used to save a second copy (and could overwrite a different day).
  const fd = document.getElementById('fDate'); if (fd) { fd.readOnly = false; fd.title = 'Change the date to move this entry — its provider figures and SKU detail move with it'; }
  document.getElementById('impStatUnres').style.display='';
  document.getElementById('impGate').style.display='';
  impResetModalState();
  impShowExistingSummary(s.date);
  ageReset();
  const savedVal = s.ageingValue;
  const hasSavedVal = savedVal && Object.values(savedVal).some(v=>v>0);
  if (hasSavedVal){
    document.getElementById('ageLoadedWrap').style.display='';
    document.getElementById('ageDrop').style.display='none';
    document.getElementById('ageLoadedName').textContent='saved snapshot (not re-imported)';
    document.getElementById('ageSkuCount').textContent='—';
    const errEl=document.getElementById('ageErrSpan');
    if (errEl) errEl.textContent=' · valuation already saved, shown per bucket below';
    AGE_BUCKET_COLS.forEach(b=>{
      const key=b.field.replace('fA','a');
      const el=document.getElementById('ageVal'+b.field.replace('f',''));
      if (el) el.textContent = (savedVal[key]||0)>0 ? '£'+savedVal[key].toLocaleString(undefined,{maximumFractionDigits:2}) : '';
    });
  }
  document.getElementById('snapModal').classList.add('open');
  { const m = document.querySelector('#snapModal .modal'); if (m) m.scrollTop = 0; }   // Edit opened wherever the last form was left (often the bottom)
}

function fillForm(s) {
  document.getElementById('fDate').value = s.date||'';
  document.getElementById('fAsins').value = s.asins||'';
  document.getElementById('fSkus').value = s.skus||'';
  document.getElementById('fUnits').value = s.totalUnits||'';
  document.getElementById('fStockValue').value = s.stockValue||'';
  // Inbound is null when never captured and 0 when genuinely nothing is in transit —
  // only null should leave the box empty.
  document.getElementById('fInboundUnits').value = s.inboundUnits==null ? '' : s.inboundUnits;
  document.getElementById('fInboundValue').value = s.inboundValue==null ? '' : s.inboundValue;
  document.getElementById('fCost').value = s.avgCost||'';
  if (s.avgCost) {
    document.getElementById('fCostDisplay').textContent = '£' + parseFloat(s.avgCost).toFixed(2);
    document.getElementById('fCostCalc').textContent = s.stockValue ? `£${s.stockValue} ÷ ${s.totalUnits} units` : '';
  }
  const ag = s.ageing||{};
  document.getElementById('fA0').value=ag.a0||'';
  document.getElementById('fA31').value=ag.a31||'';
  document.getElementById('fA61').value=ag.a61||'';
  document.getElementById('fA91').value=ag.a91||'';
  document.getElementById('fA181').value=ag.a181||'';
  document.getElementById('fA271').value=ag.a271||'';
  document.getElementById('fA365').value=ag.a365||'';
  const r = s.repricer||{};
  document.getElementById('fRepTotal').value=r.total||'';
  document.getElementById('fRepWinNum').value=r.winning||'';
  document.getElementById('fRepWinPct').value=r.winPct||'';
  document.getElementById('fRepMatchNum').value=r.matching||'';
  document.getElementById('fRepMatchPct').value=r.matchPct||'';
  document.getElementById('fNotes').value=s.notes||'';
}

async function saveSnap() {
  // A second click while the first save is still running would push a duplicate row and
  // open a second progress popup.
  if (SAVE_IN_FLIGHT) return;
  const date = document.getElementById('fDate').value;
  if (!date) { alert('Please set a date'); return; }
  // Moving an entry to another date (e.g. the file came a day late). It used to save a second copy
  // and could overwrite another day; now it moves the entry and everything saved with it.
  const oldDate = editIdx !== null && DB[editIdx] ? DB[editIdx].date : null;
  const moving = !!oldDate && oldDate !== date;
  if (moving) {
    if (DB.some((d, i) => i !== editIdx && d.date === date)) { alert(`There's already an entry for ${fmt(date)}.\n\nTwo entries can't share a date — delete or edit that one first.`); return; }
    if (!confirm(`Move this entry from ${fmt(oldDate)} to ${fmt(date)}?\n\nIts provider figures and saved SKU detail move with it. Competitor fetches aren't touched.`)) return;
  }
  if (impHasImport && impComputed && impComputed.unresolved>0) {
    alert(`⚠ ${impComputed.unresolved} SKU(s) still need a provider. Assign them or send the remainder to N/A before saving.`);
    return;
  }
  const units = +document.getElementById('fUnits').value||0;
  const stockValue = +document.getElementById('fStockValue').value||0;
  const avgCost = units > 0 && stockValue > 0 ? +(stockValue/units).toFixed(2) : (+document.getElementById('fCost').value||0);
  
  // Blank stays null (never captured); a typed 0 is a real reading (nothing in transit).
  const inbUnitsRaw = document.getElementById('fInboundUnits').value.trim();
  const inbValueRaw = document.getElementById('fInboundValue').value.trim();
  const inboundUnits = inbUnitsRaw === '' ? null : (+inbUnitsRaw || 0);
  const inboundValue = inbValueRaw === '' ? null : (+inbValueRaw || 0);

  const repTotal = +document.getElementById('fRepTotal').value||0;
  const repWinNum = +document.getElementById('fRepWinNum').value||0;
  const repWinPct = +document.getElementById('fRepWinPct').value||0;
  const repMatchNum = +document.getElementById('fRepMatchNum').value||0;
  const repMatchPct = +document.getElementById('fRepMatchPct').value||0;
  
  const s = {
    date,
    asins: +document.getElementById('fAsins').value||0,
    skus: +document.getElementById('fSkus').value||0,
    avgCost,
    stockValue,
    totalUnits: units,
    inboundUnits,
    inboundValue,
    ageing: { a0:+document.getElementById('fA0').value||0, a31:+document.getElementById('fA31').value||0, a61:+document.getElementById('fA61').value||0, a91:+document.getElementById('fA91').value||0, a181:+document.getElementById('fA181').value||0, a271:+document.getElementById('fA271').value||0, a365:+document.getElementById('fA365').value||0 },
    ageingValue: ageHasValuation ? {...ageValuation} : (editIdx!==null ? (DB[editIdx]?.ageingValue || {a0:0,a31:0,a61:0,a91:0,a181:0,a271:0,a365:0}) : {a0:0,a31:0,a61:0,a91:0,a181:0,a271:0,a365:0}),
    // Only from a file that actually carried an ASIN column. Typing the buckets by hand
    // leaves this null, and editing an old snapshot keeps whatever it already had.
    ageingAsin: ageHasAsins
      ? { a0:ageAsinCounts.fA0||0, a31:ageAsinCounts.fA31||0, a61:ageAsinCounts.fA61||0, a91:ageAsinCounts.fA91||0,
          a181:ageAsinCounts.fA181||0, a271:ageAsinCounts.fA271||0, a365:ageAsinCounts.fA365||0 }
      : (editIdx!==null ? (DB[editIdx]?.ageingAsin || null) : null),
    repricer: { total: repTotal, winning: repWinNum, winPct: repWinPct, matching: repMatchNum, matchPct: repMatchPct },
    notes: document.getElementById('fNotes').value,
  };
  // Keep the pre-save state so a failed sync can be rolled back cleanly — otherwise pressing
  // Save again after a failure would append a second copy of the same date.
  const prevDB = DB.slice();
  const prevProviderSnapshots = PROVIDER_SNAPSHOTS.slice();

  if (editIdx !== null) DB[editIdx] = s;
  else { DB.push(s); DB.sort((a,b)=>a.date.localeCompare(b.date)); }

  // ── Providers for this date ──
  // If a file was imported this session, its classified counts become the new saved counts for the date.
  // If editing without re-importing, the previously saved counts are left untouched.
  let provRows;
  if (impHasImport && impComputed) {
    provRows = impComputed.providerCounts.map(p => ({ date, provider: p.name, skus: p.count, value: p.value||0, notes: '' }));
  } else {
    // moving without a new file: the old date's provider figures come along
    provRows = moving ? PROVIDER_SNAPSHOTS.filter(p => p.date === oldDate).map(p => ({ ...p, date })) : PROVIDER_SNAPSHOTS.filter(p => p.date === date);
  }
  const prevForDate = PROVIDER_SNAPSHOTS.filter(p => p.date === date);
  const removedProviders = prevForDate.filter(p => !provRows.find(n => n.provider.toLowerCase() === p.provider.toLowerCase()));
  PROVIDER_SNAPSHOTS = PROVIDER_SNAPSHOTS.filter(p => p.date !== date && !(moving && p.date === oldDate)).concat(provRows);

  // The columns may not be migrated yet. Saving would then quietly drop these two numbers
  // while every tick still went green — exactly the silent-loss pattern this app already
  // suffered once. Say so BEFORE writing, and let the entry be kept rather than lost.
  if ((inboundUnits !== null || inboundValue !== null) && window._hasInboundCols !== true) {
    const goOn = confirm(
      '\u26A0 Inbound cannot be saved yet.\n\n' +
      'The database is missing the two inbound columns, so the inbound figures you entered ' +
      'would NOT be stored \u2014 everything else would save normally.\n\n' +
      'OK = save the snapshot WITHOUT the inbound figures.\n' +
      'Cancel = stop, so nothing is lost (ask Jack to run the database migration first).'
    );
    if (!goOn) { DB = prevDB; PROVIDER_SNAPSHOTS = prevProviderSnapshots; return; }
  }

  svOpen(date);
  const saveOk = await persist(svOnStep, true);
  if (!saveOk) {
    // The write did not reach Supabase. Nothing is stored locally, so roll back the optimistic
    // change and leave the form open with the entry intact — rather than closing it and letting
    // the row look saved until the next refresh makes it vanish.
    DB = prevDB;
    PROVIDER_SNAPSHOTS = prevProviderSnapshots;
    renderAll(); renderHistory();
    svFailure(LAST_SAVE_ERRORS);
    return;
  }
  // Each SKU's band for this date — only from a file dropped this time, never from typed numbers.
  // A failure here leaves the snapshot itself saved; Stock Health just can't show exact movement.
  if (ageSkuRows.length && window._snapSkusSave) {
    if (impSkuProv.size) ageSkuRows.forEach(r => { const pv = impSkuProv.get(r[0]); if (pv) r[7] = pv; });   // [7] = provider at import
    const sk = await window._snapSkusSave(date, ageSkuRows);
    if (sk.ok) { SNAP_SKUS[date] = ageSkuRows.slice(); SNAP_SKU_DATES.add(date); }
  }
  // remove provider rows the user deleted for this date
  for (const r of removedProviders) {
    try { await window._supabaseDeleteProvider(date, r.provider); } catch(e){ console.error(e); }
  }
  // finish a move: carry the SKU detail across (unless a new file was dropped), then remove the old
  // date's entry with its provider figures and SKU detail
  if (moving) {
    if (!ageSkuRows.length && window._snapSkusMove) {
      const mv = await window._snapSkusMove(oldDate, date);
      if (mv && SNAP_SKUS[oldDate]) SNAP_SKUS[date] = SNAP_SKUS[oldDate];
      if (mv && SNAP_SKU_DATES.has(oldDate)) SNAP_SKU_DATES.add(date);
    }
    const gone = window._supabaseDeleteSnapshot ? await window._supabaseDeleteSnapshot(oldDate) : false;
    delete SNAP_SKUS[oldDate]; SNAP_SKU_DATES.delete(oldDate);
    if (!gone) alert(`⚠ Saved under ${fmt(date)}, but the old ${fmt(oldDate)} entry couldn't be removed — delete it from History.`);
  }

  // Auto-register provider names: re-logging an archived provider un-archives it; brand-new names append to the active list
  const known = new Set([...PROVIDER_DEFS, ...ARCHIVED_PROVIDERS].map(n => n.toLowerCase()));
  let newDefs = false;
  provRows.forEach(r => {
    const low = r.provider.toLowerCase();
    if (ARCHIVED_PROVIDERS.some(n => n.toLowerCase() === low)) {
      ARCHIVED_PROVIDERS = ARCHIVED_PROVIDERS.filter(n => n.toLowerCase() !== low);
      PROVIDER_DEFS.push(r.provider); newDefs = true;
    } else if (!known.has(low)) {
      known.add(low); PROVIDER_DEFS.push(r.provider); newDefs = true;
    }
  });
  if (newDefs) { try { await window._supabaseSaveProviderDefs(PROVIDER_DEFS, ARCHIVED_PROVIDERS); } catch(e){ console.error(e); } }

  // Auto-refresh from Supabase — this is also the read-back that proves the row is really
  // stored. If the row isn't in the reloaded data, the save reported success but didn't stick.
  let verified = false;
  try {
    const data = await window._supabaseLoad();
    if (data) {
      DB = data.snapshots || [];
      DB.sort((a,b) => a.date.localeCompare(b.date));
      PROVIDER_SNAPSHOTS = data.providerSnapshots || [];
      PROVIDER_DEFS = data.providerDefs || [];
      ARCHIVED_PROVIDERS = data.providerArchived || [];
      PROVIDER_RULES = data.providerRules || [];
      verified = DB.some(x => x.date === date);
    } else {
      console.error('Read-back failed — could not confirm the save');
    }
  } catch (err) {
    console.error('Read-back failed:', err);
  }

  if (!verified) {
    // The write reported success but the row is not in the database. Keep the form open.
    DB = prevDB;
    PROVIDER_SNAPSHOTS = prevProviderSnapshots;
    renderAll(); renderHistory();
    svStep('verify', 'fail');
    svFailure(['The snapshot was sent but could not be found in the database afterwards.']);
    return;
  }

  closeOverlay('snapModal');
  closeOverlay('impModal');
  impHasImport = false;

  renderAll();
  renderHistory();
  renderProviderTab();
  renderSettingsTab();

  const provForDate = PROVIDER_SNAPSHOTS.filter(p => p.date === date).length;
  svStep('verify', 'done', 'row found in database');
  await svSuccess(date, `${DB.length} snapshots on record${provForDate ? ` · ${provForDate} providers this date` : ''}`);
}

async function deleteSnap(idx) {
  if (idx == null || idx < 0 || idx >= DB.length) return;
  const removed = DB[idx];
  if (!confirm(`Delete the ${fmt(removed.date)} snapshot?\n\n${(removed.skus||0).toLocaleString()} SKUs · ${fmtGBP(removed.stockValue||0)} stock value.\nIts provider figures and saved SKU detail for that date go too.\n\nThis can't be undone.`)) return;
  DB.splice(idx,1);
  renderAll(); renderHistory();           // update the UI instantly (optimistic)
  if (removed && removed.date && window._supabaseDeleteSnapshot) {
    showSyncStatus('loading');
    const ok = await window._supabaseDeleteSnapshot(removed.date);   // only deletes that one row
    if (!ok) {
      // Put it back — the row is still in the database, so leaving the screen without it
      // would just have it reappear on the next refresh.
      DB.splice(idx, 0, removed);
      renderAll(); renderHistory();
      showSyncStatus('error');
      alert(`⚠ Could not delete the snapshot for ${fmt(removed.date)}.\n\nIt is still in the database — nothing was removed. Check your internet connection and try again.`);
      return;
    }
    // the database dropped this date's provider figures and SKU detail too — keep the page in step
    PROVIDER_SNAPSHOTS = PROVIDER_SNAPSHOTS.filter(p => p.date !== removed.date);
    delete SNAP_SKUS[removed.date]; SNAP_SKU_DATES.delete(removed.date);
    renderAll(); renderHistory();
    showSyncStatus('saved');
    if (typeof showToast === 'function') showToast(`✓ Deleted the ${fmt(removed.date)} snapshot`);
    setTimeout(() => showSyncStatus(''), 1500);
  }
}

function destroyChart(id) { if(chartInstances[id]){chartInstances[id].destroy();delete chartInstances[id];} }

function chartOpts() {
  return {
    responsive:true, maintainAspectRatio:false,
    plugins:{ legend:{ position:'top', labels:{ boxWidth:10, padding:16, color:'#a7b4c4', font:{family:'Inter',size:11} } }, tooltip:{ backgroundColor:'#1c2330', titleFont:{family:'Inter',size:11}, bodyFont:{family:'Inter',size:11}, borderColor:'#2a3545', borderWidth:1 } },
    scales:{ x:{ grid:{color:'#1c2330'}, ticks:{color:'#8b99ab',font:{family:'Inter',size:11}} }, y:{ grid:{color:'#1c2330'}, ticks:{color:'#8b99ab',font:{family:'Inter',size:11}}, beginAtZero:false } }
  };
}

function fmt(d) { if(!d)return''; const[y,m,day]=d.split('-'); return `${day}/${m}/${y}`; }
function fmtShort(d) { if(!d)return''; const[y,m,day]=d.split('-'); return `${day}/${m}`; }

// Get comparison snapshots for detailed analysis

function closeOverlay(id) { document.getElementById(id).classList.remove('open'); }

// Prevent closing modal when clicking inside it - only close on background click or explicit buttons
// Overlays with data-no-dismiss="true" are exempt — they can only be closed by explicit buttons
document.querySelectorAll('.overlay').forEach(overlay => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay && overlay.dataset.noDismiss !== 'true') {
      overlay.classList.remove('open');
    }
  });
});

function updateLastUpdated() {
  const el = document.getElementById('lastUpdatedDisplay');
  if (!el) return;
  
  const currentTab = document.querySelector('.tab-page.active')?.id || 'tab-overview';
  let latestSnap = null;
  
  if (currentTab === 'tab-repricer') {
    // Show latest repricer snapshot with data
    latestSnap = DB.filter(s => s.repricer && s.repricer.total).reverse()[0];
  } else if (currentTab === 'tab-competitors' || currentTab === 'tab-comp-history') {
    // Show latest competitor session (not from snapshots)
    const latestSession = COMPETITOR_SESSIONS.length > 0 ? COMPETITOR_SESSIONS[COMPETITOR_SESSIONS.length - 1] : null;
    if (latestSession) {
      el.textContent = 'Last updated: ' + fmt(latestSession.date);
      return;
    } else {
      el.textContent = 'Last updated: —';
      return;
    }
  } else {
    // Default: show latest snapshot overall
    latestSnap = DB.length > 0 ? DB[DB.length - 1] : null;
  }
  
  if (latestSnap) {
    el.textContent = 'Last updated: ' + fmt(latestSnap.date);
  } else {
    el.textContent = 'Last updated: —';
  }
}

