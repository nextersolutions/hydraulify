# Phase 1 — /archify architecture, and what hydraulify takes from it

Inspection record of `~/.claude/skills/archify` (v2.17.0-dev.1, MIT, author tt-a1i),
made before any hydraulify code was written. This is the basis for every reuse
decision in [decisions.md](decisions.md).

## 1. Shape of the skill

```
archify/
  SKILL.md                 lean agent instructions + "fast authoring path"
  references/*.md          4 gated deep-dive docs the agent is told NOT to read by default
  schemas/*.schema.json    5 typed diagram schemas + shared $defs
  examples/*.json          one worked example per diagram type
  renderers/<type>/        one renderer per diagram type
  renderers/shared/        geometry, cli, diagnostics, validator, legend, i18n, utils
  bin/archify.mjs          2126-line CLI dispatcher
  assets/template.html     774 KB self-contained viewer runtime
  scripts/generate-*.mjs   build-time codegen (validators, brand marks) + --check drift guards
  test/                    ~120 node:test files, golden + browser layers
```

Roughly 58k lines of `.mjs`. Five diagram types: architecture, workflow, sequence,
dataflow, lifecycle.

## 2. Pipeline

```
typed JSON spec -> schema validation -> renderer -> SVG string -> applyTemplate() -> one .html
```

The JSON specification is the source of truth; the HTML is a representation of it.
This is exactly the layer separation the hydraulify brief demands, and it is the
single most important pattern being inherited.

## 3. Zero runtime dependencies

`devDependencies` lists ajv, parse5, saxes and simple-icons, but the **installed skill
has no `node_modules` at all**. `scripts/generate-validators.mjs` compiles the JSON
Schemas with ajv at build time into `renderers/shared/generated-validators.mjs`
(422 KB of standalone JavaScript), which is committed. `npm run check:validators`
re-runs the generator and fails if the committed output would change.

The skill therefore runs from a bare copy with nothing but Node >= 18.
hydraulify copies this pattern verbatim.

## 4. Layout: two different answers

| Type | Placement |
|---|---|
| `architecture` | The author writes absolute `pos: [x, y]` and `size: [w, h]` per component. The renderer only routes lines between them. |
| `workflow` v2 | A 4400-line compiler solves placement from lanes and edges. |

The remaining types are structurally constrained (columns, rails, bands) and need
no solver. hydraulify follows the `architecture` answer: authored coordinates,
renderer-owned routing.

## 5. Routing (the part hydraulify vendors)

`renderers/shared/geometry.mjs` (1423 lines) provides the primitives:

- `rectsOverlap`, `segmentIntersectsRect`, `segmentRectClearance` — collision tests
- `normalizeRoutePoints` — dedupe + collapse collinear runs, the determinism workhorse
- `routeHonorsEndpointSides` — enforces that a route leaves and enters perpendicular to its declared side
- `cleanCrossingProblems`, `collectAmbiguousCorridors`, `cleanBorderRunProblems`,
  `collectRouteRhythmIssues` — diagnosable layout-quality rules
- `anchor(rect, side)` — **side midpoints only**
- `automaticPortSpread`, `automaticPortRhythmBridge` — fan several relationships off one side

`renderers/architecture/render-architecture.mjs` adds candidate-route generation:
`outwardStub` (24 px perpendicular escape), `sideAwareBridgeCandidates` (dogleg and
outside-channel candidates, filtered by endpoint-side honesty and backtrack checks),
`routeClearsComponents`, `portHasCornerClearance`, `alignFacingPorts`.

**The one thing that does not transfer:** `anchor()` assumes a port is the midpoint of a
rectangle side. A hydraulic symbol has several named ports at specific coordinates on
the same side (a 4/3 valve has P and T on opposite faces, A and B beside them). hydraulify
supplies port anchors from its symbol definitions and feeds them into the same candidate
generator, which never needed `anchor()` to be a midpoint — only to be a point plus a side.

## 6. Viewer

`assets/template.html` is a 774 KB self-contained HTML document with sentinels that
`renderers/shared/utils.mjs#applyTemplate` substitutes:

- `ARCHIFY:SVG_SLOT`, `ARCHIFY:CARDS_SLOT`, subtitle slot, i18n and guided-views placeholders
- forces `<html lang=".." data-theme="dark" data-preset="..">`

Its features light up only when the injected SVG carries archify's conventions:
`data-focus` (47 call sites), `data-edge` (173), `.node-*` classes (46). Toolbar:
theme, visual presets, motion, export, node finder, overview map, focus panel,
upstream/downstream reach, route probe, semantic lens, presentation, diagram guide,
guided story chapters.

hydraulify first vendored this template and hid the controls with no hydraulic
meaning (visual presets, motion, brand marks, repository evidence). It no longer
does: the template draws a static SVG and indexes it once at load, and its
exports keep only CSS rules with archify's selector prefixes, which silently
dropped every schematic style from every export. It was replaced by a native
viewer and editor that runs hydraulify's own modules in the page. See
[decisions.md](decisions.md) §Editor.

## 7. Delivery discipline

- `validate` during repair, `deliver` once for acceptance.
- `deliver` freezes the exact specification bytes into a private snapshot, renders and
  checks that snapshot, atomically commits the output, and reports SHA-256 plus byte
  counts for both specification and artifact.
- A failed delivery preserves the previous artifact and produces no new one.
- A non-zero exit may never be described as success.
- `visual-check` spawns local Chrome over CDP against the delivered HTML and collects
  measurements and screenshots without re-rendering it.
- Three claims are kept strictly separate: deterministic artifact checks, bounded
  browser evidence, and perceptual review by an actual human.

hydraulify adopts all of this.

## 8. Diagnostics contract

`renderers/shared/diagnostics.mjs` gives every failure a machine-readable shape:
`code`, `subject`, `evidence`, `supportedFixes`. The agent is instructed to change only
the diagnosed subject and choose from `supportedFixes`, and to stop after two
non-improving repair rounds rather than thrash. hydraulify adopts the same shape.

## 9. What is architecture-specific and is NOT copied

- component taxonomy (`frontend`/`backend`/`database`/`cloud`/`security`/`messagebus`/`external`)
- brand marks / Simple Icons integration (`brands`, `brand-marks/`, 2003-line generated catalog)
- `guide` (diagram-type router — hydraulify has one type)
- `migrate` (v1->v2 workflow schema migration — nothing to migrate yet)
- `compare` (1223-line base/head architecture delta — valuable as a future circuit diff, out of v1 scope)
- the update checker (`scripts/check-update.mjs`, `skill-release.json`) — hydraulify has no release channel
- visual presets, boundaries/regions, guided story chapters, repository evidence

## 10. Environment verified during inspection

| Fact | Value |
|---|---|
| Node | v20.18.1 |
| npm | 10.8.2 (registry reachable, ajv 8.20.0 resolvable) |
| Python | 3.14.4 (not required) |
| Chrome | `C:\Program Files\Google\Chrome\Application\chrome.exe` — `visual-check` is testable |
| git | 2.46.0.windows.1 |
| Codex | no `~/.codex`, no `AGENTS.md` anywhere — Codex support rests on construction, not on an observed run |
