// ══ CHART PLUGIN REGISTRATION ══════════════════════════════════════════════════════════
Chart.register(ChartDataLabels);
// Off unless a chart asks for it: left on, every point of every chart printed its raw value
// ("92086.01999999997"). Charts that want their last value labelled say so themselves.
Chart.defaults.set('plugins.datalabels', { display: false });

// ══ SUPABASE CONFIG ══════════════════════════════════════════════════════════
const SUPABASE_URL = 'https://ffbdazepqrsyurhouxif.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmYmRhemVwcXJzeXVyaG91eGlmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4OTM5MjIsImV4cCI6MjA5MDQ2OTkyMn0.BAuodLUDGzO9A7IfoRRn0HZ1MgWOXNPeYKPDBNaNWeg';

// null = not yet determined. The upsert only carries the inbound columns on a positive
// TRUE, so an unknown state can never take the whole snapshot save down with it.
window._hasInboundCols = null;

let supabase = null;
if (window.supabase) {
  supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} else {
  console.warn('Supabase library not loaded - using local fallback');
}

// The Keepa bank from the keepa Worker's own 5-minute log (bdl_keepa.bank_log, readable with the anon
// key — Keepa Discord, 10 Nov). A Supabase read, never a Keepa call. The Repricer shows it.
// Deal badges for products checked before v67ah stored them: the shared keepa_cache already has Keepa's full reply
// (deals, coupon, Buy Box seller, 90-day average) — read just those fields, newest per ASIN. A Supabase read, 0 tokens.
window._cacheDeals = async function(asins){
  const out = {};
  for (let i = 0; i < asins.length; i += 80) {
    const part = asins.slice(i, i + 80);
    const q = `select=asin,fetched_at,deals:product->deals,coupon:product->coupon,bb:product->stats->buyBoxSellerId,avg90:product->stats->avg90&kind=eq.offers&asin=in.(${part.join(',')})&order=fetched_at.desc`;
    const r = await fetch(`${SUPABASE_URL}/rest/v1/keepa_cache?${q}`, { cache:'no-store', headers:{ apikey:SUPABASE_ANON_KEY, Authorization:`Bearer ${SUPABASE_ANON_KEY}` } });
    if (!r.ok) continue;
    (await r.json()).forEach(x => { if (!out[x.asin]) out[x.asin] = x; });
  }
  return out;
};
window._bankLogRead = async function(){
  const r = await fetch(`${SUPABASE_URL}/rest/v1/bank_log?select=at,tokens_left,refill_rate,refill_in&order=at.desc&limit=1`,
    { cache:'no-store', headers:{ apikey:SUPABASE_ANON_KEY, Authorization:`Bearer ${SUPABASE_ANON_KEY}`, 'Accept-Profile':'bdl_keepa' } });
  return r.ok ? ((await r.json())[0] || null) : null;
};

// Signature of a competitor session's readings — used to skip rewriting sessions that
// haven't changed. Sorted so reordering alone doesn't count as a change.
window._readingSigs = new Map();
// Exported because the main script needs to rebuild these after a rename or a purge, and a
// module's top-level declarations are NOT global.
window._refreshReadingSigs = function(sessions) {
  window._readingSigs = new Map((sessions || []).map(s => [s.date, _readingSig(s)]));
};
function _readingSig(session) {
  return (session?.competitors || [])
    .map(c => `${c.sellerId}:${c.name}:${Number(c.pct)}`)
    .sort()
    .join('|');
}

