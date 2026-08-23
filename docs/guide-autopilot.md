# Autopilot

Describe a task in plain language. A real browser works through it, and comes
back with the answer, the facts behind it, and where on the page it read each
one.

The point is not that a model can click things. It is that you can check the
work afterwards. Every fact carries the page it came from, the text it was
read out of, and the moment it was seen — so "the total was €98.44" is a claim
you can verify rather than one you have to trust.

## Running one

Open **Autopilot** in the [dashboard](https://runbrowser.dev/dashboard),
describe the task, and watch the browser work through it in the viewer beside
the transcript. That is the whole thing; there is nothing to install and no
key to make first.

Good tasks name the site and the thing you want:

> Go to news.ycombinator.com and give me the title and points of the top story.

> Compare the price of the same flight on these two sites and tell me which is
> cheaper, and by how much.

> Work through the signup form on staging.example.com and tell me which step it
> fails at.

Tasks that leave the destination open — "find me a cheap laptop" — take longer
and cost more, because the run spends its first moves deciding where to go.

## What comes back

**The answer**, in prose.

**The facts**, as a table. Before it starts, the run works out what the goal
actually requires — a flight comparison needs a price from each site, not a
paragraph about flights — and then fills those in as it reads pages. Anything
it could not find comes back empty rather than invented.

**The evidence.** Expand any fact and you get the URL, the text on the page it
was read from, and the timestamp. A fact with no evidence attached was not
read off a page, and the table says so: it is marked `unverified`, and you
should treat it as the model talking rather than the web answering.

Values are checked against the page rather than compared character by
character, so `€98,44` and `EUR 98.44` are the same number and neither counts
as invention.

**The cost and the step count**, per run. A typical run is a few cents.

## Turning a task into a check

Say what a fact has to be, and the run reports a verdict instead of a value:

| Verdict | Means |
|---|---|
| `passed` | Found it on a page, and it agrees |
| `failed` | Found it, and it does not agree |
| `unresolved` | Never found it at all |

`unresolved` is deliberately not `failed`. Not finding a thing and finding the
wrong thing have different causes and different fixes, and a check that
collapses them sends you looking in the wrong place.

## Turning a run into a check

A run answers a question once. A **check** asks it on a schedule.

When a run does what you wanted, make it a [check](guide-checks.md): we keep
the steps it worked out and the assertions it made, and repeat them every N
minutes. No model is involved after that — the journey is already known — so a
check costs browser time rather than tokens, which is why the run allowances
are small and the check allowances are not.

Every run also keeps its transcript, and on plans with
[recording](concepts.md#session-recording) a frame-by-frame replay of the
browser.

## What it costs

Runs are counted monthly against your plan: 3 on Free, 20 on Hobby, 50 on
Pro, 250 on Scale. Monthly rather than daily on purpose — a run is a
considered thing you do a few of, not a chat you hold, and a daily cap on a
small number just means "not today" on the day you actually need it.

Token spend is bounded underneath by the same per-org ceiling `/extract` uses,
so an unusually long run cannot outrun its count and land you with a surprise.

The browser it drives is an ordinary session, billed as browser time like any
other.

## Where it struggles

Worth knowing before you point it at something important.

- **Sites that need a login.** The run starts signed out. Give it credentials
  in the task and it will try, but a flow behind MFA is not something to
  automate this way.
- **Anything with a CAPTCHA.** The run flags the wall rather than pretending
  it isn't there. See [getting through walls](guide-unblocking.md).
- **Very long flows.** Runs are capped at a fixed number of moves. A
  twelve-step checkout is near the edge; break it into two tasks.
- **Ambiguity.** "The best option" is not a fact that exists on a page. Ask
  for the thing that is written down — the price, the date, the status — and
  let your own code decide what "best" means.

## Doing it from code

The dashboard is where you work out whether a task is possible. Once it is,
there are two ways to run it without a browser tab open, and the first is
usually the right one:

1. **Make it a [check](guide-checks.md)** and we run it on a schedule. No model
   after the first run, so it is cheap enough to run hourly forever, and it
   tells you when the answer changes.
2. **Call it as an API** with `POST /v1/agents/runs`. Right when the question
   is different every time — a one-off investigation rather than something
   worth watching.

See the [API reference](api-reference.md#autopilot) for the endpoints.
