// The editor, driven the way a person drives it: real mouse and keyboard
// input through Chrome, on the page `deliver` writes.
//
// The operations have their own tests in editor-ops. What those cannot show is
// that a drag from the palette lands where the pointer let go, that a port
// handle is where the port is, that a drop on a line finds the line, and that
// the undo key reaches the history. Skipped where there is no Chrome.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { analyse } from '../renderers/pipeline.mjs';
import { renderHtmlDocument } from '../renderers/render-html.mjs';
import { findChrome, launch } from './helpers/cdp.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const chrome = findChrome();

function writePage(name) {
  const model = JSON.parse(fs.readFileSync(path.join(root, 'examples', `${name}.json`), 'utf8'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hydraulify-e2e-'));
  const file = path.join(dir, `${name}.html`);
  fs.writeFileSync(file, renderHtmlDocument(model, analyse(model), { sourceName: `${name}.json` }), 'utf8');
  return { file, dir };
}

const at = (page, point) => page.evaluate(`hydraulify.worldToClient(${JSON.stringify(point)})`);
const model = (page) => page.evaluate('hydraulify.model');
const codes = (page) => page.evaluate('hydraulify.draft.diagnostics.map((item) => item.code)');
const status = (page) => page.evaluate('hydraulify.draft.status');

test('editing a circuit with the mouse and keyboard', { skip: !chrome && 'Chrome not found', timeout: 120000 }, async (t) => {
  const { file, dir } = writePage('02-solenoid-cylinder');
  const { page, close } = await launch();
  t.after(async () => {
    await close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await page.open(file);
  assert.equal(await page.evaluate('document.body.dataset.mode'), 'view', 'the page opens read-only');
  assert.equal(await page.evaluate('document.querySelectorAll(".port").length'), 0, 'no port handles while viewing');

  await page.click(await page.centreOf('#btn-edit'));
  await page.waitFor('document.body.dataset.mode === "edit"');
  assert.ok(await page.evaluate('document.querySelectorAll(".port").length') > 10, 'port handles appear for editing');

  await t.test('a component dragged from the palette lands where it is dropped', async () => {
    const item = await page.centreOf('.palette-item[data-type="pressure_gauge"]');
    await page.drag(item, await at(page, [380, 160]), { steps: 12 });
    await page.waitFor('hydraulify.model.components.some((component) => component.id === "PG1")');
    const gauge = (await model(page)).components.find((component) => component.id === 'PG1');
    const frame = await page.evaluate('(() => { const f = hydraulify.draft.layout.frames.get("PG1"); return [f.x + f.width / 2, f.y + f.height / 2]; })()');
    assert.ok(Math.abs(frame[0] - 380) <= 4 && Math.abs(frame[1] - 160) <= 4, `centred on the drop point, got ${JSON.stringify(frame)} for pos ${gauge.pos}`);
    assert.equal(await status(page), 'INVALID', 'an unconnected gauge is an error until it is wired');
    assert.ok((await codes(page)).includes('topology/isolated-component'));
  });

  await t.test('dragging from a port onto a line tees it with a junction', async () => {
    const port = await page.centreOf('.port[data-ref="PG1.inlet"]');
    await page.drag(port, await at(page, [400, 280]));
    await page.waitFor('hydraulify.model.connections.some((c) => c.from === "PG1.inlet" || c.to === "PG1.inlet")');
    const next = await model(page);
    const junction = next.components.find((component) => component.type === 'junction' && !['J1', 'J2'].includes(component.id));
    assert.ok(junction, 'a junction was inserted');
    assert.equal(junction.pos[1] + 4, 280, 'on the pressure rail');
    assert.equal(await status(page), 'PASS', (await codes(page)).join(', '));
    assert.equal(await page.evaluate('hydraulify.selection.kind'), 'connection', 'the new line is selected for its type to be checked');
  });

  await t.test('undo and redo reach the history from the keyboard', async () => {
    const lines = (await model(page)).connections.length;
    await page.key('z', { ctrl: true });
    await page.waitFor(`hydraulify.model.connections.length === ${lines - 2}`);
    assert.equal(await status(page), 'INVALID');
    await page.key('z', { ctrl: true, shift: true });
    await page.waitFor(`hydraulify.model.connections.length === ${lines}`);
    assert.equal(await status(page), 'PASS');
  });

  await t.test('a component moves with the pointer, on the grid', async () => {
    const before = (await model(page)).components.find((component) => component.id === 'RV1').pos;
    await page.drag(await at(page, [218, 366]), await at(page, [218 - 41, 366]));
    await page.waitFor(`hydraulify.model.components.find((c) => c.id === "RV1").pos[0] !== ${before[0]}`);
    const after = (await model(page)).components.find((component) => component.id === 'RV1').pos;
    assert.equal(after[1], before[1], 'a horizontal drag does not move it vertically');
    assert.equal(Math.abs(after[0] - before[0]) % 4, 0, 'moves are on the 4px grid');
    assert.ok(Math.abs(after[0] - before[0] + 41) <= 4, `moved with the pointer: ${before} -> ${after}`);
  });

  await t.test('dragging a run of a selected line pins its route', async () => {
    await page.click(await at(page, [542, 370]));
    await page.waitFor('hydraulify.selection && hydraulify.selection.kind === "connection"');
    const index = await page.evaluate('hydraulify.selection.index');
    assert.equal((await model(page)).connections[index].id, 'valve-return');
    await page.drag(await at(page, [542, 370]), await at(page, [582, 370]));
    await page.waitFor(`Array.isArray(hydraulify.model.connections[${index}].via)`);
    const route = await page.evaluate(`hydraulify.draft.layout.routed.find((r) => r.connection.index === ${index}).points`);
    for (let segment = 0; segment < route.length - 1; segment += 1) {
      const [a, b] = [route[segment], route[segment + 1]];
      assert.ok(a[0] === b[0] || a[1] === b[1], `the pinned route stays square: ${JSON.stringify(route)}`);
    }
    assert.ok(route.some(([x]) => x === 582), 'the run moved to where it was dragged');
    assert.ok(!(await codes(page)).some((code) => code.startsWith('layout/authored')), (await codes(page)).join(', '));
  });

  await t.test('placing a valve asks the choices that change the circuit, and Delete removes it', async () => {
    const item = await page.centreOf('.palette-item[data-type="directional_control_valve"]');
    await page.drag(item, await at(page, [740, 420]), { steps: 12 });
    await page.waitFor('document.getElementById("chooser").open');
    await page.click(await page.centreOf('#chooser input[type="radio"][value="4/2"]'));
    await page.waitFor('document.querySelector("#chooser input[value=\\"right_return\\"]")?.checked');
    await page.click(await page.centreOf('#chooser button.primary'));
    await page.waitFor('hydraulify.model.components.some((c) => c.id === "V2")');
    const valve = (await model(page)).components.find((component) => component.id === 'V2');
    assert.equal(valve.config.configuration, '4/2');
    assert.equal(valve.config.actuation.spring, 'right_return', 'a two-position valve cannot be spring centred');
    assert.equal(valve.config.center_condition, undefined, 'and has no centre to state');
    assert.ok(!(await codes(page)).includes('assumptions/undeclared'), 'every choice was stated');

    await page.key('Delete');
    await page.waitFor('!hydraulify.model.components.some((c) => c.id === "V2")');
  });

  await t.test('Ctrl+S writes the model back as JSON the CLI accepts', async () => {
    // The file picker is the user's to answer; a stand-in plays its part.
    await page.evaluate(`(() => {
      window.__written = null;
      window.showSaveFilePicker = async (options) => ({
        name: options.suggestedName,
        createWritable: async () => ({ write: async (text) => { window.__written = text; }, close: async () => {} }),
      });
    })()`);
    assert.equal(await page.evaluate('document.getElementById("dirty").hidden'), false, 'edits are marked unsaved');
    await page.key('s', { ctrl: true });
    await page.waitFor('window.__written !== null');
    const text = await page.evaluate('window.__written');
    assert.ok(text.endsWith('\n'));
    const saved = JSON.parse(text);
    assert.deepEqual(saved, await model(page));
    assert.equal(text, `${JSON.stringify(saved, null, 2)}\n`, 'formatted the way the examples are');
    assert.equal(analyse(saved).ok, true, 'deliver would accept what was saved');
    assert.equal(await page.evaluate('document.getElementById("dirty").hidden'), true, 'and it is no longer marked unsaved');
  });

  await t.test('the page reports no script errors', () => {
    assert.deepEqual(page.errors, []);
  });
});
