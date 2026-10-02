# Why local-first

**Your designs never leave your machine.** Not as a policy promise — as an architectural consequence.

## What actually runs where

| Stage | Where | Leaves your machine? |
|---|---|---|
| Agent authors HTML + Tailwind | your machine | the prompt goes to whichever model provider *you* configured — that is your agent, not uxship |
| Icon, chart and component preprocessing | your machine | no |
| Browser render and measurement | your machine (a plugin iframe in your design tool) | no |
| DSL → canvas | your machine | no |
| Canvas → DSL → code | your machine | no |

There is no uxship account, no licence check, no telemetry, and no upload path. The server binds to
`127.0.0.1` by default and speaks to exactly two things: your MCP client, and your design tool's
plugin socket.

The one outbound request the pipeline can make is fetching icon or image assets — from Iconify, or a
URL you put in the HTML. Those are subject to SSRF guards, and if you author offline, nothing needs
to go out at all.

## Why this is a design constraint, not a feature

It changes what the project is allowed to build:

- **No server-side rendering.** Layout must be resolved on the client, which is why the pipeline
  renders in a real browser and measures it. A cloud renderer would be simpler and would break the
  property above.
- **No shared asset service.** Icons ship with the package (`remixicon`, 3 229 files) or are fetched
  on demand, instead of being proxied through an API.
- **No design locks.** Design bytes stay in your document and your filesystem, so nothing here can
  hold them hostage.

## Who this matters for

- **Regulated or air-gapped environments.** Internal network, no egress, full stop.
- **Anyone who does not want their design system in someone else's storage.** Client work under NDA,
  unreleased products, brand systems.
- **Anyone who does not want to pay per seat.** Design automation is usually priced per editor; the
  cost model here is "run a process".

## Being honest about the trade-offs

Local-first is not free, and pretending otherwise would be the kind of claim this project exists to
avoid:

- **Fidelity depends on your design tool's plugin API.** Where a host cannot represent something, we
  degrade and report it ([host differences](host-differences.md)) instead of silently substituting an
  image. A cloud renderer that owns the whole stack could guarantee more.
- **You run the compute.** Rendering is fast (tens of milliseconds) but applying results to the
  canvas is dominated by host API round-trips — roughly 10 ms each, synchronously. Large pages take
  seconds.
- **No collaboration layer.** No shared projects, no review links, no hosted history. Git is the
  history for code; your design tool is the history for the canvas.
- **Setup is your problem.** Install, connect a plugin, point your agent at the server.

Those are the costs. They are accepted deliberately, and where they show up as a limitation it is
documented rather than hidden.
