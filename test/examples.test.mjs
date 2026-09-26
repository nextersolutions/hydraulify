// The worked examples are part of the contract, not decoration: §38 requires
// that at least five example inputs work. If one of them stops rendering, or
// starts inventing a value, that is a regression in the skill.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { analyse, renderSvg } from '../renderers/pipeline.mjs';
import { renderHtmlDocument } from '../renderers/render-html.mjs';
import { renderValidationReport } from '../validate/report.mjs';
import { buildBom, renderBomMarkdown, renderBomJson } from '../validate/bom.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const examplesDir = path.join(root, 'examples');
const names = fs.readdirSync(examplesDir).filter((name) => name.endsWith('.json')).sort();

test('at least five worked examples ship with the skill', () => {
  assert.ok(names.length >= 5, `expected 5 or more examples, found ${names.length}`);
});

for (const name of names) {
  const model = JSON.parse(fs.readFileSync(path.join(examplesDir, name), 'utf8'));

  test(`${name}: validates without errors`, () => {
    const analysis = analyse(model);
    const errors = analysis.diagnostics.filter((item) => item.severity === 'error');
    assert.deepEqual(errors.map((item) => item.message), []);
    assert.equal(analysis.ok, true);
  });

  test(`${name}: routes cleanly, with nothing driven through a symbol`, () => {
    const analysis = analyse(model);
    const obstructed = analysis.diagnostics.filter((item) => (
      item.code === 'layout/route-crosses-symbol' || item.code === 'layout/no-clean-route'
    ));
    assert.deepEqual(obstructed.map((item) => item.message), [], 'an example must not ship with a blocked route');
  });

  test(`${name}: produces every artifact, deterministically`, () => {
    const analysis = analyse(model);
    const svg = renderSvg(model, analysis);
    const html = renderHtmlDocument(model, analysis);
    const report = renderValidationReport(model, analysis);
    const bom = buildBom(model, analysis);

    assert.ok(svg.includes('<svg'));
    assert.ok(!/NaN|undefined|Infinity/.test(svg));
    assert.ok(html.includes('<svg'));
    assert.equal(html, renderHtmlDocument(JSON.parse(JSON.stringify(model)), analysis), 'the page is deterministic too');
    const embedded = JSON.parse(html.match(/<script type="application\/json" id="hy-model">([\s\S]*?)<\/script>/)[1]);
    assert.deepEqual(embedded, model, 'the page carries the model it was rendered from, for the editor to save');
    assert.match(report, /STATUS: (PASS|PASS WITH WARNINGS)/);
    assert.ok(renderBomMarkdown(model, bom).includes('# Bill of materials'));
    JSON.parse(renderBomJson(model, bom));

    const second = renderSvg(JSON.parse(JSON.stringify(model)), analyse(JSON.parse(JSON.stringify(model))));
    assert.equal(svg, second, 'the same example must render identically every time');
  });

  test(`${name}: every assumption names a real subject`, () => {
    const ids = new Set(model.components.map((component) => component.id));
    for (const assumption of model.assumptions ?? []) {
      const subject = assumption.subject.split('.')[0];
      assert.ok(
        ids.has(subject) || assumption.subject === 'circuit',
        `assumption subject ${assumption.subject} is neither a component nor the whole circuit`,
      );
    }
  });

  test(`${name}: no parameter was invented to make it look complete`, () => {
    // Every numeric parameter present must be a real number the author wrote, or
    // null meaning explicitly unknown. The guard here is that a component with no
    // params object stays that way through analysis.
    const analysis = analyse(model);
    for (const [id, entry] of analysis.resolved) {
      const original = model.components.find((component) => component.id === id);
      assert.deepEqual(
        entry.component.params ?? null,
        original.params ?? null,
        `${id}: parameters changed during analysis`,
      );
    }
  });
}

test('the load-holding example uses a real load-holding component', () => {
  const model = JSON.parse(fs.readFileSync(path.join(examplesDir, '04-load-holding.json'), 'utf8'));
  const holding = model.components.filter((component) => (
    component.type === 'counterbalance_valve' || component.type === 'pilot_operated_check_valve'
  ));
  assert.ok(holding.length > 0, 'load holding needs a counterbalance or pilot-operated check valve');

  // And its pilot must actually be piloted, by a line typed as a control line.
  const pilots = model.connections.filter((connection) => (
    connection.from.endsWith('.pilot') || connection.to.endsWith('.pilot')
  ));
  assert.ok(pilots.length > 0, 'the load-holding valve must be piloted');
  for (const pilot of pilots) assert.equal(pilot.line, 'pilot');
});

test('a mirrored symbol keeps its ports attached', () => {
  const model = JSON.parse(fs.readFileSync(path.join(examplesDir, '05-filtered-power-unit.json'), 'utf8'));
  const mirrored = model.components.find((component) => component.mirror === true);
  assert.ok(mirrored, 'example 5 demonstrates a mirrored in-line component');

  const analysis = analyse(model);
  const entry = analysis.resolved.get(mirrored.id);
  assert.equal(entry.geometry.mirrored, true);
  // Mirroring swaps which face each port is on; the anchors must still sit on
  // the frame, or lines would detach from the symbol.
  for (const port of Object.values(entry.ports)) {
    assert.ok(port.x >= 0 && port.x <= entry.geometry.width);
    const onEdge = { left: port.x === 0, right: port.x === entry.geometry.width, top: port.y === 0, bottom: port.y === entry.geometry.height }[port.side];
    assert.ok(onEdge, `${port.id} is not on its declared ${port.side} edge after mirroring`);
  }
});
