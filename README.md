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

## Installation

There is nothing to build and nothing to fetch. The schema validator is
committed, the viewer template is vendored, and the runtime needs no packages.
Installing means putting the directory where your agent looks for skills.

### Claude Code

Copy the tracked files into the skills directory. `git archive` is the right
tool here -- it takes exactly what is committed, leaving `node_modules`, local
scratch files and `.git` behind:

```bash
mkdir -p ~/.claude/skills/hydraulify && git archive HEAD | tar -x -C ~/.claude/skills/hydraulify
```

On Windows PowerShell, without `tar`:

```powershell
git archive --format=zip HEAD -o "$env:TEMP\hydraulify.zip"; Expand-Archive "$env:TEMP\hydraulify.zip" -DestinationPath "$env:USERPROFILE\.claude\skills\hydraulify" -Force
```

Use `.claude/skills/hydraulify` inside a project instead of `~/.claude/skills`
to scope the skill to that project. Either way, start a new session afterwards:
skills are discovered at startup, so an already-running one will not see it.

### Codex

Codex reads `AGENTS.md`, which is generated from the same instruction source as
`SKILL.md` and ships in the same directory. Put the skill inside the repository
you are working in:

```bash
mkdir -p tools/hydraulify && git archive HEAD | tar -x -C tools/hydraulify
```

This path is supported by construction rather than by observation -- see the
limitations at the bottom.

### As a plain CLI

No agent required. Clone it anywhere and call the entry point:

```bash
node /path/to/hydraulify/bin/hydraulify.mjs examples
```

Or put it on your `PATH`:

```bash
npm link
hydraulify doctor
```

### Verify

```bash
node bin/hydraulify.mjs doctor
```

Seven checks: the Node version, the committed validator and its freedom from
runtime dependencies, the viewer template and that it is readable, the
examples, and whether a local Chrome exists. Chrome is the only optional one --
everything except `visual-check` works without it.

## Usage

### From an agent

Describe the system. The skill triggers on hydraulic circuits, schematics,
power units, topology checks and bills of materials:

> Draw me a circuit for a single-acting clamp cylinder: fixed-displacement
> pump, 3/2 solenoid valve, relief set at 160 bar, vented tank.

The agent writes the model, validates it, repairs what the diagnostics name,
and only then produces artifacts. If a choice that changes how the circuit
behaves is missing -- valve configuration, centre condition, actuation, single-
versus double-acting -- it asks before guessing.

### From the command line

Three steps: write a model against the schema, validate it, deliver it.

```bash
# 1. start from a sketch with no positions, or from an example
node bin/hydraulify.mjs scaffold sketch.json model.json

# 2. validate; this writes nothing at all
node bin/hydraulify.mjs validate model.json

# 3. write every artifact, with a SHA-256 receipt for each
node bin/hydraulify.mjs deliver model.json out.svg \
  --html out.html --report out.validation.md --bom out.bom.md
```

Step 2 is the loop. Findings name the component, the port and the fix; repair
only what is named, then validate again. An error means nothing was drawn --
the exit code is 1 and any previous artifact is left untouched.

A model small enough to read, and complete enough to render:

```json
{
  "schema_version": 1,
  "diagram_type": "hydraulic_circuit",
  "meta": { "title": "Clamp circuit", "units": "si" },
  "components": [
    { "id": "T1", "type": "reservoir", "pos": [60, 540] },
    { "id": "P1", "type": "pump", "pos": [28, 410],
      "config": { "pump_type": "fixed_displacement", "drive": "electric_motor" },
      "params": { "flow_lpm": 20 } }
  ],
  "connections": [
    { "id": "suction", "from": "T1.outlet", "to": "P1.inlet", "line": "suction" }
  ],
  "assumptions": []
}
```

Two rules carry most of the weight. Connections are **port to port** --
`P1.outlet` to `V1.P`, never "pump to valve" -- and a port takes exactly one
line, so every branch is an explicit `junction` component.

### Imperial output

The model keeps whatever was authored. Conversion happens at render time only,
rounded to the significant figures of the source and marked with a tilde:

```bash
node bin/hydraulify.mjs render model.json out-imperial.svg --units imperial
```

One unit system per artifact, so each file stays diffable. Ship both if a
review needs both.

### Inspecting and checking

```bash
node bin/hydraulify.mjs inspect model.json            # anchors, sides, routes
node bin/hydraulify.mjs check out.svg                 # structure, no inline colour
node bin/hydraulify.mjs visual-check out.html --png shot.png
node bin/hydraulify.mjs demo tmp/                     # render all five examples
```

`inspect` is the artifact to diff when a layout changes: it reads as "C1.rod
anchor moved 3px", where an SVG diff shows only changed path data.

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

`--help` prints the full usage with every flag. `validate`, `deliver` and
`visual-check` take `--json` for machine-readable output; `bom` writes its JSON
to a path with `--json-out`.

## Examples

```bash
node bin/hydraulify.mjs examples          # list them
node bin/hydraulify.mjs demo tmp/         # render all five
```

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

Read `references/schema.md` to write a model, `references/symbols.md` for what
each symbol expects, `references/validation.md` for what a diagnostic means,
and `references/authoring.md` for placement and routing.

## Development

```bash
npm install                  # ajv, for regenerating the validator only
npm run generate:validators  # after changing the schema
npm run generate:docs        # after changing docs/shared-instructions.md
npm test                     # everything, including both drift checks
```

`ajv` is a development dependency only. It compiles the schema into the
committed `renderers/shared/generated-validators.mjs`, and the generator fails
if any `require` survives into that file -- which is what keeps the installed
skill free of `node_modules`.

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
