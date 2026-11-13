
// Track window size for repricer chart
let repWindowSize = 6;

function setRepWindow(n, btn) {
  repWindowSize = n;
  document.querySelectorAll('.rep-tog').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const snaps = filteredSnaps();
  renderRepricerPercentChart(snaps);
}

function repHealthLabel(val) {
  if (val < 5) return { text: '⚠ Under 5% — close to invisible', cls: 'rep-health-red' };
  if (val < BB_TARGET) return { text: `● Under your ${BB_TARGET}% target`, cls: 'rep-health-amber' };
  return { text: `✓ At or above your ${BB_TARGET}% target`, cls: 'rep-health-green' };
}

function repGetTrend(snaps, getter, n) {
  // Get trend from last n data points
  const pts = snaps.slice(-n).map(getter).filter(v => v !== null && v !== undefined && !isNaN(v));
  if (pts.length < 2) return 0;
  return pts[pts.length - 1] - pts[0];
}

function renderRepricerTab(snaps) {
  const c = document.getElementById('repricerContainer');
  if (!c) return;

  if (!snaps.length) {
    c.innerHTML = `<div id="repTool" style="margin-bottom:18px"></div><div style="text-align:center;padding:40px 20px;color:var(--muted2);font-family:var(--mono)">Add snapshots to see Buy Box performance.</div>`;
    if (typeof renderRepTool === 'function') renderRepTool();
    return;
  }

  // the newest entry that actually has repricer figures — an entry saved without them must not
  // read as "both metrics critically low"
  const withRep = snaps.filter(s => s.repricer && (s.repricer.total > 0 || repPct(s,'win') != null));
  if (!withRep.length) { window.REP_BB = null; c.innerHTML = `<div id="repTool" style="margin-bottom:18px"></div><div style="text-align:center;padding:40px 20px;color:var(--muted2);font-family:var(--mono)">No Buy Box figures in this date range.</div>`; if (typeof renderRepTool === 'function') renderRepTool(); return; }
  const latest = withRep[withRep.length-1];
  const prev   = withRep.length > 1 ? withRep[withRep.length-2] : null;
  const r      = latest.repricer || {};
  const prevR  = prev?.repricer || {};
  // better/worse like the rest of the app: last week's entries averaged vs two weeks before
  const tWin2 = kpiTrend2w(s => repPct(s,'win')), tMatch2 = kpiTrend2w(s => repPct(s,'match'));
  const tWinN2 = kpiTrend2w(s => s.repricer?.winning ?? null), tMatchN2 = kpiTrend2w(s => s.repricer?.matching ?? null);

  // ── Compute metrics ──────────────────────────────────────────────────
  const wPct  = repPct(latest,'win') ?? 0;
  const mPct  = repPct(latest,'match') ?? 0;
  const wSkus = r.winning  ?? null;
  const mSkus = r.matching ?? null;
  const tSkus = r.total    || 0;    // never borrow the inventory SKU count and call it "in repricer"

  const prevWPct  = repPct(prev,'win');
  const prevMPct  = repPct(prev,'match');
  const prevWSkus = prevR.winning  ?? null;
  const prevMSkus = prevR.matching ?? null;
  const prevTSkus = prevR.total    || null;

  const wDiff  = prevWPct  !== null ? +(wPct  - prevWPct).toFixed(1)  : null;
  const mDiff  = prevMPct  !== null ? +(mPct  - prevMPct).toFixed(1)  : null;
  const wsDiff = prevWSkus !== null && wSkus !== null ? wSkus - prevWSkus : null;
  const msDiff = prevMSkus !== null && mSkus !== null ? mSkus - prevMSkus : null;

  const repSnaps = snaps.filter(s => s.repricer && (s.repricer.total > 0 || s.repricer.winPct));
  const getWinV  = s => (repPct(s,'win')??0);
  const getMatchV= s => (repPct(s,'match')??0);
  const winTrend = tWin2 ? tWin2.d : null;     // 2-week averaged change, not a 3-entry wobble
  const mTrend   = tMatch2 ? tMatch2.d : null;

  const wH = repHealthLabel(wPct);
  const mH = repHealthLabel(mPct);

  // ── Helpers ──────────────────────────────────────────────────────────
  const MONO = "font-family:var(--mono)";
  const signed = (v, suffix='') => v == null ? '—' : (v>0?'+':v<0?'':'±')+v+suffix;
  const col    = (v, goodUp=true) => v == null ? 'var(--muted2)' : v===0 ? 'var(--muted2)' : (goodUp?v>0:'#00f5a0'===((v<0)?'var(--muted2)':'x')) ? '#00f5a0' : v > 0 ? (goodUp?'#00f5a0':'#ff4d6d') : (goodUp?'#ff4d6d':'#00f5a0');
  const gc     = (v, goodUp=true) => v==null||v===0?'var(--muted2)':goodUp?(v>0?'#00f5a0':'#ff4d6d'):(v>0?'#ff4d6d':'#00f5a0');
  const trendWord = t => t==null?null:t>=0.1?'BETTER · 2 WEEKS':t<=-0.1?'WORSE · 2 WEEKS':'FLAT · 2 WEEKS';
  const trendCol  = t => t==null?'var(--muted2)':t>=0.1?'#00f5a0':t<=-0.1?'#ff8c42':'var(--muted2)';
  const pill = (v, suffix, goodUp=true) => v==null?'':
    `<span style="${MONO};font-size:11px;font-weight:700;padding:3px 9px;border-radius:5px;background:${gc(v,goodUp)}22;color:${gc(v,goodUp)}">${v>0?'▲ +':v<0?'▼ ':'→ '}${Math.abs(v)}${suffix}</span>`;

  // ── Hero cards ─────────────────────────────────────────────────────
  const heroCard = (label, sub, pct, skuCount, pctDiff, skuDiff, colour, healthHtml, trend, verb, t2) => {
    const barW = Math.min(pct / (BB_TARGET * 2) * 100, 100);   // 0–20%: the target sits mid-bar
    const tWord = trendWord(trend);
    const tCol  = trendCol(trend);
    return `<div style="background:var(--s1);border:1px solid var(--border);border-top:3px solid ${colour};border-radius:14px;padding:20px 22px">
      <div style="${MONO};font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:${colour};margin-bottom:2px">${label}</div>
      <div style="${MONO};font-size:10px;color:var(--muted2);margin-bottom:12px">${sub}</div>
      <div style="display:flex;align-items:baseline;gap:14px;margin-bottom:12px">
        <div style="font-size:42px;font-weight:700;line-height:1;color:${colour}">${pct.toFixed(1)}%</div>
        <div>
          ${t2 ? pill(+t2.d.toFixed(1),'pp vs 2 wks') : pctDiff != null ? pill(pctDiff,'pp') : ''}
          ${pctDiff != null ? `<div style="${MONO};font-size:11px;color:var(--muted2);margin-top:4px">last entry ${pctDiff>0?'+':''}${pctDiff}pp</div>` : ''}
          <div style="${MONO};font-size:11px;margin-top:4px">${healthHtml}</div>
        </div>
      </div>
      <div style="height:10px;background:var(--s3);border-radius:5px;margin-bottom:6px;position:relative">
        <div style="position:absolute;left:0;top:0;bottom:0;width:${barW}%;background:${colour};border-radius:5px;transition:width .4s"></div>
        <div style="position:absolute;left:50%;top:-4px;bottom:-4px;width:2px;background:#ffd166"></div>
      </div>
      <div style="position:relative;height:16px;${MONO};font-size:11px;color:var(--muted2);margin-bottom:10px"><span>0%</span><span style="position:absolute;left:50%;transform:translateX(-50%);color:#ffd166">${BB_TARGET}% target</span><span style="position:absolute;right:0">${BB_TARGET*2}%</span></div>
      <div style="display:flex;align-items:center;justify-content:space-between;background:var(--s2);border:1px solid var(--border);border-radius:8px;padding:10px 14px">
        <div>
          <div style="${MONO};font-size:10px;color:var(--muted2)">SKUs ${verb}</div>
          <div style="font-size:22px;font-weight:700;color:var(--text);margin-top:2px">${skuCount ?? '—'}</div>
        </div>
        <div style="text-align:right">
          ${skuDiff != null ? `<div style="${MONO};font-size:14px;font-weight:700;color:${gc(skuDiff,true)}">${skuDiff>0?'+':''}${skuDiff} SKUs</div>` : ''}
          ${tWord ? `<div style="${MONO};font-size:10px;color:${tCol};margin-top:3px">${tWord}</div>` : ''}
        </div>
      </div>
    </div>`;
  };

  const winColour   = wPct >= 10 ? '#00f5a0' : wPct >= 5 ? '#ffd166' : '#ff4d6d';
  const matchColour = mPct >= 10 ? '#00f5a0' : mPct >= 5 ? '#ffd166' : '#ff4d6d';
  const winHealthHtml   = `<span style="color:${winColour}">${wH.text}</span>`;
  const matchHealthHtml = `<span style="color:${matchColour}">${mH.text}</span>`;

  // ── Top stats strip ───────────────────────────────────────────────
  const stat = (label, val, diff, goodUp=true) => `<div>
    <div style="${MONO};font-size:10px;color:var(--muted2);text-transform:uppercase;letter-spacing:.06em">${label}</div>
    <div style="font-size:22px;font-weight:700;color:var(--text);margin-top:3px">${val ?? '—'}</div>
    ${diff != null ? `<div style="${MONO};font-size:11px;font-weight:700;color:${gc(diff,goodUp)};margin-top:2px">${diff>0?'+':''}${diff} vs last</div>` : '<div style="height:18px"></div>'}
  </div>`;

  const skuDiff  = prevTSkus != null ? tSkus - prevTSkus : null;
  const asinDiff = prev?.asins != null ? (latest.asins||0) - prev.asins : null;

  // ── Trend history rows ────────────────────────────────────────────
  const buildHistory = (getter, label) => {
    if (repSnaps.length < 2) return '';
    const last6 = repSnaps.slice(-6);
    const moves = last6.slice(1).map((s,i) => ({
      date:s.date, diff:+(getter(s)-getter(last6[i])).toFixed(1)
    }));
    const net = +moves.reduce((s,m)=>s+m.diff,0).toFixed(1);
    const netCol = gc(net, true);
    const chain = moves.map(m=>{
      const d=m.date.split('-'); const lbl=`${d[2]}/${d[1]}`;
      const c2=gc(m.diff,true);
      return `<span style="${MONO};font-size:11px;color:${c2};white-space:nowrap">${lbl} <b>${m.diff>0?'+':''}${m.diff}pp</b></span>`;
    }).join(`<span style="color:var(--border2);margin:0 5px;font-size:10px">›</span>`);
    return `<div style="margin-top:12px;background:var(--s2);border:1px solid var(--border);border-radius:10px;padding:12px 14px">
      <div style="${MONO};font-size:10px;color:var(--muted2);margin-bottom:8px;text-transform:uppercase;letter-spacing:.06em">${label} — last ${moves.length} moves</div>
      <div style="display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-bottom:8px">${chain}</div>
      <div style="${MONO};font-size:11px;color:var(--muted2)">Net: <span style="color:${netCol};font-weight:700">${net>0?'+':''}${net}pp</span></div>
    </div>`;
  };

  // ── Insight row ───────────────────────────────────────────────────
  const insightRow = (diff, pct, label, trend) => {
    if (diff == null) return '';
    const c2 = gc(diff, true);
    const tWord2 = trendWord(trend); const tCol2 = trendCol(trend);
    // the call is made on the 2-week average; one entry moves ~1.7pp on a normal day
    const detail = trend == null ? (diff < 0 ? `Down to ${pct.toFixed(1)}% on the last entry.` : diff > 0 ? `Up to ${pct.toFixed(1)}% on the last entry.` : `Stable at ${pct.toFixed(1)}%.`)
      : trend <= -1 ? `Down ${Math.abs(trend).toFixed(1)}pp over 2 weeks (averaged) — a real drop, not one entry. Review floor prices.`
      : trend < -0.1 ? `Slipping over 2 weeks (averaged ${Math.abs(trend).toFixed(1)}pp lower) — watch it.`
      : trend >= 1 ? `Up ${trend.toFixed(1)}pp over 2 weeks (averaged) — repricing is working.`
      : trend > 0.1 ? `Edging up over 2 weeks (averaged +${trend.toFixed(1)}pp).`
      : `Flat over 2 weeks. The last entry moved ${diff>0?'+':''}${diff}pp, which is normal day-to-day noise.`;
    return `<div style="display:flex;align-items:flex-start;gap:12px;padding:12px 0;border-bottom:1px solid var(--border)">
      <div style="width:8px;height:8px;border-radius:50%;background:${c2};margin-top:4px;flex-shrink:0"></div>
      <div style="flex:1">
        <div style="${MONO};font-size:12px;font-weight:700;color:var(--text)">${label} ${diff>=0?'+':''}${diff}pp → now ${pct.toFixed(1)}%
          ${tWord2?`<span style="${MONO};font-size:10px;padding:2px 8px;border-radius:4px;margin-left:8px;background:${tCol2}22;color:${tCol2}">${tWord2}</span>`:''}
        </div>
        <div style="${MONO};font-size:11px;color:var(--muted2);margin-top:3px;line-height:1.5">${detail}</div>
      </div>
    </div>`;
  };

  // ── Recent entries table ──────────────────────────────────────────
  const last6 = repSnaps.slice(-6).reverse();
  const tableRows = last6.map((s,i) => {
    const isLatest = i===0;
    const wp = (repPct(s,'win')??0);
    const mp = (repPct(s,'match')??0);
    const ws = s.repricer.winning ?? '—';
    const ms = s.repricer.matching ?? '—';
    const ts = s.repricer.total || '—';
    const wc = wp>=10?'#00f5a0':wp>=5?'#ffd166':'#ff4d6d';
    const mc = mp>=10?'#00f5a0':mp>=5?'#ffd166':'#ff4d6d';
    return `<tr style="border-bottom:1px solid var(--border);background:${isLatest?'rgba(0,245,160,.04)':'transparent'}">
      <td style="padding:9px 12px;${MONO};font-size:11px;color:${isLatest?'var(--g)':'var(--muted2)'};font-weight:${isLatest?700:400}">${fmt(s.date)}${isLatest?' ◂':''}</td>
      <td style="padding:9px 10px;text-align:right;font-size:14px;font-weight:700;color:${wc}">${wp.toFixed(1)}%</td>
      <td style="padding:9px 10px;text-align:right;${MONO};font-size:13px;font-weight:700;color:var(--text)">${ws}</td>
      <td style="padding:9px 10px;text-align:right;font-size:14px;font-weight:700;color:${mc}">${mp.toFixed(1)}%</td>
      <td style="padding:9px 10px;text-align:right;${MONO};font-size:13px;font-weight:700;color:var(--text)">${ms}</td>
      <td style="padding:9px 10px;text-align:right;${MONO};font-size:12px;color:var(--muted2)">${ts}</td>
    </tr>`;
  }).join('');

  const th = label => `<th style="padding:7px 10px;text-align:right;${MONO};font-size:10px;color:var(--muted2);font-weight:500;text-transform:uppercase">${label}</th>`;

  // ── Warnings ─────────────────────────────────────────────────────
  const warnHtml = wPct < 5 && mPct < 5 && (r.total > 0 || repPct(latest,'win') != null)
    ? `<div style="background:rgba(255,77,109,.08);border:1px solid rgba(255,77,109,.3);border-radius:10px;padding:13px 16px;margin-bottom:16px;display:flex;align-items:center;gap:12px">
        <span style="font-size:18px">⚠</span>
        <div style="${MONO};font-size:12px;color:#ff4d6d;line-height:1.5"><b>Both metrics critically low.</b> Win and Match BB both under 5%. Listings are nearly invisible. Review all floor prices urgently.</div>
      </div>` : '';

  // ── Build HTML: the answer first ─────────────────────────────────────
  // Win BB is the question this page answers ("are you winning more Buy Boxes than two weeks ago?").
  // One colour per measure everywhere on the page: Win = green, Match = blue, neither = slate. The big
  // number alone is coloured by where it sits against your target.
  const WINC = '#00f5a0', MATCHC = '#3d9eff';
  const vW = tWin2 ? (tWin2.d >= 0.3 ? 'better' : tWin2.d <= -0.3 ? 'worse' : 'same') : 'same';
  const VC = { better:['▲ Winning more','#00f5a0'], worse:['▼ Winning less','#ff4d6d'], same:['● Holding steady','#3d9eff'] }[vW];
  const need = tSkus && wSkus != null ? Math.max(0, Math.ceil(tSkus * BB_TARGET / 100) - wSkus) : null;
  const neither = tSkus && wSkus != null && mSkus != null ? Math.max(0, tSkus - wSkus - mSkus) : null;
  // chart: every entry with repricer figures (up to 30), Win and Match lines, target, compared weeks shaded
  const pts = withRep.slice(-30).map(x => ({ d: x.date, w: repPct(x,'win'), m: repPct(x,'match') })).filter(x => x.w != null);
  let chart = '';
  if (pts.length > 1) {
    const W = 760, H = 216, PL = 40, PR = 40, PT = 24, PB = 26, day = d => Date.parse(d + 'T00:00:00Z');
    const x0 = day(pts[0].d), x1 = day(pts[pts.length-1].d), X = d => PL + (day(d) - x0) / Math.max(1, x1 - x0) * (W - PL - PR);
    const vals = pts.flatMap(p => [p.w, p.m]).filter(v => v != null).concat([BB_TARGET]);
    const ax = niceAxis(Math.max(0, Math.min(...vals) - 1), Math.max(...vals) + 1), Y = v => PT + (1 - (v - ax.min) / (ax.max - ax.min)) * (H - PT - PB);
    let g = '';
    const band = (list, col, lab) => { if (!list || !list.length) return; const a = X(list[0]) - 6, b = X(list[list.length-1]) + 6;
      if (b < PL) return; g += `<rect x="${Math.max(PL, a).toFixed(1)}" y="${PT}" width="${Math.max(12, b - Math.max(PL, a)).toFixed(1)}" height="${H-PT-PB}" rx="5" fill="${col}" opacity=".10"/><text x="${Math.min(W-PR-2,(a+b)/2).toFixed(1)}" y="${PT-8}" text-anchor="${(a+b)/2 > W-PR-40 ? 'end' : 'middle'}" class="ch-band" fill="${col}">${lab}</text>`; };
    if (tWin2) { band(tWin2.thenDates.filter(d => d >= pts[0].d), '#8b99ab', 'two weeks before'); band(tWin2.nowDates, VC[1], 'this week'); }
    for (let v = ax.min; v <= ax.max + 1e-9; v += ax.step) g += `<line x1="${PL}" x2="${W-PR}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" class="ch-grid"/><text x="${PL-7}" y="${(Y(v)+4).toFixed(1)}" text-anchor="end" class="ch-ax">${Math.round(v*10)/10}%</text>`;
    g += `<line x1="${PL}" x2="${W-PR}" y1="${Y(BB_TARGET).toFixed(1)}" y2="${Y(BB_TARGET).toFixed(1)}" stroke="#ffd166" stroke-width="1.4" stroke-dasharray="6 4"/><text x="${PL+6}" y="${(Y(BB_TARGET)-6).toFixed(1)}" class="ch-tgt">${BB_TARGET}% target</text>`;
    [...new Set(pts.map(p => p.d.slice(0, 7)))].forEach(m => { const d = m + '-01'; if (d >= pts[0].d) g += `<text x="${X(d).toFixed(1)}" y="${H-7}" text-anchor="middle" class="ch-ax">${new Date(d+'T00:00:00Z').toLocaleDateString('en-GB',{month:'short',timeZone:'UTC'})}</text>`; });
    const line = (k, col, w) => { const q = pts.filter(p => p[k] != null); g += `<polyline points="${q.map(p => X(p.d).toFixed(1)+','+Y(p[k]).toFixed(1)).join(' ')}" fill="none" stroke="${col}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"/>`;
      q.forEach(p => { g += `<circle cx="${X(p.d).toFixed(1)}" cy="${Y(p[k]).toFixed(1)}" r="2.6" fill="#07090c" stroke="${col}" stroke-width="1.6"><title>${fmt(p.d)} · ${k === 'w' ? 'Win' : 'Match'} ${p[k].toFixed(1)}%</title></circle>`; });
      const l = q[q.length-1]; g += `<circle cx="${X(l.d).toFixed(1)}" cy="${Y(l[k]).toFixed(1)}" r="4.5" fill="${col}"/><text x="${(X(l.d)+8).toFixed(1)}" y="${(Y(l[k])+4).toFixed(1)}" class="ch-lastv" fill="${col}">${l[k].toFixed(1)}%</text>`; };
    line('m', MATCHC, 2.2); line('w', WINC, 2.8);
    chart = `<svg viewBox="0 0 ${W} ${H}" class="cp-chart" role="img" aria-label="Win and Match Buy Box percent over time">${g}</svg>`;
  }
  const chgPill = (t, lab) => t == null ? '' : `<span class="rp-chg ${t.d >= 0.3 ? 'up' : t.d <= -0.3 ? 'down' : 'same'}">${t.d >= 0.3 ? '▲' : t.d <= -0.3 ? '▼' : '●'} ${Math.abs(t.d).toFixed(1)}pp ${lab}</span>`;
  const tile = (k, v, sub, col, t) => `<div class="rp-tile" style="--tc:${col}"><div class="rp-k">${k}</div><div class="rp-v" style="color:${col}">${v}</div><div class="rp-s">${sub}${t ? ` · <span style="color:var(--muted2)">2-wk avg ${Math.round(t.then)} → ${Math.round(t.now)}</span>` : ''}</div></div>`;
  const whyBits = [];
  if (wDiff != null) whyBits.push(`Since the last entry (${fmt(prev.date)}): Win ${wDiff >= 0 ? '+' : ''}${wDiff}pp, Match ${mDiff >= 0 ? '+' : ''}${mDiff}pp — one entry moves about 1–2pp on a normal day, so the call is made on the 2-week average.`);
  if (wPct < BB_TARGET && mPct > wPct + 5) whyBits.push(`You match the price on <b>${mSkus ?? '—'}</b> listings but win only <b>${wSkus ?? '—'}</b> — a small floor-price cut on the matched ones is the quickest way to more wins.`);
  window.REP_BB = { w:wPct, m:mPct, label:VC[0], col:VC[1], date:latest.date };
  c.innerHTML = `
    <div id="repTool" style="margin-bottom:22px"></div>
    <div class="rp-bbhead" id="repBBStats"><span>Buy Box stats</span><em>from Sarah's entries — the header date buttons change these</em></div>
    ${warnHtml}
    <div class="cp-hero" style="--vc:${VC[1]}">
      <div class="cp-hl">
        <span class="cp-v">${VC[0]}</span>
        <div class="cp-big" style="color:${winColour}">${wPct.toFixed(1)}%<small>of listings win the Buy Box</small></div>
        <div class="cp-sub">${wPct >= BB_TARGET ? `<b style="color:var(--g)">At or above your ${BB_TARGET}% target.</b>` : `Target ${BB_TARGET}%${need != null ? ` — <b>${need}</b> more winning listings to get there (${wSkus} of ${tSkus.toLocaleString()} now)` : ''}.`}</div>
        <div class="cp-facts">
          <div><span>Win · vs two weeks ago</span><b style="color:${VC[1]}">${tWin2 ? (tWin2.d >= 0 ? '+' : '−') + Math.abs(tWin2.d).toFixed(1) + 'pp' : '—'}</b><em>${tWin2 ? `${tWin2.then.toFixed(1)}% → ${tWin2.now.toFixed(1)}%` : ''}</em></div>
          <div><span>Match Buy Box</span><b style="color:${MATCHC}">${mPct.toFixed(1)}%</b><em>${tMatch2 ? `${tMatch2.d >= 0 ? '+' : '−'}${Math.abs(tMatch2.d).toFixed(1)}pp over 2 wks` : ''}</em></div>
        </div>
      </div>
      <div class="cp-hr">
        <div class="cp-legend"><span><i style="background:${WINC}"></i>Win</span> <span style="margin-left:14px"><i style="background:${MATCHC}"></i>Match</span> <span style="margin-left:14px"><i style="background:none;border-top:2px dashed #ffd166;height:0"></i>${BB_TARGET}% target</span></div>
        ${chart || '<div style="padding:40px;color:var(--muted2);font-size:12px">Needs two entries with repricer figures.</div>'}
      </div>
      ${whyBits.length ? `<div class="cp-why"><b>Why:</b> ${whyBits.join(' ')}</div>` : ''}
    </div>

    <div class="rp-tiles">
      ${tile('Winning', wSkus ?? '—', 'listings you own the Buy Box on', WINC, tWinN2)}
      ${tile('Matching', mSkus ?? '—', 'price-matched, not winning', MATCHC, tMatchN2)}
      ${tile('Neither', neither != null ? neither.toLocaleString() : '—', 'not winning or matching', '#8b99ab', null)}
      ${tile('Listings in repricer', tSkus.toLocaleString(), skuDiff != null ? `${skuDiff > 0 ? '+' : ''}${skuDiff} since the last entry` : '', 'var(--text)', null)}
    </div>


    <div class="card" style="margin-bottom:16px">
      <div class="card-hd"><div class="card-title">Every listing — winning · matching · neither</div>
        <div class="card-tag">latest: ${wSkus ?? '—'} winning · ${mSkus ?? '—'} matching · ${neither != null ? neither.toLocaleString() : '—'} neither</div></div>
      <div style="height:200px"><canvas id="repSplitChart"></canvas></div>
    </div>
    ${repMonthsHtml()}

    <div class="card">
      <div class="card-hd"><div class="card-title">Recent entries</div></div>
      <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;min-width:480px">
        <thead><tr style="border-bottom:1px solid var(--border2)">
          <th style="padding:7px 12px;text-align:left;${MONO};font-size:10px;color:var(--muted2);font-weight:500;text-transform:uppercase">Date</th>
          ${th('Win %')}${th('Win SKUs')}${th('Match %')}${th('Match SKUs')}${th('Total')}
        </tr></thead>
        <tbody>${tableRows}</tbody>
      </table></div>
    </div>`;

  renderRepricerSplitChart(withRep);
  if (typeof renderRepTool === 'function') renderRepTool();
}

