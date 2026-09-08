# Optional Jukebox

The dashboard ships an optional SoundCloud Jukebox: four tracks behind a small
floating `SND·06` chip in the bottom-right corner. It is a decoration, not part
of the visualization — playback is independent of chain events and visual
timing, and nothing about it is contacted or loaded until you click. The
implementation lives in [`ui-app/src/Jukebox.tsx`](../ui-app/src/Jukebox.tsx).

## Tracks

| Slot | Kind | Piece | Uploader | Duration |
|---|---|---|---|---|
| `Vocal A` | vocal | 翼をください (`TSUBASA WO KUDASAI`) | MICHELLE ♥ | 05:24 |
| `Vocal B` | vocal | Komm, süsser Tod | ARIANNE | 06:00 |
| `Piano A` | piano | 翼をください (`TSUBASA WO KUDASAI`) | JOSETO ARC | 04:09 |
| `Piano B` | piano | Komm, süsser Tod | SHEET MUSIC BOSS | 06:39 |

`Vocal A` is the default selection.

## The closed chip

The chip carries an equalizer mark, a `BGM` label, and the HUD panels' own
corner brackets. It never names a track. Until the Jukebox has been opened
once, its equalizer idles slowly and ticks with each arriving block — the one
chain-driven detail in the whole feature. Opening the Jukebox retires that
motion for the rest of the page's life, as does `prefers-reduced-motion`.

The `WEB5.INFO` link sits to the chip's right. It hides while the Jukebox is
open and returns when closed; disabling the sound module leaves the link in
the bottom-right corner.

## Opening and closing

Clicking the chip replaces it with SoundCloud's official HTML5 player and
requests playback of the selected track. Browser autoplay policy may still
require a second tap, especially on mobile. The visible player is scaled and
darkened inside a compact cknerv HUD shell, while its native controls and
SoundCloud attribution remain intact.

Closing the Jukebox removes the player, stops playback, and restores the
floating chip.

## Playback modes

The Jukebox offers `SINGLE ∞` and `RANDOM ∞`, and defaults to single-track
repeat. Single mode repeats the selected track forever; random mode chooses a
different random track after each song and continues forever.

`Vocal B` fades from `05:55` to `06:00`, then either returns to the beginning
in single mode or advances to a random track. This is parent-page playback
control, so the native SoundCloud timeline still reflects the source
recording's full length.

## Network and limits

SoundCloud is not contacted and no audio is loaded during dashboard startup;
the first request is made only when the chip is clicked. The feature therefore
requires internet access — unlike the rest of cknerv, which runs against local
sources — and is subject to SoundCloud's terms and regional availability.

Nothing of SoundCloud's runs in the dashboard's own origin. The fade, the loop
and the track advance are driven by talking to the player frame directly —
JSON `{ method, value }` over `postMessage`, in
[`ui-app/src/soundcloud-widget.ts`](../ui-app/src/soundcloud-widget.ts) —
rather than by loading the vendor's widget script, which would run beside the
dashboard with its own reach to every local API route. Replies are accepted
only from `https://w.soundcloud.com` and only from the frame the Jukebox
itself mounted.