// Save data to Supabase
//
// Every table is written in ONE batched request rather than one request per row. The old
// per-row loops meant a single save fired ~380 sequential round-trips and took over two
// minutes — and because provider snapshots were written first and inventory snapshots
// second, anything that cut the run short (closing the modal, a refresh, a dropped
// connection) left the provider rows saved and the snapshot silently missing.
window._supabaseSave = async function(snapshots, sellers, competitorSessions, providerSnapshots, onStep, opts = {}) {
  const step = (key, state, note) => { try { onStep && onStep(key, state, note); } catch(_) {} };
  try {
    if (!supabase) {
      step('snapshot', 'fail');
      return { ok: false, errors: ['Supabase client not loaded — check your connection and reload the page.'] };
    }
    const errors = [];

    // Postgres rejects a batch that touches the same conflict key twice, so collapse
    // duplicates first (last one wins, matching the old row-by-row behaviour).
    const dedupe = (rows, keyOf) => {
      const m = new Map();
      for (const r of rows) m.set(keyOf(r), r);
      return [...m.values()];
    };

    // Save snapshots FIRST — this is the row the whole entry exists for, so it goes in
    // before anything else rather than sitting behind a queue of other writes.
    let snapRowCount = 0, provRowCount = 0;
    if (snapshots && snapshots.length > 0) {
      const rows = dedupe(snapshots.filter(s => s.date), s => s.date).map(snap => {
        const row = {
        date: snap.date,
        asins: snap.asins,
        skus: snap.skus,
        avg_cost: snap.avgCost,
        stock_value: snap.stockValue,
        total_units: snap.totalUnits,
        ageing_a0: snap.ageing?.a0,
        ageing_a31: snap.ageing?.a31,
        ageing_a61: snap.ageing?.a61,
        ageing_a91: snap.ageing?.a91,
        ageing_a181: snap.ageing?.a181,
        ageing_a271: snap.ageing?.a271,
        ageing_a365: snap.ageing?.a365,
        ageing_value_a0: snap.ageingValue?.a0||0,
        ageing_value_a31: snap.ageingValue?.a31||0,
        ageing_value_a61: snap.ageingValue?.a61||0,
        ageing_value_a91: snap.ageingValue?.a91||0,
        ageing_value_a181: snap.ageingValue?.a181||0,
        ageing_value_a271: snap.ageingValue?.a271||0,
        ageing_value_a365: snap.ageingValue?.a365||0,
        repricer_total: snap.repricer?.total,
        repricer_winning: snap.repricer?.winning,
        repricer_win_pct: snap.repricer?.winPct,
        repricer_matching: snap.repricer?.matching,
        repricer_match_pct: snap.repricer?.matchPct,
        notes: snap.notes
        };
        // Only send the inbound columns if they exist in the database. Sending a column that
        // has not been migrated yet makes PostgREST reject the WHOLE batch — which would take
        // the snapshot save down with it.
        if (window._hasInboundCols === true) {
          row.inbound_units = snap.inboundUnits ?? null;
          row.inbound_value = snap.inboundValue ?? null;
        }
        // Same rule for ASIN-level ageing. Null, never 0 — null means "this snapshot predates
        // ASIN capture" and draws a gap; 0 would mean "no ASINs in that bucket" and draw a
        // false collapse across every snapshot taken before today.
        if (window._hasAsinAgeCols === true) {
          const aa = snap.ageingAsin || null;
          row.ageing_asin_a0   = aa ? (aa.a0   ?? null) : null;
          row.ageing_asin_a31  = aa ? (aa.a31  ?? null) : null;
          row.ageing_asin_a61  = aa ? (aa.a61  ?? null) : null;
          row.ageing_asin_a91  = aa ? (aa.a91  ?? null) : null;
          row.ageing_asin_a181 = aa ? (aa.a181 ?? null) : null;
          row.ageing_asin_a271 = aa ? (aa.a271 ?? null) : null;
          row.ageing_asin_a365 = aa ? (aa.a365 ?? null) : null;
        }
        return row;
      });
      snapRowCount = rows.length;
      if (rows.length) {
        const { error } = await supabase.from('bdl_snapshots').upsert(rows, { onConflict: 'date' });
        if (error) { errors.push(`Snapshots: ${error.message}`); step('snapshot', 'fail'); return { ok: false, errors }; }
      }
    }
    step('snapshot', 'done', `${snapRowCount} rows synced`);

    // Save provider snapshots (one row per provider per date)
    if (providerSnapshots && providerSnapshots.length > 0) {
      const rows = dedupe(
        providerSnapshots.filter(p => p.date && p.provider),
        p => `${p.date}|${p.provider}`
      ).map(p => ({
        date: p.date,
        provider_name: p.provider,
        sku_count: p.skus || 0,
        total_valuation: p.value || 0,
        notes: p.notes || null
      }));
      provRowCount = rows.length;
      if (rows.length) {
        const { error } = await supabase.from('bdl_provider_snapshots').upsert(rows, { onConflict: 'date,provider_name' });
        if (error) { errors.push(`Provider snapshots: ${error.message}`); step('providers', 'fail'); return { ok: false, errors }; }
      }
    }
    step('providers', 'done', `${provRowCount} rows synced`);

    // Save sellers with order.
    if (sellers) {
      const rows = dedupe(
        sellers.map((s, idx) => ({ seller_id: s.sellerId, name: s.name, seller_order: idx }))
               .filter(r => r.seller_id),
        r => r.seller_id
      );
      let upsertOk = true;
      if (rows.length) {
        const { error } = await supabase.from('bdl_sellers').upsert(rows, { onConflict: 'seller_id' });
        if (error) { errors.push(`Sellers: ${error.message}`); upsertOk = false; }
      }
      // Pruning is opt-in and only the Manage-competitors save asks for it. Every other save
      // (snapshots, bulk readings, Keepa) passes SELLERS straight through and must never be
      // able to delete from the roster — a failed startup load leaves SELLERS empty, and such
      // a save would otherwise wipe every competitor out of the database.
      if (upsertOk && opts && opts.pruneSellers) {
        // Remove sellers deleted from the list. Upserting alone left them in the table, so
        // a removed seller came straight back on the next reload. Runs for an empty list too,
        // otherwise clearing the list looked like it worked and every seller came back.
        const keep = new Set(rows.map(r => r.seller_id));
        const { data: existingSellers, error: selErr } = await supabase.from('bdl_sellers').select('seller_id');
        if (selErr) errors.push(`Removing sellers: ${selErr.message}`);
        else {
          const drop = (existingSellers || []).map(r => r.seller_id).filter(id => id && !keep.has(id));
          if (drop.length) {
            const { error: delErr } = await supabase.from('bdl_sellers').delete().in('seller_id', drop);
            if (delErr) errors.push(`Removing sellers: ${delErr.message}`);
          }
        }
      }
    }

    // Save competitor sessions with readings.
    // Readings have no natural key, so a session's readings can only be rebuilt (delete then
    // insert) — which means an interrupted save could delete the old readings and never insert
    // the new ones. Only sessions whose readings actually changed are rebuilt, so untouched
    // history is never put at risk by an unrelated save.
    if (competitorSessions && competitorSessions.length > 0) {
      const sessRows = dedupe(competitorSessions.filter(s => s.date), s => s.date).map(s => ({ date: s.date }));
      const { data: savedSessions, error: sessError } = await supabase
        .from('bdl_competitor_sessions')
        .upsert(sessRows, { onConflict: 'date' })
        .select();

      if (sessError) {
        errors.push(`Competitor sessions: ${sessError.message}`);
      } else {
        const idByDate = new Map((savedSessions || []).map(r => [r.date, r.id]));
        for (const session of competitorSessions) {
          const sessionId = idByDate.get(session.date);
          if (!sessionId) continue;

          const sig = _readingSig(session);
          if (window._readingSigs.get(session.date) === sig) continue; // unchanged — leave it alone

          const { error: delError } = await supabase.from('bdl_competitor_readings').delete().eq('session_id', sessionId);
          if (delError) { errors.push(`Competitor readings (${session.date}): ${delError.message}`); continue; }

          if (session.competitors && session.competitors.length > 0) {
            const { error: insError } = await supabase.from('bdl_competitor_readings').insert(
              session.competitors.map(c => ({
                session_id: sessionId,
                seller_id: c.sellerId,
                seller_name: c.name,
                overlap_pct: c.pct
              }))
            );
            if (insError) { errors.push(`Competitor readings (${session.date}): ${insError.message}`); continue; }
          }
          window._readingSigs.set(session.date, sig);
        }
      }
    }
    step('competitors', errors.length ? 'fail' : 'done', `${(sellers||[]).length} sellers · ${(competitorSessions||[]).length} sessions`);

    return errors.length === 0 ? true : { ok: false, errors };
  } catch(e) {
    console.error('Supabase save error:', e);
    step('snapshot', 'fail');
    return { ok: false, errors: [e.message || String(e)] };
  }
};

// NOTE ON DELETES: supabase-js does not throw when a delete is rejected — it resolves with
// an { error } object. Every one of these used to return true regardless, so a blocked or
// failed delete still reported success, the row vanished from the screen, and it came back
// on the next refresh. They all check the error now.

// Save the shared-ASIN detail captured by a Keepa fetch. One row per competitor per date,
// with the shared list as an array — 32 rows a run rather than one row per ASIN.
// The newest competitor fetch date in the database. The keepa Worker's 2am fetch (Mon/Wed/Fri)
// writes there directly, so a page opened before it ran doesn't know about it.
window._compLatestDate = async function() {
  try {
    if (!supabase) return null;
    const { data, error } = await supabase.from('bdl_competitor_sessions').select('date').order('date', { ascending: false }).limit(1);
    if (error) return null;
    return data && data[0] ? data[0].date : null;
  } catch (e) { return null; }
};

window._supabaseSaveCompetitorAsins = async function(date, rows) {
  try {
    if (!supabase || !window._hasCompAsinTable) return false;
    if (!rows || !rows.length) return true;
    const payload = rows.map(r => ({
      date,
      seller_id: r.sellerId,
      catalogue_size: r.size ?? null,
      shared_asins: r.asins || []
    }));
    const { error } = await supabase.from('bdl_competitor_asins')
      .upsert(payload, { onConflict: 'date,seller_id' });
    if (error) { console.error('Competitor ASIN save failed:', error.message); return false; }
    return true;
  } catch(e) { console.error('Competitor ASIN save error:', e); return false; }
};

// ── Rivals' full shelves ─────────────────────────────────────────────────────────────────
// One row per product per rival, written only when something changes: inserted when a line
// appears, gone_on filled in when it leaves. A shelf that has not moved writes nothing, which is
// what keeps this to megabytes a year rather than hundreds. The first time a rival is seen every
// line is marked baseline, so what was already there never shows up as a "new lead".
const SHELF_PAGE = 1000;
const _shiftDate = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
// PostgREST caps a select at 1,000 rows, and a full set of shelves is ~8,500. Page through it.
async function _shelfSelectAll(build){
  const out = [];
  for (let from = 0; ; from += SHELF_PAGE) {
    const { data, error } = await build().range(from, from + SHELF_PAGE - 1);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < SHELF_PAGE) break;
  }
  return out;
}

