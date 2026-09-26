// A minimal Chrome DevTools Protocol client over --remote-debugging-pipe.
//
// The pipe needs no WebSocket client and no package: Chrome reads commands
// from fd 3 and writes replies to fd 4, each a JSON message ended by a NUL.
// Enough to open a page, evaluate in it and send real mouse and keyboard
// input -- the input goes through Chrome's own hit-testing, which synthesized
// DOM events would skip.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function findChrome() {
  if (process.env.HYDRAULIFY_CHROME) return process.env.HYDRAULIFY_CHROME;
  const candidates = process.platform === 'win32'
    ? [
      path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ]
    : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

export async function launch({ width = 1400, height = 900 } = {}) {
  const chrome = findChrome();
  if (!chrome) throw new Error('Chrome not found');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'hydraulify-cdp-'));
  const child = spawn(chrome, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-pipe', `--user-data-dir=${profile}`,
    '--blink-settings=preferredColorScheme=1', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });

  const input = child.stdio[3];
  const output = child.stdio[4];
  let buffer = '';
  let nextId = 0;
  const pending = new Map();
  const listeners = new Set();
  output.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let end;
    while ((end = buffer.indexOf('\0')) >= 0) {
      const message = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      if (message.id && pending.has(message.id)) {
        const { resolve, reject } = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) reject(new Error(`${message.error.message} (${message.error.code})`));
        else resolve(message.result);
      } else if (message.method) {
        for (const listener of listeners) listener(message);
      }
    }
  });

  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    nextId += 1;
    pending.set(nextId, { resolve, reject });
    input.write(`${JSON.stringify({ id: nextId, method, params, sessionId })}\0`);
  });

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const call = (method, params) => send(method, params, sessionId);
  await call('Page.enable');
  await call('Runtime.enable');
  await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });

  const errors = [];
  listeners.add((message) => {
    if (message.sessionId !== sessionId) return;
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails?.exception?.description ?? message.params.exceptionDetails?.text);
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      errors.push(message.params.args.map((arg) => arg.value ?? arg.description).join(' '));
    }
  });

  const page = {
    errors,
    async evaluate(expression) {
      const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
      return result.result.value;
    },
    async open(file) {
      await call('Page.navigate', { url: `file:///${path.resolve(file).replace(/\\/g, '/')}` });
      await page.waitFor('document.body && document.body.dataset.ready === "true"');
    },
    async waitFor(expression, { timeout = 10000 } = {}) {
      const started = Date.now();
      while (Date.now() - started < timeout) {
        try {
          if (await page.evaluate(`Boolean(${expression})`)) return;
        } catch {
          // The page may be mid-navigation.
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error(`timed out waiting for ${expression}`);
    },
    async mouse(type, [x, y], { buttons = 0, modifiers = 0 } = {}) {
      await call('Input.dispatchMouseEvent', {
        type, x, y, modifiers,
        button: type === 'mouseMoved' ? (buttons ? 'left' : 'none') : 'left',
        buttons, clickCount: type === 'mouseMoved' ? 0 : 1,
      });
    },
    async click(point) {
      await page.mouse('mouseMoved', point);
      await page.mouse('mousePressed', point, { buttons: 1 });
      await page.mouse('mouseReleased', point);
    },
    /** Press, move in steps, release: the way a hand drags. */
    async drag(from, to, { steps = 8 } = {}) {
      await page.mouse('mouseMoved', from);
      await page.mouse('mousePressed', from, { buttons: 1 });
      for (let step = 1; step <= steps; step += 1) {
        const point = [from[0] + ((to[0] - from[0]) * step) / steps, from[1] + ((to[1] - from[1]) * step) / steps];
        await page.mouse('mouseMoved', point, { buttons: 1 });
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      await page.mouse('mouseReleased', to);
      await new Promise((resolve) => setTimeout(resolve, 60));
    },
    async key(key, { ctrl = false, shift = false } = {}) {
      const modifiers = (ctrl ? 2 : 0) | (shift ? 8 : 0);
      const code = key.length === 1 ? `Key${key.toUpperCase()}` : key;
      const windowsVirtualKeyCode = key.length === 1 ? key.toUpperCase().charCodeAt(0) : ({ Delete: 46, Escape: 27, Enter: 13 }[key] ?? 0);
      await call('Input.dispatchKeyEvent', { type: 'keyDown', key, code, modifiers, windowsVirtualKeyCode });
      await call('Input.dispatchKeyEvent', { type: 'keyUp', key, code, modifiers, windowsVirtualKeyCode });
    },
    /** Centre of the first element matching a selector, in page pixels. */
    async centreOf(selector) {
      return page.evaluate(`(() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        return [rect.x + rect.width / 2, rect.y + rect.height / 2];
      })()`);
    },
  };

  const close = async () => {
    try {
      await send('Browser.close');
    } catch {
      // Already gone.
    }
    await new Promise((resolve) => {
      if (child.exitCode !== null) resolve();
      else {
        child.once('exit', resolve);
        setTimeout(() => { child.kill(); resolve(); }, 3000);
      }
    });
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  };

  return { page, close };
}
