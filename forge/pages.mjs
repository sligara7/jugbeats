// Generate one page per palette, so each style gets a clean URL.
//
// Run:  node forge/pages.mjs
//
// /jugbeats/           the phonk game — index.html, the source of truth
// /jugbeats/ethereal/  the calm one   — generated from it
//
// GENERATED BUT COMMITTED, which is the same arrangement `kit/` already has and
// for the same reason: GitHub Pages serves this repository as-is with no build
// step, so anything the site needs has to be in the tree. index.html is the one
// hand-edited page; run this after changing it and never edit the output.
//
// WHY A DIRECTORY RATHER THAN A QUERY STRING. `?p=calm` works and still does,
// but a link you send someone should look like a place rather than a setting.
// And why not a separate repository at /ethereal — because that is a second copy
// of the whole project, which is exactly what dec:styles-are-palettes exists to
// avoid. A subdirectory shares every byte of the engine.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://sligara7.github.io/jugbeats';

/**
 * Every palette gets a page, generated from game.html.
 *
 * THE ROOT IS AN INDEX NOW, not a game. It was the phonk game while phonk was
 * the only style; with five it should be the door rather than one of the rooms.
 *
 * WHICH DOES NOT BREAK A SINGLE LINK SHE HAS SENT. `/jugbeats/#...` still opens
 * her track: index.html reads the palette id straight out of the hash before it
 * renders anything and forwards to that palette's page with the hash intact, and
 * a link written before palettes existed carries a zero there, which is phonk.
 */
const PAGES = [
  {
    dir: 'beats',
    palette: 'phonk',
    title: 'JugBeats — make a phonk beat',
    ogTitle: 'JugBeats',
    ogDescription:
      'Turn your phone sideways, tap the blocks, make a phonk beat. Then send it back.',
    h1: 'JugBeats',
    hint: 'turn your volume up — and if it stays quiet, tap “no sound?” after you start',
  },
  {
    dir: 'bachata',
    palette: 'bachata',
    title: 'JugBachata — let the guitar answer',
    ogTitle: 'JugBachata',
    ogDescription:
      'Turn your phone sideways, tap the blocks, and let the guitar answer. Then send it back.',
    h1: 'JugBachata',
    hint: 'the requinto is the one that leads — try the last round first',
  },
  {
    dir: 'ritual',
    palette: 'ritual',
    title: 'JugRitual — let it get heavy',
    ogTitle: 'JugRitual',
    ogDescription:
      'Turn your phone sideways, tap the blocks, and let it get heavy. Then send it back.',
    h1: 'JugRitual',
    hint: 'start with the piano — the riff is the last round, and it is loud',
  },
  {
    dir: 'reggaeton',
    palette: 'reggaeton',
    title: 'JugDembow — you cannot miss the beat',
    ogTitle: 'JugDembow',
    ogDescription:
      'Turn your phone sideways, tap the blocks, and you cannot miss the beat. Then send it back.',
    h1: 'JugDembow',
    hint: 'the first round snaps to the dembow — tap anywhere near it',
  },
  {
    dir: 'haunted',
    palette: 'haunted',
    title: 'JugHaunt — make something not quite right',
    ogTitle: 'JugHaunt',
    ogDescription:
      'Turn your phone sideways, tap the blocks, make something that is not quite right.',
    h1: 'JugHaunt',
    hint: 'turn your volume up — this one is better in the dark',
  },
  {
    dir: 'ethereal',
    palette: 'calm',
    title: 'JugCalm — make something peaceful',
    ogTitle: 'JugCalm',
    ogDescription:
      'Turn your phone sideways, tap the blocks, make something peaceful. Then send it back.',
    h1: 'JugCalm',
    hint: 'turn your volume up — headphones if you have them',
  },
];

const source = readFileSync(join(ROOT, 'game.html'), 'utf8');
const { PALETTES } = await import('../js/palettes.js');

