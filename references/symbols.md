# Symbols

Fourteen entries: thirteen drawable components plus the junction. Each is one
module under `renderers/symbols/`, owning its frame size, its port coordinates
and its graphics together, so a port can never drift away from the graphic it
belongs to.

Render the review sheet to see them all at a readable scale, with every port
anchor marked:

```bash
node scripts/symbol-sheet.mjs tmp/sheet.svg
node scripts/symbol-sheet.mjs tmp/valves.svg directional
```

## Port criticality

Each port declares what an unconnected instance means:

| Criticality | Unconnected | Examples |
| --- | --- | --- |
| `required` | error, nothing is drawn | cylinder `cap`/`rod`, pump `inlet`/`outlet`, counterbalance `pilot` |
| `expected` | warning | directional valve `A`/`B` |
| `optional` | silent | relief `pilot`, pump `case_drain`, reservoir ports |

A four-way valve is sometimes deliberately used as a three-way with one working
port plugged, which is why `A` and `B` are `expected` rather than `required`. A
cylinder with a dead rod port cannot work at all, so those are `required`.

Anything genuinely blanked off in the assembly can be marked
`"ports": { "<name>": { "plugged": true } }`, which silences the finding without
inventing a connection.

## The components

| Type | Ports | Configuration |
| --- | --- | --- |
| `reservoir` | `outlet`, `return` | `vented`, `same_reservoir_as`, `liquid` |
| `pump` | `inlet`, `outlet`, `case_drain` | `pump_type`, `drive`, `bidirectional`, `has_case_drain` |
| `motor` | `inlet`/`outlet`, or `A`/`B` when bidirectional | `motor_type`, `bidirectional`, `has_case_drain` |
| `cylinder` | `cap`, `rod` (aliases `A`, `B`); `cap`, `vent` when single-acting | `cylinder_type`, `rod`, `spring_return`, `cushioned` |
| `directional_control_valve` | `P`, `T`, `A`, `B` | `configuration`, `center_condition`, `normal_position`, `actuation` |
| `relief_valve` | `inlet` (top), `outlet` (bottom), `pilot` | `pilot_operated`, `remote_pilot` |
| `check_valve` | `inlet`, `outlet` | `spring_loaded` |
| `pilot_operated_check_valve` | `inlet`, `outlet`, `pilot` | `pilot_action`, `drained` |
| `counterbalance_valve` | `inlet` (valve side), `outlet` (load side), `pilot` | `pilot_type`, `vented` |
| `flow_control_valve` | `inlet`, `outlet` | `flow_control_type`, `free_flow_direction` |
| `filter` | `inlet`, `outlet` | `position`, `with_bypass`, `with_indicator` |
| `pressure_gauge` | `inlet` | `with_isolator` |
| `accumulator` | `inlet`; plus `gas` on top with `gas_port` | `accumulator_type` (incl. `none`), `gas_port`, `liquid` |
| `junction` | `left`, `right`, `top`, `bottom` | `way` |

## Drawing conventions fixed by this library

These are choices where more than one representation is defensible. They are
written down so the drawing is consistent and so a reviewer knows what they are
looking at.

**Reservoir.** Vented is an open-topped vessel; pressurised is closed. The
suction line runs down below the fluid level and the return line stops above
it, which is how a reader tells them apart. A tank may be drawn more than once
to keep return lines short; `same_reservoir_as` marks the repeats so the bill of
materials counts one vessel.

**Pump and motor.** The solid triangle points out of a pump and into a motor.
That triangle is the only thing distinguishing the two symbols.

**Relief valve.** Flow runs top to bottom, so it can be tapped off a pressure
line above and discharge to a reservoir below. The arrow inside the envelope is
offset from the port line, which is what says the path is blocked at rest. The
internal pilot runs as a long-dashed leg beside the envelope, sensing inlet
pressure against the spring.

**Check valve.** The seat is drawn on the inlet side of the ball: forward flow
lifts the ball off it, reverse flow pushes the ball onto it.

**Directional control valve.** Ports attach to the envelope that is aligned with
them at rest -- the middle envelope when spring-centred, the envelope beside the
spring on a two-position valve. P is bottom-left, T bottom-right, A top-left, B
top-right. On multi-position valves the leftmost working envelope is parallel
(P to A, B to T) and the rightmost is crossed (P to B, A to T). Centre
conditions: `closed` blocks all four; `open` joins all four; `tandem` joins P to
T with A and B blocked; `float` joins A, B and T with P blocked.

**Accumulator.** The gas side is sealed and not drawn unless `gas_port` is set,
which adds a `gas` connection on top of the shell. That port carries air and
sits in its own port group, so the gas side and the liquid side resolve their
fluids independently. A declared gas port is required, and spring- and
weight-loaded types cannot have one: they contain no gas. `accumulator_type:
none` is direct contact, drawn as a free liquid surface with the level marker,
for stores where air sits straight on water.

**Counterbalance valve.** A pilot-assisted relief in one leg and a bypass check
in the other, inside a dash-dot enclosure because they are one cartridge. Free
flow is `inlet` to `outlet` through the check; load-holding flow is `outlet` to
`inlet` through the relief.

## Line types

ISO 1219 distinguishes three, and so does this renderer:

| Drawn | Meaning | Model line types |
| --- | --- | --- |
| continuous | working lines | `suction`, `pressure`, `working`, `return` |
| long dash | pilot / control | `pilot` |
| short dash | drain / leakage | `drain` |

Pressure and return are **not** given different styles or colours. ISO does not
distinguish them graphically, and a reader who knows the standard would read a
non-standard style as meaning something else. They are told apart by topology,
by the flow arrows and by the labels. A dash-dot enclosure marks a unit built
from several elements.

## Adding a symbol

1. Create `renderers/symbols/<name>.mjs` exporting `type`, `defaults`,
   `geometry(config)`, `draw(ctx)` and `describe(component)`.
2. Declare ports with `port(id, x, y, side, { criticality })` from
   `contract.mjs`. Coordinates are local to the frame, and a port must sit **on**
   the edge it names, or lines will visibly detach from the symbol.
3. Draw using the primitives in `renderers/shared/svg.mjs` and the sub-glyphs in
   `renderers/symbols/glyphs.mjs`. Use semantic classes only -- never an inline
   colour, or the symbol will not invert in the viewer's dark theme.
4. Register the module in `renderers/symbols/index.mjs`.
5. Add the type to the `componentType` enum in the schema, add a `configByType`
   entry for its configuration, and run `npm run generate:validators`.
6. Add a case to `scripts/symbol-sheet.mjs` and look at it. The unit tests check
   that ports sit on their edges and that output is deterministic; no test can
   tell you an arrow points the wrong way.
7. If the component has a conventional placement in a circuit, add it to the
   band table in `scaffold/index.mjs`.

## Adding a component type without a new symbol

Do not. An unrecognised `type` is refused with the list of supported types,
deliberately: a labelled box on an ISO drawing looks authoritative and says
nothing about what the component does, which is worse than an honest error.
