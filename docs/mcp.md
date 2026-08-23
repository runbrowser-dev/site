# MCP server

The gateway exposes an [MCP](https://modelcontextprotocol.io) endpoint at
`/mcp`, so any MCP-aware agent — Claude Desktop, Claude Code, Cursor,
OpenCode, a LangGraph node — can use a real browser as a tool with no SDK
and no glue code.

```
https://connect.runbrowser.dev/mcp     Authorization: Bearer ab_yourkey
```

Transport is Streamable HTTP (protocol `2025-06-18`, with `2025-03-26`
accepted for older clients).

## Connecting

Most desktop clients still launch MCP servers as subprocesses, so they
reach a remote server through the `mcp-remote` bridge:

```json
{
  "mcpServers": {
    "runbrowser": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote",
        "https://connect.example.com/mcp",
        "--header", "Authorization: Bearer ab_yourkey"
      ]
    }
  }
}
```

Clients with native remote-server support (including Claude Code via
`claude mcp add --transport http`) can point straight at the URL with the
same header.

## Tools

| Tool | Browser? | What it's for |
|---|---|---|
| `fetch` | no | Read one URL over plain HTTP. Fast, but no JavaScript runs. |
| `search` | no | Web search: titles, URLs, snippets. |
| `extract` | no | URL + JSON Schema → structured JSON. Renders the page first, so it handles JS-heavy sites. |
| `browser_navigate` | yes | Open a URL in this session's persistent browser. |
| `browser_click` | yes | Click the first element matching a CSS selector. |
| `browser_type` | yes | Type into an element, optionally pressing Enter. Reports whether the page actually navigated. |
| `browser_press_key` | yes | Send a single key — Enter, Escape, Tab, an arrow — to the page or a focused element. |
| `browser_select_option` | yes | Choose an option in a `<select>`, by value or by visible label. |
| `browser_wait_for` | yes | Wait for a selector — or, with no selector, for the page to stop changing. |
| `browser_snapshot` | yes | List the visible interactive elements, each with a selector you can reuse. |
| `browser_get_content` | yes | Read the page, or one region of it, as text or HTML. |
| `browser_evaluate` | yes | Run your own JavaScript in the page and get JSON back. |
| `browser_dismiss_consent` | yes | Decline a cookie banner. Never accepts one. |
| `browser_screenshot` | yes | PNG of the current page. |
| `browser_close` | yes | Release the browser and stop the meter. |

The tool descriptions deliberately steer a model toward `fetch` /
`search` / `extract` first. Those are stateless, fast, and don't hold a
container; the `browser_*` family exists for the cases they can't
handle — logging in, clicking through a flow, filling a form.

Note the split inside that group: `fetch` is plain HTTP and runs no
JavaScript, while `extract` renders the page in a real browser before
handing it to the model. A model told otherwise will reach for `fetch` on
a JS-heavy SPA, get an empty shell back, and conclude the site is broken.

`fetch` defaults to `markdown`, which keeps the main article and drops site
navigation. That is right for prose and wrong for crawling: a listing page
comes back without its pagination links. Pass `format: "markdown-full"` when
you intend to follow links.

### Landing on a page you've never seen

The awkward moment in browser automation is the first one: you are on a page,
you do not know its structure, and every tool wants a CSS selector you do not
have. Three tools exist for exactly that.

**Wait without naming anything.** `browser_wait_for` with no selector waits
for the page to stop changing — the DOM to settle and in-flight fetch/XHR to
finish. Use it when you cannot name an element to wait for, which on an
unfamiliar SPA is always. (`readyState` is no help: it goes `complete` before
the request that fills the page has even started.)

**Then look at what's there.** `browser_snapshot` lists the visible,
interactive elements with a ready-made selector for each:

```
12 interactive elements:
  [button] Flights
      selector: #\37
  [input/text] Where from?
      selector: input[aria-label="Where from?"]
```

Hand those selectors straight to `browser_click` or `browser_type`. It is far
cheaper than reading the HTML and guessing.

**Read only what you need.** `browser_get_content` takes a `selector`, so you
can pull one region instead of the whole document. On a real app that is the
difference between 1,400 characters and 120,000 — and the large number is
context you no longer have for reasoning.

**And when none of that fits, write the code.** `browser_evaluate` runs your
own JavaScript in the page and returns JSON:

```js
return [...document.querySelectorAll('li')]
  .filter(li => li.innerText.includes('CHQ'))
  .map(li => li.innerText.match(/€[\d,]+/)?.[0])
```

It is the escape hatch for anything the other tools do not cover. A DOM node
or other unserialisable value is reported as such rather than silently
arriving as `{}`.

### Cookie banners

`browser_navigate` declines consent banners automatically, so they stop
covering the page. It only ever chooses reject/decline — **never accept** —
because declining needs no authority from anyone, while agreeing to data
processing on your behalf is not ours to do.

A banner offering no way to say no is left alone and reported:

```
(a consent dialog is present and offers no decline option; it was left alone)
```

The same applies when refusal is hidden behind a settings page: that path
leaves the page you asked for, so it is named rather than followed. Call
`browser_dismiss_consent` directly if a banner appears later in a flow.

### Multi-step flows

Anything that loads content asynchronously needs `browser_wait_for` between
the action and the read — otherwise you are reading whatever happened to be
on screen when the call landed. `browser_type` with `submit: true` tells you
whether the page actually navigated and names the URL it reached; if it
reports that nothing moved, the form most likely needs its submit button
clicked instead.

## How sessions work

`initialize` returns an `Mcp-Session-Id`. Send it on every subsequent
request; the server ties it to one browser.

The browser is created **lazily**, on the first `browser_*` call — an
agent that only ever calls `fetch` and `search` never starts one, and
never pays for one. It's a normal keepAlive session from the same fleet
customers drive directly, so per-org concurrency caps, monthly
browser-time quotas, idle timers and metering all apply unchanged.

Each tool call reattaches to that browser, acts, and parks it again. That
is exactly the cycle a customer's own Playwright client goes through when
it connects and disconnects, which is what keeps idle accounting honest.

Three things end a browser:

- `browser_close` — the polite path, and what the tool description tells
  the model to do when it's finished.
- `DELETE /mcp` with the session header — what a well-behaved client sends
  when the user closes it.
- Idle timeout — the browser's own idle window, plus a 30-minute sweep of
  MCP sessions nobody has touched.

A gateway restart drops MCP sessions, exactly as it drops parked keepAlive
sessions. Clients get a `404` and re-initialize, which the spec requires
them to handle.

## Errors

Two kinds, deliberately distinguished:

- **Protocol errors** (JSON-RPC `error`) for unknown tools and malformed
  arguments — the call itself was invalid.
- **Execution failures** (a result with `isError: true`) for everything
  else: no element matched the selector, quota exhausted, page wouldn't
  load. The model sees the message and can adapt, where a protocol error
  would just abort.

Quota and concurrency rejections are phrased for a model rather than an
operator — "monthly browser-time quota exhausted (3600 of 3600 seconds
used)" rather than a bare 429.

## Security notes

- Every request is authenticated with the customer's API key, and the org
  is re-checked on each call, so revoking a key kills its MCP sessions
  immediately and a leaked session id is useless to another org.
- Requests carrying an `Origin` header are refused unless it is on the
  allow-list. Real MCP clients aren't browsers and don't send one; this is
  the spec's DNS-rebinding guard.
- `GET /mcp` returns 405. There are no server-initiated messages, so
  there's no stream to open.

## Testing it

```bash
make mcp
```

Drives the whole surface against a running stack: initialize, `tools/list`,
every tool, click-through navigation, a deliberate bad selector, then
teardown.
