# Security

## Status

Pre-release. This project has **not** had an external security review. It is designed for local,
single-developer use; do not expose it to an untrusted network.

## Threat model (what the defaults actually do)

| Surface | Default | Notes |
|---|---|---|
| MCP server bind address | `127.0.0.1` only | Set `HOST=0.0.0.0` only if you understand the consequences below. |
| HTTP/SSE port | `15490`, loopback | Endpoints: `GET /sse`, `POST /messages` (full MCP), `POST /mcp` (trimmed, `tools/call` only), `GET /health`. |
| Plugin WebSocket hub | `15489`, loopback | Both hosts connect here. A client declares its backend at `initialize`; unclaimed or mismatched clients are rejected (fail-closed). |
| Cross-machine use | **needs a token** | Set `UXSHIP_MCP_TOKEN` and send it as a Bearer token. Without it, binding to a non-loopback address exposes full canvas write access to anyone who can reach the port. |
| Remote images (`code_to_design`) | SSRF-guarded | Outbound image fetches are restricted; see `safeFetchImage` in the server. |
| Design data | stays local | Rendering and preprocessing run on your machine. Nothing is uploaded by uxship itself — but a plugin runs inside your design tool, and your agent talks to whatever model provider you configured. |

The server can create, modify and delete layers in your design documents. Treat a reachable instance
as equivalent to handing over your editor.

## Reporting a vulnerability

Please use GitHub's private reporting, not a public issue:

<https://github.com/BenXsha/uxship/security/advisories/new>

Include: affected version, how to reproduce, and what an attacker gains. If you are unsure whether
something is a vulnerability, report it privately anyway — a false positive costs a message.

**Do not** paste tokens, private design files, internal hostnames, or customer data into a public
issue. Redact before attaching logs.

## What to expect

Best-effort, single maintainer: acknowledgement within ~3 days, an assessment within ~7. Fixes for
anything that lets a non-loopback caller write to a canvas, or that leaks design data off the
machine, take priority over everything else.

## Dependency and asset policy

- Runtime dependencies must be permissive (no strong copyleft) — enforced by `npm run license:check`.
- Redistributed third-party assets are allow-listed and must be declared in
  [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md).
- CI runs gitleaks on every push and pull request.