// Lines rivals added since `sinceDate` that are still on their shelf. Small: never baseline.
window._shelfLoadRecent = async function(sinceDate){
  try {
    if (!supabase) return null;
    const head = await supabase.from('bdl_competitor_shelf').select('id', { count: 'exact', head: true });
    if (head.error) throw head.error;
    window._shelfRowCount = head.count || 0;
    const rows = await _shelfSelectAll(() => supabase.from('bdl_competitor_shelf')
      .select('seller_id,asin,first_seen').eq('baseline', false).is('gone_on', null)
      .gte('first_seen', sinceDate).order('id'));
    window._hasShelfTable = true;
    return rows;
  } catch(e) {
    window._hasShelfTable = false;
    console.warn('bdl_competitor_shelf unavailable — run the SQL to start saving rival shelves.', e.message || e);
    return null;
  }
};

// How many DIFFERENT products are on rivals' shelves right now. Summing shelf sizes counts a
// product five times if five rivals sell it; this counts it once.
// ── Your own storefront ────────────────────────────────────────────────────────────────
// One row per product, never deleted. last_seen is KEEPA'S OWN last-seen date for you on that
// product (not the fetch date), so a line you sold out of keeps the day you actually stopped —
// that is where the Sourcing audit's 45 days start. listed_on = the latest fetch that still had it.
const MY_ON_NOW_DAYS = 4;   // "on it now" = Keepa spotted your offer within this many days of the fetch.
                            // Same 4 days as KEEPA_FRESH_DAYS, so the storefront strip and the leads count agree.

async function _myShelfHasOnCols(rows){
  if (rows && rows.length) return Object.prototype.hasOwnProperty.call(rows[0], 'on_now');
  const probe = await supabase.from('bdl_my_shelf').select('on_now').limit(1);
  return !probe.error;
}

window._myShelfLoad = async function(){
  try {
    if (!supabase) return null;
    const rows = await _shelfSelectAll(() => supabase.from('bdl_my_shelf').select('*').order('asin'));
    window._hasMyShelf = true;
    window._myShelfHasOn = await _myShelfHasOnCols(rows);
    return rows;
  } catch(e) {
    window._hasMyShelf = false;
    console.warn('bdl_my_shelf unavailable — run the SQL to start saving your storefront.', e.message || e);
    return null;
  }
};

// `mine` = [{asin, seen:'YYYY-MM-DD'|null}] straight from the fetch's own storefront call.
window._myShelfApply = async function(today, mine){
  const res = { ok:false, listed:0, added:0, left:0, onNow:0, skipped:false };
  try {
    if (!supabase) { res.error = 'not connected'; return res; }
    if (window._hasMyShelf === false) { res.error = 'your storefront table is not set up yet'; return res; }
    const rows = await _shelfSelectAll(() => supabase.from('bdl_my_shelf').select('*').order('asin'));
    const hasOn = window._myShelfHasOn = await _myShelfHasOnCols(rows);
    const by = new Map(rows.map(r => [r.asin, r]));
    const cur = new Map();
    (mine || []).forEach(x => {
      const a = String(x && x.asin || '').trim().toUpperCase();
      if (!/^[A-Z0-9]{10}$/.test(a)) return;
      let d = x.seen && /^\d{4}-\d{2}-\d{2}$/.test(x.seen) ? x.seen : today;
      if (d > today) d = today;
      if (!cur.has(a) || d > cur.get(a)) cur.set(a, d);
    });
    if (!cur.size) { res.error = 'Keepa sent back no list for you'; return res; }

    // One bad Keepa reply must not look like you dropped half your catalogue.
    const cut7 = _shiftDate(today, -7);
    const recent = {};
    rows.forEach(r => { if (r.listed_on && r.listed_on >= cut7 && r.listed_on < today) recent[r.listed_on] = (recent[r.listed_on] || 0) + 1; });
    const was = Math.max(0, ...Object.values(recent));
    if (was >= 20 && cur.size < was * 0.5) { res.ok = true; res.skipped = true; res.was = was; res.now = cur.size; return res; }

    const prevFetch = Object.keys(recent).sort().pop() || null;
    const now = new Date().toISOString();
    const onCut = _shiftDate(today, -MY_ON_NOW_DAYS);
    // The first save with the on-now columns just records the state — nothing counts as a flip.
    // Only true before anything has ever been marked on — a freshly added column is all-false.
    // (Keying this on on_changed alone kept every later fetch a "first" one: caught in testing.)
    const baseline = !hasOn || !rows.some(r => r.on_now || r.on_changed);
    res.baseline = baseline;
    const payload = [];
    cur.forEach((seen, a) => {
      const prev = by.get(a);
      const last = prev && prev.last_seen > seen ? prev.last_seen : seen;   // only ever moves forward
      const row = { asin:a, domain:2, first_seen: prev ? prev.first_seen : today,
        last_seen: last, listed_on: today, source:'keepa', updated_at: now };
      if (hasOn) {
        const on = last >= onCut;
        const was = prev ? !!prev.on_now : false;
        row.on_now = on;
        row.on_changed = prev ? prev.on_changed || null : null;
        if (!baseline && on !== was) { row.on_changed = today; if (on) res.added++; else res.left++; }
        if (on) res.onNow++;
      } else if (!prev) res.added++;
      payload.push(row);
    });
    // Products Keepa no longer lists at all: if they were on, they're off now.
    rows.forEach(r => {
      if (cur.has(r.asin)) return;
      if (hasOn) {
        if (r.on_now) {
          const { asin, domain, first_seen, last_seen, listed_on, source } = r;
          payload.push({ asin, domain: domain || 2, first_seen, last_seen, listed_on, source: source || 'keepa',
            updated_at: now, on_now: false, on_changed: baseline ? (r.on_changed || null) : today });
          if (!baseline) res.left++;
        }
      } else if (prevFetch && r.listed_on === prevFetch) res.left++;
    });
    // Batched — row-by-row writes are what silently lost saves in this app before.
    for (let i = 0; i < payload.length; i += 500) {
      const { error } = await supabase.from('bdl_my_shelf').upsert(payload.slice(i, i + 500), { onConflict:'asin' });
      if (error) throw error;
    }
    res.ok = true; res.listed = cur.size; res.firstTime = rows.length === 0;
    return res;
  } catch(e) {
    console.error('Your storefront save failed:', e);
    res.error = e.message || String(e);
    return res;
  }
};

window._shelfUniqueOpen = async function(){
  try {
    if (!supabase || !window._shelfRowCount) return null;
    const rows = await _shelfSelectAll(() => supabase.from('bdl_competitor_shelf').select('asin').is('gone_on', null).order('id'));
    return new Set(rows.map(r => r.asin)).size;
  } catch(e) { console.warn('Could not count unique rival products:', e.message || e); return null; }
};

