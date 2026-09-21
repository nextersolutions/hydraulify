---
name: hydraulify
description: Turn a natural-language description of a hydraulic system into a validated, port-aware circuit model and an ISO 1219-style schematic, rendered as a deterministic SVG plus an explorable standalone HTML viewer, with a validation report and a bill of materials. Use when the user asks for a hydraulic circuit, schematic or power-unit diagram, wants an existing hydraulic model validated or its topology checked, or asks for a BOM from a circuit. Covers reservoirs, pumps, motors, cylinders, directional control valves (2/2, 3/2, 4/2, 4/3 with closed, open, tandem and float centres), relief, check, pilot-operated check, counterbalance and flow control valves, filters, gauges and accumulators.
license: MIT
metadata:
  version: "0.1"
  based_on: archify by tt-a1i (MIT) - routing geometry and viewer template
---

# hydraulify

Natural language in, engineering schematic out. You write the circuit model; a
deterministic renderer draws it.

Run every command from the skill directory, or give the full path to
`bin/hydraulify.mjs`. Node 18 or newer, nothing to install.

## Asking a clarifying question

Use `AskUserQuestion` when one of the four load-bearing choices below is left
open by the description. Put the options as concrete choices (for a centre
condition: closed, open, tandem, float), with the consequence of each in its
description. Ask once, covering every open choice in the same call, rather than
returning to the user repeatedly.

If the session is not interactive, do not stop: apply the documented defaults,
record each as an assumption, and say plainly in your response that those
choices were made without confirmation.

<!-- BEGIN SHARED: generated from docs/shared-instructions.md, do not edit here -->

# Pipeline

Never write SVG. Write the model; the renderer draws it.

```
description -> hydraulic model (you) -> validate -> layout -> schematic (the renderer)
```

The model is the source of truth. The drawing is a representation of it. Keep the
layers separate: if a drawing is wrong, the model or the positions are wrong.

# Fast path

1. Write `<name>.json` against `schemas/hydraulic-circuit.schema.json`. The
   artifact comes first: write the model before reading anything else.
2. `node bin/hydraulify.mjs validate <name>.json`
3. Repair only what the diagnostics name, then validate again.
4. `node bin/hydraulify.mjs deliver <name>.json <name>.svg --html <name>.html --report <name>.validation.md --bom <name>.bom.md`

A non-zero exit is never a success. An error means nothing was drawn: say so
rather than describing a schematic that does not exist.

# The model in one minute

```json
{
  "schema_version": 1,
  "diagram_type": "hydraulic_circuit",
  "meta": { "title": "...", "units": "si" },
  "components": [
    { "id": "T1", "type": "reservoir", "pos": [60, 540], "params": { "volume_l": 100 } },
    { "id": "P1", "type": "pump", "pos": [28, 410],
      "config": { "pump_type": "fixed_displacement", "drive": "electric_motor" },
      "params": { "flow_lpm": 20 } }
  ],
  "connections": [
    { "id": "suction", "from": "T1.outlet", "to": "P1.inlet", "line": "suction" }
  ],
  "assumptions": [
    { "subject": "V1", "statement": "...", "rationale": "..." }
  ]
}
```

- Connections are **port to port**, written the way the ports are named:
  `P1.outlet` to `V1.P`. Never component to component.
- A port takes **one** line. Anything that branches goes through an explicit
  `junction` component, whose ports are named after the side a line approaches
  from: `J1.left`, `J1.right`, `J1.top`, `J1.bottom`.
- `pos` is required, and is the top-left of the symbol's frame. There is no
  automatic layout. Use `node bin/hydraulify.mjs scaffold` to get provisional
  positions from an unpositioned model, then move things so the circuit reads.
- Line types: `suction`, `pressure`, `working`, `return`, `drain`, `pilot`.
  A control line must be typed `pilot`, or it will be drawn as a working line
  and the drawing will state something the circuit does not do.

# Components

`reservoir`, `pump`, `motor`, `cylinder`, `directional_control_valve`,
`relief_valve`, `check_valve`, `pilot_operated_check_valve`,
`counterbalance_valve`, `flow_control_valve`, `filter`, `pressure_gauge`,
`accumulator`, `junction`.

Compressed-air plant: `turbine`, `compressor`, `electrical_machine`,
`heat_exchanger`, `air_receiver`, `pressure_regulator`, `shut_off_valve`,
`silencer`, `boundary`.

Anything else is refused rather than drawn as a labelled box. If a description
needs a component that is not here, say so and either model the function with
what exists (recording that as an assumption) or state that it cannot be drawn.

