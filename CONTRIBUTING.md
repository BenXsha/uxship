# Contributing

Thanks for looking. This is a pre-release project with one maintainer, so the most useful
contributions are the small, well-evidenced kind.

## Before you start

Read [`docs/architecture.md`](docs/architecture.md) — it explains the layer boundaries. The single
most important rule follows from them:

> **Never silently degrade.** If a host cannot represent something, report it. If a gate cannot
> check something, say so. Most of the bugs this project has shipped were not wrong output — they
> were *missing* output that looked like success.

Two more house rules, both learned the hard way:

- **Verify before you claim.** Before writing "the host can't do X" into code, a comment or a doc,
  check it three ways: probe at runtime (`plugin_capabilities`), grep the vendor's own type
  definitions **and read the member's description text**, then paste the evidence into the comment.
  Member names lie; a hand-written fallback once had to be thrown away because
  `isComponentRoot()` did not mean what its name suggested.
- **Gates exist because something bit us.** If a test or script looks oddly specific, read its
  comment — it usually names the real incident. Don't loosen a gate without understanding that.

## Development setup

Requires Node 20, 22 or 24 (`^20 || ^22 || >=24`) and Yarn 1.x for the two plugins.

```bash
npm run install:server   # mcp-server      (npm ci)
npm run install:plugin   # plugin-mastergo (yarn)
npm run install:penpot   # plugin-penpot   (yarn)
(cd packages/response-budget && npm ci)
```

Optional — only for the offline render instruments (`harness:render`, `ui:shot`, `verify:visual`),
which drive a real browser over CDP:

```bash
npx playwright install chromium     # ~170 MB
```

Two things that bite here, both explained in `plugin-penpot/scripts/chrome.mjs`: use the **full**
Chromium (headless-shell does not fire `requestAnimationFrame`, so the engine hangs), and on Ubuntu
23.10+ you need `CHROME_FLAGS=--no-sandbox` because AppArmor blocks unprivileged user namespaces.

## The gate

Everything below must pass. CI runs the same set, so a green local run means a green PR.

```bash
(cd mcp-server     && npx tsc --noEmit && npm test)                # 699 tests
(cd plugin-mastergo && yarn typecheck && yarn test)                # 374 tests
(cd plugin-penpot   && yarn typecheck && yarn test)                # 592 tests
(cd packages/response-budget && npm test)                          #  18 tests + dual-entry check
npm run build:server && npm run build:plugin && npm run build:penpot
npm run license:check && npm run docs:check && npm run skill:check
npm run check:response-budget && npm run typecheck:pi
```

Notes on a few of them:

- `docs:check` fails on dead relative links in Markdown, so keep links honest.
- `check:response-budget` compares two files byte for byte — see
  [`packages/response-budget/README.md`](packages/response-budget/README.md) for why that pair exists.
- `skill:check` warns when your machine has a skill copy under the old directory name. That is
  intentional: a stale copy means your agent is reading an out-of-date manual.
- `package.json` scripts and the files they call are the contract; if you add a flag, document it in
  the script's header comment.

## Adding a host adapter

The whole point of the architecture is that a second canvas is an adapter, not a rewrite. Start with
[`docs/adapter-spec.md`](docs/adapter-spec.md); `plugin-penpot` is the second complete example, and
`plugin-penpot/tests/helpers/` shows the fake-host pattern the shared conformance cases expect.

## Adding a tool

1. Define it under `mcp-server/src/utils/tools/`, with a description that states *when to use it*,
   not just what it does.
2. Add it to a profile in `mcp-server/src/utils/tool-profiles.ts`. The default `gen` profile is
   deliberately narrow — if it belongs in `full` only, that's a decision, not an omission.
3. If its result can grow with document size, add it to `HEAVY_OUTPUT_TOOLS` so output budgeting
   applies. There is a test that fails when a `*_list` / `*_search` tool is missing from that set.

## Pull requests

Use the template; it asks for the gate output and a few design self-checks. Small, single-purpose
PRs get reviewed fastest. If your change affects the tool contract or a host interface, open an issue
first — protocol changes go through an ADR (`docs/decisions/`).

Commit messages explain **why**, in the same spirit as the code comments. If you fixed a bug whose
cause was non-obvious, say what the failure mode was; the next person will hit it too.

## Licence

By contributing you agree your work is licensed under Apache-2.0 (see [`LICENSE`](LICENSE)).
