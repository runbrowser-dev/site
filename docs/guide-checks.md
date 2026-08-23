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

## What it ends up watching

You do not have to state an expected value. The first run reads the page, and
whatever it finds and can **verify against the page** becomes what the check
watches from then on.

So a task like *"open the status page and confirm every service reads
Operational"* pins the words that were actually there — `All Systems
Operational` — and every run after that re-checks them. Ask for a price and it
pins the price. This is a regression check: the question is not "is this value
correct" but "does the page still say what it said when this passed".

Two consequences worth knowing.

**Pin something stable.** If the run pins a value that changes on its own — an
uptime percentage, a timestamp, a "3 minutes ago" — the next run fails, and it
was your check that changed rather than the site. Reword the task to name the
thing you actually care about. The failure says exactly which value moved, so
this takes one look to spot.

**A run that verifies nothing is an error, not a pass.** If the steps work but
nothing it reported could be found on any page it read, the check is reported
as an **error** rather than sitting green for ever while proving only that a
page loads. That usually means a task that says what to *do* without naming
anything to look for:

| | |
|---|---|
| ✗ | "Open the basket page" |
| ✓ | "Open the basket and confirm the total is €98.44" |

For exact control, the API takes an explicit checklist — see `expect` on
[`POST /v1/agents/runs`](api-reference.md#post-v1agentsruns). A stated
expectation always wins over a pinned one.

## Logging in

A check starts signed out, like any session. Point it at a
[browser context](api-reference.md#browser-contexts) that already holds the
sign-in:

1. Run one session with `persistContext` that does the login by hand.
2. Reference that context from the check.

Refresh it when runs start failing at the login wall — you are restoring the
client half of a session and the server can still expire it.

## Scheduling

`intervalMinutes` is floored at 5, on a check or a suite. Below that a run has
not finished before the next is due, and it spends its whole allowance
overlapping with itself.

A check in a suite takes the suite's cadence; changing the suite's moves every
member with it. Otherwise the number on the group would be a promise some of
its checks did not keep.

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

## Going over

**Your checks do not stop when the allowance runs out.** Monitoring that goes
quiet when you grow goes quiet exactly when you need it, so on a paid plan the
allowance is where billing starts, not where the product stops:

| | |
|---|---|
| Extra check run | €0.01 |
| Extra re-derivation | €0.05 |

Both are deliberately more than the plan works out at per run — moving up a
tier is always cheaper than paying overage on the one below it. Re-derivations
cost more because they cost *us* more in kind: a run replays steps that are
already known, a re-derivation runs a language model.

**There is a ceiling, and it defaults to your own plan price.** Overage cannot
more than double your bill unless you deliberately raise it. Set it to zero and
overage is refused entirely — your checks pause at the allowance and the bill
is fixed to the cent, which is the right answer if you need to predict it.

`GET /v1/checks/usage` shows where you are:

```json
{ "plan": "Pro", "runsUsed": 15500, "runsIncluded": 15000,
  "healsUsed": 410, "healsIncluded": 400,
  "overageMicros": 5500000, "overageCapMicros": 99000000, "overageBilled": true }
```

Amounts are micro-EUR — €5.50 of overage against a €99.00 ceiling. Cents cannot
represent a €0.01 charge without rounding a real one to nothing.

The free plan has nothing to bill against, so there the allowance is still a
wall: checks pause, and the check is fine — the month is not.

## Suites, and running them after a deploy

A flat list stops being readable somewhere around twenty checks. Group them
into a **suite** — everything that has to work for checkout, or for signup.

**The schedule belongs to the suite.** Every check in it runs on the suite's
cadence, and moving a check into one adopts that cadence. A group of checks
that belong together almost always wants a single frequency, and saying it once
on the group is the version somebody can read — "Checkout, every 15 minutes,
seven checks" answers what runs when in one line. A check outside any suite
keeps its own, because it has no group to inherit from.

Then you can run the whole group at once and get a single result:

```
Checkout · 6 passed · 1 failed of 7 · 86%
  ✓ Basket accepts a product
  ✓ Basket shows the right total
  ✗ Checkout reaches the payment step
        expected "Pay by card" · page says nothing
```

The schedule answers "is the site working" eventually. A suite run answers it
in the ten minutes after a release, which is when you are actually asking. Both
write to the same history, so "has this ever passed" has one place to look.

```bash
curl -X POST https://api.runbrowser.dev/v1/suites/{suiteId}/run \
  -H "Authorization: Bearer ab_…"
```

That is the call a deploy pipeline makes. It is **synchronous** — a step that
returns immediately and passes is a step that can never fail, which is worse
than not having it — so expect it to take as long as the slowest few checks in
the suite. Every check runs even after one fails: stopping at the first would
report one problem when there were four, and how bad it is is what you are
deciding a rollback on.

Deleting a suite leaves its checks alone. Tidying up a grouping is not the same
as asking to stop watching checkout.

## Getting told

Add a destination under **Alerts** in the dashboard — an email address, a Slack
incoming webhook, or a Teams one. As many as you like, each switchable, each
with a **Send test** button so a mistyped URL is found now rather than at 3am.

**You are told when a check changes**, not on every failing run. Green to
broken says so once; broken back to green says so once. A check running every
fifteen minutes against a site that is down would otherwise send ninety-six
identical messages a day, and the second one has already taught you to filter
the rest.

**A check that repairs itself stays quiet.** That is the point of it — a
redesign is not your problem, and telling you about it would hand back exactly
the interruption the feature removes. Every heal is in the run history.

A destination that fails delivery keeps its last error where you can see it: a
webhook that stopped working when someone rotated it is otherwise
indistinguishable from having no alerts at all.

## What it does not do yet

- **No branching.** A check is one linear journey. Something with a decision in
  it wants two checks.
- **No CAPTCHAs.** Same as everywhere else — we flag the wall rather than
  pretending it isn't there.
