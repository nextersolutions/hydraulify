// Shafts and clutches on the drawing.
//
// A shaft is drawn as a wide ink stroke under a narrow paper one, so what a
// reader sees is two parallel lines. That trick depends on paint -- the core
// stroke must actually paint in paper colour -- so the source-level tests here
// are paired with a Chrome measurement, skipped where no Chrome exists.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { analyse, renderSvg } from '../renderers/pipeline.mjs';
import { validateModel } from '../validate/index.mjs';
import { longestSegment } from '../renderers/render-svg.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const fragment = () => JSON.parse(fs.readFileSync(path.join(root, 'test', 'fixtures', 'caes-fragment.json'), 'utf8'));

function render(model) {
  const analysis = analyse(model);
  assert.equal(analysis.ok, true, analysis.diagnostics.filter((item) => item.severity === 'error').map((item) => item.message).join('\n'));
  return { svg: renderSvg(model, analysis), analysis };
}

const group = (svg, edge) => {
  const match = svg.match(new RegExp(`<g class="conn" data-edge="${edge}"[^>]*>([\\s\\S]*?)</g>(?=<g class="conn"|</g>)`));
  assert.ok(match, `connection ${edge} is drawn`);
  return match[1];
};

test('a shaft is drawn as two strokes on one path, and a fluid line as one', () => {
  const { svg } = render(fragment());
  const shaft = group(svg, 'drive');
  const lines = [...shaft.matchAll(/<path class="([^"]+)" d="([^"]+)"/g)];
  assert.deepEqual(lines.map((item) => item[1]), ['shaft-line', 'shaft-core']);
  assert.equal(lines[0][2], lines[1][2], 'the core runs exactly along the outer stroke');

  const fluid = group(svg, 'discharge');
  assert.deepEqual([...fluid.matchAll(/<path class="([^"]+)"/g)].map((item) => item[1]), ['line']);
});

test('a shaft never carries a flow arrow, even when one is asked for', () => {
  const model = fragment();
  model.connections.find((connection) => connection.id === 'drive').arrow = 'forward';
  const { svg } = render(model);
  assert.doesNotMatch(group(svg, 'drive'), /arrow-head/);
});

test('without clutch: true there is no clutch', () => {
  assert.doesNotMatch(render(fragment()).svg, /class="clutch"/);
});

test('a clutch sits across the middle of the longest straight run of its shaft', () => {
  const model = fragment();
  model.connections.find((connection) => connection.id === 'drive').clutch = true;
  const { svg, analysis } = render(model);

  const drawn = group(svg, 'drive');
  assert.match(drawn, /<g class="clutch">/);
  const route = analysis.layout.routed.find((item) => item.connection.id === 'drive');
  const segment = longestSegment(route.points);
  const cx = (segment.from[0] + segment.to[0]) / 2;
  const cy = (segment.from[1] + segment.to[1]) / 2;

  // Two plates, one either side of the break, straddling the midpoint.
  const plates = [...drawn.matchAll(/<line x1="([^"]+)" y1="([^"]+)" x2="([^"]+)" y2="([^"]+)" class="clutch-plate"/g)]
    .map((item) => item.slice(1).map(Number));
  assert.equal(plates.length, 2);
  const horizontal = segment.from[1] === segment.to[1];
  const across = plates.map(([x1, y1]) => (horizontal ? x1 : y1));
  const centre = horizontal ? cx : cy;
  assert.ok(across[0] < centre && across[1] > centre, 'the plates straddle the midpoint');
  // The break is cut from the shaft with paper, by class alone: no fill
  // attribute for a stylesheet to fight with.
  assert.match(drawn, /<rect [^>]*class="clutch-gap"\/>/);
  assert.doesNotMatch(drawn, /class="clutch-gap" fill=/);
});

test('longestSegment picks the first of two equal runs, so the clutch never jumps between them', () => {
  assert.deepEqual(longestSegment([[0, 0], [40, 0], [40, 40]]).from, [0, 0]);
  assert.deepEqual(longestSegment([[0, 0], [10, 0], [10, 50], [20, 50]]).from, [10, 0]);
});

test('schema: a clutch belongs on a shaft only, and the finding says so', () => {
  const model = fragment();
  model.connections.find((connection) => connection.id === 'discharge').clutch = true;
  const result = validateModel(model);
  assert.equal(result.stage, 'schema');
  const finding = result.diagnostics.find((item) => item.code === 'schema/const');
  assert.ok(finding, 'expected a schema/const finding');
  assert.match(finding.supportedFixes[0], /clutch couples two shafts/);

  const off = fragment();
  off.connections.find((connection) => connection.id === 'discharge').clutch = false;
  assert.equal(validateModel(off).stage, 'topology', 'clutch: false is harmless anywhere');
});

test('the same model draws byte-identical shafts and clutches every time', () => {
  const model = fragment();
  model.connections.find((connection) => connection.id === 'drive').clutch = true;
  assert.equal(render(model).svg, render(model).svg);
});

// --- paint, measured in Chrome -------------------------------------------------

function visualCheck(svg) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hydraulify-shaft-'));
  const file = path.join(dir, 'fragment.svg');
  fs.writeFileSync(file, svg, 'utf8');
  try {
    const result = spawnSync(process.execPath, [path.join(root, 'bin', 'hydraulify.mjs'), 'visual-check', file, '--json'], { encoding: 'utf8' });
    if (result.status === 2) return null;
    return { status: result.status, receipt: JSON.parse(result.stdout) };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const probe = (() => {
  const model = fragment();
  model.connections.find((connection) => connection.id === 'drive').clutch = true;
  model.connections.find((connection) => connection.id === 'output').clutch = true;
  return visualCheck(render(model).svg);
})();

test('in Chrome, a compressed-air drawing with shafts and clutches paints every element', { skip: !probe && 'Chrome not found' }, () => {
  assert.equal(probe.status, 0, probe.receipt.findings.join('\n'));
  assert.equal(probe.receipt.paint.hollow, 0);
  assert.equal(probe.receipt.paint.invisible, 0);
});