// ── Each SKU's age band per snapshot ───────────────────────────────────────────────────────
// bdl_snapshots only keeps totals per age band, so on its own the page cannot tell a SKU that
// sold out from one that aged into the next band. One row per snapshot date holds every SKU:
// [sku, asin, band 0-6, £ value, units, oldest received (YYYY-MM-DD), title]. Kept in its own
// table so the snapshot save and the page's start-up load stay as light as they are.
window._snapSkusSave = async function(date, rows){
  try {
    if (!supabase) return { ok:false };
    const { error } = await supabase.from('bdl_snapshot_skus').upsert({ date, rows, updated_at: new Date().toISOString() }, { onConflict:'date' });
    if (error) throw error;
    window._hasSnapSkus = true;
    return { ok:true };
  } catch(e) {
    window._hasSnapSkus = false;
    console.warn('SKU detail not saved — run the stock-health SQL in Supabase:', e.message || e);
    return { ok:false, error: e.message || String(e) };
  }
};
window._snapSkusDates = async function(){
  try { if (!supabase) return null; const { data, error } = await supabase.from('bdl_snapshot_skus').select('date'); if (error) throw error; return (data||[]).map(r => r.date); }
  catch(e) { return null; }
};
window._snapSkusMove = async function(fromDate, toDate){
  try {
    if (!supabase) return false;
    const { data, error } = await supabase.from('bdl_snapshot_skus').select('rows').eq('date', fromDate).maybeSingle();
    if (error) throw error;
    if (!data) return true;   // nothing saved for that date — nothing to move
    const { error: e2 } = await supabase.from('bdl_snapshot_skus').upsert({ date: toDate, rows: data.rows, updated_at: new Date().toISOString() }, { onConflict:'date' });
    if (e2) throw e2;
    return true;
  } catch(e) { console.warn('SKU detail not moved:', e.message || e); return false; }
};
window._snapSkusLoad = async function(limit){
  try {
    if (!supabase) return null;
    const { data, error } = await supabase.from('bdl_snapshot_skus').select('date,rows').order('date', { ascending:false }).limit(limit || 2);
    if (error) throw error;
    window._hasSnapSkus = true;
    return data || [];
  } catch(e) { window._hasSnapSkus = false; return null; }
};

// ── Repricer tool ─────────────────────────────────────────────────────────────────────────────
// Three tables from the 23 Oct SQL: what Keepa said per ASIN (so looking again costs no tokens),
// what Jack decided per ASIN, and his STK min/max per SKU. Every helper returns null when the
// tables aren't there yet, and the page says "run the SQL" instead of failing.
window._hasRepTables = null;
window._repLoad = async function(){
  try {
    if (!supabase) return null;
    const out = {}; let from = 0;
    for (;;) {
      const { data, error } = await supabase.from('bdl_reprice_asins').select('asin,checked_at,data').order('asin').range(from, from + 199);
      if (error) throw error;
      (data || []).forEach(r => { out[r.asin] = { checked_at: r.checked_at, data: r.data }; });
      if (!data || data.length < 200) break; from += 200;
    }
    window._hasRepTables = true;
    return out;
  } catch(e) { window._hasRepTables = false; console.warn('Repricer tables not there yet:', e.message || e); return null; }
};
window._repSave = async function(asin, data){
  try { if (!supabase) return false;
    const { error } = await supabase.from('bdl_reprice_asins').upsert({ asin, data, checked_at: new Date().toISOString() }, { onConflict:'asin' });
    if (error) throw error; return true;
  } catch(e) { console.warn('Repricer: not saved', asin, e.message || e); return false; }
};
window._repDecisions = async function(){
  try { if (!supabase) return null;
    const { data, error } = await supabase.from('bdl_reprice_decisions').select('*').order('decided_at', { ascending:false }).limit(5000);
    if (error) throw error; return data || [];
  } catch(e) { return null; }
};
window._repDecide = async function(row){
  try { if (!supabase) return null;
    const { data, error } = await supabase.from('bdl_reprice_decisions').insert(row).select().single();
    if (error) throw error; return data;
  } catch(e) { console.warn('Repricer: decision not saved', e.message || e); return null; }
};
window._repSettingsLoad = async function(){
  try { if (!supabase) return null;
    const out = {}; let from = 0;
    for (;;) {
      const { data, error } = await supabase.from('bdl_reprice_settings').select('sku,min_price,max_price,strategy,repricer_on,file_date').range(from, from + 999);
      if (error) throw error;
      (data || []).forEach(r => { out[r.sku] = r; });
      if (!data || data.length < 1000) break; from += 1000;
    }
    return out;
  } catch(e) { return null; }
};
window._repSettingsSave = async function(rows){
  try { if (!supabase) return false;
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await supabase.from('bdl_reprice_settings').upsert(rows.slice(i, i + 500), { onConflict:'sku' });
      if (error) throw error;
    }
    return true;
  } catch(e) { console.warn('Repricer: settings not saved', e.message || e); return false; }
};

// Every rival shelf row that was open at any point since `sinceDate`. From this one load the page
// can rebuild who had what on any recent fetch day, and count today's shelves once per product.
window._shelfLoadWindow = async function(sinceDate){
  try {
    if (!supabase || !window._shelfRowCount) return null;
    return await _shelfSelectAll(() => supabase.from('bdl_competitor_shelf')
      .select('seller_id,asin,first_seen,gone_on').or(`gone_on.is.null,gone_on.gt.${sinceDate}`).order('id'));
  } catch(e) { console.warn('Could not load rival shelves:', e.message || e); return null; }
};

// Name, picture and price for ASINs already saved in src_products (by this fetch or the Sourcing
// app). Read only — never costs a Keepa token.
window._srcDetails = async function(asins){
  const out = {};
  try {
    if (!supabase || !asins.length) return out;
    for (let i = 0; i < asins.length; i += 150) {
      const { data, error } = await supabase.from('src_products').select('asin,title,brand,image,price,rank,mo').in('asin', asins.slice(i, i + 150));
      if (error) throw error;
      (data || []).forEach(r => { out[r.asin] = r; });
    }
  } catch(e) { console.warn('Could not read product details:', e.message || e); }
  return out;
};

