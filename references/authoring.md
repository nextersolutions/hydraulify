# Authoring: placement, routing and artifacts

## Who places what

You place components; the renderer routes lines. There is no layout solver, and
`pos` is required, so a model without positions fails validation rather than
piling symbols at the origin.

`scaffold` is the on-ramp:

```bash
node bin/hydraulify.mjs scaffold sketch.json placed.json
```

It puts components into fixed hydraulic bands -- actuators at the top, control
in the middle, power and reservoir at the bottom -- in declaration order, with
no crossing reduction and no obstacle avoidance. It is a starting point, not a
layout, and it says so on the way out. Expect to move things.

## A layout that reads

The pattern the worked examples follow:

```
        actuators (cylinder, motor)           top
        load-holding valves
        directional valves                    middle
        relief, check, flow control
        pump, filtration                      lower
        reservoir                             bottom
```

Then:

- Run the pressure line up from the pump and across to the valve, and the
  return line back along the bottom to the reservoir.
- Hang a relief valve **below** the pressure rail it taps: flow through it runs
  top to bottom, so the tank must be below.
- Put a gauge or an accumulator **above** the line it connects to: both have a
  single port on their underside.
- Keep a component out of the straight corridor between two ports that need to
  connect. If one sits in the way, every candidate route is blocked and you get
  `layout/route-crosses-symbol`. Move the component; that is the fix.

## Junctions

Every branch is an explicit junction component. Its four ports sit at the same
point and differ only in the direction a line approaches from, so pick the port
that faces the other end:

```json
{ "id": "J1", "type": "junction", "pos": [236, 276], "config": { "way": 3 } }
```

`J1.left` for a line arriving from the left, `J1.top` for one leaving upward,
and so on. Choosing a port that faces away produces a line that doubles back,
and a `layout/junction-side-faces-away` warning saying so. `way` must match the
number of lines actually connected.

`pos` is the top-left of an 8x8 frame, so the dot sits at `pos + [4, 4]`. To put
a tee at (240, 280), write `"pos": [236, 276]`.

## Routing

Routes are generated automatically: several candidate crossbar levels, each
filtered so the first and last segments leave and enter perpendicular to their
port faces, then scored on length, corner count and how much of the route would
share a corridor with a line already placed. Two parallel lines drawn on top of
each other read as one line, so the overlap penalty pushes the second onto its
own level.

When automatic routing cannot produce something sensible, pin it:

```json
{ "id": "rail", "from": "J1.right", "to": "V1.P", "line": "pressure",
  "via": [[240, 180], [526, 180]] }
```

Authored waypoints are used verbatim -- a route you pinned is never silently
re-derived -- and are still checked: you will be told if they break the
perpendicular-entry contract or pass through a symbol.

Reach for `via` only after a diagnostic asks for it. Moving a component is
almost always the better fix, because it improves every route through that area
rather than one.

## Shafts

A `mechanical` line routes like any other and is drawn as the ISO double line.
Machines put their shafts on the side power flows through -- a turbine drives
out of its right, a compressor is driven from its left -- so a train reads left
to right. A shared motor-generator between a compressor and a turbine is the
exception every compressed-air plant has: mirror the compressor so its shaft
faces the machine on its right, and the turbine so its shaft faces the one on
its left.

```json
{ "id": "charge", "from": "MG1.shaft_a", "to": "C1.shaft", "line": "mechanical", "clutch": true }
```

Keep a clutched shaft long enough to show its break: the clutch sits across the
middle of the longest straight run, and a run shorter than 24 has no room.

## Reading a layout report

```bash
node bin/hydraulify.mjs inspect model.json
```

Gives resolved port anchors, the side each route uses, and every polyline. This
is the primary regression artifact: a diff here reads as "C1.rod anchor moved
3px", where an SVG diff shows only changed path data.

Each route is labelled with how it was produced: `auto` (clean),
`auto-obstructed` (best available, but it crosses a symbol), `authored` (your
`via`), or `fallback` (no candidate honoured both port faces).

## Artifacts

```bash
node bin/hydraulify.mjs deliver model.json out.svg \
  --html out.html --report out.validation.md --bom out.bom.md --json
```

`deliver` writes nothing until everything that could fail has succeeded, then
reports SHA-256 and byte counts for the specification and each artifact. A
failed delivery leaves any previous artifact untouched.

- **`.svg`** is the deliverable: monochrome, ISO line styles, semantic classes,
  byte-identical for a given model. It renders anywhere.
- **`.html`** wraps the same drawing in a viewer with pan, zoom, light/dark,
  search, focus and export. Controls with no hydraulic meaning are hidden.
- **`validation.md`** carries the verdict, every finding with its fixes, the
  computed topology checklist, the unspecified parameters and the assumptions.
- **`bom.md`** / **`bom.json`** aggregate by type plus full configuration plus
  full parameter set, so two relief valves at different settings stay separate.

## Checking what you produced

```bash
node bin/hydraulify.mjs check out.svg          # structure, balance, no inline colour
node bin/hydraulify.mjs visual-check out.html --png shot.png
```

`check` is structural. `visual-check` loads the artifact in local Chrome and
reports that the viewer initialised and the schematic survived into the rendered
DOM, and it measures what was actually painted: every element meant to be solid
must render filled, and nothing may end up with neither fill nor stroke. That
second check exists because the source can say one thing while the stylesheet
paints another -- solid triangles once rendered hollow, and arrowheads not at
all, with every source-level test passing. With `--png` it also captures a
screenshot. Neither is a review of whether
the drawing is correct. Keep the three claims apart when you report:
deterministic checks, browser evidence, and perceptual review by a human.

## Units

```bash
node bin/hydraulify.mjs render model.json out.svg --units imperial
```

The model keeps what was authored. Rendering converts for display only, rounds
to the significant figures of the source, and marks converted values with a
tilde. Ship both artifacts if a review needs both systems; there is no live
toggle, so each file is one unit system and is diffable on its own.