// One 100% bar per entry: winning, matching, and neither (the 82–84% that sits outside both).
function renderRepricerSplitChart(snaps){
  const cv = document.getElementById('repSplitChart'); if (!cv || typeof Chart === 'undefined') return;
  destroyChart('repSplitChart');
  const rows = snaps.filter(s => s.repricer?.total > 0 && s.repricer.winning != null && s.repricer.matching != null).slice(-20);
  const pc = (s, n) => +(n / s.repricer.total * 100).toFixed(1);
  chartInstances.repSplitChart = new Chart(cv.getContext('2d'), {
    type:'bar',
    data:{ labels: rows.map(s => fmtShort(s.date)), datasets:[
      { label:'Winning', data: rows.map(s => pc(s, s.repricer.winning)), backgroundColor:'rgba(0,245,160,.75)', stack:'a' },
      { label:'Matching', data: rows.map(s => pc(s, s.repricer.matching)), backgroundColor:'rgba(61,158,255,.75)', stack:'a' },
      { label:'Neither', data: rows.map(s => pc(s, Math.max(0, s.repricer.total - s.repricer.winning - s.repricer.matching))), backgroundColor:'rgba(139,153,171,.22)', stack:'a' } ]},
    options:{ responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{ position:'top', labels:{ color:'#a7b4c4', boxWidth:10, font:{ family:'Inter', size:11 } } }, datalabels:{ display:false },
        tooltip:{ callbacks:{ title: it => fmt(rows[it[0].dataIndex].date), label: c => `${c.dataset.label}: ${c.parsed.y}% (${c.dataset.label==='Winning' ? rows[c.dataIndex].repricer.winning : c.dataset.label==='Matching' ? rows[c.dataIndex].repricer.matching : Math.max(0, rows[c.dataIndex].repricer.total - rows[c.dataIndex].repricer.winning - rows[c.dataIndex].repricer.matching)} listings)` } } },
      scales:{ x:{ stacked:true, grid:{ display:false }, ticks:{ color:'#a7b4c4', font:{ size:11 } } },
               y:{ stacked:true, max:100, grid:{ color:'#1c2330' }, ticks:{ color:'#a7b4c4', font:{ size:11 }, callback:v => v + '%' } } } }
  });
}