// ── Product details for rivals' NEW lines, so the Sourcing audit shows them ready ─────────
// Only the lines a rival added today. Skips anything src_products already holds (Sourcing owns
// refreshes). Goes through the Sourcing Worker, which holds the Keepa key. Never takes the token
// bank below 250 (keeps Suz and Mera's runs alive) and never spends more than 300 in one fetch.
const SRC_WORKER = 'https://keepa.jackbithellbusiness.workers.dev/src';   // 9 Nov: bdl-sourcing merged into the keepa Worker (old address gets deleted)
const DETAIL_FLOOR = 250, DETAIL_CAP = 300;
function _detailRow(p){
  if (!p || !p.asin) return null;
  const st = (p.stats && p.stats.current) || [];
  const pos = v => v != null && v > 0;
  // Keepa moved pictures from imagesCSV to an `images` list — read both, as Sourcing does.
  const img = (p.imagesCSV || '').split(',')[0] || ((p.images && p.images[0] && (p.images[0].l || p.images[0].m)) || '');
  const cents = pos(st[18]) ? st[18] : pos(st[0]) ? st[0] : pos(st[1]) ? st[1] : null;
  return { asin: p.asin, domain: 2,
    title: (p.title || '').slice(0, 300), brand: (p.brand || '').slice(0, 80),
    image: img ? 'https://m.media-amazon.com/images/I/' + img : '',
    price: cents == null ? null : Math.round(cents) / 100,
    rank: pos(st[3]) ? st[3] : null,
    root: (p.categoryTree && p.categoryTree[0] && p.categoryTree[0].name) || '',
    mo: p.monthlySold || null,
    fba: pos(st[11]) ? st[11] : null,
    source: 'keepa', fetched_at: new Date().toISOString() };
}
window._detailsForNew = async function(asins){
  const res = { ok:false, fetched:0, skipped:0, known:0, tokens:0 };
  try {
    if (!supabase) { res.error = 'not connected'; return res; }
    const want = [...new Set((asins || []).filter(a => /^[A-Z0-9]{10}$/.test(a)))];
    if (!want.length) { res.ok = true; return res; }
    const have = new Set();
    for (let i = 0; i < want.length; i += 150) {
      const { data, error } = await supabase.from('src_products').select('asin').in('asin', want.slice(i, i + 150));
      if (error) throw error;
      (data || []).forEach(r => have.add(r.asin));
    }
    const need = want.filter(a => !have.has(a));
    res.known = want.length - need.length;
    if (!need.length) { res.ok = true; return res; }

    const h = await (await fetch(SRC_WORKER + '/health', { cache:'no-store' })).json();
    let left = Number(h && h.tokensLeft);
    if (!Number.isFinite(left)) throw new Error('could not read the Keepa token balance');
    const take = need.slice(0, Math.min(DETAIL_CAP, Math.max(0, left - DETAIL_FLOOR)));
    res.skipped = need.length - take.length;

    const rows = [];
    for (let i = 0; i < take.length; i += 100) {
      const batch = take.slice(i, i + 100);
      if (left - batch.length < DETAIL_FLOOR) { res.skipped += take.length - i; break; }
      const r = await fetch(`${SRC_WORKER}/keepa?path=product&domain=2&stats=90&history=0&cache=read&maxHours=168&asin=${batch.join(',')}&app=oa`, { cache:'no-store' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) throw new Error((j.error && (j.error.message || j.error)) || `Keepa replied ${r.status}`);
      res.tokens += j.tokensConsumed || 0;
      if (j.tokensLeft != null) left = j.tokensLeft;
      res.cached = (res.cached || 0) + ((j.cache && j.cache.hits) || 0);   // cache=read (Keepa Discord, 10 Nov): any ASIN another app pulled in the last 7 days comes back free
      (j.products || []).forEach(p => { const row = _detailRow(p); if (row) rows.push(row); });
    }
    // One batched write — row-by-row writes are what silently lost saves in this app before.
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await supabase.from('src_products').upsert(rows.slice(i, i + 500));
      if (error) throw error;
    }
    res.fetched = rows.length; res.ok = true;
    return res;
  } catch(e) {
    console.error('Product details for new lines failed:', e);
    res.error = e.message || String(e);
    return res;
  }
};

// Record what a fetch saw. `lists` = [{sellerId, asins:[every ASIN on their storefront]}].
// Only rivals whose storefront actually came back are passed in, so a failed lookup can never
// mark a whole shelf as gone.
window._shelfApply = async function(today, lists){
  const res = { ok:false, rivals:0, added:0, gone:0, back:0, baselined:0, skipped:[], newAsins:[] };
  try {
    if (!supabase) { res.error = 'not connected'; return res; }
    if (window._hasShelfTable === false) { res.error = 'the rival shelves table is not set up yet'; return res; }
    if (!lists || !lists.length) { res.ok = true; return res; }
    const ids = [...new Set(lists.map(l => l.sellerId))];
    const cut7 = _shiftDate(today, -7);
    const rows = await _shelfSelectAll(() => supabase.from('bdl_competitor_shelf')
      .select('id,seller_id,asin,gone_on').in('seller_id', ids)
      .or(`gone_on.is.null,gone_on.gte.${cut7}`).order('id'));

    const by = {};
    rows.forEach(r => {
      const s = by[r.seller_id] = by[r.seller_id] || { open:new Map(), recent:new Map() };
      if (r.gone_on == null) s.open.set(r.asin, r.id);
      else if (!s.recent.has(r.asin)) s.recent.set(r.asin, r.id);
    });

    const inserts = [], closeIds = [], reopenIds = [];
    for (const { sellerId, asins } of lists) {
      const cur = new Set((asins || []).filter(a => /^[A-Z0-9]{10}$/.test(a)));
      if (!cur.size) { res.skipped.push(sellerId); continue; }
      const s = by[sellerId] || { open:new Map(), recent:new Map() };
      // A shelf that suddenly comes back at half its usual size is Keepa having a bad day, not
      // the rival clearing out. Closing hundreds of lines on that would fake a mass exodus and
      // then flood the next fetch with "new" leads that were there all along.
      if (s.open.size >= 20 && cur.size < s.open.size * 0.5) { res.skipped.push(sellerId); continue; }
      const baseline = s.open.size === 0 && s.recent.size === 0;
      cur.forEach(a => {
        if (s.open.has(a)) return;
        // Back within 7 days = it never really left (Keepa's lists blink). Reopen, don't re-add.
        if (s.recent.has(a)) { reopenIds.push(s.recent.get(a)); res.back++; return; }
        inserts.push({ seller_id:sellerId, asin:a, first_seen:today, baseline });
        if (!baseline) res.newAsins.push(a);
        if (baseline) res.baselined++; else res.added++;
      });
      s.open.forEach((id, a) => { if (!cur.has(a)) { closeIds.push(id); res.gone++; } });
      res.rivals++;
    }

    // Batched — row-by-row writes are what silently lost saves in this app before.
    for (let i = 0; i < reopenIds.length; i += 300) {
      const { error } = await supabase.from('bdl_competitor_shelf').update({ gone_on:null }).in('id', reopenIds.slice(i, i + 300));
      if (error) throw error;
    }
    for (let i = 0; i < closeIds.length; i += 300) {
      const { error } = await supabase.from('bdl_competitor_shelf').update({ gone_on:today }).in('id', closeIds.slice(i, i + 300));
      if (error) throw error;
    }
    for (let i = 0; i < inserts.length; i += 500) {
      const { error } = await supabase.from('bdl_competitor_shelf').insert(inserts.slice(i, i + 500));
      if (error) throw error;
    }
    // Keep it bounded: lines that left more than a year ago are no use to anyone.
    await supabase.from('bdl_competitor_shelf').delete().lt('gone_on', _shiftDate(today, -365));
    res.ok = true;
    return res;
  } catch(e) {
    console.error('Rival shelf save failed:', e);
    res.error = e.message || String(e);
    return res;
  }
};

// Renaming a competitor in the list has to follow through to their stored readings.
// The tables group history by the name on each reading, so a rename without this leaves
// the seller split in two — half their series under the old name, half under the new.
// A straight UPDATE, never a delete-and-reinsert; the readings themselves are untouched.
window._supabaseRenameSellerHistory = async function(sellerId, newName) {
  try {
    if (!supabase || !sellerId || !newName) return false;
    const { error } = await supabase.from('bdl_competitor_readings')
      .update({ seller_name: newName }).eq('seller_id', sellerId);
    if (error) { console.error('Rename history failed:', error.message); return false; }
    COMPETITOR_SESSIONS.forEach(s => (s.competitors||[]).forEach(c => { if (c.sellerId===sellerId) c.name=newName; }));
    return true;
  } catch(e) { console.error('Rename history error:', e); return false; }
};

