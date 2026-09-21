# Model schema

The canonical definition is `schemas/hydraulic-circuit.schema.json`; this
document explains the parts whose reasoning is not obvious from the JSON.

## Top level

| Field | Required | Notes |
| --- | --- | --- |
| `schema_version` | yes | `1` |
| `diagram_type` | yes | `"hydraulic_circuit"` |
| `meta` | yes | title, and optional subtitle, units, viewBox, drawing number, revision |
| `components` | yes | at least one |
| `connections` | yes | may be empty, though a circuit with no lines will fail topology validation |
| `assumptions` | no | every engineering choice not stated by the user |
| `notes` | no | free text carried with the model, not drawn |

`meta.units` selects the unit system used when rendering (`si` or `imperial`).
It never changes what is stored.

`meta.viewBox` pins the canvas. Leave it out: the renderer sizes the canvas from
the drawing and reserves bands for the title block and the assumptions, which a
hand-set viewBox will usually get wrong.

## Components

```json
{
  "id": "RV1",
  "type": "relief_valve",
  "pos": [196, 330],
  "label": "Main relief",
  "mirror": false,
  "config": { "remote_pilot": true },
  "params": { "setting_bar": 180 },
  "ports": { "pilot": { "plugged": true } },
  "note": "Set on commissioning"
}
```

- `id` is the tag printed on the drawing (`P1`, `RV1`, `V1`). Keep it stable:
  regenerating a model with different ids makes every diff unreadable.
- `pos` is the **top-left of the symbol frame**, not its centre, and is required.
- `config` holds the choices that change what is drawn. Allowed keys differ per
  type and are enforced: a key that belongs to another component type is
  rejected rather than ignored, because a silently ignored field looks like it
  took effect.
- `params` holds engineering values. See below.
- `ports` overrides individual ports. `plugged: true` states that a port is
  blanked off in the real assembly, which silences the unconnected-port finding
  for it.
- `mirror` flips the symbol horizontally, for an in-line component that has to
  pass flow right to left.

There is no rotation. Rotating a symbol means remapping its ports, its label
anchor and its frame dimensions, and a half-implemented rotation would put ports
where lines do not meet them. ISO permits drawing a symbol in its canonical
orientation, so components are drawn as defined and the circuit is laid out
around them. `mirror` covers the case that actually comes up.

## Parameters and units

Every quantity has an SI and an imperial field name:

| Quantity | SI | Imperial |
| --- | --- | --- |
| pressure | `_bar` | `_psi` |
| flow | `_lpm` | `_gpm` |
| length | `_mm` | `_in` |
| volume | `_l` | `_gal` |
| displacement | `_cm3_rev` | `_in3_rev` |
| temperature | `_c` | `_f` |
| power | `_kw` | `_hp` (mechanical, 745.7 W) |
| gas volume flow | `flow_nm3h` | `flow_scfm` |
| gas mass flow | `mass_flow_kgs` | `mass_flow_lbs` |

Full set: `setting`, `cracking_pressure`, `max_pressure`, `precharge`, `range`,
`flow`, `displacement`, `volume`, `bore`, `rod`, `stroke`, `temperature`,
`power`, `mass_flow`, plus the system-independent `rating_micron`, `speed_rpm`
and `pilot_ratio`.

`flow_lpm` / `flow_gpm` is liquid flow and `flow_nm3h` / `flow_scfm` is gas
flow: the suffix decides which, so a heat exchanger can state its cooling water
in L/min and its process air in Nm3/h side by side.

**Gas volume is at reference conditions, and the two systems use different
ones.** `flow_nm3h` is normal cubic metres per hour at 0 degC and 1.01325 bar
(DIN 1343); `flow_scfm` is standard cubic feet per minute at 60 degF and 14.696
psia. The conversion applies the temperature ratio -- skipping it is a 5.7%
error. CAGI's 68 degF scfm, common on compressor datasheets, is a different
unit again: if a source quotes it, record the value in the model's note rather
than as `flow_scfm`.

Two rules the schema enforces:

- **One unit per quantity.** `setting_bar` and `setting_psi` on the same
  component is rejected. Two spellings of one value is two values that can
  disagree.
- **A gas flow is stated once.** Normal volume flow or mass flow, never both on
  one component: they are two statements of one fact that can disagree, and
  deriving one from the other needs a gas density the model does not have.
- **A value is a positive number or `null`.** `null` means explicitly unknown,
  and is reported as such. Omitting the field means it was never mentioned.
  Both are honest; a substituted value is not. Temperature is the exception to
  positive: it may be zero or negative, down to absolute zero.

Conversion happens only when rendering with `--units`, is rounded to the
significant figures of the source, and is marked with a tilde: 180 bar renders
as `~2610 psi`, never `2610.69 psi`, because the second states a precision
nobody gave.

Temperature rounds differently. Its conversion has an offset, and significant
figures do not survive one -- 0 degC has one figure, and 32 degF rounded to one
figure prints 30. A temperature keeps the resolution of its source instead:
whole degrees in, whole degrees out, so 20 degC renders as `~68 degF`.

## Connections

```json
{ "id": "relief-tap", "from": "J1.right", "to": "RV1.inlet", "line": "pressure" }
```

- `from` and `to` are `component.port`, exactly the notation the brief uses.
- `line` is the function: `suction`, `pressure`, `working`, `return`, `drain`,
  `pilot`, or `mechanical` for a shaft between machines. It drives how the line
  is drawn and is checked against the ports it joins.
- There is no `medium` field. The fluid a line carries is worked out from the
  ports it joins, and defaults to oil; see the Media section of
  `references/validation.md`.
- `label` is printed beside the middle of the line's longest straight run. In a
  drawing with more than one fluid, the medium is appended where one is printed:
  `stage 1 - air`.
- `fromSide` / `toSide` override which face the line leaves by. Rarely needed;
  the port already declares one.
- `via` pins explicit waypoints. Only reach for it after a routing diagnostic
  asks for one.
- `arrow` is `auto` (default), `forward` or `none`. `auto` draws an arrow only
  where flow cannot reverse, so a valve-to-actuator line never gets one. A
  shaft never gets one, whatever `arrow` says: it carries torque, not flow.
- `clutch: true` puts a disengageable coupling on a shaft, drawn as a break
  with two facing plates across the middle of its longest straight run. Only
  on a `mechanical` line; the schema refuses it anywhere else.

A port carries exactly one connection. Branches use a `junction`.

## Assumptions

```json
{ "subject": "V1", "statement": "...", "rationale": "..." }
```

`subject` is a component id, a port reference, or the literal `circuit`. These
are printed on the drawing as well as in the report: an SVG travels into other
documents without the report, and an assumption that can be separated from the
drawing will be.