// The longer view: month by month over every entry (not just the date range), with records.
function repMonthsHtml(){
  const all = shAllSnaps().filter(s => repPct(s,'win') != null);
  if (all.length < 4) return '';
  const by = {}; all.forEach(s => { (by[s.date.slice(0,7)] = by[s.date.slice(0,7)] || []).push(s); });
  const months = Object.entries(by).sort().slice(-8);
  const av = (l, f) => { const v = l.map(f).filter(x => x != null); return v.length ? v.reduce((a,b) => a+b, 0) / v.length : null; };
  const col = v => v == null ? 'var(--muted)' : v >= BB_TARGET ? '#00f5a0' : v < 5 ? '#ff4d6d' : '#ffd166';
  const rec = (k) => { const v = all.map(s => ({ s, v: repPct(s,k) })); const hi = v.reduce((a,b) => b.v > a.v ? b : a), lo = v.reduce((a,b) => b.v < a.v ? b : a); return { hi, lo }; };
  const rw = rec('win'), rm = rec('match');
  const hit = all.filter(s => repPct(s,'win') >= BB_TARGET).length;
  const cell = 'padding:7px 10px;text-align:right;font-family:var(--mono);font-size:12px;white-space:nowrap';
  return `<div style="background:var(--s1);border:1px solid var(--border);border-radius:14px;padding:18px 20px;margin-bottom:16px">
    <div style="font-family:var(--mono);font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--text);margin-bottom:10px">Month by month · every entry</div>
    <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">
      <thead><tr><th style="${cell};text-align:left;color:var(--muted2)"></th>${months.map(([m]) => `<th style="${cell};color:var(--muted2)">${new Date(m + '-01T00:00:00').toLocaleDateString('en-GB',{ month:'short', year:'2-digit' })}</th>`).join('')}</tr></thead>
      <tbody>
        <tr><td style="${cell};text-align:left;color:var(--muted2)">Win BB</td>${months.map(([, l]) => { const v = av(l, s => repPct(s,'win')); return `<td style="${cell};color:${col(v)};font-weight:700">${v != null ? v.toFixed(1) + '%' : '—'}</td>`; }).join('')}</tr>
        <tr><td style="${cell};text-align:left;color:var(--muted2)">Match BB</td>${months.map(([, l]) => { const v = av(l, s => repPct(s,'match')); return `<td style="${cell};color:${col(v)}">${v != null ? v.toFixed(1) + '%' : '—'}</td>`; }).join('')}</tr>
        <tr><td style="${cell};text-align:left;color:var(--muted2)">Winning SKUs</td>${months.map(([, l]) => { const v = av(l, s => s.repricer?.winning ?? null); return `<td style="${cell};color:var(--text)">${v != null ? Math.round(v) : '—'}</td>`; }).join('')}</tr>
      </tbody></table></div>
    <div style="display:flex;gap:22px;flex-wrap:wrap;margin-top:12px;font-family:var(--mono);font-size:12px;color:var(--muted2)">
      <span>Win best <b style="color:#00f5a0">${rw.hi.v.toFixed(1)}%</b> (${fmt(rw.hi.s.date)}) · worst <b style="color:#ff4d6d">${rw.lo.v.toFixed(1)}%</b> (${fmt(rw.lo.s.date)})</span>
      <span>Match best <b style="color:#00f5a0">${rm.hi.v.toFixed(1)}%</b> (${fmt(rm.hi.s.date)}) · worst <b style="color:#ff4d6d">${rm.lo.v.toFixed(1)}%</b> (${fmt(rm.lo.s.date)})</span>
      <span>Win at or above ${BB_TARGET}% on <b style="color:var(--text)">${hit}</b> of ${all.length} entries</span>
    </div></div>`;
}