// Permanently remove one seller's readings and shared-product lists. Only ever called
// after the user picks "Delete history too" and confirms — removing a seller from the
// list on its own leaves every row of this alone.
window._supabaseDeleteSellerHistory = async function(sellerId) {
  try {
    if (!supabase || !sellerId) return false;
    const { error } = await supabase.from('bdl_competitor_readings').delete().eq('seller_id', sellerId);
    if (error) { console.error('Delete seller readings failed:', error.message); return false; }
    if (window._hasCompAsinTable) {
      const { error: aErr } = await supabase.from('bdl_competitor_asins').delete().eq('seller_id', sellerId);
      // The percentages are the record that matters; a stranded ASIN row is cosmetic.
      if (aErr) console.warn('Shared-product rows for this seller could not be removed:', aErr.message);
    }
    if (window._hasShelfTable) {
      const { error: shErr } = await supabase.from('bdl_competitor_shelf').delete().eq('seller_id', sellerId);
      if (shErr) console.warn('Saved shelf for this seller could not be removed:', shErr.message);
    }
    COMPETITOR_SESSIONS.forEach(s => { if (s.competitors) s.competitors = s.competitors.filter(c => c.sellerId!==sellerId); });
    Object.keys(COMPETITOR_ASINS||{}).forEach(d => { delete COMPETITOR_ASINS[d][sellerId]; });
    return true;
  } catch(e) { console.error('Delete seller history error:', e); return false; }
};

// Delete a competitor session (and its readings) by date
window._supabaseDeleteSession = async function(date) {
  try {
    if (!supabase) return false;
    // Look up the session id first so we can remove its readings, then the session row
    const { data: sess } = await supabase.from('bdl_competitor_sessions').select('id').eq('date', date).single();
    if (sess && sess.id) {
      const { error: rErr } = await supabase.from('bdl_competitor_readings').delete().eq('session_id', sess.id);
      // Stop if the readings survived — deleting the session alone would orphan them.
      if (rErr) { console.error('Session readings delete failed:', rErr.message); return false; }
    }
    const { error } = await supabase.from('bdl_competitor_sessions').delete().eq('date', date);
    if (error) { console.error('Session delete failed:', error.message); return false; }
    return true;
  } catch(e) {
    console.error('Supabase session delete error:', e);
    return false;
  }
};

// Delete a single inventory snapshot (by its unique date)
window._supabaseDeleteSnapshot = async function(date) {
  try {
    if (!supabase) return false;
    const { error } = await supabase.from('bdl_snapshots').delete().eq('date', date);
    if (error) { console.error('Snapshot delete failed:', error.message); return false; }
    // Its SKU detail and provider figures go with it (deleting only the snapshot left orphan
    // provider imports that the Provider page kept counting).
    const r1 = await supabase.from('bdl_snapshot_skus').delete().eq('date', date);
    if (r1.error) console.warn('SKU detail for', date, 'not removed:', r1.error.message);
    const r2 = await supabase.from('bdl_provider_snapshots').delete().eq('date', date);
    if (r2.error) console.warn('Provider figures for', date, 'not removed:', r2.error.message);
    return true;
  } catch(e) {
    console.error('Supabase snapshot delete error:', e);
    return false;
  }
};

// Delete a single provider snapshot row (by date + provider)
window._supabaseDeleteProvider = async function(date, provider) {
  try {
    if (!supabase) return false;
    const { error } = await supabase.from('bdl_provider_snapshots').delete().eq('date', date).eq('provider_name', provider);
    if (error) { console.error('Provider snapshot delete failed:', error.message); return false; }
    return true;
  } catch(e) {
    console.error('Supabase provider delete error:', e);
    return false;
  }
};

// Delete every provider snapshot for a given provider name
window._supabaseDeleteProviderAll = async function(provider) {
  try {
    if (!supabase) return false;
    const { error } = await supabase.from('bdl_provider_snapshots').delete().eq('provider_name', provider);
    if (error) { console.error('Provider delete-all failed:', error.message); return false; }
    return true;
  } catch(e) {
    console.error('Supabase provider delete-all error:', e);
    return false;
  }
};

// Delete ALL provider snapshot data (all rows, all providers, all dates)
window._supabaseNukeProviderSnapshots = async function() {
  try {
    if (!supabase) { console.error('Supabase not initialised'); return false; }
    // neq('provider_name','') matches every row (all providers have a name)
    const { error } = await supabase
      .from('bdl_provider_snapshots')
      .delete()
      .neq('provider_name', '');
    if (error) throw error;
    return true;
  } catch(e) {
    console.error('Supabase nuke provider snapshots error:', e);
    return false;
  }
};

// Save (upsert) one provider's classification rules (aliases/stems/title keywords) for the SKU importer
window._supabaseSaveProviderRule = async function(rule) {
  try {
    if (!supabase || !rule || !rule.name) return false;
    const { error } = await supabase.from('bdl_provider_rules').upsert({
      provider_name: rule.name,
      aliases: rule.aliases || [],
      stems: rule.stems || [],
      title_keywords: rule.titleKeywords || [],
      updated_at: new Date().toISOString()
    }, { onConflict: 'provider_name' });
    if (error) { console.error('Provider rule save failed:', error.message); return false; }
    return true;
  } catch(e) {
    console.error('Supabase provider rule save error:', e);
    return false;
  }
};

// Save the master provider list (bdl_providers): active (ordered) + archived. Deletes only names in neither.
window._supabaseSaveProviderDefs = async function(activeDefs, archivedNames, allowEmpty) {
  try {
    if (!supabase) return false;
    activeDefs = activeDefs || [];
    archivedNames = archivedNames || [];

    // Both lists empty is almost always a load that failed, not a genuine "delete every
    // provider" — so refuse by default. Callers that really did empty the list (deleting the
    // last provider) pass allowEmpty:true.
    if (!activeDefs.length && !archivedNames.length && !allowEmpty) {
      console.warn('Provider defs save skipped: nothing to save (refusing to clear all providers)');
      return false;
    }

    // Batched, same as the other tables — one request instead of one per provider.
    const now = new Date().toISOString();
    const rowMap = new Map();
    activeDefs.forEach((n, i) => rowMap.set(n, { name: n, provider_order: i, archived: false, updated_at: now }));
    archivedNames.forEach((n, i) => rowMap.set(n, { name: n, provider_order: 1000 + i, archived: true, updated_at: now }));
    const rows = [...rowMap.values()];

    const { error: upErr } = await supabase.from('bdl_providers').upsert(rows, { onConflict: 'name' });
    if (upErr) { console.error('Provider defs save error:', upErr.message); return false; }

    // Remove provider rows that are no longer in either list — in a single delete.
    const { data: existing, error: selErr } = await supabase.from('bdl_providers').select('name');
    if (selErr) { console.error('Provider defs cleanup skipped:', selErr.message); return true; }
    const keep = new Set([...activeDefs, ...archivedNames].map(n => n.toLowerCase()));
    const drop = (existing || []).map(r => r.name).filter(n => !keep.has((n || '').toLowerCase()));
    if (drop.length) {
      const { error: delErr } = await supabase.from('bdl_providers').delete().in('name', drop);
      if (delErr) console.error('Provider defs cleanup failed:', delErr.message);
    }
    return true;
  } catch(e) {
    console.error('Supabase provider defs save error:', e);
    return false;
  }
};

