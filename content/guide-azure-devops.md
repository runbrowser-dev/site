# Azure DevOps

Two halves, useful separately: run your checks from a pipeline, and turn the
test plans you already have into checks.

## Run checks from a pipeline

```yaml
- task: RunBrowserChecks@0
  inputs:
    suiteId: '00000000-0000-0000-0000-000000000000'
    apiKey: '$(RUNBROWSER_API_KEY)'   # a secret variable, never inline
```

The step runs every check in the suite against the deployed site and fails the
build if one does not hold. It is synchronous, so it takes as long as the
slowest few checks and there is nothing to poll — a step that returned
immediately and passed would be a step that can never fail.

Every check runs even after one fails. Stopping at the first would report one
problem when there were four, and how bad it is is what you decide a rollback
on.

## Import test plans

Connect a project under **Settings → Azure DevOps** with a personal access
token carrying **Test Management (read & write)** and **Work Items (read)**.
The token is checked when you save it, so a typo is caught then rather than by
a scheduled import failing quietly at 3am.

A manual test case is already the shape a check takes:

| Azure DevOps | Here |
|---|---|
| Test Suite | Suite |
| Test Case | Check |
| Step actions, in order | the task |
| Step *Expected Result* | one entry on the checklist |
| Suite run | Test Run, posted back |

That checklist is better than what a check normally gets. Left alone, a check
pins whatever the first run could verify on the page. An imported case states
what a person decided ought to be true — the difference between "the page still
says this" and "the page says the right thing".

Results are posted back as a Test Run, so outcomes land on the plan your team
already looks at rather than in a second tool.

### What gets skipped, and why

Not every manual case can be a browser check, and pretending otherwise produces
a green that proves nothing. These are skipped, and each one is named:

- **A step needing something outside a browser** — reading an inbox, checking a
  database row, phoning someone.
- **No expected results anywhere** — there would be nothing to check.
- **No steps at all** — a title is not a test case.

A skipped case is reported as skipped. It is never imported and quietly passed.

A case we ran but could not carry out comes back to Azure as **NotApplicable**,
not Failed. It did not find a bug, and one red case for something your software
did correctly is enough for a team to stop believing the rest of the run.

### Things worth knowing

- Manual cases rarely carry a URL — the tester knew the environment — so a
  **base URL** on the connection is prepended to every imported task.
- A case that depends on state left by an earlier case will not work alone.
- Parameterised cases import as one check against the first iteration.
  Data-driven expansion is not done yet.
- Re-importing a suite **updates** rather than duplicates, and re-derives the
  steps: a case whose wording changed is a case whose journey may have.

## Buying through Azure

The offer can be bought through Azure Marketplace, which for most enterprises
matters more than it sounds: marketplace-billed SaaS is MACC-eligible, so the
purchase draws down an Azure commitment your organisation has already made
rather than needing a new supplier and a new budget line.
