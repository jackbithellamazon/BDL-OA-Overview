// Fetch by fetch, on the same measure as the Competitors page: how many of their products you were on,
// what moved since the fetch before (and why), and how the rivals split. Fetches from before the leads
// were saved (before 20 Aug) only have Keepa's own % — they are listed underneath, labelled as such.
function renderCompHistory() {
  const search = (document.getElementById('compHistSearch')?.value || '').toLowerCase().trim();
  const hFrom = document.getElementById('compHistFrom')?.value || '';
  const hTo = document.getElementById('compHistTo')?.value || '';
  const container = document.getElementById('compHistoryContainer');
  if (!container) return;
  const navComp = () => [...document.querySelectorAll('.nav-item')].find(n => (n.getAttribute('onclick')||'').includes("'competitors'"));
  const tracked = new Set((SELLERS||[]).map(s => s.sellerId).filter(Boolean));
  const nameOf = {}; (SELLERS||[]).forEach(s => { if (s.sellerId) nameOf[s.sellerId] = s.name; });
  COMPETITOR_SESSIONS.forEach(x => (x.competitors||[]).forEach(c => { if (c.sellerId && !nameOf[c.sellerId]) nameOf[c.sellerId] = (c.name||'').trim(); }));
  const ad = Object.keys(COMPETITOR_ASINS||{}).sort();
  const ids = d => Object.keys(COMPETITOR_ASINS[d]).filter(id => !tracked.size || tracked.has(id));
  const onOf = (d, id) => (COMPETITOR_ASINS[d][id].asins || []).length;
  const uni = (d, list) => { const s = new Set(); list.forEach(id => (COMPETITOR_ASINS[d][id].asins || []).forEach(a => s.add(a))); return s.size; };
  const shelfFrom = window._shelfWindowFrom || '9999';
  const firstSeen = {};   // new leads spotted on each fetch, each product once (only inside the saved-shelf window)
  (SHELF_ROWS || []).forEach(r => { if (!r.baseline) (firstSeen[r.first_seen] = firstSeen[r.first_seen] || new Set()).add(r.asin); });
  let rows = ad.map((d, i) => {
    const P = i ? ad[i - 1] : null, list = ids(d), both = P ? list.filter(id => COMPETITOR_ASINS[P][id]) : [];
    const u = uni(d, list), uLfl = P ? uni(d, both) - uni(P, both) : null;
    let up = 0, down = 0, same = 0;
    both.forEach(id => { const x = onOf(d, id) - onOf(P, id); if (x > 0) up++; else if (x < 0) down++; else same++; });
    const added = P ? list.filter(id => !COMPETITOR_ASINS[P][id]).length : 0;
    const gap = P ? Math.round((_ldDay(d) - _ldDay(P)) / 864e5) : null;
    const split = P && P >= shelfFrom && typeof ldSplit === 'function' ? ldSplit(P, d) : null;
    // same count as the Competitors page: products they added that you're not on
    const onAll = new Set(); list.forEach(id => (COMPETITOR_ASINS[d][id].asins || []).forEach(a => onAll.add(a)));
    const spotted = d >= shelfFrom && firstSeen[d] ? [...firstSeen[d]].filter(a => !onAll.has(a)).length : null;
    return { d, P, list, u, net: uLfl, up, down, same, added, gap, split, spotted };
  }).reverse();
  if (hFrom) rows = rows.filter(r => r.d >= hFrom);
  if (hTo) rows = rows.filter(r => r.d <= hTo);
  if (search) rows = rows.filter(r => r.list.some(id => (nameOf[id]||'').toLowerCase().includes(search) || id.toLowerCase().includes(search)));
  const oldSessions = [...COMPETITOR_SESSIONS].filter(x => !COMPETITOR_ASINS[x.date] && (x.competitors||[]).length).sort((a,b) => b.date.localeCompare(a.date))
    .filter(x => (!hFrom || x.date >= hFrom) && (!hTo || x.date <= hTo));
  document.getElementById('compHistCount').textContent = `${rows.length} fetches with leads${oldSessions.length ? ` · ${oldSessions.length} older Keepa-% only` : ''}`;
  if (!rows.length && !oldSessions.length) {
    container.innerHTML = '<div style="text-align:center;padding:48px;color:var(--muted);font-size:12px">No competitor fetches yet. Use Fetch from Keepa on the Competitors page.</div>';
    return;
  }
  const chg = n => n == null ? '<span class="chh-chg na">first</span>' : !n ? '<span class="chh-chg flat">no change</span>'
    : `<span class="chh-chg ${n > 0 ? 'up' : 'down'}">${n > 0 ? '▲' : '▼'} ${Math.abs(n)}</span>`;
  const why = x => { if (!x) return '<span class="chh-mute">split shows for recent fetches only</span>';
    const bits = [[x.newToYou + x.back + x.gotOn, 'g', 'you got on'], [x.rivalsAdded, 'g', 'they started one you sell'], [x.soldOut, 'r', 'you sold out'], [x.rivalsDropped, 'r', 'they dropped one you sell']].filter(b => b[0]);
    return bits.length ? bits.map(b => `<span class="chh-${b[1]}">${b[1] === 'g' ? '+' : '−'}${b[0]}</span> ${b[2]}`).join(' · ') : 'nothing moved'; };
  let html = `<div class="chh-note">Each fetch on the same measure as the Competitors page: <b>their products you're on</b>, what moved since the fetch before, and how many rivals moved each way.
      <span onclick="switchTab('competitors', (${navComp.toString()})())">Open Competitors ›</span></div>
    <div class="chh-table"><div class="chh-head"><span>Fetch</span><span>Their products you're on</span><span>Why it moved</span><span>Rivals vs the fetch before</span><span class="r">New leads spotted</span><span></span></div>`;
  rows.forEach(r => {
    const det = r.list.map(id => { const on = onOf(r.d, id), tot = COMPETITOR_ASINS[r.d][id].size, pv = r.P && COMPETITOR_ASINS[r.P][id] ? onOf(r.P, id) : null;
      return { id, name: nameOf[id] || id, on, tot, d: pv == null ? null : on - pv }; }).sort((a, b) => (b.d ?? -1e9) - (a.d ?? -1e9) || b.on - a.on);
    html += `<div class="chh-row" onclick="this.classList.toggle('open')">
      <div class="chh-date"><b>${fmt(r.d)}</b><span>${r.gap == null ? 'first fetch with leads' : r.gap > 3 ? `<em>${r.gap} days after the last</em>` : `${r.gap} day${r.gap !== 1 ? 's' : ''} after the last`}</span></div>
      <div class="chh-on"><b>${r.u.toLocaleString()}</b>${chg(r.net)}<span class="chh-sub">${r.list.length} rivals${r.added ? ` · <i>+${r.added} added</i>` : ''}</span></div>
      <div class="chh-why">${r.P ? why(r.split) : ''}</div>
      <div class="chh-riv">${r.P ? `<span class="chh-g">▲ ${r.up}</span> more · <span class="chh-r">▼ ${r.down}</span> fewer · <span class="chh-b">● ${r.same}</span> same` : ''}</div>
      <div class="chh-new r">${r.spotted != null ? `<b>${r.spotted.toLocaleString()}</b>` : '<span class="chh-mute">—</span>'}</div>
      <div class="r"><button class="tbl-btn del" title="Delete this fetch" onclick="event.stopPropagation();deleteCompetitorSession('${r.d}')">✕</button></div>
      <div class="chh-det" onclick="event.stopPropagation()">${det.map(x => `<div class="chh-rv"><span class="chh-rvn">${kfEsc(x.name)}</span><span class="chh-rvo">${x.on} <em>of ${x.tot ?? '—'}</em></span>${x.d == null ? '<span class="chh-chg na">new</span>' : chg(x.d)}
        <span class="chh-link" onclick="LD_OPEN='${x.id.replace(/'/g, "\\'")}';switchTab('competitors', (${navComp.toString()})())">›</span></div>`).join('')}</div>
    </div>`;
  });
  html += '</div>';
  if (oldSessions.length) html += `<div class="chh-old"><div class="chh-old-h">Before 20 Aug · Keepa's own % only (their range you also sell) — kept for the record</div>
    ${oldSessions.map(x => { const c = (x.competitors||[]).filter(c => isFinite(c.pct)); const avg = c.length ? c.reduce((t, y) => t + y.pct, 0) / c.length : null;
      return `<div class="chh-oldr"><b>${fmt(x.date)}</b><span>${c.length} rivals · average ${avg != null ? avg.toFixed(1) + '%' : '—'}</span><button class="tbl-btn del" title="Delete this fetch" onclick="deleteCompetitorSession('${x.date}')">✕</button></div>`; }).join('')}</div>`;
  container.innerHTML = html;
}

function toggleCompSessionDetail(el, date) {
  const detail = el.querySelector('.comp-session-detail');
  if (detail) {
    detail.style.display = detail.style.display === 'none' ? 'block' : 'none';
  }
}

function viewCompetitorSession(date) {
  const session = COMPETITOR_SESSIONS.find(s => s.date === date);
  if (!session || !session.competitors.length) return;
  
  // Show modal or expanded view of that day's competitors
  let html = `<div style="padding:16px"><h3>${fmt(date)}</h3><table style="width:100%;border-collapse:collapse">`;
  html += '<tr style="border-bottom:1px solid var(--border)"><th style="text-align:left;padding:8px">Seller</th><th style="text-align:center;padding:8px">Overlap %</th></tr>';
  session.competitors.forEach(c => {
    html += `<tr style="border-bottom:1px solid rgba(31,40,54,.5)"><td style="padding:8px">${c.name}</td><td style="text-align:center;padding:8px;font-weight:600">${isFinite(c.pct)?c.pct.toFixed(1)+'%':'—'}</td></tr>`;
  });
  html += '</table></div>';
  
  // For now, just show as alert (better UX would be modal)
  alert(`Session for ${fmt(date)}:\n${session.competitors.map(c => `${c.name}: ${isFinite(c.pct)?c.pct.toFixed(1)+'%':'—'}`).join('\n')}`);
}

function setCompHistPreset(p, btn) {
  document.querySelectorAll('.history-controls .range-preset, .range-presets .range-preset').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const now = new Date();
  let from='', to='';
  if (p === '7d') {
    const d = new Date(now); d.setDate(d.getDate()-7);
    from = d.toLocaleDateString('en-CA'); to = now.toLocaleDateString('en-CA');
  } else if (p === 'month') {
    from = new Date(now.getFullYear(),now.getMonth(),1).toLocaleDateString('en-CA');
    to = now.toLocaleDateString('en-CA');
  } else if (p === 'all') {
    from = ''; to = '';
  }
  document.getElementById('compHistFrom').value = from;
  document.getElementById('compHistTo').value = to;
  renderCompHistory();
}

function clearCompHistFilters() {
  document.getElementById('compHistSearch').value = '';
  document.getElementById('compHistFrom').value = '';
  document.getElementById('compHistTo').value = '';
  document.querySelectorAll('.range-presets .range-preset').forEach(b => b.classList.remove('active'));
  renderCompHistory();
}

function renderHistory() {
  const search = document.getElementById('histSearch').value.toLowerCase();
  const hFrom = document.getElementById('histFrom').value;
  const hTo = document.getElementById('histTo').value;

  let snaps = [...DB].sort((a,b)=>b.date.localeCompare(a.date));
  // match notes, the date as shown, and the month name ("oct", "12/10")
  if (search) snaps = snaps.filter(s=>(s.notes||'').toLowerCase().includes(search) || fmt(s.date).includes(search)
    || new Date(s.date+'T00:00:00').toLocaleDateString('en-GB',{month:'long',year:'numeric'}).toLowerCase().includes(search));
  if (hFrom) snaps = snaps.filter(s=>s.date>=hFrom);
  if (hTo) snaps = snaps.filter(s=>s.date<=hTo);

  document.getElementById('histCount').textContent = `${snaps.length} of ${DB.length} snapshots`;
  document.getElementById('histNavBadge').textContent = DB.length;

  // Provider history table (always built; shown when histView==='providers')
  const provCount = renderProviderHistoryTable(search, hFrom, hTo);
  if (typeof histView !== 'undefined' && histView === 'providers') {
    document.getElementById('histCount').textContent = `${provCount} provider snapshots`;
  }

  const tbody = document.getElementById('histBody');
  if (!snaps.length) { tbody.innerHTML='<tr class="empty-row"><td colspan="13">No snapshots match your filters.</td></tr>'; return; }
  const asc = [...DB].sort((a,b)=>a.date.localeCompare(b.date));
  const provDates = new Set((PROVIDER_SNAPSHOTS||[]).map(p=>p.date));

  tbody.innerHTML = snaps.map(s => {
    const z = shZones(s), has = shBucketTotal(s) > 0, hv = shHasValuation(s), zv = hv ? shZoneValues(s) : null;
    const share = has ? shShare90(s, hv ? 'gbp' : 'sku') : null;
    const w = repPct(s,'win'), m = repPct(s,'match');
    const realIdx = DB.findIndex(d=>d.date===s.date && d.notes===s.notes);
    const i = asc.findIndex(x => x.date === s.date), before = i > 0 ? asc[i-1] : null;
    const gap = before ? Math.round((Date.parse(s.date) - Date.parse(before.date)) / 864e5) : null;
    const pill = (on, l, tip) => `<span title="${tip}${on ? '' : ' — not saved'}" style="display:inline-block;min-width:16px;text-align:center;font-size:10.5px;font-weight:700;padding:1px 4px;margin-right:2px;border-radius:4px;${on ? 'background:rgba(0,245,160,.14);color:var(--g)' : 'background:var(--s3);color:var(--muted)'}">${l}</span>`;
    const bb = v => v == null ? '<span style="color:var(--muted)">—</span>' : `<span style="color:${v >= BB_TARGET ? 'var(--g)' : v < 5 ? 'var(--r)' : 'var(--y)'}">${v.toFixed(1)}%</span>`;
    return `<tr>
      <td style="color:var(--g);white-space:nowrap">${fmt(s.date)}${s.notes ? ` <span title="${escapeHtmlImp(s.notes)}" style="color:var(--y);cursor:help">✎</span>` : ''}${gap != null ? `<div style="font-size:11px;color:${gap > 4 ? 'var(--o)' : 'var(--muted)'}">${gap} day${gap === 1 ? '' : 's'} after the last</div>` : ''}</td>
      <td>${s.stockValue ? fmtGBP(s.stockValue) : '—'}</td>
      <td>${s.skus||'—'}</td>
      <td>${s.asins||'—'}</td>
      <td>${s.totalUnits ? s.totalUnits.toLocaleString() : '—'}</td>
      <td>${s.avgCost?'£'+s.avgCost.toFixed(2):'—'}</td>
      <td style="color:${s.inboundUnits!=null ? 'var(--b)' : 'var(--muted2)'};white-space:nowrap">${s.inboundUnits==null?'—':s.inboundUnits.toLocaleString()+' units'}${s.inboundValue!=null?`<div style="font-size:11px">${fmtGBP(s.inboundValue)}</div>`:''}</td>
      <td style="color:${share==null?'var(--muted2)':shZoneColor(share)};font-weight:700">${share==null?'—':share.toFixed(1)+'%'}${share!=null?`<div style="font-size:11px;font-weight:400;color:var(--muted)">${hv?'by £':'by SKUs'}</div>`:''}</td>
      <td style="white-space:nowrap">${!has?'—':zv?fmtGBP(zv.caution+zv.action):'—'}${has?`<div style="font-size:11px;color:var(--muted)">${z.caution+z.action} SKUs</div>`:''}</td>
      <td style="color:${z.action>0?'var(--o)':'var(--muted2)'};white-space:nowrap">${has?z.action+' SKUs':'—'}${zv&&zv.action?`<div style="font-size:11px">${fmtGBP(zv.action)}</div>`:''}</td>
      <td style="white-space:nowrap">${bb(w)} · ${bb(m)}</td>
      <td style="white-space:nowrap">${pill(provDates.has(s.date),'P','Provider split')}${pill(hv,'£','Ageing values')}${pill(!!s.ageingAsin,'A','ASIN ageing')}${pill(SNAP_SKU_DATES.has(s.date),'S','Each SKU (for exact movement on Stock Health)')}</td>
      <td><div class="tbl-actions">
        <button class="tbl-btn" onclick="editSnap(${realIdx})">Edit</button>
        <button class="tbl-btn del" onclick="deleteSnap(${realIdx})">Delete</button>
      </div></td>
    </tr>`;
  }).join('');
}

function clearHistFilters() {
  document.getElementById('histSearch').value='';
  document.getElementById('histFrom').value='';
  document.getElementById('histTo').value='';
  document.querySelectorAll('.history-controls .range-preset').forEach(b=>b.classList.remove('active'));
  renderHistory();
}

function setHistPreset(p, btn) {
  document.querySelectorAll('.history-controls .range-preset').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  const now = new Date();
  let from='', to='';
  if (p==='7d') {
    const d = new Date(now); d.setDate(d.getDate()-7);
    from = d.toLocaleDateString('en-CA'); to = now.toLocaleDateString('en-CA');
  } else if (p==='month') {
    from = new Date(now.getFullYear(),now.getMonth(),1).toLocaleDateString('en-CA');
    to = now.toLocaleDateString('en-CA');
  } else if (p==='lastmonth') {
    const d = new Date(now.getFullYear(),now.getMonth()-1,1);
    const d2 = new Date(now.getFullYear(),now.getMonth(),0);
    from = d.toLocaleDateString('en-CA'); to = d2.toLocaleDateString('en-CA');
  } else if (p==='90d') {
    const d = new Date(now); d.setDate(d.getDate()-90);
    from = d.toLocaleDateString('en-CA'); to = now.toLocaleDateString('en-CA');
  }
  document.getElementById('histFrom').value=from;
  document.getElementById('histTo').value=to;
  renderHistory();
}

function calcAvgCost() {
  const units = +document.getElementById('fUnits').value||0;
  const val = +document.getElementById('fStockValue').value||0;
  const disp = document.getElementById('fCostDisplay');
  const calc = document.getElementById('fCostCalc');
  const hidden = document.getElementById('fCost');
  if (units > 0 && val > 0) {
    const avg = (val/units).toFixed(2);
    disp.textContent = '£' + avg;
    calc.textContent = '£'+val.toLocaleString()+' ÷ '+units+' units';
    hidden.value = avg;
  } else {
    disp.textContent = '—';
    calc.textContent = units>0||val>0 ? 'Enter both fields' : '';
    hidden.value = '';
  }
}

let manageRowCount = 0;

