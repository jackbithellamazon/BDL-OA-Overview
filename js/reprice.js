/* ═══════════════════════════════════════════════════════════════════════════════════════════════
   REPRICER TOOL — provider by provider, the way Jack reprices (23 Oct 2026)
   For every ASIN he holds: what the market is doing, how many units sit ahead of him, what the last
   year looked like (every sale dip, when, how deep, one-off or regular), and a call in his words —
   wait / drop to £X / hold at £X / get out at £X — made by the rules he set on 10 real ASINs:
     1. wait if it will still sell at your price; never drop into a loss just to go faster
     2. count UNITS ahead against sales speed: if the cheaper stock clears in ~2 weeks, price at the
        next cluster up (GoPro → £195), don't undercut to the bottom; fewer sellers = wait
     3. Amazon below your break-even → sit just above the lowest FBA seller (Philips ~£420), not at break-even
     4. get out when it only ever goes one way, or won't recover before your limit (G915 X, Huawei)
     5. Black Friday is a known deep dip for electronics — warn before it
   28 Oct (his answers): no profit floor, no loss limit, no age rule — "it's per ASIN, per graph". So:
     · FBA only — FBM sellers aren't in the queue or the units ahead
     · each listing's own normal price and its usual sales; one of its usual sales → wait it out, don't follow it down
     · the deepest drop in a year, or sellers piling in → flagged for a fresh look, never waited out blindly
     · busy months (Thermos in winter, gift sets before Christmas) → clear before they end
     · every check keeps the one before, so the page says what moved (Buy Box, FBA sellers, Amazon, the call)
     · what YOU sold per SKU, from Sarah's uploads
   The 90-day clock starts when stock lands at Amazon (Sarah's ageing file), same as Stock Health.
   Sarah can see all of it; only Jack's laptop (one-time unlock) can spend Keepa tokens or record a call.
   ═══════════════════════════════════════════════════════════════════════════════════════════════ */

const RP_WORKER = 'https://keepa.jackbithellbusiness.workers.dev/src';   // 9 Nov: bdl-sourcing merged into the keepa Worker (old address gets deleted)
const RP_TOK0 = 11;                       // Keepa tokens per ASIN for the full check — measured 10 Nov: 7 when Keepa's offers are fresh, 8 when it fetches (≤10 sellers), 14 with >10 sellers; 28 Oct average 10.6
const rpTok = () => { try { const m = JSON.parse(localStorage.getItem('oaRepTok') || 'null'); if (m && m.n >= 20) return Math.max(5, Math.min(14, Math.round(m.t / m.n))); } catch(e) {} return RP_TOK0; };
function rpTokSave(t, n){ if (!(t > 0) || !(n > 0)) return; try { const m = JSON.parse(localStorage.getItem('oaRepTok') || '{"t":0,"n":0}'); m.t += t; m.n += n;
  if (m.n > 300) { m.t = m.t * 300 / m.n; m.n = 300; } localStorage.setItem('oaRepTok', JSON.stringify(m)); } catch(e) {} }   // the last ~300 full checks
const RP_TOK_MAX = 14;                   // the worst case, used to keep the bank above RP_KEEP
const RP_KEEP = 400;                     // Jack, 13 Nov: "over 1,200 tokens would empty my bucket — drip feed it". 18 Nov: "it should be able to go down to
                                         // around 500 … maybe 400 actually" — a check spends down to 400, then goes at the refill speed (21 a minute ≈ 2 products a minute),
                                         // so 400 always stays free for the Discord cards, the VAs and the 9pm run
const RP_LOOK_D = 14;                    // Jack, 13 Nov: "anything we can cache to save tokens". A re-check within 14 days of the last FULL check starts with a
                                         // 1-token look (Amazon, lowest price, seller counts); nothing moved = the full check is kept, something moved = full check
const RP_FLOOR = 250;                    // never take the shared token bank below this — the VAs and the Discord trackers need it (agreed with the Keepa Discord chat, 6 Nov)
const RP_UNLOCK = 'oaRepricerUnlocked';
const RP_FRESH_H = 24;   // Jack, 10 Nov: "we might already have looked at that ASIN a day ago" — a check younger than this is reused, not paid for again
// Selling fine = at your own pace (Sarah's uploads) the units go before day 90 — and, until Black Friday is over,
// before 20 Nov too (a product still here on Black Friday needs its graph). Jack, 10 Nov: "limit as much tokens as possible".
function rpSellingFine(h){
  const os = RP.hist ? rpOwnSales().asin[h.asin] : null;
  if (!os || os.days < 14 || !(os.sold > 0) || !(h.units > 0)) return null;
  const rate = os.sold / os.days, clears = h.units / rate, now = rpMs(rpToday());
  const to90 = h.day90 ? (rpMs(h.day90) - now) / RP_DAY : null, toBF = (rpMs(RP_BF.start) - now) / RP_DAY;
  let limit = to90 == null ? 30 : to90 >= 0 ? to90 : 21;
  if (rpToday() < RP_BF.end) limit = Math.min(limit, Math.max(0, toBF));
  return clears <= limit ? { clears:Math.max(1, Math.round(clears)), sold:os.sold, days:os.days } : null;
}
// Under 30 days at Amazon: Jack doesn't audit those (10 Nov: "under 30 days i don't really audit… or i might ask to do it on certain ones")
const RP_YOUNG_D = 25;   // Jack 18 Nov: "under 25 days pls, so I wanna see 30 days now" (was 30)
const rpYoung = h => h.age != null && h.age < RP_YOUNG_D;
const rpFresh = a => { const x = RP.data[a]; return !!(x && x.checked_at && Date.now() - Date.parse(x.checked_at) < RP_FRESH_H * 36e5); };
const rpLookable = a => { const x = RP.data[a]; return !!(x && x.data && x.data.sig && x.data.checked && Date.now() - Date.parse(x.data.checked) < RP_LOOK_D * 864e5); };
const rpFullAt = rec => Date.parse((rec.data && rec.data.checked) || rec.checked_at);   // the last FULL check — a quick look that found nothing new doesn't reset Jack's decisions
const RP_WORD = 'lavarion';
function rpPref(k, d){ try { return localStorage.getItem(k) || d; } catch(e) { return d; } }
function rpPrefSet(k, v){ try { localStorage.setItem(k, v); } catch(e) {} }
const RP = { plain:{}, queue:[], nb:new Set(), np:new Set(), data:{}, settings:{}, decisions:[], hist:null, loaded:false, loading:false, prov:null, band:null, mode:'prov', filter:rpPref('oaRepFilter', 'all'), sort:rpPref('oaRepSort', 'new'), run:null, zoom:{}, noTables:false, mem:false, open:null, lim:10, openDone:{}, order:[] };
const rpCanAct = () => { try { return localStorage.getItem(RP_UNLOCK) === '1'; } catch(e) { return false; } };
const RP_DAY = 864e5;
const rpDay = ms => new Date(ms).toISOString().slice(0, 10);
const rpMs = d => Date.parse(d + 'T12:00:00Z');
const rpToday = () => new Date().toLocaleDateString('en-CA');
const rpKt = m => (m + 21564000) * 60000;              // Keepa minutes → ms
const rpGBP = v => v == null || !isFinite(v) ? '—' : (v < 0 ? '−£' : '£') + Math.abs(v).toLocaleString('en-GB', { minimumFractionDigits:2, maximumFractionDigits:2 });   // £1,185.29
const rpGBP0 = v => v == null || !isFinite(v) ? '—' : (v < 0 ? '−' : '') + fmtGBP(Math.abs(v));
const rpEsc = t => kfEsc(t);
const RP_EVENTS = [
  ['Prime Day', '2025-07-08', '2025-07-11'], ['Prime Big Deal Days', '2025-10-07', '2025-10-08'], ['Black Friday', '2025-11-20', '2025-12-01'],
  ['Boxing Day / January sales', '2025-12-26', '2026-01-10'], ['Spring Deal Days', '2026-03-20', '2026-03-31'], ['Prime Day', '2026-07-07', '2026-07-12'],
  ['Prime Big Deal Days', '2026-10-06', '2026-10-09'], ['Black Friday', '2026-11-19', '2026-11-30'], ['Boxing Day / January sales', '2026-12-26', '2027-01-10'] ];
const RP_BF = { start:'2026-11-19', end:'2026-11-30', lastStart:'2025-11-20', lastEnd:'2025-12-01' };   // Jack 18 Nov: Black Friday starts the 19th this year (amazon.co.uk/blackfriday: Black Friday Week runs from 19 Nov to 30 Nov)
const RP_BF_PREV = { from:'2025-10-20', n:104 };   // 20 Oct 2025 → 31 Jan 2026: the run-up, Black Friday, December, January

