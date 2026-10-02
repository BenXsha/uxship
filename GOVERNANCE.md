# Governance

## Model

**BDFL + community adapters.** The core (MCP contract, render pipeline, DSL, tool semantics) is
maintained by the project owner. Host adapters are the intended community surface: a new canvas
should be addable by someone who does not touch the core.

This is a bus-factor-of-one project and says so out loud rather than pretending otherwise. The
mitigation is not process, it is making the extension points real:

- `docs/adapter-spec.md` plus a fake-host test pattern, so a new host needs no core changes;
- adapters live in their own directories (`plugin-*`), so a broken adapter cannot block a release;
- gates that run in CI, so correctness does not depend on the maintainer reading every diff.

## Decisions

Changes that affect the tool contract or a host interface go through an **ADR** in `docs/decisions/`
(one file per decision: context, options, decision, consequences). Everything else is decided in the
pull request.

The bar for adding an ADR is "would a contributor be surprised by this later?" — interface shape,
versioning, capability negotiation, degradation semantics.

## Where contributions land on the ladder

Easiest to hardest, roughly:

1. **Docs and translations** — including `*.zh-CN.md` mirrors. Genuinely useful, low risk.
2. **Adapter fixes** — a host added a capability, or one of our fallbacks is now unnecessary.
3. **New host adapter** — see `docs/adapter-spec.md`.
4. **New tools** — must argue for the context cost, since every tool is paid for on every call.
5. **Render pipeline / DSL semantics** — highest scrutiny: it is the contract everything else
   depends on.

## Review expectations

Best-effort: first response to an issue within ~3 days, a conclusion on a PR within ~7. If a PR goes
stale, ping it; nothing here is rejected by silence.

## Releases

Version numbers are lockstep across the four packages (server + two plugins + `response-budget`),
because the plugins are host adapters of the server and a mismatched pair produces confusing
failures — the About pane shows both versions and flags a mismatch. A release is a `vX.Y.Z` tag;
CI verifies the tag matches the manifests before publishing.

## Code of conduct

See [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md). Technical disagreement is welcome and expected;
personal attacks are not.
