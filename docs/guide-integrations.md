# Integrations

RunBrowser inside the tools you already use — agent frameworks, workflow
automation, and MCP clients.

## LangChain

The tools ship inside the [SDKs](/docs/guide-sdk) rather than as separate
packages, so there's one thing to install and one version to track. LangChain
itself is an optional peer dependency: installing the SDK never drags an agent
framework into a project that just wants a screenshot.

```bash tab=Python
pip install "runbrowser[langchain]"
```

```bash tab=JavaScript
npm install runbrowser @langchain/core zod
```

```python tab=Python
from runbrowser.langchain import get_runbrowser_tools
from langgraph.prebuilt import create_react_agent

tools = get_runbrowser_tools()          # reads RUNBROWSER_API_KEY
agent = create_react_agent(llm, tools)

agent.invoke({"messages": [("user", "What does example.com say?")]})
```

```ts tab=JavaScript
import { getRunBrowserTools } from 'runbrowser/langchain'

const tools = getRunBrowserTools()      // reads RUNBROWSER_API_KEY
```

**The tools**

| Tool | What it's for |
|---|---|
| `browse_page` | Read a page as markdown, JavaScript rendered |
| `extract_structured` | Get named fields as JSON matching a schema |
| `unblock_page` | Get past a bot wall that refused a previous call |
| `crawl_site` | Read several linked pages in one step |

Pass `include=[...]` to narrow the set. Fewer, more distinct tools reliably
improves a model's choices — if your agent only ever reads pages, give it only
`browse_page`.

### Written for the model, not the developer

Two things make the difference between an agent that works and one that loops,
and both are in the tool text rather than the API:

**Each description says when to use a *different* tool.** `browse_page` tells
the model to prefer `extract_structured` when it knows which fields it wants,
and to reach for `unblock_page` if the page reports a wall. Tool descriptions
are prompt text; vague ones are the main reason agents pick wrong.

**Failures say what would fix them.** A model can't act on `HTTP 429`. It can
act on this:

```
FAILED: the account is out of browser quota this month. Do not retry.
```

```
BLOCKED by datadome: this page returned a bot wall rather than its content.
Try the unblock_page tool on this URL.
```

```
Still blocked (scoring, datadome). This site scores the session rather than
posing a challenge, so no solver clears it; retry through a residential exit
IP. This is an infrastructure limit, not something to retry — move on.
```

That last one matters most. Told the truth, an agent moves on; told "Error:
403", it retries the same call until it runs out of steps.

Page content is trimmed to 12,000 characters with the truncation stated, so one
long page can't eat the context the model needs to reason.

## n8n

```
Settings → Community Nodes → Install → n8n-nodes-runbrowser
```

Add a **RunBrowser API** credential with your key. It's tested when you save
it, so a wrong key surfaces then rather than mid-workflow.

| Operation | Returns |
|---|---|
| Screenshot / PDF | A real **binary attachment** |
| Content | HTML after JavaScript runs |
| Extract | Typed JSON matching your schema |
| Scrape | Named elements by selector |
| Unblock | Whether a wall cleared, plus clearance cookies |
| Crawl / Map | Linked pages, or every URL a site links to |

Screenshots and PDFs arrive as binary attachments, not base64 inside JSON, so
**Write File**, **Send Email** and S3 uploads work directly with no Convert
step.

Two things worth knowing: **Proxy** and **Country** live under Options (setting
a country also moves the timezone and language), and turning on **Continue On
Fail** lets a workflow branch on a blocked page rather than dying on one bad
URL — which matters once you're feeding it a list.

## MCP

For Claude and other MCP clients, the gateway *is* an MCP server — no adapter
package. See [MCP](/docs/mcp).

## Anything else

Every integration here is a thin wrapper over the same
[REST API](/docs/api-reference). If your tool speaks HTTP, it already works:
point it at an endpoint with a bearer token. A plain HTTP call is a supported
way to use this platform, not a workaround.

See also: [SDKs](/docs/guide-sdk).
