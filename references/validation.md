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
| `hydraulic/no-reservoir` | nothing for oil to be drawn from or returned to |
| `hydraulic/pump-without-source` | a pump's suction has no traceable path to a reservoir |
| `hydraulic/no-return-path` | no line returns to the reservoir |
| `hydraulic/relief-not-to-tank` | a relief discharges somewhere with no path to tank |
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
