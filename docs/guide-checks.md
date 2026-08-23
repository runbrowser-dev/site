# Checks

Describe something a browser should be able to do, and how you would know it
worked. We work out the steps once, then repeat them on a schedule and tell
you when the answer changes.

```bash
curl -X POST https://api.runbrowser.dev/v1/checks \
  -H "Authorization: Bearer ab_…" -H 'Content-Type: application/json' \
  -d '{
        "name": "Checkout still reaches payment",
        "task": "Go to shop.example.com, add the first product to the basket, go to checkout, and confirm the page offers a card payment option and shows a total.",
        "intervalMinutes": 60
      }'
```

That is the whole setup. No selectors, no script, no runner to host.

## Why it is cheap enough to run hourly

The expensive part of automating a website is *discovering* the steps. A
language model is very good at that and far too expensive to keep in the loop
afterwards.

So it only runs once. The first execution of a check works the journey out and
stores it: the actual selectors that worked, and the assertions it established
along the way. Every run after that replays them with no model involved. That
is why check runs are measured in tens of thousands per month while autopilot
runs are measured in tens — a replay costs browser-seconds, not tokens.

## The three outcomes

| Status | What happened | What we do |
|---|---|---|
| `passed` | Every step ran, every assertion held | Nothing |
| `failed` | Every step ran, and an assertion no longer holds | **Tell you.** The check is left exactly as it is |
| `drifted` → `healed` | A step could not be carried out | Re-derive the journey and carry on |

**The distinction between the last two is the whole design.** A check that
re-derived itself on every failure would be worse than useless: it would adapt
around the regression it exists to catch, go green, and report that your site
is fine — and you would believe it, because it is a check.

So the two failures are treated as the different things they are. A step that
cannot be carried out means the markup moved under us; your site probably works
and our stored journey is stale, so re-deriving it is exactly right. An
assertion that no longer holds means every step ran, the page rendered, and it
now says something else. That *is* the finding. Healing there would teach the
check to accept the new value, which is the one thing it must never do.

A check that fails to heal three times running pauses itself, so a check
pointed at a site that has genuinely gone away stops spending your allowance on
it. Re-enable it and the counter resets.

## Writing a good task

The task is doing two jobs: it says what to do, and it says what "worked"
means. It is also what a heal re-derives *from* — so write the intent, not the
steps.

**Good:**

> Go to status.example.com and confirm every service shows "Operational".

> Sign in at app.example.com with the credentials in the staging context, open
> Billing, and confirm the plan shows "Pro" and a next invoice date.

**Bad:**

> Click the third button in the header.

The second one describes *our* implementation rather than your intent, so when
the header changes there is nothing left to re-derive from.

Name the thing that must be true. "Confirm the total is €98.44" gives the check
something to assert; "check the basket page" does not, and a check with no
assertions can only ever detect a page that fails to load.

## A check with nothing to assert is not a check

If the first run works out the steps but finds nothing to assert, the check is
reported as an **error**, not a pass. It would otherwise report green for ever
while proving only that a page loads.

That is almost always a task that says what to *do* without saying what must be
*true*:

| | |
|---|---|
| ✗ | "Open the basket page" |
| ✓ | "Open the basket and confirm the total is €98.44" |
| ✗ | "Go to the status page" |
| ✓ | "Go to the status page and confirm every service reads Operational" |

Name a value, a word, or a state that has to be there. That is the thing the
check watches, and it is what a failure will point at.

## Logging in

A check starts signed out, like any session. Point it at a
[browser context](api-reference.md#browser-contexts) that already holds the
sign-in:

1. Run one session with `persistContext` that does the login by hand.
2. Reference that context from the check.

Refresh it when runs start failing at the login wall — you are restoring the
client half of a session and the server can still expire it.

## Scheduling

`intervalMinutes` is floored at 5. Below that a run has not finished before the
next is due, and the check spends its whole allowance overlapping with itself.

Runs are claimed before they start, so a slow run never gets a second copy
started underneath it, and a redeploy mid-run costs you that run rather than the
schedule — the next tick picks it up from the database.

## Limits

| | Free | Hobby | Pro | Scale |
|---|---|---|---|---|
| Checks | 1 | 5 | 20 | 75 |
| Runs/mo | 750 | 4,000 | 15,000 | 55,000 |
| Re-derivations/mo | 10 | 60 | 400 | 2,000 |

Runs are sized so every check your tier allows can run **hourly** — 730 a month
each — and the allowance is a pool, so five checks every fifteen minutes costs
the same as twenty hourly ones.

**Re-derivations are capped separately** because they are the only expensive
part. A run replays steps that are already known; re-deriving runs a language
model, which is around a hundred times the price. A real suite never meets
these numbers. Past the cap, a drifting check reports the drift and keeps its
existing steps rather than paying to work them out again — which is also the
honest answer, because something re-deriving that often is being rebuilt faster
than any check can track it.

An org out of runs has its checks paused rather than failed: the check is fine,
the month is not.

## What it does not do yet

- **No alerting.** Runs and their outcomes are readable through
  `GET /v1/checks/{id}/runs`; nothing emails or pages you. Poll it, or watch
  the dashboard.
- **No branching.** A check is one linear journey. Something with a decision in
  it wants two checks.
- **No CAPTCHAs.** Same as everywhere else — we flag the wall rather than
  pretending it isn't there.
