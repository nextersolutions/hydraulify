#!/usr/bin/env node
// Capture the README's screenshots of the HTML viewer and editor.
//
// Drives the page `deliver --html` writes in headless Chrome, with the same
// real mouse input the end-to-end tests use, so the pictures show the editor
// as it is rather than as it was when someone last remembered to update them.
//
//   node scripts/editor-screenshots.mjs [output-dir]

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { analyse } from '../renderers/pipeline.mjs';
import { renderHtmlDocument } from '../renderers/render-html.mjs';
import { launch } from '../test/helpers/cdp.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(process.argv[2] ?? path.join(root, 'docs', 'screenshots'));
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'hydraulify-shots-'));
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function writePage(name) {
  const model = JSON.parse(fs.readFileSync(path.join(root, 'examples', `${name}.json`), 'utf8'));
  const file = path.join(scratch, `${name}.html`);
  fs.writeFileSync(file, renderHtmlDocument(model, analyse(model), { sourceName: `${name}.json` }), 'utf8');
  return file;
}

const at = (page, point) => page.evaluate(`hydraulify.worldToClient(${JSON.stringify(point)})`);
const centreOfComponent = (page, id) => page.evaluate(`(() => {
  const frame = hydraulify.draft.layout.frames.get(${JSON.stringify(id)});
  return hydraulify.worldToClient([frame.x + frame.width / 2, frame.y + frame.height / 2]);
})()`);

async function shoot(page, name) {
  // The scripted key presses leave focus rings a mouse user would not see.
  await page.evaluate('document.activeElement?.blur()');
  await pause(150);
  const file = path.join(output, `${name}.png`);
  fs.writeFileSync(file, await page.screenshot());
  console.log(path.relative(root, file));
}

async function startEditing(page) {
  await page.click(await page.centreOf('#btn-edit'));
  await page.waitFor('document.body.dataset.mode === "edit"');
}

fs.mkdirSync(output, { recursive: true });
const { page, close } = await launch({ width: 1440, height: 860 });
try {
  // Viewing: a component clicked, lit with everything it is joined to.
  await page.open(writePage('05-filtered-power-unit'));
  await page.click(await centreOfComponent(page, 'P1'));
  await page.waitFor('hydraulify.selection?.id === "P1"');
  await shoot(page, 'editor-view');

  // Editing: a gauge dragged in from the palette and teed onto the pressure
  // rail, which inserts a junction and selects the new line.
  await page.open(writePage('02-solenoid-cylinder'));
  await startEditing(page);
  await page.drag(await page.centreOf('.palette-item[data-type="pressure_gauge"]'), await at(page, [380, 160]), { steps: 12 });
  await page.waitFor('hydraulify.model.components.some((component) => component.id === "PG1")');
  await shoot(page, 'editor-errors');
  await page.drag(await page.centreOf('.port[data-ref="PG1.inlet"]'), await at(page, [400, 280]));
  await page.waitFor('hydraulify.draft.status === "PASS"');
  await shoot(page, 'editor-edit');

  // Placing a valve: the behaviour-changing choices come first, with a preview.
  await page.evaluate('document.getElementById("toast").hidden = true');
  await page.drag(await page.centreOf('.palette-item[data-type="directional_control_valve"]'), await at(page, [620, 120]), { steps: 12 });
  await page.waitFor('document.getElementById("chooser").open');
  await shoot(page, 'editor-chooser');

  if (page.errors.length) throw new Error(`the page reported errors:\n${page.errors.join('\n')}`);
} finally {
  await close();
  fs.rmSync(scratch, { recursive: true, force: true });
}
