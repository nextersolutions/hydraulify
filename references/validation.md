# Validation rules

Two layers. Schema validation asks whether the model is well formed; if it
fails, nothing else runs, because topology rules applied to a malformed model
produce a cascade of findings that all restate the same structural problem.
Domain validation then asks whether the circuit holds together.

Severity follows the brief's three-way split:

| Severity | Meaning | Consequence |
| --- | --- | --- |
| error | the topology is clearly invalid | nothing is drawn, exit code 1 |
| warning | may be valid, but suspicious or unspecified | drawn, reported |
| info | a design decision is missing | drawn, reported |

## Errors

| Code | Rule |
| --- | --- |
| `schema/*` | the model does not match the schema |
| `model/duplicate-component-id` | two components share an id |
| `model/duplicate-connection-id` | two connections share an id |
| `model/unsupported-component-type` | the type is not in the library |
| `topology/unknown-component` | a port reference names a component that does not exist |
| `topology/unknown-port` | the component has no such port; the finding lists the ones it has |
| `topology/self-connection` | both ends are on the same component |
| `topology/port-overloaded` | more than one line on one port; a branch needs a junction |
| `topology/required-port-unconnected` | a component cannot function as drawn |
| `topology/isolated-component` | a component has no connections at all |
| `topology/junction-degree` | a junction carries a different number of lines than its `way` |
| `hydraulic/line-type-invalid` | a control port carries a line not typed `pilot` |
| `hydraulic/actuator-to-tank` | a cylinder working port is wired straight to the reservoir |
| `hydraulic/pump-to-pump` | a pump delivers into another pump's inlet |
| `media/conflict` | connected ports cannot share one fluid -- air meeting liquid; the finding names the ports on each side |
| `media/mechanical-mismatch` | a shaft joined to a fluid port or a junction, or a line typed against what its ports carry |
| `mechanical/nothing-drives` | a shaft train with no driver (turbine, motor, motor-generator): nothing can turn it |

`hydraulic/line-type-invalid` is an error rather than a warning because the line
type decides how the line is drawn. A pilot line drawn as a working line tells
the reader the circuit does something it does not do, and the drawing is wrong
in a way that looks right.

## Warnings

| Code | Rule |
| --- | --- |
| `topology/port-unconnected` | an `expected` port is dangling |
| `topology/disconnected-subcircuit` | a group of components has no path to the rest |
| `hydraulic/line-type-unexpected` | e.g. a pump inlet fed by a line not typed `suction` |
| `hydraulic/no-reservoir` | liquid lines with no reservoir and no boundary to come from or go to |
| `hydraulic/pump-without-source` | a pump's suction has no traceable path to a reservoir |
| `hydraulic/no-return-path` | a tank with a pump on it, and no line back to it |
| `hydraulic/relief-not-to-tank` | a liquid relief discharges somewhere with no path to tank |
| `pneumatic/relief-not-to-atmosphere` | a gas relief (a receiver's safety valve) vents nowhere open |
| `pneumatic/turbine-without-supply` | nothing upstream of a turbine inlet stores, compresses or brings in air |
| `pneumatic/exhaust-not-to-atmosphere` | a turbine exhausts somewhere with no path to a silencer or boundary |
| `pneumatic/compressor-without-intake` | nothing upstream of a compressor inlet brings air in |
| `mechanical/nothing-driven` | a shaft train where nothing absorbs the power |
| `media/heat-source-unstated` | nothing states what heats a preheater, so it would be drawn as oil |
| `hydraulic/filter-position-mismatch` | a filter declared `suction` is wired into a pressure line |
| `parameters/key-unspecified` | a parameter a reviewer would expect is missing |
| `assumptions/undeclared` | a load-bearing choice was defaulted with nothing on the record |
| `layout/route-crosses-symbol` | every route between two ports passes through a component |
| `layout/no-clean-route` | no orthogonal route honours both port sides |
| `layout/authored-route-side` | `via` waypoints break the perpendicular-entry contract |
| `layout/authored-route-collides` | `via` waypoints pass through a symbol |
| `layout/junction-side-faces-away` | a junction port faces away from the other end, so the line doubles back |

## Notes

| Code | Rule |
| --- | --- |
| `parameters/unspecified` | a secondary parameter is missing |
| `layout/line-crossings` | how many lines cross in the drawing |
| `media/unresolved` | nothing fixes a run's fluid and oil is not allowed, so one was assumed |
| `media/cooling-medium-unstated` | nothing states what cools a cooler, so it would be drawn as oil |

Crossings are counted, not forbidden. A dense circuit legitimately has some, and
an author needs to know how many rather than be blocked.

## Rules deliberately not enforced

- **Unconnected ports as a blanket error.** Real circuits leave the relief
  remote pilot, a spare valve port and an unused case drain plugged. Rejecting
  those would make the validator reject valid work, and people would route
  around it by drawing connections that do not exist.
- **Line crossings as an error.** See above.
- **Mixed line types at a junction.** Taking a pilot signal off a pressure line
  is exactly how pilots are fed.
- **Anything requiring physics.** No pressure drop, no flow balance, no thermal
  behaviour, no stability. The claim is topological consistency with the
  information provided, and that is all the report says.

## Media

No connection states its fluid. Each port declares what it can carry -- one
fluid, a class (`liquid`, `gas`), `any`, or a shaft -- and ports that must share
a fluid sit in the same group on their component. A check valve's inlet and
outlet share one group; an accumulator's gas and liquid sides are separate
groups. Every fluid line joins the groups at its two ends, and each joined run
must agree on one fluid.

The fluids are `oil`, `water`, `thermal_oil`, `air`, `nitrogen`, `steam` and
`flue_gas`. A port may also admit an explicit list: an accumulator's gas side is
air or nitrogen, never steam.

A run that nothing narrows is oil, so every circuit written before media existed
means what it always meant. A conflict is reported with every port that
constrained the run, because "air meets liquid" is useless without saying where
each came from. Pumps, motors and reservoirs are liquid-only; valves, gauges,
filters and junctions carry whatever they sit in.

Shafts are not fluid. A shaft port takes a `mechanical` line and nothing else,
and shafts never branch through junctions.

## Paths are traced per fluid

"Does the pump reach a tank" is answered over port groups, not components. A
trace follows one fluid: it never crosses to the far side of a heat exchanger
or an accumulator, and never along a shaft. It also starts from the port in
question and never passes back through the component it started from, so a
turbine's supply and its exhaust are traced apart even though both sit in one
group of the turbine.

Liquids circulate: drawn from a reservoir, returned to one. Gases flow through:
supplied by a compressor, an air receiver, an accumulator's gas side or an
intake, and leaving to a silencer. A boundary stands in for either end in the
direction it states. A tank with no pump on it -- a compensation basin that
fills and empties through one line -- is not asked for a return.

A shaft train (machines joined by mechanical lines) needs a driver: a turbine,
a motor, or a motor-generator, which both drives and is driven.

## The assumptions rule

When a choice that changes circuit behaviour -- valve configuration, centre
condition, actuation, single versus double-acting -- is defaulted rather than
stated, an entry in `assumptions` naming that component must exist. This is the
mechanical half of "engineering assumptions are never hidden"; the other half is
that the renderer prints them on the drawing.

## The topology checklist

`validation.md` ends with a checklist that is **computed by tracing the graph**,
not inferred from the absence of errors: "Pump draws from a reservoir" means a
path was actually found. A check with nothing to test reports `[??]` and says
why, rather than claiming a pass it did not earn.
