# JugBeats

**[Play it →](https://sligara7.github.io/jugbeats/)**

A phonk beat-making game. Turn your phone sideways, tap four keys, make
something, send it to someone.

Built for one nine-year-old who likes phonk and likes games where the notes
fall down the screen.

![JugBeats](preview.png)

## How you play

It is a loop pedal. Two keys, one per thumb.

**Tap out your speed** — four taps on the keys and that is your tempo. Nobody
tells you a number; you choose a speed you can hear.

**Press START.** A click counts you in over a quiet drone, so you are never
playing into silence. Then play a kick and a snare for as long as you like.

**Press STOP to keep it, or ↺ to throw it away and go again.** What you keep
starts looping, and the click retires — from here your own beat is the click.

**Then the next two sounds over the top.** Hats and cowbell, then the 808, then
the melody. Two at a time, one per thumb, each round playing over everything
you kept before it.

That is the whole of the teaching: nobody tells you a track is drums plus bass
plus melody. You hear it get fuller because you filled it.

The pitched lanes are locked to a minor scale, and the drone sounds its root —
so there is no wrong note, and you can hear why.

## How it is built

Plain HTML, CSS and JavaScript. No framework, no dependencies, no build step,
no server, no accounts, nothing to pay for.

| | |
|---|---|
| `js/dsp.js` | The sound design. Pure functions, no Web Audio, no DOM. |
| `js/clock.js` | Musical time — the only part that knows what time it is. |
| `js/voices.js` | The sound engine. |
| `js/track.js` | Your music, as plain data. |
| `js/stage.js` | The highway and the keys. |
| `js/session.js` | The loop pedal: rounds, tempo, start and stop. |
| `js/link.js` | Packs a track into a URL and back out. |
| `js/main.js` | The page. Constructs everything; nothing depends on it. |
| `forge/` | Build-time only. Bakes the drums; renders the preview card. |

**All the sound is synthesized** — no samples from anywhere. The drums are
rendered ahead of time by the forge, where there is no latency budget and the
sound design can be as expensive as it needs to be. The 808 and the lead are
generated in the browser, because their pitch has to move across the lanes and
a rendered file cannot. One sound-design pass, run at two speeds.

**Musical time has a single authority**, derived from the audio hardware clock.
Nothing else holds a timer, and a block's position on screen is computed from
the clock rather than advanced each frame — so a dropped frame loses a frame
and never the beat.

**Your track travels inside the link.** No server sees it. The format carries a
version marker, because a link you send today has to still play a year from now.

## Running it

```sh
node forge/build-kit.mjs      # bake the drums into kit/
node forge/demo.mjs demo.wav  # hear the kit without the game
python3 forge/preview.py      # render the chat preview card

node test/timing.mjs          # the beat does not drift
node test/link.mjs            # old links still play
node test/session.mjs         # the loop pedal behaves like a loop pedal

python3 -m http.server 8137   # then open http://localhost:8137
```

On a desktop the two lanes are **F** and **J**.

The files in `kit/` are generated but committed, because GitHub Pages serves
the repository as-is with no build step. `js/dsp.js` is the source of truth;
`node forge/build-kit.mjs` regenerates them byte for byte. Never hand-edit them.

## Design

Designed with [reflow2](https://github.com/sligara7/reflow2) before it was
built. The design graph — requirements, decisions and the reasoning behind
them — lives in `.reflow2/` and is not committed.

Two things worth knowing, because they explain most of the code:

- **Fun is the gate, and the creation shift is the prize.** The point is that
  she comes away knowing music is something a person makes. But a child who
  does not enjoy it stops playing, and then nothing is taught at all. Where the
  two pull apart, the more fun one wins.
- **The keys never reach back.** Every part publishes what it offers and imports
  only from parts below it. `main.js` constructs everything and nothing depends
  on it. Two dependency cycles got caught this way before a line of code existed.

**It runs anywhere.** Android and iOS, any modern browser. The only
platform-specific code is additive and guarded: an iOS audio-session request
that is simply absent on Android, and a silent-audio fallback that is harmless
everywhere. Nothing is gated on a platform.