function setRepKpi(valId, curr, prev, avg, upGood) {
  const el = document.getElementById(valId);
  const pillId = valId + 'Pill';
  const subId = valId + 'Sub';
  
  const valEl = document.getElementById(valId);
  const pillEl = document.getElementById(pillId);
  const subEl = document.getElementById(subId);
  
  if (!valEl || !pillEl || !subEl) return; // Skip if elements don't exist
  
  const currNum = parseFloat(curr);
  valEl.textContent = currNum ? (Number.isInteger(currNum) ? currNum.toLocaleString() : currNum.toFixed(1) + '%') : '—';
  
  let pillHtml = '';
  if (prev && prev !== 0 && prev !== null) {
    const diff = currNum - parseFloat(prev);
    const up = diff > 0;
    const good = upGood ? up : !up;
    const cls = diff === 0 ? 'flat' : (good ? 'up' : 'down');
    const arrow = diff === 0 ? '→' : (up ? '▲' : '▼');
    const absDiff = Math.abs(diff);
    let label = '';
    if (valId.includes('Skus') || valId.includes('skus')) label = (diff>0?'+':'') + Math.round(diff) + ' SKU' + (absDiff!==1?'s':'');
    else if (valId.includes('Asin') || valId.includes('asin')) label = (diff>0?'+':'') + Math.round(diff) + ' ASIN' + (absDiff!==1?'s':'');
    else label = (diff>0?'+':'') + Math.abs(diff).toFixed(1) + (Number.isInteger(currNum) ? '' : 'pp');
    pillHtml += `<span class="pill ${cls}">${arrow} ${label}</span>`;
  }
  if (avg && avg > 0) {
    const diff = currNum - avg;
    const up = diff > 0;
    const good = upGood ? up : !up;
    const cls = diff === 0 ? 'flat' : (good ? 'up' : 'down');
    const arrow = diff === 0 ? '→' : (up ? '▲' : '▼');
    const suffix = Number.isInteger(currNum) ? '' : '%';
    if (pillHtml) pillHtml += ' ';
    pillHtml += `<span class="pill ${cls}" style="font-size:10px">${arrow} ${Math.abs(diff).toFixed(1)}${suffix}</span>`;
  }
  
  pillEl.innerHTML = pillHtml;
  subEl.textContent = !prev && !avg ? 'First snapshot' : '';
}

