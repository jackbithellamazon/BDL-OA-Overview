BDL OA Overview v67 — how to put it live (it is a FOLDER now, not one file)

UPDATED 11 Nov (v67ad) — PUSH AS SOON AS YOU CAN (the token audit week started at midnight, and until this is
  live OA still uses the old bdl-sourcing address, so its calls are invisible in the audit):
  Repricer checks also feed the shared Keepa cache, so other apps get your own ASINs free (needs the Keepa chat's
  cache SQL + keepa v4.4 — nothing breaks without them); rivals' new-line details read the cache first; the Keepa
  token box reads the Worker's free 5-minute log; token estimates use the real measured cost (about 11 a product).
UPDATED 10 Nov (v67ac): selling-fine products are checked like the rest (only under-30-day and checked-in-the-last-day are skipped).
UPDATED 10 Nov (v67ab): Repricer list in STK order (newest → oldest), switchable.
UPDATED 10 Nov (v67aa): stock under 30 days isn't checked unless you press Check on it.
UPDATED 10 Nov (v67y): a Repricer check skips anything checked in the last day (saves ~1,600 tokens a full pass).
UPDATED 10 Nov (v67x): plain-0 font across the app; Repricer strip shows how fresh each thing is + live Keepa tokens.
UPDATED 10 Nov (v67u): 'What I'd do' plan per product through Black Friday + Christmas, smaller graph, plain-0 font.
UPDATED 10 Nov (v67q): Repricer tool first on the page, finished products fold away, progress bar, J/K keys.
UPDATED 10 Nov (v67o): Keepa-style graph (Amazon area, sales rank, your target, hover any day), provider tiles,
  Lavarion + your own bundles left out of the Repricer.
UPDATED 10 Nov (v67k): the Repricer is back to the 15 Oct demo layout — one card per product with the big
  graph, what the last year says, the buy / why it hasn't sold / the queue, then the SKUs. Same steps, same SQL.

UPDATED 9 Nov (v67j):
  The Keepa calls (manual Fetch from Keepa + Repricer) now go to the keepa Worker's /src address,
  because bdl-sourcing is being merged into it and then deleted. Every Keepa call also says app=oa,
  so the 7-day token audit (11-17 Nov) can see what OA Numbers spends. Nothing else changed.
  Once bdl-sourcing is deleted, the OLD live site (v60) would get an error on Fetch from Keepa — so this push matters.


BEFORE (once): run "OA-Overview - RUN IN SUPABASE - repricer tool 2026-10-23.sql" in Supabase → SQL editor.
               It should return three table names. (Without it the Repricer tool works but forgets on reload.)

1. Open the GitHub repo BDL-OA-Overview → Add file → Upload files.
2. Drag in EVERYTHING inside this folder: index.html, the css folder and the js folder
   (select all three in Finder and drag them together — GitHub keeps the folders).
3. Commit. GitHub Pages updates the same address within a minute or two.
4. Open the app → Provider → press "Remove them" on the yellow banner (the 3 leftover dates).
5. Repricer page → "Jack: unlock" → type  lavarion  → this laptop can now press "Check <provider>"
   and record calls. Sarah sees everything but can't spend Keepa tokens or record calls.
6. Sarah: from now on, with the ageing file, also download SellerToolKit → Reports → Repricer Settings
   and drop it in the new "Repricer settings" box in Add Snapshot.

This replaces the live version (v60, 13 Oct) and has everything since in it.
Updated 28 Oct evening with the repricer changes from Jack's answers — same steps, same SQL.
Updated 8 Nov (v67i): a page left open since before the 2am competitor fetch reloads itself before
"Fetch from Keepa" or "Enter manually", so it can never save over the 2am numbers.
Rollback: GitHub → index.html → History → open the 13 Oct version → download it → upload it the same way.
js/testmode.js only does anything on Jack's computer (localhost); on the live site it switches itself off.
