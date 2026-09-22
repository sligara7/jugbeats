// Every bed actually starts when you tap it.
//
// Run:  node test/beds.mjs
//
// ⚠️ THIS EXISTS BECAUSE THREE BEDS SHIPPED DEAD AND NOTHING NOTICED. /stream/,
// /forest/ and /underwater/ each asked createBuffer for a rate the browser
// refuses. The exception landed inside build(), so tapping a duration did
// nothing at all — no sound, no countdown, no message.
//
// Every other test passed on all three, because none of them runs a browser.
// And each one was reported "live and byte-identical" after pushing, which
// confirms the bytes arrived and says NOTHING about whether they work. That is a
// check which looks like verification and is not, and this file is the one that
// actually is: it loads each bed in real Chromium, presses a real button, and
// asks whether the thing started.

import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8137;

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

const beds = readdirSync(ROOT, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .filter((d) => {
    try { return readFileSync(join(ROOT, d, 'index.html'), 'utf8').includes('id="playing"'); }
    catch { return false; }
  })
  .sort();

const harness = (bed) => `<!doctype html><meta charset="utf-8">
<iframe id="app" src="/${bed}/index.html" style="width:844px;height:600px;border:0"></iframe>
<pre id="out">pending</pre>
<script>
(async () => {
  const out = [];
  const say = (k, v) => out.push(k + '=' + v);
  try {
    const f = document.getElementById('app');
    await new Promise((r) => { f.onload = r; setTimeout(r, 4000); });
    const w = f.contentWindow, d = f.contentDocument;

    // Anything the module throws on the way in.
    const errs = [];
    w.addEventListener('error', (e) => errs.push(e.message || String(e.error)));
    w.addEventListener('unhandledrejection', (e) => errs.push(String(e.reason)));

    await new Promise((r) => setTimeout(r, 900));
    const btns = d.querySelectorAll('.times button');
    say('buttons', btns.length);
    if (!btns.length) throw new Error('no duration buttons');

    // The shortest one, so nothing waits on a long render.
    btns[0].click();
    await new Promise((r) => setTimeout(r, 2500));

    say('playing', d.body.classList.contains('playing'));
    const clock = d.getElementById('clock');
    say('clock', clock ? JSON.stringify(clock.textContent.trim()) : 'none');
    say('ctx', w.document.querySelectorAll('audio').length);
    say('errors', errs.length ? JSON.stringify(errs.slice(0, 2)) : 'none');
  } catch (err) {
    say('threw', JSON.stringify(String(err && err.message)));
  }
  document.getElementById('out').textContent = out.join(' ;; ');
})();
</script>`;

const { createServer } = await import('node:http');
const { readFile } = await import('node:fs/promises');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.wav': 'audio/wav', '.png': 'image/png' };

let current = beds[0];
const server = createServer(async (req, res) => {
  const path = req.url.split('?')[0];
  if (path === '/harness.html') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(harness(current));
  }
  try {
    const body = await readFile(join(ROOT, path === '/' ? 'index.html' : path.slice(1)));
    res.writeHead(200, { 'Content-Type': TYPES[path.slice(path.lastIndexOf('.'))] ?? 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404).end('no'); }
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

console.log('every bed starts when you tap it');
console.log();

for (const bed of beds) {
  current = bed;
  const dom = await new Promise((resolve) => {
    const p = spawn(chrome, [
      '--headless', '--no-sandbox', '--disable-gpu', '--mute-audio',
      '--autoplay-policy=no-user-gesture-required',
      '--virtual-time-budget=20000', '--dump-dom', `http://127.0.0.1:${PORT}/harness.html`,
    ]);
    let buf = '';
    p.stdout.on('data', (d) => { buf += d; });
    p.on('close', () => resolve(buf));
  });
  const line = (dom.match(/>([^<]*(?:playing|threw)[^<]*)</) ?? [])[1] ?? '';
  const got = Object.fromEntries(
    line.split(';;').map((s) => s.trim()).filter(Boolean).map((s) => {
      const i = s.indexOf('='); return [s.slice(0, i), s.slice(i + 1)];
    })
  );
  const ok = got.playing === 'true' && got.errors === 'none' && !got.threw;
  check(`/${bed}/ starts`, ok,
    ok ? `clock ${got.clock}` : (got.errors && got.errors !== 'none' ? got.errors
         : got.threw ? `threw ${got.threw}` : `playing=${got.playing}`));
}

server.close();
console.log(failures === 0 ? '\nall good\n' : `\n${failures} failure(s)\n`);
process.exit(failures === 0 ? 0 : 1);