function renderRepricerPercentChart(snaps) {
  const ctx = document.getElementById('repricerChart');
  if (!ctx) return;
  const chartCtx = ctx.getContext('2d');
  const tag = document.getElementById('repChartTag');
  const chartNote = document.getElementById('repChartNote');

  if (snaps.length < 2) {
    if (tag) tag.textContent = 'Need 2+ snapshots';
    if (chartNote) chartNote.textContent = '';
    return;
  }

  // Apply window size
  const windowed = repWindowSize >= 999 ? snaps : snaps.slice(-repWindowSize);
  if (tag) tag.textContent = `${fmt(windowed[0].date)} → ${fmt(windowed[windowed.length-1].date)}`;

  const getWin = s => repPct(s,'win');
  const getMatch = s => repPct(s,'match');

  const winData = windowed.map(getWin);
  const matchData = windowed.map(getMatch);

  // Smart zoom — ensure 10% line is always visible
  const allVals = [...winData, ...matchData, 10].filter(v => v !== null);
  const max = Math.max(...allVals);
  const min = Math.min(...allVals);
  const padding = 1.5;
  const yMin = Math.max(0, min - padding);
  const yMax = max + padding;

  // Chart note
  if (chartNote) {
    const winTrend = windowed.length >= 3 ? repGetTrend(windowed.filter(s => getWin(s) !== null), getWin, 3) : null;
    const matchTrend = windowed.length >= 3 ? repGetTrend(windowed.filter(s => getMatch(s) !== null), getMatch, 3) : null;
    const winNow = winData[winData.length-1];
    const matchNow = matchData[matchData.length-1];
    const gapNote = winNow !== null && matchNow !== null
      ? ` Gap between lines (${(matchNow - winNow).toFixed(1)}pp) = listings where you match price but don't win — narrowing this gap means you're getting more competitive.`
      : '';
    chartNote.innerHTML = `Win BB trending <strong style="color:${winTrend > 0.3 ? '#00f5a0' : winTrend < -0.3 ? '#ff4d6d' : '#a7b4c4'}">${winTrend > 0.3 ? 'up' : winTrend < -0.3 ? 'down' : 'flat'}</strong> over last 3 entries. Match BB trending <strong style="color:${matchTrend > 0.3 ? '#00f5a0' : matchTrend < -0.3 ? '#ff4d6d' : '#a7b4c4'}">${matchTrend > 0.3 ? 'up' : matchTrend < -0.3 ? 'down' : 'flat'}</strong>.${gapNote}`;
  }

  destroyChart('repricerChart');
  const opts = chartOpts();
  opts.scales.y.beginAtZero = false;
  opts.scales.y.min = yMin;
  opts.scales.y.max = yMax;
  opts.scales.y.ticks.callback = v => v + '%';
  opts.plugins.legend = { display: false };

  // SKU counts per point — surfaced in the hover tooltip alongside the %
  const winCounts = windowed.map(s => (s.repricer && s.repricer.winning != null) ? s.repricer.winning : null);
  const matchCounts = windowed.map(s => (s.repricer && s.repricer.matching != null) ? s.repricer.matching : null);
  const totals = windowed.map(s => (s.repricer && s.repricer.total != null) ? s.repricer.total : null);

  opts.interaction = { mode: 'index', intersect: false };
  // Declutter: only label the most recent point on each line; hover reveals the rest
  opts.plugins.datalabels = {
    display: ctx => ctx.dataIndex === ctx.dataset.data.length - 1 && ctx.datasetIndex < 2,
    align: 'top',
    offset: 4,
    color: ctx => ctx.datasetIndex === 0 ? '#00f5a0' : '#ffd166',
    font: { family: 'Inter', size: 11, weight: '600' },
    formatter: v => v != null ? v.toFixed(1) + '%' : ''
  };
  opts.plugins.tooltip = {
    backgroundColor: '#11161f',
    borderColor: '#2a3545',
    borderWidth: 1,
    padding: 12,
    titleColor: '#e2e8f0',
    titleFont: { family: 'Inter', size: 11, weight: '600' },
    bodyFont: { family: 'Inter', size: 11 },
    bodySpacing: 6,
    boxPadding: 6,
    usePointStyle: true,
    callbacks: {
      title: items => items.length ? `${fmt(windowed[items[0].dataIndex].date)}` : '',
      label: ctx => {
        const i = ctx.dataIndex;
        if (ctx.datasetIndex === 0) {
          const n = winCounts[i];
          const tot = totals[i];
          return `  Win BB   ${ctx.parsed.y.toFixed(1)}%${n!=null?`  ·  ${n}${tot?`/${tot}`:''} SKUs`:''}`;
        }
        if (ctx.datasetIndex === 1) {
          const n = matchCounts[i];
          const tot = totals[i];
          return `  Match BB ${ctx.parsed.y.toFixed(1)}%${n!=null?`  ·  ${n}${tot?`/${tot}`:''} SKUs`:''}`;
        }
        return null; // hide the 10% target line from tooltip
      },
      labelColor: ctx => {
        if (ctx.datasetIndex === 0) return { borderColor: '#00f5a0', backgroundColor: '#00f5a0', borderWidth: 0, borderRadius: 3 };
        if (ctx.datasetIndex === 1) return { borderColor: '#ffd166', backgroundColor: '#ffd166', borderWidth: 0, borderRadius: 3 };
        return { borderColor: 'transparent', backgroundColor: 'transparent' };
      },
      afterBody: items => {
        const i = items[0]?.dataIndex;
        if (i == null) return '';
        const w = winData[i], m = matchData[i];
        if (w == null || m == null) return '';
        return `\n  Gap ${(m - w).toFixed(1)}pp (match but not winning)`;
      }
    }
  };

  chartInstances.repricerChart = new Chart(chartCtx, {
    type: 'line',
    data: {
      labels: windowed.map(s => fmtShort(s.date)),
      datasets: [
        { label: 'Win BB %', data: winData, borderColor: '#00f5a0', backgroundColor: 'rgba(0,245,160,.07)', tension: .35, fill: true, pointRadius: 5, pointBackgroundColor: '#00f5a0', pointBorderColor: '#07090c', pointBorderWidth: 2, borderWidth: 2.5 },
        { label: 'Match BB %', data: matchData, borderColor: '#ffd166', backgroundColor: 'rgba(255,209,102,.05)', tension: .35, fill: false, pointRadius: 5, pointBackgroundColor: '#ffd166', pointBorderColor: '#07090c', pointBorderWidth: 2, borderWidth: 2, borderDash: [5, 3] },
        { label: '10% target', data: windowed.map(() => 10), borderColor: 'rgba(107,122,141,0.4)', borderDash: [3, 3], pointRadius: 0, fill: false, borderWidth: 1 },
      ]
    },
    options: opts
  });
}