// ── The few numbers a 1-token look also returns, kept with every full check so next week's look can say "nothing moved" ──
function rpSig(p){
  const c = (p.stats && p.stats.current) || [], e = p.buyBoxEligibleOfferCounts || [], o = {};
  if (c.length > 0) o.amz = c[0] > 0 ? c[0] : -1;            // Amazon's own price (-1 = Amazon not selling)
  if (c.length > 1) o.nw = c[1] > 0 ? c[1] : -1;             // lowest new price
  if (c.length > 11 && c[11] >= 0) o.oc = c[11];             // how many new offers
  if (e.length) o.fba = e[0];                                // FBA sellers
  return o;
}
// null = nothing moved; otherwise what moved (or why we can't tell) — a full check follows
function rpMoved(a, b){
  if (!a || !b) return 'no earlier figures';
  const ks = ['amz', 'nw', 'oc', 'fba'].filter(k => a[k] != null && b[k] != null);
  if (ks.length < 2) return 'not enough to compare';
  const pc = (x, y) => x > 0 && y > 0 ? Math.abs(y - x) / x > 0.02 : (x > 0) !== (y > 0);
  const out = [];
  if (ks.includes('amz') && pc(a.amz, b.amz)) out.push('Amazon');
  if (ks.includes('nw') && pc(a.nw, b.nw)) out.push('lowest price');
  if (ks.includes('oc') && Math.abs(a.oc - b.oc) >= 2) out.push('sellers');
  if (ks.includes('fba') && Math.abs(a.fba - b.fba) >= 2) out.push('FBA sellers');
  return out.length ? out.join(', ') : null;
}
async function rpWaitBank(need){   // drip: spend down to RP_KEEP, then wait for the refill
  let blind = 0, seen = null;
  RP.run.need = need; const ph = RP.run.phase;
  for (;;) {
    if (RP.run.stop) break;
    let left = null, rate = 21;
    const hl = await fetch(`${RP_WORKER}/health`, { cache:'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null);
    if (hl && hl.tokensLeft != null) { left = hl.tokensLeft; rate = hl.refillRate || 21; rpBankSet(hl.tokensLeft, hl.refillRate, hl.refillIn, 'live'); }
    else { const row = window._bankLogRead ? await window._bankLogRead().catch(() => null) : null;   // the free 5-minute log, less a safety margin
      if (row && row.tokens_left != null && Date.now() - Date.parse(row.at) < 10 * 60000) left = row.tokens_left - 150; }
    if (left == null) { if (++blind > 10) { RP.run.stop = true; RP.run.why = "couldn't read the Keepa bank — stopped so nothing is spent blind"; break; }
      RP.run.wait = 1; RP.run.phase = 'blind'; renderRepRun(); await new Promise(r => setTimeout(r, 30000)); continue; }
    if (rp9pm()) { RP.run.phase = 'pause9'; RP.run.wait = 1; renderRepRun(); await new Promise(r => setTimeout(r, 60000)); continue; }   // the competitor run owns the bank then
    if (left - need >= RP_KEEP) { seen = left; break; }
    RP.run.wait = Math.ceil((need + RP_KEEP - left) / rate); RP.run.phase = 'wait';
    renderRepRun();
    // sleep until Keepa should have added enough (it adds `rate` once a minute), not a blind 30 s
    const ms = rpBankWaitMs(need + RP_KEEP);
    await new Promise(r => setTimeout(r, Math.max(3000, Math.min(60000, ms == null ? 30000 : ms + 1500))));
  }
  RP.run.wait = 0; RP.run.need = 0; RP.run.phase = ph;
  return seen;
}
// Sun / Tue / Thu 21:00–22:00 UK: the 9pm competitor run uses the bank — a check waits it out (Keepa chat: "times to avoid")
function rp9pm(t){
  const p = new Intl.DateTimeFormat('en-GB', { timeZone:'Europe/London', weekday:'short', hour:'2-digit', hour12:false }).formatToParts(new Date(t || Date.now()));
  const wd = (p.find(x => x.type === 'weekday') || {}).value, hr = +((p.find(x => x.type === 'hour') || {}).value);
  return ['Sun', 'Tue', 'Thu'].includes(wd) && hr === 21;
}
// ── The Keepa bank, live: Keepa says how many are left and when the next refill lands (/health, and every check reply) ──
function rpBankSet(left, rate, refillIn, src){
  if (left == null || !isFinite(left)) return;
  rate = rate || 21; const now = Date.now();
  RP.bank = { left, rate, max:rate * 60, at:now, refillAt: refillIn != null && refillIn >= 0 ? now + refillIn : null, src };
  if (typeof rpBankPaint === 'function') rpBankPaint();   // the status box shows Keepa's own figure the moment it arrives
}
const rpRefills = (b, t) => b.refillAt ? (t < b.refillAt ? 0 : 1 + Math.floor((t - b.refillAt) / 60000)) : Math.floor((t - b.at) / 60000);
function rpNextRefillMs(){ const b = RP.bank, t = Date.now(); if (!b || b.err || !b.refillAt) return null; return t < b.refillAt ? b.refillAt - t : 60000 - ((t - b.refillAt) % 60000); }
// how long until the bank holds `target` — refills land once a minute
function rpBankWaitMs(target){
  const b = RP.bank, now = rpBankNow(); if (now == null) return null;
  if (now >= target) return 0;
  const n = Math.ceil((target - now) / b.rate), nx = rpNextRefillMs();
  return (nx == null ? 60000 : nx) + (n - 1) * 60000;
}
const rpMMSS = ms => { const s = Math.max(0, Math.round(ms / 1000)); return s >= 3600 ? `${Math.floor(s / 3600)}h ${String(Math.floor(s % 3600 / 60)).padStart(2, '0')}m` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

// ── Amazon deals (Jack 18 Nov: "if any of these ASINs Amazon is on a sale / ltd … I wanna know, and the date it ends") ──
// Free: Keepa's `deals` + `coupon` come back in the same reply the check already pays for. Keepa gives the badge as
// Amazon shows it ("Early Black Friday", "Limited time deal", "Ends in 06:25:51"); an end date only on countdown
// badges (or when Keepa has endTime) — the 17 Nov 9pm run had 73 deals, 0 with an end date, 2 countdowns.
const RP_AMZ_ID = 'A3P5ROKL5A1OLE';
function rpDeal(p, asOf){
  const st = p.stats || {}, now = asOf || Date.now();
  const ds = (Array.isArray(p.deals) ? p.deals : []).filter(d => d && (d.badge || d.dealType));
  const cp = Array.isArray(p.coupon) ? p.coupon : null;
  const coupon = cp && (cp[0] || cp[1]) ? { one: cp[0] || 0, sns: cp[1] || 0 } : null;
  if (!ds.length && !coupon) return null;
  const items = ds.map(d => {
    let end = d.endTime ? rpKt(d.endTime) : null, left = false;
    const m = !end && /ends in\s*(?:(\d+)\s*d(?:ays?)?\s*,?\s*)?(\d+):(\d\d)(?::(\d\d))?/i.exec(d.badge || '');
    if (m) { end = now + (((+m[1] || 0) * 24 + (+m[2])) * 3600 + (+m[3]) * 60 + (+m[4] || 0)) * 1000; left = true; }
    return { badge: left ? 'Countdown deal' : String(d.badge || d.dealType || 'Deal').slice(0, 60), type: d.dealType || null, prime: /PRIME/.test(d.accessType || ''),
      end: end ? new Date(end).toISOString() : null, fromCountdown: left, start: d.startTime ? new Date(rpKt(d.startTime)).toISOString() : null,
      claimed: d.percentClaimed != null ? d.percentClaimed : null };
  });
  const avg = st.avg90 && st.avg90[0] > 0 ? st.avg90[0] / 100 : null;
  return { amz: (st.buyBoxSellerId || null) === RP_AMZ_ID, bb: st.buyBoxSellerId || null, items, coupon, amzAvg90: avg, seen: new Date(now).toISOString() };
}
// checks saved before deals were kept (v67ag): fill the deal from the shared cache's copy of that same check — free
async function rpDealBackfill(){
  if (!window._cacheDeals) return;
  const need = Object.entries(RP.data).filter(([a, x]) => x && x.data && !('deal' in x.data) && Date.now() - rpFullAt(x) < 3 * 864e5).map(([a]) => a);
  if (!need.length) return;
  const got = await window._cacheDeals(need).catch(() => ({}));
  let n = 0;
  need.forEach(a => { const c = got[a], x = RP.data[a]; if (!c || !x) return;
    if (Math.abs(Date.parse(c.fetched_at) - rpFullAt(x)) > 6 * 36e5) return;   // only the copy from that same check
    x.data.deal = rpDeal({ deals: c.deals, coupon: c.coupon, stats: { buyBoxSellerId: c.bb, avg90: c.avg90 } }, Date.parse(c.fetched_at)); n++; });
  if (n && !RP.run) rpRender();   // during a check the page stays still — they show with the results
}
// what each kind of deal is, in plain words (Keepa's dealType; new ones fall back to the badge)
const RP_DEAL_KIND = { SPECIAL_EVENT_SALE:'an event price for Black Friday: the price drops for the event and usually goes back after it',
  LIMITED_TIME_DEAL:'a Limited time deal: a cut price for a set spell, and Amazon only shows a countdown near the end',
  COUNTDOWN_ENDS_IN:'a deal in its last hours: Amazon is showing the countdown',
  PRIME_EXCLUSIVE:'a Prime-only price', PRIME_DAY:'a Prime Day deal', PRIME_DAY_EARLY:'an early Prime Day deal', EARLY_ACCESS_WITH_PRIME:'an early-access price for Prime members',
  SELLING_FAST:'a deal that is selling fast', PRIME_SELLING_FAST:'a Prime deal that is selling fast', CLEARANCE_NO_RETURNS:'a clearance price (no returns)',
  APP_ONLY:'an app-only price', GENERIC_OFFER_PROMO:'a promotion on the offer' };
const rpDealKind = x => RP_DEAL_KIND[x.type] || (x.claimed != null ? 'a Lightning deal: limited stock' : 'a deal');
const rpDealEndWords = x => x.end ? (Date.parse(x.end) > Date.now() ? `It ends about ${rpWhen(x.end)}.` : '') : rpEventEnd(x) ? `${rpEventEnd(x).replace(/ \(Amazon's date\)$/, '')} (Amazon's date, not this product's).` : 'No end date yet: Amazon shows a countdown near the end.';
// one line for "why it hasn't sold": the drop is a deal, and whose
function rpDealWhy(rec){
  const dl = rpDealOn(rec); if (!dl) return '';
  const x = dl.items[0], sn = rpAmzSince(rec.data);
  return ` <span class="rpk-dwhy">That's ${dl.amz ? "Amazon's own" : "the Buy Box seller's"} <b>${rpEsc(x.badge)}</b> deal${sn && sn.was > sn.now && dl.amz ? `: Amazon went ${rpGBP(sn.was)} → ${rpGBP(sn.now)} on ${fmtShort(sn.at)}` : ''}. ${rpDealEndWords(x)}</span>`;
}
// the deal on a saved record, if it's still running (no end date = as of the check)
function rpDealOn(rec){
  const dl = rec && rec.data && rec.data.deal; if (!dl || !dl.items || !dl.items.length) return null;
  const live = dl.items.filter(x => !x.end || Date.parse(x.end) > Date.now());
  return live.length ? { ...dl, items: live } : null;
}
const rpCouponTxt = c => !c ? '' : [c.one ? (c.one > 0 ? `${rpGBP(c.one / 100)} off` : `${-c.one}% off`) : '', c.sns ? `S&S ${c.sns > 0 ? rpGBP(c.sns / 100) + ' off' : -c.sns + '% off'}` : ''].filter(Boolean).join(' · ') + ' coupon';
const rpWhen = iso => new Date(iso).toLocaleString('en-GB', { weekday:'short', day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });
function rpDealHtml(h, rec){
  const d = rec.data, dl = d.deal; if (!dl) return '';
  const on = rpDealOn(rec), ended = dl.items.length && !on;
  const who = dl.amz ? 'Amazon' : 'Buy Box';
  const amz = d.amzNow, pc = amz != null && dl.amzAvg90 ? Math.round((1 - amz / dl.amzAvg90) * 100) : null;
  const parts = [];
  (on ? on.items : dl.items).forEach(x => {
    const bits = [`<b>${rpEsc(x.badge)}</b>`];
    if (x.prime) bits.push('Prime members only');
    if (x.claimed != null) bits.push(`${x.claimed}% claimed`);
    if (x.end) bits.push(Date.parse(x.end) > Date.now() ? `ends about <b>${rpWhen(x.end)}</b>${x.fromCountdown ? ' (from the countdown at the check)' : ''}` : `ended ${rpWhen(x.end)}`);
    else bits.push(rpEventEnd(x) ? `no date for this product — ${rpEventEnd(x)}` : 'no end date — Amazon only shows a countdown near the end');
    parts.push(bits.join(' · '));
  });
  const sn = rpAmzSince(d);
  const price = dl.amz && amz != null ? `Amazon ${rpGBP(amz)}${pc != null && pc >= 3 ? ` — <b>${pc}% under</b> its 90-day ${rpGBP(dl.amzAvg90)}` : ''}${sn && sn.was > sn.now ? ` · down from ${rpGBP(sn.was)} on ${fmtShort(sn.at)}` : ''}` : !dl.amz && dl.items.length ? 'the deal is on the Buy Box offer, not Amazon' : '';
  const kind = (on ? on.items : dl.items)[0] ? `<span class="rpk-dkind">${dl.amz ? 'Amazon is selling it itself at' : 'The Buy Box seller has'} ${rpDealKind((on ? on.items : dl.items)[0])}.</span>` : '';
  const cpn = dl.coupon ? rpCouponTxt(dl.coupon) : '';
  return `<div class="rpk-deal rpk-pad${ended ? ' off' : ''}" title="From Keepa at the check — the badge as Amazon shows it. Deals change fast: re-check to see if it's still on.">
    <span class="rpk-dtag">${ended ? 'Deal ended' : dl.items.length ? `${who} deal` : 'Coupon'}</span>
    <span>${parts.join('<br>')}${parts.length && (price || cpn) ? '<br>' : ''}${[price, cpn].filter(Boolean).join(' · ')}<em> · seen at the check ${rpAgo(dl.seen)}</em>${kind && !ended ? `<br>${kind}` : ''}</span></div>`;
}

// Black Friday badges carry no date per product — checked 18 Nov on the Amazon pages themselves (a Limited time deal and an
// Early Black Friday deal: no end date anywhere) and in Keepa's lightning-deal list (12 tokens, 0 of 12 in it).
// The only dates are Amazon's own event dates: the site banner counts down to 18 Nov 23:00 ("Black Friday Week starts in"),
// and amazon.co.uk/blackfriday says "Black Friday Week runs from 19 Nov to 30 Nov".
const RP_AMZ_BFW = { start:'2026-11-18T23:00:00Z', end:'2026-11-30T23:59:00Z' };
const rpEventEnd = x => {
  const b = x.badge || '', early = /early\s*black\s*friday/i.test(b);
  if (early && Date.now() < Date.parse(RP_AMZ_BFW.start)) return `Early Black Friday ends when Black Friday Week starts, ${rpWhen(RP_AMZ_BFW.start)} (Amazon's date)`;
  if (/black\s*friday|cyber\s*monday/i.test(b)) return `Black Friday Week runs to Mon 30 Nov (Amazon's date)`;
  return '';
};
// when Amazon's price last changed before the check (from the daily Amazon line) — "Amazon £199 since 14 Nov, was £306"
function rpAmzSince(d){
  const a = d.amz || [], n = a.length, now = a[n - 1]; if (!n || !(now > 0)) return null;
  let k = n - 1; while (k > 0 && a[k - 1] > 0 && Math.abs(a[k - 1] - now) / now <= 0.02) k--;   // pennies either way aren't a move
  if (k === 0 || !(a[k - 1] > now)) return null;                                                  // only a drop counts
  return { at: rpDay(rpMs(d.start) + k * RP_DAY), was: a[k - 1] / 100, now: now / 100 };
}
// Jack 18 Nov: "ASINs I bought are back on an offer or deal until x date" — one list at the top of the Repricer page
function rpDealsPanel(all, key){
  const rows = all.map(h => ({ h, on: rpDealOn(RP.data[h.asin]) })).filter(x => x.on);
  if (!rows.length) return '';
  const endOf = x => { const e = x.on.items.map(i => i.end).filter(Boolean).sort()[0]; if (e) return Date.parse(e);
    const ev = rpEventEnd(x.on.items[0]); return ev ? (/^Early/.test(ev) ? Date.parse(RP_AMZ_BFW.start) : Date.parse(RP_AMZ_BFW.end)) + 1 : Infinity; };   // a real end first, then the event's
  rows.sort((a, b) => endOf(a) - endOf(b) || b.h.value - a.h.value);
  const checked = all.filter(h => RP.data[h.asin]).length, val = rows.reduce((t, x) => t + x.h.value, 0);
  const lim = RP.dealsAll ? rows.length : 6;
  const go = a => `RP['${key}']='${RP_ALL}';RP.nb.clear();RP.np.clear();RP.showLeft=false;RP.open=null;RP.lim=500;RP.filter='deal';renderRepTool();setTimeout(()=>document.getElementById('rp_${a}')?.scrollIntoView({behavior:'smooth',block:'start'}),60)`;
  const line = ({ h, on }) => {
    const rec = RP.data[h.asin], d = rec.data, it = on.items[0], sn = rpAmzSince(d);
    const end = on.items.map(i => i.end).filter(Boolean).sort()[0];
    const ev = rpEventEnd(it);
    const until = end ? `until <b>${rpWhen(end)}</b>` : ev ? `<span class="rp-ev">${/^Early/.test(ev) ? `about <b>${rpWhen(RP_AMZ_BFW.start)}</b><small>Black Friday Week starts (Amazon)</small>` : `to <b>Mon 30 Nov</b><small>Black Friday Week ends (Amazon)</small>`}</span>` : '<span class="rp-dim">no date yet<small>countdown shows near the end</small></span>';
    const pc = d.amzNow != null && on.amzAvg90 ? Math.round((1 - d.amzNow / on.amzAvg90) * 100) : null;
    const amz = on.amz && d.amzNow != null ? `Amazon <b>${rpGBP(d.amzNow)}</b>${pc != null && pc >= 3 ? ` <span class="rp-dn">−${pc}%</span>` : ''}${sn && sn.was && sn.was > sn.now ? `<small>since ${fmtShort(sn.at)}, was ${rpGBP(sn.was)}</small>` : ''}` : on.amz ? 'Amazon' : '<span class="rp-dim">Buy Box seller, not Amazon</span>';
    return `<button class="rp-dl" onclick="${go(h.asin)}" title="${rpEsc((d.title || h.title || h.asin) + ' — open the card')}">
      <span class="n">${rpEsc(d.title || h.title || h.asin)}<small>${[...h.providers].map(rpEsc).join(' · ')} · ${h.units} unit${h.units !== 1 ? 's' : ''}</small></span>
      <span class="b">${rpEsc(it.badge)}${on.items.length > 1 ? ` +${on.items.length - 1}` : ''}${it.prime ? ' · Prime' : ''}${it.claimed != null ? ` · ${it.claimed}% claimed` : ''}</span>
      <span class="u">${until}</span><span class="m">${amz}</span><span class="v">${rpGBP0(h.value)}</span><span class="s">${rpAgo(on.seen)}</span></button>`;
  };
  const min = rpPref('oaRepDealsMin', '') === '1';
  return `<div class="rp-deals${min ? ' min' : ''}">
    <div class="rp-dh"><span class="rpk-dtag">On a deal now</span><b>${rows.length}</b> of what you hold · <b>${rpGBP0(val)}</b> tied up
      <span class="rp-dim">— from each product's last Keepa check (${checked} of ${all.length} checked; the rest aren't known until checked). Soonest to end first. Click one for its card.</span>
      <button class="rp-dtog" onclick="rpPrefSet('oaRepDealsMin','${min ? '' : '1'}');rpRender()">${min ? 'Show the list' : 'Hide the list'}</button></div>
    <div class="rp-dlh"><span>Product</span><span>Deal</span><span>Until</span><span>Amazon now</span><span>Tied up</span><span>Seen</span></div>
    ${rows.slice(0, lim).map(line).join('')}
    ${rows.length > 6 ? `<button class="rp-dmore" onclick="RP.dealsAll=!RP.dealsAll;renderRepTool()">${RP.dealsAll ? 'Show fewer' : `Show all ${rows.length}`}</button>` : ''}
  </div>`;
}

// ── Keepa product → the compact record saved per ASIN ─────────────────────────────────────────
function rpCompact(p){
  const now = Date.now(), start = now - 365 * RP_DAY;
  const daily = (arr, step) => {
    const out = new Array(366).fill(-1);
    if (!arr || !arr.length) return out;
    const pts = [];
    for (let i = 0; i < arr.length; i += step) {
      let v = arr[i + 1];
      if (step === 3 && v >= 0 && arr[i + 2] > 0) v += arr[i + 2];
      pts.push([rpKt(arr[i]), v]);
    }
    let j = 0;
    for (let k = 0; k <= 365; k++) {
      const t = start + k * RP_DAY;
      while (j + 1 < pts.length && pts[j + 1][0] <= t) j++;
      out[k] = pts[j][0] <= t ? pts[j][1] : -1;
    }
    return out;
  };
  const csv = p.csv || [];
  // last year's Black Friday → January, kept on its own: the year view starts a year ago today, which cuts off
  // the weeks before last Black Friday (10 Nov: every product said "no history")
  const dailyFrom = (arr, step, from, n) => { const out = new Array(n).fill(-1); if (!arr || !arr.length) return out; const pts = [];
    for (let i = 0; i < arr.length; i += step) { let v = arr[i + 1]; if (step === 3 && v >= 0 && arr[i + 2] > 0) v += arr[i + 2]; pts.push([rpKt(arr[i]), v]); }
    let j = 0; for (let k = 0; k < n; k++) { const t = from + k * RP_DAY; while (j + 1 < pts.length && pts[j + 1][0] <= t) j++; out[k] = pts[j][0] <= t ? pts[j][1] : -1; } return out; };
  const bfFrom = rpMs(RP_BF_PREV.from);
  // Jack 18 Nov: "I wanna see a year and a half too" — the 182 days before the year, kept apart so every rule still reads one year
  const x18from = start - 182 * RP_DAY;
  const x18 = { start: rpDay(x18from), bb: dailyFrom(csv[18], 3, x18from, 182), amz: dailyFrom(csv[0], 2, x18from, 182), fba: dailyFrom(csv[10], 2, x18from, 182), oc: dailyFrom(csv[11], 2, x18from, 182), rank: dailyFrom(csv[3], 2, x18from, 182) };
  const cnt = csv[11] || [];
  const cntAt = t => { let v = null; for (let i = 0; i < cnt.length; i += 2) { if (rpKt(cnt[i]) <= t) v = cnt[i + 1]; else break; } return v; };
  const LO = p.liveOffersOrder || [], OF = p.offers || [];
  const loOK = LO.length === OF.length && LO.every(i => Number.isInteger(i) && i >= 0 && i < OF.length);
  const live = p._onlyLive ? (loOK ? LO.map(i => OF[i]) : OF) : LO.map(i => OF[i]);   // only-live-offers=1 → every offer is live
  const offers = live.filter(o => o && o.condition === 1).map(o => {
    const c = o.offerCSV || [], st = o.stockCSV || [];
    return { p: c.length >= 3 ? (c[c.length - 2] + Math.max(0, c[c.length - 1])) / 100 : null, s: st.length ? st[st.length - 1] : null,
      fba: !!o.isFBA, amz: !!o.isAmazon, me: o.sellerId === KEEPA_ME, prime: !!o.isPrime };
  }).filter(o => o.p != null).sort((a, b) => a.p - b.p);
  const ms = p.monthlySoldHistory || [], sold = [];
  for (let i = 0; i < ms.length; i += 2) sold.push([rpDay(rpKt(ms[i])).slice(0, 7), ms[i + 1]]);
  const cur = (p.stats && p.stats.current) || [];
  const img = p.images && p.images[0] ? (p.images[0].m || p.images[0].l) : (p.imagesCSV ? p.imagesCSV.split(',')[0] : null);
  const amzOffer = offers.find(o => o.amz);
  return { v:2, sig:rpSig(p), deal:rpDeal(p), asin:p.asin, title:p.title || '', image: img ? 'https://m.media-amazon.com/images/I/' + img : null, checked:new Date().toISOString(),
    ref:(p.referralFeePercent || p.referralFeePercentage || 15) / 100, pp:((p.fbaFees || {}).pickAndPackFee || 0) / 100,
    bbNow: cur[18] > 0 ? cur[18] / 100 : null, amzNow: cur[0] > 0 ? cur[0] / 100 : null, amzStock: amzOffer ? amzOffer.s : null,
    monthlySold: p.monthlySold > 0 ? p.monthlySold : null, rank: cur[3] > 0 ? cur[3] : null,
    offerCnt: { now: cur[11] > 0 ? cur[11] : cntAt(now), d14: cntAt(now - 14 * RP_DAY), d30: cntAt(now - 30 * RP_DAY) },
    start: rpDay(start), bb: daily(csv[18], 3), amz: daily(csv[0], 2), fba: daily(csv[10], 2), oc: daily(csv[11], 2), rank: daily(csv[3], 2), bfPrev: { from:RP_BF_PREV.from, bb: dailyFrom(csv[18], 3, bfFrom, RP_BF_PREV.n), amz: dailyFrom(csv[0], 2, bfFrom, RP_BF_PREV.n) }, x18, offers, sold };
}
// FBA sellers only (Jack: "FBA only") — Amazon and you not counted
function rpFbaStats(d){
  const o = (d.offers || []).filter(x => x.fba && !x.amz && !x.me);
  return { n:o.length, units:o.reduce((t, x) => t + (x.s ?? 1), 0), low:o.length ? o[0].p : null, fbm:(d.offers || []).filter(x => !x.fba && !x.amz && !x.me).length };
}
// What the last check said, kept on the new one so the page can say what moved since
function rpPrevOf(h, old){
  const od = old.data, r = h ? rpCall(h, old) : null, f = rpFbaStats(od);
  return { checked:od.checked, bb:od.bbNow, amzBB: r ? r.amzHasBB : null, fbaN:f.n, fbaUnits:f.units, fbaLow:f.low, offers:od.offerCnt ? od.offerCnt.now : null,
    kind: r && r.call ? r.call.kind : null, price: r && r.call ? r.call.price : null };
}

// ── The SKUs Jack holds, from Sarah's newest ageing file, grouped by ASIN ─────────────────────
function rpCostFromSku(sku){
  const t = String(sku || '').split(/[_\-]/);
  for (let i = 1; i < t.length; i++) if (/^\d+(\.\d+)?$/.test(t[i])) { const v = parseFloat(t[i]); if (v > 0 && v < 5000) return v; }
  return null;
}
// Retailer_Cost_DDMM(Y)_Target_Provider_Qty — e.g. Amuk_51.99_15086_77_THC_09 = £51.99, bought 15/08/26,
// target £77, THC, 9 units. Anything that doesn't fit stays null (about 1 in 10 SKUs).
function rpSkuParts(sku, landed){
  const t = String(sku || '').split('_'), out = { target:null, bought:null, buyDate:null };
  const num = x => /^\d+(\.\d+)?$/.test(x || '') ? parseFloat(x) : null;
  if (t.length < 4 || num(t[1]) == null) return out;
  let ti = 3;
  if (/^\d{4,5}$/.test(t[2])) {
    const dd = +t[2].slice(0, 2), mm = +t[2].slice(2, 4);
    if (dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12) {
      let y = t[2].length === 5 ? 2020 + +t[2][4] : +(landed || rpToday()).slice(0, 4);
      let d = `${y}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
      if (t[2].length === 4 && landed && d > landed) d = `${y - 1}${d.slice(4)}`;
      out.buyDate = d;
    }
  } else ti = 2;
  const tg = num(t[ti]); if (tg && tg > 0) out.target = tg;
  for (let i = t.length - 1; i >= ti + 1; i--) if (/^\d{1,3}$/.test(t[i])) { out.bought = parseInt(t[i], 10); break; }
  return out;
}
function rpHoldings(){
  const latest = shAllSnaps().filter(x => SNAP_SKUS[x.date]).slice(-1)[0];
  if (!latest) return null;
  const lk = impBuildLookup();
  const by = {}, left = {};
  for (const r of SNAP_SKUS[latest.date]) {
    if (!r[1] || !(r[4] > 0)) continue;
    const prov = shProvName(r, lk);
    if (prov === 'Lavarion') { left[r[1]] = left[r[1]] || { asin:r[1], title:r[6] || '', value:0, why:'Lavarion' }; left[r[1]].value += skuVal(r); continue; }
    const units = r[4], net = r[3] || 0;
    const cost = rpCostFromSku(r[0]) ?? (units ? net * VAT_IN / units : null);   // name cost is VAT-inc; the file's is net
    const a = by[r[1]] = by[r[1]] || { asin:r[1], title:r[6] || '', skus:[], units:0, value:0, providers:new Set() };
    a.skus.push({ sku:r[0], units, cost, landed:r[5] || null, band:r[2], provider:prov, value:skuVal(r), ...rpSkuParts(r[0], r[5]) });
    a.units += units; a.value += skuVal(r); a.providers.add(prov);
  }
  Object.values(by).forEach(a => {
    const known = a.skus.filter(s => s.cost != null);
    a.cost = known.length ? known.reduce((t, s) => t + s.cost * s.units, 0) / Math.max(1, known.reduce((t, s) => t + s.units, 0)) : null;
    const landed = a.skus.map(s => s.landed).filter(Boolean).sort();
    a.landed = landed[0] || null;
    a.day90 = a.landed ? rpDay(rpMs(a.landed) + 90 * RP_DAY) : null;
    a.day180 = a.landed ? rpDay(rpMs(a.landed) + 180 * RP_DAY) : null;
    a.age = a.landed ? Math.round((rpMs(rpToday()) - rpMs(a.landed)) / RP_DAY) : null;
  });
  // own bundles (PLUB): Amazon-made SKU, no provider, a "Name – what's in it" title — e.g. the gift hampers.
  // Jack can put any back, or leave any other one out, from the page (saved as a skip / unskip call).
  Object.values(by).forEach(a => {
    const sk = RP.decisions.find(x => x.asin === a.asin && !x.sku && (x.action === 'skip' || x.action === 'unskip'));
    const auto = a.providers.size === 1 && a.providers.has('Not matched') && / – /.test(a.title) && a.skus.some(s => RP_AMZ_SKU.test(s.sku));
    if (sk ? sk.action === 'skip' : auto) { left[a.asin] = { asin:a.asin, title:a.title, value:a.value, why: sk ? 'you left it out' : 'your own bundle' }; delete by[a.asin]; }
  });
  return { date: latest.date, by, left };
}
const RP_AMZ_SKU = /^[A-Z0-9]{2}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;   // the SKU Amazon makes when you list without one
async function rpSkip(asin, out){ await rpDecide2(asin, out ? 'skip' : 'unskip'); }

// ── Money: the STK way (checked against his STK screens to the penny) ─────────────────────────
// profit = price − (cost + 50p prep) − (referral × price + pick & pack) × 1.02 − VAT on the margin;
// +12p festive peak on parcels from 15 Oct to 14 Jan.
function rpPP(d){ const t = rpToday(), peak = t >= '2026-10-15' && t <= '2027-01-14' && d.pp > 2.95; return d.pp + (peak ? 0.12 : 0); }
function rpProfit(P, cost, d){ if (P == null || cost == null) return null; const cog = cost + 0.5; return P - cog - (d.ref * P + rpPP(d)) * 1.02 - (P - cog) / 6; }
function rpBreakeven(cost, d){ if (cost == null) return null; let lo = 0, hi = 5000; for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; if (rpProfit(m, cost, d) < 0) lo = m; else hi = m; } return Math.ceil(hi * 100) / 100; }

// ── What the last year says ───────────────────────────────────────────────────────────────────
function rpPatterns(d, myPrice, landed){
  const bb = d.bb.map(v => v > 0 ? v / 100 : null), s0 = rpMs(d.start);
  const dayOf = k => rpDay(s0 + k * RP_DAY);
  const med = a => { const v = a.filter(x => x != null).sort((x, y) => x - y); return v.length ? v[Math.floor(v.length / 2)] : null; };
  const dips = []; let run = null;
  for (let k = 0; k < bb.length; k++) {
    const v = bb[k], base = med(bb.slice(Math.max(0, k - 60), k));
    if (v != null && base != null && v <= 0.92 * base) {
      if (run && k - run.endK <= 2) { run.endK = k; run.min = Math.min(run.min, v); }
      else { run = { startK:k, endK:k, min:v, base }; dips.push(run); }
    }
  }
  dips.forEach(x => { x.start = dayOf(x.startK); x.end = dayOf(x.endK); x.days = x.endK - x.startK + 1; x.depth = 1 - x.min / x.base;
    x.event = (RP_EVENTS.find(e => x.start <= rpDay(rpMs(e[2]) + 3 * RP_DAY) && x.end >= rpDay(rpMs(e[1]) - 3 * RP_DAY)) || [])[0] || null; });
  const share = (n, P) => { const v = bb.slice(-n).filter(x => x != null); return P != null && v.length ? v.filter(x => x >= P - 0.005).length / v.length * 100 : null; };
  const months = [];
  for (let k = 0; k < bb.length; k++) { const m = dayOf(k).slice(0, 7); let o = months[months.length - 1]; if (!o || o.m !== m) months.push(o = { m, v:[] }); if (bb[k] != null) o.v.push(bb[k]); }
  months.forEach(o => { o.min = o.v.length ? Math.min(...o.v) : null; o.med = med(o.v); o.at = myPrice != null ? o.v.filter(x => x >= myPrice - 0.005).length : null; });
  const full = months.filter(o => o.v.length >= 10);
  const mins = full.slice(-4).map(o => o.min);
  const lowsFalling = mins.length >= 3 && mins.every((v, i) => i === 0 || v <= mins[i - 1] * 1.01) && mins[mins.length - 1] < mins[0] * 0.95;
  const li = landed ? Math.max(0, Math.round((rpMs(landed) - s0) / RP_DAY)) : 0;
  const since = bb.slice(li).filter(x => x != null);
  const bf = dips.find(x => x.event === 'Black Friday' && x.start < '2026-01-01');
  // What's normal for THIS listing and what its sales look like — Jack: "normally £100, min about £85–90,
  // regularly goes on sale to £80 — no point getting out super quick". Every graph has its own shape.
  const last = bb.length - 1, inDip = new Uint8Array(bb.length);
  dips.forEach(x => { for (let k = x.startK; k <= x.endK; k++) inDip[k] = 1; });
  const pct = (a, f) => { const v = a.slice().sort((x, y) => x - y); return v.length ? v[Math.min(v.length - 1, Math.floor(f * v.length))] : null; };
  const curDip = dips.length && dips[dips.length - 1].endK >= last - 1 ? dips[dips.length - 1] : null;
  const ended = dips.filter(x => x !== curDip && x.days <= 30);
  ended.forEach(x => { const after = bb.slice(x.endK + 1, x.endK + 15).filter(v => v != null); x.back = after.length > 0 && Math.max(...after) >= x.base * 0.95; });
  const span = bb.filter(v => v != null).length;
  const sales = ended.length ? { n:ended.length, depth:med(ended.map(x => x.depth)), days:med(ended.map(x => x.days)),
    every: ended.length >= 2 ? Math.round(span / ended.length) : null, back:ended.filter(x => x.back).length, deepest:Math.max(...ended.map(x => x.depth)) } : null;
  const nowV = bb[last] ?? bb[last - 1] ?? null;
  const saleDepth = curDip && nowV != null ? 1 - nowV / curDip.base : null;
  const sale = curDip && curDip.days <= 30 ? { days:curDip.days, depth:saleDepth, base:curDip.base, start:curDip.start,
    biggest: !sales || saleDepth > sales.deepest + 0.03 } : null;
  const m30 = med(bb.slice(-30)), mOld = med(bb.slice(-180, -90));
  const reset = !sale && m30 != null && mOld != null && m30 < mOld * 0.85 ? { from:mOld, to:m30 } : null;
  // normal = the middle half of the days outside sales — the last 4 months, or just the last month after a reset
  const calm = []; for (let k = Math.max(0, bb.length - (reset ? 30 : 120)); k < bb.length; k++) if (bb[k] != null && !inDip[k]) calm.push(bb[k]);
  const normal = calm.length >= 15 ? { lo:pct(calm, .25), mid:pct(calm, .5), hi:pct(calm, .75) } : null;
  // a sale is so far below normal — priced off today's normal, so a year-old sale doesn't sit above it
  if (sales) sales.low = normal ? normal.mid * (1 - sales.depth) : med(ended.map(x => x.min));
  const allV = bb.filter(v => v != null), mAll = med(allV);
  const straight = allV.length >= 60 && dips.length <= 1 && allV.filter(v => Math.abs(v / mAll - 1) <= 0.04).length / allV.length >= 0.9 ? { p:mAll } : null;
  const before = bb.slice(0, -3).filter(v => v != null);
  const lowest = nowV != null && before.length >= 60 && nowV < Math.min(...before) - 0.005;
  return { bb, dips, months, share30: share(30, myPrice), share90: share(90, myPrice), share365: share(365, myPrice),
    lowsFalling, maxSinceLanded: since.length ? Math.max(...since) : null, lastBF: bf || null, regular: dips.length >= 4,
    shareAt: (n, P) => share(n, P), normal, sales, sale, reset, straight, lowest, nowV };
}

// ── Busy months — from Amazon's "bought in past month" line (Thermos in winter, gift sets at Christmas) ──
// The value in force in each of the last 12 full months; busy = at least double the usual month. Gift
// seasons that end in December end on the 20th (last orders that arrive for Christmas).
const RP_MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function rpSeason(d){
  const s = (d.sold || []).slice().sort((a, b) => a[0] < b[0] ? -1 : 1);
  if (s.length < 4) return null;
  const now = rpToday(), y = +now.slice(0, 4), m = +now.slice(5, 7);
  const vals = [];
  for (let i = 12; i >= 1; i--) {
    const mm = ((m - 1 - i) % 12 + 12) % 12 + 1, yy = y + Math.floor((m - 1 - i) / 12), key = `${yy}-${String(mm).padStart(2, '0')}`;
    const inM = s.filter(x => x[0] === key).map(x => Math.max(0, x[1])), prior = s.filter(x => x[0] < key);
    const v = inM.length ? Math.max(...inM) : prior.length ? Math.max(0, prior[prior.length - 1][1]) : null;
    vals.push({ mm, v });
  }
  const known = vals.filter(x => x.v != null);
  if (known.length < 9) return null;
  const sorted = known.map(x => x.v).sort((a, b) => a - b), usual = Math.max(50, sorted[Math.floor(sorted.length / 2)]);
  const busy = new Set(known.filter(x => x.v >= Math.max(usual * 2, usual + 100)).map(x => x.mm));   // double a usual month, and 100+ more
  if (busy.size < 2 || busy.size > 5) return null;
  for (let k = 1; k <= 12; k++) { const a = (k + 10) % 12 + 1, b = k % 12 + 1; if (busy.has(a) && busy.has(b)) busy.add(k); }   // one quiet month between two busy ones still counts
  // the busy months as one run on the calendar (Nov → Feb wraps the year)
  let st = [...busy].find(x => !busy.has((x + 10) % 12 + 1)) ?? [...busy][0], run = [st];
  while (busy.has(run[run.length - 1] % 12 + 1) && run.length < 12) run.push(run[run.length - 1] % 12 + 1);
  if (run.length !== busy.size) return null;   // two separate seasons — leave it to the graph
  const peak = Math.round(known.filter(x => busy.has(x.mm)).reduce((t, x) => t + x.v, 0) / busy.size);
  const quiet = known.filter(x => !busy.has(x.mm)).map(x => x.v).sort((a, b) => a - b), rest = quiet.length ? quiet[Math.floor(quiet.length / 2)] : usual;
  const endM = run[run.length - 1], startM = run[0];
  const endOf = yy => endM === 12 ? `${yy}-12-20` : rpDay(Date.UTC(yy, endM, 0, 12));
  let status, startDate, endDate;
  if (busy.has(m)) { status = 'in'; const yy = endM >= m ? y : y + 1; endDate = endOf(yy); }
  else { const yy = startM > m ? y : y + 1; startDate = `${yy}-${String(startM).padStart(2, '0')}-01`; endDate = endOf(endM >= startM ? yy : yy + 1);
    status = Math.round((rpMs(startDate) - rpMs(now)) / RP_DAY) <= 62 ? 'before' : 'after'; }
  if (status === 'in' && now > endDate) { status = 'after'; startDate = `${y + 1}-${String(startM).padStart(2, '0')}-01`; }
  return { months:run, label:`${RP_MON[startM - 1]}–${RP_MON[endM - 1]}`, startM, endM, peak, rest, status, startDate, endDate,
    daysToEnd: Math.round((rpMs(endDate) - rpMs(now)) / RP_DAY), daysToStart: startDate ? Math.round((rpMs(startDate) - rpMs(now)) / RP_DAY) : 0 };
}

// ── What YOU sold, from Sarah's uploads (each saves units per SKU, from 14 Oct on) ──────────────
// A fall in units between two uploads = sold (or removed); a SKU that drops off the file = sold out.
function rpOwnSales(){
  const hist = RP.hist || {}, n = Object.keys(hist).length;
  if (RP._own && RP._own.n === n) return RP._own;
  const dates = Object.keys(hist).sort().filter(dd => dd >= rpDay(Date.now() - 31 * RP_DAY));
  const sku = {}, asin = {};
  if (dates.length >= 2) {
    const maps = dates.map(dd => { const mp = new Map(); hist[dd].forEach(r => mp.set(r[0], [r[4] || 0, r[1]])); return mp; });
    const all = new Map(); maps.forEach(mp => mp.forEach((v, k) => all.set(k, v[1])));
    all.forEach((a, k) => { let sold = 0, seen = null, prev = 0;
      maps.forEach((mp, i) => { const u = mp.get(k); if (u == null && seen == null) return; const v = u ? u[0] : 0; if (seen != null && v < prev) sold += prev - v; if (seen == null) seen = dates[i]; prev = v; });
      const days = Math.round((rpMs(dates[dates.length - 1]) - rpMs(seen)) / RP_DAY);
      sku[k] = { sold, days };
      if (a) { const o = asin[a] = asin[a] || { sold:0, days:0 }; o.sold += sold; o.days = Math.max(o.days, days); } });
  }
  RP._own = { n, sku, asin, from:dates[0] || null, to:dates[dates.length - 1] || null };
  return RP._own;
}

// ── The queue: FBA units by price, Amazon on its own, FBM not counted (Jack: "FBA only") ───────
const RP_STOCK_CAP = 1000;   // Keepa can't see past 1,000 units in one seller's stock — 1000 means "1,000 or more"
function rpQueue(d){
  const others = d.offers.filter(o => !o.me && !o.amz && o.fba);
  const fbm = d.offers.filter(o => !o.me && !o.amz && !o.fba).length;
  const levels = [];
  others.forEach(o => { const L = levels[levels.length - 1];
    const cap = o.s == null || o.s >= RP_STOCK_CAP;
    if (L && o.p <= L.p * 1.006) { L.units += o.s ?? 1; L.sellers++; L.unknown = L.unknown || cap; }
    else levels.push({ p:o.p, units:o.s ?? 1, sellers:1, unknown:cap }); });
  const amz = d.offers.find(o => o.amz) || null, me = d.offers.find(o => o.me) || null;
  const ahead = P => others.filter(o => o.p < P - 0.005).reduce((t, o) => t + (o.s ?? 1), 0);
  const aheadTxt = P => { const u = ahead(P), more = others.some(o => o.p < P - 0.005 && (o.s == null || o.s >= RP_STOCK_CAP)); return (more ? 'at least ' : '') + u.toLocaleString(); };
  const fbaLow = others.length ? others[0].p : null;
  return { levels, amz, me, ahead, aheadTxt, fbaLow, others, fbm };
}

// ── The call ──────────────────────────────────────────────────────────────────────────────────
function rpDecide(h, d){
  const q = rpQueue(d);
  const myPrice = q.me ? q.me.p : null;
  const mins = h.skus.map(s => RP.settings[s.sku] && RP.settings[s.sku].min_price != null ? +RP.settings[s.sku].min_price : null).filter(v => v != null);
  const myMin = mins.length ? Math.min(...mins) : null;
  const ref = myPrice ?? myMin ?? d.bbNow;
  const pat = rpPatterns(d, ref, h.landed);
  const be = rpBreakeven(h.cost, d);
  const S = d.monthlySold ? d.monthlySold / 30 : null;
  const bb = d.bbNow, amzP = q.amz ? q.amz.p : d.amzNow;
  const amzHasBB = amzP != null && bb != null && Math.abs(amzP - bb) < 0.02;
  const amzPlenty = q.amz && (q.amz.s == null || q.amz.s >= 20);
  const daysTo = dd => dd ? Math.round((rpMs(dd) - rpMs(rpToday())) / RP_DAY) : null;
  const left90 = daysTo(h.day90), left180 = daysTo(h.day180), toBF = daysTo(RP_BF.start);
  const pr = P => rpProfit(P, h.cost, d);
  const clearDays = P => S ? (q.ahead(P) + h.units) / S : null;
  const why = [], warn = [];
  let call = null;
  const out = (P, txt) => { call = { kind:'out', price:P, label:`Get out at ${rpGBP(P)}` }; why.unshift(txt); };

  // 4 · get out: never reached break-even since it landed, or sliding into your limit with a dip ahead
  const outPrice = () => {
    if (amzHasBB && be != null && q.fbaLow != null && be < q.fbaLow) return be;
    const p = q.fbaLow != null ? q.fbaLow - 0.01 : bb;
    return be != null && amzHasBB ? Math.max(be, Math.min(p, bb)) : p;
  };
  if (be != null && pat.maxSinceLanded != null && pat.maxSinceLanded < be - 0.01 && h.age > 45) {
    out(outPrice(), `Since it landed on ${fmt(h.landed)} the Buy Box has never reached your break-even (${rpGBP(be)}) — the best was ${rpGBP(pat.maxSinceLanded)}.`);
  } else if (pat.lowsFalling && (pat.share90 ?? 0) < 5 && (h.age ?? 0) > 45 &&   // a stray day at your price doesn't save a falling product (G915 X: 1 day in 90); no day-90 rule (Jack, 28 Oct)
             ((pat.lastBF && pat.lastBF.depth >= 0.15 && toBF != null && toBF <= 45) || (left180 != null && left180 <= 45))) {
    out(outPrice(), `Each month's low is lower than the last (${pat.months.filter(o => o.v.length >= 10).slice(-4).map(o => rpGBP(o.min)).join(' → ')}) and the Buy Box was at your ${rpGBP(ref)} on ${Math.round((pat.share90 ?? 0) * 0.9)} of the last 90 days.`);
    if (pat.lastBF) why.push(`Black Friday is next: last year it fell ${Math.round(pat.lastBF.depth * 100)}% for ${pat.lastBF.days} days (to ${rpGBP(pat.lastBF.min)}).`);
    if (left180 != null && left180 <= 45) why.push(left180 >= 0 ? `It passes 180 days on ${fmt(h.day180)}.` : `It went past 180 days on ${fmt(h.day180)}.`);
  }

  // 0 · one of its usual sales → wait it out at your price instead of following it down. Not when this sale is
  //     deeper than any in the year, sellers just piled in, or it's dragging on — those need a fresh look.
  const sl = pat.sale, sa = pat.sales, nb = pat.normal;
  const jump = d.offerCnt && d.offerCnt.d14 && d.offerCnt.now && d.offerCnt.now >= d.offerCnt.d14 * 1.3 + 3;
  if (!call && sl && !sl.biggest && !jump && sa && sa.n >= 2 && sa.back / sa.n >= 0.6 && sl.days <= Math.max(sa.days * 2, sa.days + 7)
      && ref != null && nb && ref <= nb.hi * 1.03 && (be == null || nb.mid >= be)) {
    const more = Math.max(1, Math.round(sa.days - sl.days + 1));
    call = { kind:'wait', price:ref, label:`Wait out the sale at ${rpGBP(ref)}` };
    why.push(`This is one of its usual sales: the Buy Box is ${rpGBP(pat.nowV)} (−${Math.round(sl.depth * 100)}%) against a normal ${rpGBP(nb.lo)}–${rpGBP(nb.hi).replace('£', '')}.`);
    why.push(`${sa.n} sale${sa.n > 1 ? 's' : ''} like it in the last year, usually ${sa.days} day${sa.days > 1 ? 's' : ''} long, and the price came back after ${sa.back} of them. This one is ${sl.days} day${sl.days > 1 ? 's' : ''} in${sl.days <= sa.days ? ` — about ${more} more to go` : ' — a bit longer than usual'}.`);
  }

  // 3 · Amazon has the Buy Box below your break-even → sit with the FBA sellers, not at break-even
  if (!call && amzHasBB && be != null && amzP < be) {
    if (q.fbaLow != null && q.fbaLow >= be) {
      const L0 = q.levels[0], L1 = q.levels[1];
      const P = L0.units >= 5 || !L1 ? L0.p - 0.01 : L1.p - 0.01;
      call = { kind: myPrice != null && P < myPrice - 0.5 ? 'drop' : 'hold', price:P, label: (myPrice != null && P < myPrice - 0.5 ? 'Drop to ' : 'Hold at ') + rpGBP(P) };
      why.push(`Amazon has the Buy Box at ${rpGBP(amzP)}${q.amz && q.amz.s != null ? ` (stock reads ${q.amz.s >= 99999 ? 'plenty' : q.amz.s})` : ''} — under your break-even of ${rpGBP(be)}, so following it loses money.`);
      why.push(L0.units >= 5 || !L1 ? `The cheapest FBA sellers are at ${rpGBP(L0.p)} (${L0.units} unit${L0.units !== 1 ? 's' : ''}) — 1p under them puts you first in line when Amazon sells out or goes back up.`
        : `Only ${L0.units} unit${L0.units !== 1 ? 's' : ''} at ${rpGBP(L0.p)}, then ${L1.units} at ${rpGBP(L1.p)} — sit just under ${rpGBP(L1.p)} and let the odd cheap one go first.`);
    } else if ((pat.shareAt(365, be) ?? 0) >= 25) {
      call = { kind:'hold', price:be, label:`Hold at break-even ${rpGBP(be)}` };
      why.push(`Amazon has the Buy Box at ${rpGBP(amzP)}, under your break-even, and FBA sellers are under it too.`);
      why.push(`Over the last year the Buy Box was at or above ${rpGBP(be)} on ${Math.round(pat.shareAt(365, be))}% of days — it has come back before.`);
    } else out(outPrice(), `Amazon has the Buy Box at ${rpGBP(amzP)}, under your break-even, and in the last year it was above ${rpGBP(be)} on only ${Math.round(pat.shareAt(365, be) ?? 0)}% of days.`);
  }

  // 1 + 2 · the queue: are you in line, will the cheaper stock clear soon, is there a cluster to join?
  if (!call) {
    // the next FBA cluster just above the Buy Box (GoPro: £195 against £188) — never a far-off stack
    const cluster = q.levels.find(L => bb != null && L.p > bb + 0.01 && L.p <= bb * 1.12 && (be == null || L.p >= be) && L.units >= Math.max(5, Math.min(h.units, 20)) && S && q.ahead(L.p) / S <= 14);
    const offerFall = d.offerCnt.d30 && d.offerCnt.now && d.offerCnt.now < d.offerCnt.d30 * 0.85;
    const sellsSoon = myPrice != null && S && q.ahead(myPrice) / S <= 14 && (pr(myPrice) ?? 1) > 0;
    if (myPrice != null && bb != null && myPrice <= bb + 0.01) {
      call = { kind:'wait', price:myPrice, label:`Wait at ${rpGBP(myPrice)}` };
      why.push(`You're at or under the Buy Box (${rpGBP(bb)}) — you're in the rotation.`);
    } else if (cluster && (myPrice == null || cluster.p > myPrice + 0.01 || !sellsSoon)) {
      // a cluster ABOVE you is money left on the table (GoPro → £195); one below only when your price won't sell soon
      const up = myPrice != null && cluster.p > myPrice + 0.01;
      call = { kind: up ? 'raise' : 'drop', price:cluster.p, label: `${up ? 'Raise to' : 'Drop to'} ${rpGBP(cluster.p)}` };
      why.push(`Only ${q.aheadTxt(cluster.p)} unit${q.ahead(cluster.p) !== 1 ? 's' : ''} sit under ${rpGBP(cluster.p)}, then ${cluster.units.toLocaleString()}${cluster.unknown ? '+' : ''} at ${rpGBP(cluster.p)}. At about ${Math.round(S * 30).toLocaleString()} a month the cheaper ones go in about ${Math.max(1, Math.round(q.ahead(cluster.p) / S))} day${Math.max(1, Math.round(q.ahead(cluster.p) / S)) === 1 ? '' : 's'} and the Buy Box moves up to ${rpGBP(cluster.p)} — sit there, don't undercut to the bottom.`);
      if (offerFall) why.push(`Sellers falling: ${d.offerCnt.d30} → ${d.offerCnt.now} over 30 days.`);
    } else if (sellsSoon) {
      call = { kind:'wait', price:myPrice, label:`Wait at ${rpGBP(myPrice)}` };
      why.push(`${q.aheadTxt(myPrice)} unit${q.ahead(myPrice) !== 1 ? 's' : ''} ahead of you; at about ${Math.round(S * 30).toLocaleString()} a month they clear in about ${Math.max(1, Math.round(q.ahead(myPrice) / S))} day${Math.max(1, Math.round(q.ahead(myPrice) / S)) === 1 ? '' : 's'}, then it's you.`);
      if (offerFall) why.push(`Sellers falling: ${d.offerCnt.d30} → ${d.offerCnt.now} over 30 days.`);
    } else if (ref != null && (pat.share90 ?? 0) >= 20) {
      call = { kind:'wait', price:ref, label:`Wait at ${rpGBP(ref)}` };
      why.push(`The Buy Box was at or above your ${rpGBP(ref)} on ${Math.round(pat.share90)}% of the last 90 days — it gets there regularly.`);
    } else {
      // drop to the highest price that sells soon and still pays
      const cand = q.levels.filter(L => (be == null || L.p - 0.01 >= be) && (!S || q.ahead(L.p) / S <= 21)).map(L => L.p - 0.01).filter(P => myPrice == null || P < myPrice);
      const P = cand.length ? Math.max(...cand) : null;
      if (P != null) {
        call = { kind:'drop', price:P, label:`Drop to ${rpGBP(P)}` };
        why.push(`At ${rpGBP(ref)} you're behind ${q.aheadTxt(ref ?? 0)} units and the Buy Box reached your price on only ${Math.round(pat.share90 ?? 0)}% of the last 90 days.`);
        why.push(`${rpGBP(P)} is the highest price with a short queue that still pays (${rpGBP(pr(P))} each).`);
      } else if (be != null && (pat.shareAt(365, be) ?? 0) >= 25) {
        call = { kind:'hold', price:be, label:`Hold at break-even ${rpGBP(be)}` };
        why.push(`No price that sells soon still pays. Over the last year the Buy Box was at or above ${rpGBP(be)} on ${Math.round(pat.shareAt(365, be))}% of days — it has come back before.`);
      } else if (bb != null) out(outPrice(), `No price that sells soon still pays, and the last year doesn't show it coming back above your break-even (${rpGBP(be)}).`);
      else call = { kind:'none', price:null, label:'No Buy Box right now' };
    }
  }
  // 5 · calendar and clocks
  if (false && pat.lastBF)   // 10 Nov: Black Friday now has its own step in "What I'd do" (rpPlan)
    warn.push(`Black Friday: last year this fell ${Math.round(pat.lastBF.depth * 100)}% for ${pat.lastBF.days} days (to ${rpGBP(pat.lastBF.min)}). If most are still here on 15 Nov, decide before it: step down while it still pays, or hold through and wait for the bounce after — never follow it below break-even.`);
  if (myPrice == null && h.units > 0) warn.push(`Keepa doesn't show an offer from you on this listing — check it isn't suppressed or out of stock at Amazon.`);
  // FBM isn't in the queue (FBA only), but say so when an FBM seller is the one holding the Buy Box
  const fbmBB = bb != null && !amzHasBB && d.offers.find(o => !o.fba && !o.amz && !o.me && Math.abs(o.p - bb) <= bb * 0.01);
  if (fbmBB && myPrice != null && bb < myPrice * 0.95) warn.push(`An FBM seller has the Buy Box at ${rpGBP(bb)}${fbmBB.s != null ? ` (${fbmBB.s} unit${fbmBB.s !== 1 ? 's' : ''})` : ''} — not counted in your queue, but buyers see it first.`);
  if (nb && call && call.kind === 'wait' && call.price != null && call.price > nb.hi * 1.15) warn.push(`${rpGBP(call.price)} is ${Math.round((call.price / nb.hi - 1) * 100)}% above its normal ${rpGBP(nb.lo)}–${rpGBP(nb.hi).replace('£', '')} — it sells there only once the cheaper stock has gone.`);
  // while Amazon holds the Buy Box under the suggested price, nothing above it sells until Amazon runs out or goes up
  const behindAmazon = amzHasBB && call && call.price != null && call.price > amzP + 0.01;
  const cd = call && call.price != null && !behindAmazon ? clearDays(call.price) : null;
  if (behindAmazon && call.kind !== 'out') warn.push(`This sells when Amazon runs out or goes back above ${rpGBP(call.price)} — until then the Buy Box stays with Amazon at ${rpGBP(amzP)}.`);
  if (cd != null && left90 != null && left90 >= 0 && cd > left90) warn.push(`At this price the queue ahead plus your ${h.units} take about ${Math.round(cd)} days — your day 90 is in ${left90}.`);
  // things that mean the graph needs a fresh look (Jack: "day 25, the biggest sale they've ever done, 50 more sellers jump on")
  if (sl && sl.biggest && call && call.kind !== 'out') warn.push(`⚡ Deepest drop in a year: −${Math.round(sl.depth * 100)}% for ${sl.days} day${sl.days > 1 ? 's' : ''}${sa ? ` (its usual sales go about −${Math.round(sa.depth * 100)}%)` : ''} — not one of its normal sales, look at the graph.`);
  else if (pat.lowest && call && call.kind !== 'out') warn.push(`⚡ Lowest Buy Box in a year right now (${rpGBP(pat.nowV)}).`);
  if (jump) warn.push(`⚡ Sellers piling in: ${d.offerCnt.d14} → ${d.offerCnt.now} in two weeks.`);
  if (pat.reset && call && call.kind !== 'out') warn.push(`The price has reset lower, not a sale: about ${rpGBP(pat.reset.from)} three to six months ago, about ${rpGBP(pat.reset.to)} for the last month.`);
  // busy months (Thermos in winter, gift sets before Christmas)
  const se = rpSeason(d);
  if (se && se.status !== 'after') {
    const t = `Busy months ${se.label}: last year about ${se.peak.toLocaleString()} a month, ${se.rest >= 50 ? `about ${se.rest.toLocaleString()}` : 'under 50'} the rest of the year.`;
    const cdS = cd != null ? cd : null;
    if (se.status === 'before') warn.push(`${t} They start in ${se.daysToStart} days — clear by ${fmt(se.endDate)} or it slows right down.`);
    else warn.push(`${t} ${cdS != null && cdS > se.daysToEnd ? `At this price you clear in about ${Math.round(cdS)} days, but the busy months end ${fmt(se.endDate)} (${se.daysToEnd} days).` : `Clear by ${fmt(se.endDate)} (${se.daysToEnd} days).`}`);
  } else if (se && se.status === 'after' && se.daysToStart > 60) warn.push(`Its busy months (${se.label}) are over — ${se.rest >= 50 ? `about ${se.rest.toLocaleString()}` : 'under 50'} a month until ${RP_MON[se.startM - 1]}.`);
  // your own sales from Sarah's uploads
  const os = RP.hist ? rpOwnSales().asin[h.asin] : null;
  const own = os && os.days >= 5 ? { sold:os.sold, days:os.days, rate:os.sold / os.days, clear: os.sold > 0 ? h.units / (os.sold / os.days) : null } : null;
  if (call && call.price != null) { call.each = pr(call.price); call.total = call.each != null ? call.each * h.units : null; call.back = call.price * h.units; }
  const skus = h.skus.map(sk => {
    const beS = rpBreakeven(sk.cost, d), set = RP.settings[sk.sku], minS = set && set.min_price != null ? +set.min_price : null;
    let sug = null;
    if (call && call.price != null) {
      if (call.kind === 'out') sug = call.price;                                     // getting out: take the loss
      else if (call.kind === 'hold' && /break-even/.test(call.label)) sug = beS;     // hold: this SKU's own break-even
      else if (call.kind === 'wait') sug = minS ?? call.price;                        // leave it
      else sug = beS != null ? Math.max(call.price, beS) : call.price;               // drop / raise: never under this SKU's break-even
    }
    return { ...sk, be:beS, min:minS, sug, each: rpProfit(sug, sk.cost, d), change: sug != null && (minS == null || Math.abs(sug - minS) >= 0.01) };
  });
  // SKUs bought at different costs break even at different prices — the headline says so instead of an average
  if (call && call.kind === 'hold' && /break-even/.test(call.label)) {
    const bes = skus.map(x => x.be).filter(v => v != null);
    if (bes.length > 1 && Math.max(...bes) - Math.min(...bes) >= 1) call.label = `Hold at each SKU's break-even (${rpGBP(Math.min(...bes))}–${rpGBP(Math.max(...bes)).replace('£', '')})`;
  }
  const r = { call, why, warn, q, pat, be, myPrice, myMin, ref, S, left90, left180, clearDays: cd, amzHasBB, skus, season:se, own };
  r.buy = rpBuyVerdict(h, d, r);
  return r;
}

// ── Good buy or bad buy — Jack: "you tell me if it was a good buy or bad buy and why" ──────────
// bad buy      the target was above anything the Buy Box had done in the 90 days before, or it bought
//              into a dip that never bounced back (Huawei)
// missed window the Buy Box sat at your price for 2+ weeks since it landed and most didn't sell (G915 X, June)
// bad luck     fine on the day, then the market fell 15%+
// good         most sold inside 90 days, or bought in a dip and the bounce came (GoPro), or still on course
function rpBuyVerdict(h, d, r){
  const bbAt = dd => { const k = Math.round((rpMs(dd) - rpMs(d.start)) / RP_DAY); for (let j = Math.max(0, k); j < Math.min(d.bb.length, k + 8); j++) if (d.bb[j] > 0) return d.bb[j] / 100; return null; };
  const s = h.skus.filter(x => x.target).sort((a, b) => b.units - a.units)[0] || h.skus[0];
  const buy = s.buyDate || h.landed;
  const bought = h.skus.reduce((t, x) => t + (x.bought || 0), 0), left = h.units;
  const sold = bought >= left && bought > 0 ? bought - left : null, of = sold != null ? `${sold} of ${bought} sold` : `${left} still here`;
  const T = s.target, bbBuy = buy ? bbAt(buy) : null;
  const k0 = buy ? Math.round((rpMs(buy) - rpMs(d.start)) / RP_DAY) : -1;
  const before = k0 > 10 ? d.bb.slice(Math.max(0, k0 - 90), k0).filter(v => v > 0).map(v => v / 100) : [];
  const maxBefore = before.length ? Math.max(...before) : null;
  const kL = h.landed ? Math.max(0, Math.round((rpMs(h.landed) - rpMs(d.start)) / RP_DAY)) : 0;
  const since = d.bb.slice(kL).filter(v => v > 0).map(v => v / 100);
  const maxSince = since.length ? Math.max(...since) : null;
  const pct = (a, b) => Math.round((a / b - 1) * 100);
  if (T && maxBefore && T > maxBefore * 1.1) return { v:'bad', t:`Bad buy — your target ${rpGBP(T)} was above anything the Buy Box had done in the 90 days before you bought (best ${rpGBP(maxBefore)}).` };
  if (T && bbBuy && T > bbBuy * 1.1 && maxSince != null && maxSince < T * 0.9 && (h.age ?? 0) > 45)   // within 10% of target still counts as the bounce coming (GoPro £188 v £200)
    return { v:'bad', t:`Bad buy — bought when the Buy Box was ${rpGBP(bbBuy)}, ${pct(T, bbBuy)}% under your ${rpGBP(T)} target, and since it landed it has never got back there (best ${rpGBP(maxSince)}).` };
  if (sold != null && bought && sold / bought >= 0.8) return { v:'good', t:`Good buy — ${of} in ${h.age} days.` };
  const win = Math.min(...[T, r.myMin, r.myPrice].filter(v => v != null && v > 0));
  if (isFinite(win)) {
    const days = since.filter(v => v >= win - 0.005).length;
    if (days >= 14 && (h.age ?? 0) > 75 && (sold == null || sold / Math.max(1, bought) < 0.5) && left > 1)   // only once day 90 is near — before that it's still on course
      return { v:'miss', t:`Missed window — the Buy Box was at ${rpGBP(win)} or more on ${days} days since it landed, but ${of}.` };
  }
  if (bbBuy && d.bbNow && d.bbNow < bbBuy * 0.85 && !(T && bbBuy && T > bbBuy * 1.1))
    return { v:'luck', t:`Bad luck — fine on the day (${rpGBP(bbBuy)}), then the Buy Box fell ${-pct(d.bbNow, bbBuy)}% to ${rpGBP(d.bbNow)}${r.amzHasBB ? ' with Amazon now holding it' : ''}.` };
  if (T && bbBuy && T > bbBuy * 1.1 && maxSince != null && maxSince >= T * 0.9 && (h.age ?? 0) > 90 && sold != null && sold / Math.max(1, bought) < 0.5)   // the bounce came and it still didn't sell (Huawei, 0 of 5)
    return { v:'miss', t:`Missed window — bought in the dip at ${rpGBP(bbBuy)} and the bounce came (up to ${rpGBP(maxSince)}), but ${of}.` };
  if (T && bbBuy && T > bbBuy * 1.1 && maxSince != null && maxSince >= T * 0.9) return { v:'good', t:`Good buy — bought in the dip at ${rpGBP(bbBuy)} and the bounce came (up to ${rpGBP(maxSince)}). ${of}.` };
  if ((h.age ?? 0) <= 90) return { v:'good', t:`On course so far — ${h.age} days in, ${of}.` };
  return { v:'slow', t:`Slow — ${h.age} days in, ${of}, no single cause.` };
}
const RP_BUY = { good:['Good buy','#00f5a0'], bad:['Bad buy','#ff4d6d'], miss:['Missed window','#ff8c42'], luck:['Bad luck','#ffd166'], slow:['Slow','#8b99ab'] };

// ── What moved since the last check — the "re-look at this one" list ─────────────────────────────
function rpChanges(rec, r){
  const p = rec.data.prev; if (!p) return null;
  const d = rec.data, f = rpFbaStats(d), out = [], pc = (a, b) => Math.round((b / a - 1) * 100);
  if (p.kind && r.call && r.call.kind !== 'none' && (p.kind !== r.call.kind || (p.price && r.call.price && Math.abs(r.call.price / p.price - 1) >= 0.02)))
    out.push(`call was ${RP_KIND[p.kind][0].toLowerCase()}${p.price ? ' ' + rpGBP(p.price) : ''}, now ${RP_KIND[r.call.kind][0].toLowerCase()}${r.call.price != null ? ' ' + rpGBP(r.call.price) : ''}`);
  if (p.bb && d.bbNow && Math.abs(d.bbNow / p.bb - 1) >= 0.05) out.push(`Buy Box ${rpGBP(p.bb)} → ${rpGBP(d.bbNow)} (${pc(p.bb, d.bbNow) > 0 ? '+' : ''}${pc(p.bb, d.bbNow)}%)`);
  if (p.fbaN != null && Math.abs(f.n - p.fbaN) >= 3 && (f.n >= p.fbaN * 1.3 || f.n <= p.fbaN * 0.7)) out.push(`FBA sellers ${p.fbaN} → ${f.n}`);
  else if (p.fbaUnits != null && p.fbaUnits >= 10 && Math.abs(f.units / p.fbaUnits - 1) >= 0.5) out.push(`FBA units ${p.fbaUnits} → ${f.units}`);
  if (p.amzBB != null && p.amzBB !== r.amzHasBB) out.push(r.amzHasBB ? 'Amazon took the Buy Box' : 'Amazon lost the Buy Box');
  return out.length ? { since:p.checked, items:out } : null;
}

// What each provider is (Jack, 28 Oct)
const RP_ALL = 'Everything';   // Jack, 14 Nov: one list across every provider, and one press to check it all
const RP_PROV = { EVERYTHING:'all providers', JACK:'you', JAC:'you', TFTJ:'sourcing method', REPLEN:'replenishables', VAA:'Mera · VA', VAS:'Suz · VA', FFB:'lead group', PS:'lead group', THC:'lead group',
  ARBI:'sourcing software', RB:'sourcing software', PP:'n/a · stopping', LAVARION:'own brand' };
const rpProvInfo = n => RP_PROV[String(n || '').trim().toUpperCase()] || '';

// ── Why it hasn't sold — written from the facts, no guessing ───────────────────────────────────
function rpStory(h, d, r){
  const s = [], pat = r.pat;
  const at = date => { const k = Math.round((rpMs(date) - rpMs(d.start)) / RP_DAY); return k >= 0 && k < pat.bb.length ? pat.bb[k] : null; };
  const target = h.skus.map(x => { const t = String(x.sku).split('_'); const v = parseFloat(t[3]); return isFinite(v) && v > 0 ? v : null; }).find(v => v != null);
  const bbLanded = h.landed ? at(h.landed) : null;
  if (bbLanded != null) s.push(`When it landed on ${fmt(h.landed)} the Buy Box was ${rpGBP(bbLanded)}${target ? `; your target was ${rpGBP(target)}${target > bbLanded * 1.1 ? ` — ${Math.round((target / bbLanded - 1) * 100)}% above the market on day one` : ''}` : ''}.`);
  if (bbLanded != null && d.bbNow != null) { const c = d.bbNow / bbLanded - 1; if (Math.abs(c) >= 0.05) s.push(`Since then the Buy Box has ${c < 0 ? 'fallen' : 'risen'} ${Math.round(Math.abs(c) * 100)}% to ${rpGBP(d.bbNow)}.`); }
  if (r.amzHasBB) s.push(`Amazon holds the Buy Box now at ${rpGBP(r.q.amz ? r.q.amz.p : d.amzNow)}.`);
  const oc = d.offerCnt; if (oc.d30 && oc.now && Math.abs(oc.now - oc.d30) >= 3) s.push(`Sellers went ${oc.d30} → ${oc.now} in the last 30 days${oc.now > oc.d30 ? ' — more people chasing the same buyers' : ' — supply thinning'}.`);
  const recent = pat.dips.filter(x => rpMs(x.end) >= Date.now() - 90 * RP_DAY);
  if (recent.length) s.push(`${recent.length} sale dip${recent.length > 1 ? 's' : ''} in the last 90 days, the deepest ${Math.round(Math.max(...recent.map(x => x.depth)) * 100)}% (${recent.map(x => fmtShort(x.start) + (x.event ? ' ' + x.event : '')).join(', ')}).`);
  if (r.own && r.S) { const lst = Math.round(r.S * r.own.days); if (lst > 0) s.push(`You sold ${r.own.sold} of the roughly ${lst.toLocaleString()} sold on the listing in the last ${r.own.days} days (${Math.round(r.own.sold / lst * 100)}%).`); }
  if (pat.months.length && r.ref != null) {
    const good = pat.months.filter(o => o.at >= 10).map(o => new Date(o.m + '-15').toLocaleDateString('en-GB', { month:'short' }));
    s.push(good.length ? `Months with 10+ days at or above your ${rpGBP(r.ref)}: ${good.join(', ')}.` : `Not one month in the last year had 10 days at or above your ${rpGBP(r.ref)}.`);
  }
  return s;
}

// ── Load everything once ──────────────────────────────────────────────────────────────────────
async function rpLoad(force){
  if ((RP.loaded && !force) || RP.loading) return;
  RP.loading = true;
  const [data, settings, decisions, hist] = await Promise.all([
    window._repLoad ? window._repLoad() : null, window._repSettingsLoad ? window._repSettingsLoad() : null, window._repDecisions ? window._repDecisions() : null,
    window._snapSkusLoad ? window._snapSkusLoad(16) : null ]);   // about 5 weeks of uploads → what you sold per SKU
  RP.hist = {}; (hist || []).forEach(x => { RP.hist[x.date] = x.rows || []; });
  RP.noTables = data == null;
  if (data) RP.data = { ...data, ...rpMemData() };
  else RP.data = rpMemData();
  RP.settings = settings || rpMemSettings() || {};
  RP.decisions = decisions || rpMemDecisions();
  RP.loaded = true; RP.loading = false;
  renderRepTool();
  rpDealBackfill();
  if (document.getElementById('tab-stockhealth')?.classList.contains('active') && typeof renderStockHealth === 'function') renderStockHealth();
}
// What the Repricer checks say, rolled up for Stock Health: each provider's good/bad-buy tally and worst
// lead, and how much of the stock still inside 90 days is on course to sell by its day 90 at today's prices.
function rpRollup(){
  if (typeof RP === 'undefined' || !RP.loaded) { if (typeof rpLoad === 'function') rpLoad(); return null; }
  const H = rpHoldings(); if (!H) return null;
  const prov = {}, oc = { on:0, of:0, checked:0, all:0 };
  Object.values(H.by).forEach(h => {
    const rec = RP.data[h.asin], r = rec ? rpCall(h, rec) : null;
    if (h.age != null && h.age < 90) { oc.all += h.value; if (r) { oc.checked += h.value;
      const k = r.call ? r.call.kind : 'none', ok = (k === 'wait' || k === 'raise') && (r.clearDays == null || r.left90 == null || r.clearDays <= r.left90);
      if (ok) oc.on += h.value; oc.of += h.value; } }
    h.skus.forEach(s => { const o = prov[s.provider] = prov[s.provider] || { buys:{}, checked:0, asins:new Set(), worst:[] };
      if (!o.asins.has(h.asin)) { o.asins.add(h.asin); if (r) { o.checked++; o.buys[r.buy.v] = (o.buys[r.buy.v] || 0) + 1;
        if (r.buy.v !== 'good') o.worst.push({ asin:h.asin, title:(rec.data.title || h.title), v:r.buy.v, t:r.buy.t, value:h.value }); } } });
  });
  Object.values(prov).forEach(o => o.worst.sort((a, b) => b.value - a.value));
  return { prov, oc };
}
function rpGoTo(provName){
  const nav = [...document.querySelectorAll('.nav-item')].find(n => (n.getAttribute('onclick') || '').includes("'repricer'"));
  RP.mode = 'prov'; RP.prov = provName; RP.open = null;
  if (nav) switchTab('repricer', nav);
  setTimeout(() => document.getElementById('repTool')?.scrollIntoView({ behavior:'smooth', block:'start' }), 200);
}
window.rpRollup = rpRollup; window.rpGoTo = rpGoTo;
// Test mode / before the SQL: keep this session's checks in memory so the page still works
const RP_MEM = { data:{}, decisions:[] };
const rpMemData = () => RP_MEM.data;
const rpMemDecisions = () => RP_MEM.decisions;
function rpMemSettings(){ try { const s = localStorage.getItem('oaRepSettingsTest'); return s ? JSON.parse(s) : null; } catch(e) { return null; } }

// ── Keepa: check every ASIN of one provider, at the pace the token bank allows ────────────────
const RP_BANDS = [['0–30 days',0,30],['31–60 days',31,60],['61–90 days',61,90],['91–180 days',91,180],['181–270 days',181,270],['271–365 days',271,365],['365+ days',366,1e9]];
const rpInBand = (h, b) => { const B = RP_BANDS.find(x => x[0] === b); return !!B && h.age != null && h.age >= B[1] && h.age <= B[2]; };
async function rpCheckOne(asin){ const H = rpHoldings(), h = H && H.by[asin]; if (!h) return; await rpCheckProvider([...h.providers][0], true, [asin]); }
window.rpCheckOne = rpCheckOne;
// The Check button checks exactly what's on screen (the provider or band, narrowed by the chips), never more
window.rpCheckView = function(all){ const v = RP.view; if (v) rpCheckProvider(v.label, all, null, v.asins, v.youngOK, all ? v.asins.length : v.n); };
window.rpUnqueue = i => { RP.queue.splice(i, 1); renderRepRun(); };
async function rpCheckProvider(prov, all, only, asins, youngOK0, nHint){
  if (!rpCanAct()) { rpUnlockAsk(); return; }
  if (RP.run) {   // one at a time: the next waits its turn instead of being ignored
    const H0 = only ? rpHoldings() : null, lab = only && H0 && H0.by[only[0]] ? (H0.by[only[0]].title || only[0]).slice(0, 30) : prov;
    RP.queue.push({ prov: lab, all, only, asins, youngOK0, n: only ? only.length : nHint ?? (asins ? asins.length : null) });
    if (typeof showToast === 'function') showToast(`Queued: ${prov} — starts when this one finishes`);
    renderRepRun(); return;
  }
  const H = rpHoldings(); if (!H) return;
  if (only && !prov) { const h = H.by[only[0]]; prov = h ? [...h.providers][0] : ''; }
  const pick = prov === RP_ALL ? (() => true) : RP.mode === 'age' && RP_BANDS.some(x => x[0] === prov) ? (a => rpInBand(a, prov)) : (a => a.providers.has(prov));
  // oldest first (past day 90 first), so stopping halfway leaves the urgent ones done
  const every = (asins ? asins.map(a => H.by[a]).filter(Boolean) : Object.values(H.by).filter(pick)).sort((a, b) => (b.age ?? -1) - (a.age ?? -1) || b.value - a.value).map(a => a.asin);
  const youngOK = all || youngOK0 || (RP.mode === 'age' && prov === RP_BANDS[0][0]);   // picking the 0–30 band means you want them
  // Jack, 10 Nov: selling-fine products are checked like every other one ("if I want to audit it, it does it like every other product")
  const skip = a => rpFresh(a) || (!youngOK && rpYoung(H.by[a]));
  const fine = 0;
  const young = youngOK ? 0 : every.filter(a => !rpFresh(a) && rpYoung(H.by[a])).length;
  const list = only ? only : all ? every : every.filter(a => !skip(a));   // checked in the last day or under 30 days = costs nothing
  if (!list.length) { if (typeof showToast === 'function') showToast(`Nothing to pull in ${prov} — everything was checked in the last ${RP_FRESH_H} hours or is under ${RP_YOUNG_D} days`); rpNextQueued(); return; }
  // a full check in the last 14 days → a 1-token look first; "Check this one" and "Re-check all" always do the full check
  const look = only || all ? [] : list.filter(rpLookable), full = list.filter(a => !look.includes(a));
  RP.run = only ? { prov: H.by[only[0]] ? (H.by[only[0]].title || only[0]).slice(0, 40) : only[0], done:0, total:list.length, kept:0, fine:0, young:0, wait:0, err:0, stop:false, look:0, same:0, moved:0, spent:0, fullTok:0, fullN:0 }
    : { prov, done:0, total:list.length, kept:every.length - list.length - fine - young, fine, young, wait:0, err:0, stop:false, look:look.length, same:0, moved:0, spent:0, fullTok:0, fullN:0 };
  Object.assign(RP.run, { started:Date.now(), phase:'start', fullLeft:full.length, lookLeft:look.length });
  rpRender(); rpTickOn();
  const fromFixtures = batch => Promise.all(batch.map(a => fetch(`fixtures/keepa/${a}.json`).then(r => r.ok ? r.json() : null).catch(() => null))).then(x => x.filter(Boolean));
  const save = async (asin, rec) => {
    RP.data[asin] = rec;
    if (window.OA_TEST || RP.noTables) RP_MEM.data[asin] = rec;
    else if (window._repSave) await window._repSave(asin, rec.data);
  };
  // 1. quick looks, up to 100 an ask, 1 token each (free when another app pulled it today — cache=read)
  for (let i = 0; i < look.length && !RP.run.stop; i += 100) {
    const batch = look.slice(i, i + 100);
    RP.run.phase = 'look'; RP.run.inBatch = batch.length;
    try {
      let prods;
      if (window.OA_TEST) prods = await fromFixtures(batch);   // test mode: Keepa is never called
      else {
        await rpWaitBank(batch.length);
        if (RP.run.stop) break;
        const j = await fetch(`${RP_WORKER}/keepa?path=product&domain=2&asin=${batch.join(',')}&stats=90&history=0&app=oa-reprice-look&cache=read&maxHours=24`, { cache:'no-store' }).then(r => r.json());
        if (j.error) throw new Error(j.error.message || JSON.stringify(j.error));
        RP.run.spent += j.tokensConsumed || 0; rpBankSet(j.tokensLeft, j.refillRate, j.refillIn, 'live');
        RP.run.last = { n:batch.length, tok:j.tokensConsumed || 0, at:Date.now(), look:true };
        prods = j.products || [];
      }
      const got = new Map(prods.map(p => [p.asin, p]));
      for (const a of batch) {
        const old = RP.data[a], p = got.get(a), moved = p ? rpMoved(old.data.sig, rpSig(p)) : 'no answer';
        if (moved) { full.push(a); RP.run.moved++; continue; }
        const at = new Date().toISOString();
        await save(a, { checked_at:at, data:{ ...old.data, look:{ at, n:((old.data.look && old.data.look.n) || 0) + 1 } } });
        RP.run.same++; RP.run.done++;
      }
      RP.run.lookLeft = Math.max(0, RP.run.lookLeft - batch.length); RP.run.fullLeft = full.length;
    } catch(e) { RP.run.err++; RP.run.done += batch.length; RP.run.lastErr = { msg: String(e && e.message || e).slice(0, 140), at: Date.now(), n: batch.length }; console.warn('Repricer quick look failed for', batch, e); }
    rpRunStep(batch.length);
  }
  // 2. full checks — up to 5 at a time while there's room above RP_KEEP; at the line, as many as each refill pays for
  //    (Jack 18 Nov: "make it smoother … better drip fed") — same speed overall, but a product every ~30 s instead of 5 every 2½ min
  for (let i = 0; i < full.length && !RP.run.stop; ) {
    let n = Math.min(5, full.length - i);
    RP.run.phase = 'full'; RP.run.fullLeft = full.length - i;
    if (!window.OA_TEST) {
      const left = await rpWaitBank(RP_TOK_MAX);   // room for at least one
      if (RP.run.stop) break;
      if (left != null) n = Math.max(1, Math.min(n, Math.floor((left - RP_KEEP) / RP_TOK_MAX)));
    }
    const batch = full.slice(i, i + n);
    RP.run.inBatch = batch.length; RP.run.from = i + 1;
    try {
      let prods;
      if (window.OA_TEST) prods = await fromFixtures(batch);   // test mode: saved copies of real responses only
      else {
        const j = await fetch(`${RP_WORKER}/keepa?path=product&domain=2&asin=${batch.join(',')}&offers=20&stock=1&history=1&days=560&stats=90&buybox=1&only-live-offers=1&app=oa-reprice&cache=write`, { cache:'no-store' }).then(r => r.json());   // cache=write: the Worker saves a slim copy to the shared keepa_cache so other apps get Jack's ASINs free (reply untouched)
        if (j.error) throw new Error(j.error.message || JSON.stringify(j.error));
        prods = (j.products || []).map(p => (p._onlyLive = true, p));
        RP.run.spent += j.tokensConsumed || 0; if (j.tokensConsumed > 0 && prods.length) { RP.run.fullTok += j.tokensConsumed; RP.run.fullN += prods.length; }
        rpBankSet(j.tokensLeft, j.refillRate, j.refillIn, 'live');
        RP.run.last = { n:prods.length, tok:j.tokensConsumed || 0, at:Date.now() };
      }
      for (const p of prods) {
        const d = rpCompact(p), old = RP.data[p.asin];
        // what the last check said — a re-check the same day keeps the older one, so the comparison is day on day
        if (old && old.data) d.prev = Date.now() - rpFullAt(old) < 12 * 36e5 && old.data.prev ? old.data.prev : rpPrevOf(H.by[p.asin], old);
        await save(p.asin, { checked_at: d.checked, data: d });
      }
    } catch(e) { RP.run.err++; RP.run.lastErr = { msg: String(e && e.message || e).slice(0, 140), at: Date.now(), n: batch.length }; console.warn('Repricer check failed for', batch, e); }
    RP.run.done = Math.min(RP.run.total, RP.run.done + batch.length); RP.run.fullLeft = full.length - i - batch.length;
    i += batch.length;
    rpRunStep(batch.length);
  }
  const r0 = RP.run;
  rpTokSave(r0.fullTok, r0.fullN);
  RP.run = null;
  // finished: redraw, keeping whatever card you're on where it is — unless you're typing a price, then wait for you
  if (rpTyping()) { RP.pending = (RP.pending || 0) || 1; rpPendingPill(); } else rpRender();
  rpBankRead();
  if (typeof showToast === 'function') showToast(r0.why ? `Stopped: ${r0.why}` : `${r0.stop ? 'Stopped' : '✓'} ${prov}${r0.stop ? ` after ${r0.done} of ${r0.total}` : ' checked'}${r0.spent ? ` · ${r0.spent.toLocaleString()} tokens` : ''}${r0.look ? ` — ${r0.same} unchanged since the last full check (1 token each)` : ''}${r0.err ? ` · ${r0.err} batch${r0.err > 1 ? 'es' : ''} failed — press Check again for those` : ''}`);
  if (r0.stop) RP.queue = []; else rpNextQueued();
}
function rpNextQueued(){ const nx = RP.queue.shift(); if (nx) setTimeout(() => rpCheckProvider(nx.only ? null : nx.prov, nx.all, nx.only, nx.asins, nx.youngOK0), 300); }

// ── Decisions: what Jack did, and whether it sold since ───────────────────────────────────────
async function rpDecide2(asin, action, sku){
  if (!rpCanAct()) { rpUnlockAsk(); return; }
  const H = rpHoldings(), h = H && H.by[asin], d = RP.data[asin] && RP.data[asin].data;
  let price = null;
  if (action === 'set') { const el = document.getElementById('rpPrice_' + (sku || asin).replace(/[^A-Za-z0-9]/g, '_')); price = el ? parseFloat(el.value) : null; if (!(price > 0)) { el && el.focus(); return; } }
  const units = sku && h ? (h.skus.find(x => x.sku === sku) || {}).units : h ? h.units : null;
  const row = { asin, sku: sku || null, action, price, units_then: units ?? null, bb_then: d ? d.bbNow : null, decided_at: new Date().toISOString() };
  let saved = null;
  if (!window.OA_TEST && !RP.noTables && window._repDecide) saved = await window._repDecide(row);
  if (!saved) { saved = { ...row, id: 'mem' + Date.now() }; RP_MEM.decisions.unshift(saved); }
  RP.decisions.unshift(saved);
  const ord = RP.order.slice(), i = ord.indexOf(asin);
  delete RP.openDone[asin];
  renderRepTool();
  if ((action === 'set' || action === 'wait') && h && rpDoneInfo(h, RP.data[asin])) {
    const next = ord.slice(i + 1).map(a => document.getElementById('rp_' + a)).find(el => el && !el.classList.contains('rpk-doneRow'));
    if (next) setTimeout(() => next.scrollIntoView({ behavior:'smooth', block:'start' }), 60);
  }
  if (typeof showToast === 'function') showToast(action === 'set' ? `Saved — ${sku} set to £${price.toFixed(2)}` : action === 'wait' ? 'Saved — leaving it' : action === 'skip' ? 'Left out of the Repricer' : action === 'unskip' ? 'Put back in the Repricer' : 'Saved');
}
function rpLastDecision(asin, sku){ return RP.decisions.find(x => x.asin === asin && (sku === undefined || (x.sku || null) === (sku || null))) || null; }
function rpCopy(text, what){
  const done = () => { if (typeof showToast === 'function') showToast(`Copied ${what}`); };
  if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, () => {}); }

// ── STK Repricer Settings file → min / max per SKU (Sarah drops it with the ageing file) ───────
function rpParseSettings(text){
  const lines = text.replace(/\r/g, '').split('\n').filter(l => l.trim());
  if (!lines.length) return null;
  const head = lines[0].split('\t').map(x => x.replace(/"/g, '').trim().toLowerCase());
  const ix = n => head.indexOf(n);
  if (ix('sku') < 0 || ix('min_price') < 0) return null;
  const today = rpToday();
  return lines.slice(1).map(l => { const c = l.split('\t').map(x => x.replace(/^"|"$/g, '').trim());
    const num = v => v === '' || v == null ? null : parseFloat(v);
    return { sku:c[ix('sku')], min_price:num(c[ix('min_price')]), max_price:ix('max_price') >= 0 ? num(c[ix('max_price')]) : null,
      strategy:ix('strategy') >= 0 ? c[ix('strategy')] : null, repricer_on:ix('repricer_on') >= 0 ? c[ix('repricer_on')] === 'Y' : null, file_date:today }; }).filter(r => r.sku);
}
async function rpImportSettings(file){
  const rows = rpParseSettings(await file.text());
  if (!rows) { if (typeof showToast === 'function') showToast('That isn\'t the STK Repricer Settings file (no SKU / Min_Price columns)'); return false; }
  let ok = false;
  if (!window.OA_TEST && window._repSettingsSave) ok = await window._repSettingsSave(rows);
  rows.forEach(r => { RP.settings[r.sku] = r; });
  if (!ok) { try { localStorage.setItem('oaRepSettingsTest', JSON.stringify(RP.settings)); } catch(e) {} }
  if (typeof showToast === 'function') showToast(`✓ Repricer settings: ${rows.length.toLocaleString()} SKUs${ok ? '' : ' (kept on this computer — run the repricer SQL to share them)'}`);
  renderRepTool();
  return true;
}

// ── Unlock (Jack's laptop only) ───────────────────────────────────────────────────────────────
function rpUnlockAsk(){
  const el = document.getElementById('rpUnlock'); if (!el) return;
  el.style.display = 'flex'; const i = el.querySelector('input'); if (i) { i.value = ''; i.focus(); }
}
function rpUnlockTry(v){
  if (String(v || '').trim().toLowerCase() === RP_WORD) { try { localStorage.setItem(RP_UNLOCK, '1'); } catch(e) {} renderRepTool(); if (typeof showToast === 'function') showToast('✓ This laptop can now check and decide'); }
  else { const m = document.getElementById('rpUnlockMsg'); if (m) m.textContent = 'Not that word.'; }
}
function rpLock(){ try { localStorage.removeItem(RP_UNLOCK); } catch(e) {} renderRepTool(); }

// ── Drawing ───────────────────────────────────────────────────────────────────────────────────
const RP_KIND = { out:['GET OUT','#ff4d6d'], drop:['DROP','#ff8c42'], raise:['RAISE','#2dd4bf'], hold:['HOLD','#3d9eff'], wait:['WAIT','#00f5a0'], none:['—','#8b99ab'] };
// The graph — Keepa's look, as in the 15 Oct demo Jack liked: white, Amazon as an orange area, the Buy Box
// as the magenta step line, lowest FBA teal, sales rank green on the right axis, grey before you had it,
// your lines labelled (you / suggested / target on the right, break-even / your min / usual sale on the
// left), when it landed and day 90 marked, sellers strip under it. Hover = that day's numbers.
const RP_CH = {};
function rpChart(h, d, r, days){
  const W = 1120, HM = 300, H = 412, PL = 62, PR = 70, PT = 20, PB = 28, plain = !!RP.plain[h.asin];
  const x = days > (d.bb || []).length && d.x18 ? d.x18 : null, join = k => x ? (x[k] || []).concat(d[k] || []) : (d[k] || []);
  const S = { start: x ? x.start : d.start, bb: join('bb'), amz: join('amz'), fba: join('fba'), oc: join('oc'), rank: join('rank') };
  const n = Math.min(days, S.bb.length), off = S.bb.length - n;
  const cut = a => (a || []).slice(off).map(v => v > 0 ? v / 100 : null);
  const bb = cut(S.bb), az = cut(S.amz), fb = S.fba.length ? cut(S.fba) : [];
  const rk = (S.rank || []).slice(off).map(v => v > 0 ? v : null);
  const nb = r.pat.normal, sa = r.pat.sales && r.pat.sales.n >= 2 ? r.pat.sales : null;
  const target = h.skus.map(s => s.target).find(v => v != null) ?? null;
  // every SKU's own min and break-even (bought at different prices → different lines), grouped when they match
  const grp = key => { const o = []; (r.skus || []).forEach(x => { const v = x[key]; if (v == null) return; const g0 = o.find(g => Math.abs(g.v - v) < 0.5); if (g0) { g0.u += x.units || 0; g0.n++; } else o.push({ v, u: x.units || 0, n: 1 }); }); return o.sort((a, b) => b.v - a.v); };
  const minsG = grp('min'), besG = grp('be');
  const lines = [r.myPrice, r.myMin, r.be, r.call && r.call.price, nb && nb.lo, nb && nb.hi, sa && sa.low, target, ...minsG.map(g => g.v), ...besG.map(g => g.v)].filter(v => v != null);
  const raw = bb.concat(az).filter(v => v != null);
  if (!raw.length) return '<div class="rp-nochart">No price history from Keepa.</div>';
  // a one-off spike (an Amazon £400 for a £60 item) must not flatten everything else
  const srt = raw.slice().sort((x, y) => x - y), medv = srt[Math.floor(srt.length / 2)];
  const all = raw.filter(v => v <= medv * 2.2).concat(lines);
  const ax = niceAxis(Math.max(0, Math.min(...all) * 0.95), Math.max(...all) * 1.04);
  const X = k => PL + k / Math.max(1, n - 1) * (W - PL - PR), Y = v => PT + (1 - (Math.min(v, ax.max) - ax.min) / (ax.max - ax.min)) * (HM - PT - PB);
  const bot = HM - PB;
  const s0 = rpMs(S.start) + off * RP_DAY, dayK = date => Math.round((rpMs(date) - s0) / RP_DAY);
  const dm = date => new Date(date + 'T12:00:00Z').toLocaleDateString('en-GB', { day:'numeric', month:'short' });
  let g = '';
  // grey before it landed
  const kLand = h.landed ? dayK(h.landed) : 0;   // before you had it: faded over the top of the lines further down
  // its normal price (the last 4 months outside sales) as a green band
  if (nb && !plain) { const x0 = X(Math.max(0, n - 120)); g += `<rect x="${x0.toFixed(1)}" y="${Y(nb.hi).toFixed(1)}" width="${(W - PR - x0).toFixed(1)}" height="${Math.max(2, Y(nb.lo) - Y(nb.hi)).toFixed(1)}" fill="#00a86b" opacity=".13"><title>Normal price, last 4 months outside sales: ${rpGBP(nb.lo)}–${rpGBP(nb.hi)}</title></rect>`; }
  // sale dips
  if (!plain) r.pat.dips.forEach(x => { const a = dayK(x.start), b = dayK(x.end); if (b < 0) return; g += `<rect x="${X(Math.max(0, a)).toFixed(1)}" y="${PT}" width="${Math.max(2, X(b) - X(Math.max(0, a))).toFixed(1)}" height="${bot - PT}" fill="#ff4d6d" opacity=".08"><title>${fmt(x.start)}–${fmt(x.end)} · −${Math.round(x.depth * 100)}%${x.event ? ' · ' + x.event : ''}</title></rect>`; });
  for (let v = ax.min; v <= ax.max + 1e-9; v += ax.step) g += `<line x1="${PL}" x2="${W - PR}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" stroke="#e3e7ee"/><text x="${PL - 8}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end" class="rpc-ax">£${Math.round(v).toLocaleString()}</text>`;
  const step = days > 120 ? 30 : 7;
  for (let k = 0; k < n; k++) { const dd = rpDay(s0 + k * RP_DAY); if ((step === 30 && dd.endsWith('-01')) || (step === 7 && new Date(dd).getUTCDay() === 1 && k % 14 < 7)) g += `<text x="${X(k).toFixed(1)}" y="${HM - 8}" text-anchor="middle" class="rpc-ax">${step === 30 ? new Date(dd + 'T12:00:00Z').toLocaleDateString('en-GB', { month:'short' }) : dm(dd)}</text>`; }
  // sales rank, green, on its own right-hand axis (lower = selling better)
  const rkv = rk.filter(v => v != null);
  if (rkv.length > 1) {
    const rs = rkv.slice().sort((x, y) => x - y), rmax = niceAxis(0, rs[Math.floor(rs.length * 0.97)] * 1.1);
    const Yr = v => PT + (1 - Math.min(v, rmax.max) / rmax.max) * (bot - PT);
    for (let v = 0; v <= rmax.max + 1e-9; v += rmax.step) g += `<text x="${W - PR + 8}" y="${(Yr(v) + 4).toFixed(1)}" class="rpc-ax rpc-rk">#${Math.round(v).toLocaleString()}</text>`;
    let p = '', pen = false; rk.forEach((v, k) => { if (v == null) { pen = false; return; } p += `${pen ? 'L' : 'M'}${X(k).toFixed(1)},${Yr(v).toFixed(1)}`; pen = true; });
    g += `<path d="${p}" fill="none" stroke="#3fa34d" stroke-width="1.2" opacity=".6"/>`;
  }
  const seg = (arr, col, w, op, dash) => { let path = '', pen = false; arr.forEach((v, k) => { if (v == null) { pen = false; return; } path += `${pen ? 'L' : 'M'}${X(k).toFixed(1)},${Y(v).toFixed(1)}`; if (k + 1 < arr.length && arr[k + 1] != null) path += `H${X(k + 1).toFixed(1)}`; pen = true; });
    return `<path d="${path}" fill="none" stroke="${col}" stroke-width="${w}" stroke-linejoin="round"${op ? ` opacity="${op}"` : ''}${dash ? ` stroke-dasharray="${dash}"` : ''}/>`; };
  // Amazon as Keepa's orange area: each stretch Amazon was selling, filled to the bottom
  const area = arr => { let path = '', k0 = null;
    arr.forEach((v, k) => { if (v == null) { if (k0 != null) { path += `V${bot}H${X(k0).toFixed(1)}Z`; k0 = null; } return; }
      if (k0 == null) { k0 = k; path += `M${X(k).toFixed(1)},${bot}V${Y(v).toFixed(1)}`; } else path += `V${Y(v).toFixed(1)}`;
      path += `H${X(Math.min(k + 1, arr.length - 1)).toFixed(1)}`; });
    if (k0 != null) path += `V${bot}H${X(k0).toFixed(1)}Z`;
    return path && !plain ? `<path d="${path}" fill="#f6a623" opacity=".17"/>` : ''; };
  g += area(az) + seg(az, '#f08c00', 1.6, .9) + (fb.length ? seg(fb, '#0a9396', 1.8, .95) : '') + seg(bb, '#e91e8c', 2.8);
  if (kLand > 0 && !plain) { const xw = Math.max(0, Math.min(X(kLand), W - PR) - PL); g += `<rect x="${PL}" y="${PT}" width="${xw.toFixed(1)}" height="${bot - PT}" fill="#f4f6f9" opacity=".62"/>${xw > 150 ? `<text x="${PL + 8}" y="${PT + 14}" class="rpc-note">before you had it</text>` : ''}`; }
  // when it landed and its day 90 — the clock everything else runs on
  const vmark = (date, col, lab) => { const k = dayK(date); if (k < 0 || k >= n) return ''; const x = X(k), end = x + 6 + lab.length * 7.2 > W - PR; return `<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${PT}" y2="${bot}" stroke="${col}" stroke-width="1.8" stroke-dasharray="6 4"/><text x="${(end ? x - 6 : x + 6).toFixed(1)}" y="${PT + 13}"${end ? ' text-anchor="end"' : ''} class="rpc-lab" fill="${col}" paint-order="stroke" stroke="#fff" stroke-width="4">${lab}</text>`; };
  if (h.landed) g += vmark(h.landed, '#334155', `landed ${dm(h.landed)} · ${h.age} days ago`);
  if (h.day90) g += vmark(h.day90, '#e8590c', 'day 90');
  // your lines — labels on two sides, spaced so they never sit on each other
  const labs = { L:[], R:[] };
  const hl = (v, col, dash, lab, side, w) => { if (v == null) return ''; const [a0, a1] = String(lab).split('§'); labs[side].push({ y: Y(v) - 5, col, t: `${a0} ${rpGBP(v)}${a1 || ''}` });
    return `<line x1="${PL}" x2="${W - PR}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" stroke="${col}" stroke-width="${w || 2}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`; };
  const labDraw = side => { const G = 18, top = PT + 32, low = bot - 4, L = labs[side].map(l => ({ ...l, y:Math.max(top, Math.min(low, l.y)) })).sort((a, b) => a.y - b.y);
    for (let i = 1; i < L.length; i++) if (L[i].y - L[i - 1].y < G) L[i].y = L[i - 1].y + G;
    if (L.length && L[L.length - 1].y > low) { L[L.length - 1].y = low; for (let i = L.length - 2; i >= 0; i--) if (L[i + 1].y - L[i].y < G) L[i].y = L[i + 1].y - G; }
    return L.map(l => `<text x="${side === 'R' ? W - PR - 6 : PL + 6}" y="${l.y.toFixed(1)}" text-anchor="${side === 'R' ? 'end' : 'start'}" class="rpc-lab" fill="${l.col}" paint-order="stroke" stroke="#fff" stroke-width="4">${l.t}</text>`).join(''); };
  const uTxt = (g0, on) => on ? `§ · ${g0.u} unit${g0.u !== 1 ? 's' : ''}${g0.n > 1 ? `, ${g0.n} SKUs` : ''}` : '';
  const manyM = minsG.length > 1, manyB = besG.length > 1;
  const sameMin = r.myPrice != null && minsG.some(g0 => Math.abs(g0.v - r.myPrice) < 0.5);
  if (sa) g += hl(sa.low, '#7a8699', '1 4', 'usual sale', 'L', 1.6);
  if (nb) labs.L.push({ y: Y(nb.hi) - 5, col:'#00875a', t:`normal ${rpGBP(nb.lo)}–${rpGBP(nb.hi).replace('£', '')}` });
  if (besG.length) besG.forEach(g0 => { g += hl(g0.v, '#d32f2f', '6 4', `break-even${uTxt(g0, manyB)}`, 'L'); }); else g += hl(r.be, '#d32f2f', '6 4', 'break-even', 'L');
  if (minsG.length) minsG.forEach(g0 => { if (!(r.myPrice != null && Math.abs(g0.v - r.myPrice) < 0.5)) g += hl(g0.v, '#b8860b', '2 3', `${manyM ? 'min' : 'your min'}${uTxt(g0, manyM)}`, 'L'); });
  else if (r.myMin != null && !(r.myPrice != null && Math.abs(r.myMin - r.myPrice) < 0.5)) g += hl(r.myMin, '#b8860b', '2 3', 'your min', 'L');
  if (target != null) g += hl(target, '#2e9e5b', '9 5', 'your target', 'R', 1.8);
  const meMin = minsG.find(g0 => r.myPrice != null && Math.abs(g0.v - r.myPrice) < 0.5);
  g += hl(r.myPrice, '#1565c0', '', sameMin ? (manyM ? `you = min${uTxt(meMin, true)}` : 'you = your min') : 'you now', 'R', 2.4);
  if (r.call && r.call.price != null && Math.abs(r.call.price - (r.myPrice || 0)) > 0.5 && (r.be == null || Math.abs(r.call.price - r.be) > 0.5)) g += hl(r.call.price, RP_KIND[r.call.kind][1], '10 4', 'suggested', 'R', 2.2);
  g += labDraw('L') + labDraw('R');
  // sellers on the listing (Keepa's new-offer count — FBA and FBM together; Keepa has no FBA-only history)
  const oc = (S.oc || []).slice(off).map(v => v >= 0 ? v : null), ocv = oc.filter(v => v != null);
  let SL = null;
  if (ocv.length > 1) {
    const top = HM + 26, sb = H - 8, ax2 = niceAxis(0, Math.max(...ocv, 4)), hi = ax2.max, Ys = v => sb - v / hi * (sb - top);
    let p = '', pen = false, k0 = null, fill = '';
    oc.forEach((v, k) => { if (v == null) { if (k0 != null) { fill += `V${sb}H${X(k0).toFixed(1)}Z`; k0 = null; } pen = false; return; }
      if (k0 == null) { k0 = k; fill += `M${X(k).toFixed(1)},${sb}V${Ys(v).toFixed(1)}`; } else fill += `V${Ys(v).toFixed(1)}`;
      p += `${pen ? 'L' : 'M'}${X(k).toFixed(1)},${Ys(v).toFixed(1)}`; if (k + 1 < oc.length && oc[k + 1] != null) { p += `H${X(k + 1).toFixed(1)}`; fill += `H${X(k + 1).toFixed(1)}`; } pen = true; });
    if (k0 != null) fill += `V${sb}H${X(k0).toFixed(1)}Z`;
    for (let v = 0; v <= hi + 1e-9; v += ax2.step) g += `<line x1="${PL}" x2="${W - PR}" y1="${Ys(v).toFixed(1)}" y2="${Ys(v).toFixed(1)}" stroke="${v === 0 ? '#cfd5de' : '#eef1f5'}"/><text x="${PL - 8}" y="${(Ys(v) + 4).toFixed(1)}" text-anchor="end" class="rpc-ax">${Math.round(v)}</text>`;
    const last = ocv[ocv.length - 1], lo = Math.min(...ocv), pk = Math.max(...ocv);
    g += `${plain ? '' : `<path d="${fill}" fill="#5b6b82" opacity=".12"/>`}<path d="${p}" fill="none" stroke="#475569" stroke-width="2"/>
      <text x="${PL + 6}" y="${top - 8}" class="rpc-note">sellers on the listing (FBA + FBM) · ${ocv[0]} → <tspan font-weight="700" fill="#334155">${last} now</tspan> · fewest ${lo} · most ${pk}</text>
      <circle cx="${X(n - 1).toFixed(1)}" cy="${Ys(last).toFixed(1)}" r="3.5" fill="#475569"/><text x="${(W - PR + 8).toFixed(1)}" y="${(Ys(last) + 4).toFixed(1)}" class="rpc-ax" font-weight="700" fill="#334155">${last}</text>
      <circle class="rpc-sdot" r="4.5" fill="#fff" stroke="#475569" stroke-width="2" opacity="0"/><text class="rpc-stxt" font-size="12.5" font-weight="700" fill="#0f172a" paint-order="stroke" stroke="#fff" stroke-width="4" opacity="0"></text>`;
    SL = { top, sb, hi };
  }
  g += `<circle class="rpc-bdot" r="4.5" fill="#fff" stroke="#e91e8c" stroke-width="2.4" opacity="0"/>`;
  // the hover line and readout
  const id = `${h.asin}_${days}${plain ? 'p' : ''}`;
  RP_CH[id] = { n, s0, W, PL, PR, bb, az, fb, oc, rk, me: r.myPrice, SL, Y, axMax: ax.max };
  g += `<line class="rpc-x" x1="0" x2="0" y1="${PT}" y2="${ocv.length > 1 ? H - 6 : bot}" stroke="#0f172a" stroke-width="1" opacity="0"/>`;
  return `<svg viewBox="0 0 ${W} ${ocv.length > 1 ? H : HM}" class="rp-chart" data-ch="${id}" onmousemove="rpHover(event,this)" onmouseleave="rpHoverOff(this)" role="img" aria-label="Buy Box, Amazon and lowest FBA price, last ${days} days, sales rank, and the seller count under it">${g}</svg><div class="rpc-tip"></div>`;
}
function rpHover(ev, svg){
  const c = RP_CH[svg.dataset.ch]; if (!c) return;
  const b = svg.getBoundingClientRect(), x = (ev.clientX - b.left) / b.width * c.W;
  const k = Math.max(0, Math.min(c.n - 1, Math.round((x - c.PL) / (c.W - c.PL - c.PR) * (c.n - 1))));
  const xs = c.PL + k / Math.max(1, c.n - 1) * (c.W - c.PL - c.PR);
  const ln = svg.querySelector('.rpc-x'); if (ln) { ln.setAttribute('x1', xs); ln.setAttribute('x2', xs); ln.setAttribute('opacity', '.55'); }
  const bd = svg.querySelector('.rpc-bdot'); if (bd) { if (c.bb[k] != null) { bd.setAttribute('cx', xs); bd.setAttribute('cy', c.Y(c.bb[k])); bd.setAttribute('opacity', '1'); } else bd.setAttribute('opacity', '0'); }
  const sd = svg.querySelector('.rpc-sdot'), st = svg.querySelector('.rpc-stxt');
  if (sd && st && c.SL) { const v = c.oc[k];
    if (v != null) { const yy = c.SL.sb - v / c.SL.hi * (c.SL.sb - c.SL.top), right = xs > c.W - c.PR - 120;
      sd.setAttribute('cx', xs); sd.setAttribute('cy', yy); sd.setAttribute('opacity', '1');
      st.setAttribute('x', right ? xs - 9 : xs + 9); st.setAttribute('y', Math.max(c.SL.top + 10, yy - 7)); st.setAttribute('text-anchor', right ? 'end' : 'start'); st.textContent = `${v} seller${v !== 1 ? 's' : ''}`; st.setAttribute('opacity', '1');
    } else { sd.setAttribute('opacity', '0'); st.setAttribute('opacity', '0'); } }
  const tip = svg.nextElementSibling; if (!tip) return;
  const day = new Date(c.s0 + k * RP_DAY).toLocaleDateString('en-GB', { weekday:'short', day:'numeric', month:'short', year:'numeric' });
  const row = (col, lab, v) => v == null ? '' : `<div><i style="background:${col}"></i>${lab}<b>${v}</b></div>`;
  tip.innerHTML = `<div class="d">${day}</div>${row('#e91e8c', 'Buy Box', c.bb[k] != null ? rpGBP(c.bb[k]) : 'none')}${row('#f6a623', 'Amazon', c.az[k] != null ? rpGBP(c.az[k]) : 'not selling')}${row('#0a9396', 'Lowest FBA', c.fb[k] != null ? rpGBP(c.fb[k]) : null)}${row('#475569', 'Sellers on it', c.oc[k] != null ? c.oc[k] : null)}${row('#3fa34d', 'Sales rank', c.rk[k] != null ? '#' + c.rk[k].toLocaleString() : null)}`;
  const px = (xs / c.W) * b.width, wrap = svg.parentElement.getBoundingClientRect();
  tip.style.display = 'block';
  const left = b.left - wrap.left + px + 14, tw = tip.offsetWidth;
  tip.style.left = (left + tw > wrap.width - 8 ? left - tw - 28 : left) + 'px';
  tip.style.top = (b.top - wrap.top + 40) + 'px';
}
function rpHoverOff(svg){ const ln = svg.querySelector('.rpc-x'); if (ln) ln.setAttribute('opacity', '0'); svg.querySelectorAll('.rpc-bdot,.rpc-sdot,.rpc-stxt').forEach(e => e.setAttribute('opacity', '0')); const tip = svg.nextElementSibling; if (tip) tip.style.display = 'none'; }
window.rpHover = rpHover; window.rpHoverOff = rpHoverOff;
function rpQueueHtml(h, r){
  const q = r.q, rows = [];
  let run = 0;
  const amz = q.amz, me = q.me;
  const items = q.levels.map(L => ({ ...L, kind:'l' }));
  if (amz) items.push({ p:amz.p, units:amz.s, kind:'amz' });
  if (me) items.push({ p:me.p, units:me.s, kind:'me' });
  items.sort((a, b) => a.p - b.p || (a.kind === 'me' ? 1 : -1));
  let shown = 0, passedMe = false, runPlus = false;
  for (const it of items) {
    if (passedMe && shown > 3) break;
    if (it.kind === 'l') { run += it.units; runPlus = runPlus || it.unknown; }
    const lab = it.kind === 'amz' ? `<b class="rp-amz">Amazon</b>` : it.kind === 'me' ? `<b class="rp-me">You</b>` : `${it.sellers} FBA seller${it.sellers > 1 ? 's' : ''}`;
    const u = it.kind === 'amz' ? (it.units == null ? '?' : it.units >= 99999 ? 'plenty' : it.units >= RP_STOCK_CAP ? '1,000+' : it.units.toLocaleString()) : it.units == null ? '?' : `${it.units.toLocaleString()}${it.unknown ? '+' : ''}`;
    rows.push(`<tr class="${it.kind}"><td>${rpGBP(it.p)}</td><td>${lab}</td><td class="n">${u}</td><td class="n">${it.kind === 'l' ? run.toLocaleString() + (runPlus ? '+' : '') : it.kind === 'me' ? `<b>${run.toLocaleString()}${runPlus ? '+' : ''}</b> ahead` : '<em>not counted</em>'}</td></tr>`);
    if (it.kind === 'me') passedMe = true;
    shown++;
  }
  return `<table class="rp-q"><thead><tr><th>Price</th><th>Who</th><th class="n">Units</th><th class="n">Running total</th></tr></thead><tbody>${rows.join('')}</tbody></table>
    <div class="rp-qnote">${r.S ? `Listing sells about <b>${Math.round(r.S * 30).toLocaleString()}</b> a month` : 'Monthly sales unknown'} · ${r.q.others.length} other FBA seller${r.q.others.length !== 1 ? 's' : ''}${r.q.fbm ? ` · ${r.q.fbm} FBM not counted` : ''}</div>`;
}
const RP_CACHE = {};
function rpCall(h, rec){
  const key = rec.checked_at + '|' + h.units + '|' + h.skus.map(s => (RP.settings[s.sku] || {}).min_price).join(',') + '|' + Object.keys(RP.hist || {}).length;
  const c = RP_CACHE[h.asin];
  if (c && c.key === key) return c.r;
  const r = rpDecide(h, rec.data); RP_CACHE[h.asin] = { key, r }; return r;
}
// What Jack should do from now through Black Friday and Christmas — step by step, from this listing's own
// last year (Jack, 10 Nov: "remember we are coming into Black Friday season, that's why we look at a year")
const RP_XMAS = '2026-12-20';
function rpPlan(h, d, r){
  const today = rpToday(); if (today > RP_XMAS) return null;
  const bx = d.bfPrev && d.bfPrev.bb && d.bfPrev.bb.some(v => v > 0) ? d.bfPrev : null;
  const bb = bx ? bx.bb.map(v => v > 0 ? v / 100 : null) : r.pat.bb, b0 = bx ? bx.from : d.start;
  const kOf = dt => Math.round((rpMs(dt) - rpMs(b0)) / RP_DAY);
  const med = a => { const v = a.filter(x => x != null).sort((x, y) => x - y); return v.length ? v[Math.floor(v.length / 2)] : null; };
  const add = (dt, n) => rpDay(rpMs(dt) + n * RP_DAY);
  const win = (a, b) => kOf(b) < 0 ? [] : bb.slice(Math.max(0, kOf(a)), kOf(b) + 1);
  const dm = dt => new Date(dt + 'T12:00:00Z').toLocaleDateString('en-GB', { day:'numeric', month:'short' });
  const L = RP_BF, be = r.be, c = r.call || {}, pr = x => rpProfit(x, h.cost, d), pc = (a, b) => Math.round((1 - a / b) * 100);
  const first = bb.findIndex(v => v != null), firstDay = first >= 0 ? rpDay(rpMs(b0) + first * RP_DAY) : null;
  const preV = first >= 0 ? win(add(L.lastStart, -21), add(L.lastStart, -1)).filter(v => v != null) : [];
  const pre = preV.length >= 7 ? med(preV) : null;
  const during = win(L.lastStart, L.lastEnd).filter(v => v != null);
  const has = pre != null && during.length >= 4;
  const bfMin = has ? Math.min(...during) : null, bfMid = has ? med(during) : null, drop = has ? 1 - bfMin / pre : 0;
  const bfDays = has ? during.filter(v => v <= pre * 0.92).length : 0;
  const dec = has ? med(win(add(L.lastEnd, 1), '2025-12-20')) : null, jan = med(win('2026-01-05', '2026-01-31'));
  const back = dec != null && pre != null && dec >= pre * 0.95;
  const se = r.season, xmasBusy = se && se.months && (se.months.includes(11) || se.months.includes(12));
  const amzP = r.q.amz ? r.q.amz.p : d.amzNow, behindAmz = r.amzHasBB && c.price != null && amzP != null && c.price > amzP + 0.01;
  const toBF = Math.round((rpMs(L.start) - rpMs(today)) / RP_DAY);
  const K = RP_KIND[c.kind || 'none'][1], steps = [];
  // 1 · now
  if (today < L.start) {
    let t = '';
    if (behindAmz) t = `Amazon has the Buy Box at ${rpGBP(amzP)}, so this sells when Amazon runs out or goes back up.`;
    else if (r.clearDays != null) { const n = Math.max(1, Math.round(r.clearDays)); t = `At about ${Math.round(r.S * 30).toLocaleString()} a month the queue and your ${h.units} go in about ${n} day${n > 1 ? 's' : ''}${n <= toBF ? ' — before Black Friday starts.' : ` — that runs past ${dm(L.start)}, into Black Friday.`}`; }
    else if (r.own && r.own.sold > 0) t = `You sold ${r.own.sold} in the last ${r.own.days} days.`;
    steps.push({ when:`Now → ${dm(add(L.start, -1))}`, col:K, what:c.label || '—', t });
  }
  const bfP = bfMid != null && be != null ? Math.max(bfMid, be) : bfMid;
  const bfPays = has && drop >= 0.08 && bfMid != null && (pr(bfMid) ?? -1) > 0;
  const bfUnder = has && drop >= 0.08 && !bfPays;
  const higherDec = has && dec != null && dec > pre * 1.05;
  const toy = /\bLEGO\b|\btoys?\b|advent calendar|gift set/i.test(d.title || h.title || '');
  // 2 · Black Friday week
  if (today <= L.end) {
    let what, t, col;
    if (!has) { col = '#8b99ab'; what = toy ? 'Christmas toy: step down mid-Nov' : 'Watch it — no history';
      t = `No Black Friday last year to go on${firstDay && firstDay > L.lastStart ? ` (Keepa only has it from ${dm(firstDay)} ${firstDay.slice(0, 4)})` : ''}. ${toy ? `Toys sell hardest up to about 20 Dec — if you're still holding on 15 Nov, step down towards the FBA queue, never below your break-even ${rpGBP(be)}.` : `If prices drop on ${dm(L.start)}, don't follow below your break-even ${rpGBP(be)}.`}`; }
    else if (drop < 0.08) { col = '#00f5a0'; what = 'No change needed';
      t = bfMin >= pre * 0.99 ? `Last year it didn't drop for Black Friday: ${rpGBP(pre)} before, ${rpGBP(bfMin)} at the lowest.` : `Last year it hardly moved: ${rpGBP(pre)} before, ${rpGBP(bfMin)} at the lowest.`; }
    else if (bfPays) { col = '#ff8c42'; what = `Go down with it to about ${rpGBP(bfP)}`;
      t = `Last year ${rpGBP(pre)} → ${rpGBP(bfMin)} (−${pc(bfMin, pre)}%) for ${bfDays} day${bfDays !== 1 ? 's' : ''}. At ${rpGBP(bfP)} you still make ${rpGBP(pr(bfP))} each — sell through the busiest week instead of sitting above it.`; }
    else { col = '#3d9eff'; what = `Don't follow it — hold at ${rpGBP(be)}`;
      t = `Last year it fell ${rpGBP(pre)} → ${rpGBP(bfMin)} (−${pc(bfMin, pre)}%) for ${bfDays} day${bfDays !== 1 ? 's' : ''}, under your break-even ${rpGBP(be)}. ${back ? `It was back at ${rpGBP(dec)} in December, so holding through the week is the safer bet.` : `It stayed down in December (${rpGBP(dec)}), so the real aim is to sell before ${dm(L.start)} — anything left, don't sell at a loss in the busiest week.`}`; }
    steps.push({ when:`Black Friday · ${dm(L.start)}–${dm(L.end)}`, col, what, t });
  }
  // 3 · the Christmas run
  { let what, t, col;
    if (has && dec != null) {
      if (higherDec) { col = '#00f5a0'; what = `Higher in December: about ${rpGBP(dec)}`; t = `Last year December was ${rpGBP(dec)} against ${rpGBP(pre)} before Black Friday — don't sell cheap ahead of Christmas.`; }
      else if (drop < 0.08 || Math.abs(dec / pre - 1) < 0.05) { col = '#3d9eff'; what = `Steady at about ${rpGBP(dec)}`; t = `Last December it sold at about ${rpGBP(dec)}.`; }
      else if (back) { col = '#00f5a0'; what = `Back up to about ${rpGBP(dec)}`; t = `After Black Friday it was back to ${rpGBP(dec)} for December. Whatever's left: price it for the Christmas run.`; }
      else { col = '#ff8c42'; what = `Don't count on a bounce`; t = `Last year December stayed at about ${rpGBP(dec)}, against ${rpGBP(pre)} before Black Friday.`; }
    } else { col = '#8b99ab'; what = `Aim to be clear by ${dm(RP_XMAS)}`; t = `After the last Christmas delivery day most things slow right down.`; }
    if (xmasBusy) t += ` It sells about ${se.peak.toLocaleString()} a month in ${se.label}, ${se.rest >= 50 ? `about ${se.rest.toLocaleString()}` : 'under 50'} otherwise.`;
    steps.push({ when:`Christmas · to ${dm(RP_XMAS)}`, col, what, t }); }
  // 4 · if any are still here
  { let what, t, col = '#ff4d6d';
    if (jan != null && pre != null) { const pays = (pr(jan) ?? -1) > 0;
      what = pays ? `Sell at about ${rpGBP(jan)}` : `Get out at break-even ${rpGBP(be)}`; col = pays ? '#3d9eff' : '#ff4d6d';
      t = `Last January the Buy Box was about ${rpGBP(jan)}${jan < pre * 0.92 ? ` (−${pc(jan, pre)}% on before Black Friday)` : jan > pre * 1.05 ? ` — higher than before Black Friday` : ''}${pays ? '' : ' — under your break-even'}.`; }
    else { what = 'Look again on 21 Dec'; col = '#8b99ab'; t = `Stock left after Christmas waits for the January sales — decide then from the graph.`; }
    if (h.day180 && h.day180 <= '2027-02-28') t += ` It passes 180 days on ${dm(h.day180)}.`;
    steps.push({ when:`If any are left · from ${dm(add(RP_XMAS, 1))}`, col, what, t }); }
  // the one-line version
  const refP = c.price ?? r.myPrice;
  let head = `${c.label || 'Check the graph'} now.`;
  if (!has) head += toy ? ` No Black Friday history — as a Christmas toy, step down mid-Nov if you're still holding.` : ` No Black Friday history for this one, so watch it from ${dm(L.start)}.`;
  else if (bfPays) head += ` Anything left on ${dm(L.start)}: go down with Black Friday to about ${rpGBP(bfP)} — it still pays.`;
  else if (bfUnder && back) head += ` Anything left on ${dm(L.start)}: hold at break-even — last year Black Friday went under it, then came back in December.`;
  else if (bfUnder) head += ` Try to clear it before ${dm(L.start)}: last year Black Friday took it under your break-even and it stayed down in December.`;
  else head += ` Black Friday didn't pull it down last year.`;
  if (higherDec && refP != null && dec > refP * 1.05) head += ` Last December it reached about ${rpGBP(dec)}.`;
  return { head, steps };
}
function rpPlanHtml(p){
  if (!p) return '';
  return `<div class="rpk-plan"><div class="rpk-planh"><span>What I'd do</span>${p.head}</div>
    <div class="rpk-steps">${p.steps.map((s, i) => `<div class="rpk-step" style="--c:${s.col}"><div class="w"><i>${i + 1}</i>${s.when}</div><div class="a">${s.what}</div><div class="t">${s.t}</div></div>`).join('')}</div></div>`;
}
// One card per product — the 15 Oct demo Jack liked: the call up top, the graph big (is it tanking, how
// badly, will it recover), then the buy / why it hasn't sold / the queue up to his price, then the SKUs.
function rpCard(h, rec){
  const d = rec.data, r = rpCall(h, rec), story = rpStory(h, d, r), can = rpCanAct();
  const c = r.call || { kind:'none' }, K = RP_KIND[c.kind], days = RP.zoom[h.asin] || 365;
  const late = h.day90 && rpMs(h.day90) < Date.now();
  const ch = rpChanges(rec, r), own = rpOwnSales(), shape = rpShape(r, rec), B = RP_BUY[r.buy.v];
  const dec = RP.decisions.find(x => x.asin === h.asin && !x.sku && x.action === 'wait') || null;
  const sugs = [...new Set(r.skus.filter(x => x.sug != null).map(x => x.sug.toFixed(2)))].map(Number).sort((a, b) => a - b);
  const priceTxt = c.price == null ? '' : sugs.length > 1 ? `${rpGBP(sugs[0])}–${rpGBP(sugs[sugs.length - 1]).replace('£', '')}` : rpGBP(sugs[0] ?? c.price);
  const done = r.skus.filter(x => { const dd = rpLastDecision(h.asin, x.sku); return dd && rpMs(String(dd.decided_at).slice(0, 10)) >= rpFullAt(rec) - 864e5; }).length;
  const ageTxt = h.landed ? (late ? `${h.age} days at Amazon · missed day 90 (${fmtShort(h.day90)})` : `${h.age} days at Amazon · sell by ${fmtShort(h.day90)}`) : 'landed date unknown';
  const target = h.skus.map(s => s.target).find(v => v != null) ?? null;
  const kL = h.landed ? Math.max(0, Math.round((rpMs(h.landed) - rpMs(d.start)) / RP_DAY)) : 0;
  const since = d.bb.slice(kL).filter(v => v > 0).map(v => v / 100), peak = since.length ? Math.max(...since) : null;
  const atBB = d.bbNow != null ? rpProfit(d.bbNow, h.cost, d) : null;
  const f = (k, v, cls) => `<div class="rpk-f${cls ? ' ' + cls : ''}"><span>${k}</span><b>${v}</b></div>`;
  const sq = s => rpEsc(s).replace(/'/g, "\\'");
  return `<div class="rpk" style="--k:${K[1]}" id="rp_${h.asin}">
    <div class="rpk-head">
      <div class="rpk-img">${d.image ? `<img src="${rpEsc(d.image)}" alt="" loading="lazy">` : ''}</div>
      <div style="min-width:0">
        <div class="rpk-name" title="${rpEsc(d.title || h.title || h.asin)}">${rpEsc(d.title || h.title || h.asin)}</div>
        <div class="rpk-meta"><button class="rpk-asin rp-copy" onclick="rpCopy('${h.asin}','the ASIN ${h.asin}')" title="Copy the ASIN">${h.asin} ⧉</button>${[...h.providers].map(p => `<span class="rpk-prov" title="${rpEsc(rpProvInfo(p))}">${rpEsc(p)}</span>`).join('')}
          <span class="rpk-age ${late ? 'late' : 'ok'}">${ageTxt}</span>${(sfC => sfC ? `<span class="rpk-fine" title="At your own pace from Sarah's uploads">selling fine · ${sfC.sold} sold in ${sfC.days} days, gone in ~${sfC.clears}d</span>` : '')(rpSellingFine(h))}
          <span><b style="color:var(--text)">${rpGBP0(h.value)}</b> tied up · ${h.units} unit${h.units !== 1 ? 's' : ''}${h.skus.length > 1 ? ` · ${h.skus.length} SKUs` : ''}</span></div>
        <div class="rpk-links"><a href="https://www.amazon.co.uk/dp/${h.asin}" target="_blank" rel="noopener">Amazon ↗</a><a href="https://keepa.com/#!product/2-${h.asin}" target="_blank" rel="noopener">Keepa ↗</a><a href="https://sas.selleramp.com/sas/lookup?SasLookup%5Bsearch_term%5D=${h.asin}${h.cost != null ? `&SasLookup%5Bcost_price%5D=${h.cost.toFixed(2)}` : ''}" target="_blank" rel="noopener">SellerAmp ↗</a><span class="rpk-checked">Keepa checked ${rpAgo(rec.checked_at)}</span></div>
      </div>
      <div class="rpk-callbox">
        <div class="rpk-cl1"><span class="rpk-kind">${K[0]}</span>${priceTxt ? `<span class="rpk-price">${priceTxt}</span>` : ''}${ch ? `<span class="rp-new" title="Changed since the last check">⚡</span>` : ''}</div>
        ${c.label && !(priceTxt && c.label.length < 30 && c.label.includes(priceTxt)) ? `<div class="rpk-cl2">${rpEsc(c.label)}</div>` : ''}
        <div class="rpk-cl3">${c.each != null ? `<span class="${c.each < 0 ? 'neg' : 'pos'}">${rpGBP(c.each)} each</span> · ${rpGBP0(c.total)} on ${h.units}${c.back ? ` · ${rpGBP0(c.back)} back` : ''}` : ''}${r.clearDays != null ? `${c.each != null ? ' · ' : ''}${r.clearDays < 1.5 ? 'clears in about a day' : `clears in about ${Math.round(r.clearDays)} days`}` : ''}</div>
        ${done ? `<div class="rpk-done">✓ ${done} of ${r.skus.length} SKU${r.skus.length > 1 ? 's' : ''} done in STK</div>` : ''}
      </div>
    </div>
    ${rpDealHtml(h, rec)}
    ${rpPlanHtml(rpPlan(h, d, r))}
    ${d.look ? `<div class="rpk-look rpk-pad"><b>Quick look ${fmtShort(String(d.look.at).slice(0, 10))} · 1 token:</b> Amazon, the lowest price and the sellers haven't moved since the full check on ${fmtShort(String(d.checked).slice(0, 10))}, so that check is kept — the graph and the queue are from then. The next check after ${fmtShort(rpDay(Date.parse(d.checked) + RP_LOOK_D * RP_DAY))} is a full one anyway, or sooner if something moves.</div>` : ''}
    ${ch ? `<div class="rp-chg rpk-pad"><b>⚡ Since the check on ${fmtShort(String(ch.since).slice(0, 10))}:</b> ${ch.items.join(' · ')}</div>` : ''}
    ${r.why.length || r.warn.length ? `<div class="rpk-reasons">${r.why.length ? `<ul>${r.why.map(x => `<li>${x}</li>`).join('')}</ul>` : ''}${r.warn.length ? `<ul class="w">${r.warn.map(x => `<li>${x}</li>`).join('')}</ul>` : ''}</div>` : ''}
    <div class="rpk-graph">
      <div class="rp-zoom"><button class="${days === 548 ? 'on' : ''}" onclick="RP.zoom['${h.asin}']=548;rpRender()" title="${d.x18 ? 'The last 18 months — costs no extra tokens' : 'Comes with this product\'s next check (no extra tokens) — until then it shows the year'}">1½ years${d.x18 ? '' : ' <small>next check</small>'}</button><button class="${days === 365 ? 'on' : ''}" onclick="RP.zoom['${h.asin}']=365;rpRender()">1 year</button><button class="${days === 90 ? 'on' : ''}" onclick="RP.zoom['${h.asin}']=90;rpRender()">90 days</button><button class="rp-plain ${RP.plain[h.asin] ? 'on' : ''}" onclick="RP.plain['${h.asin}']=!RP.plain['${h.asin}'];rpRender()" title="Turn the shading off (the grey before you had it, the sale and normal-price bands, the Amazon fill) to see the lines clearly">${RP.plain[h.asin] ? 'Shading off' : 'Shading on'}</button>
        <span class="rp-leg"><i style="background:#e91e8c"></i>Buy Box <i style="background:#f6a623"></i>Amazon <i style="background:#0a9396"></i>lowest FBA <i style="background:#1565c0"></i>you <i style="background:#b8860b"></i>your min <i style="background:#2e9e5b"></i>your target <i style="background:#d32f2f"></i>break-even <i style="background:#3fa34d;opacity:.7"></i>sales rank (right) <i class="nb"></i>normal price <i class="dip"></i>sale · grey = before you had it · hover for any day</span></div>
      ${rpChart(h, d, r, days)}
    </div>
    <div class="rpk-year"><div class="rp-h">What the last year says · ${r.pat.dips.length} sale dip${r.pat.dips.length !== 1 ? 's' : ''}${r.pat.dips.length ? (r.pat.regular ? ' — regular' : r.pat.dips.length === 1 ? ' — one-off so far' : '') : ''}</div>
      ${shape ? `<div>${shape}</div>` : ''}
      <div class="rp-dips" style="margin-top:8px">${r.pat.dips.length ? r.pat.dips.map(x => `<span class="rp-dip" title="${fmt(x.start)} → ${fmt(x.end)}: ${rpGBP(x.base)} → ${rpGBP(x.min)}">${fmtShort(x.start)}${x.days > 1 ? '–' + fmtShort(x.end) : ''} <b>−${Math.round(x.depth * 100)}%</b>${x.event ? ` · ${x.event}` : ''}</span>`).join('') : '<span class="rp-dim">No sale dips — the price held all year.</span>'}</div>
    </div>
    <div class="rpk-cols">
      <div class="rpk-col"><div class="rp-h">The buy</div>
        ${target != null ? f('Your target', rpGBP(target)) : ''}
        ${f('Peak since it landed', rpGBP(peak))}
        ${f('Buy Box now', rpGBP(d.bbNow) + (rpDealOn(rec) ? ` <small class="rpk-dsm">${r.amzHasBB ? 'Amazon deal' : 'deal'}</small>` : r.amzHasBB ? ' <small>Amazon</small>' : ''))}
        ${f('You now', rpGBP(r.myPrice), 'you')}
        ${f('Your min in STK', rpGBP(r.myMin))}
        ${f('Break-even', rpGBP(r.be))}
        ${f('Your cost', rpGBP(h.cost))}
        ${f('Profit each at today’s Buy Box', rpGBP(atBB), atBB == null ? '' : atBB < 0 ? 'neg' : 'pos')}
        ${f('You sold', r.own ? `${r.own.sold} in ${r.own.days} days` : '—')}
        ${f('At your pace', r.own ? (r.own.clear != null ? `${h.units} gone in ~${Math.max(1, Math.round(r.own.clear))} days` : 'none sold yet') : '—')}
      </div>
      <div class="rpk-col"><div class="rp-h">Why it hasn’t sold</div>
        <span class="rpk-verdict" style="--bv:${B[1]}">${B[0]}</span>
        <div class="rpk-story rpk-lead">${r.buy.t.replace(/^[^—]+— /, '').replace(/^./, m => m.toUpperCase())}${rpDealWhy(rec)}</div>
        ${story.length ? `<ul class="rpk-sl">${story.map(x => `<li>${x}</li>`).join('')}</ul>` : '<div class="rpk-story">—</div>'}
      </div>
      <div class="rpk-col"><div class="rp-h">The queue up to your price</div>${rpQueueHtml(h, r)}</div>
    </div>
    <div class="rpk-skus">
      <table class="rp-skut"><thead><tr><th>SKU</th><th>Provider</th><th class="n">Left / bought</th><th class="n" title="Since ${own.from ? fmtShort(own.from) : 'the first upload with SKUs'}">Sold</th><th class="n">Cost</th><th class="n">Break-even</th><th class="n">Your min</th><th class="n">Set min to</th><th class="n">Each</th><th></th></tr></thead><tbody>
      ${r.skus.map(x => { const id = x.sku.replace(/[^A-Za-z0-9]/g, '_'), dd = rpLastDecision(h.asin, x.sku);
        return `<tr class="${x.change ? 'chg' : ''}">
          <td><button class="rp-copy" onclick="rpCopy('${sq(x.sku)}','the SKU')" title="${rpEsc(x.sku)} — copy it to paste into STK">${rpEsc(x.sku)} ⧉</button></td>
          <td>${rpEsc(x.provider)}${rpProvInfo(x.provider) ? `<small class="rp-pi">${rpProvInfo(x.provider)}</small>` : ''}</td><td class="n">${x.units}${x.bought ? ` / ${x.bought}` : ''}</td><td class="n">${own.sku[x.sku] ? `${own.sku[x.sku].sold}<small class="rp-dim"> /${own.sku[x.sku].days}d</small>` : '<span class="rp-dim">—</span>'}</td><td class="n">${rpGBP(x.cost)}</td><td class="n">${rpGBP(x.be)}</td>
          <td class="n">${x.min != null ? rpGBP(x.min) : '<span class="rp-dim">—</span>'}</td>
          <td class="n">${can ? `<input id="rpPrice_${id}" type="number" step="0.01" value="${x.sug != null ? x.sug.toFixed(2) : ''}">` : `<b>${rpGBP(x.sug)}</b>`}</td>
          <td class="n ${x.each != null && x.each < 0 ? 'neg' : 'pos'}">${rpGBP(x.each)}</td>
          <td class="rp-skua">${x.sug != null ? `<button class="rp-copy" onclick="rpCopy(document.getElementById('rpPrice_${id}') ? document.getElementById('rpPrice_${id}').value : '${x.sug.toFixed(2)}','the price')" title="Copy this price to paste into STK">Copy £</button>` : ''}
            ${can ? `<button class="rp-done" onclick="rpDecide2('${h.asin}','set','${sq(x.sku)}')">✓ Done in STK</button>` : ''}
            ${dd ? `<span class="rp-dd">${dd.action === 'set' ? `set ${rpGBP(dd.price)}` : dd.action === 'wait' ? 'left it' : dd.action} ${fmtShort(String(dd.decided_at).slice(0, 10))}${dd.units_then != null ? ` · ${Math.max(0, dd.units_then - x.units)} sold since` : ''}</span>` : ''}</td></tr>`; }).join('')}
      </tbody></table>
    </div>
    <div class="rpk-act">
      ${dec ? `<span class="rp-dec">You: left it on ${fmt(String(dec.decided_at).slice(0, 10))}${dec.units_then != null ? ` · ${Math.max(0, dec.units_then - h.units)} sold since (${h.units} left)` : ''}</span>` : '<span class="rp-dec none">No call recorded yet</span>'}
      ${can ? `<span class="rp-btns"><button onclick="rpDecide2('${h.asin}','wait')">Leave it all — waiting</button></span><button class="rpk-skip" onclick="rpSkip('${h.asin}',true)" title="Your own brand or bundle — take it out of the Repricer">Own brand — leave out</button>` : `<span class="rp-dim">Jack records the call on his laptop</span>`}
    </div>
  </div>`;
}
// Done on this pass = since the last Keepa check, every SKU was set in STK, or he chose "leave it all — waiting"
function rpDoneInfo(h, rec){
  if (!rec) return null;
  const since = rpFullAt(rec) - 864e5, after = x => Date.parse(x.decided_at) >= since;
  const w = RP.decisions.find(x => x.asin === h.asin && !x.sku && x.action === 'wait' && after(x));
  if (w) return { how:'Left it — waiting', at:w.decided_at };
  const sets = h.skus.map(s => RP.decisions.find(x => x.asin === h.asin && x.sku === s.sku && x.action === 'set' && after(x)));
  if (sets.length && sets.every(Boolean)) { const ps = [...new Set(sets.map(x => rpGBP(+x.price)))];
    return { how:`Set ${ps.join(' / ')} in STK${h.skus.length > 1 ? ` on ${h.skus.length} SKUs` : ''}`, at:sets.map(x => x.decided_at).sort().pop() }; }
  return null;
}
function rpDoneRow(h, rec, info){
  const d = rec.data, r = rpCall(h, rec), K = RP_KIND[r.call ? r.call.kind : 'none'];
  return `<div class="rpk rpk-doneRow" style="--k:${K[1]}" id="rp_${h.asin}">
    <div class="rpk-img sm">${d.image ? `<img src="${rpEsc(d.image)}" alt="" loading="lazy">` : ''}</div>
    <div class="rpk-dn">${rpEsc(d.title || h.title || h.asin)}</div>
    <span class="rpk-dk">${K[0]}</span>${rpDealOn(rec) ? `<span class="rpk-dsm" title="${rpEsc(rpDealOn(rec).items.map(x => x.badge).join(' · '))}">${rpDealOn(rec).amz ? 'Amazon deal' : 'Deal'}</span>` : ''}
    <span class="rpk-dh">✓ ${rpEsc(info.how)} · ${fmtShort(String(info.at).slice(0, 10))}</span>
    <span class="rpk-dv">${rpGBP0(h.value)}</span>
    <button class="rpk-back" onclick="RP.openDone['${h.asin}']=1;rpRender()">Open</button>
  </div>`;
}
// J / K = next / back through the cards (not while typing a price)
function rpKey(e){
  if (!document.getElementById('tab-repricer')?.classList.contains('active') || e.metaKey || e.ctrlKey || e.altKey) return;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '')) return;
  const k = e.key.toLowerCase(); if (k !== 'j' && k !== 'k') return;
  const cards = [...document.querySelectorAll('.rpk-list > .rpk')]; if (!cards.length) return;
  // the page scrolls inside .content, under the sticky progress bar
  const cur = (document.querySelector('.content')?.getBoundingClientRect().top || 0) + 70;
  const el = k === 'j' ? cards.find(c => c.getBoundingClientRect().top > cur + 8) : cards.slice().reverse().find(c => c.getBoundingClientRect().top < cur - 8);
  if (el) { e.preventDefault(); el.scrollIntoView({ behavior:'smooth', block:'start' }); }
}
if (!window._rpKeyOn) { window._rpKeyOn = true; document.addEventListener('keydown', rpKey); }
// Products not checked yet: one short line each, not a full row each
function rpTodoHtml(list, P, can){
  if (!list.length) return '';
  const v = list.reduce((t, h) => t + h.value, 0), today = rpToday(), in30 = rpDay(rpMs(today) + 30 * RP_DAY);
  const band = h => rpYoung(h) ? 'young' : !h.day90 ? 'later' : h.day90 < today ? 'late' : h.day90 <= in30 ? 'soon' : 'later';
  const SEC = { late:['Past day 90', 'var(--o)'], soon:['Day 90 in the next 30 days', 'var(--y)'], later:['Day 90 later', 'var(--g)'],
    young:[`Under ${RP_YOUNG_D} days at Amazon — not checked unless you press Check`, '#c4b5fd'] };
  // Jack, 10 Nov: like STK — oldest at the bottom (or the top, with Oldest → newest). Under 30 days always last.
  const order = RP.sort === 'old' ? ['late', 'soon', 'later', 'young'] : RP.sort === 'new' ? ['later', 'soon', 'late', 'young'] : null;
  const row = h => { const late = h.day90 && rpMs(h.day90) < Date.now(), sf = rpSellingFine(h);
    const chip = rpYoung(h) ? `<span class="a young">${h.age} day${h.age !== 1 ? 's' : ''} in</span>` : sf ? `<span class="a fine">selling fine · ~${sf.clears}d</span>`
      : `<span class="a ${late ? 'late' : 'ok'}">${h.landed ? (late ? `${h.age} days` : `by ${fmtShort(h.day90)}`) : ''}</span>`;
    const acts = can ? `<span class="rpk-acts"><button class="rpk-back rpk-one" title="Check just this one in Keepa — about ${rpTok()} tokens" onclick="rpCheckOne('${h.asin}')">Check · ~${rpTok()}</button><button class="rpk-back" title="Your own brand or bundle — take it out of the Repricer" onclick="rpSkip('${h.asin}',true)">Leave out</button></span>` : '';
    return `<div class="rpk-ti" title="${rpEsc(h.title || '')} · ${h.units} unit${h.units !== 1 ? 's' : ''}${sf ? ` — you sold ${sf.sold} in ${sf.days} days, so ${h.units} go in about ${sf.clears} days` : ''}"><span class="n">${rpEsc(h.title || h.asin)}</span>${chip}<span class="v">${rpGBP0(h.value)}</span>${acts}</div>`; };
  const secs = order ? order.map(k => [k, list.filter(h => band(h) === k)]).filter(x => x[1].length) : [[null, list]];
  return `<div class="rpk-todo"><div class="rpk-todoh"><b>${list.length} not checked yet</b> · ${rpGBP0(v)} tied up${can ? ` — press <b>${P.name === RP_ALL ? 'Check everything' : `Check ${rpEsc(P.name)}`}</b> at the top for all of them, or hover a line to check just that one` : ''}</div>
    ${secs.map(([k, xs]) => `${k ? `<div class="rpk-tsec" style="--c:${SEC[k][1]}">${SEC[k][0]} <b>${xs.length}</b> · ${rpGBP0(xs.reduce((t, h) => t + h.value, 0))}</div>` : ''}<div class="rpk-todol">${xs.map(row).join('')}</div>`).join('')}</div>`;
}
// The listing's shape in one line — what Jack reads off the graph first
function rpShape(r, rec){
  const p = r.pat, nb = p.normal, sa = p.sales, out = [], dl = rec ? rpDealOn(rec) : null, dn = dl ? `${dl.amz ? "Amazon's" : "the Buy Box seller's"} ${rpEsc(dl.items[0].badge)} deal` : '';
  if (p.straight) out.push(`Same price nearly all year, about ${rpGBP(p.straight.p)}.`);
  else {
    if (nb) out.push(`Normally ${rpGBP(nb.lo)}–${rpGBP(nb.hi).replace('£', '')}.`);
    if (sa && sa.n >= 2) out.push(`Goes on sale to about ${rpGBP(sa.low)} (−${Math.round(sa.depth * 100)}%)${sa.every ? ` roughly every ${sa.every >= 21 ? Math.round(sa.every / 7) + ' weeks' : sa.every + ' days'}` : ''}, usually for ${sa.days} day${sa.days > 1 ? 's' : ''}; came back after ${sa.back} of ${sa.n}.`);
    else if (sa && sa.n === 1) out.push(`One sale in the year, to ${rpGBP(sa.low)}.`);
    else if (!p.dips.length) out.push('No sales in the last year.');
  }
  if (p.sale) out.push(`<b>In a sale now</b>: day ${p.sale.days}, −${Math.round(p.sale.depth * 100)}%${p.sale.biggest ? ', the deepest in a year' : ''}${dn ? ` — it's ${dn}` : ''}.`);
  else if (dn) out.push(`<b>On a deal now</b>: ${dn}.`);
  else if (p.reset) out.push(`<b>Reset lower</b>: about ${rpGBP(p.reset.from)} → ${rpGBP(p.reset.to)}.`);
  else if (p.lowest) out.push(`<b>Lowest Buy Box in a year</b> right now.`);
  if (p.lowsFalling) out.push(`Each month's low is lower than the last.`);
  if (r.season) out.push(`Busy months ${r.season.label}: about ${r.season.peak.toLocaleString()} a month, ${r.season.rest >= 50 ? r.season.rest.toLocaleString() : 'under 50'} otherwise.`);
  return out.join(' ');
}
const rpAgo = iso => { if (!iso) return '—'; const n = Math.round((Date.now() - Date.parse(iso)) / 36e5); return n < 1 ? 'just now' : n < 24 ? `${n}h ago` : `${Math.round(n / 24)} days ago`; };
// Jack 18 Nov: "I can't work while it does it, it keeps jumping" — during a check nothing redraws under you:
// results are saved and wait behind "Show N new results"; any redraw keeps the card you're looking at in place
const rpTyping = () => { const a = document.activeElement; return !!(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.closest('#repTool')); };
function rpRender(){
  const sc = document.querySelector('.content'), top0 = sc ? sc.getBoundingClientRect().top : 0;
  const anchor = [...document.querySelectorAll('#repTool .rpk[id], #repTool .rp-dl, #repTool .rpk-ti')].find(e => e.getBoundingClientRect().bottom > top0 + 80);
  const key = anchor ? (anchor.id || anchor.getAttribute('onclick') || anchor.textContent.slice(0, 60)) : null, y0 = anchor ? anchor.getBoundingClientRect().top : 0;
  RP.pending = 0; rpPendingPill();
  renderRepTool();
  if (!anchor || !sc) return;
  const again = anchor.id ? document.getElementById(anchor.id) : [...document.querySelectorAll('#repTool .rp-dl, #repTool .rpk-ti')].find(e => (e.getAttribute('onclick') || e.textContent.slice(0, 60)) === key);
  if (again) sc.scrollTop += again.getBoundingClientRect().top - y0;
}
window.rpRender = rpRender;
function rpRunStep(n){ RP.pending = (RP.pending || 0) + n; renderRepRun(); rpPendingPill(); }
function rpPendingPill(){
  const n = RP.pending || 0; let p = document.getElementById('rpPending');
  if (!n) { if (p) p.remove(); return; }
  if (!p) { p = document.createElement('button'); p.id = 'rpPending'; p.className = 'rp-pend'; p.onclick = () => rpRender(); document.body.appendChild(p); }
  p.innerHTML = `↻ <b>${n}</b> new result${n !== 1 ? 's' : ''} saved — <u>show them</u>`;
  p.style.display = document.getElementById('tab-repricer')?.classList.contains('active') ? '' : 'none';
}
function renderRepRun(){ const el = document.getElementById('rpRunBody'); if (el && RP.run) el.innerHTML = rpRunBody(); const q = document.getElementById('rpRunQ'); if (q && RP.run) q.innerHTML = rpRunQ(); }
// Jack 18 Nov: "more info, what's happening — how much the token bucket is, countdown of 1 min until it refills 21" — a live panel while a check runs
function rpRunEta(){
  const r = RP.run, avg = r.fullN >= 5 ? r.fullTok / r.fullN : rpTok();
  const tokLeft = Math.round((r.lookLeft || 0) + (r.fullLeft || 0) * avg);
  const now = rpBankNow(), rate = (RP.bank && RP.bank.rate) || 21;
  const spare = now == null ? 0 : Math.max(0, now - RP_KEEP);
  const refillMs = Math.max(0, tokLeft - spare) / rate * 60000;
  const callMs = Math.ceil((r.fullLeft || 0) / 5) * 11000 + Math.ceil((r.lookLeft || 0) / 100) * 4000;   // about 11 s a batch of 5 (measured 18 Nov)
  return { avg, tokLeft, ms: Math.max(refillMs, callMs) };
}
function rpRunBody(){
  const r = RP.run; if (!r) return '';
  const pc = r.total ? Math.round(r.done / r.total * 100) : 0, e = rpRunEta();
  const b = RP.bank, left = rpBankNow(), max = b && !b.err ? b.max : 1260, nx = rpNextRefillMs();
  const bcol = left == null ? 'var(--muted2)' : left < 300 ? 'var(--r)' : left < 700 ? 'var(--o)' : 'var(--g)';
  const waitMs = r.phase === 'wait' && r.need ? rpBankWaitMs(r.need + RP_KEEP) : null;
  const now = r.phase === 'wait' ? `<b class="w">Waiting for Keepa to refill</b><em>the next product needs ${(r.need + RP_KEEP).toLocaleString()} in the bank (${RP_KEEP} kept free + ${r.need})${waitMs != null ? ` · goes in about <b data-rp-wait>${rpMMSS(waitMs)}</b>` : ''}. Not stuck: Keepa adds ${(RP.bank && RP.bank.rate) || 21} a minute, so from here it's about ${(((RP.bank && RP.bank.rate) || 21) / e.avg).toFixed(1).replace(/\.0$/, '')} products a minute</em>`
    : r.phase === 'blind' ? `<b class="w">Can't read the Keepa bank</b><em>trying again every 30 s — nothing is spent blind</em>`
    : r.phase === 'look' ? `<b>Quick look at ${r.inBatch} product${r.inBatch !== 1 ? 's' : ''}</b><em>1 token each — a full check only for the ones that moved</em>`
    : r.phase === 'pause9' ? `<b class="w">Paused for the 9pm competitor run</b><em>Sun, Tue and Thu 21:00–22:00 the competitor run needs the bank — this carries on by itself at 22:00</em>`
    : r.phase === 'full' ? `<b>Checking ${r.inBatch} product${r.inBatch !== 1 ? 's' : ''}${r.from ? ` · ${r.from}${r.inBatch > 1 ? `–${r.from + r.inBatch - 1}` : ''} of ${r.total - r.look}` : ''}</b><em>${r.last ? `last: ${r.last.n} for ${r.last.tok} tokens, ${rpSecAgo(r.last.at)}` : 'asking Keepa…'}${left != null && left - RP_KEEP < 5 * RP_TOK_MAX ? ` · at the ${RP_KEEP} line, so it goes as each refill lands` : ''}</em>`
    : `<b>Starting</b><em>asking Keepa how full the bank is</em>`;
  const fin = new Date(Date.now() + e.ms).toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
  return `<div class="rp-rtop"><span class="rp-rn"><b>${r.done}</b> of ${r.total} checked</span><i class="rp-rbar"><i style="width:${pc}%"></i></i><span class="rp-rpc">${pc}%</span></div>
    <div class="rp-rgrid">
      <div class="rp-rc rp-rnow"><span>Now</span>${now}</div>
      <div class="rp-rc"><span>Keepa bank</span><b style="color:${bcol}">${left == null ? '—' : left.toLocaleString()} <small>of ${max.toLocaleString()}</small></b><i class="rps-bar rps-bank-bar"><i style="width:${left == null ? 0 : Math.round(left / max * 100)}%;background:${bcol}"></i><u style="left:${Math.round(RP_KEEP / max * 100)}%"></u></i><em>${b && b.src === 'live' ? `live from Keepa ${rpSecAgo(b.at)}` : 'from the 5-min log'} · line = ${RP_KEEP} kept free</em></div>
      <div class="rp-rc"><span>Next refill</span><b class="rp-rtick" data-rp-next>${nx == null ? '—' : left != null && left >= max ? 'full' : `+${(b && b.rate) || 21} in ${rpMMSS(nx)}`}</b><em>Keepa adds ${(b && b.rate) || 21} once a minute</em></div>
      <div class="rp-rc"><span>Tokens</span><b>${r.spent.toLocaleString()} <small>spent</small></b><em>${r.fullN ? `${e.avg.toFixed(1)} a product this run` : `about ${rpTok()} a product`} · about ${e.tokLeft.toLocaleString()} more</em></div>
      <div class="rp-rc"><span>Done by</span><b>${r.done >= r.total ? 'now' : `about ${fin}`}</b><em>${r.done >= r.total ? '' : `${rpDur(e.ms)} to go · `}keep this page open</em></div>
    </div>
    ${r.lastErr ? `<div class="rp-rerr"><b>Batch of ${r.lastErr.n} failed ${rpSecAgo(r.lastErr.at)}:</b> ${rpEsc(r.lastErr.msg)} — those weren't saved; it carries on with the next ones (press Check again later for the missed ones).</div>` : ''}
    <div class="rp-rfoot">${[`started ${new Date(r.started).toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' })}`, r.young ? `${r.young} under ${RP_YOUNG_D} days skipped` : '', r.kept ? `${r.kept} checked in the last day, kept` : '', r.look ? `quick look ${r.same} unchanged${r.moved ? `, ${r.moved} moved → full check` : ''}` : '', r.err ? `<b class="w">${r.err} batch${r.err > 1 ? 'es' : ''} failed</b>` : '0 failed'].filter(Boolean).join(' · ')} · every product is saved the moment it's checked — Stop keeps what's done</div>`;
}
const rpDur = ms => { const m = Math.round(ms / 60000); return m < 1 ? 'under a minute' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`; };
const rpRunQ = () => RP.queue.length ? `<div class="rp-qnext">Next: ${RP.queue.map((q, i) => `<span>${rpEsc(q.prov)}${q.n != null ? ` (${q.n})` : ''} <a title="Take it out of the queue" onclick="rpUnqueue(${i})">×</a></span>`).join('')}</div>` : '';
function rpRunPanel(){
  const r = RP.run; if (!r) return '';
  return `<div class="rp-runp" id="rpRunPanel">
    <div class="rp-rhead"><span class="rp-rdot"></span><span class="rp-rt">Checking <b>${rpEsc(r.prov)}</b></span><span id="rpRunQ">${rpRunQ()}</span><span class="rp-rhint">the page stays still while this runs — results wait for you</span>
      <button class="rp-rstop" title="Everything checked so far is kept — press Check again later to carry on" onclick="RP.run.stop=true;this.textContent='Stopping…'"${r.stop ? ' disabled' : ''}>${r.stop ? 'Stopping…' : RP.queue.length ? 'Stop all' : 'Stop'}</button></div>
    <div id="rpRunBody">${rpRunBody()}</div></div>`;
}
const rpRunText = () => `<span class="rp-dim">Checking ${rpEsc(RP.run.prov)} — <b style="color:var(--text)">${RP.run.done} of ${RP.run.total}</b> · details below</span>`;
// one ticker: the countdowns move every second; the panel's numbers redraw every second while a check runs
function rpTickOn(){
  if (window._rpTick1) return;
  window._rpTick1 = setInterval(() => {
    if (!document.getElementById('tab-repricer')?.classList.contains('active') || document.hidden) return;
    if (RP.run) renderRepRun();
    const nx = rpNextRefillMs(), b = RP.bank, left = rpBankNow();
    if (b && !b.err && left != null && left < b.max && nx != null && nx < 1200) { setTimeout(rpBankPaint, 1300); }   // a refill just landed: redraw the bank box
    document.querySelectorAll('#rpBank [data-rp-next]').forEach(el => { el.textContent = left != null && b && left >= b.max ? 'full' : nx == null ? '' : `+${b.rate} in ${rpMMSS(nx)}`; });
  }, 1000);
}
rpTickOn();

// ── How fresh is everything, and how many Keepa tokens are in the bank right now ───────────────
// The bank comes from the keepa Worker's own 5-minute log (bdl_keepa.bank_log — a Supabase read, never a
// Keepa call, and it works in test mode too). The free /health check is only the fallback, and the
// Check button still asks /health right before every batch, where the exact figure matters.
// Read when the page opens, after each check, and every 2 minutes while the Repricer is on screen.
const rpDaysOld = dt => dt ? Math.max(0, Math.round((rpMs(rpToday()) - rpMs(String(dt).slice(0, 10))) / RP_DAY)) : null;
async function rpBankRead(){
  try {
    const row = window._bankLogRead ? await window._bankLogRead() : null, at = row ? Date.parse(row.at) : NaN;
    if (RP.bank && !RP.bank.err && RP.bank.src === 'live' && RP.bank.at >= at - 1000 && Date.now() - RP.bank.at < 20 * 60000) { rpBankPaint(); return; }   // Keepa's own figure from a check is newer — keep it
    if (row && row.tokens_left != null && Date.now() - at < 20 * 60000 && !RP.run) {   // a log older than 20 min = the logger stopped; during a check, ask Keepa itself
      const rate = row.refill_rate || 21;
      RP.bank = { left:row.tokens_left, rate, max:rate * 60, at, refillAt: row.refill_in != null ? at + row.refill_in : null, src:'log' };
      rpBankPaint();
      return;
    }
  } catch(e) {}
  try {
    const j = await fetch(`${RP_WORKER}/health`, { cache:'no-store' }).then(r => r.ok ? r.json() : null);
    if (j && j.tokensLeft != null) rpBankSet(j.tokensLeft, j.refillRate, j.refillIn, 'live'); else RP.bank = { err:true, at:Date.now() };
  } catch(e) { RP.bank = { err:true, at:Date.now() }; }
  rpBankPaint();
}
function rpBankPaint(){ const el = document.getElementById('rpBank'); if (el) el.outerHTML = rpBankHtml(); }
function rpBankHtml(){
  const b = RP.bank;
  if (!b) return `<div class="rps-i" id="rpBank"><span>Keepa tokens</span><b>…</b><em>reading the bank</em></div>`;
  if (b.err && window.OA_TEST) return `<div class="rps-i" id="rpBank" title="The keepa Worker only answers your live github.io address, so this test copy on your laptop can't read the bank. It shows on the live site."><span>Keepa tokens now</span><b>—</b><em>shows on the live site</em></div>`;
  if (b.err) return `<div class="rps-i warn" id="rpBank" title="The free token check on the keepa Worker didn't answer"><span>Keepa tokens</span><b>—</b><em>couldn't read the bank · <a onclick="rpBankRead()">try again</a></em></div>`;
  const left = rpBankNow(), pc = Math.round(left / b.max * 100), nx = rpNextRefillMs();
  const fullIn = left >= b.max ? 'full — anything more expires' : `full in ${Math.ceil((b.max - left) / b.rate)} min`;
  const col = left < 300 ? 'var(--r)' : left < 700 ? 'var(--o)' : 'var(--g)';
  const est = Date.now() - b.at > 65000;   // between readings it counts Keepa's +21 a minute on; other apps' spending shows at the next reading
  const src = `${b.src === 'live' ? 'live' : b.src === 'log' ? 'log' : 'read'} ${rpSecAgo(b.at)}`;
  return `<div class="rps-i rps-bank" id="rpBank" title="Keepa's own count — ${b.src === 'live' ? 'straight from Keepa (every check batch and the free /health check)' : 'from the keepa Worker\'s 5-minute log (free — no Keepa call)'}${est ? `, read ${rpSecAgo(b.at)} and counted on since (+${b.rate} a minute — other apps' spending shows at the next reading)` : ''}. One bank for everything — the VAs, the 9pm competitor run, the Discord trackers and this page. Keepa adds ${b.rate} once a minute and it holds ${b.max.toLocaleString()}; unused tokens expire after an hour. A check here never takes it under ${RP_KEEP} (the white line on the bar): it spends down to there, then goes at the refill speed."><span>Keepa tokens now</span><b style="color:${col}">${left.toLocaleString()} <small>of ${b.max.toLocaleString()}</small></b><i class="rps-bar rps-bank-bar"><i style="width:${pc}%;background:${col}"></i><u style="left:${Math.round(RP_KEEP / b.max * 100)}%"></u></i><em>${left < b.max && nx != null ? `<b class="rps-tick" data-rp-next>+${b.rate} in ${rpMMSS(nx)}</b> · ` : `+${b.rate}/min · `}${fullIn} · ${src} · <a onclick="rpBankRead()">refresh</a></em></div>`;
}
// The season, across everything held: days to Black Friday (then to the Christmas cut-off), what's past day 90, what's waiting
window.rpNarrow = k => { const set = RP.mode === 'prov' ? RP.nb : RP.np; if (k == null) set.clear(); else if (set.has(k)) set.delete(k); else set.add(k); RP.open = null; RP.lim = 10; renderRepTool(); };
// How long a check takes: what's above RP_KEEP goes now, the rest at the refill speed
function rpBankNow(){ const b = RP.bank; if (!b || b.err || b.left == null) return null; return Math.min(b.max, b.left + rpRefills(b, Date.now()) * b.rate); }
const rpSecAgo = t => { const s = Math.round((Date.now() - t) / 1000); return s < 10 ? 'just now' : s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : rpAgo(new Date(t).toISOString()); };
function rpEtaTxt(tok){
  const now = rpBankNow(), rate = (RP.bank && RP.bank.rate) || 21, avail = now == null ? 0 : Math.max(0, now - RP_KEEP);
  const m = Math.ceil(Math.max(0, tok - avail) / rate);
  if (m < 2) return `goes straight through · ${RP_KEEP} always stays free for everything else`;
  const by = new Date(Date.now() + m * 60000).toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
  return `about ${m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`}, done by about <b>${by}</b> — fast down to ${RP_KEEP}, then at the refill speed · ${RP_KEEP} always stays free · you can keep working`;
}
const rpDM = d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { day:'numeric', month:'short' });
function rpBFHtml(all, NEED, K_, key){
  const today = rpToday(), dTo = d => Math.round((rpMs(d) - rpMs(today)) / RP_DAY);
  let head, tone;
  if (today < RP_BF.start) { const n = dTo(RP_BF.start); head = `<b>${n} day${n !== 1 ? 's' : ''}</b> to Black Friday <span>${rpDM(RP_BF.start)} – ${rpDM(RP_BF.end)}</span>`; tone = n <= 7 ? 'hot' : ''; }
  else if (today <= RP_BF.end) { const n = dTo(RP_BF.end); head = `<b>Black Friday now</b> <span>ends ${rpDM(RP_BF.end)}${n ? ` · ${n} day${n !== 1 ? 's' : ''} left` : ' · last day'}</span>`; tone = 'hot'; }
  else if (today <= RP_XMAS) { const n = dTo(RP_XMAS); head = `<b>${n} day${n !== 1 ? 's' : ''}</b> to the Christmas cut-off <span>20 Dec</span>`; tone = ''; }
  else return '';
  const late = all.filter(h => h.day90 && h.day90 < today), lateV = late.reduce((t, h) => t + h.value, 0);
  const wait = all.filter(h => NEED.includes(K_(h)) && !rpDoneInfo(h, RP.data[h.asin])), waitV = wait.reduce((t, h) => t + h.value, 0);
  const todo = all.filter(h => !RP.data[h.asin] && !rpYoung(h)).length;
  const deals = all.filter(h => rpDealOn(RP.data[h.asin])), dealsV = deals.reduce((t, h) => t + h.value, 0);
  const go = `RP['${key}']='${RP_ALL}';RP.nb.clear();RP.np.clear();RP.showLeft=false;RP.open=null;RP.lim=10;`;
  return `<div class="rp-bf ${tone}">
    <div class="rp-bfh">${head}</div>
    <div class="rp-bfi"><b style="color:#ff8c42">${late.length}</b> past day 90 <span>${rpGBP0(lateV)}</span></div>
    <button class="rp-bfi" onclick="${go}RP.filter='need';rpPrefSet('oaRepFilter','need');renderRepTool()" title="Every provider's price changes you haven't done yet"><b style="color:#ff4d6d">${wait.length}</b> price change${wait.length !== 1 ? 's' : ''} waiting <span>${rpGBP0(waitV)}</span></button>
    <button class="rp-bfi" onclick="${go}RP.filter='all';rpPrefSet('oaRepFilter','all');renderRepTool()" title="Products over ${RP_YOUNG_D} days that Keepa hasn't checked yet"><b style="color:${todo ? '#ffd166' : '#00f5a0'}">${todo}</b> over ${RP_YOUNG_D} days not checked yet</button>
    ${deals.length ? `<button class="rp-bfi" onclick="${go}RP.filter='deal';RP.lim=500;rpPrefSet('oaRepFilter','deal');renderRepTool()" title="Products where Keepa saw a deal badge at the last check (Early Black Friday, Limited time deal …), mostly Amazon's own — each card says whose. Only checked products are known."><b style="color:#ff3d8b">${deals.length}</b> on a deal now <span>${rpGBP0(dealsV)}</span></button>` : ''}
  </div>`;
}
function rpStatusHtml(H, P, stkDate, stkOld, can){
  const sd = rpDaysOld(H.date), kd = P && P.last ? rpAgo(P.last) : null, std = rpDaysOld(stkDate), bb = window.REP_BB;
  const fmtShort = dt => new Date(String(dt).slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-GB', { day:'numeric', month:'short' });   // 9 Nov, not 09/11
  const it = (lab, val, sub, warn, tip) => `<div class="rps-i${warn ? ' warn' : ''}"${tip ? ` title="${rpEsc(tip)}"` : ''}><span>${lab}</span><b>${val}</b><em>${sub}</em></div>`;
  return `<div class="rps">
    ${it('Your stock', fmtShort(H.date), sd === 0 ? "Sarah's upload today" : `Sarah's upload · ${sd} day${sd !== 1 ? 's' : ''} old`, sd > 3, 'What you hold, SKU by SKU, from the ageing file Sarah adds with each snapshot.')}
    ${it(`Keepa prices${P ? ` · ${rpEsc(P.name)}` : ''}`, P && P.checked ? `${P.checked} of ${P.asins}` : 'not checked', kd ? `checked ${kd}` : 'press Check to pull them', P && P.last && Date.now() - Date.parse(P.last) > 2 * 864e5, 'The graph, queue and call for each product come from the last Keepa check of this provider. Looking again costs nothing — only Check spends tokens.')}
    ${it('STK mins', stkDate ? fmtShort(stkDate) : 'none', stkDate ? `${std === 0 ? 'file from today' : `file is ${std} day${std !== 1 ? 's' : ''} old`}` : "Sarah drops the Repricer Settings file", stkOld || !stkDate, 'Your min price per SKU, from SellerToolKit → Reports → Repricer Settings. Sarah adds it in Add Snapshot.')}
    ${bb ? `<button class="rps-i rps-btn" onclick="document.getElementById('repBBStats')?.scrollIntoView({behavior:'smooth',block:'start'})" title="Of all your listings in the repricer: the share that win the Buy Box, and the share price-matched but not winning. From Sarah's entries. Charts below the tool."><span>Buy Box · all listings</span><b><span style="color:${bb.col}">${bb.w.toFixed(1)}%</span> win · ${bb.m.toFixed(1)}% match</b><em>entry ${bb.date ? fmtShort(bb.date) : ''} · charts below ↓</em></button>` : ''}
    ${rpBankHtml()}
    <div class="rps-i rps-who"><span>This laptop</span><b>${can ? '<span style="color:var(--g)">✓ Unlocked</span>' : 'View only'}</b><em>${can ? 'can spend tokens and record calls · <a onclick="rpLock()">lock</a>' : '<a onclick="rpUnlockAsk()">Jack: unlock</a>'}</em></div>
  </div>`;
}
if (!window._rpBankTick) { window._rpBankTick = setInterval(() => { if (document.getElementById('tab-repricer')?.classList.contains('active') && !document.hidden) rpBankRead(); }, 120000); }
// Left out of the Repricer: Lavarion and Jack's own bundles, each with a way back in
function rpLeftHtml(list, can){
  return `<div class="rp-phead"><div><div class="rp-pt">Left out</div><div class="rp-ps">Lavarion and your own bundles aren't repriced here — you're the only seller, so there's no queue to read. ${list.length} ASINs · ${rpGBP0(list.reduce((t, x) => t + x.value, 0))}.</div></div></div>
    <div class="rpk-todo rpk-left"><div class="rpk-todol">${list.map(x => `<div class="rpk-ti" title="${rpEsc(x.title)}"><span class="n">${rpEsc(x.title || x.asin)}</span><span class="a ok" style="color:var(--muted2);background:var(--s3)">${rpEsc(x.why)}</span><span class="v">${rpGBP0(x.value)}</span>${can && x.why !== 'Lavarion' ? `<button class="rpk-back" onclick="rpSkip('${x.asin}',false)">Put back</button>` : ''}</div>`).join('')}</div></div>`;
}
function renderRepTool(){
  const el = document.getElementById('repTool'); if (!el) return;
  if (!RP.loaded) { el.innerHTML = '<div class="rp-shell"><div class="rp-dim" style="padding:18px">Loading the repricer…</div></div>'; rpLoad(); return; }
  const H = rpHoldings();
  if (!H) { el.innerHTML = `<div class="rp-shell"><div class="rp-dim" style="padding:18px">Needs Sarah's ageing file with SKU detail (it saves each SKU from 14 Oct on).</div></div>`; return; }
  const can = rpCanAct(), all = Object.values(H.by);
  const stkDate = Object.values(RP.settings).map(x => x.file_date).filter(Boolean).sort().pop() || null;
  const stkOld = !!stkDate && rpMs(rpToday()) - rpMs(stkDate) > 7 * RP_DAY;
  const leftL = Object.values(H.left || {}).sort((a, b) => b.value - a.value);
  const NEED = ['out','drop','raise'];
  const K_ = h => h._r ? (h._r.call ? h._r.call.kind : 'none') : 'todo';
  all.forEach(h => { h._r = RP.data[h.asin] ? rpCall(h, RP.data[h.asin]) : null; });
  // the left list: providers (their own SKUs' £ only) or stock-age bands (by the oldest unit)
  const groups = {};
  const add = (key, h, own) => { const o = groups[key] = groups[key] || { name:key, asins:0, units:0, value:0, checked:0, need:0, last:null, buys:{} };
    o.asins++; o.units += own.reduce((t, s) => t + s.units, 0); o.value += own.reduce((t, s) => t + s.value, 0);
    if (h._r) { o.checked++; if (NEED.includes(K_(h))) o.need++; o.buys[h._r.buy.v] = (o.buys[h._r.buy.v] || 0) + 1;
      const t = RP.data[h.asin].checked_at; if (!o.last || t > o.last) o.last = t; } };
  if (RP.mode === 'age') all.forEach(h => { const B = RP_BANDS.find(b => h.age != null && h.age >= b[1] && h.age <= b[2]); if (B) add(B[0], h, h.skus); });
  else all.forEach(h => [...h.providers].forEach(p => add(p, h, h.skus.filter(s => s.provider === p))));
  const plist0 = RP.mode === 'age' ? RP_BANDS.map(b => groups[b[0]]).filter(Boolean) : Object.values(groups).sort((a, b) => b.value - a.value);
  all.forEach(h => add(RP_ALL, h, h.skus));
  const plist = [groups[RP_ALL], ...plist0].filter(Boolean);
  const key = RP.mode === 'age' ? 'band' : 'prov';
  if ((!RP[key] || !groups[RP[key]]) && plist0.length) RP[key] = RP.mode === 'age' ? (plist0.slice().reverse().find(o => o.value > 0) || plist0[0]).name : plist0[0].name;
  const sel = RP[key];
  let P = groups[sel];
  const mine0 = sel === RP_ALL ? all : all.filter(h => RP.mode === 'age' ? rpInBand(h, sel) : h.providers.has(sel));
  // Jack, 14 Nov: "I might only audit certain stock ages and/or certain providers" — chips narrow the list AND the Check button
  const bandOf = h => (RP_BANDS.find(b => h.age != null && h.age >= b[1] && h.age <= b[2]) || [null])[0];
  const provNames = [...new Set(all.flatMap(h => [...h.providers]))];
  const nset = RP.mode === 'prov' ? RP.nb : RP.np;
  [...nset].forEach(k => { if (!(RP.mode === 'prov' ? RP_BANDS.some(b => b[0] === k) : provNames.includes(k))) nset.delete(k); });
  const mine = nset.size ? mine0.filter(h => RP.mode === 'prov' ? nset.has(bandOf(h)) : [...h.providers].some(p => nset.has(p))) : mine0;
  const nOpts = RP.mode === 'prov' ? RP_BANDS.map(b => ({ k:b[0], l:b[0].replace(' days', ''), n:mine0.filter(h => bandOf(h) === b[0]).length }))
    : provNames.map(k => ({ k, l:k, n:mine0.filter(h => h.providers.has(k)).length })).filter(o => o.n).sort((a, b) => b.n - a.n);
  if (P && nset.size) {   // the tiles add up the narrowed list (a provider's own SKUs only, as in the rail)
    const own = h => RP.mode === 'prov' && sel !== RP_ALL ? h.skus.filter(x => x.provider === sel) : h.skus;
    const o = { name:P.name, asins:0, units:0, value:0, checked:0, need:0, last:null, buys:{} };
    mine.forEach(h => { const sk = own(h); o.asins++; o.units += sk.reduce((t, x) => t + x.units, 0); o.value += sk.reduce((t, x) => t + x.value, 0);
      if (h._r) { o.checked++; if (NEED.includes(K_(h))) o.need++; o.buys[h._r.buy.v] = (o.buys[h._r.buy.v] || 0) + 1; const t = RP.data[h.asin].checked_at; if (!o.last || t > o.last) o.last = t; } });
    P = o;
  }
  const order = { out:0, drop:1, raise:2, hold:3, wait:4, none:5 };
  const filt = { need: h => NEED.includes(K_(h)), all: () => true, out: h => K_(h) === 'out', drop: h => K_(h) === 'drop', raise: h => K_(h) === 'raise',
    hold: h => K_(h) === 'hold', wait: h => K_(h) === 'wait', todo: h => K_(h) === 'todo', chg: h => !!(h._r && rpChanges(RP.data[h.asin], h._r)), deal: h => !!rpDealOn(RP.data[h.asin]) };
  let shown = mine.filter(filt[RP.filter] || filt.all);
  // like STK: newest at the top, oldest at the bottom of the bucket — or flipped, calls first, or biggest £ first
  const ageOf = h => h.age ?? -1;
  const SORTS = { new:(a, b) => ageOf(a) - ageOf(b) || b.value - a.value, old:(a, b) => ageOf(b) - ageOf(a) || b.value - a.value,
    call:(a, b) => (order[K_(a)] ?? 9) - (order[K_(b)] ?? 9) || b.value - a.value, value:(a, b) => b.value - a.value };
  const cmp = SORTS[RP.sort] || SORTS.new;
  shown.sort(cmp);
  const cards0 = shown.filter(h => RP.data[h.asin]);
  cards0.forEach(h => { h._done = rpDoneInfo(h, RP.data[h.asin]); });
  const cards = cards0.filter(h => !h._done).concat(cards0.filter(h => h._done));
  RP.order = cards.map(h => h.asin);
  const needAll = mine.filter(h => NEED.includes(K_(h))), needDone = needAll.filter(h => rpDoneInfo(h, RP.data[h.asin])).length;
  const doneN = cards0.filter(h => h._done).length, firstTodo = cards.find(h => !h._done);
  const youngOK = RP.mode === 'age' ? sel === RP_BANDS[0][0] : RP.nb.has(RP_BANDS[0][0]);
  const fresh = mine.filter(h => rpFresh(h.asin)).length, fineN = 0;   // selling fine is a label now, not a skip
  const youngN = youngOK ? 0 : mine.filter(h => !rpFresh(h.asin) && rpYoung(h)).length, stale = mine.length - fresh - youngN;
  const lookN = mine.filter(h => !rpFresh(h.asin) && !(!youngOK && rpYoung(h)) && rpLookable(h.asin)).length, stTok = lookN + (stale - lookN) * rpTok();   // a quick look is 1 token (full check only if something moved)
  const todo = P && (RP.filter === 'all' || RP.filter === 'todo' || !P.checked) ? mine.filter(h => !RP.data[h.asin]).sort((a, b) => ((rpYoung(a) ? 1 : 0) - (rpYoung(b) ? 1 : 0)) || cmp(a, b)) : [];
  const counts = k => mine.filter(filt[k]).length;
  const nLab = nset.size ? [...nset].map(k => k.replace(' days', '')).join(', ') : '';
  RP.view = P ? { label: P.name + (nLab ? ` · ${nLab}` : ''), asins: mine.map(h => h.asin), youngOK, n: stale } : null;
  const late = mine.filter(h => h.day90 && rpMs(h.day90) < Date.now()).length;
  const kinds = mine.reduce((o, h) => { const k = K_(h); o[k] = (o[k] || 0) + 1; return o; }, {});
  const backOut = mine.filter(h => K_(h) === 'out').reduce((t, h) => t + (h._r.call.back || 0), 0);
  const ownVal = h => RP.mode === 'prov' && sel !== RP_ALL ? h.skus.filter(x => x.provider === sel).reduce((t, x) => t + x.value, 0) : h.value;   // this provider's own SKUs, as in the rail
  const lateVal = mine.filter(h => h.day90 && rpMs(h.day90) < Date.now()).reduce((t, h) => t + ownVal(h), 0);
  const seg = [['out','Get out',RP_KIND.out[1]],['drop','Drop',RP_KIND.drop[1]],['raise','Raise',RP_KIND.raise[1]],['hold','Hold',RP_KIND.hold[1]],['wait','Wait',RP_KIND.wait[1]],['todo','Not checked','#3a4556']];
  const pq = n => n.replace(/'/g, "\\'");
  const buys = P ? Object.entries(P.buys).sort((a, b) => b[1] - a[1]).map(([v, n]) => `<span style="color:${RP_BUY[v][1]}">${n} ${RP_BUY[v][0].toLowerCase()}</span>`).join(' · ') : '';
  el.innerHTML = `<div class="rp-shell">
    <div class="rp-top">
      <div><div class="rp-title">Reprice</div>
        <div class="rp-lead">Every ASIN you hold, checked against Keepa and called by your rules, SKU by SKU. Sell-by = 90 days after it landed at Amazon.</div></div>
      <label class="cmp-chip rp-file${stkOld ? ' rp-stale' : ''}" title="SellerToolKit → Reports → Repricer Settings — drop the file here (Sarah normally adds it in Add Snapshot)">${stkDate ? 'New STK file' : 'Drop STK Repricer Settings'}<input type="file" accept=".txt,.csv,.tsv" onchange="this.files[0]&&rpImportSettings(this.files[0])"></label>
    </div>
    ${rpBFHtml(all, NEED, K_, key)}
    ${rpDealsPanel(all, key)}
    ${rpStatusHtml(H, P, stkDate, stkOld, can)}
    <div class="rp-unlock" id="rpUnlock" style="display:none"><span>Unlock this laptop to check Keepa and record calls:</span><input type="password" placeholder="word" onkeydown="if(event.key==='Enter')rpUnlockTry(this.value)"><button class="cmp-chip" onclick="rpUnlockTry(this.previousElementSibling.value)">Unlock</button><span id="rpUnlockMsg" class="rp-dim"></span></div>
    ${RP.noTables && !window.OA_TEST ? `<div class="rp-note">The repricer's tables aren't in Supabase yet — run <b>OA-Overview - RUN IN SUPABASE - repricer tool 2026-10-23.sql</b>. Until then checks last until you reload.</div>` : ''}
    ${Object.keys(RP.settings).length ? '' : `<div class="rp-note">No STK Repricer Settings yet, so your min prices aren't shown. Sarah: SellerToolKit → Reports → Repricer Settings → drop it in Add Snapshot (or here).</div>`}
    <div class="rp-grid">
      <div class="rp-rail">
        <div class="rp-mode"><button class="${RP.mode === 'prov' ? 'on' : ''}" onclick="RP.mode='prov';RP.open=null;RP.lim=10;renderRepTool()">Providers</button><button class="${RP.mode === 'age' ? 'on' : ''}" onclick="RP.mode='age';RP.open=null;RP.lim=10;renderRepTool()">Stock age</button></div>
        ${plist.map(o => `<button class="rp-pv${o.name === RP_ALL ? ' rp-pvall' : ''} ${o.name === sel && !RP.showLeft ? 'on' : ''}" onclick="RP['${key}']='${pq(o.name)}';RP.open=null;RP.lim=10;RP.showLeft=false;renderRepTool()">
          <span class="rp-pvn">${rpEsc(o.name)}${o.name === RP_ALL ? `<small>${RP.mode === 'age' ? 'every age' : 'all providers'}</small>` : RP.mode === 'prov' && rpProvInfo(o.name) ? `<small>${rpProvInfo(o.name)}</small>` : ''}</span><span class="rp-pvv">${rpGBP0(o.value)}</span>
          <span class="rp-pvs">${o.asins} ASIN${o.asins !== 1 ? 's' : ''} · ${!o.checked ? 'not checked' : o.checked >= o.asins ? `all checked ${rpAgo(o.last)}` : `${o.checked} of ${o.asins} checked · ${rpAgo(o.last)}`}</span>${o.need ? `<span class="rp-pvneed">● ${o.need} need${o.need === 1 ? 's' : ''} you</span>` : ''}
          </button>`).join('')}
        ${leftL.length ? `<button class="rp-pv rp-pvleft ${RP.showLeft ? 'on' : ''}" onclick="RP.showLeft=!RP.showLeft;renderRepTool()"><span class="rp-pvn">Left out<small>Lavarion + your own bundles</small></span><span class="rp-pvv">${rpGBP0(leftL.reduce((t, x) => t + x.value, 0))}</span><span class="rp-pvs">${leftL.length} ASIN${leftL.length !== 1 ? 's' : ''} · not repriced</span></button>` : ''}</div>
      <div class="rp-main">${RP.showLeft ? rpLeftHtml(leftL, can) : P ? `
        <div class="rp-phead">
          <div><div class="rp-pt">${rpEsc(P.name)}${P.name === RP_ALL ? ` <span class="rp-pinfo">${RP.mode === 'age' ? 'every age band' : 'every provider'} — Lavarion + your bundles left out</span>` : RP.mode === 'prov' && rpProvInfo(P.name) ? ` <span class="rp-pinfo">${rpProvInfo(P.name)}</span>` : ''}</div>
            ${buys ? `<div class="rp-ps">Their buys: ${buys}</div>` : ''}</div>
          <div id="rpRunLine" class="rp-run">${RP.run ? rpRunText() : can ? (stale ? `<div class="rp-gowrap"><button class="btn-g rp-go" onclick="rpCheckView()">${P.name === RP_ALL && !nLab ? `Check everything · ${stale} product${stale !== 1 ? 's' : ''}` : RP.mode === 'age' || P.name === RP_ALL ? `Check ${stale} product${stale !== 1 ? 's' : ''} · ${P.name === RP_ALL ? '' : rpEsc(P.name)}${P.name !== RP_ALL && nLab ? ' · ' : ''}${rpEsc(nLab)}` : `Check ${stale} ${rpEsc(P.name)} product${stale !== 1 ? 's' : ''}${nLab ? ` · ${rpEsc(nLab)}` : ''}`} · about ${stTok.toLocaleString()} tokens</button><span class="rp-gosub">${[fresh ? `${fresh} checked in the last day` : '', fineN ? `${fineN} selling fine` : '', youngN ? `${youngN} under ${RP_YOUNG_D} days` : ''].filter(Boolean).join(' · ') || 'nothing to skip'}${fresh || fineN || youngN ? ' — skipped, free' : ''}${lookN ? `<br>${lookN} quick look${lookN !== 1 ? 's' : ''} at 1 token — a full check only if something moved` : ''}<br>${rpEtaTxt(stTok)}</span></div>`
            : `<div class="rp-gowrap"><span class="rp-allfresh">✓ Nothing to pull${fineN ? ` · ${fineN} selling fine` : ''}${youngN ? ` · ${youngN} under ${RP_YOUNG_D} days` : ''}${fresh ? ` · ${fresh} checked in the last day` : ''}</span><button class="rp-again" onclick="rpCheckView(true)">Re-check all · about ${(P.asins * rpTok()).toLocaleString()} tokens</button></div>`) : '<span class="rp-dim">Jack runs the Keepa check</span>'}</div>${RP.run && can && stale && !(RP.view && (RP.run.prov === RP.view.label || RP.queue.some(q => q.prov === RP.view.label))) ? `<button class="rp-again rp-qadd" onclick="rpCheckView()" title="Starts by itself when the one running now finishes">+ Queue ${stale} ${P.name === RP_ALL ? 'products' : rpEsc(P.name)}${nLab ? ` · ${rpEsc(nLab)}` : ''} next · about ${stTok.toLocaleString()} tokens</button>` : ''}
        </div>
        ${RP.run ? rpRunPanel() : ''}
        ${nOpts.filter(o => o.n).length > 1 ? `<div class="rp-narrow"><span class="rp-nl">${RP.mode === 'prov' ? 'Stock age' : 'Providers'}</span><button class="${!nset.size ? 'on' : ''}" onclick="rpNarrow()">All <b>${mine0.length}</b></button>${nOpts.map(o => `<button class="${nset.has(o.k) ? 'on' : ''}${!o.n ? ' zero' : ''}" onclick="rpNarrow('${pq(o.k)}')">${rpEsc(o.l)} <b>${o.n}</b></button>`).join('')}<span class="rp-nh">pick one or more — the list and the Check button follow</span></div>` : ''}
        <div class="rp-tiles rpk-tiles">
          <div class="rp-tile" style="--tc:#3d9eff"><div class="rp-k">Tied up</div><div class="rp-v" style="color:#3d9eff">${rpGBP0(P.value)}</div><div class="rp-s">${P.asins} ASIN${P.asins !== 1 ? 's' : ''} · ${P.units.toLocaleString()} unit${P.units !== 1 ? 's' : ''}</div></div>
          <div class="rp-tile" style="--tc:#ff8c42"><div class="rp-k">Past day 90</div><div class="rp-v" style="color:#ff8c42">${rpGBP0(lateVal)}</div><div class="rp-s">${late} of ${P.asins} ASIN${P.asins !== 1 ? 's' : ''}${P.value ? ` · ${Math.round(lateVal / P.value * 100)}% of the £` : ''}</div></div>
          <div class="rp-tile" style="--tc:#ff4d6d"><div class="rp-k">Price to change</div><div class="rp-v" style="color:#ff4d6d">${counts('need')}</div><div class="rp-s">${needAll.length ? `<b style="color:${needDone === needAll.length ? 'var(--g)' : 'var(--text)'}">${needDone} of ${needAll.length} done</b> · ` : ''}${[['out','get out'],['drop','drop'],['raise','raise']].map(([k, l]) => `${kinds[k] || 0} ${l}`).join(' · ')}${backOut ? ` · get-outs free up ${rpGBP0(backOut)}` : ''}</div></div>
          <div class="rp-tile" style="--tc:#00f5a0"><div class="rp-k">Checked</div><div class="rp-v" style="color:#00f5a0">${P.checked} <small style="font-size:15px;color:var(--muted2)">of ${P.asins}</small></div><div class="rp-s">${P.checked ? `last ${rpAgo(P.last)}` : 'not checked yet'}${fresh ? ` · ${fresh} fresh (last day)` : ''}${fineN ? ` · ${fineN} selling fine (free)` : ''}${youngN ? ` · ${youngN} under ${RP_YOUNG_D} days (skipped)` : ''}${stale ? ` · ${stale} to pull, about ${stTok.toLocaleString()} tokens` : ''}</div></div>
        </div>
        <div class="rp-filters">
          ${[['need','Needs you',null],['chg','⚡ Changed',null],['deal','On a deal','#ff3d8b']].concat(seg).concat([['all','All',null]]).map(([k, l, col]) => {
            const n = k === 'need' || k === 'chg' || k === 'deal' ? counts(k) : k === 'all' ? mine.length : kinds[k] || 0;
            if ((k === 'chg' || k === 'deal') && !n && RP.filter !== k) return '';
            return `<button class="rp-f ${RP.filter === k ? 'on' : ''}${!n && RP.filter !== k ? ' zero' : ''}" onclick="RP.filter='${k}';rpPrefSet('oaRepFilter','${k}');RP.open=null;RP.lim=10;renderRepTool()">${col ? `<i style="background:${col}"></i>` : ''}${l} <b>${n}</b></button>`; }).join('')}

          <span class="rp-sort"><span>Order</span>${[['new','Newest → oldest'],['old','Oldest → newest'],['call','Calls first'],['value','£ tied up']].map(([k, l]) => `<button class="${RP.sort === k ? 'on' : ''}" onclick="RP.sort='${k}';rpPrefSet('oaRepSort','${k}');RP.lim=10;renderRepTool()">${l}</button>`).join('')}</span>
        </div>
        ${cards.length ? `<div class="rpk-prog"><div class="rpk-pbar"><i style="width:${Math.round(doneN / cards.length * 100)}%"></i></div>
          <span><b>${doneN} of ${cards.length}</b> done in this view${firstTodo ? ` · next: <a onclick="document.getElementById('rp_${firstTodo.asin}').scrollIntoView({behavior:'smooth',block:'start'})">${rpEsc((RP.data[firstTodo.asin].data.title || firstTodo.title || firstTodo.asin).slice(0, 48))}</a>` : ' · <b style="color:var(--g)">all done ✓</b>'}</span>
          <span class="rpk-keys"><kbd>J</kbd> next <kbd>K</kbd> back</span></div>
` : ''}
        <div class="rpk-list">
          ${cards.length ? cards.slice(0, RP.lim).map(h => h._done && !RP.openDone[h.asin] ? rpDoneRow(h, RP.data[h.asin], h._done) : rpCard(h, RP.data[h.asin])).join('')
            + (cards.length > RP.lim ? `<button class="rpk-more" onclick="RP.lim+=10;renderRepTool()">Show the next ${Math.min(10, cards.length - RP.lim)} · ${cards.length - RP.lim} more in this view</button>` : '')
            : todo.length ? '' : `<div class="rp-dim" style="padding:22px">${RP.filter === 'need' && !P.checked ? `Nothing checked here yet${can ? ` — press Check ${rpEsc(P.name)}` : ''}.` : RP.filter === 'need' ? 'Nothing needs you here — every price can stay as it is.' : 'Nothing in this view.'}</div>`}
          ${rpTodoHtml(todo, P, can)}
        </div>` : ''}
      </div>
    </div>
  </div>`;
  if (!RP.bank) rpBankRead();
  rpFloat(P && !RP.showLeft && cards.length ? (firstTodo ? `<b>${doneN} of ${cards.length}</b> done · <a onclick="document.getElementById('rp_${firstTodo.asin}').scrollIntoView({behavior:'smooth',block:'start'})">next ›</a><span><kbd>J</kbd><kbd>K</kbd></span>` : `<b style="color:var(--g)">✓ all ${cards.length} done</b>`) : '');
}
window.renderRepTool = renderRepTool;
function rpFloat(html){
  let f = document.getElementById('rpFloat');
  if (!f) { f = document.createElement('div'); f.id = 'rpFloat'; f.className = 'rpk-float'; document.body.appendChild(f); }
  if (html != null) f.innerHTML = html;
  f.style.display = html !== '' && f.innerHTML && document.getElementById('tab-repricer')?.classList.contains('active') ? 'flex' : 'none';
}
// show / hide it with the page
['switchTab', 'switchTabMobile'].forEach(n => { const o = window[n]; if (typeof o === 'function' && !o._rp) { const w = function(){ const r = o.apply(this, arguments); rpFloat(); rpPendingPill(); return r; }; w._rp = true; window[n] = w; } });
