/* TEST MODE — only on this computer (localhost / 127.0.0.1). On the live site this file does nothing.
   Every Supabase write and every Keepa call is refused, so clicking around can never change real data
   or spend tokens. Reads still come from the real database, so the numbers are the real ones.
   ?live=1 turns test mode off (never needed day to day). ?tab=stockhealth opens that page once loaded. */
(function(){
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const q = new URLSearchParams(location.search);
  window.OA_TEST = local && q.get('live') !== '1';
  if (!window.OA_TEST) return;
  const f = window.fetch.bind(window);
  window.__blocked = [];
  window.fetch = function(u, o){
    const url = String((u && u.url) || u), m = ((o && o.method) || (u && u.method) || 'GET').toUpperCase();
    if ((/supabase\.co/.test(url) && m !== 'GET' && m !== 'HEAD') || (/workers\.dev/.test(url) && !(m === 'GET' && /workers\.dev(\/src)?\/health(\?|$)/.test(url)))) {   // the free token-balance check is let through
      window.__blocked.push(m + ' ' + url.split('?')[0]);
      return Promise.reject(new Error('Test mode: nothing is saved and Keepa is not called'));
    }
    return f(u, o);
  };
  window.addEventListener('DOMContentLoaded', () => {
    const b = document.createElement('div');
    b.id = 'testModeBar';
    b.textContent = 'TEST MODE — this copy runs on your computer only. Nothing is saved and Keepa is never called.';
    b.style.cssText = 'position:fixed;left:50%;bottom:10px;transform:translateX(-50%);z-index:99999;background:#ffd166;color:#07090c;font:600 12px Inter,system-ui,sans-serif;padding:6px 14px;border-radius:999px;box-shadow:0 4px 18px rgba(0,0,0,.4);pointer-events:none';
    document.body.appendChild(b);
  });
  // ?shots=1: no chart animation, so headless screenshots catch finished charts
  if (q.get('shots')) window.addEventListener('DOMContentLoaded', () => { if (window.Chart) Chart.defaults.animation = false; });
  // ?rp=THC&open=ASIN: screenshot the Repricer tool with saved test data (never Keepa)
  if (q.get('rp')) window.addEventListener('load', () => setTimeout(async () => {
    try {
      localStorage.setItem('oaRepricerUnlocked', '1');
      const t = await fetch('fixtures/stk-settings.txt').then(r => r.ok ? r.text() : null);
      if (t) await rpImportSettings(new File([t], 'stk.txt'));
      for (const p of q.get('rp').split(',')) { RP.prov = p; await rpCheckProvider(p); }
      // &prev=ASIN,ASIN: pretend each had an older check four days ago (Buy Box 25% higher, 6 fewer FBA sellers) to show "what changed"
      if (q.get('prev')) q.get('prev').split(',').forEach(a => { const x = RP.data[a]; if (!x) return; const f = rpFbaStats(x.data);
        x.data.prev = { checked:new Date(Date.now() - 4 * 864e5).toISOString(), bb:x.data.bbNow ? +(x.data.bbNow * 1.25).toFixed(2) : null, amzBB:false, fbaN:Math.max(0, f.n - 6), fbaUnits:Math.max(0, f.units - 20), offers:null, kind:'wait', price:null }; });
      RP.prov = q.get('rp').split(',').pop(); RP.filter = q.get('f') || 'all'; RP.open = q.get('open') || null; renderRepTool();
      if (document.getElementById('tab-stockhealth')?.classList.contains('active')) { if (q.get('sp')) { SH_PROV_TAB = 'prov'; SH_PROV_OPEN = q.get('sp'); } renderStockHealth(); document.getElementById(q.get('sp') ? 'shProvWrap' : 'tab-stockhealth')?.scrollIntoView({ block:'start' }); return; }
      document.getElementById('repTool')?.scrollIntoView({ block:'start' });
    } catch (e) { console.error(e); }
  }, 8000));
  const tab = q.get('tab');
  if (tab) window.addEventListener('load', () => setTimeout(() => {
    const nav = [...document.querySelectorAll('.nav-item')].find(n => (n.getAttribute('onclick') || '').includes("'" + tab + "'"));
    try { switchTab(tab, nav); } catch (e) { console.error(e); }
  }, 6000));
})();
