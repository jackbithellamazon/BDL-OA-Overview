
// Money is always written in full with thousands separators. Never abbreviated to k —
// "£25.4k" hides anything between £25,350 and £25,449, and these are real figures.
function fmtGBP(v){ return '£' + Math.round(Number(v)||0).toLocaleString(); }
function fmtGBPAbs(v){ return '£' + Math.abs(Math.round(Number(v)||0)).toLocaleString(); }

// Sarah logs Mon/Wed/Fri, so "a week ago" is a calendar fact, not "3 entries back" — entry
// counting drifts every time a day is missed or doubled up. Nearest reading to N days before
// the latest one, within ±3 days; optionally only readings where the metric actually exists.
function snapDaysBack(snaps, daysBack, tol, getter){
  if(!snaps || snaps.length<2) return null;
  tol = tol==null ? 3 : tol;
  const t=new Date(snaps[snaps.length-1].date+'T00:00:00'); t.setDate(t.getDate()-daysBack);
  let best=null, bestGap=1e9;
  for(let i=0;i<snaps.length-1;i++){
    if(getter && getter(snaps[i])==null) continue;
    const g=Math.abs((new Date(snaps[i].date+'T00:00:00')-t)/86400000);
    if(g<bestGap){bestGap=g;best=snaps[i];}
  }
  return bestGap<=tol ? best : null;
}

let KPI_VIEW = 'value';  // inbound popup: 'value' | 'units' | 'both' — money first by default
try{ const v=localStorage.getItem('kpiView'); if(v==='units'||v==='value'||v==='both') KPI_VIEW=v; }catch(e){}
function setKpiView(v){
  KPI_VIEW=v; try{ localStorage.setItem('kpiView',v); }catch(e){}
  openKpiModal('inboundunits');
}

