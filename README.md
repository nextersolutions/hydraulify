# hydraulify

Turn a description of a hydraulic system into a validated, port-aware circuit
model and an ISO 1219-style schematic.

An agent skill, usable from Claude Code (`SKILL.md`) and Codex (`AGENTS.md`),
and usable on its own as a command-line tool. Node 18 or newer. No install, no
runtime dependencies.

```bash
node bin/hydraulify.mjs validate examples/02-solenoid-cylinder.json
node bin/hydraulify.mjs deliver examples/02-solenoid-cylinder.json out.svg \
  --html out.html --report out.validation.md --bom out.bom.md
```

## What it does

```
description -> circuit model (JSON) -> validation -> layout -> SVG + HTML
```

The model is the source of truth; the drawing is a representation of it. A
language model writes the model. A deterministic renderer draws it, so the same
model always produces the same schematic, and a schematic can be reviewed by
reviewing the model.

Components are connected **port to port** -- `P1.outlet` to `V1.P`, not "pump to
valve" -- so the validator can tell a relief valve's inlet from its pilot, and
the renderer can attach lines to the right places on a symbol.

## What it draws

Thirteen symbols plus an explicit junction: reservoir, pump, motor, cylinder,
directional control valve, relief valve, check valve, pilot-operated check
valve, counterbalance valve, flow control valve, filter, pressure gauge,
accumulator.

Directional valves are drawn properly: 2/2, 3/2, 4/2 and 4/3 with the real flow
paths of each spool position, all four common centre conditions (closed, open,
tandem, float), and drawn actuation -- solenoid, lever, push button, pedal,
mechanical, pilot, with springs.

An unsupported component is refused, with the list of supported ones. A labelled
box on an ISO drawing looks authoritative and communicates nothing, which is
worse than an honest error.

See everything at a readable scale:

```bash
node scripts/symbol-sheet.mjs tmp/sheet.svg
```

## What it will not do

- **Invent engineering values.** No pressure, flow, displacement, bore or relief
  setting is ever estimated. Unstated values are reported as unspecified.
- **Add components nobody asked for.** Filtration missing from a description is
  a note in the report, not a part in the bill of materials.
- **Draw an invalid circuit.** A hard error means no artifact is written and any
  previous one is left alone.
- **Hide an assumption.** Every defaulted engineering choice is recorded in the
  model, in the report, and printed on the drawing itself -- because an SVG
  pasted into a document arrives without the report.
- **Claim more than it checked.** Output is described as topologically
  consistent with the information provided. Never safe, never certified.

## Commands

| Command | Does |
| --- | --- |
| `scaffold` | fill in missing positions with provisional hydraulic bands |
| `validate` | validate and report; writes nothing |
| `render` | write the SVG, optionally the HTML |
| `deliver` | write every artifact with a SHA-256 receipt |
| `bom` | bill of materials as Markdown and JSON |
| `inspect` | layout report: port anchors, sides, routes |
| `preview` | render the HTML and open it |
| `check` | structural checks on a produced artifact |
| `visual-check` | load an artifact in local Chrome and report what happened |
| `examples` / `demo` | list the worked examples, or render them all |
| `doctor` | check the environment |

## Examples

| File | Shows |
| --- | --- |
| `01-basic-circuit` | the minimum circuit, with no parameters stated at all |
| `02-solenoid-cylinder` | the same circuit fully specified, double solenoid |
| `03-motor-flow-control` | motor speed control, gauge, and a recorded substitution |
| `04-load-holding` | counterbalance valve with an external pilot |
| `05-filtered-power-unit` | suction and return filtration, accumulator, mirrored symbol |

## Layout

```
schemas/       the model schema; the committed validator is generated from it
renderers/     symbols, layout, SVG and HTML renderers, vendored geometry
validate/      topology and hydraulic rules, validation report, BOM
scaffold/      provisional band placement
examples/      five worked circuits
references/    deep-dive docs, gated so an agent loads them only when needed
docs/          architecture record, decisions, shared instruction source
test/          116 tests plus goldens
```

## Development

```bash
npm install                  # ajv, for regenerating the validator only
npm run generate:validators  # after changing the schema
npm run generate:docs        # after changing docs/shared-instructions.md
npm test                     # everything, including both drift checks
```

Goldens are regenerated deliberately, not reflexively:

```bash
UPDATE_GOLDENS=1 node --test test/render.test.mjs
```

Read the diff before committing. A golden that changes for a reason nobody
checked protects nothing.

## Credit and limitations

Built on the conventions of [archify](https://github.com/tt-a1i/archify) by
tt-a1i (MIT): its routing geometry and its viewer template are vendored here,
with the adaptations noted in `docs/archify-architecture.md`.

Known limitations:

- **No layout solver.** Positions are authored. `scaffold` gives a crude
  starting point; a component sitting in a corridor between two ports has to be
  moved by hand.
- **No rotation.** Symbols are drawn in their canonical orientation; `mirror`
  handles the in-line right-to-left case.
- **No calculation.** No sizing, no pressure drop, no simulation.
- **Codex support is by construction**, not by observation: the skill is plain
  Node with no host-specific APIs and ships an `AGENTS.md`, but it has not been
  run under Codex.
- **Symbol correctness is a human check.** Tests prove ports, topology, routing
  and byte-stability. Whether a spool arrow points the right way needs eyes.
