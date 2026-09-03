// ver:panel-can-always-be-left — the help panel can always be left.
//
// Run:  node test/panel.mjs
//
// Drives the REAL page in headless Chromium, because this is the one failure in
// the project that no amount of reasoning about the source would have caught:
// the close handler ran, set the attribute it was asked to set, and the panel
// stayed on screen anyway.
//
// THE CAUSE. Visibility was expressed in two places that could not see each
// other — JavaScript hid the panel with the `hidden` attribute, and the
// stylesheet independently declared `display: grid` on the same element. An
// author display rule beats the user agent's `[hidden] { display: none }`, so
// the hide silently lost. Nothing could have caught that: no test, no type, no
// lint. Two mechanisms for one piece of state, and the quieter one winning.
//
// A child was stuck on a help screen she had opened by accident. That is what
// this test is for.

import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8791;

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

const chrome = ['chromium', 'chromium-browser', 'google-chrome']
  .find((b) => spawnSync('command', ['-v', b], { shell: true }).status === 0);

if (!chrome) {
  console.log('\n  skipped: no chromium on this machine\n');
  process.exit(0);
}

// A wrapper page that loads the real app in an iframe, drives it, and writes
// what it found into its own DOM where --dump-dom can read it. Same origin, so
// it can reach inside.
const HARNESS = `<!doctype html><meta charset="utf-8">
<iframe id="app" src="/index.html" style="width:844px;height:390px;border:0"></iframe>
<pre id="out">pending</pre>
<script>
(async () => {
  const out = [];
  const say = (k, v) => out.push(k + '=' + v);
  try {
    const f = document.getElementById('app');
    await new Promise((r) => { f.onload = r; setTimeout(r, 2500); });
    const w = f.contentWindow, d = f.contentDocument;
    await new Promise((r) => setTimeout(r, 1200)); // let the module run

    const panel = d.getElementById('silentpanel');
    const help = d.getElementById('help');
    const close = d.getElementById('closepanel');
    say('panelExists', !!panel);
    say('helpExists', !!help);
    say('closeExists', !!close);
    if (!panel || !help || !close) throw new Error('missing elements');

    say('displayAtRest', w.getComputedStyle(panel).display);
    help.click();
    await new Promise((r) => setTimeout(r, 120));
    say('displayWhenOpen', w.getComputedStyle(panel).display);

    close.click();
    await new Promise((r) => setTimeout(r, 200));
    say('displayAfterClose', w.getComputedStyle(panel).display);

    // And the way out that does not depend on hitting one small target.
    help.click();
    await new Promise((r) => setTimeout(r, 120));
    panel.click();
    await new Promise((r) => setTimeout(r, 200));
    say('displayAfterBackdrop', w.getComputedStyle(panel).display);
  } catch (err) {
    say('error', String(err && err.message));
  }
  document.getElementById('out').textContent = out.join(' ;; ');
})();
</script>`;

// --- serve the real project, plus the harness -------------------------------

const { createServer } = await import('node:http');
const { readFile } = await import('node:fs/promises');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.wav': 'audio/wav', '.png': 'image/png' };

const server = createServer(async (req, res) => {
  const path = req.url.split('?')[0];
  if (path === '/harness.html') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(HARNESS);
  }
  try {
    const body = await readFile(join(ROOT, path === '/' ? 'index.html' : path.slice(1)));
    const ext = path.slice(path.lastIndexOf('.'));
    res.writeHead(200, { 'Content-Type': TYPES[ext] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('no');
  }
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const dom = await new Promise((resolve) => {
  const p = spawn(chrome, [
    '--headless', '--no-sandbox', '--disable-gpu', '--mute-audio',
    '--virtual-time-budget=9000', '--dump-dom', `http://127.0.0.1:${PORT}/harness.html`,
  ]);
  let buf = '';
  p.stdout.on('data', (d) => { buf += d; });
  p.on('close', () => resolve(buf));
});
server.close();

const line = (dom.match(/>([^<]*panelExists[^<]*)</) ?? [])[1] ?? '';
const got = Object.fromEntries(
  line.split(';;').map((s) => s.trim()).filter(Boolean).map((s) => s.split('='))
);

console.log('\nthe help panel can always be left');
console.log(`  (${Object.entries(got).map(([k, v]) => `${k}:${v}`).join('  ')})\n`);

check('the panel and its controls exist',
  got.panelExists === 'true' && got.helpExists === 'true' && got.closeExists === 'true');
check('it is hidden before she opens it', got.displayAtRest === 'none', got.displayAtRest);
check('tapping "no sound?" shows it', got.displayWhenOpen && got.displayWhenOpen !== 'none',
  got.displayWhenOpen);

// THE ASSERTION THAT FAILED. With `display: grid` on .panel and JS hiding via
// the `hidden` attribute, this came back "grid" — the handler ran, the
// attribute was set, and the panel stayed on screen.
check('tapping close actually hides it', got.displayAfterClose === 'none',
  `computed display was "${got.displayAfterClose}"`);

check('and tapping anywhere on it hides it too', got.displayAfterBackdrop === 'none',
  `computed display was "${got.displayAfterBackdrop}"`);

console.log(failures === 0 ? '\nall good\n' : `\n${failures} failure(s)\n`);
process.exit(failures === 0 ? 0 : 1);