// Load data from Supabase
window._supabaseLoad = async function() {
  try {
    
    if (!supabase) {
      console.warn('Supabase not initialized - returning empty data');
      return {
        snapshots: [],
        sellers: [],
        competitorSessions: [],
        readings: [],
        providerSnapshots: [],
        providerDefs: [],
        providerArchived: [],
        providerRules: []
      };
    }
    
    // Load all tables in PARALLEL — these are independent queries, so running them
    // together instead of one-after-another cuts startup time dramatically.
    const [
      snapRes, sellRes, sessRes, readRes, provSnapRes, provDefRes, provRuleRes, compAsinRes
    ] = await Promise.all([
      supabase.from('bdl_snapshots').select('*').order('date', { ascending: true }),
      supabase.from('bdl_sellers').select('*'),
      supabase.from('bdl_competitor_sessions').select('*').order('date', { ascending: true }),
      supabase.from('bdl_competitor_readings').select('*'),
      supabase.from('bdl_provider_snapshots').select('*').order('date', { ascending: true }),
      supabase.from('bdl_providers').select('*').order('provider_order', { ascending: true }),
      // provider_rules isolated: if the table is missing it must not fail the whole load
      supabase.from('bdl_provider_rules').select('*').then(r=>r, ()=>({data:[],error:null})),
      // competitor ASIN detail — same treatment; the app works fine without it
      supabase.from('bdl_competitor_asins').select('*').then(r=>r, ()=>({data:[],error:null}))
    ]);

    const snapshots = snapRes.data;   if (snapRes.error) throw snapRes.error;
    const sellers   = sellRes.data;   if (sellRes.error) throw sellRes.error;
    const sessions  = sessRes.data;   if (sessRes.error) throw sessRes.error;
    const readings  = readRes.data;   if (readRes.error) throw readRes.error;
    const providerSnaps = provSnapRes.data; if (provSnapRes.error) throw provSnapRes.error;
    const provDefs  = provDefRes.data; if (provDefRes.error) throw provDefRes.error;
    let provRules = [];
    if (provRuleRes && !provRuleRes.error && provRuleRes.data) provRules = provRuleRes.data;
    else if (provRuleRes && provRuleRes.error) console.warn('bdl_provider_rules unavailable (run the migration?) — continuing without learned rules');

    // Shared-ASIN detail per competitor per date. Absent until the migration is run.
    window._hasCompAsinTable = !!(compAsinRes && !compAsinRes.error);
    const compAsins = {};
    if (window._hasCompAsinTable) {
      (compAsinRes.data||[]).forEach(r => {
        (compAsins[r.date] = compAsins[r.date] || {})[r.seller_id] =
          { size: r.catalogue_size, asins: r.shared_asins || [] };
      });
    } else {
      console.warn('bdl_competitor_asins not found — run the migration to store shared-ASIN detail.');
    }

    // Detect whether the inbound columns have been migrated yet. select('*') returns every
    // column, so the presence of the key on a real row is the reliable test.
    if (snapshots && snapshots.length) {
      window._hasAsinAgeCols = Object.prototype.hasOwnProperty.call(snapshots[0], 'ageing_asin_a0');
      window._hasInboundCols = Object.prototype.hasOwnProperty.call(snapshots[0], 'inbound_units');
    } else {
      // No rows to inspect (fresh table). Ask the schema directly rather than guessing —
      // selecting a missing column errors instead of returning data.
      const probe = await supabase.from('bdl_snapshots').select('inbound_units').limit(1);
      window._hasInboundCols = !probe.error;
      const aProbe = await supabase.from('bdl_snapshots').select('ageing_asin_a0').limit(1);
      window._hasAsinAgeCols = !aProbe.error;
    }
    if (!window._hasAsinAgeCols) console.warn('bdl_snapshots.ageing_asin_* not found — run the SQL migration to store ASIN-level ageing. Everything else saves normally.');
    if (!window._hasInboundCols) console.warn('bdl_snapshots.inbound_units / inbound_value not found — run the SQL migration to enable inbound tracking. Everything else saves normally.');

    const competitorSessions = sessions?.map(s => {
      const sessionReadings = readings?.filter(r => r.session_id === s.id) || [];
      return {
        date: s.date,
        competitors: sessionReadings.map(r => ({
          sellerId: r.seller_id,
          name: r.seller_name,
          pct: parseFloat(r.overlap_pct)
        }))
      };
    }) || [];

    // Baseline for the "only rewrite what changed" check in _supabaseSave. Refreshed on every
    // load so any reload path (startup, post-save refresh, bulk update) stays in step.
    window._readingSigs = new Map(competitorSessions.map(s => [s.date, _readingSig(s)]));

    return {
      snapshots: snapshots?.map(s => ({
        date: s.date,
        asins: s.asins,
        skus: s.skus,
        avgCost: s.avg_cost,
        stockValue: s.stock_value,
        totalUnits: s.total_units,
        inboundUnits: s.inbound_units ?? null,
        inboundValue: s.inbound_value ?? null,
        ageing: {
          a0: s.ageing_a0,
          a31: s.ageing_a31,
          a61: s.ageing_a61,
          a91: s.ageing_a91,
          a181: s.ageing_a181,
          a271: s.ageing_a271,
          a365: s.ageing_a365
        },
        // null, not 0 — a snapshot taken before ASIN capture has no ASIN figure at all
        ageingAsin: (s.ageing_asin_a0 ?? null) === null ? null : {
          a0: s.ageing_asin_a0||0, a31: s.ageing_asin_a31||0, a61: s.ageing_asin_a61||0,
          a91: s.ageing_asin_a91||0, a181: s.ageing_asin_a181||0,
          a271: s.ageing_asin_a271||0, a365: s.ageing_asin_a365||0
        },
        ageingValue: {
          a0: s.ageing_value_a0||0,
          a31: s.ageing_value_a31||0,
          a61: s.ageing_value_a61||0,
          a91: s.ageing_value_a91||0,
          a181: s.ageing_value_a181||0,
          a271: s.ageing_value_a271||0,
          a365: s.ageing_value_a365||0
        },
        repricer: {
          total: s.repricer_total,
          matching: s.repricer_matching,
          winning: s.repricer_winning,
          winPct: s.repricer_win_pct,
          matchPct: s.repricer_match_pct
        },
        notes: s.notes
      })) || [],
      sellers: sellers?.sort((a, b) => (a.seller_order || 0) - (b.seller_order || 0)).map(s => ({ sellerId: s.seller_id, name: s.name })) || [],
      competitorSessions,
      providerSnapshots: providerSnaps?.map(p => ({
        date: p.date,
        provider: p.provider_name,
        skus: p.sku_count || 0,
        value: p.total_valuation || 0,
        notes: p.notes || ''
      })) || [],
      providerDefs: (provDefs||[]).slice().sort((a,b)=>(a.provider_order||0)-(b.provider_order||0)).filter(p=>!p.archived).map(p => p.name),
      providerArchived: (provDefs||[]).slice().sort((a,b)=>(a.provider_order||0)-(b.provider_order||0)).filter(p=>p.archived).map(p => p.name),
      competitorAsins: compAsins,
      providerRules: (provRules||[]).map(r => ({
        name: r.provider_name,
        aliases: r.aliases || [],
        stems: r.stems || [],
        titleKeywords: r.title_keywords || []
      }))
    };
  } catch(e) {
    console.error('Supabase load error:', e);
    return null;
  }
};

