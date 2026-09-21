// What the browser paints, not what the source says.
//
// Every solid element in hydraulify -- pump triangles, junction dots, flow
// arrowheads -- once rendered hollow or not at all, with the whole suite green:
// a CSS rule overrode the fill attribute, and every test read the attribute.
// These tests close that gap from both ends. The first pins the rule without a
// browser. The rest run `visual-check`, which measures computed paint in Chrome,
// and are skipped, not failed, on a machine without one.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { STYLESHEET } from '../renderers/render-svg.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'bin', 'hydraulify.mjs');

test('the stylesheet lets fill="currentColor" win over the hollow default', () => {
  const hollow = STYLESHEET.indexOf('.sym, .line');
  const solid = STYLESHEET.indexOf('.sym[fill="currentColor"] { fill: currentColor; }');
  assert.ok(hollow !== -1, 'the hollow default rule exists');
  assert.ok(solid !== -1, 'the solid override rule exists');
  assert.ok(solid > hollow, 'and comes after it, so it wins on equal footing too');
});

function visualCheck(file) {
  const result = spawnSync(process.execPath, [cli, 'visual-check', file, '--json'], { encoding: 'utf8' });
  if (result.status === 2) return null; // no Chrome on this machine
  return { status: result.status, receipt: JSON.parse(result.stdout) };
}

const hasChrome = visualCheck(path.join(root, 'docs', 'examples', '04-load-holding.svg')) !== null;

for (const name of ['04-load-holding', '05-filtered-power-unit', '06-caes-plant']) {
  test(`${name}: every solid element is painted solid in Chrome`, { skip: !hasChrome && 'Chrome not found' }, () => {
    const { status, receipt } = visualCheck(path.join(root, 'docs', 'examples', `${name}.svg`));
    assert.equal(status, 0, receipt.findings.join('\n'));
    assert.ok(receipt.paint.solid > 0, 'the drawing has solid elements to measure');
    assert.equal(receipt.paint.hollow, 0);
    assert.equal(receipt.paint.invisible, 0);
  });
}

test('visual-check fails a drawing whose stylesheet hollows its solid elements', { skip: !hasChrome && 'Chrome not found' }, () => {
  // The drawing as it shipped before the fix: the override rule removed.
  const broken = fs.readFileSync(path.join(root, 'docs', 'examples', '04-load-holding.svg'), 'utf8')
    .replace('.sym[fill="currentColor"] { fill: currentColor; }', '');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hydraulify-paint-'));
  const file = path.join(dir, 'broken.svg');
  fs.writeFileSync(file, broken, 'utf8');
  try {
    const { status, receipt } = visualCheck(file);
    assert.equal(status, 1);
    assert.equal(receipt.paint.hollow, receipt.paint.solid, 'every solid element comes out hollow');
    assert.ok(receipt.paint.invisible > 0, 'and the arrowheads disappear entirely');
    assert.ok(receipt.findings.some((finding) => /render unfilled/.test(finding)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