function renderRepricerCountChart(snaps) {
  const ctx = document.getElementById('repCountChart');
  if (!ctx) return;
  const chartCtx = ctx.getContext('2d');
  const tag = document.getElementById('repCountChartTag');
  
  if (snaps.length < 2) {
    tag.textContent = 'Need 2+ snapshots';
    chartCtx.fillStyle='#8b99ab'; chartCtx.font="11px 'Inter'"; chartCtx.textAlign='center';
    chartCtx.fillText('Add 2+ snapshots to see trend', chartCtx.canvas.width/2, chartCtx.canvas.height/2);
    return;
  }
  
  tag.textContent = `${fmt(snaps[0].date)} → ${fmt(snaps[snaps.length-1].date)}`;

  const winCount = s => (s.repricer && s.repricer.winning != null) ? s.repricer.winning : null;
  const matchCount = s => (s.repricer && s.repricer.matching != null) ? s.repricer.matching : null;
  const totalCount = s => s.repricer?.total || null;   // no repricer figures = a gap, not a fake zero / inventory count

  destroyChart('repCountChart');
  // Persisted per-line visibility for this chart (saved locally, survives reloads)
  let countHidden = {};
  try { countHidden = JSON.parse(localStorage.getItem('repCountHidden') || '{}') || {}; } catch(e) { countHidden = {}; }
  const countOpts = {...chartOpts()};
  countOpts.interaction = { mode:'index', intersect:false };
  countOpts.plugins = {...countOpts.plugins,
    legend:{ position:'top', labels:{ boxWidth:10, padding:14, color:'#a7b4c4', font:{family:'Inter',size:11}, usePointStyle:true },
      onClick:(e, item, legend)=>{
        const ci = legend.chart, idx = item.datasetIndex;
        const nowHidden = ci.isDatasetVisible(idx); // about to hide if currently visible
        ci.setDatasetVisibility(idx, !ci.isDatasetVisible(idx));
        ci.update();
        const lbl = ci.data.datasets[idx].label;
        try {
          const cur = JSON.parse(localStorage.getItem('repCountHidden') || '{}') || {};
          cur[lbl] = nowHidden;
          localStorage.setItem('repCountHidden', JSON.stringify(cur));
        } catch(e) {}
      }
    },
    datalabels:{ display: ctx => ctx.dataIndex === ctx.dataset.data.length-1 && ctx.datasetIndex < 2,
      align:'top', offset:4, color: ctx => ctx.datasetIndex===0?'#00f5a0':'#ffd166',
      font:{family:'Inter',size:11,weight:'600'}, formatter:v=>v!=null?v:'' },
    tooltip:{ backgroundColor:'#11161f', borderColor:'#2a3545', borderWidth:1, padding:12,
      titleFont:{family:'Inter',size:11,weight:'600'}, bodyFont:{family:'Inter',size:11}, bodySpacing:6, usePointStyle:true,
      callbacks:{ label: ctx => `  ${ctx.dataset.label}: ${ctx.parsed.y} SKUs` } }
  };
  countOpts.scales = {
    x:{grid:{color:'#1c2330'}, ticks:{color:'#8b99ab',font:{family:'Inter',size:11}}},
    y:{grid:{color:'#1c2330'}, ticks:{color:'#8b99ab',font:{family:'Inter',size:11}}, position:'left', beginAtZero:false, grace:'15%', title:{display:true,text:'Winning / Matching',color:'#8b99ab',font:{family:'Inter',size:11}}},
    y1:{grid:{display:false}, ticks:{color:'#8b99ab',font:{family:'Inter',size:11}}, position:'right', beginAtZero:false, grace:'10%', title:{display:true,text:'Total in repricer',color:'#8b99ab',font:{family:'Inter',size:11}}}
  };

  chartInstances.repCountChart = new Chart(chartCtx, {
    type:'line',
    data:{
      labels: snaps.map(s=>fmtShort(s.date)),
      datasets:[
        { label:'Winning SKUs', hidden: !!countHidden['Winning SKUs'], data:snaps.map(winCount), borderColor:'#00f5a0', backgroundColor:'rgba(0,245,160,.10)', tension:.35, fill:true, pointRadius:5, pointBackgroundColor:'#00f5a0', pointBorderColor:'#07090c', pointBorderWidth:2, borderWidth:2.5, spanGaps:true, yAxisID:'y' },
        { label:'Matching SKUs', hidden: !!countHidden['Matching SKUs'], data:snaps.map(matchCount), borderColor:'#ffd166', backgroundColor:'rgba(255,209,102,.05)', tension:.35, fill:false, pointRadius:5, pointBackgroundColor:'#ffd166', pointBorderColor:'#07090c', pointBorderWidth:2, borderWidth:2, borderDash:[5,3], spanGaps:true, yAxisID:'y' },
        { label:'Total SKUs in repricer', hidden: !!countHidden['Total SKUs in repricer'], data:snaps.map(totalCount), borderColor:'rgba(107,122,141,0.5)', tension:.35, fill:false, pointRadius:0, borderWidth:1.5, yAxisID:'y1' },
      ]
    },
    options: countOpts
  });
}


