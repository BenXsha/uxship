# Support

Pre-release project, one maintainer, best-effort support. To get a useful answer quickly, pick the
right channel:

| I want to… | Go to |
|---|---|
| Ask "how do I…" / "why is it designed this way" | [Discussions](https://github.com/BenXsha/uxship/discussions) |
| Report something that looks broken | [Open a bug report](https://github.com/BenXsha/uxship/issues/new?template=bug_report.yml) |
| Request a capability, or a new host adapter | [Open a feature request](https://github.com/BenXsha/uxship/issues/new?template=feature_request.yml) |
| Report a vulnerability | [Private security advisory](https://github.com/BenXsha/uxship/security/advisories/new) — see [`SECURITY.md`](SECURITY.md) |

## Before filing a bug

1. **Which host?** Run `session_list` — each session carries `backend` (`mastergo` / `penpot`).
   Many "bugs" are host differences; check [`docs/host-differences.md`](docs/host-differences.md)
   first, especially if the symptom is a *degradation* rather than a failure.
2. **Which layer?** The pipeline is: HTML+Tailwind → server preprocessing → browser render →
   DSL → canvas. `plugin/selfTest` (Penpot) and `plugin-penpot/tests/helpers/fake-penpot.ts` let you
   split "engine is wrong" from "host did not honour it".
3. **Is it actually reported?** Look for `unresolvedClasses`, `skipped`, `available: false` and
   `_budget` in the tool result. The project reports degradations instead of hiding them, so the
   reason is often already in the response.

The bug template asks for host, version and a minimal reproduction — a small HTML/Tailwind snippet or
the exact tool call arguments is far more useful than a screenshot of a large page.

## What is not supported

- Hosts other than MasterGo and Penpot. A new canvas is welcome as an adapter
  (see [`docs/adapter-spec.md`](docs/adapter-spec.md)), not as a core branch.
- Exposing the server beyond loopback without `UXSHIP_MCP_TOKEN`.
- Long-term support of pre-release versions.
- Reconstructing deleted layers: the server writes to a live canvas and keeps no undo history of
  its own. Your design tool's undo is the undo.
