BDL OA Overview v67 — how to put it live (it is a FOLDER now, not one file)

UPDATED 18 Nov (v67ah) — v67ag IS LIVE; this is a small update on top. NO SQL — just upload index.html, css and js
  (same way) and commit.
  New: Amazon deals. When you press Check, each card shows if Amazon (or whoever has the Buy Box) has a deal on it —
  the badge as Amazon shows it (Early Black Friday, Limited time deal, Prime Exclusive …), how far under its 90-day
  price Amazon is, any coupon, and the end date/time when Keepa has one. "On a deal" filter + a "N on a deal now" item
  in the Black Friday strip. Costs NO extra tokens (it's in the reply the check already pays for).
  Also an "On a deal now" list at the top of the Repricer page: every product you hold that's on a deal, soonest to
  end first — the deal, until when, Amazon's price (and since when, was £X), £ tied up. Click a line for its card.
  A live panel while a check runs: how many done, the Keepa bank (Keepa's own figure, not the old 5-minute log),
  "+21 in 0:42" countdown, tokens spent / per product / still to go, what it's doing right now (or why it's waiting
  and when the next batch goes), and when it'll be done. The page no longer jumps while it runs — new results wait
  behind "Show N new results". Checks now keep 400 in the bank (was 630). Black Friday dates = Amazon's 19–30 Nov.
  Smoother drip: at the 400 line it checks 1–2 products as each refill lands (not 5 every 2½ min); it waits out the
  9pm competitor run (Sun/Tue/Thu 21:00–22:00) by itself; the Check button says when it'll be done.
  Graphs: 1½ years (no extra tokens — shows from each product's next check), a "Shading on/off" button per graph,
  a bigger sellers graph (hover = "27 sellers" on the line + dot on the Buy Box), and every SKU's own min and
  break-even drawn on the one graph (e.g. "min £49.00 · 13 units, 5 SKUs" and "you = min £48.00 · 6 units, 2 SKUs").
  Under 25 days is skipped now (was 30).
  Audit fixes (18 Nov): deals for the products already checked today fill in from the shared Keepa cache (free —
  45 of them are on a deal right now); each card says what kind of deal it is and that it's Amazon's own (e.g.
  "Amazon's own Early Black Friday deal: Amazon went £1,185.29 → £799.00 on 16/11"); the ASIN copies with a click;
  "Why it hasn't sold" is one point per line; the SKU table fits the card; "Copy £"; £ figures have commas;
  the token box is two short lines; the deal list can be hidden.

UPDATED 14 Nov (v67ag) — includes v67af and v67ae. NO SQL — just upload index.html, css and js (same way) and commit.
  New: Stock age chips (on a provider) / provider chips (on a stock age) — pick one or more and the list AND the Check
  button follow, so you only check what you want. Checks go oldest first. Press Check on another provider while one
  is running and it queues. The button says how long it'll take; the run line shows tokens spent.

UPDATED 14 Nov (v67af) — includes v67ae. NO SQL — just upload index.html, css and js again (same way) and commit.
  New: "Everything" at the top of the left list (one press checks every provider), a Black Friday strip at the top,
  "1,000+" where Keepa can't see a seller's full stock, graph labels that never sit on each other, names on 2 lines.

UPDATED 13 Nov (v67ae) — v67ad IS LIVE; this is a small update on top. NO SQL this time — just upload
  index.html, css and js again (same way) and commit:
  Checks never take the Keepa bank under half (630) — they drip at the refill speed after that.
  Re-checks within 14 days start with a 1-token quick look and only do the full check if something moved.
  The not-checked list shows every product, in sections by day 90, with Check / Leave out when you hover a line.

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