function renderRepricerWinMatchCharts(snaps){
  const validSnaps = snaps.filter(s => s.repricer && (s.repricer.total>0 || s.repricer.winPct));
  if(validSnaps.length < 2) return;
  const getWin  = s => (repPct(s,'win')??0);
  const getMatch= s => (repPct(s,'match')??0);
  const getWinN = s => s.repricer.winning ?? null;
  const getMatchN= s => s.repricer.matching ?? null;
  const labels  = validSnaps.map(s=>fmtShort(s.date));

  function makeChart(canvasId, instKey, mainData, skuData, colour, label){
    const cv = document.getElementById(canvasId); if(!cv) return;
    destroyChart(instKey);
    const vals = mainData.filter(v=>v!=null);
    const lo = Math.max(0,Math.floor(Math.min(...vals,10)-1));
    const hi = Math.ceil(Math.max(...vals,10)+1.5);
    const skuVals = skuData.filter(v=>v!=null);
    const slo = skuVals.length ? Math.max(0,Math.min(...skuVals)-5) : 0;
    const shi = skuVals.length ? Math.max(...skuVals)+5 : 100;
    const ptCol = mainData.map(v=>v==null?colour:v>=10?'#00f5a0':v>=5?'#ffd166':'#ff4d6d');
    chartInstances[instKey] = new Chart(cv.getContext('2d'),{
      type:'line',
      data:{ labels, datasets:[
        { label, data:mainData, borderColor:colour, backgroundColor:colour+'18', borderWidth:2,
          tension:.3, fill:true, pointRadius:3, pointHoverRadius:5,
          pointBackgroundColor:ptCol, pointBorderColor:'#07090c', pointBorderWidth:1.5,
          yAxisID:'y', spanGaps:true },
        { label:'SKUs', data:skuData, borderColor:colour+'66', borderWidth:1.5, borderDash:[4,3],
          tension:.3, fill:false, pointRadius:2, pointHoverRadius:4,
          pointBackgroundColor:colour+'88', pointBorderColor:'#07090c', pointBorderWidth:1,
          yAxisID:'y1', spanGaps:true }
      ]},
      options:{
        responsive:true, maintainAspectRatio:false,
        interaction:{mode:'index',intersect:false},
        plugins:{
          legend:{display:false},
          datalabels:{display:false},
          tooltip:{ backgroundColor:'#11161f', borderColor:'#2a3545', borderWidth:1, padding:10,
            titleFont:{family:'Inter',size:11,weight:'600'}, bodyFont:{family:'Inter',size:11}, bodySpacing:5,
            callbacks:{
              title:items=>fmt(validSnaps[items[0].dataIndex].date),
              label:ctx=>ctx.datasetIndex===0
                ? `${label}: ${ctx.parsed.y.toFixed(1)}%`
                : `SKUs: ${ctx.parsed.y}`
            }
          }
        },
        scales:{
          y:{ min:lo, max:hi, position:'left', grid:{color:'#1c2330'},
              ticks:{color:'#a7b4c4',callback:v=>v+'%'},
              // 10% target line
              afterDraw(ch){ const {ctx,chartArea,scales}=ch; if(!scales.y) return;
                const y=scales.y.getPixelForValue(10);
                ctx.save(); ctx.strokeStyle='rgba(167,180,196,.3)'; ctx.lineWidth=1;
                ctx.setLineDash([4,4]);
                ctx.beginPath(); ctx.moveTo(chartArea.left,y); ctx.lineTo(chartArea.right,y); ctx.stroke();
                ctx.restore(); } },
          y1:{ min:slo, max:shi, position:'right', grid:{display:false},
               ticks:{color:'#5a6272',callback:v=>v+' SKUs'} },
          x:{ grid:{display:false}, ticks:{color:'#a7b4c4',maxRotation:0,autoSkip:true,maxTicksLimit:8} }
        }
      }
    });
  }

  makeChart('repWinChart',  'repWinChart',  validSnaps.map(getWin),  validSnaps.map(getWinN),  '#00f5a0', 'Win BB %');
  makeChart('repMatchChart','repMatchChart',validSnaps.map(getMatch),validSnaps.map(getMatchN),'#ffd166', 'Match BB %');
}