function openKpiModal(key, metric) {
  const snaps = filteredSnaps();
  if (!snaps || snaps.length === 0) return;
  const modal = document.getElementById('kpiModal');
  const title = document.getElementById('kpiModalTitle');
  const body = document.getElementById('kpiModalBody');
  if (!modal || !title || !body) return;

  const configs = {
    skus:       { label:'Total SKUs',      getter:s=>s.skus||0,       fmt:v=>Math.round(v).toLocaleString(),  unit:'SKUs',  upGood:true  },
    asins:      { label:'Total ASINs',     getter:s=>s.asins||0,      fmt:v=>Math.round(v).toLocaleString(),  unit:'ASINs', upGood:true  },
    cost:       { label:'Avg Unit Cost',   getter:s=>s.avgCost||0,    fmt:v=>'£'+v.toFixed(2), fmtDiff:v=>'£'+Math.abs(v).toFixed(4),  unit:'',      upGood:null  }, // context-dependent — only meaningful alongside units and stock value
    stockvalue: { label:'Stock Value',     getter:s=>s.stockValue||0, fmt:v=>fmtGBP(v), unit:'', upGood:true },
    units:      { label:'Available Units', getter:s=>s.totalUnits||0, fmt:v=>Math.round(v).toLocaleString(),  unit:'units', upGood:true  },
    // Return null, not 0, for snapshots predating the feature — line 4372 filters those out,
    // so averages and all-time lows are computed only over dates actually recorded.
    // fmt must tolerate null: the modal formats prev/diff values that can be absent when only
    // part of the history carries inbound, and v.toFixed() on a null throws.
    inboundunits:{ label:'Inbound', getter:s=>s.inboundUnits??null, fmt:v=>v==null?'—':Math.round(v).toLocaleString(), fmtDiff:v=>v==null?'—':Math.round(Math.abs(v)).toLocaleString(), unit:'units', upGood:true,
      companion:{ label:'value', axis:'£', colour:'#3d9eff', getter:s=>s.inboundValue??null,
        fmt:v=>v==null?'—':fmtGBP(v), fmtDiff:v=>v==null?'—':fmtGBPAbs(v) } },
    inboundcost:{ label:'Inbound', getter:s=>s.inboundValue??null, fmt:v=>v==null?'—':fmtGBP(v), fmtDiff:v=>v==null?'—':fmtGBPAbs(v), unit:'', upGood:true,
      companion:{ label:'units', axis:'units', colour:'#ffd166', getter:s=>s.inboundUnits??null,
        fmt:v=>v==null?'—':Math.round(v).toLocaleString(),
        fmtDiff:v=>v==null?'—':Math.round(Math.abs(v)).toLocaleString() } },
    winbb:      { label:'Win BB %',        getter:s=>(repPct(s,'win')??0), fmt:v=>v.toFixed(1)+'%', unit:'pp', upGood:true },
    matchbb:    { label:'Match BB %',      getter:s=>(repPct(s,'match')??0), fmt:v=>v.toFixed(1)+'%', unit:'pp', upGood:true },
    agedrisk:   { label:'Aged Risk 181+d', getter:s=>{ const ag=s.ageing||{}; const tot=(ag.a0||0)+(ag.a31||0)+(ag.a61||0)+(ag.a91||0)+(ag.a181||0)+(ag.a271||0)+(ag.a365||0); const aged=(ag.a181||0)+(ag.a271||0)+(ag.a365||0); return tot>0?parseFloat(((aged/tot)*100).toFixed(1)):0; }, fmt:v=>v.toFixed(1)+'%', unit:'pp', upGood:false },
  };
  let cfg = configs[key]; if (!cfg) return;
  const isInbound = (key==='inboundunits' || key==='inboundcost');
  // One shipment, three ways of looking at it. Which one is remembered between openings.
  if (isInbound) {
    if (KPI_VIEW === 'units')      cfg = { ...configs.inboundunits, companion:null };
    else if (KPI_VIEW === 'value') cfg = { ...configs.inboundcost,  companion:null };
    else                           cfg = configs.inboundunits;   // both
  }
  const showMetricToggle = (key==='winbb' || key==='matchbb');
  metric = showMetricToggle ? (metric || 'pct') : 'pct';
  if (showMetricToggle && metric==='count') {
    const cg = key==='winbb' ? (s=>s.repricer?.winning ?? 0) : (s=>s.repricer?.matching ?? 0);
    cfg = { label: (key==='winbb'?'Winning SKUs':'Matching SKUs'),
      getter: cg, fmt: v=>Math.round(v).toLocaleString(), fmtDiff: v=>Math.round(Math.abs(v)).toLocaleString(),
      unit:'SKUs', upGood:true };
  }
  const metricToggleHtml = showMetricToggle
    ? `<div style="display:flex;align-items:center;gap:8px;margin-bottom:20px;padding-bottom:18px;border-bottom:1px solid var(--border)">
         <span style="font-family:var(--mono);font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:var(--muted2)">Show</span>
         <button class="kpi-range-btn ${metric!=='count'?'active':''}" onclick="openKpiModal('${key}','pct')">Percentage</button>
         <button class="kpi-range-btn ${metric==='count'?'active':''}" onclick="openKpiModal('${key}','count')">Number of SKUs</button>
       </div>`
    : isInbound
    ? `<div class="kpi-view">
         <span class="kpi-view-l">Show</span>
         <div class="kpi-view-seg">
           <button class="${KPI_VIEW==='value'?'on':''}" onclick="setKpiView('value')">\u00A3 value</button>
           <button class="${KPI_VIEW==='units'?'on':''}" onclick="setKpiView('units')">Units</button>
           <button class="${KPI_VIEW==='both'?'on':''}"  onclick="setKpiView('both')">Both</button>
         </div>
       </div>`
    : '';

  // Aged stock gets its own full popup
  if (key === 'agedrisk') { openAgedStockModal(snaps, modal, title, body); return; }

  // Core calcs
  const vals = snaps.map(cfg.getter);
  const latest = vals[vals.length-1];
  const prev = vals.length>1 ? vals[vals.length-2] : null;
  const diff = (prev!==null && prev!==undefined && latest!==null) ? latest-prev : null;
  const allVals = vals.filter(v=>v!=null && !isNaN(v));
  const highest = allVals.length ? Math.max(...allVals) : null;
  const lowest  = allVals.length ? Math.min(...allVals) : null;
  const avg = allVals.length ? allVals.reduce((a,b)=>a+b,0)/allVals.length : null;
  const last6 = snaps.slice(-6);
  const last6vals = last6.map(cfg.getter);
  const last3 = allVals.slice(-3);
  const trend3 = last3.length>=2 ? last3[last3.length-1]-last3[0] : null;
  const trendDir = trend3===null ? null : trend3>0.1?'up':trend3<-0.1?'down':'flat';
  let streak=0;
  for(let i=vals.length-1;i>=1;i--){const d=vals[i]-vals[i-1];if(i===vals.length-1)streak=d>0.1?1:d<-0.1?-1:0;else if((streak>0&&d>0.1)||(streak<0&&d<-0.1))streak+=streak>0?1:-1;else break;}

  // Cross-metric data
  const L = snaps[snaps.length-1], P = snaps.length>1?snaps[snaps.length-2]:null;
  const unitsL=L.totalUnits||0, unitsP=P?.totalUnits||0;
  const costL=L.avgCost||0, costP=P?.avgCost||0;
  const skusL=L.skus||0, skusP=P?.skus||0;
  const asinsL=L.asins||0, asinsP=P?.asins||0;
  const svL=L.stockValue||0, svP=P?.stockValue||0;
  const unitsUp=P&&unitsL>unitsP, unitsDown=P&&unitsL<unitsP;
  const costUp=P&&costL>costP, costDown=P&&costL<costP;
  const skusDown=P&&skusL<skusP, asinsDown=P&&asinsL<asinsP;
  const svUp=P&&svL>svP;
  const winL=(repPct(L,'win')??0);
  const matchL=(repPct(L,'match')??0);

  // ── Deep business context per metric ──────────────────────────────────────
  let whatItMeans='', whatsHappening='', whatToWatch='', combinations='';

  if(key==='inboundunits'||key==='inboundcost'){
    const isCost = key==='inboundcost';
    whatItMeans=`Inbound is stock shipped to Amazon but not yet receipted \u2014 it is the only forward-looking number here. Everything else on this dashboard reports what already happened; this is what is about to land. Note it is a snapshot of what is in transit at that moment, not a total of everything sent that week: anything shipped and receipted between two snapshots never appears.`;
    whatToWatch=`A pipeline that keeps carrying ${isCost?'value':'units'} means stock is flowing. One that drifts toward zero and stays there means nothing is coming, and with roughly ${(DB[DB.length-1]?.totalUnits||0).toLocaleString()} units on hand you would feel that in sales a few weeks later. Read it against aged stock: inbound rising while 181d+ also rises means buying is outpacing sell-through.`;
    combinations=`Available stock falling while inbound is high is a restocking cycle, not a decline \u2014 the two need reading together. Adding inbound to stock value gives total capital deployed, which is the real figure tied up in inventory.`;
  }
  else if(key==='skus'){
    whatItMeans='SKUs represent how many product variants you have actively listed. More SKUs = broader catalogue = more chances to win buy boxes across different products. However breadth without depth (low units per SKU) can dilute focus.';
    if(P){
      const skuDiff=skusL-skusP;
      if(skuDiff>0&&unitsDown) whatsHappening=`SKUs up ${skuDiff} but units are down — you're broadening your catalogue while overall stock is thinning. You may be spreading capital across more products with less depth per product.`;
      else if(skuDiff>0&&unitsUp) whatsHappening=`SKUs up ${skuDiff} and units also rising — expanding both breadth and depth. Strong growth signal. Make sure your repricer can handle the increased catalogue efficiently.`;
      else if(skuDiff<0&&unitsUp) whatsHappening=`SKUs down ${Math.abs(skuDiff)} but units up — you're concentrating. Going deeper on fewer products. This is a deliberate strategy shift towards inventory depth over breadth. Not a bad thing.`;
      else if(skuDiff<0&&unitsDown) whatsHappening=`Both SKUs and units declining — overall inventory is contracting. Could be intentional wind-down, cash flow management, or difficulty sourcing. Check if this is planned.`;
      else whatsHappening='SKU count is stable. No significant catalogue changes this period.';
    }
    whatToWatch='Watch SKUs alongside units per SKU. A high SKU count with very few units each means lots of lines with minimal stock — one sale and you\'re out. Aim for a healthy balance of breadth and depth.';
    combinations=`Currently averaging ${P?((unitsL/Math.max(skusL,1)).toFixed(1)):'-'} units per SKU. ${skusL>0&&unitsL/skusL<3?'Low depth per SKU — consider going deeper on proven sellers rather than adding new lines.':skusL>0&&unitsL/skusL>10?'Good depth per SKU — well stocked across your catalogue.':'Reasonable depth across your catalogue.'}`;
  }

  else if(key==='asins'){
    whatItMeans='ASINs represent your unique product footprint — the number of distinct Amazon product pages you\'re selling on. Unlike SKUs (which count variants), ASINs count unique products. Dropping ASINs can mean suppressed listings, out-of-stock products, or Amazon removals — worth checking in Seller Central if you see unexpected drops.';
    if(P){
      const asinDiff=asinsL-asinsP;
      if(asinDiff<0&&skusDown) whatsHappening=`Both ASINs and SKUs declining — your product footprint is shrinking on both measures. Could be intentional catalogue pruning or stock running out across multiple lines.`;
      else if(asinDiff<0&&!skusDown) whatsHappening=`ASINs down but SKUs relatively stable — you may have multi-variant products where some variants dropped off. Check for suppressed or out-of-stock listings.`;
      else if(asinDiff>0) whatsHappening=`ASINs growing — you're listing on more unique products. Broader footprint means more buy box opportunities across different categories.`;
      else whatsHappening='ASIN count stable this period.';
    }
    whatToWatch='If ASINs and SKUs diverge significantly, it means you have products with multiple variants (size, colour, etc). A single ASIN with 5 SKUs is still one product — don\'t confuse breadth of products with breadth of variants.';
    combinations='';
  }

  else if(key==='cost'){
    whatItMeans='Average unit cost is the most context-dependent KPI — it doesn\'t have a simple "higher is better" or "lower is better" rule. What matters is what\'s driving the change. Lower avg cost can mean you\'re buying cheaper/faster-moving products. Higher avg cost can mean you\'re buying more premium/higher-margin products. Neither is automatically good or bad — it depends on what else is moving.';
    if(P){
      if(costDown&&unitsUp) whatsHappening='Avg cost down, units up — you\'re buying more stock at lower prices. Classic high-velocity, lower-ticket strategy. These products tend to move faster. Good for cashflow, lower per-unit margin but higher turnover.';
      else if(costDown&&unitsDown) whatsHappening='Avg cost down and units down — cheaper stock is selling through but you\'re not restocking much. Capital is releasing. Fine if you\'re being selective, a concern if you\'re struggling to find good buys.';
      else if(costUp&&unitsUp) whatsHappening='Avg cost up and units up — you\'re buying more stock AND it\'s higher ticket. Bigger capital deployment. Higher-value products tend to sell slower, so watch sell-through carefully. Strong potential margin, but ties up capital longer.';
      else if(costUp&&unitsDown) whatsHappening='Avg cost up, units down — cheaper stock is selling through leaving you with more expensive units. Your remaining stock is higher-value. Good margin potential but slower movement — review pricing floors to keep buy box competitive.';
      else whatsHappening='Avg cost relatively stable this period. Product mix hasn\'t shifted significantly.';
    }
    whatToWatch='The real signal is avg cost vs stock value vs units together. If avg cost rises but stock value and units also rise, you\'re deliberately moving upmarket. If avg cost rises but units fall, your cheap stock is moving but premium stock is sitting.';
    combinations=`Current avg cost £${costL.toFixed(2)} × ${unitsL.toLocaleString()} units = ${fmtGBP(costL*unitsL)} total deployed. ${costL>15?'Higher ticket portfolio — expect slower sell-through but stronger margins.':costL<8?'Lower ticket portfolio — faster velocity expected, focus on volume.':'Mid-range portfolio — balanced mix of velocity and margin.'}`;
  }

  else if(key==='stockvalue'){
    whatItMeans='Stock value is your single most important KPI. It represents the total capital deployed in inventory and your capacity to generate sales and profit. Higher stock value generally means more opportunity — more products, more listings, more chances to win buy boxes and generate revenue. It\'s your working capital in product form.';
    if(P){
      const svDiff=svL-svP;
      if(svUp&&unitsUp&&costDown) whatsHappening=`Stock value up ${fmtGBPAbs(svDiff)} — driven by more units at lower cost. You\'re building inventory volume efficiently. Good position for high-velocity selling.`;
      else if(svUp&&unitsUp&&costUp) whatsHappening=`Stock value up ${fmtGBPAbs(svDiff)} — units up and avg cost up. You\'re deploying more capital into higher-value products. Stronger margin potential but watch sell-through pace.`;
      else if(svUp&&unitsDown) whatsHappening=`Stock value up but units down — average cost has risen significantly. You\'re holding more value in fewer, more expensive units. Make sure your repricer is keeping these competitive.`;
      else if(!svUp&&unitsDown) whatsHappening=`Stock value declining (${(svDiff<0?'-':'+')+fmtGBPAbs(svDiff)}) and units falling — inventory is contracting. Could be healthy sell-through or a signal to restock. Check your buying pipeline.`;
      else if(!svUp&&unitsUp) whatsHappening='Stock value falling despite more units — you\'re selling through higher-value stock and restocking with cheaper products. Cashflow positive but margin may be compressing.';
      else whatsHappening='Stock value relatively stable this period.';
    }
    whatToWatch='Track stock value vs units together. If stock value keeps rising but units plateau, avg cost is creeping up. If both rise together, you\'re genuinely growing inventory. The goal is stock value trending upward with healthy unit depth.';
    combinations=`Implied avg cost: £${unitsL>0?(svL/unitsL).toFixed(2):'—'} per unit. ${winL>0?`With ${winL.toFixed(1)}% Win BB, this stock has ${winL<8?'low':'reasonable'} buy box visibility right now.`:''}`;
  }

  else if(key==='units'){
    whatItMeans='Total units is your raw inventory depth — how many individual items you have across all products. It\'s a key indicator of your capacity to sell. More units means more stock to fulfil orders, more listings to win buy boxes on, and more runway before you need to restock.';
    if(P){
      const uDiff=unitsL-unitsP;
      if(unitsUp&&skusDown) whatsHappening=`Units up ${uDiff.toLocaleString()} but SKUs down — you\'re concentrating. Fewer product lines but going deeper on the ones you keep. A deliberate strategy towards proven winners. Not a bad sign at all.`;
      else if(unitsUp&&costDown) whatsHappening=`Units up ${uDiff.toLocaleString()} and avg cost down — buying more of cheaper/faster-moving products. High-velocity strategy. These should move quickly through the buy box if repriced well.`;
      else if(unitsUp&&costUp) whatsHappening=`Units up ${uDiff.toLocaleString()} and avg cost also up — building depth in higher-value products. More capital tied up per unit. Keep an eye on sell-through speed — premium stock needs time.`;
      else if(unitsDown&&!svUp) whatsHappening=`Units down ${Math.abs(uDiff).toLocaleString()} and stock value also falling — inventory contracting. Either strong sell-through (good) or not restocking enough (needs attention). Check your buying pipeline.`;
      else if(unitsDown&&svUp) whatsHappening=`Units down ${Math.abs(uDiff).toLocaleString()} but stock value up — cheaper stock sold through, leaving higher-value units. Your per-unit value has increased. Good margin position but potentially slower movement.`;
      else whatsHappening='Unit count relatively stable this period.';
    }
    whatToWatch=`With ${winL.toFixed(1)}% Win BB and ${matchL.toFixed(1)}% Match BB, your current buy box coverage means roughly ${(winL+matchL).toFixed(0)}% of your listings are visible to buyers. ${(winL+matchL)<15?'Low combined coverage — units will move slowly at this rate. Prioritise improving buy box %':'Combined coverage is reasonable — stock should be moving at a decent pace'}.`;
    combinations=`${unitsL.toLocaleString()} units across ${skusL} SKUs = ${skusL>0?(unitsL/skusL).toFixed(1):'-'} units per SKU average.`;
  }

  else if(key==='winbb'){
    whatItMeans='Win BB % is the percentage of your listings where you currently hold the buy box outright — meaning you\'re the default seller customers see and buy from. This is the most direct measure of your pricing competitiveness. Higher is always better. Target: above 10–12% consistently. Below 5% is critical — you\'re essentially invisible.';
    if(P){
      const winP=(repPct(P,'win')??0);
      const wDiff=winL-winP;
      if(wDiff<0&&matchL>winL*1.5) whatsHappening=`Win BB down ${Math.abs(wDiff).toFixed(1)}pp but Match BB (${matchL.toFixed(1)}%) is significantly higher — you\'re price-competitive but not quite winning outright. A small floor price reduction could flip a meaningful chunk of matches into wins.`;
      else if(wDiff<-2) whatsHappening=`Win BB has dropped ${Math.abs(wDiff).toFixed(1)}pp — a significant loss of buy box position. Competitors are undercutting you. Your units will move slower until this recovers. Review floor prices on your top-volume SKUs first.`;
      else if(wDiff<0) whatsHappening=`Win BB edging down ${Math.abs(wDiff).toFixed(1)}pp. Worth monitoring. If it drops another 1–2pp next entry, it\'s time to review pricing floors.`;
      else if(wDiff>2) whatsHappening=`Win BB up ${wDiff.toFixed(1)}pp — strong improvement in buy box position. Your repricing is working. More wins = more visibility = more units moving.`;
      else if(wDiff>0) whatsHappening=`Win BB up slightly ${wDiff.toFixed(1)}pp. Moving in the right direction. Keep monitoring.`;
      else whatsHappening='Win BB stable this entry.';
    }
    whatToWatch=`Current position: ${winL.toFixed(1)}%. ${winL>=BB_TARGET?`At or above your ${BB_TARGET}% target.`:winL>=BB_TARGET-2?`Close to your ${BB_TARGET}% target — one or two pricing tweaks could get you there.`:winL>=5?'Below target — noticeable visibility gap. Review your repricing floors.':'Critical — below 5%. Urgent action needed on pricing.'} Remember: every 1pp of Win BB is another slice of your catalogue that customers can actually find and buy.`;
    combinations=`Win BB ${winL.toFixed(1)}% + Match BB ${matchL.toFixed(1)}% = ${(winL+matchL).toFixed(1)}% combined coverage. ${unitsL.toLocaleString()} units in stock. ${(winL+matchL)<15&&unitsL>500?'You have strong inventory but low visibility — pricing is the bottleneck, not stock levels.':winL+matchL>20?'Good coverage across your catalogue.':''}`;
  }

  else if(key==='matchbb'){
    whatItMeans='Match BB % is the percentage of listings where you\'re matching the buy box price — you\'re price-competitive but not winning outright (another seller holds the box, possibly due to metrics like feedback, fulfilment method, etc). It\'s your defensive coverage. High Match + Low Win means your prices are right but your seller metrics or fulfilment may be the limiting factor.';
    if(P){
      const matchP=(repPct(P,'match')??0);
      const mDiff=matchL-matchP;
      if(mDiff<-2) whatsHappening=`Match BB dropped ${Math.abs(mDiff).toFixed(1)}pp — you\'re losing price-competitive positioning. Your repricer may not be reacting quickly enough to competitor price changes. Review repricing speed settings.`;
      else if(mDiff<0) whatsHappening=`Match BB down slightly ${Math.abs(mDiff).toFixed(1)}pp. Small drift — monitor next 2 entries before taking action.`;
      else if(mDiff>2) whatsHappening=`Match BB up ${mDiff.toFixed(1)}pp — you\'re matching the buy box on more listings. More price-competitive across the board.`;
      else whatsHappening='Match BB stable this entry.';
    }
    whatToWatch=`The gap between Win BB (${winL.toFixed(1)}%) and Match BB (${matchL.toFixed(1)}%) is ${(matchL-winL).toFixed(1)}pp. ${matchL>winL+5?'Large gap — you\'re matching but not winning on a significant portion of listings. These could potentially be converted to wins with slight price adjustments or improved seller metrics.':'Small gap between win and match — you\'re converting matches into wins efficiently.'}`;
    combinations=`Combined buy box coverage (win + match): ${(winL+matchL).toFixed(1)}%. Your target is ${BB_TARGET}% on each — Win ${winL.toFixed(1)}%, Match ${matchL.toFixed(1)}%.`;
  }

  else if(key==='agedrisk'){
    whatItMeans='Aged risk tracks what percentage of your units have been in stock for 181+ days. These are your slow-movers — they\'re tying up working capital, may be incurring storage fees, and are at risk of never selling at a profitable price. The lower this number the better. Anything above 8–10% needs attention.';
    const ag=L.ageing||{};
    const tot=(ag.a0||0)+(ag.a31||0)+(ag.a61||0)+(ag.a91||0)+(ag.a181||0)+(ag.a271||0)+(ag.a365||0);
    const aged181=(ag.a181||0)+(ag.a271||0)+(ag.a365||0);
    const aged365=ag.a365||0;
    if(P){
      const agP=P.ageing||{};
      const totP=(agP.a0||0)+(agP.a31||0)+(agP.a61||0)+(agP.a91||0)+(agP.a181||0)+(agP.a271||0)+(agP.a365||0);
      const aged181P=(agP.a181||0)+(agP.a271||0)+(agP.a365||0);
      const agedDiff=aged181-aged181P;
      if(agedDiff>10) whatsHappening=`Aged units increased by ${agedDiff} — more stock is crossing the 181-day threshold. Act now before it compounds. A targeted clearance promo on these specific ASINs is the fastest fix.`;
      else if(agedDiff>0) whatsHappening=`Aged units up slightly (${agedDiff} more units). Not critical yet but the trend is the wrong direction.`;
      else if(agedDiff<0) whatsHappening=`Aged units reduced by ${Math.abs(agedDiff)} — good progress clearing old stock. Keep the clearance momentum going.`;
      else whatsHappening='Aged stock holding steady. No significant movement either way.';
    }
    whatToWatch=`${aged365>0?`You have ${aged365} units aged 365+ days — these are your most urgent clearance priority. At this age, recovering any capital is better than holding out for full margin. `:''}${winL<8?'Your Win BB % is also low ('+winL.toFixed(1)+'%) — aged stock is harder to move when you\'re not winning buy boxes. Fix pricing first to give these products visibility.':''}`;
    combinations=`${aged181} aged units out of ${tot} total (${tot>0?((aged181/tot)*100).toFixed(1):0}%). ${(winL+matchL)<15?'Combined BB coverage is low — these aged units aren\'t being seen. Lower their floor prices specifically to prioritise clearing them.':''}`;
  }

  // Simple: up = green, down = red always for vs Last Entry display
  const diffDisplayColor = diff===null?'var(--muted2)':diff>0?'#00f5a0':diff<0?'#ff8c42':'var(--muted2)';

  // "3-entry trend" and "vs 6 ago" were entry counts. Snapshots land Mon/Wed/Fri, so the
  // comparisons Jack actually thinks in are a week and a fortnight — matched by date.
  const wkRef = snapDaysBack(snaps, 7, 3, cfg.getter);
  const ftRefRaw = snapDaysBack(snaps, 14, 3, cfg.getter);
  // With a short history both can resolve to the same reading; showing it twice is noise.
  const ftRef = (ftRefRaw && wkRef && ftRefRaw.date === wkRef.date) ? null : ftRefRaw;
  const trend3val = (wkRef && latest!=null) ? latest - cfg.getter(wkRef) : null;
  const trend3good = trend3val===null ? null : cfg.upGood===null ? null : cfg.upGood ? trend3val>0 : trend3val<0;
  const trend3col = trend3val===null?'var(--muted2)':trend3good===null?'#ffd166':trend3good?'#00f5a0':'#ff8c42';
  const trend3str = trend3val===null ? '—' : (trend3val>0?'+':trend3val<0?'-':'') + (cfg.fmtDiff||cfg.fmt)(Math.abs(trend3val||0));

  const diff6 = (ftRef && latest!=null) ? latest - cfg.getter(ftRef) : null;
  const diff6good = diff6===null ? null : cfg.upGood===null ? null : cfg.upGood ? diff6>0 : diff6<0;
  const diff6col = diff6===null?'var(--muted2)':diff6good===null?'#ffd166':diff6good?'#00f5a0':'#ff8c42';
  const diff6str = diff6===null ? '—' : (diff6>0?'+':diff6<0?'-':'') + (cfg.fmtDiff||cfg.fmt)(Math.abs(diff6||0));
  const diff6label = 'vs 2 weeks';
  const dupeSpan = false;   // reference dates are distinct by construction now

  // Concern sentence — reads full history for sustained patterns
  let concernSentence = '';
  let concernColor = 'var(--muted2)';

  if(snaps.length >= 2) {
    // Count consecutive drops from latest going back
    let consecDown = 0, consecUp = 0;
    for(let i = allVals.length-1; i >= 1; i--) {
      if(allVals[i] < allVals[i-1]) consecDown++;
      else break;
    }
    for(let i = allVals.length-1; i >= 1; i--) {
      if(allVals[i] > allVals[i-1]) consecUp++;
      else break;
    }
    // How many entries since last time it went up (for downtrend metrics) or down (for uptrend)
    let entriesSinceRecovery = 0;
    if(consecDown > 0) {
      entriesSinceRecovery = consecDown;
    }
    // Net change over all entries
    const netAllTime = allVals.length >= 2 ? allVals[allVals.length-1] - allVals[0] : 0;
    // Has it ever recovered after a drop? Find longest down streak in full history
    let longestDownStreak = 0, curStreak = 0;
    for(let i = 1; i < allVals.length; i++) {
      if(allVals[i] < allVals[i-1]) { curStreak++; longestDownStreak = Math.max(longestDownStreak, curStreak); }
      else curStreak = 0;
    }

    // Mon/Wed/Fri = ~2.5 entries per week, so:
    // 3 entries ≈ just over 1 week
    // 5 entries ≈ 2 weeks
    // 7+ entries ≈ 3+ weeks = serious concern
    const weeksDown = Math.round(consecDown / 2.5 * 10) / 10;

    if(key === 'winbb' || key === 'matchbb') {
      if(latest < 5) {
        concernSentence = `⚠ Critical — at ${latest.toFixed(1)}% your listings are nearly invisible. Urgent action needed on floor prices.`;
        concernColor = '#ff4d6d';
      } else if(latest < 10 && consecDown >= 7) {
        concernSentence = `⚠ Serious concern — below 10% target and has fallen ${consecDown} entries in a row (~${weeksDown} weeks) with no recovery. This is a sustained decline, not a blip. Review repricing strategy urgently.`;
        concernColor = '#ff4d6d';
      } else if(latest < 10 && consecDown >= 5) {
        concernSentence = `⚠ Concern — below target and declining for ${consecDown} consecutive entries (~${weeksDown} weeks). No signs of recovery yet. Act before this becomes critical.`;
        concernColor = '#ff8c42';
      } else if(latest < 10 && consecDown >= 3) {
        concernSentence = `Watch — below 10% target and falling for ${consecDown} entries in a row. A week or two of drops is normal, but if it continues another 2–3 entries without recovery, it needs action.`;
        concernColor = '#ffd166';
      } else if(latest < 10) {
        concernSentence = `Watch — below 10% target. Recent movement mixed. Monitor over next few entries.`;
        concernColor = '#ffd166';
      } else if(latest >= 10 && consecDown >= 3) {
        concernSentence = `Watch — above target but has fallen ${consecDown} entries in a row. Still healthy for now, but the trend is heading the wrong way.`;
        concernColor = '#ffd166';
      } else if(latest >= 10) {
        concernSentence = `✓ On target — above 10%. ${consecUp >= 2 ? `Rising ${consecUp} entries in a row — momentum building.` : 'Holding position.'}`;
        concernColor = '#00f5a0';
      }
    }

    else if(key === 'agedrisk') {
      if(latest > 10 && consecUp >= 5) {
        concernSentence = `⚠ Serious concern — aged risk above 10% and has risen ${consecUp} entries in a row (~${Math.round(consecUp/2.5*10)/10} weeks) without dropping. Prolonged build-up. Run clearance promos now — the longer you wait the harder it gets.`;
        concernColor = '#ff4d6d';
      } else if(latest > 10 && consecUp >= 3) {
        concernSentence = `⚠ Concern — aged risk above 10% and rising for ${consecUp} consecutive entries. Not recovering. Targeted clearance needed on 181+ day ASINs.`;
        concernColor = '#ff8c42';
      } else if(latest > 10) {
        concernSentence = `⚠ Watch — above 10% aged risk threshold. Plan clearance soon.`;
        concernColor = '#ff8c42';
      } else if(latest > 5) {
        concernSentence = `Watch — aged risk building (${latest.toFixed(1)}%). Not critical yet but worth monitoring.`;
        concernColor = '#ffd166';
      } else {
        concernSentence = `✓ Healthy — below 5%. Stock is turning over well.`;
        concernColor = '#00f5a0';
      }
    }

    else if(key === 'stockvalue') {
      if(consecDown >= 7) {
        concernSentence = `⚠ Serious concern — stock value has declined ${consecDown} consecutive entries (~${weeksDown} weeks) with no recovery. This is a prolonged contraction. Check your buying pipeline and cashflow urgently.`;
        concernColor = '#ff4d6d';
      } else if(consecDown >= 5) {
        concernSentence = `⚠ Concern — stock value has fallen ${consecDown} entries in a row (~${weeksDown} weeks) without recovering. Sell-through may be outpacing restocking. Review sourcing activity.`;
        concernColor = '#ff8c42';
      } else if(consecDown >= 3) {
        concernSentence = `Watch — declining for ${consecDown} entries in a row. A few weeks of drawdown is normal (strong sell-through), but watch for recovery in next 2–3 entries.`;
        concernColor = '#ffd166';
      } else if(consecUp >= 3) {
        concernSentence = `✓ Growing consistently — up ${consecUp} entries in a row. Strong inventory build.`;
        concernColor = '#00f5a0';
      } else {
        concernSentence = `No major concern — fluctuation is normal. Net movement all-time: ${netAllTime >= 0 ? '+' : '-'}${fmtGBPAbs(netAllTime)}.`;
        concernColor = 'var(--muted2)';
      }
    }

    else if(key === 'units') {
      if(consecDown >= 7) {
        concernSentence = `⚠ Concern — units declining ${consecDown} entries in a row (~${weeksDown} weeks). Either exceptionally strong sell-through, or you\'re not restocking fast enough. Check buying pipeline.`;
        concernColor = '#ff8c42';
      } else if(consecDown >= 5) {
        concernSentence = `Watch — units down ${consecDown} consecutive entries (~${weeksDown} weeks). Could be healthy sell-through, but sustained decline without restocking will leave you short on stock.`;
        concernColor = '#ffd166';
      } else if(consecDown >= 3) {
        concernSentence = `Watch — falling for ${consecDown} entries. Normal if sell-through is strong. Concern if restocking hasn\'t kicked in yet.`;
        concernColor = '#ffd166';
      } else if(consecUp >= 3) {
        concernSentence = `✓ Units growing ${consecUp} entries in a row — inventory depth building.`;
        concernColor = '#00f5a0';
      } else {
        concernSentence = `Normal fluctuation — units move up and down with buy/sell cycles. No sustained concern.`;
        concernColor = 'var(--muted2)';
      }
    }

    else if(key === 'cost') {
      if(costUp && unitsDown && consecDown >= 4) {
        concernSentence = `⚠ Watch — avg cost has been rising for multiple entries while units fall. Cheap stock is selling but expensive stock isn\'t. Your remaining inventory is increasingly high-cost. Review floor prices on premium ASINs.`;
        concernColor = '#ff8c42';
      } else if(costDown && unitsUp) {
        concernSentence = `✓ Positive pattern — buying more at lower cost. High-velocity strategy working well.`;
        concernColor = '#00f5a0';
      } else if(costUp && unitsUp) {
        concernSentence = `Neutral — buying more at higher cost. Higher margin potential but more capital at risk. Watch sell-through on premium stock.`;
        concernColor = '#ffd166';
      } else {
        concernSentence = `Avg cost needs cross-metric context. Check the panels on the right for the full picture.`;
        concernColor = 'var(--muted2)';
      }
    }

    else if(key === 'skus' || key === 'asins') {
      if(consecDown >= 5) {
        concernSentence = `Watch — count has fallen ${consecDown} entries in a row (~${weeksDown} weeks). Could be listings suppressed, stock running out, or intentional pruning. Check Seller Central if unexpected.`;
        concernColor = '#ffd166';
      } else if(consecDown >= 3) {
        concernSentence = `Watch — declining for ${consecDown} entries. Normal if intentional. Check for suppressed listings if unexpected.`;
        concernColor = '#ffd166';
      } else if(consecUp >= 3) {
        concernSentence = `✓ Growing ${consecUp} entries in a row — catalogue breadth expanding.`;
        concernColor = '#00f5a0';
      } else {
        concernSentence = `Stable — no sustained trend in either direction.`;
        concernColor = 'var(--muted2)';
      }
    }
  }

  // History rows — fixed formatting and alignment
  // Rows before the metric was ever recorded printed a row of dashes each. Collapse them
  // into one honest line so the table starts where the data does.
  let histSkipped = 0;
  {
    let i = 0;
    while (i < last6.length && cfg.getter(last6[i]) == null) { i++; }
    if (i > 0 && i < last6.length) { histSkipped = i; }
  }
  const histRows = last6.map((s,i)=>{
    if (i < histSkipped) return '';
    const v=cfg.getter(s), pv=i>0?cfg.getter(last6[i-1]):null, d=pv!==null?v-pv:null;
    // was 'transparent', which drew the — in invisible ink and made the first row look broken
    const dCol=d===null?'var(--muted)':Math.abs(d)<0.05?'var(--muted2)':d>0?'#00f5a0':'#ff8c42';
    // Fix: format sign separately from currency symbol, use fmtDiff for changes if available
    let dStr='';
    if(d!==null&&Math.abs(d)>=0.0001){
      const sign=d>0?'+':'-';
      const fmtFn = cfg.fmtDiff || cfg.fmt;
      const absStr=fmtFn(Math.abs(d));
      dStr=sign+absStr;
    }
    const dd=s.date?.split('-'); const lbl=dd?`${dd[2]}/${dd[1]}/${dd[0].slice(2)}`:s.date||'';
    // With a companion the row carries both tracks side by side — the point of the redesign
    // is reading units and money on the same line rather than flipping a toggle.
    let coCells='';
    if (cfg.companion) {
      const c=cfg.companion;
      const cvv=c.getter(s), cpv=i>0?c.getter(last6[i-1]):null;
      const cd=(cpv!=null&&cvv!=null)?cvv-cpv:null;
      const ccol=cd===null?'var(--muted)':Math.abs(cd)<0.5?'var(--muted2)':cd>0?'#00f5a0':'#ff8c42';
      const cstr=cd!==null&&Math.abs(cd)>=0.5?((cd>0?'+':'-')+c.fmtDiff(Math.abs(cd))):'';
      coCells = `<span style="text-align:center;font-weight:700;color:${c.colour}">${c.fmt(cvv)}</span>`
              + `<span style="text-align:right;font-weight:600;color:${ccol}">${cstr||'—'}</span>`;
    }
    return `<div style="display:grid;grid-template-columns:${cfg.companion?'1.1fr .9fr .9fr .9fr .9fr':'1fr 1fr 1fr'};align-items:center;gap:4px;padding:7px 12px;background:rgba(255,255,255,.02);border-radius:6px;margin-bottom:3px;font-family:var(--mono);font-size:11px">
      <span style="color:var(--muted2)">${lbl}</span>
      <span style="text-align:center;font-weight:700;color:var(--text)">${cfg.fmt(v)}</span>
      <span style="text-align:right;font-weight:600;color:${dCol}">${dStr||'—'}</span>
      ${coCells}
    </div>`;
  }).join('');

  // Trend tags
  const trendGood = trendDir===null?null:cfg.upGood===null?null:cfg.upGood?trendDir==='up':trendDir==='down';
  const streakTag = streak!==0?`<span style="font-family:var(--mono);font-size:10px;padding:3px 8px;border-radius:4px;background:${Math.abs(streak)>=2?'rgba(255,255,255,.06)':'rgba(255,255,255,.04)'};color:var(--muted2)">${streak>0?'↑':'↓'} ${Math.abs(streak)} in a row</span>`:'';
  // Everything the companion track needs, mirroring the primary calcs above.
  const co = cfg.companion || null;
  let coLatest=null, coDiff=null, coTrend3=null, coAvg=null, coLo=null, coHi=null, coDiff6=null;
  if (co) {
    const cv = snaps.map(co.getter);
    const cReal = cv.filter(v=>v!=null && !isNaN(v));
    coLatest = cv[cv.length-1];
    const cPrev = cv.length>1 ? cv[cv.length-2] : null;
    coDiff = (cPrev!=null && coLatest!=null) ? coLatest-cPrev : null;
    const cWk = snapDaysBack(snaps, 7, 3, co.getter);
    coTrend3 = (cWk && coLatest!=null) ? coLatest - co.getter(cWk) : null;
    coAvg = cReal.length ? cReal.reduce((a,b)=>a+b,0)/cReal.length : null;
    coLo = cReal.length ? Math.min(...cReal) : null;
    coHi = cReal.length ? Math.max(...cReal) : null;
    const cFtRaw = snapDaysBack(snaps, 14, 3, co.getter);
    const cFt = (cFtRaw && cWk && cFtRaw.date===cWk.date) ? null : cFtRaw;
    coDiff6 = (cFt && coLatest!=null) ? coLatest - co.getter(cFt) : null;
  }
  // Second line under a stat card. Muted and smaller — it supports the headline, not competes.
  const coLine = (val, isDiff) => {
    if (!co) return '';
    if (val == null) return '';   // a lone dash under a real number reads as broken
    const txt = isDiff ? ((val>0?'+':val<0?'-':'')+co.fmtDiff(val)) : co.fmt(val);
    return `<div class="kpi-co" style="color:${co.colour}">${txt}</div>`;
  };

  const trendTag = trendDir?`<span style="font-family:var(--mono);font-size:10px;padding:3px 8px;border-radius:4px;background:${trendGood===null?'rgba(255,209,102,.08)':trendGood?'rgba(0,245,160,.1)':'rgba(255,140,66,.1)'};color:${trendGood===null?'#ffd166':trendGood?'#00f5a0':'#ff8c42'}">${trendDir==='up'?'↗':trendDir==='down'?'↘':'→'} ${trendDir} over 3 entries</span>`:'';

  title.textContent = cfg.label;
  body.innerHTML = `
    ${metricToggleHtml}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:28px">

      <!-- LEFT -->
      <div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:8px">
          <div style="background:rgba(255,255,255,.04);padding:12px;border-radius:10px;text-align:center;border:1px solid rgba(255,255,255,.06)">
            <div style="font-family:var(--mono);font-size:10px;color:var(--muted2);margin-bottom:6px;text-transform:uppercase;letter-spacing:.1em">Latest</div>
            <div style="font-size:20px;font-weight:700;color:var(--text)">${cfg.fmt(latest)}</div>${coLine(coLatest,false)}
          </div>
          <div style="background:rgba(255,255,255,.04);padding:12px;border-radius:10px;text-align:center;border:1px solid rgba(255,255,255,.06)">
            <div style="font-family:var(--mono);font-size:10px;color:var(--muted2);margin-bottom:6px;text-transform:uppercase;letter-spacing:.1em">vs Last Entry</div>
            <div style="font-size:20px;font-weight:700;color:${diffDisplayColor}">${diff===null?'—':((diff>0?'+':'-')+(cfg.fmtDiff||cfg.fmt)(Math.abs(diff||0)))}</div>${coLine(coDiff,true)}
          </div>
          <div style="background:rgba(255,255,255,.04);padding:12px;border-radius:10px;text-align:center;border:1px solid rgba(255,255,255,.06)">
            <div ${wkRef?`title="compared with ${fmt(wkRef.date)}"`:''} style="font-family:var(--mono);font-size:10px;color:var(--muted2);margin-bottom:6px;text-transform:uppercase;letter-spacing:.1em">vs last week</div>
            <div style="font-size:20px;font-weight:700;color:${trend3col}">${trend3str}</div>${coLine(coTrend3,true)}
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:20px">
          <div style="background:rgba(255,255,255,.04);padding:12px;border-radius:10px;text-align:center;border:1px solid rgba(255,255,255,.06);${dupeSpan?'opacity:.45':''}">
            <div ${ftRef?`title="compared with ${fmt(ftRef.date)}"`:''} style="font-family:var(--mono);font-size:10px;color:var(--muted2);margin-bottom:6px;text-transform:uppercase;letter-spacing:.1em">${diff6label}</div>
            <div style="font-size:20px;font-weight:700;color:${dupeSpan?'var(--muted2)':diff6col}">${diff6str}</div>${dupeSpan?'':coLine(coDiff6,true)}
          </div>
          <div style="background:rgba(255,255,255,.04);padding:12px;border-radius:10px;text-align:center;border:1px solid rgba(255,255,255,.06)">
            <div style="font-family:var(--mono);font-size:10px;color:var(--muted2);margin-bottom:6px;text-transform:uppercase;letter-spacing:.1em">All-time Avg</div>
            <div style="font-size:20px;font-weight:700;color:var(--muted2)">${cfg.fmt(avg)}</div>${coLine(coAvg,false)}
          </div>
          <div style="background:rgba(255,255,255,.04);padding:12px;border-radius:10px;text-align:center;border:1px solid rgba(255,255,255,.06)">
            <div style="font-family:var(--mono);font-size:10px;color:var(--muted2);margin-bottom:6px;text-transform:uppercase;letter-spacing:.1em">Range</div>
            <div style="font-size:11px;font-weight:600;color:var(--muted2);margin-top:4px">${cfg.fmt(lowest)} → ${cfg.fmt(highest)}</div>${co?`<div class="kpi-co" style="color:${co.colour}">${co.fmt(coLo)} → ${co.fmt(coHi)}</div>`:''}
          </div>
        </div>

        ${(trendTag||streakTag)?`<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px">${trendTag}${streakTag}</div>`:''}

        <!-- Concern sentence -->
        ${concernSentence?`<div style="padding:10px 14px;background:rgba(255,255,255,.03);border-left:3px solid ${concernColor};border-radius:0 6px 6px 0;font-family:var(--mono);font-size:11px;color:${concernColor};line-height:1.6;margin-bottom:16px">${concernSentence}</div>`:''}

        <!-- History table -->
        <div style="font-family:var(--mono);font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:var(--muted2);margin-bottom:8px">Entry history</div>
        <div style="display:grid;grid-template-columns:${cfg.companion?'1.1fr .9fr .9fr .9fr .9fr':'1fr 1fr 1fr'};gap:4px;font-family:var(--mono);font-size:10px;color:var(--muted2);padding:4px 12px;margin-bottom:4px;text-transform:uppercase;letter-spacing:.08em">
          <span>Date</span>
          <span style="text-align:center">${cfg.companion?'Units':(cfg.unit==='units'?'Units':'Value')}</span>
          <span style="text-align:right">Change</span>
          ${cfg.companion?`<span style="text-align:center;color:${cfg.companion.colour}">Value</span><span style="text-align:right;color:${cfg.companion.colour}">Change</span>`:''}
        </div>
        ${histSkipped?`<div style="font-family:var(--mono);font-size:10.5px;color:var(--muted);padding:7px 12px;margin-bottom:3px;font-style:italic">${histSkipped} earlier entr${histSkipped!==1?'ies':'y'} — not recorded yet</div>`:''}
        ${histRows}

        <div style="display:flex;align-items:center;justify-content:space-between;margin-top:18px;margin-bottom:8px">
          <span style="font-family:var(--mono);font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:var(--muted2)">Trend chart</span>
          <div style="display:flex;gap:4px;align-items:center">
            <button id="kpiRangePeriod" class="kpi-range-btn active" onclick="renderKpiModalChart('period')">This period</button>
            <button id="kpiRangeAll" class="kpi-range-btn" onclick="renderKpiModalChart('all')">All time</button>
          </div>
        </div>
        <div style="position:relative;height:160px"><canvas id="kpiModalCanvas"></canvas></div>
      </div>

      <!-- RIGHT -->
      <div style="display:flex;flex-direction:column;gap:14px">
        <div style="padding:14px 16px;background:rgba(0,245,160,.04);border-left:3px solid rgba(0,245,160,.3);border-radius:0 8px 8px 0">
          <div style="font-family:var(--mono);font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:rgba(0,245,160,.6);margin-bottom:8px">What this KPI means</div>
          <div style="font-family:var(--mono);font-size:11px;color:var(--muted2);line-height:1.55">${whatItMeans}</div>
        </div>
        ${whatsHappening?`<div style="padding:14px 16px;background:rgba(255,209,102,.04);border-left:3px solid rgba(255,209,102,.35);border-radius:0 8px 8px 0">
          <div style="font-family:var(--mono);font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:rgba(255,209,102,.7);margin-bottom:8px">What's happening right now</div>
          <div style="font-family:var(--mono);font-size:11px;color:var(--muted2);line-height:1.55">${whatsHappening}</div>
        </div>`:''}
        ${combinations?`<div style="padding:14px 16px;background:rgba(61,158,255,.04);border-left:3px solid rgba(61,158,255,.3);border-radius:0 8px 8px 0">
          <div style="font-family:var(--mono);font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:rgba(61,158,255,.7);margin-bottom:8px">Cross-metric context</div>
          <div style="font-family:var(--mono);font-size:11px;color:var(--muted2);line-height:1.55">${combinations}</div>
        </div>`:''}
        ${whatToWatch?`<div style="padding:14px 16px;background:rgba(255,140,66,.04);border-left:3px solid rgba(255,140,66,.3);border-radius:0 8px 8px 0">
          <div style="font-family:var(--mono);font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:rgba(255,140,66,.7);margin-bottom:8px">What to watch</div>
          <div style="font-family:var(--mono);font-size:11px;color:var(--muted2);line-height:1.55">${whatToWatch}</div>
        </div>`:''}
      </div>
    </div>`;

  // Concern badge
  const concernEl = document.getElementById('kpiModalConcern');
  if(concernEl){
    let concern='', concernStyle='';
    if(key==='winbb'&&winL<5){concern='🔴 Critical';concernStyle='background:rgba(255,77,109,.15);color:#ff4d6d';}
    else if(key==='winbb'&&winL<10){concern='🟡 Below target';concernStyle='background:rgba(255,209,102,.12);color:#ffd166';}
    else if(key==='winbb'&&winL>=10){concern='🟢 On target';concernStyle='background:rgba(0,245,160,.1);color:#00f5a0';}
    else if(key==='matchbb'&&matchL<5){concern='🔴 Critical';concernStyle='background:rgba(255,77,109,.15);color:#ff4d6d';}
    else if(key==='matchbb'&&matchL<10){concern='🟡 Below target';concernStyle='background:rgba(255,209,102,.12);color:#ffd166';}
    else if(key==='matchbb'&&matchL>=10){concern='🟢 On target';concernStyle='background:rgba(0,245,160,.1);color:#00f5a0';}
    else if(key==='agedrisk'&&latest>10){concern='🔴 High risk';concernStyle='background:rgba(255,77,109,.15);color:#ff4d6d';}
    else if(key==='agedrisk'&&latest>5){concern='🟡 Watch this';concernStyle='background:rgba(255,209,102,.12);color:#ffd166';}
    else if(key==='agedrisk'&&latest<=5){concern='🟢 Healthy';concernStyle='background:rgba(0,245,160,.1);color:#00f5a0';}
    else if(key==='stockvalue'&&diff!==null&&diff<0&&streak<=-2){concern='🟡 Declining trend';concernStyle='background:rgba(255,209,102,.12);color:#ffd166';}
    else if(key==='stockvalue'&&diff!==null&&diff>0){concern='🟢 Growing';concernStyle='background:rgba(0,245,160,.1);color:#00f5a0';}
    else if(key==='cost'&&unitsDown&&costUp){concern='🟡 Watch — expensive stock sitting';concernStyle='background:rgba(255,209,102,.12);color:#ffd166';}
    concernEl.textContent=concern;
    concernEl.style.cssText+=';'+concernStyle;
    concernEl.style.display=concern?'inline':'none';
  }

  modal.style.display = 'flex';

  // Store state so the period/all-time toggle can re-render the chart on demand
  window._kpiChart = {
    cfg,
    periodSnaps: last6,
    allSnaps: [...DB].sort((a,b)=>a.date.localeCompare(b.date)),
    mode: 'period'
  };
  setTimeout(()=>renderKpiModalChart('period'), 50);
}

// Renders the KPI modal trend chart in either the current period ('period') or full history ('all').
function renderKpiModalChart(mode){
  const st = window._kpiChart; if(!st) return;
  if(mode) st.mode = mode; else mode = st.mode || 'period';
  const canvas = document.getElementById('kpiModalCanvas'); if(!canvas) return;
  if(chartInstances._kpiModalChart){chartInstances._kpiModalChart.destroy();delete chartInstances._kpiModalChart;}
  const cfg = st.cfg;
  const getter = cfg.getter, fmt = cfg.fmt;
  const src = ((mode==='all' ? st.allSnaps : st.periodSnaps) || []).filter(s=>getter(s)!=null);
  if (cfg.companion) { /* both tracks come from the same rows, so gaps line up by construction */ }
  const vals = src.map(getter);
  const net = vals.length>=2 ? vals[vals.length-1]-vals[0] : 0;
  const lineColor = net>=0 ? '#00f5a0' : '#ff8c42';
  const manyPoints = src.length > 8;
  chartInstances._kpiModalChart=new Chart(canvas.getContext('2d'),{
    type:'line',
    data:{labels:src.map(s=>{const d=s.date?.split('-');return d?`${d[2]}/${d[1]}`:s.date;}),datasets:[
      {label:cfg.unit||cfg.label,data:vals,borderColor:lineColor,backgroundColor:lineColor+'22',tension:.35,fill:true,pointRadius:manyPoints?3:5,pointBackgroundColor:lineColor,pointBorderColor:'#16181a',pointBorderWidth:2,borderWidth:2.5,yAxisID:'y'},
      // The companion rides its own axis: units and pounds share a shape but not a scale.
      ...(cfg.companion?[{label:cfg.companion.axis,data:src.map(cfg.companion.getter),borderColor:cfg.companion.colour,backgroundColor:'transparent',borderDash:[5,4],tension:.35,fill:false,pointRadius:manyPoints?2:4,pointBackgroundColor:cfg.companion.colour,pointBorderColor:'#16181a',pointBorderWidth:2,borderWidth:2,yAxisID:'y1'}]:[])
    ]},
    options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},layout:{padding:{top:22,right:56,left:6,bottom:2}},plugins:{
      legend:{display:!!cfg.companion,labels:{color:'#a7b4c4',font:{family:'Inter',size:11},boxWidth:10,boxHeight:2,usePointStyle:false}},
      datalabels:{ display: ctx => !manyPoints && !cfg.companion && ctx.dataIndex===ctx.dataset.data.length-1, align:'top', offset:6, clip:false, color:lineColor, font:{family:'Inter',size:10,weight:'600'}, formatter:v=>fmt(v) },
      tooltip:{backgroundColor:'#11161f',borderColor:'#2a3545',borderWidth:1,padding:10,titleFont:{family:'Inter',size:11},bodyFont:{family:'Inter',size:11},
        callbacks:{label:ctx=>' '+(ctx.datasetIndex===1&&cfg.companion?cfg.companion.fmt(ctx.parsed.y):fmt(ctx.parsed.y))}}},
      scales:{x:{ticks:{font:{size:10},color:'#a7b4c4',maxRotation:0,autoSkip:true,maxTicksLimit:manyPoints?8:12},grid:{color:'rgba(255,255,255,.05)'}},
        y:{grace:'12%',ticks:{font:{size:10},color:'#a7b4c4',padding:8,maxTicksLimit:5,callback:v=>fmt(v)},
           grid:{color:'rgba(255,255,255,.05)',drawTicks:false,drawOnChartArea:true},border:{display:false},beginAtZero:false},
        ...(cfg.companion?{y1:{position:'right',grace:'12%',ticks:{font:{size:10},color:cfg.companion.colour,padding:8,maxTicksLimit:5,callback:v=>cfg.companion.fmt(v)},grid:{display:false},border:{display:false},beginAtZero:false}}:{})}}
  });
  document.getElementById('kpiRangePeriod')?.classList.toggle('active', mode!=='all');
  document.getElementById('kpiRangeAll')?.classList.toggle('active', mode==='all');
}

function updateKpiMiniInsights(snaps) {
  if (!snaps || snaps.length < 2) return;

  const configs = {
    kSkusInsight:      { getter: s=>s.skus||0,        upGood:true,  fmt: v=>Math.round(v) },
    kAsinsInsight:     { getter: s=>s.asins||0,       upGood:true,  fmt: v=>Math.round(v) },
    kCostInsight:      { getter: s=>s.avgCost||0,     upGood:true,  fmt: v=>'£'+v.toFixed(2) },
    kStockValueInsight:{ getter: s=>s.stockValue||0,  upGood:true,  fmt: v=>fmtGBP(v) },
    kUnitsInsight:     { getter: s=>s.totalUnits||0,  upGood:true,  fmt: v=>Math.round(v) },
    kWinBBInsight:     { getter: s=>repPct(s,'win')??0, upGood:true, fmt: v=>v.toFixed(1)+'%' },
    kMatchBBInsight:   { getter: s=>repPct(s,'match')??0, upGood:true, fmt: v=>v.toFixed(1)+'%' },
    kAgedRiskInsight:  { getter: s=>{ const ag=s.ageing||{}; const tot=AG_BUCKETS.reduce((x,b)=>x+(ag[b.key]||0),0)||1; return parseFloat((((ag.a0||0)+(ag.a31||0)+(ag.a61||0))/tot*100).toFixed(1)); }, upGood:true, fmt: v=>v.toFixed(1)+'%' },
  };

  // Cross-metric flags
  const latest = snaps[snaps.length-1];
  const prev = snaps[snaps.length-2];
  const unitsUp = (latest.totalUnits||0) > (prev.totalUnits||0);
  const costDown = (latest.avgCost||0) < (prev.avgCost||0);
  const costUp = (latest.avgCost||0) > (prev.avgCost||0);

  Object.entries(configs).forEach(([elId, cfg]) => {
    const el = document.getElementById(elId);
    if (!el) return;
    const vals = snaps.map(cfg.getter);
    const cur = vals[vals.length-1];
    const prv = vals[vals.length-2];
    const diff = cur - prv;
    const isGood = cfg.upGood ? diff > 0 : diff < 0;
    const isFlat = Math.abs(diff) < 0.05;
    const col = isFlat ? 'var(--muted2)' : isGood ? '#00f5a0' : '#ff8c42';
    const arrow = isFlat ? '→' : diff > 0 ? '↑' : '↓';
    const diffStr = cfg.fmt(Math.abs(diff));

    // One-line context
    let ctx = '';
    if (elId === 'kCostInsight') {
      // Neutral by design — a rise or fall is only meaningful next to units and stock value.
      const ctxTxt = unitsUp && costDown ? 'more stock, cheaper mix'
                   : unitsUp && costUp   ? 'more stock, higher ticket'
                   : !unitsUp && costUp  ? 'cheap stock selling first'
                   : !unitsUp && costDown? 'premium stock selling first' : 'holding steady';
      const nseg = (v,label,d) => (v===null || !Number.isFinite(v)) ? ''
        : `<span class="kpi-cmp-row" title="compared with ${fmt(d)}"><span class="kpi-cmp-l">${label}</span><span class="kpi-cmp-v" style="color:var(--muted2)">${Math.abs(v)<0.005?'→ flat':(v>0?'↑ +£':'↓ -£')+Math.abs(v).toFixed(2)}</span></span>`;
      const rows = nseg(cur-prv,'last entry',prev.date) + (snaps.length>2 ? nseg(cur-vals[0],'since '+fmtShort(snaps[0].date),snaps[0].date) : '');
      el.innerHTML = (rows?`<span class="kpi-cmp">${rows}</span>`:'')
        + `<span style="color:var(--muted2);display:block;margin-top:5px">${ctxTxt}</span>`;
      return;
    }
    else if (elId === 'kUnitsInsight') {
      // Available and Inbound are two halves of one picture, so each tile names the other.
      const inb = latest.inboundUnits ?? null;
      const dirCol = isFlat ? 'var(--muted2)' : isGood ? '#00f5a0' : '#ff8c42';
      const seg = (v,label,d) => {
        if (v===null || !Number.isFinite(v)) return '';
        const c = Math.abs(v)<0.5?'var(--muted2)':v>0?'#00f5a0':'#ff8c42';
        const a = Math.abs(v)<0.5?'→':v>0?'↑':'↓';
        return `<span class="kpi-cmp-row" title="compared with ${fmt(d)}"><span class="kpi-cmp-l">${label}</span><span class="kpi-cmp-v" style="color:${c}">${a} ${v>0?'+':''}${Math.round(v).toLocaleString()}</span></span>`;
      };
      const rows = seg(cur-prv,'last entry',prev.date) + (snaps.length>2 ? seg(cur-vals[0],'since '+fmtShort(snaps[0].date),snaps[0].date) : '');
      const line2 = inb === null
        ? '<span style="color:var(--muted2);display:block;margin-top:5px">sellable stock only</span>'
        : `<span style="color:var(--muted2);display:block;margin-top:5px">+ ${Math.round(inb).toLocaleString()} inbound = <b style="color:var(--b)">${Math.round(cur+inb).toLocaleString()}</b> total</span>`;
      el.innerHTML = (rows?`<span class="kpi-cmp">${rows}</span>`:'') + line2;
      return;
    }
    else if (elId === 'kWinBBInsight' || elId === 'kMatchBBInsight') {
      const v=cur;
      // direction from the 2-week average (same as the pill), not the last entry
      const t2 = kpiTrend2w(x => repPct(x, elId==='kWinBBInsight'?'win':'match'));
      const d2 = t2 ? t2.d : diff;
      const dirCol = d2 > 0.05 ? '#00f5a0' : d2 < -0.05 ? '#ff8c42' : 'var(--muted2)';
      const dir = d2 > 0.05 ? '↑ Improving · 2 weeks' : d2 < -0.05 ? '↓ Declining · 2 weeks' : '→ Flat · 2 weeks';
      // "Below target" on its own has no teeth — since when, and for how many readings? Counted
      // over every entry, not just the date range on screen.
      const allV = shAllSnaps().filter(x => repPct(x, elId==='kWinBBInsight'?'win':'match') != null);
      let below=0; for(let i=allV.length-1;i>=0;i--){ if(repPct(allV[i], elId==='kWinBBInsight'?'win':'match')<BB_TARGET) below++; else break; }
      const sinceDate = below>0 ? allV[allV.length-below].date : null;
      const targetCtx = v>=BB_TARGET ? `✓ Above ${BB_TARGET}% target`
        : `\u26A0 Below ${BB_TARGET}% since ${fmt(sinceDate)}${below>1?` \u00b7 ${below} entries`:''}`;
      const extra = (elId==='kWinBBInsight' && v<5) ? '<span style="color:#ff4d6d;display:block">nearly invisible</span>' : '';
      el.innerHTML = `<span style="color:${dirCol}">${dir}</span><br><span style="color:${v>=10?'var(--muted2)':'#ff8c42'}">${targetCtx}</span>`+extra;
      return;
    }
    else if (elId === 'kAgedRiskInsight') {
      el.innerHTML = shOverviewRows();
      return;
      const agSnap = snaps[snaps.length-1];
      const agTot = AG_BUCKETS.reduce((s,b)=>s+(agSnap.ageing?.[b.key]||0),0)||1;
      const agFresh = (agSnap.ageing?.a0||0)+(agSnap.ageing?.a31||0)+(agSnap.ageing?.a61||0);
      const freshPctVal = parseFloat(((agFresh/agTot)*100).toFixed(1));
      ctx = freshPctVal>=80?'✓ Above 80% target':freshPctVal>=70?'Below 80% target':'⚠ Well below target';
    }

    // Three lines, three calendar comparisons: last entry, the reading nearest a week back,
    // the reading nearest a fortnight back. Hover a line for the exact date it compares to.
    // The pill above is the 2-week view; these rows are the plain facts: the last entry, and the
    // whole date range on screen.

    const fmtAmt = (v) => cfg.fmtDiff ? cfg.fmtDiff(Math.abs(v)) : cfg.fmt(Math.abs(v));
    const lineCol = (v, upGoodVal) => {
      if (Math.abs(v) < 0.005) return 'var(--muted2)';
      if (upGoodVal === null) return '#ffd166';
      return (upGoodVal ? v > 0 : v < 0) ? '#00f5a0' : '#ff8c42';
    };
    // The pill above already says "vs last", so the old first line repeated it word for
    // word. Just the two calendar rows now: quiet label left, coloured movement right.
    const row = (v, label, cmpDate) => {
      if (v === null || !Number.isFinite(v)) return '';
      const col = lineCol(v, cfg.upGood);
      const arrow = Math.abs(v) < 0.005 ? '→' : v > 0 ? '↑' : '↓';
      const amt = Math.abs(v) < 0.005 ? 'flat' : (v > 0 ? '+' : '-') + fmtAmt(v);
      return `<span class="kpi-cmp-row" title="compared with ${fmt(cmpDate)}"><span class="kpi-cmp-l">${label}</span><span class="kpi-cmp-v" style="color:${col}">${arrow} ${amt}</span></span>`;
    };
    const r1 = row(cur - prv, 'last entry', prev.date);
    const r2 = snaps.length > 2 ? row(cur - vals[0], 'since ' + fmtShort(snaps[0].date), snaps[0].date) : '';
    el.innerHTML = (r1 || r2) ? `<span class="kpi-cmp">${r1}${r2}</span>` : '';
  });
}

function updatePopouts(snaps) { updateKpiMiniInsights(snaps); }

// One Buy Box % everywhere. Jack's rule: what you INPUT is the truth — the % Sarah types from the
// repricer comes first; winning ÷ total is only the fallback when no % was entered. (Until mid-June
// the two disagreed by 0.4–1.4pp; the tile, charts, Repricer page and popups now all show the same.)
// The ageing file and the provider import value stock at net (ex VAT) cost; everything Jack enters
// includes VAT, and he wants every £ in the app VAT-inclusive (14 Oct). So file £ are shown × 1.2.
// On the last 10 entries the files then cover 98.4–99.6% of the entered stock value — the rest is
// N/A, stuck or queried stock. Aim: as close to 100% as possible.
const VAT_RATE = 0.2;
const VAT_IN = 1 + VAT_RATE;
const incVat = v => (Number(v) || 0) * VAT_IN;           // net (file) £ → VAT-inclusive £, display only
const skuVal = r => incVat(r && r[3]);                    // a saved SKU row's £, VAT-inclusive
// both sides VAT-inclusive now: the files' £ (converted) against the stock value you enter
function coverExVat(fileTotalInc, entered){ return entered > 0 && fileTotalInc > 0 ? fileTotalInc / entered * 100 : null; }
const coverCol = c => c == null ? 'var(--muted2)' : c >= 97 ? 'var(--g)' : c >= 90 ? 'var(--y)' : 'var(--o)';
function repPct(s, kind){
  const r = s && s.repricer; if (!r) return null;
  const p = parseFloat(kind === 'win' ? r.winPct : r.matchPct), n = kind === 'win' ? r.winning : r.matching;
  if (Number.isFinite(p) && (p > 0 || (r.total > 0 && n === 0))) return +p.toFixed(1);
  if (r.total > 0 && n != null) return +(n / r.total * 100).toFixed(1);
  return null;
}
// Better or worse, the same way as Stock Health and Competitors: the entries in the last 7 days
// averaged against the week that ended 14 days earlier — one entry (a delivery landing, a quiet
// day) can't flip a tile. Uses every entry, not just the date range on screen.
function kpiTrend2w(getter, upto){
  if (typeof ldWindows !== 'function') return null;
  const all = shAllSnaps().filter(x => (!upto || x.date <= upto) && (() => { const v = getter(x); return v != null && Number.isFinite(v); })());
  if (all.length < 2) return null;
  const w = ldWindows(all.map(x => x.date)); if (!w || !w.then) return null;
  const by = new Map(all.map(x => [x.date, x]));
  const avg = ds => ds.reduce((t, d) => t + getter(by.get(d)), 0) / ds.length;
  const then = avg(w.then), now = avg(w.now);
  return { then, now, d: now - then, nowDates: w.now, thenDates: w.then };
}
const kpiSpan = t => { const f = d => fmtShort(d), sp = l => l.length > 1 ? `${f(l[0])}–${f(l[l.length-1])}` : f(l[0]); return `Average of entries ${sp(t.nowDates)} vs ${sp(t.thenDates)}`; };
// Pill = 2-week change; border = which way it went (none when the tile has no good direction).
function kpiTrendPill(valId, pillId, t, fmtD, upGood, eps, fmtV){
  const pill = document.getElementById(pillId), tile = document.getElementById(valId)?.closest('.kpi-tile');
  if (!pill) return;
  if (!t) { return; }
  const zero = Math.abs(t.d) < (eps ?? 0.5);
  const good = upGood == null || zero ? null : (t.d > 0) === upGood;
  const cls = zero || good == null ? 'flat' : good ? 'up' : 'down';
  pill.innerHTML = `<span class="pill ${cls}" title="${kfEsc(kpiSpan(t))}${fmtV ? ': ' + fmtV(t.then) + ' → ' + fmtV(t.now) : ''}">${zero ? '→ flat' : (t.d > 0 ? '▲ +' : '▼ −') + fmtD(Math.abs(t.d))} vs 2 weeks</span>`;
  if (tile) { tile.classList.remove('better','worse','same','mixed'); if (upGood != null) tile.classList.add(zero ? 'same' : good ? 'better' : 'worse'); }
}
function ovTrendTiles(){
  const n0 = v => Math.round(v).toLocaleString(), pp = v => v.toFixed(1) + 'pp', pc = v => v.toFixed(1) + '%';
  const nz = f => s => { const v = f(s); return v ? v : null; };
  kpiTrendPill('kSkus','kSkusPill', kpiTrend2w(nz(s => s.skus)), v => n0(v) + ' SKUs', true, 0.5, n0);
  kpiTrendPill('kAsins','kAsinsPill', kpiTrend2w(nz(s => s.asins)), v => n0(v) + ' ASINs', true, 0.5, n0);
  kpiTrendPill('kUnits','kUnitsPill', kpiTrend2w(nz(s => s.totalUnits)), v => n0(v) + ' units', true, 0.5, n0);
  kpiTrendPill('kStockValue','kStockValuePill', kpiTrend2w(nz(s => s.stockValue)), v => fmtGBP(v), true, 0.5, fmtGBP);
  kpiTrendPill('kCost','kCostPill', kpiTrend2w(nz(s => s.avgCost)), v => '£' + v.toFixed(2), null, 0.005, v => '£' + v.toFixed(2));
  kpiTrendPill('kInbound','kInboundPill', kpiTrend2w(s => s.inboundUnits ?? null), v => n0(v) + ' units', true, 0.5, n0);
  kpiTrendPill('kRepWinPct','kRepWinPctPill', kpiTrend2w(s => repPct(s,'win')), pp, true, 0.05, pc);
  kpiTrendPill('kRepMatchPct','kRepMatchPctPill', kpiTrend2w(s => repPct(s,'match')), pp, true, 0.05, pc);
}

function setKpi(valId, pillId, subId, curr, prev, prefix='', upGood=true, avg=0) {
  const el = document.getElementById(valId);
  const pill = document.getElementById(pillId);
  const sub = document.getElementById(subId); // optional
  if (!el || !pill) return;
  
  let displayVal = '—';
  if (curr) {
    if (prefix === '£') {
      displayVal = valId === 'kStockValue' ? fmtGBP(curr) : '£' + curr.toLocaleString('en-GB', {minimumFractionDigits: 2, maximumFractionDigits: 2});
    } else if (Number.isInteger(curr)) {
      displayVal = prefix + curr.toLocaleString();
    } else {
      displayVal = prefix + curr.toFixed(2);
    }
  }
  el.textContent = displayVal;
  
  let pillHtml = '';
  if (prev && prev !== 0) {
    const diff = curr - prev;
    const up = diff > 0;
    const good = upGood === null ? null : upGood ? up : !up;
    const cls = diff === 0 ? 'flat' : good === null ? 'flat' : (good ? 'up' : 'down');
    const arrow = diff === 0 ? '→' : (up ? '▲' : '▼');
    let label = '';
    if (prefix === '£') {
      // Always show 2dp for currency changes
      const absDiff = Math.abs(diff);
      const formatted = absDiff >= 1000 ? absDiff.toLocaleString('en-GB', {minimumFractionDigits:2,maximumFractionDigits:2}) : absDiff.toFixed(2);
      label = (up ? '+' : '-') + '£' + formatted;
    } else if (valId.toLowerCase().includes('sku') || valId.toLowerCase().includes('skus')) {
      label = (up?'+':'') + Math.round(diff) + ' SKU' + (Math.abs(diff)!==1?'s':'');
    } else if (valId.toLowerCase().includes('asin')) {
      label = (up?'+':'') + Math.round(diff) + ' ASIN' + (Math.abs(diff)!==1?'s':'');
    } else if (valId.toLowerCase().includes('unit')) {
      label = (up?'+':'') + Math.round(diff) + ' unit' + (Math.abs(diff)!==1?'s':'');
    } else {
      label = (up?'+':'') + (Number.isInteger(diff) ? diff : diff.toFixed(1));
    }
    pillHtml += `<span class="pill ${cls}">${arrow} ${label}</span>`;
  }
  pill.innerHTML = pillHtml;
  if (sub) sub.textContent = !prev ? 'First snapshot' : '';
}

// Inbound needs three states the other tiles never face: null = never recorded (show a dash),
// 0 = recorded and nothing is in transit (a real reading, must show "0"), n = units. The shared
// setKpi() uses `if (curr)` so it would render a genuine 0 as "—".
function setKpiInbound(latest, prev) {
  const el = document.getElementById('kInbound');
  const pill = document.getElementById('kInboundPill');
  const ins = document.getElementById('kInboundInsight');
  if (!el || !pill) return;
  const curr = latest?.inboundUnits ?? null;
  const currVal = latest?.inboundValue ?? null;

  if (curr === null && currVal === null) {
    el.textContent = '—';
    pill.innerHTML = '';
    if (ins) ins.innerHTML = '<span style="color:var(--muted2)">not recorded yet</span>';
    return;
  }

  el.textContent = curr === null ? '—' : Math.round(curr).toLocaleString();

  const p = prev?.inboundUnits ?? null;
  if (curr !== null && p !== null) {
    const diff = curr - p;
    const cls = diff === 0 ? 'flat' : (diff > 0 ? 'up' : 'down');
    const arrow = diff === 0 ? '\u2192' : (diff > 0 ? '\u25B2' : '\u25BC');
    pill.innerHTML = `<span class="pill ${cls}">${arrow} ${diff>0?'+':''}${Math.round(diff)} unit${Math.abs(diff)!==1?'s':''}</span>`;
  } else {
    pill.innerHTML = '';
  }

  if (ins) {
    if (currVal === null) { ins.innerHTML = 'units only'; return; }
    // The £ moves independently of the units (dearer or cheaper stock in transit), so it
    // gets its own comparison rather than borrowing the units pill's colour.
    const pv = prev?.inboundValue ?? null;
    let valDelta = '';
    if (pv !== null) {
      const vd = currVal - pv;
      const col = vd > 0 ? 'var(--g)' : vd < 0 ? 'var(--r)' : 'var(--muted2)';
      const arrow = vd === 0 ? '\u2192' : vd > 0 ? '\u25B2' : '\u25BC';
      const abs = Math.abs(vd);
      const nice = fmtGBPAbs(abs);
      valDelta = ` <span style="color:${col};font-weight:700">${arrow} ${vd>0?'+':vd<0?'-':''}${nice}</span>`;
    }
    // Inbound on its own says nothing — 544 units is a lot on 1,000 of stock and nothing on
    // 10,000. Sizing it against what is already sellable is the bit worth reading.
    const avail = latest?.totalUnits ?? null;
    const share = (avail && curr !== null) ? Math.round((curr/avail)*100) : null;
    const shareTxt = share === null ? ''
      : ` <span style="color:var(--muted2)">\u00B7 ${share}% on top of stock</span>`;
    ins.innerHTML = `\u00A3${Math.round(currVal).toLocaleString()} in transit${valDelta}<br>`
      + `<span style="color:var(--muted2)">${curr === null ? '' : Math.round(curr).toLocaleString()+' units'}</span>${shareTxt}`;
  }
}

// Mirrors the Competitors tab's own Average coverage card: zeros are excluded, because a
// seller with no overlap is not competing on your catalogue and would drag the mean down.
function setKpiCompAvg() {
  const el=document.getElementById('kCompAvg'), pill=document.getElementById('kCompAvgPill'), ins=document.getElementById('kCompAvgInsight');
  if(!el||!pill) return;
  const T = typeof leadTotals==='function' ? leadTotals() : null;
  const tile=el.closest('.kpi-tile');
  if(tile) tile.classList.remove('better','worse','same','mixed');
  if(!T){ el.textContent='—'; pill.innerHTML=''; if(ins) ins.textContent='no fetch yet'; return; }
  el.textContent=T.uOn.toLocaleString();
  // Up or down is the number of their leads you're on — not the %, which moves when their
  // shelves shrink even if you have lost ground. Each product counted once, however many
  // rivals sell it (832 across rivals was really 298 products).
  // Same verdict as the Competitors tab: last week's fetches averaged against two weeks before.
  const t = T.trend;
  if(t){
    const d=t.n, cls={better:'up',worse:'down',mixed:'mixed',same:'flat'}[t.v];
    pill.innerHTML=`<span class="pill ${cls}" title="${kfEsc(ldTrendTitle(t))}">${d>0?'▲':d<0?'▼':'→'} ${Math.abs(d).toLocaleString()} ${Math.abs(d)===1?'lead':'leads'} vs 2 weeks</span>`
      + (t.v==='mixed' ? `<div style="font-size:11px;color:var(--o);margin-top:4px">${t.why}</div>` : '');
    if(tile) tile.classList.add({better:'better',worse:'worse',mixed:'mixed',same:'same'}[t.v]);
  } else pill.innerHTML='';
  if(ins) ins.innerHTML=(T.uTotal
      ? `products · of ${T.uTotal.toLocaleString()} your rivals sell`
      : T.myAsins ? `products · ${Math.round(T.uOn/T.myAsins*100)}% of your ${T.myAsins.toLocaleString()} ASINs` : `products · ${T.rivals} rivals`)
    + `<br><span style="color:var(--muted2)">${T.rivals} rivals · ${fmt(T.date)}</span>`;
}

function setKpiPercent(valId, pillId, subId, curr, prev, upGood=true, avg=0) {
  const el = document.getElementById(valId);
  const pill = document.getElementById(pillId);
  const sub = document.getElementById(subId); // optional
  if (!el || !pill) return;
  el.textContent = curr ? (curr + '%') : '—';
  
  let pillHtml = '';
  const currNum = parseFloat(curr);
  if (prev && prev !== 0 && prev !== null) {
    const prevNum = parseFloat(prev);
    const diff = currNum - prevNum;
    const up = diff > 0;
    const good = upGood ? up : !up;
    const cls = diff === 0 ? 'flat' : (good ? 'up' : 'down');
    const arrow = diff === 0 ? '→' : (up ? '▲' : '▼');
    pillHtml += `<span class="pill ${cls}">${arrow} ${diff > 0 ? '+' : ''}${diff.toFixed(1)}pp</span>`;
  }
  pill.innerHTML = pillHtml;
  if (sub) sub.textContent = !prev ? 'First snapshot' : '';
}

function setKpiDual(valId, pillId, subId, curr, prev, avg, suffix='', upGood=true) {
  const el = document.getElementById(valId);
  const pill = document.getElementById(pillId);
  const sub = document.getElementById(subId);
  if (!el || !pill || !sub) return; // Skip if elements don't exist
  el.textContent = curr !== null ? curr + suffix : '—';
  
  let pillHtml = '';
  if (prev && prev !== 0) {
    const diff = parseFloat(curr) - parseFloat(prev);
    const up = diff > 0;
    const good = upGood ? up : !up;
    const cls = diff === 0 ? 'flat' : (good ? 'up' : 'down');
    const arrow = diff === 0 ? '→' : (up ? '▲' : '▼');
    pillHtml += `<span class="pill ${cls}">${arrow} ${Math.abs(diff).toFixed(1)} vs last</span>`;
  }
  pill.innerHTML = pillHtml;
  sub.textContent = !prev ? 'First period' : '';
}

const AG_BUCKETS = [
  {key:'a0',  label:'0–30d',    color:'#00f5a0', zone:'healthy'},
  {key:'a31', label:'31–60d',   color:'#00f5a0', zone:'healthy'},
  {key:'a61', label:'61–90d',   color:'#00f5a0', zone:'healthy'},
  {key:'a91', label:'91–180d',  color:'#ffd166', zone:'caution'},
  {key:'a181',label:'181–270d', color:'#ff8c42', zone:'danger'},
  {key:'a271',label:'271–365d', color:'#ff8c42', zone:'danger'},
  {key:'a365',label:'365d+',    color:'#ff4d6d', zone:'critical'},
];

function renderAgeing(snaps) {
  const list = document.getElementById('ageingList');
  const tag = document.getElementById('ageingTotalTag');
  if (!snaps.length) { list.innerHTML = '<div style="color:var(--muted);font-family:var(--mono);font-size:11px;padding:20px 0">No data</div>'; return; }
  const latest = snaps[snaps.length-1];
  const prev = snaps.length > 1 ? snaps[snaps.length-2] : null;
  const ag = latest.ageing || {}, prevAg = prev?.ageing || {}, val = latest.ageingValue || {};
  const hasVal = shHasValuation(latest);
  const total = AG_BUCKETS.reduce((t,b) => t + (ag[b.key]||0), 0) || 1;
  const z = shZones(latest), zv = hasVal ? shZoneValues(latest) : null;
  // what you entered (SKUs listed) first; the ageing file only counts SKUs with stock at Amazon
  tag.textContent = `${total.toLocaleString()} SKUs with stock${latest.skus ? ` (of ${latest.skus.toLocaleString()} listed)` : ''} · ${shShare90(latest, hasVal ? 'gbp' : 'sku')}% under 90 days${hasVal ? ' by £' : ''}${zv && zv.action ? ` · ${fmtGBP(zv.action)} past 180` : ''}`;
  // exact movement when both entries carry each SKU; otherwise only the net change, never guessed
  const flows = prev ? shBandFlows(prev.date, latest.date, 'sku') : null;
  const RGB = { healthy:'0,245,160', caution:'255,209,102', danger:'255,140,66', critical:'255,77,109' };
  list.innerHTML = AG_BUCKETS.map((b, idx) => {
    const cnt = ag[b.key]||0, diff = prev ? cnt - (prevAg[b.key]||0) : null;
    const pct = ((cnt/total)*100).toFixed(1);
    const isHealthy = b.zone === 'healthy';
    const col = diff == null || diff === 0 || isHealthy ? 'var(--muted2)' : diff > 0 ? b.color : 'var(--g)';
    const changeHtml = diff ? `<span style="color:${col};font-size:11px;font-weight:700;margin-left:4px">${diff>0?'↑ +':'↓ −'}${Math.abs(diff)}</span>` : '';
    const f = flows ? flows[idx] : null;
    const bits = f ? [f.newIn&&`${f.newIn} came in`, f.inYounger&&`${f.inYounger} aged in`, f.outOlder&&`${f.outOlder} aged on`, f.gone&&`${f.gone} sold out`].filter(Boolean) : [];
    const note = bits.length ? bits.join(' · ') : diff ? `net ${diff>0?'+':'−'}${Math.abs(diff)} since ${fmtShort(prev.date)}` : '';
    const chip = b.zone==='caution' ? 'MISSED 90 DAYS' : b.zone==='danger' ? 'PAST 180 DAYS' : b.zone==='critical' ? 'PAST A YEAR' : '';
    return `<div style="background:rgba(${RGB[b.zone]},.06);border:1px solid rgba(${RGB[b.zone]},.22);border-radius:8px;padding:10px 12px;margin-bottom:6px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;gap:8px">
        <div style="display:flex;align-items:center;gap:8px;min-width:0">
          <span style="width:8px;height:8px;border-radius:50%;background:${b.color};flex-shrink:0;display:inline-block"></span>
          <span style="font-family:var(--mono);font-size:12px;font-weight:700;color:${b.color}">${b.label}</span>
          ${chip ? `<span style="font-family:var(--mono);font-size:10.5px;font-weight:700;color:${b.color};background:rgba(${RGB[b.zone]},.12);padding:1px 6px;border-radius:4px;white-space:nowrap">${chip}</span>` : ''}
        </div>
        <div style="display:flex;align-items:baseline;gap:8px;white-space:nowrap">
          <span style="font-family:var(--mono);font-size:14px;font-weight:700;color:var(--text)">${cnt}</span><span style="font-family:var(--mono);font-size:11px;color:var(--muted2)">SKUs</span>
          ${changeHtml}
          ${hasVal ? `<span style="font-family:var(--mono);font-size:11.5px;color:#3d9eff">${fmtGBP(incVat(val[b.key]||0))}</span>` : ''}
          <span style="font-family:var(--mono);font-size:11px;color:var(--muted2)">${pct}%</span>
        </div>
      </div>
      <div style="height:5px;background:rgba(255,255,255,.06);border-radius:3px;overflow:hidden">
        <div style="height:100%;width:${pct}%;background:${b.color};border-radius:3px;transition:width .3s"></div>
      </div>
      ${note ? `<div style="font-family:var(--mono);font-size:11px;color:var(--muted2);margin-top:4px">${note}</div>` : ''}
    </div>`;
  }).join('');
}


function renderInsights(snaps) {
  const box = document.getElementById('insightText');
  const dateEl = document.getElementById('insightDate');
  if (!snaps.length) { box.innerHTML = "Add your first snapshot to see what's moving."; return; }

  const latest = snaps[snaps.length-1];
  const prev = snaps.length > 1 ? snaps[snaps.length-2] : null;
  const ag = latest.ageing || {};
  const totalUnits = AG_BUCKETS.reduce((s,b) => s+(ag[b.key]||0),0) || 1;
  const over180 = (ag.a181||0)+(ag.a271||0)+(ag.a365||0);
  const over180pct = ((over180/totalUnits)*100).toFixed(1);
  const fresh = ag.a0||0;
  const freshPct = ((fresh/totalUnits)*100).toFixed(1);
  const r = latest.repricer || {};
  const winPct = r.winPct ? +r.winPct : 0;
  const matchPct = r.matchPct ? +r.matchPct : 0;

  dateEl.textContent = 'Based on snapshot: ' + fmt(latest.date);

  // Build trend bars for metrics (if 2+ snapshots)
  let barsHtml = '';
  if (snaps.length >= 2) {
    const prevAg = prev.ageing || {};
    const prevTotal = AG_BUCKETS.reduce((s,b) => s+(prevAg[b.key]||0),0)||1;
    
    const asinDiff = latest.asins - prev.asins;
    const skuDiff = latest.skus - prev.skus;
    const costDiff = latest.avgCost - prev.avgCost;
    const unitsDiff = latest.totalUnits - prev.totalUnits;
    const stockValDiff = (latest.stockValue||0) - (prev.stockValue||0);
    const winDiff = winPct - (prev.repricer?.winPct || 0);
    const matchDiff = matchPct - (prev.repricer?.matchPct || 0);
    
    // Bars removed - no visual trend indicators in AI Analysis
    barsHtml = '';
  }

  let main = '';

  function _consec(arr, dir) {
    let c=0;
    for(let i=arr.length-1;i>=1;i--){ if(dir==='down'?arr[i]<arr[i-1]:arr[i]>arr[i-1])c++; else break; } return c;
  }
  function _win(s){ return repPct(s,'win')??0; }
  function _match(s){ return repPct(s,'match')??0; }
  function _g(val, isGood) { return `<strong style="color:${isGood?'#00f5a0':'#ff8c42'}">${val}</strong>`; }
  function _n(val, isGood) { return `<span style="color:${isGood?'#00f5a0':'#ff8c42'}">${val}</span>`; }
  function _gbp(v, isGood) { return _g('£'+Math.abs(Math.round(v)).toLocaleString(), isGood); }
  function _neu(val) { return `<span style="color:var(--muted2)">${val}</span>`; }

  if (snaps.length === 1) {
    main = `Baseline established on <strong>${fmt(latest.date)}</strong>. Stock value: <strong>£${(latest.stockValue||0).toLocaleString()}</strong> · Units: <strong>${latest.totalUnits.toLocaleString()}</strong> · Avg unit cost: <strong>£${(latest.avgCost||0).toFixed(2)}</strong> · ${latest.skus} SKUs across ${latest.asins} ASINs.`;
    if(over180>0) main += ` ${_n(over180+' units ('+over180pct+'%)', false)} aged 181+ days.`;
    main += ` <em style="color:var(--muted2)">Add more snapshots to see trend analysis.</em>`;

  } else if (snaps.length === 2) {
    const sv2=(latest.stockValue||0)-(prev.stockValue||0), u2=latest.totalUnits-prev.totalUnits, c2=(latest.avgCost||0)-(prev.avgCost||0);
    main = `Since <strong>${fmt(prev.date)}</strong>: stock value ${sv2>=0?_g('+£'+Math.abs(Math.round(sv2)).toLocaleString(),true):_g('-£'+Math.abs(Math.round(sv2)).toLocaleString(),false)}, units ${u2>=0?_g('+'+u2,true):_g(u2.toString(),false)}, avg unit cost ${c2>=0.005?_g('+£'+c2.toFixed(2),true):c2<=-0.005?_g('-£'+Math.abs(c2).toFixed(2),false):_neu('flat')}. <em style="color:var(--muted2)">Add more snapshots to reveal trends.</em>`;

  } else {
    const first = snaps[0];
    const svA=snaps.map(s=>s.stockValue||0), uA=snaps.map(s=>s.totalUnits||0), cA=snaps.map(s=>s.avgCost||0);
    const wA=snaps.map(_win), mA=snaps.map(_match);
    const svDiff=(latest.stockValue||0)-(prev.stockValue||0), uDiff=latest.totalUnits-prev.totalUnits, cDiff=(latest.avgCost||0)-(prev.avgCost||0);
    const wCur=_win(latest), mCur=_match(latest), wDiff=wCur-_win(prev), mDiff=mCur-_match(prev);
    const prevAg2=prev.ageing||{}, prev181=(prevAg2.a181||0)+(prevAg2.a271||0)+(prevAg2.a365||0);
    const skuDiff=latest.skus-prev.skus, asinDiff=latest.asins-prev.asins;
    const last3=snaps.slice(-3);
    const sv3s=last3[0].stockValue||0, sv3e=latest.stockValue||0;
    const u3s=last3[0].totalUnits||0, u3e=latest.totalUnits||0;
    const c3s=last3[0].avgCost||0, c3e=latest.avgCost||0;
    const c3peak=Math.max(...last3.map(s=>s.avgCost||0));
    const daysSpan=Math.max(1,Math.floor((new Date(latest.date)-new Date(first.date))/86400000));
    const svTrend=(latest.stockValue||0)-(first.stockValue||0), uTrend=latest.totalUnits-first.totalUnits, cTrend=(latest.avgCost||0)-(first.avgCost||0);
    const svConsecDown=_consec(svA,'down'), svConsecUp=_consec(svA,'up'), wConsecDown=_consec(wA,'down');
    const svDown=svDiff<0,svUp=svDiff>0,uDown=uDiff<0,uUp=uDiff>0,cDown=cDiff<-0.005,cUp=cDiff>0.005;

    // Six paragraphs of prose used to restate the tiles above and end on non-statements like
    // "mixed picture — some KPIs strengthened while others declined". Rebuilt as: one verdict,
    // only the things that are actually true, then the raw movement. Nothing is padded to
    // fill a section, and a quiet week is allowed to read as a quiet week.
    const inbU = latest.inboundUnits ?? null;
    const inbV = latest.inboundValue ?? null;
    const money = v => fmtGBPAbs(v), shortMoney = money;

    // ── Verdict: is what you are buying keeping up with what you are selling? ──
    let vTone, vLine, vWhy;
    if (inbU !== null) {
      const inbBig = inbU > 0 && latest.totalUnits > 0 && (inbU/latest.totalUnits) >= 0.05;
      if (uUp && inbBig)        { vTone='good'; vLine='Stock is up, and more is on the way';
                                  vWhy=`Stock is up ${uDiff.toLocaleString()} units and another ${inbU.toLocaleString()} is on its way${inbV?` (${money(inbV)})`:''}.`; }
      else if (uUp)             { vTone='warn'; vLine='Stock grew, but the pipeline behind it is thin';
                                  vWhy=`Up ${uDiff.toLocaleString()} units from what already landed, with only ${inbU.toLocaleString()} inbound.`; }
      else if (uDown && inbBig) { vTone='ok';   vLine='Selling faster than it lands — but more is coming';
                                  vWhy=`Down ${Math.abs(uDiff).toLocaleString()} units, with ${inbU.toLocaleString()} inbound${inbV?` worth ${money(inbV)}`:''} to land.`; }
      else if (uDown)           { vTone='bad';  vLine='Stock is thinning and little is inbound';
                                  vWhy=`Down ${Math.abs(uDiff).toLocaleString()} units with only ${inbU.toLocaleString()} on the way. This shows up in sales a few weeks out.`; }
      else                      { vTone='ok';   vLine='Holding steady';
                                  vWhy=`Units flat, ${inbU.toLocaleString()} inbound.`; }
    } else {
      vTone = uUp?'good':uDown?'warn':'ok';
      vLine = uUp?'Inventory is growing':uDown?'Inventory is thinning':'Inventory is holding steady';
      vWhy  = `${uUp?'Up':uDown?'Down':'Flat at'} ${Math.abs(uDiff).toLocaleString()} units since ${fmt(prev.date)}. No inbound recorded, so the pipeline behind this is unknown.`;
    }

    // ── Only genuine threshold breaches. No filler. ──
    const needs = [];
    if (wCur < 5) needs.push(`<b>Win Buy Box ${wCur.toFixed(1)}%</b> — critically low, your listings are close to invisible`);
    else if (wCur < 10) { const tWn = kpiTrend2w(_win); needs.push(`<b>Win Buy Box ${wCur.toFixed(1)}%</b> — under your 10% target${tWn && tWn.d <= -0.3 ? `, down ${Math.abs(tWn.d).toFixed(1)}pp over 2 weeks` : wConsecDown>=3?`, down ${wConsecDown} entries running`:''}`); }
    // Stock: the same 2-week verdict and the same 180-day limit as the Stock Health page
    const SV = typeof shVerdict === 'function' ? shVerdict() : null;
    const zvL = shHasValuation(latest) ? shZoneValues(latest) : null;
    if (SV && SV.v === 'worse') needs.push(`<b>Stock health getting worse</b> — ${kfEsc(shVerdictTitle(SV).split(' · ').slice(1).join(' · '))}`);
    else if (SV && SV.v === 'mixed') needs.push(`<b>Stock health mixed</b> — ${SV.why}`);
    if (over180 > 0) needs.push(`<b>${zvL ? fmtGBP(zvL.action) + ' past your 180-day limit' : over180.toLocaleString() + ' SKUs past 180 days'}</b> (${over180.toLocaleString()} SKUs)`);
    if (svConsecDown >= 4) needs.push(`<b>Stock value down ${svConsecDown} entries running</b> — restocking is not keeping pace`);
    if ((skuDiff > 0 || asinDiff > 0) && uDiff < 0) needs.push(`<b>Catalogue widening while units fall</b> — spreading thinner across more lines`);

    // ── Only genuine positives. ──
    const working = [];
    if (wCur >= 10) working.push(`<b>Win Buy Box ${wCur.toFixed(1)}%</b> — at or above target`);
    // Buy Box moves are judged over 2 weeks here too — the tile above said "▼1.4pp vs 2 weeks"
    // while this box said "climbing, up 0.3pp" (that was one entry).
    const tW2 = kpiTrend2w(_win), tM2 = kpiTrend2w(_match);
    if (mCur >= 10) working.push(`<b>Match Buy Box ${mCur.toFixed(1)}%${tM2 && tM2.d >= 0.3 ? `, up ${tM2.d.toFixed(1)}pp over 2 weeks` : ''}</b>`);
    if (over180 === 0) working.push(`<b>Nothing past your 180-day limit</b>`);
    if (SV && SV.v === 'better') working.push(`<b>Stock health getting healthier</b> — ${kfEsc(shVerdictTitle(SV).split(' · ').slice(1).join(' · '))}`);
    if (svConsecUp >= 3) working.push(`<b>Stock value up ${svConsecUp} entries running</b>`);
    else if (svUp) working.push(`<b>Stock value up ${shortMoney(svDiff)}</b>`);
    if (tW2 && tW2.d >= 0.3 && wCur < 10) working.push(`<b>Win Buy Box climbing</b> — up ${tW2.d.toFixed(1)}pp over 2 weeks`);

    // ── The raw movement, once, at the bottom where it belongs ──
    const chip = (lab, val, good) => `<span class="ai-num"><span class="ai-num-l">${lab}</span>`
      + `<span class="ai-num-v" style="color:${good===null?'var(--muted2)':good?'#00f5a0':'#ff8c42'}">${val}</span></span>`;
    const numbers = [
      chip('Stock value', (svDiff>=0?'+':'-')+money(svDiff), svDiff>=0),
      chip('Units', (uDiff>=0?'+':'')+uDiff.toLocaleString(), uDiff>=0),
      chip('Avg cost', (Math.abs(cDiff)<0.005?'flat':(cDiff>0?'+£':'-£')+Math.abs(cDiff).toFixed(2)), null),
      chip('SKUs', (skuDiff>=0?'+':'')+skuDiff, null),
      chip('ASINs', (asinDiff>=0?'+':'')+asinDiff, null),
    ].join('');

    const col = vTone==='good'?'#00f5a0':vTone==='bad'?'#ff4d6d':vTone==='warn'?'#ff8c42':'var(--b)';
    main = `<div class="ai-verdict" style="border-left-color:${col}">
        <div class="ai-verdict-t" style="color:${col}">${vLine}</div>
        <div class="ai-verdict-s">${vWhy}</div>
      </div>
      <div class="ai-cols">
        <div class="ai-col">
          <div class="ai-col-h" style="color:${needs.length?'#ff8c42':'var(--muted)'}">Needs you${needs.length?` · ${needs.length}`:''}</div>
          ${needs.length ? needs.map(n=>`<div class="ai-item"><span style="color:#ff8c42">▸</span> ${n}</div>`).join('')
                         : '<div class="ai-item ai-none">Nothing over the line right now.</div>'}
        </div>
        <div class="ai-col">
          <div class="ai-col-h" style="color:${working.length?'#00f5a0':'var(--muted)'}">Working${working.length?` · ${working.length}`:''}</div>
          ${working.length ? working.slice(0,4).map(n=>`<div class="ai-item"><span style="color:#00f5a0">▸</span> ${n}</div>`).join('')
                           : '<div class="ai-item ai-none">Nothing standing out this entry.</div>'}
        </div>
      </div>
      <div class="ai-nums"><span class="ai-nums-h">since ${fmt(prev.date)}</span>${numbers}</div>`;
  }

  box.innerHTML = main;
}

function switchChartMetric(metric) {
  chartMetric = metric;
  // highlight by the button's own metric — the old code leaned on the global `event`
  document.querySelectorAll('.metric-toggle').forEach(btn => btn.classList.toggle('active', (btn.getAttribute('onclick')||'').includes(`'${metric}'`)));
  renderOverviewChart(filteredSnaps());
}

function renderOverviewChart(snaps) {
  destroyChart('overviewChart');
  const ctx = document.getElementById('overviewChart').getContext('2d');
  const tag = document.getElementById('chartRangeTag');
  const trendBadge = document.getElementById('chartTrendBadge');
  
  if (snaps.length < 2) {
    tag.textContent = 'Need 2+ snapshots';
    if (trendBadge) trendBadge.innerHTML = '';
    ctx.fillStyle = '#8b99ab'; ctx.font = "11px 'Inter'"; ctx.textAlign='center';
    ctx.fillText('Add 2+ snapshots to see trend', ctx.canvas.width/2, ctx.canvas.height/2);
    return;
  }
  tag.textContent = `${fmt(snaps[0].date)} → ${fmt(snaps[snaps.length-1].date)}`;

  let datasets = [];
  let yMin = 0, yMax = 100;
  let yLabel = '';
  let latest = snaps[snaps.length-1];
  let prev = snaps[snaps.length-2];
  let trend = null;
  let trendDir = null;
  let trendColor = null;

  if (chartMetric === 'units') {
    const data = snaps.map(s=>s.totalUnits);
    const max = Math.max(...data);
    const min = Math.min(...data);
    const range = max - min;
    // Smart padding: tighter padding for small ranges
    const padding = range < 100 ? range * 0.25 : range < 500 ? range * 0.2 : range * 0.1;
    yMin = Math.max(0, Math.floor(min - padding));
    yMax = Math.ceil(max + padding);
    yLabel = 'Units';
    datasets.push({ label:'Units', data, borderColor:'#ffd166', backgroundColor:'rgba(255,209,102,.08)', tension:.35, fill:true, pointRadius:5, pointBackgroundColor:'#ffd166', pointBorderColor:'#07090c', pointBorderWidth:2 });
    trend = Math.abs(latest.totalUnits - prev.totalUnits);
    trendDir = latest.totalUnits >= prev.totalUnits ? 'up' : 'down';
    trendColor = trendDir === 'up' ? 'var(--g)' : 'var(--r)';
  } else if (chartMetric === 'asins') {
    const data = snaps.map(s=>s.asins);
    const max = Math.max(...data), min = Math.min(...data);
    const range = max - min || 1;
    const padding = Math.max(range * 0.2, 5);
    yMin = Math.max(0, Math.floor(min - padding));
    yMax = Math.ceil(max + padding);
    yLabel = 'ASINs';
    datasets.push({ label:'ASINs', data, borderColor:'#00f5a0', backgroundColor:'rgba(0,245,160,.08)', tension:.35, fill:true, pointRadius:5, pointBackgroundColor:'#00f5a0', pointBorderColor:'#07090c', pointBorderWidth:2 });
    trend = Math.abs(latest.asins - prev.asins);
    trendDir = latest.asins >= prev.asins ? 'up' : 'down';
    trendColor = trendDir === 'up' ? 'var(--g)' : 'var(--r)';
  } else if (chartMetric === 'skus') {
    const data = snaps.map(s=>s.skus);
    const max = Math.max(...data), min = Math.min(...data);
    const range = max - min || 1;
    const padding = Math.max(range * 0.2, 5);
    yMin = Math.max(0, Math.floor(min - padding));
    yMax = Math.ceil(max + padding);
    yLabel = 'SKUs';
    datasets.push({ label:'SKUs', data, borderColor:'#3d9eff', backgroundColor:'rgba(61,158,255,.08)', tension:.35, fill:true, pointRadius:5, pointBackgroundColor:'#3d9eff', pointBorderColor:'#07090c', pointBorderWidth:2 });
    trend = Math.abs(latest.skus - prev.skus);
    trendDir = latest.skus >= prev.skus ? 'up' : 'down';
    trendColor = trendDir === 'up' ? 'var(--g)' : 'var(--r)';
  } else if (chartMetric === 'winbb') {
    const data = snaps.map(s=>repPct(s,'win'));
    const max = Math.max(...data);
    const min = Math.min(...data);
    const range = max - min || 1;
    // Smart zoom for percentage data - tighter padding
    const padding = range < 2 ? 1.5 : range < 5 ? 1 : 0.5;
    yMin = Math.max(0, min - padding);
    yMax = max + padding; // Don't cap at 100 - let it zoom tight
    yLabel = '% Win BB';
    datasets.push({ label:'Winning BB %', data, borderColor:'#00f5a0', backgroundColor:'rgba(0,245,160,.08)', tension:.35, fill:true, pointRadius:5, pointBackgroundColor:'#00f5a0', pointBorderColor:'#07090c', pointBorderWidth:2 });
    const latestWin = repPct(latest,'win') ?? 0;
    const prevWin = repPct(prev,'win') ?? 0;
    trend = Math.abs(latestWin - prevWin).toFixed(1);
    trendDir = latestWin >= prevWin ? 'up' : 'down';
    trendColor = trendDir === 'up' ? 'var(--g)' : 'var(--r)';
  } else if (chartMetric === 'matchbb') {
    const data = snaps.map(s=>repPct(s,'match'));
    const max = Math.max(...data);
    const min = Math.min(...data);
    const range = max - min || 1;
    // Smart zoom for percentage data - tighter padding
    const padding = range < 2 ? 1.5 : range < 5 ? 1 : 0.5;
    yMin = Math.max(0, min - padding);
    yMax = max + padding; // Don't cap at 100 - let it zoom tight
    yLabel = '% Match BB';
    datasets.push({ label:'Matching BB %', data, borderColor:'#ffd166', backgroundColor:'rgba(255,209,102,.06)', tension:.35, fill:true, pointRadius:5, pointBackgroundColor:'#ffd166', pointBorderColor:'#07090c', pointBorderWidth:2 });
    const latestMatch = repPct(latest,'match') ?? 0;
    const prevMatch = repPct(prev,'match') ?? 0;
    trend = Math.abs(latestMatch - prevMatch).toFixed(1);
    trendDir = latestMatch >= prevMatch ? 'up' : 'down';
    trendColor = trendDir === 'up' ? 'var(--g)' : 'var(--r)';
  } else if (chartMetric === 'stockvalue') {
    const data = snaps.map(s=>s.stockValue||0);
    const max = Math.max(...data);
    const min = Math.min(...data);
    const range = max - min;
    yMin = Math.max(0, Math.floor(min - range * 0.15));
    yMax = Math.ceil(max + range * 0.15);
    yLabel = 'Stock Value (£)';
    datasets.push({ label:'Stock Value', data, borderColor:'#c084fc', backgroundColor:'rgba(192,132,252,.08)', tension:.35, fill:true, pointRadius:5, pointBackgroundColor:'#c084fc', pointBorderColor:'#07090c', pointBorderWidth:2 });
    trend = Math.abs(latest.stockValue - prev.stockValue);
    trendDir = latest.stockValue >= prev.stockValue ? 'up' : 'down';
    trendColor = trendDir === 'up' ? 'var(--g)' : 'var(--r)';
  } else if (chartMetric === 'inboundunits' || chartMetric === 'inboundcost') {
    // Snapshots taken before inbound tracking began plot as null, so Chart.js leaves a gap
    // instead of drawing a fake zero. The line simply starts on the first recorded date.
    const isCost = chartMetric === 'inboundcost';
    const data = snaps.map(s => {
      const v = isCost ? s.inboundValue : s.inboundUnits;
      return v == null ? null : v;
    });
    const known = data.filter(v => v !== null);
    const kMax = known.length ? Math.max(...known) : 0;
    const kMin = known.length ? Math.min(...known) : 0;
    const kRange = (kMax - kMin) || Math.max(kMax * 0.2, isCost ? 100 : 10);
    yMin = Math.max(0, Math.floor(kMin - kRange * 0.2));
    yMax = Math.ceil(kMax + kRange * 0.2) || (isCost ? 1000 : 10);
    yLabel = isCost ? 'Inbound Value (\u00A3)' : 'Inbound Units';
    datasets.push({ label: yLabel, data, borderColor:'#3d9eff', backgroundColor:'rgba(61,158,255,.08)', tension:.35, fill:true, pointRadius:5, pointBackgroundColor:'#3d9eff', pointBorderColor:'#07090c', pointBorderWidth:2, spanGaps:false });
    const lv = isCost ? latest?.inboundValue : latest?.inboundUnits;
    const pv = isCost ? prev?.inboundValue : prev?.inboundUnits;
    if (lv != null && pv != null) {
      trend = Math.abs(lv - pv);
      trendDir = lv >= pv ? 'up' : 'down';
      trendColor = trendDir === 'up' ? 'var(--g)' : 'var(--r)';
    }
  } else if (chartMetric === 'avgcostperunit') {
    const data = snaps.map(s => s.totalUnits > 0 ? parseFloat((s.stockValue / s.totalUnits).toFixed(2)) : 0);
    const max = Math.max(...data);
    const min = Math.min(...data);
    const range = max - min || 1;
    yMin = Math.max(0, min - range * 0.15);
    yMax = max + range * 0.15;
    yLabel = 'Avg Cost/Unit (£)';
    datasets.push({ label:'Avg Cost/Unit', data, borderColor:'#ff8c42', backgroundColor:'rgba(255,140,66,.08)', tension:.35, fill:true, pointRadius:5, pointBackgroundColor:'#ff8c42', pointBorderColor:'#07090c', pointBorderWidth:2 });
    const latestCpu = snaps[snaps.length-1].totalUnits > 0 ? snaps[snaps.length-1].stockValue / snaps[snaps.length-1].totalUnits : 0;
    const prevCpu = snaps[snaps.length-2].totalUnits > 0 ? snaps[snaps.length-2].stockValue / snaps[snaps.length-2].totalUnits : 0;
    trend = Math.abs(latestCpu - prevCpu).toFixed(2);
    trendDir = latestCpu >= prevCpu ? 'up' : 'down';
    trendColor = trendDir === 'up' ? 'var(--r)' : 'var(--g)'; // up = spending more per unit = bad
  } else if (chartMetric === 'agedrisk') {
    // £ first, the same as the Stock Health tile (SKUs where an entry has no £ values)
    const calcFresh90 = (snap) => shBucketTotal(snap) > 0 ? shShare90(snap, shHasValuation(snap) ? 'gbp' : 'sku') : null;
    const data = snaps.map(calcFresh90);
    const max = Math.max(...data);
    const min = Math.min(...data);
    const range = max - min || 1;
    const padding = Math.max(range * 0.25, 1);
    yMin = Math.max(0, parseFloat((min - padding).toFixed(1)));
    yMax = Math.min(100, parseFloat((max + padding).toFixed(1)));
    yLabel = 'Under 90 days %';
    datasets.push({ label:'Under 90 days (by £)', data, borderColor:'#00f5a0', backgroundColor:'rgba(0,245,160,.08)', tension:.35, fill:true, spanGaps:true, pointRadius:5, pointBackgroundColor:'#00f5a0', pointBorderColor:'#07090c', pointBorderWidth:2 });
    const latestFresh = calcFresh90(latest);
    const prevFresh = calcFresh90(prev);
    trend = Math.abs(latestFresh - prevFresh).toFixed(1);
    trendDir = latestFresh > prevFresh ? 'up' : 'down';
    trendColor = trendDir === 'up' ? 'var(--g)' : 'var(--r)'; // up = good (more in healthy window)
  }

  // Add trend badge. Inbound can legitimately produce no trend (nothing recorded yet), and
  // leaving the badge untouched would show the previously selected metric's figure.
  if (trendBadge && trend === null) trendBadge.innerHTML = '';
  if (trendBadge && trend !== null) {
    const arrow = trendDir === 'up' ? '↑' : '↓';
    // The Stock Health line is the share UNDER 90 days, so up is the good direction.
    const label = chartMetric === 'agedrisk' ? (trendDir === 'up' ? 'IMPROVING' : 'WORSENING') : chartMetric === 'avgcostperunit' ? (trendDir === 'up' ? 'RISING' : 'FALLING') : (trendDir === 'up' ? 'UP' : 'DOWN');
    const suffix = (chartMetric.includes('bb') || chartMetric === 'agedrisk') ? 'pp' : '';
    if (chartMetric === 'avgcostperunit') trend = '£' + trend;
    // Branches that build `trend` by subtraction hand over raw floats, which rendered as
    // "UP 1604.0299999999988". Branches that already formatted it pass a string — leave those.
    const trendTxt = typeof trend === 'number'
      ? (Number.isInteger(trend) ? trend.toLocaleString() : trend.toFixed(2))
      : trend;
    trendBadge.innerHTML = `<span style="display:inline-flex;align-items:center;gap:6px;padding:4px 10px;background:${trendColor};color:#07090c;border-radius:3px;font-weight:600;font-size:11px;font-family:var(--mono);">${arrow} ${label} ${trendTxt}${suffix}</span>`;
  }

  // target lines: the Buy Box target on both Buy Box charts, your goal and floor on Stock Health
  const tline = (v, col, lab) => ({ label:lab, data:snaps.map(()=>v), borderColor:col, borderWidth:1.2, borderDash:[6,4], pointRadius:0, fill:false, tension:0 });
  if (chartMetric === 'winbb' || chartMetric === 'matchbb') { datasets.push(tline(BB_TARGET, 'rgba(255,209,102,.8)', `${BB_TARGET}% target`)); yMax = Math.max(yMax, BB_TARGET + 1); }
  if (chartMetric === 'agedrisk') { datasets.push(tline(SH_GOAL, 'rgba(0,245,160,.6)', `goal ${SH_GOAL}%`), tline(SH_FLOOR, 'rgba(255,209,102,.7)', `floor ${SH_FLOOR}%`)); yMin = Math.min(yMin, SH_FLOOR - 2); yMax = Math.max(yMax, SH_GOAL + 2); }
  const opts = chartOpts();
  const nice = niceAxis(yMin, yMax);
  if (chartMetric === 'agedrisk' || chartMetric.includes('bb')) nice.max = Math.min(100, nice.max);
  yMin = nice.min; yMax = nice.max;
  opts.scales.y.beginAtZero = false;
  opts.scales.y.min = yMin;
  opts.scales.y.max = yMax;
  opts.scales.y.ticks.stepSize = nice.step;
  opts.scales.y.ticks.callback = v => Number(v).toLocaleString();
  delete opts.scales.y.ticks.min;
  delete opts.scales.y.ticks.max;
  if (chartMetric.includes('bb') || chartMetric === 'agedrisk') {
    opts.scales.y.ticks.callback = v => v + '%';
  } else if (chartMetric === 'stockvalue') {
    opts.scales.y.ticks.callback = v => fmtGBP(v);
  } else if (chartMetric === 'avgcostperunit') {
    opts.scales.y.ticks.callback = v => '£' + v.toFixed(2);
  } else if (chartMetric === 'inboundcost') {
    opts.scales.y.ticks.callback = v => fmtGBP(v);
  }

  chartInstances.overviewChart = new Chart(ctx, {
    type:'line',
    data:{
      labels: snaps.map(s => fmtShort(s.date)),
      datasets
    },
    options: opts
  });
  
  // Generate detailed analysis below chart
  const analysis = document.getElementById('chartAnalysis');
  if (!analysis) return;
  
  // compare against every entry, not just the range on screen (the 30-day and month-to-date
  // blocks never appeared on the default Last 30d view)
  const comparisons = getComparisonSnapshots(shAllSnaps());
  let analysisHtml = tidyAnalysis(generateMetricAnalysis(chartMetric, comparisons, shAllSnaps()));
  // Metrics without a written analysis (ASINs, Avg Cost/Unit, both inbound series) used to
  // claim "Add more snapshots" — untrue with 58 of them. Hide the panel instead of showing
  // either a false sentence or an empty grey slab.
  analysis.innerHTML = analysisHtml || '';
  analysis.style.display = analysisHtml ? '' : 'none';
  // Four long paragraphs under the chart: the first (vs your last entry) stays, the longer views fold
  // away behind one button so the page isn't a wall of text.
  const extra = [...analysis.children].slice(1);
  if (extra.length) {
    const open = window._ovAnalysisOpen === true;
    extra.forEach(el => { el.style.display = open ? '' : 'none'; });
    const b = document.createElement('button');
    b.className = 'cmp-chip'; b.style.marginTop = '10px';
    b.textContent = open ? 'Show less' : `+ ${extra.length} longer views (8 days, month to date, 30 days)`;
    b.onclick = () => { window._ovAnalysisOpen = !open; renderOverviewChart(filteredSnaps()); };
    analysis.appendChild(b);
  }
}

// The analysis text was built from fragments with no space between sentences ("4,273 unitsStock
// value fell…") and money with pennies. Tidy both on the way out.
function tidyAnalysis(html){
  if (!html) return html;
  // only touch the text between tags, never the tags themselves
  return html.replace(/>([^<]+)</g, (m, t) => '>' + t
      .replace(/[📊📈📉🔴🟠🟡]\s*/gu, '')
      .replace(/([a-z%)\d])([A-Z])/g, '$1. $2')       // "unitsStock value" → "units. Stock value"
      .replace(/\)(\d)/g, '). $1')                         // "(-1.1%)30-day" → "(-1.1%). 30-day"
      .replace(/£(\d{1,3}(?:,\d{3})+|\d{3,})\.\d{1,2}(?!\d)/g, (q, w) => fmtGBP(Math.round(parseFloat(q.slice(1).replace(/,/g, '')))))   // money ≥ £100 in whole pounds; £27.61 keeps its pence
    + '<')
    .replace(/<\/strong>(?=[A-Z])/g, '</strong>. ')
    // "£29.66<strong>Key insight" ran together: the sentence before a bold heading needs its full stop
    .replace(/([^\s>.:])(<strong>)/g, '$1. $2').replace(/\.(<strong>)/g, '. $1');
}
function generateMetricAnalysis(metric, comps, allSnaps) {
  if (!comps.current) return '';
  
  const curr = comps.current;
  const prev = allSnaps[allSnaps.length - 2] || null;
  
  let html = '';
  
  if (metric === 'units') {
    const currVal = curr.totalUnits || 0;
    const prevVal = prev?.totalUnits || 0;
    const eightVal = comps.eightDaysAgo?.totalUnits || 0;
    const monthVal = comps.monthStart?.totalUnits || 0;
    const thirtyVal = comps.thirtyDaysAgo?.totalUnits || 0;
    
    const diffPrev = currVal - prevVal;
    const pctPrev = prevVal > 0 ? ((diffPrev / prevVal) * 100).toFixed(1) : 0;
    const arrow1 = diffPrev > 0 ? '↑' : diffPrev < 0 ? '↓' : '→';
    const color1 = diffPrev > 0 ? 'var(--g)' : diffPrev < 0 ? 'var(--r)' : 'var(--muted2)';
    
    html += `<div style="margin-bottom:16px"><strong style="color:${color1}">${arrow1} Units ${diffPrev > 0 ? '+' : ''}${diffPrev} (${pctPrev}%)</strong><br>`;
    html += `Compared to your last snapshot (${fmt(prev?.date || 'N/A')}), units have ${diffPrev > 0 ? 'grown' : diffPrev < 0 ? 'declined' : 'remained steady'} by ${Math.abs(diffPrev)} units. You're currently holding <strong>${currVal.toLocaleString()} units</strong>`;
    
    if (curr.stockValue && prev?.stockValue) {
      const svDiff = curr.stockValue - prev.stockValue;
      const avgPrice = prevVal > 0 ? prev.stockValue / prevVal : 0;
      const avgPriceNew = currVal > 0 ? curr.stockValue / currVal : 0;
      const priceDiff = avgPriceNew - avgPrice;
      html += `Stock value ${svDiff > 0 ? 'rose' : 'fell'} by £${Math.abs(svDiff).toLocaleString()}, with average unit price shifting from £${avgPrice.toFixed(2)} to £${avgPriceNew.toFixed(2)}`;
      
      if (diffPrev < 0 && svDiff > 0) {
        html += `<strong>Key insight:</strong> Units fell ${Math.abs(diffPrev)} while stock value rose, so the mix moved towards dearer lines (stock landing from inbound moves this too).`;
      } else if (diffPrev > 0 && svDiff > 0 && avgPriceNew > avgPrice) {
        html += `<strong>Key insight:</strong> Units, value and the average cost all rose — you are buying more, and dearer, stock. Watch cash flow.`;
      } else if (diffPrev < 0 && svDiff < 0) {
        html += `<strong>Key insight:</strong> Units and value both fell — stock is selling faster than it is being replaced.`;
      }
    }
    html += `</div>`;
    
    // 8+ days comparison
    if (comps.eightDaysAgo && comps.eightDaysAgo !== curr) {
      const diffEight = currVal - eightVal;
      const pctEight = eightVal > 0 ? ((diffEight / eightVal) * 100).toFixed(1) : 0;
      const daysLabel = comps.eightDaysAgo?.date ? `since ${fmt(comps.eightDaysAgo.date)}` : 'in recent period';
      
      html += `<div style="margin-bottom:16px"><strong style="color:var(--muted2)">📊 Over the past 8+ days (${daysLabel}):</strong><br>`;
      html += `Units have ${diffEight > 0 ? 'grown' : diffEight < 0 ? 'declined' : 'remained flat'} by ${Math.abs(diffEight)} units (${pctEight}%)`;
      
      if (curr.stockValue && comps.eightDaysAgo.stockValue) {
        const svEight = curr.stockValue - comps.eightDaysAgo.stockValue;
        const pctSVEight = comps.eightDaysAgo.stockValue > 0 ? ((svEight / comps.eightDaysAgo.stockValue) * 100).toFixed(1) : 0;
        html += `Stock value has ${svEight > 0 ? 'increased' : 'decreased'} by £${Math.abs(svEight).toLocaleString()} (${pctSVEight}%)`;
        
        if (diffEight < 0 && svEight > 0) {
          html += `Strong sell-through: You've sold ${Math.abs(diffEight)} units while restocking with higher-value products. You're converting low-margin inventory into cash while building premium stock — excellent business velocity.`;
        } else if (diffEight > 0 && svEight > 0) {
          html += `Aggressive restocking: Both units and value are growing. Your inventory is expanding faster than sales. Ensure this purchasing pace is sustainable and aligns with demand forecasts.`;
        } else if (diffEight < 0 && svEight < 0) {
          html += `Net inventory reduction: Both units and value declined. Strong sell-through indicates good product-market fit. Watch for potential stockouts on fast movers.`;
        } else if (diffEight > 0 && svEight < 0) {
          html += `Inventory mix shift: More units but lower total value suggests you're stocking cheaper items or clearing out premium inventory.`;
        }
      }
      html += `</div>`;
    }
    
    // Month-start comparison (if available and 8+ days away)
    if (comps.monthStart && comps.monthStart !== curr && comps.monthStart !== comps.eightDaysAgo) {
      const monthVal = comps.monthStart?.totalUnits || 0;
      const diffMonth = currVal - monthVal;
      const pctMonth = monthVal > 0 ? ((diffMonth / monthVal) * 100).toFixed(1) : 0;
      const daysDiff = Math.floor((new Date(curr.date) - new Date(comps.monthStart.date)) / (1000 * 60 * 60 * 24));
      
      html += `<div style="margin-bottom:16px"><strong style="color:var(--muted2)">📅 Month-to-Date (${fmt(comps.monthStart?.date || 'N/A')} → Today, ${daysDiff} days)</strong><br>`;
      html += `Units have ${diffMonth > 0 ? 'grown' : diffMonth < 0 ? 'declined' : 'remained steady'} by ${Math.abs(diffMonth)} (${pctMonth}%) since the start of the month`;
      
      if (curr.stockValue && comps.monthStart.stockValue) {
        const svMonth = curr.stockValue - comps.monthStart.stockValue;
        const pctSVMonth = comps.monthStart.stockValue > 0 ? ((svMonth / comps.monthStart.stockValue) * 100).toFixed(1) : 0;
        const avgPriceMonth = monthVal > 0 ? comps.monthStart.stockValue / monthVal : 0;
        const avgPriceCurr = currVal > 0 ? curr.stockValue / currVal : 0;
        
        html += `Stock value has ${svMonth > 0 ? 'increased' : 'decreased'} by £${Math.abs(svMonth).toLocaleString()} (${pctSVMonth}%). Average unit price shifted from £${avgPriceMonth.toFixed(2)} to £${avgPriceCurr.toFixed(2)}`;
        
        if (diffMonth < 0 && svMonth > 0) {
          html += `<strong>Month narrative:</strong> You've maintained strong sales velocity — sold ${Math.abs(diffMonth)} units — while upgrading your inventory mix to higher-value items. This is ideal: converting low-margin inventory to cash while building high-margin stock for future sales.`;
        } else if (diffMonth > 0 && svMonth > 0) {
          html += `<strong>Month narrative:</strong> Month-long growth in both units and value shows aggressive inventory building. Verify your sales are growing proportionally to support this expansion pace and ensure cash flow remains healthy.`;
        } else if (diffMonth < 0 && svMonth < 0) {
          html += `<strong>Month narrative:</strong> Net inventory reduction across the month indicates strong sell-through. You're moving stock faster than restocking, which is healthy if demand remains steady throughout the month.`;
        } else if (diffMonth > 0 && svMonth < 0) {
          html += `<strong>Month narrative:</strong> More units but lower total value suggests inventory mix shift — you're stocking cheaper items or clearing premium products. Verify this aligns with your sourcing strategy.`;
        }
      }
      html += `</div>`;
    }
    
    // 30-day comparison (if available)
    if (comps.thirtyDaysAgo && comps.thirtyDaysAgo !== curr) {
      const thirtyVal = comps.thirtyDaysAgo?.totalUnits || 0;
      const diffThirty = currVal - thirtyVal;
      const pctThirty = thirtyVal > 0 ? ((diffThirty / thirtyVal) * 100).toFixed(1) : 0;
      
      html += `<div style="margin-bottom:16px"><strong style="color:var(--muted2)">📈 Last 30 Days (${fmt(comps.thirtyDaysAgo?.date || 'N/A')} → Today)</strong><br>`;
      html += `Over the full 30-day window, units have ${diffThirty > 0 ? 'grown' : diffThirty < 0 ? 'declined' : 'remained flat'} by ${Math.abs(diffThirty)} (${pctThirty}%)`;
      
      if (curr.stockValue && comps.thirtyDaysAgo.stockValue) {
        const svThirty = curr.stockValue - comps.thirtyDaysAgo.stockValue;
        const pctSVThirty = comps.thirtyDaysAgo.stockValue > 0 ? ((svThirty / comps.thirtyDaysAgo.stockValue) * 100).toFixed(1) : 0;
        
        html += `Total inventory value has ${svThirty > 0 ? 'increased' : 'decreased'} by £${Math.abs(svThirty).toLocaleString()} (${pctSVThirty}%)`;
        
        if (Math.abs(diffThirty) < 50) {
          html += `<strong>30-day picture:</strong> Inventory is remarkably balanced. You're buying and selling at nearly the same pace, indicating mature, steady-state operations. This stability is excellent for cash flow planning.`;
        } else if (diffThirty < -100) {
          html += `<strong>30-day picture:</strong> Significant inventory reduction over 30 days shows strong sell-through momentum. You're converting stock to cash efficiently. Ensure you're restocking fast enough to meet ongoing demand without stockouts.`;
        } else if (diffThirty > 100) {
          html += `<strong>30-day picture:</strong> Substantial inventory growth indicates aggressive expansion. Monitor this purchasing pace carefully — ensure sales growth matches this inventory investment for healthy ROI.`;
        }
      }
      html += `</div>`;
    }
  
  } else if (metric === 'skus') {
    const currVal = curr.skus || 0;
    const prevVal = prev?.skus || 0;
    const diffPrev = currVal - prevVal;
    const pctPrev = prevVal > 0 ? ((diffPrev / prevVal) * 100).toFixed(1) : 0;
    const arrow1 = diffPrev > 0 ? '↑' : diffPrev < 0 ? '↓' : '→';
    const color1 = diffPrev > 0 ? 'var(--g)' : diffPrev < 0 ? 'var(--r)' : 'var(--muted2)';
    
    html += `<div style="margin-bottom:16px"><strong style="color:${color1}">${arrow1} SKUs ${diffPrev > 0 ? '+' : ''}${diffPrev}</strong><br>`;
    html += `Compared to your last snapshot (${fmt(prev?.date || 'N/A')}), you've ${diffPrev > 0 ? 'added' : diffPrev < 0 ? 'removed' : 'maintained'} ${Math.abs(diffPrev)} SKU variants`;
    html += `You now have ${currVal} total SKUs in your catalogue`;
    html += `${diffPrev > 0 ? 'More SKUs expand your product range and search visibility.' : diffPrev < 0 ? 'Fewer SKUs indicate consolidation or product removal.' : 'Your SKU count remains consistent.'}`;
    html += `</div>`;
    
    if (comps.eightDaysAgo && comps.eightDaysAgo !== curr) {
      const diffEight = currVal - comps.eightDaysAgo.skus;
      const pctEight = comps.eightDaysAgo.skus > 0 ? ((diffEight / comps.eightDaysAgo.skus) * 100).toFixed(1) : 0;
      
      html += `<div style="margin-bottom:16px"><strong style="color:var(--muted2)">Over the past 8+ days (since ${fmt(comps.eightDaysAgo?.date || 'N/A')}):</strong><br>`;
      html += `SKU count has ${diffEight > 0 ? 'grown' : diffEight < 0 ? 'shrunk' : 'stayed flat'} by ${Math.abs(diffEight)} variants (${pctEight}%)`;
      html += `${diffEight > 0 ? 'Sustained SKU growth suggests active sourcing and product expansion.' : diffEight < 0 ? 'SKU reduction could indicate pruning underperformers.' : 'Stable SKU count shows consistent product range.'}`;
      html += `</div>`;
    }
    
    // Month-start comparison
    if (comps.monthStart && comps.monthStart !== curr && comps.monthStart !== comps.eightDaysAgo) {
      const diffMonth = currVal - comps.monthStart.skus;
      const pctMonth = comps.monthStart.skus > 0 ? ((diffMonth / comps.monthStart.skus) * 100).toFixed(1) : 0;
      
      html += `<div style="margin-bottom:16px"><strong style="color:var(--muted2)">Since the 1st of the month (${fmt(comps.monthStart?.date || 'N/A')}):</strong><br>`;
      html += `SKU count has ${diffMonth > 0 ? 'expanded' : diffMonth < 0 ? 'contracted' : 'remained stable'} by ${Math.abs(diffMonth)} variants (${pctMonth}%)`;
      html += `${diffMonth > 0 ? 'Month-long growth indicates consistent product development and catalog expansion.' : diffMonth < 0 ? 'SKU consolidation suggests you\'re focusing on core products.' : 'Static SKU count shows disciplined product management.'}`;
      html += `</div>`;
    }
    
    // 30-day comparison
    if (comps.thirtyDaysAgo && comps.thirtyDaysAgo !== curr) {
      const diffThirty = currVal - comps.thirtyDaysAgo.skus;
      const pctThirty = comps.thirtyDaysAgo.skus > 0 ? ((diffThirty / comps.thirtyDaysAgo.skus) * 100).toFixed(1) : 0;
      
      html += `<div style="margin-bottom:16px"><strong style="color:var(--muted2)">Last 30 days (${fmt(comps.thirtyDaysAgo?.date || 'N/A')} → Today):</strong><br>`;
      html += `SKU catalog has ${diffThirty > 0 ? 'grown' : diffThirty < 0 ? 'shrunk' : 'remained steady'} by ${Math.abs(diffThirty)} variants (${pctThirty}%) over the past month`;
      html += `${Math.abs(diffThirty) > 20 ? 'This significant ' : 'This modest '} ${diffThirty > 0 ? 'expansion' : 'reduction'} over 30 days shows your sourcing and product selection strategy.`;
      html += `</div>`;
    }
    
  } else if (metric === 'stockvalue') {
    const currVal = curr.stockValue || 0;
    const prevVal = prev?.stockValue || 0;
    const diffPrev = currVal - prevVal;
    const pctPrev = prevVal > 0 ? ((diffPrev / prevVal) * 100).toFixed(1) : 0;
    const arrow1 = diffPrev > 0 ? '↑' : diffPrev < 0 ? '↓' : '→';
    const color1 = diffPrev > 0 ? 'var(--g)' : diffPrev < 0 ? 'var(--r)' : 'var(--muted2)';
    
    html += `<div style="margin-bottom:16px"><strong style="color:${color1}">${arrow1} Stock Value ${diffPrev > 0 ? '+' : '-'}${fmtGBPAbs(diffPrev)} (${pctPrev}%)</strong><br>`;
    html += `Compared to ${fmt(prev?.date || 'N/A')}, your inventory value has ${diffPrev > 0 ? 'increased' : diffPrev < 0 ? 'decreased' : 'remained flat'} by £${Math.abs(diffPrev).toLocaleString()}.`;
    
    if (curr.totalUnits && prev?.totalUnits) {
      const avgPricePrev = prevVal / prev.totalUnits;
      const avgPriceCurr = currVal / curr.totalUnits;
      html += ` Average unit value shifted from £${avgPricePrev.toFixed(2)} to £${avgPriceCurr.toFixed(2)}`;
      if (avgPriceCurr > avgPricePrev) {
        html += `You're restocking with higher-value (mid/high-ticket) items.`;
      } else {
        html += `You're moving premium inventory while restocking with lower-value items.`;
      }
    }
    html += `</div>`;
    
    if (comps.eightDaysAgo && comps.eightDaysAgo !== curr) {
      const diffEight = currVal - (comps.eightDaysAgo?.stockValue || 0);
      const pctEight = (comps.eightDaysAgo?.stockValue || 0) > 0 ? ((diffEight / (comps.eightDaysAgo.stockValue || 1)) * 100).toFixed(1) : 0;
      
      html += `<div style="margin-bottom:16px"><strong style="color:var(--muted2)">Over the past 8+ days (since ${fmt(comps.eightDaysAgo?.date || 'N/A')}):</strong><br>`;
      html += `Stock value has ${diffEight > 0 ? 'grown' : diffEight < 0 ? 'declined' : 'remained steady'} by £${Math.abs(diffEight).toLocaleString()} (${pctEight}%)`;
      
      if (curr.totalUnits && comps.eightDaysAgo?.totalUnits) {
        const unitsDiff = curr.totalUnits - comps.eightDaysAgo.totalUnits;
        if (diffEight > 0 && unitsDiff > 0) {
          html += `Both units and value are up — you're aggressively restocking.`;
        } else if (diffEight > 0 && unitsDiff < 0) {
          html += `Value up but units down — you're selling lower-ticket items and restocking premium products.`;
        } else if (diffEight < 0 && unitsDiff < 0) {
          html += `Both down — you're achieving good sell-through. Inventory is turning over faster than restocking.`;
        } else if (diffEight < 0 && unitsDiff > 0) {
          html += `Units up but value down — you're holding more lower-ticket inventory.`;
        }
      }
      html += `</div>`;
    }
    
    // Month-start comparison
    if (comps.monthStart && comps.monthStart !== curr && comps.monthStart !== comps.eightDaysAgo) {
      const monthVal = comps.monthStart?.stockValue || 0;
      const diffMonth = currVal - monthVal;
      const pctMonth = monthVal > 0 ? ((diffMonth / monthVal) * 100).toFixed(1) : 0;
      
      html += `<div style="margin-bottom:16px"><strong style="color:var(--muted2)">Since the 1st of the month (${fmt(comps.monthStart?.date || 'N/A')}):</strong><br>`;
      html += `Inventory value has ${diffMonth > 0 ? 'increased' : diffMonth < 0 ? 'decreased' : 'remained flat'} by £${Math.abs(diffMonth).toLocaleString()} (${pctMonth}%)`;
      
      if (curr.totalUnits && comps.monthStart?.totalUnits) {
        const unitsDiff = curr.totalUnits - comps.monthStart.totalUnits;
        const avgPriceMonth = comps.monthStart.totalUnits > 0 ? monthVal / comps.monthStart.totalUnits : 0;
        const avgPriceCurr = curr.totalUnits > 0 ? currVal / curr.totalUnits : 0;
        html += `Average unit value has ${avgPriceCurr > avgPriceMonth ? 'increased' : 'decreased'} from £${avgPriceMonth.toFixed(2)} to £${avgPriceCurr.toFixed(2)}`;
        html += `${unitsDiff < 0 && diffMonth < 0 ? 'Strong sell-through with balanced restocking.' : unitsDiff > 0 && diffMonth > 0 ? 'Aggressive inventory build throughout the month.' : 'Mixed pattern of restocking and sales.'}`;
      }
      html += `</div>`;
    }
    
    // 30-day comparison
    if (comps.thirtyDaysAgo && comps.thirtyDaysAgo !== curr) {
      const thirtyVal = comps.thirtyDaysAgo?.stockValue || 0;
      const diffThirty = currVal - thirtyVal;
      const pctThirty = thirtyVal > 0 ? ((diffThirty / thirtyVal) * 100).toFixed(1) : 0;
      
      html += `<div style="margin-bottom:16px"><strong style="color:var(--muted2)">Last 30 days (${fmt(comps.thirtyDaysAgo?.date || 'N/A')} → Today):</strong><br>`;
      html += `Stock value has ${diffThirty > 0 ? 'grown' : diffThirty < 0 ? 'declined' : 'remained steady'} by £${Math.abs(diffThirty).toLocaleString()} (${pctThirty}%) over the past month`;
      
      if (curr.totalUnits && comps.thirtyDaysAgo?.totalUnits) {
        const unitsDiff = curr.totalUnits - comps.thirtyDaysAgo.totalUnits;
        const avgPrice30 = comps.thirtyDaysAgo.totalUnits > 0 ? thirtyVal / comps.thirtyDaysAgo.totalUnits : 0;
        const avgPriceCurr = curr.totalUnits > 0 ? currVal / curr.totalUnits : 0;
        html += `Average unit value changed from £${avgPrice30.toFixed(2)} to £${avgPriceCurr.toFixed(2)}`;
        html += `Over 30 days, this reflects your overall sourcing mix and sell-through velocity on different product tiers.`;
      }
      html += `</div>`;
    }
    
  } else if (metric === 'winbb') {
    const currVal = repPct(curr,'win') ?? 0;
    const prevVal = repPct(prev,'win') ?? 0;
    const diffPrev = currVal - prevVal;
    const arrow1 = diffPrev > 0 ? '↑' : diffPrev < 0 ? '↓' : '→';
    const color1 = diffPrev > 0 ? 'var(--g)' : diffPrev < 0 ? 'var(--r)' : 'var(--muted2)';
    
    html += `<div style="margin-bottom:16px"><strong style="color:${color1}">${arrow1} Win Rate ${diffPrev > 0 ? '+' : ''}${diffPrev.toFixed(1)}pp</strong><br>`;
    html += `Compared to ${fmt(prev?.date || 'N/A')}, your buy box win rate has ${diffPrev > 0 ? 'improved' : diffPrev < 0 ? 'declined' : 'remained flat'} to ${currVal.toFixed(1)}%`;
    if (currVal < BB_TARGET) html += `At ${currVal.toFixed(1)}%, you're below your ${BB_TARGET}% target`;
    else html += `At ${currVal.toFixed(1)}%, you're at or above your ${BB_TARGET}% target`;
    html += `</div>`;
    
    if (comps.eightDaysAgo && comps.eightDaysAgo !== curr) {
      const diffEight = currVal - (repPct(comps.eightDaysAgo,'win') ?? 0);
      html += `<div><strong style="color:var(--muted2)">Over the past 8+ days:</strong><br>`;
      html += `Win rate has ${diffEight > 0 ? 'improved' : diffEight < 0 ? 'declined' : 'remained stable'} by ${Math.abs(diffEight).toFixed(1)}pp. ${diffEight > 0 ? 'Your repricing strategy is becoming more competitive.' : diffEight < 0 ? 'Competitors may be adjusting prices or your floor prices need review.' : 'Your competitive position is consistent.'}`;
      html += `</div>`;
    }
    
  } else if (metric === 'matchbb') {
    const currVal = repPct(curr,'match') ?? 0;
    const prevVal = repPct(prev,'match') ?? 0;
    const diffPrev = currVal - prevVal;
    const arrow1 = diffPrev > 0 ? '↑' : diffPrev < 0 ? '↓' : '→';
    const color1 = diffPrev > 0 ? 'var(--g)' : diffPrev < 0 ? 'var(--r)' : 'var(--muted2)';
    
    html += `<div style="margin-bottom:16px"><strong style="color:${color1}">${arrow1} Match Rate ${diffPrev > 0 ? '+' : ''}${diffPrev.toFixed(1)}pp</strong><br>`;
    html += `Compared to ${fmt(prev?.date || 'N/A')}, your buy box match rate has ${diffPrev > 0 ? 'improved' : diffPrev < 0 ? 'declined' : 'remained flat'} to ${currVal.toFixed(1)}%`;
    if (repPct(curr,'win') != null) {
      const combined = currVal + repPct(curr,'win');
      html += `Combined with your ${repPct(curr,'win').toFixed(1)}% win rate, your total buy box coverage is ${combined.toFixed(1)}%`;
    }
    html += `</div>`;
    
    if (comps.eightDaysAgo && comps.eightDaysAgo !== curr) {
      const diffEight = currVal - (repPct(comps.eightDaysAgo,'match') ?? 0);
      html += `<div><strong style="color:var(--muted2)">Over the past 8+ days:</strong><br>`;
      html += `Match rate has ${diffEight > 0 ? 'improved' : diffEight < 0 ? 'declined' : 'remained stable'} by ${Math.abs(diffEight).toFixed(1)}pp to ${currVal.toFixed(1)}%. This is your defensive position when you can't win.`;
      html += `</div>`;
    }
    
  } else if (metric === 'agedrisk') {
    // The same verdict, wording and numbers as the Stock Health page (it used to describe a
    // different measure — the 181+ share — and called SKUs "units").
    const V = typeof shVerdict === 'function' ? shVerdict() : null;
    const z = shZones(curr), zv = shHasValuation(curr) ? shZoneValues(curr) : null;
    const share = shShare90(curr, zv ? 'gbp' : 'sku');
    if (V) {
      const [g, word, col] = SH_VMAP[V.v];
      html += `<div style="margin-bottom:16px"><strong style="color:${col}">${g} ${word.charAt(0) + word.slice(1).toLowerCase()} · 2 weeks</strong><br>`;
      html += `${V.why ? V.why + '. ' : ''}${kfEsc(shVerdictTitle(V))}.</div>`;
    }
    html += `<div><strong style="color:var(--muted2)">Now:</strong><br>${share.toFixed(1)}% of your stock ${zv ? 'value' : '(SKUs)'} is under 90 days old (goal ${SH_GOAL}%, floor ${SH_FLOOR}%).`
      + (zv ? ` ${fmtGBP(zv.caution + zv.action)} is past 90 days (${(z.caution + z.action).toLocaleString()} SKUs) and ${fmtGBP(zv.action)} is past your 180-day limit (${z.action.toLocaleString()} SKUs).` : ` ${z.action.toLocaleString()} SKUs are past 180 days.`)
      + `</div>`;
  }
  
  return html;
}