for (const page of PAGES) {
  let html = source;

  // The palette the page IS. js/main.js reads this off <html> before it builds
  // anything, because the round list depends on it and everything depends on
  // the round list.
  html = html.replace('<html lang="en">', `<html lang="en" data-palette="${page.palette}">`);

  // Every reference climbs one directory, because this page lives in one.
  html = html.replace(/(href|src)="((?:css|js|kit)\/)/g, '$1="../$2');

  html = html.replace(/<title>[^<]*<\/title>/, `<title>${page.title}</title>`);

  // The chat preview card. WhatsApp caches these hard, so they have to be right
  // BEFORE the link is shared, and they have to be ABSOLUTE.
  const meta = {
    'og:title': page.ogTitle,
    'og:description': page.ogDescription,
    'og:url': `${SITE}/${page.dir}/`,
    'twitter:card': 'summary_large_image',
  };
  for (const [prop, content] of Object.entries(meta)) {
    const attr = prop.startsWith('og:') ? 'property' : 'name';
    html = html.replace(
      new RegExp(`<meta ${attr}="${prop}" content="[^"]*">`),
      `<meta ${attr}="${prop}" content="${content}">`,
    );
  }

  // The gate is the first thing anyone sees; it should say where they are.
  html = html.replace(/<h1 id="gate-title">[^<]*<\/h1>/, `<h1 id="gate-title">${page.h1}</h1>`);
  html = html.replace(
    /<p class="hint">[^<]*<\/p>/,
    `<p class="hint">${page.hint}</p>`,
  );

  html = html.replace(
    '<!doctype html>',
    `<!doctype html>\n<!-- GENERATED by forge/pages.mjs from game.html. Do not edit; edit that. -->`,
  );

  mkdirSync(join(ROOT, page.dir), { recursive: true });
  writeFileSync(join(ROOT, page.dir, 'index.html'), html);
  console.log(`wrote ${page.dir}/index.html — ${SITE}/${page.dir}/`);
}

// ---------------------------------------------------------------------------
// The index — the door, generated from the palette table
// ---------------------------------------------------------------------------

/**
 * THE BEDS — the pages that are not the game.
 *
 * A palette is something she MAKES something with. A bed is something that plays
 * by itself while somebody sleeps, and they are different enough that the door
 * says so rather than mixing them into one list: nothing here has keys, a tempo
 * or a link, and none of it is hers.
 *
 * WRITTEN OUT HERE RATHER THAN DERIVED, because a bed is not a palette and
 * inventing a fake one to get it onto this page would be the tail wagging the
 * dog. dec:idea-a-sleep-url recorded this as the one snag in giving a bed a home
 * — "the first page on the site the generator cannot produce" — and the answer
 * turned out to be a second small table rather than a hand-edited page.
 *
 * ALL THREE ARE LISTED. /sleep/ was left off when this table was written,
 * because the owner had asked for rain and waves by name and adding a third
 * uninvited seemed like the wrong way round. He came back the same day — "please
 * add the original /sleep/ to the main index, you only added waves and rain" —
 * so that reading was wrong and this is the correction.
 *
 * It goes FIRST because it came first, and because it is the plainest of the
 * three: no weather, just the hum.
 */
const BEDS = [
  {
    dir: 'sleep',
    name: 'Sleep',
    blurb: 'A steady hum, like being in the car. The plain one.',
    accent: '#8fb8ff',
  },
  {
    dir: 'waves',
    name: 'Waves',
    blurb: 'Slow surf, a long way off. Pick how long and put the phone down.',
    accent: '#7fd6ff',
  },
  {
    dir: 'rain',
    name: 'Rain',
    blurb: 'Steady rain, heard through a window. It fades out on its own.',
    accent: '#9fb9cc',
  },
];

const cards = PALETTES.map((p) => `      <a class="card" href="${p.home}" style="--accent:${p.accent}">
        <h2>${p.name}</h2>
        <p>${p.blurb}</p>
        <span class="go">open ▸</span>
      </a>`).join('\n');

/** Spelled out, because "6 kinds of music" reads like a spreadsheet. Derived
 *  rather than written, because this line said "five" for as long as there were
 *  six and nobody noticed. */
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const countWord = (n) => WORDS[n] ?? String(n);

const bedCards = BEDS.map((b) => `      <a class="card" href="${b.dir}/" style="--accent:${b.accent}">
        <h2>${b.name}</h2>
        <p>${b.blurb}</p>
        <span class="go">open \u25b8</span>
      </a>`).join('\n');

// The id-to-directory map the redirect needs, small enough to inline.
const homes = JSON.stringify(Object.fromEntries(PALETTES.map((p) => [p.id, p.home])));

writeFileSync(join(ROOT, 'index.html'), `<!doctype html>
<!-- GENERATED by forge/pages.mjs from the palette table. Do not edit; add a
     palette to js/palettes.js and run it again. -->
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Jug — make something</title>

<!-- BEFORE ANYTHING RENDERS, and that is the whole point of putting it here.
     A link somebody was sent must not flash a menu at them on the way to their
     own track, and every link written before this page existed points at THIS
     url. Reading the palette out of the hash and forwarding is what keeps every
     one of them working (iface:track-format). -->
<script>
(function () {
  var h = location.hash.replace(/^#/, '');
  if (!h) return;
  var homes = ${homes};
  var id = 0;
  try {
    var s = h.replace(/-/g, '+').replace(/_/g, '/');
    var b = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
    // Byte 0 is the format version, byte 3 the palette. Anything before v6 was
    // written when phonk was the only style, so it carries a zero and is phonk.
    id = b.charCodeAt(0) >= 6 ? b.charCodeAt(3) : 0;
  } catch (e) { /* an unreadable link opens the index, which is the right end */ }
  var to = homes[id] || homes[0];
  if (to) location.replace(to + location.hash);
})();
</script>

<meta property="og:type" content="website">
<meta property="og:title" content="Jug">
<meta property="og:description" content="Turn your phone sideways, tap the blocks, make something. Five ways.">
<meta property="og:image" content="${SITE}/preview.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:url" content="${SITE}/">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#0d0a14">

<style>
  :root { --bg:#0d0a14; --ink:#f4eefc; }
  * { box-sizing:border-box; }
  body {
    margin:0; min-height:100vh; background:var(--bg); color:var(--ink);
    font:500 16px/1.45 ui-rounded,"SF Pro Rounded",system-ui,-apple-system,sans-serif;
    padding:calc(28px + env(safe-area-inset-top,0px)) 20px 40px;
    -webkit-text-size-adjust:100%;
  }
  header { max-width:52rem; margin:0 auto 26px; }
  header.second { margin-top:44px; }
  header.second h1 { font-size:clamp(22px,4.5vw,30px); }
  h1 { margin:0 0 6px; font-size:clamp(30px,7vw,46px); letter-spacing:-0.02em; }
  .sub { margin:0; opacity:0.55; font-size:15px; max-width:30em; }
  .grid {
    max-width:52rem; margin:0 auto; display:grid; gap:12px;
    grid-template-columns:repeat(auto-fit,minmax(15rem,1fr));
  }
  .card {
    display:block; text-decoration:none; color:inherit;
    border:1px solid color-mix(in srgb, var(--accent) 45%, transparent);
    background:color-mix(in srgb, var(--accent) 7%, transparent);
    border-radius:16px; padding:18px 18px 16px;
    transition:background 0.15s, transform 0.1s;
  }
  .card:hover { background:color-mix(in srgb, var(--accent) 14%, transparent); }
  .card:active { transform:scale(0.985); }
  .card h2 { margin:0 0 6px; font-size:20px; color:var(--accent); }
  .card p { margin:0 0 12px; font-size:14px; opacity:0.72; }
  .go { font-size:13px; color:var(--accent); opacity:0.85; }
  footer { max-width:52rem; margin:30px auto 0; font-size:13px; opacity:0.4; }
  footer a { color:inherit; }
</style>
</head>
<body>
  <header>
    <h1>Jug</h1>
    <p class="sub">Turn your phone sideways, tap two big keys, and build a track a
      layer at a time. Same game, ${countWord(PALETTES.length)} kinds of music.</p>
  </header>

  <main class="grid">
${cards}
  </main>

  <header class="second">
    <h1>To fall asleep to</h1>
    <p class="sub">Nothing to play. Choose how long, put the phone across the
      room, and it stops on its own.</p>
  </header>

  <main class="grid">
${bedCards}
  </main>

  <footer>
    Made for a nine-year-old who likes phonk.
    <a href="https://github.com/sligara7/jugbeats">Source</a>.
  </footer>
</body>
</html>
`);
console.log(`wrote index.html — ${PALETTES.length} palettes, ${SITE}/`);