function renderAgingChart(snaps) {
  // Try both canvas IDs - one for Overview, one for Repricer
  const ctxOverview = document.getElementById('stockAgeingChart');
  const ctxRepricer = document.getElementById('agingChart');
  
  if (!ctxOverview && !ctxRepricer) return;
  
  if (snaps.length < 2) {
    const tag = document.getElementById('ageingBreakdownTag') || document.getElementById('agingChartTag');
    if (tag) tag.textContent = 'Need 2+ snapshots';
    return;
  }
  
  const tag = document.getElementById('ageingBreakdownTag') || document.getElementById('agingChartTag');
  if (tag) tag.textContent = `${fmt(snaps[0].date)} → ${fmt(snaps[snaps.length-1].date)}`;
  
  // Three zones instead of seven thin lines (181+ lines of 2–13 were flattened by 0–30d at ~250),
  // in £ when the entries carry it — the same colours as Stock Health.
  const useVal = snaps.every(x => shHasValuation(x));
  const zoneDefs = [['healthy','Under 90 days','#00f5a0'],['caution','91–180 days','#ffd166'],['action','181+ days','#ff8c42']];
  
  destroyChart('agingChart');
  destroyChart('stockAgeingChart');
  
  const chartData = {
    type:'line',
    data:{
      labels: snaps.map(s=>fmtShort(s.date)),
      datasets: zoneDefs.map(([k, lab, col]) => ({
        label: lab + (useVal ? ' (£)' : ' (SKUs)'),
        data: snaps.map(x => (useVal ? shZoneValues(x) : shZones(x))[k]),
        borderColor: col,
        backgroundColor: col + '22',
        tension: .35,
        fill: false,
        pointRadius: 4,
        pointBackgroundColor: col,
        pointBorderColor: '#07090c',
        pointBorderWidth: 2
      }))
    },
    options: {
      ...chartOpts(),
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          beginAtZero: true,
          ticks: { callback: v => useVal ? fmtGBP(v) : v }
        }
      }
    }
  };
  
  // Render to Overview chart if it exists
  if (ctxOverview) {
    const chartCtx = ctxOverview.getContext('2d');
    chartInstances.stockAgeingChart = new Chart(chartCtx, chartData);
  }
  
  // Render to Repricer chart if it exists
  if (ctxRepricer) {
    const chartCtx = ctxRepricer.getContext('2d');
    chartInstances.agingChart = new Chart(chartCtx, chartData);
  }
}

