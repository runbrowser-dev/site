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

Locally, against the dev stack, the endpoint is `http://localhost:3000/mcp`.

## Tools

| Tool | Browser? | What it's for |
|---|---|---|
| `fetch` | no | Read one URL over plain HTTP. Fast, but no JavaScript runs. |
| `search` | no | Web search: titles, URLs, snippets. |
| `extract` | no | URL + JSON Schema → structured JSON. Renders the page first, so it handles JS-heavy sites. |
| `browser_navigate` | yes | Open a URL in this session's persistent browser. |
| `browser_click` | yes | Click the first element matching a CSS selector. |
| `browser_type` | yes | Type into an element, optionally pressing Enter. |
| `browser_get_content` | yes | Read the current page as text or HTML. |
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
- Idle timeout — the browser's own `MAX_KEEPALIVE_IDLE_SECONDS`, plus a
  30-minute sweep of MCP sessions nobody has touched.

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
- Requests carrying an `Origin` header are refused unless the origin is
  listed in `MCP_ALLOWED_ORIGINS`. Real MCP clients aren't browsers and
  don't send one; this is the spec's DNS-rebinding guard.
- `GET /mcp` returns 405. There are no server-initiated messages, so
  there's no stream to open.

## Testing it

```bash
make mcp
```

Drives the whole surface against a running stack: initialize, `tools/list`,
every tool, click-through navigation, a deliberate bad selector, then
teardown.