Port names per component are in `references/symbols.md`. The ones worth knowing
by heart:

| Component | Ports |
| --- | --- |
| reservoir | `outlet` (suction), `return` |
| pump / motor | `inlet`, `outlet`, optional `case_drain` |
| cylinder | `cap`, `rod` (aliases `A`, `B`); single-acting has `cap`, `vent` |
| directional valve | `P`, `T`, `A`, `B` (fewer for 2/2 and 3/2) |
| relief valve | `inlet` (top), `outlet` (bottom), optional `pilot` |
| counterbalance | `inlet` (valve side), `outlet` (load side), `pilot` |
| pilot-operated check | `inlet`, `outlet`, `pilot` |
| flow control / filter / check | `inlet`, `outlet` |
| gauge / accumulator | `inlet`; an accumulator with `gas_port` adds `gas` |
| turbine | `inlet`, `exhaust`, `shaft` (right) |
| compressor | `inlet`, `outlet`, `shaft` (left) |
| electrical machine | `shaft`; a motor-generator has `shaft_a`, `shaft_b` |
| heat exchanger | `in`, `out`, `utility_in`, `utility_out` |
| air receiver | `inlet`, `outlet`; `single_port` has `port` |
| regulator / shut-off valve | `inlet`, `outlet` |
| silencer | `inlet` |
| boundary | `port` |

# Never invent engineering values

If the description does not state a pressure, flow, displacement, bore, stroke
or relief setting, **leave it out**. Do not estimate, do not use a typical value,
do not carry one over from an example. Write `null` when the description says a
value is unknown; omit the field when it was simply never mentioned. Both appear
in the validation report as unspecified, which is the honest outcome.

Do not add components either. A circuit gets a filter, a gauge or an accumulator
only if the description asks for one. Good practice would add filtration to
almost any circuit; adding it uninvited puts hardware in the bill of materials
that nobody asked to buy. Missing filtration is reported, not silently corrected.

Units are stored exactly as authored in a unit-suffixed field (`setting_bar` or
`setting_psi`, never both for one quantity). Conversion happens only at render
time via `--units`, is marked with a tilde, and is never written back.

# Ambiguity

Four choices change how the circuit behaves and have no safe default. When the
description leaves one open, ask before drawing:

- directional valve configuration (2/2, 3/2, 4/2, 4/3)
- centre condition for a three-position valve (closed, open, tandem, float)
- actuation (solenoid, lever, push button, pedal, mechanical, pilot, and springs)
- single-acting versus double-acting cylinder

Everything else takes a documented default. Every default that gets applied must
be recorded in `assumptions`, which is printed on the drawing itself as well as
in the report, because an SVG pasted into a document arrives without the report.

When there is no one to ask -- a scripted run, a batch job -- do not stop. Apply
the documented defaults, record every one as an assumption, and say clearly in
the response that the choices were made without confirmation.

# Reading the diagnostics

Each finding carries a `code`, the `subject` to change, the `evidence` behind it,
and `supportedFixes`. Change only the diagnosed subject and choose from the
offered fixes. If two focused repairs do not reduce the error count, stop and
report what is unresolved instead of continuing to edit.

| Severity | Meaning |
| --- | --- |
| error | the topology is clearly invalid; nothing is drawn |
| warning | it may be valid, but something is suspicious or unspecified |
| info | a design decision is missing but it does not prevent drawing |

Common ones: `topology/port-overloaded` means a branch needs a junction;
`topology/required-port-unconnected` means a component cannot function as drawn;
`layout/route-crosses-symbol` means a component sits in the corridor between two
ports and something has to move, or the route needs explicit `via` waypoints.

# What to claim

The output is an "ISO 1219-style hydraulic schematic". It is never certified and
never safe. Describe a passing result as topologically consistent with the
information provided. Raise the engineering concerns that the specific circuit
raises -- relief settings, load holding, stored energy in an accumulator -- and
leave out the ones it does not.

Report the artifact paths, the validation status, the counts, and anything left
unspecified. Do not claim a visual review that was not performed: `check` proves
structure and `visual-check` proves the viewer loaded, but whether a spool arrow
points the right way needs a human or an image-capable reviewer.

<!-- END SHARED -->

## Going deeper

Read these only when you need them:

- `references/schema.md` - every field, with the rules the schema enforces
- `references/symbols.md` - each symbol, its ports and its drawing conventions,
  plus how to add a new one
- `references/validation.md` - every rule, its severity and why it is graded that way
- `references/authoring.md` - placement, routing, `via` waypoints, reading a
  layout report, and working with the HTML viewer
