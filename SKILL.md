---
name: hydraulify
description: Turn a natural-language description of a hydraulic system or compressed-air energy storage plant into a validated, port-aware circuit model and an ISO 1219-style schematic, rendered as a deterministic SVG plus a standalone HTML viewer and editor, with a validation report and a bill of materials. Use when the user asks for a hydraulic circuit, schematic or power-unit diagram (or to edit one), a compressed-air storage (CAES) or turbine/compressor plant diagram, wants a model validated or its topology checked, or asks for a BOM. Covers reservoirs, pumps, motors, cylinders, directional valves (2/2 to 4/3, all four centres), relief, check, pilot-operated check, counterbalance and flow control valves, filters, gauges, accumulators (incl. air/water and nitrogen-bottle), turbines, compressors, motor-generators on clutched shafts, heaters and coolers, air receivers, regulators, shut-off valves, silencers and boundary terminals, on oil, water, thermal oil, air, nitrogen, steam and flue gas lines.
license: MIT
metadata:
  version: "0.1"
  based_on: archify by tt-a1i (MIT) - routing geometry
---

# hydraulify

Natural language in, engineering schematic out. You write the circuit model; a
deterministic renderer draws it.

Run every command from the skill directory, or give the full path to
`bin/hydraulify.mjs`. Node 18 or newer, nothing to install.

## Asking a clarifying question

Use `AskUserQuestion` when one of the load-bearing choices below is left
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
- Line types: `suction`, `pressure`, `working`, `return`, `drain`, `pilot`,
  and `mechanical` for a shaft. A control line must be typed `pilot`, or it
  will be drawn as a working line and the drawing will state something the
  circuit does not do.
- A component that has to pass flow right to left takes `"mirror": true`.
  Symbols are never rotated.

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

# Fluids, compressed air and shafts

A drawing can carry more than one fluid: oil, water, thermal oil, air,
nitrogen, steam, flue gas. **Never write a medium on a line.** Ports declare
what they accept and each connected run settles on what its ports agree on; a
run nothing narrows is oil, which is why every hydraulic model is unchanged.
Where a run could be anything, state it on the component that knows:

- `heat_exchanger`: `function` (`heating` or `cooling`) and `utility_medium`,
  the fluid on the heating or cooling side. The process side is whatever flows
  through `in` and `out`.
- `boundary`: where a line enters or leaves the drawing -- ambient air, a
  stack, cooling water, thermal storage, another sheet. `direction` (`from` or
  `to`) and `name` are required; `medium` if nothing else settles it. Utility
  lines end on boundaries rather than on drawn plant.
- `accumulator`: `gas_port: true` draws the gas side as a port, `gas` (`air`
  or `nitrogen`) and `liquid` (`oil` or `water`) name the two sides, and
  `accumulator_type: "none"` is direct contact, gas over liquid, as in a
  water-compensated air store.
- `air_receiver`: `gas: "nitrogen"` with `single_port: true` is a back-up
  bottle on an oil accumulator's gas side.
- `reservoir`: `liquid: "water"` for a basin or water tank.

Two fluids that meet on one run are refused (`media/conflict`), not blended.
In a drawing with more than one fluid the renderer prints the medium on lines
where the fluid changes and on long runs; nothing has to be added for that.

Shafts are connections with `"line": "mechanical"`, shaft port to shaft port,
never through a junction. Add `"clutch": true` for a disengageable coupling.
Power is drawn left to right: a turbine's shaft is on its right, a compressor's
on its left, and a motor-generator (`electrical_machine` with `role:
"motor_generator"`) has one each side, so it can sit between a turbine and a
compressor. A compressor has one shaft end, so a second stage needs its own
driver. Every shaft train needs something that drives it.

`meta.machine_style: "iso10628"` draws the turbine as the process-plant
trapezoid; the default, `iso1219`, draws it in the fluid-power form. Only the
turbine changes, and the title block says so.

Air flow is stated as normal volume (`flow_nm3h`) or mass (`mass_flow_kgs`),
never both; machines take `power_kw`, and temperatures `temperature_c`.

`examples/06-caes-plant.json` is a complete compressed-air storage plant and
`examples/07-nitrogen-backup.json` an oil circuit with a nitrogen bottle: read
the one that matches before placing a plant of that kind.

# Never invent engineering values

If the description does not state a pressure, flow, displacement, bore, stroke,
relief setting, power, temperature or air flow, **leave it out**. Do not
estimate, do not use a typical value, do not carry one over from an example.
Write `null` when the description says a value is unknown; omit the field when
it was simply never mentioned. Both appear in the validation report as
unspecified, which is the honest outcome.

Do not add components either. A circuit gets a filter, a gauge or an accumulator
only if the description asks for one. Good practice would add filtration to
almost any circuit; adding it uninvited puts hardware in the bill of materials
that nobody asked to buy. Missing filtration is reported, not silently corrected.

Units are stored exactly as authored in a unit-suffixed field (`setting_bar` or
`setting_psi`, never both for one quantity). Conversion happens only at render
time via `--units`, is marked with a tilde, and is never written back.

# Ambiguity

These choices change how the circuit behaves and have no safe default. When
the description leaves one open, ask before drawing:

- directional valve configuration (2/2, 3/2, 4/2, 4/3)
- centre condition for a three-position valve (closed, open, tandem, float)
- actuation (solenoid, lever, push button, pedal, mechanical, pilot, and springs)
- single-acting versus double-acting cylinder

For a compressed-air plant, two more:

- heat source for preheating before expansion: combustion (`flue_gas`, a
  diabatic plant), stored compression heat (`thermal_oil` or `water` from a
  thermal store, an adiabatic plant), or none
- shaft arrangement: one motor-generator shared through clutches, or a
  separate motor on the compressor and generator on the turbine

The accumulator's separating element and the turbine's drawing style are not
asked: they take the defaults (direct contact for a water-compensated store,
ISO 1219 form for the turbine) and are recorded as assumptions.

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

# When the drawing has been edited

The `.html` artifact is also an editor: people move parts, draw lines and
change parameters there, and save `model.json`. Once they have, that file is
the source again. Read it, validate it, and `deliver` it to regenerate the
SVG, report and bill of materials -- the page never updates those itself.
Never edit the HTML, and never rebuild the model from the original
description after someone has edited it: their work would be lost.

# What to claim

The output is an "ISO 1219-style hydraulic schematic". It is never certified and
never safe. Describe a passing result as topologically consistent with the
information provided. Raise the engineering concerns that the specific circuit
raises -- relief settings, load holding, stored energy in an accumulator or an
air store, hot surfaces on a preheater -- and leave out the ones it does not.

Report the artifact paths, the validation status, the counts, and anything left
unspecified. Do not claim a visual review that was not performed: `check` proves
structure and `visual-check` proves the editor started, but whether a spool arrow
points the right way needs a human or an image-capable reviewer.

<!-- END SHARED -->

## Going deeper

Read these only when you need them:

- `references/schema.md` - every field, with the rules the schema enforces
- `references/symbols.md` - each symbol, its ports and its drawing conventions,
  plus how to add a new one
- `references/validation.md` - every rule, its severity and why it is graded that way
- `references/authoring.md` - placement, routing, `via` waypoints, reading a
  layout report, and the HTML viewer and editor
