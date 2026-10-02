# Comparison

Where this project sits, including where it is behind. Written to be useful rather than flattering:
the gaps are listed with the same prominence as the advantages, and anything not verified is marked
as such.

## The one-line position

**A local-first design-canvas agent harness: one MCP contract that writes AI-generated design into a
canvas as native, editable layers, and reads canvas design back out to code — over more than one
design tool.**

## Dimensions that actually differentiate

| Dimension | uxship | Notes |
|---|---|---|
| Hosts | **2** (MasterGo, Penpot) behind one contract | The adapter port is the point; a third canvas is an adapter (see [`adapter-spec.md`](adapter-spec.md)) |
| Where it runs | **Entirely local** | No account, no telemetry, no upload path — [`why-local-first.md`](why-local-first.md) |
| Cost model | Process you run; no per-seat fee | Nothing metered by us; your model provider is your own subscription |
| Licence | Apache-2.0 | Permissive, with an explicit patent grant |
| Output form | **Native editable layers**, not an image or an embedded frame | The canvas stays a canvas |
| Reverse direction | Canvas → DSL → HTML/Tailwind + tokens + SVG | Plus incremental re-export by node id |
| Context discipline | 67 tools → 20 by default (**−68%**), result truncation that preserves JSON | Measured, see [benchmarks](benchmarks.md) |
| Degradation | Reported structurally (`skipped`, `available: false`, `hostType`) | The design rule the project is built around |

## Where this project is behind

Stated plainly, because a comparison that only lists wins is marketing:

| Gap | Reality |
|---|---|
| **Ecosystem and integrations** | One maintainer, no plugin marketplace presence, no third-party plugins. Established vendors have years of integrations and templates. |
| **Brand trust and official backing** | Not affiliated with any design tool vendor, and it says so. Nothing here is endorsed, tested against every host build, or covered by vendor support. |
| **Figma coverage** | Not supported. If your team is on Figma, this does not help you today — and Figma's own MCP plus Code Connect is a real, supported path. |
| **Design-system mapping depth** | Vendor "code connect"-style mappings (component property ↔ code prop, per-component) are deeper than what we do. Our component round-trip is name-driven and does not yet carry a full property mapping. |
| **Guaranteed fidelity** | Fidelity depends on each host's plugin API. Where a host cannot represent something, we degrade and report it — a cloud renderer that owns the whole stack could do better. |
| **Host build coverage** | Enterprise/private builds lag public typings. We probe at runtime instead of assuming, but that means "verified on the build we tested" is the honest scope. |
| **Benchmarks breadth** | Context cost is measured and reproducible. Render *fidelity* is only spot-checked; there is no broad pixel-diff suite yet. |
| **Setup effort** | You install, connect a plugin, and point your agent at the server. Nothing is turnkey, and there is no hosted option. |
| **Docs maturity** | Young. Written alongside the code, and honest about limits, but not battle-tested by a large user base. |

## Where the differences come from

Three structural choices explain most of the table above:

1. **Multi-host behind one contract.** This costs fidelity relative to a vendor's first-party
   integration, and buys portability and a second canvas as an adapter. It is the bet the project
   makes.
2. **Local-first.** This costs convenience (no hosted renderer, no shared workspace) and buys data
   sovereignty, air-gap viability, and no per-seat pricing.
3. **Context as a first-class budget.** This costs some convenience in tool design — a small default
   surface means a tool may need enabling first — and buys materially lower cost per turn on large
   documents.

## What is *not* claimed

- Not a Figma replacement, and not trying to win on ecosystem.
- Not the first tool to do design-to-code; that space is crowded and the entry ticket is standard.
- Not "official" for any host, and not a drop-in replacement for a vendor's own MCP server.

## Choosing

| If you… | then |
|---|---|
| need a canvas we do not support | an adapter is welcome; see [`adapter-spec.md`](adapter-spec.md) |
| need first-party vendor support and an official integration | use the vendor's own tooling |
| work under NDA, in an air-gapped network, or cannot send designs anywhere | this is the reason the project exists |
| care about context cost on large documents | the default surface and structural truncation are measurable — see [benchmarks](benchmarks.md) |
| want a hosted, collaborative product | this is the wrong shape of tool |

Competitor capabilities change constantly and are not independently verified here. The right-side
claims in the first table are about *this* project and are reproducible from the repository; treat any
statement about other tools as a starting point for your own evaluation, not as a reviewed fact.