window._fbReady = true;

// Load data from Supabase on startup (after DOM is ready)
window._startupLoad = async function() {
  // Only call showSyncStatus if element exists
  const syncEl = document.getElementById('syncStatus');
  if (syncEl) showSyncStatus('loading');
  
  const data = await window._supabaseLoad();
  if (data) {
    DATA_LOADED = true;
    DB = data.snapshots || [];
    SELLERS = data.sellers || [];
    COMPETITOR_SESSIONS = data.competitorSessions || [];
    PROVIDER_SNAPSHOTS = data.providerSnapshots || [];
    PROVIDER_DEFS = data.providerDefs || [];
    ARCHIVED_PROVIDERS = data.providerArchived || [];
    PROVIDER_RULES = data.providerRules || [];
    COMPETITOR_ASINS = data.competitorAsins || {};
    loadShelfLeads();   // not awaited — the page must not wait on it
    if (typeof loadSnapSkus === 'function') loadSnapSkus();   // same — Stock Health redraws when it lands

    // One-time seed: if no providers have ever been set up (fresh Supabase project),
    // load the 17 known defaults with their aliases/stems so the importer works out of
    // the box. Never runs again once any provider exists — fully yours to edit after this.
    if (PROVIDER_DEFS.length === 0 && ARCHIVED_PROVIDERS.length === 0) {
      try {
        PROVIDER_DEFS = DEFAULT_PROVIDERS.map(p => p.name);
        PROVIDER_RULES = DEFAULT_PROVIDERS.map(p => ({
          name: p.name, aliases: p.aliases||[], stems: p.stems||[], titleKeywords: p.titleKeywords||[]
        }));
        await window._supabaseSaveProviderDefs(PROVIDER_DEFS, ARCHIVED_PROVIDERS);
        for (const r of PROVIDER_RULES) { await window._supabaseSaveProviderRule(r); }
      } catch(seedErr) {
        console.error('Default provider seed failed:', seedErr);
      }
    }

    // Safety net: a provider can end up with zero aliases/stems/titleKeywords if an earlier
    // seed or save partially failed (e.g. one of the per-provider Supabase calls dropped).
    // That leaves it silently unmatchable forever, since the one-time seed above only fires
    // when PROVIDER_DEFS is completely empty. On every load, top up any known default
    // provider that currently has empty rules — never touches providers you've since edited
    // (a provider with at least one alias/stem/keyword, even one you typed yourself, is left
    // alone) and never touches non-default provider names.
    try {
      let backfilled = [];
      for (const name of PROVIDER_DEFS) {
        const def = DEFAULT_PROVIDERS.find(p => p.name.toLowerCase() === name.toLowerCase());
        if (!def) continue; // not one of the known defaults, nothing to backfill from
        // Some defaults (PS) ship with no aliases/stems of their own. Backfilling from those
        // writes an empty rule, which still looks empty on the next load — so this used to
        // re-run and re-save on every single page load. Skip them; they need a real rule
        // typed in Settings, which no backfill can invent.
        if (!(def.aliases||[]).length && !(def.stems||[]).length && !(def.titleKeywords||[]).length) continue;
        const existing = PROVIDER_RULES.find(r => r.name.toLowerCase() === name.toLowerCase());
        const isEmpty = !existing || (
          (!existing.aliases || existing.aliases.length===0) &&
          (!existing.stems || existing.stems.length===0) &&
          (!existing.titleKeywords || existing.titleKeywords.length===0)
        );
        if (isEmpty) {
          const rule = { name, aliases:[...(def.aliases||[])], stems:[...(def.stems||[])], titleKeywords:[...(def.titleKeywords||[])] };
          if (existing) Object.assign(existing, rule); else PROVIDER_RULES.push(rule);
          await window._supabaseSaveProviderRule(rule);
          backfilled.push(name);
        }
      }
      if (backfilled.length) {
        console.warn('Backfilled empty matching rules for:', backfilled.join(', '));
      }
    } catch(backfillErr) {
      console.error('Provider rule backfill failed:', backfillErr);
    }
    // Update badges immediately after loading data
    if (document.getElementById('compHistNavBadge')) {
      document.getElementById('compHistNavBadge').textContent = COMPETITOR_SESSIONS.length;
    }
  } else {
    // The load failed. Nothing is in memory, so nothing in memory is authoritative — anything
    // saved from here would be saving over real data with a blank slate.
    DATA_LOADED = false;
    console.error('Startup load returned nothing — the app is running with no data.');
  }
  if (syncEl) hideSyncStatus();
  
  // Set default to Last 30 days
  const now = new Date();
  const d30 = new Date(now);
  d30.setDate(d30.getDate() - 30);
  rangeFrom = d30.toLocaleDateString('en-CA');
  rangeTo = now.toLocaleDateString('en-CA');
  
  const rangeFromEl = document.getElementById('rangeFrom');
  const rangeToEl = document.getElementById('rangeTo');
  if (rangeFromEl) rangeFromEl.value = rangeFrom;
  if (rangeToEl) rangeToEl.value = rangeTo;
  
  // Mark "Last 30d" preset as active
  const last30Btn = document.querySelector('[onclick*="last30"]');
  if (last30Btn) {
    document.querySelectorAll('header .range-preset').forEach(b => b.classList.remove('active'));
    last30Btn.classList.add('active');
  }
  
  // Only render if DOM elements exist — isolate each so one failure can't block the others
  const safeRun = (fn, label) => { try { fn(); } catch(e) { console.error(label + ' render error:', e); } };
  safeRun(renderAll, 'renderAll');
  safeRun(renderHistory, 'renderHistory');
  safeRun(renderCompTab, 'renderCompTab');
  safeRun(renderCompHistory, 'renderCompHistory');
  safeRun(renderProviderTab, 'renderProviderTab');
  safeRun(renderSettingsTab, 'renderSettingsTab');
  safeRun(renderBadges, 'renderBadges');

  // Data loaded and first render done — fade out the boot loader
  hideBootLoader();
};

function hideBootLoader(){
  const el = document.getElementById('bootLoader');
  if (!el) return;
  el.style.opacity = '0';
  setTimeout(()=>{ el.style.display='none'; }, 380);
}

// Call startup after DOM is ready. Guard so the boot loader always hides,
// even if the data load throws — otherwise the spinner would spin forever.
document.addEventListener('DOMContentLoaded', () => {
  // Failsafe: hide the loader no matter what after 12s
  const failsafe = setTimeout(hideBootLoader, 12000);
  Promise.resolve(window._startupLoad())
    .catch(err => {
      console.error('Startup load failed:', err);
      const msg = document.getElementById('bootLoaderMsg');
      if (msg) msg.textContent = 'Had trouble loading — showing what we have';
    })
    .finally(() => { clearTimeout(failsafe); hideBootLoader(); });
});
