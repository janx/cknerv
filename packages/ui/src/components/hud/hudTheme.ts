import sairaUrl from '../../fonts/Saira-latin.woff2';
import chakra500Url from '../../fonts/ChakraPetch-500-latin.woff2';
import chakra700Url from '../../fonts/ChakraPetch-700-latin.woff2';
import shareTechUrl from '../../fonts/ShareTechMono-latin.woff2';
import huiwenUrl from '../../fonts/HuiwenMincho-subset.woff2';
import jbmUrl from '../../fonts/JetBrainsMono-400-subset.woff2';
import orbitronUrl from '../../fonts/Orbitron-500-subset.woff2';
import { PEER_NETWORK_HEX } from '../../visualPalette';

// Three color layers, and one rule about how a surface is allowed to wear them.
// Chrome (orange / cyanWire) is the instrument's own frame. Identity colors name
// a thing — a mesh, a peer, a cell. Semantics name a state, and only a state.
// Severity may FILL: at warning and above the level word inverts into a solid
// block of its own color with `ground` punched through the letters. Chrome and
// identity only ever outline. So a filled block anywhere in the HUD means
// something is wrong — never "this panel matters more than its neighbours".
/** Absolute black, named once so the palette's own translucent panel can be
 *  built from it rather than spelled beside it — the token and the surface
 *  that is 45% of it were two copies of one value in one file. */
const GROUND = '#000000';

export const HUD_COLORS = {
  // Absolute black, and never a surface: `ground` is what gets KNOCKED OUT of
  // something coloured. `severityChip` reads it back through the letters of a
  // filled severity block, and the status strip's three scrubber markers read
  // it through the middle of a 4–6px bordered dot so the marker sits on its
  // track as a hole rather than a bead. The fifth reader borrows that second
  // form for the same reason one step further out: the link probe's compass
  // draws US as a hole and the peer as a bead, because the two marks resolve
  // to the same hex and had to be told apart by shape rather than by hue. Five
  // readers, and a knockout with a hue is just a fill — which is why this one
  // may not drift the way the two near-blacks around it are free to.
  //
  // It does not name the ground the stage is painted on. That is `stageGround`,
  // and the token being called `ground` is exactly why nobody found it there.
  ground: GROUND,
  // The colour the stage itself is painted, and the only near-black here a
  // person actually looks at: the scene's clear colour, the CSS under the
  // canvas that holds it until a first frame exists, and the body behind both.
  // All three have to spell one value or the page shifts at first light.
  //
  // Ten units off `ground` and ten off `trackGround`, and that is not the drift
  // this palette hunts — those two are a knockout and a channel, jobs no reader
  // ever sees beside this one. What it ends is a mismatch that had run the life
  // of the file: the token named `ground` was not naming the ground, so every
  // surface that wanted the stage's black typed it out, and the value lived in
  // three files and belonged to none.
  //
  // `index.html` still spells it, because the shell paints before a module has
  // evaluated and a stylesheet cannot import. Its copy is held against this one
  // by `ui-app/__tests__/App.sceneRoots.test.tsx`.
  //
  // It is also the DARK EVERY FLOATING SURFACE IS DRAWN ON, and that was the
  // second half of the same mismatch. The plate gradients, the dropdown menus,
  // the scene callouts and the inline label washes wrote their own near-black
  // channel at an alpha — twelve spellings of it: 0,3,8 · 0,3,10 · 0,3,12 ·
  // 1,4,12 · 1,5,13 · 1,5,14 · 1,5,15 · 2,5,8 · 2,5,12 · 3,8,17 · 3,8,20 ·
  // 4,7,12. They are not twelve decisions. The widest pair among them is 13.3
  // apart, a third of the separation floor this palette calls "one colour
  // wearing two names", and every one of them lands within 11.2 of this token
  // with the centroid at 3.5. Two of them are not even near-copies: the plate
  // head and tail are spelled character-for-character in `primitives.tsx` and
  // in the portrait's canvas gradient, at the same two alphas.
  //
  // So the surfaces say `rgba(HUD_COLORS.stageGround, α)` now, and the reading
  // they were each reaching for — a plate is darker or lighter than its
  // neighbour — is carried where it was always actually carried, by the ALPHA.
  stageGround: '#02030A',
  panel: rgba(GROUND, 0.45),
  // The empty half of every gauge, meter and segmented bar. Deliberately one
  // step off `ground`: a track has to read as a channel carved into the panel's
  // translucent black, and pure black just dissolves into the stage behind it.
  trackGround: '#0A0A0A',
  orange: '#FF9830',
  orangeDeep: '#EC7420',
  cyanWire: '#20F0FF',
  peerWire: PEER_NETWORK_HEX.scaffold,
  // The Cell organism's own blood. `CELL_GALAXY_PALETTE.tissueRose` is
  // [1.0, 0.40, 0.44] — #FF666F — and the whole galaxy on stage is painted out
  // of that rose/crimson/amber family, while the CELL MESH panel and the cell
  // card wore a cyan eight degrees off the PEER plane's `peerWire`. Two things
  // went wrong at once: the twin-mesh pair stopped reading as a warm/cold pair,
  // and the cell surfaces pointed at the wrong creature. This is the raw tissue
  // hue opened toward white until it survives being 8.5px of module tag on
  // black — the scene value itself is body-lit and goes muddy at type sizes.
  //
  // Hard requirement, checked in `hudDiscipline.test.ts`: it must stay in the
  // tissue's own neighbourhood AND read apart from `danger #FF3030` at 8.5px.
  // A rose that drifts red stops naming the organism and starts looking like a
  // small alarm, which is the one failure mode this token cannot have.
  cellRose: '#FF7A85',
  // What a Cell turns into while it burns down. The stage already has this
  // colour: `CELL_GALAXY_PALETTE.ember` is what `cellHybridMaterial`'s wither
  // ramp drains a consumed body toward — chroma cooled to ash, then tinted
  // back 0.6 of the way to ember — so the panel that counts deaths and the
  // corpses out there finally name the same event. It is that hue taken
  // darker and redder than the scene's raw [1.0, 0.52, 0.28], because at full
  // brightness the ember IS chrome orange, and a reading may never be painted
  // in the instrument's own frame colour. The gate found the whole corridor:
  // this sits at hue 11°, between `danger` at 0° and `orangeDeep` at 25°, and
  // is cooled and dimmed off both — which is what a coal that has burned down
  // actually looks like beside a flame.
  //
  // Which layer it belongs to: DATA, not identity. `cellRose` says "this
  // surface is about Cells"; `ember` says "this number is cells being spent".
  // It is never a panel accent, never a border, only ever a reading — and
  // `hudDiscipline.test.ts` walks it through the same reserve matrix as the
  // lock and asset families for exactly that reason.
  //
  // What it replaced matters more than what it is. BORN/DIED used to be
  // nominal green over danger red, which said that a Cell being consumed is a
  // FAULT. In this organism it is not: cells dying IS metabolism, and a chain
  // that stopped spending its outputs would be the emergency. Red stays
  // reserved for pathology — reorg, stall, decode error, crit — so ember has
  // to read as "consumed" from across the room and never as a small alarm.
  ember: '#D25234',
  // The violet, and there is ONE of it. It used to be two: `memory` for the
  // inspection surface and `rebuild` for the scene's replay semantic, with a
  // comment here saying they were "deliberately distinct". They were 4.5
  // apart in RGB (report F, F-4) — a tenth of the separation this palette
  // requires of any two names, and under every threshold at which a person
  // can tell two colours apart at all.
  //
  // A distinction nobody can see is not a distinction, it is a second name;
  // and the two were on screen together — the RECONCILING replay plate beside
  // a MEMORY TRACE footer — where a reader would have had to take the claim on
  // faith. What the two names were really saying is that consensus memory and
  // rebuilding it are the same subject seen twice, which is an argument for
  // one token, not two values of one.
  memory: '#AA88FF',
  memoryInk: '#C9BAFF',
  // A consensus-memory endpoint marker with NO evidence source bound to it —
  // the target's own end of the trace, beside the ends that carry one and take
  // a slot of `CONSENSUS_MEMORY_EVIDENCE_COLORS`. It was typed three times in
  // `nerve/ConsensusMemoryMarkers.tsx` and is not any other cyan the house
  // holds: 90 from `cyanInk`, 111 from `cyanWire`. The nearest thing to it is
  // `PEER_NETWORK_HEX.outbound` at 18, and that is the peer plane's word for a
  // link direction — the wrong sentence entirely, which is why this is a name
  // of its own rather than a borrow.
  memoryUnbound: '#8FF7FF',
  // Bright text tiers of the wire families; chrome stays cyanWire / orange.
  cyanInk: '#C9F8FF',
  // …and the gold, likewise one. `lockedGold` and `goldInk` were 8.6 apart —
  // a difference you can measure and cannot see — and the split was by
  // SURFACE rather than by meaning: the route lock spoke one, the readouts
  // the other, and both meant "this is held". One name, and the lock's
  // emphasis comes from its glow and its outline, where emphasis in this HUD
  // has always come from.
  goldInk: '#FFD29A',
  ink: '#E8E8E8',
  // One tier above `ink`, and the only thing allowed up there: the single hero
  // numeral a panel exists to show. `ink` stays the body text — if everything
  // were white, the hero would be nothing.
  heroInk: '#FFFFFF',
  // The line of segment names under a bucket bar — `CKB 41 · TOKEN 12 · DAO 3`
  // — ranked here on purpose, between the label tier and the reading tier. Four
  // panels had been typing it out because it had nowhere to come from, and it
  // is a real rung rather than a drift between two: 68 off `dim` and 102 off
  // `ink`, both clear of the separation floor.
  //
  // Why a legend earns a tier of its own. It is not a label — a label names the
  // instrument and then gets out of the way, which is what `dim` is for, and
  // every one of those bars titles itself in `dim` on the line above. And it is
  // not a reading — the eye is meant to land on the BAR, so a legend set in
  // `ink` competes with the picture it annotates. It is a caption on a graphic:
  // read second, read in full, never mistaken for the thing it captions.
  //
  // `StageCapacityPanel` argues the rank inside one sentence: the named
  // families print in this, and the `+N <1%` tail that follows them in the same
  // line drops to `dim`.
  legendInk: '#9FB0BD',
  dim: '#7C8794',
  // The module registry's own grey, for the CKB·01 / PEER·02 count-off tags.
  // Below `dim` on purpose: a tag is an address, not a reading. A panel that
  // owns an identity accent overrides it with that accent instead.
  //
  // RAISED from #5A6470 on 2026-09-05 (the user's D-15). It was 3.4:1 on the
  // panel and 2.9 on a rose-lit plate, at `micro` and `tech` — under 4.5 at
  // the two smallest rungs in the HUD, which is where a contrast floor is
  // least negotiable. "An address, not a reading" is an argument for ranking
  // it below `dim`, and the rank oracle in `hudDiscipline.test.ts` still pins
  // that; it was never an argument for putting it under the floor.
  //
  // And then a second notch, on the user's ruling the same day: D-15's own
  // #6B7684 cleared the floor by 0.0002 — 4.5002 : 1 composited in float, and
  // 4.493 if the panel is rounded to whole channels first, so which side of
  // the line it fell on was a property of the arithmetic rather than of the
  // colour. A token whose compliance depends on how you round is not a
  // decision, it is a coincidence. #6C7785 is 4.56 on the panel with the
  // margin to be measured either way, and the step under `dim` is still a
  // clear one (27.1 of separation, one rung of the ink ramp).
  moduleSlate: '#6C7785',
  nominal: '#27FF5A',
  caution: '#F6E201',
  // Amber, and deliberately decoupled from chrome. `warning` used to be the
  // exact `#FF9830` the whole frame is painted in, so the middle severity was
  // chromatically invisible — a warning read as more furniture. Pulled off the
  // chrome hue the ramp nominal → caution → warning → danger → crit has four
  // real steps. Any retune stays inside the amber band and stays legibly apart
  // from BOTH `orange` and `caution` at a 6px dot; hue alone is thin work here,
  // which is why severity also changes treatment (see the fill rule above).
  warning: '#FFB000',
  danger: '#FF3030',
  // The deepest red, and not a fourth alarm hue: by the time `crit` arrives the
  // bar is already painted `danger` and there is no louder colour left, so the
  // last step of the ramp escalates in SHAPE instead — hazard banding along the
  // band's own edges — and this darkens the ground underneath it at .35 so the
  // banding has something to be laid on.
  //
  // `WarningBar` is that one reader, and for the life of the file it was not
  // even that: the bar typed `rgba(139,0,0,.35)` — this value, expanded — in a
  // file whose third line imports this palette. An orphan token and a token
  // retyped at its only call site read identically from here; both mean the
  // name is not where the value lives. `hudDiscipline.test.ts` holds it to the
  // single reader, the same bargain `termGreen` makes below.
  crit: '#8B0000',
  // CRT phosphor. Not a fourth semantic green — the light a cathode tube
  // glows, which is why it is harder and more saturated than any state token.
  // It has exactly one reader: `BlockCadenceEcg`'s `COND_COLOR_TRACE`, which
  // strokes the ECG canvas in this while the chain's cadence is FINE, with the
  // `● FINE` lamp beside it still lit in `nominal`. Two greens on one panel is
  // deliberate and `hudDiscipline.test.ts` holds them apart: one is an
  // instrument's ink, the other is a status lamp, and they look like different
  // things because they are different things.
  //
  // The escape hatch, because the phosphor is a judgement a person makes at
  // the running panel and not one this file can make: if it reads as a
  // mistake, this token and `COND_COLOR_TRACE` are deleted together. There is
  // no second use — the token shipped as an orphan for months, and a palette
  // carrying hexes nobody reads is exactly how this one drifted.
  termGreen: '#00F700',
} as const;

// ——— Slots that mean nothing ————————————————————————————————————————————
//
// The one ramp in the HUD where a colour is only a POSITION. Two bars read it,
// and both hand a slot out by something that carries no meaning of its own: the
// peer atlas hashes a country code or a client version string, and the STAGE
// script-family bar goes by RANK — its own comment says the ranking is used
// precisely because it "guarantees neighbouring segments differ", which is a
// statement about legibility and not about what a family IS. Slot 0 is not
// consensus content; it is just first.
//
// So mapping either bar onto `CONTENT_BANDS` would be a lie in a direction no
// reader can check: it would say a country, or a position in a sorted list,
// belongs to a family of things it has nothing to do with. What a slot owes is
// only that it can be told apart, and that it never impersonates a layer that
// does mean something. Six hues of their own, checked against every reserved
// tone, every content band and every text tier rather than borrowed from any of
// them. Closest pair inside the ramp is 90.2, and the nearest any member comes
// to anything outside it is 47.2 — both clear of the separation floor.
//
// The green sector is excluded on purpose and that is the load-bearing part of
// this comment. Green is spoken for by `nominal`, and a country must never read
// as health: a bar where Germany is green and Singapore is amber is a bar that
// appears to be grading nations. The sixth slot was nearly a moss green, for
// want of an unspent hue — and it would have built exactly that bar beside slot
// 1's gold, while sitting 44.9 from `moduleSlate`, tighter than any member of
// the five it was joining. The violet between slot 0's indigo and slot 2's
// orchid was the untenanted gap, and taking it cost nothing: the ramp's margin
// against everything outside it is the same 47.2 at six slots as at five.
//
// One ramp for all of it, not three. The atlas used to keep two arrays that
// agreed on three of their five values anyway, and the first slot of its
// version ramp was `#ff9d52` — 34.4 from chrome orange, the same near-frame
// colour the byte orbit and the activity feed had each arrived at separately.
// The script bar kept a third list: two chrome tokens, one SEMANTIC token
// (`caution` — a health tone naming a script family) and three literals, one of
// them a character-for-character copy of `CONTENT_BANDS.script`.
export const QUALITATIVE_BUCKET_COLORS: readonly string[] = [
  '#465EB8',
  '#D0B846',
  '#CA94D0',
  '#B24670',
  '#5ED0D0',
  '#983BC6',
];

/** The other kind of bucket ramp, and the one the six slots above cannot be.
 *
 *  `QUALITATIVE_BUCKET_COLORS` hands out a slot by a hash of a label, because a
 *  country and a client version have no order to draw. One bar in the HUD does:
 *  PEER·02's reach bar splits the peers a crawl round considered into
 *  `no answer → answered from another chain → answered from this one`, which is
 *  how far the crawler got with each, coarsened to whole peers. Handed three
 *  unrelated hues, that progression is scrambled into a colour wheel and a
 *  reader can no longer put two segments in order.
 *
 *  So it steps in BRIGHTNESS, in one hue, which is what a sequential ramp is.
 *  The hue is `peerWire` — the peer plane's own wire, on the peer panel, about
 *  peers being dialed — and the ladder is the alpha, which is the reading the
 *  palette already carries brightness in everywhere else it means "further
 *  along" rather than "other than". Three values and not one new colour: an
 *  ordinal built out of fresh hexes would have to clear the reserve, clear each
 *  other, AND rank monotonically, and the answer to all three at once is the
 *  ramp a single hue gives for free.
 *
 *  It is also what tells this bar apart from the two under it at a glance,
 *  which it needs more than most: it counts every peer the network NAMED while
 *  they count only the peers the crawler VERIFIED, so a reader who took it for
 *  a third census strip would read it against the wrong denominator. Several
 *  hues means qualitative, one hue ramping means ordinal.
 *
 *  The floor is not decorative. `0.28` is where the quietest step still clears
 *  the `trackGround` channel it is drawn on by the palette's own separation
 *  floor, and the even spacing is what keeps every neighbouring pair clear of
 *  each other. `hudDiscipline.test.ts` composites the whole ladder over the
 *  track and holds both. */
export const ORDINAL_REACH_RAMP: readonly string[] = [0.28, 0.64, 1]
  .map((alpha) => rgba(HUD_COLORS.peerWire, alpha));

// ——— Cell identity ———————————————————————————————————————————————————————
//
// VERDICT, adjudicated at the running stage on 2026-08-23: the cell mesh wears
// the galaxy's rose on BOTH surfaces — the CELL MESH panel and the cell card's
// frame — and cyan goes back to belonging to the peer plane. The gate shipped
// this behind a one-line switch with two alternatives beside it (rose on the
// panel only, and the pre-rebind all-cyan HUD); they were looked at side by
// side and lost. A settled decision is documented, not kept as a pair of dead
// branches waiting for a question nobody is asking any more.
//
// The two constants below are what every surface reads, so no file downstream
// ever re-asks the question. The rule they encode: the FRAME carries identity —
// a panel header's module tag, a card's plate border, the tether that ties the
// card to the thing it is about. The CONTENT keeps its own vocabulary — the
// braid's cyan, the memory violet, the value golds, the fact accents that name
// a lock or an asset. So a rose card frame around a cyan register is not a
// clash; it is the card saying "this is a Cell" in its border and "here is what
// the Cell holds" in its body.

/** The CELL MESH panel's own colour — its module tag, and any chrome that
 *  exists to say which organism the panel is counting. */
export const CELL_PANEL_ACCENT = HUD_COLORS.cellRose;

/** The cell dossier's frame colour: plate border, card glow, scan beam, and the
 *  tether back to the Cell on stage while no fact is selected. A fact IS
 *  selected → that fact's own colour wins, as it always did. */
export const CELL_CARD_ACCENT = HUD_COLORS.cellRose;

/** The four voices of the overlay, each one a STACK rather than a face.
 *
 *  `JetBrains Mono Local` sits behind all three Latin voices and is not a
 *  fallback in the usual sense — nothing here is expected to fail to load. It
 *  is a SYMBOL fallback, and CSS resolves a family list per CHARACTER: a span
 *  set in `display` takes its letters from Saira and, for a character Saira
 *  does not have, the next family that does.
 *
 *  It is here because the three Latin faces are Google Fonts' pre-built
 *  `latin`-range woff2, and that range is a published, fixed list that stops
 *  before the Geometric Shapes and Arrows blocks almost entirely. `→` is not
 *  in it. Neither is `←`, `↔`, `◇`, `◆`, `●`, `▲`, `▼`, `▦`. So every symbol
 *  the HUD writes into a sentence — the route arrows on the identity plate,
 *  the read-marks on a proof, the lag arrow on an enrichment chip — was
 *  resolving out of whatever the reader's machine happened to have installed,
 *  which is not the same font twice across two machines and is not our font on
 *  either. Nothing errored; the HUD just looked slightly wrong to somebody who
 *  was not looking for it, which is the exact failure `src/fonts/README.md`
 *  documents for the hand-cut Chinese face and nobody had asked of this side.
 *
 *  The arrangement is not new either — `CellGalaxy` has always listed this
 *  face behind `Orbitron Local` for the same reason, and the README says so.
 *  This is that ruling applied to the surface that never got it. It costs no
 *  bytes: the face is already registered and already shipped.
 *
 *  What the symbol face does NOT carry, the HUD may not write: `▦`, `↔`, `∅`
 *  and the rest are in no face this repo ships and none it could — they are
 *  drawn as marks in `primitives.tsx` instead. `hudDiscipline.test.ts` holds
 *  every face's inventory and fails on a character no stack at a site covers. */
export const HUD_FONTS = {
  display: "'Saira', 'JetBrains Mono Local', system-ui, sans-serif",
  tech: "'Chakra Petch', 'JetBrains Mono Local', system-ui, sans-serif",
  mono: "'Share Tech Mono', 'JetBrains Mono Local', ui-monospace, monospace",
  cjk: "'Huiwen-mincho', 'Noto Serif CJK SC', 'Noto Serif SC', 'Songti SC', SimSun, serif",
} as const;

/** The type scale for the WHOLE DOM HUD — top bar, rails, banners, floating
 *  cards, every panel. It used to describe only the detail/inspection surfaces
 *  while the panels ran a freelance dialect beside it, which is how the HUD
 *  ended up with five hero sizes nobody had ranked and a 6.8px caption. Every
 *  rendered fontSize out here must be one of these rungs; depth is expressed by
 *  stepping down the scale, never by inventing a size between its steps.
 *
 *  `micro` (7.5) is the legibility floor, full stop. Below it the Chakra/Share
 *  Tech faces stop resolving their counters on a normal display, so "make it
 *  smaller" stops being a design decision and becomes a thing you cannot read.
 *  Anything that will not fit at 7.5 needs fewer words, not smaller ones.
 *
 *  Hero tiers are named so a panel can only have one: `hero` is the single
 *  numeral a panel exists to show, `heroSub` is a second reading standing
 *  beside it (DAO's APC next to its deposit total, the alarm's 警告), and
 *  `emphasis` is a value lifted out of a stat row without leaving the row.
 *
 *  ⭐ THE LADDER IS TOTAL, AND THE ONE EXEMPTION IS A CONSTRUCT.
 *
 *  A size is exempt when it is handed to a MATERIAL: a troika `<Text
 *  fontSize={0.12}>` is glyph GEOMETRY, its number is a distance in world
 *  units, and checking it against a pixel ladder would be a category error.
 *  Nothing in this package draws one today, so the exemption currently has no
 *  occupant and every size written here is a DOM size on a rung.
 *
 *  This paragraph used to exempt "the in-scene label dialect" — the files that
 *  IMPORT `three` — on the grounds that they draw additive material under a
 *  camera, so a 6px mark there is a mark that is present rather than a word
 *  that is read. Every clause of that is true of a mesh and false of the thing
 *  it exempted: those labels are drei `Html`, which mounts a plain `<div>` in
 *  a DOM layer over the canvas and positions it from a projected point. They
 *  are INK — composited onto whatever is behind them, rasterised by the
 *  browser like every panel — and they sat at 5.4–8px on a `stageGround` wash
 *  with Han at 7 (report B, B-11; report F, F-11). A file's imports say where
 *  its module lives, not what its numbers are given to.
 *
 *  Before that the same paragraph said "under a camera and a BLOOM PASS", and
 *  there has never been a bloom pass in this application — no
 *  `EffectComposer`, no `postprocessing` dependency, no tone-mapped path. Two
 *  wrong reasons for one exemption, in one paragraph's life: this file is the
 *  design system's own record and people reason downstream from it, so the
 *  oracle checks the premise now — that nothing draws material text, and that
 *  every scene label is `Html`.
 *
 *  ⚠️ HAN HAS A FLOOR OF ITS OWN, ONE RUNG UP: `label` (9). `micro` is where
 *  Chakra and Share Tech stop resolving their counters; a mincho glyph carries
 *  several times their stroke count in the same em. `CellByteBudget` argues it
 *  at length and `StatusStrip`'s 状态 has always sat there. Every object that
 *  names `HUD_FONTS.cjk` states its own size and its own 400 weight — Huiwen
 *  registers no weight and inherits whatever an ancestor said, which is how a
 *  companion ended up synthesised bold once already. */
export const HUD_TYPE = {
  hero: 22,
  heroSub: 19,
  emphasis: 14,
  title: 13,
  panelTitle: 12,
  value: 11.5,
  section: 10.5,
  label: 9,
  tech: 8.5,
  nav: 8,
  micro: 7.5,
} as const;

/**
 * The smallest a control may be to a HAND, in CSS px.
 *
 * Apple's 44 pt, and on an 11" iPad — 130.6 CSS px to the inch — that is
 * 8.5 mm, which is a fingertip. It is deliberately NOT a rung of `HUD_TYPE`:
 * type size is how loud a reading is and this is how far a hand can miss, and
 * the two only ever coincided because nothing had asked the second question.
 *
 * Read by `.cknerv-touch-target` (below) and by the controls that grow their
 * own box rather than a pseudo-element, so the answer is spelled once.
 */
export const TOUCH_TARGET_MIN_PX = 44;

/**
 * The viewport a reader can actually SEE, less a reservation, as a `calc`.
 *
 * `100vh` is the whole page box, and since `index.html` asked for
 * `viewport-fit=cover` the page box includes whatever a system surface is
 * sitting on: the home indicator's band, a floating browser toolbar, a
 * notch's ears. `HudOverlay`'s root has stood inside `env(safe-area-inset-*)`
 * since d5086302, and everything positioned INSIDE it went on measuring
 * against the uninset viewport — so on any screen that covers something,
 * every one of those boxes was over-tall or over-wide by the insets and lost
 * the difference to the root's `overflow: hidden`.
 *
 * The floating cards need it for a different reason and get the same answer:
 * their layer is deliberately NOT inset (a card is placed at its cell's
 * projected screen position, so insetting the layer would slide every card
 * off its anchor), but a card must still not be laid out into a band the
 * reader cannot see.
 *
 * On a desktop every inset resolves to `0px` and this is `calc(100dvh - N)`
 * again, character for character in effect. `Jukebox.tsx` has spelled it out
 * by hand since the safe-area work; this is that sentence, once.
 *
 * ⭐ THE HEIGHT UNIT IS `dvh`, AND THE INSETS ALONE WERE NEVER ENOUGH.
 * `100vh` is the LARGE viewport: the page box as it would be with the
 * browser's own chrome retracted. A browser toolbar is not a safe-area inset
 * and `env()` says nothing about it — measured on an 11" iPad in landscape
 * Safari, `100vh` is 763px, `100dvh` is 688px, and every inset but the home
 * indicator's 25px bottom reads ZERO. So this returned 738px of room on a
 * screen with 688, and every cap built on it was 50px too generous — a
 * reading could be laid out into a band that does not exist. `dvh` is the
 * unit that knows about chrome; on a desktop, and in an installed app with no
 * toolbar, it is `vh` again to the pixel.
 */
export function viewportMinusSafeArea(
  axis: 'width' | 'height',
  reservePx = 0,
): string {
  const [start, end] = axis === 'height'
    ? ['top', 'bottom']
    : ['left', 'right'];
  const unit = axis === 'height' ? '100dvh' : '100vw';
  return `calc(${unit} - env(safe-area-inset-${start}, 0px) - env(safe-area-inset-${end}, 0px)${
    reservePx ? ` - ${reservePx}px` : ''
  })`;
}

// ——— Tracking ————————————————————————————————————————————————————————————
//
// Letter-spacing had drifted to 45 distinct values across the HUD — 0.28 and
// 0.3 and 0.32 and 0.34 and 0.35 all living in the same card, none of them
// telling a reader anything the others did not. They are now snapped to one
// eight-rung table, nearest wins, ties going to the TIGHTER rung because that
// is the direction that cannot make a line wrap:
//
//   0.35  running text and hex strings (mono, no shouting)
//   0.6   dense chrome readouts, menu rows
//   0.9   captions and small state words
//   1.2   the standard uppercase label
//   1.4   chips — both the outline kind and the inverted severity block —
//         a plate's own SECTION header, and the floating-card dialect's
//         readout label (see below)
//   1.6   stat-row labels, and the NAME a card or plate carries at its head
//   2     banner titles, condition words
//   3     panel titles
//
// An explicit `0` is not a rung — it is the absence of tracking, which a run of
// mono digits sometimes genuinely wants.
//
// Those two lines said "1.6 stat-row labels, plate titles", and the plate-title
// primitive — `SpatialPlateHeader` — has always been set at 1.4. The record was
// wrong rather than the code: a floating card has TWO kinds of title, and they
// are on two rungs on purpose. The masthead is the card's own name, in the
// display face at `title`, and it is the thing the card is called: `NODE //
// node-1`, `CELL // #4,102,993`, the replay plate's `RESTORING CKB
// CONTINUITY`. A `SpatialPlateHeader` is a section header INSIDE that card, in
// the tech face at `section`, naming one plate of several. Calling both of them
// "plate titles" collapsed a real distinction into an ambiguity, and an
// ambiguity in a design system's own record is read as a licence.
//
// MEMBERSHIP IS HALF THE RULE, and for this table's whole life it was the only
// half anybody checked. Every rung above is legal, so a sweep that asks nothing
// but "is this a rung?" passes a HUD where one ROLE is set four different ways
// — and that was the state of the cell card. Read it top to bottom and the dim
// word that names a reading ran 1.4 → 0.9 → nothing at all → 0.6; `COMPOSITION`
// and `CKBYTE` are the same object one zone apart and were set at 1.4 and
// 0.9. Three full-width condition boxes in the peer family sat on three rungs
// — `LINK LOST` at 2, the sync ladder's state word at 1.6, `WE LAG` at 1.4 —
// so the most severe of the three was the one set tightest.
//
// So the other half: ONE ROLE, ONE RUNG.
//
//   condition box   2, the rung the table already names for condition words. A
//               box that spans its card, declares its own type — the `tech`
//               voice at `label`, bold — and sits on a wash of its own colour
//               to say what CONDITION something is in: `LINK LOST`, `WE LAG · n
//               BLOCKS BEHIND THE FURTHEST PEER`, the sync ladder's state word.
//               That description is a CONSTRUCT, so the oracle recognises the
//               role instead of listing its sites and a fourth box is governed
//               the day it is written.
//
//   readout label   1.4. The dim `micro` word that names a reading in the
//               floating-card dialect: `PlateReadoutRow`'s label, the cell
//               dossier's `COMPOSITION`, the sync ladder's `LOCAL` and `PEER`,
//               `CKBYTE`, `FREE`, the evidence register's `OWNER` and
//               `AMOUNT`, the content window's `VALUE`. It is the panel
//               dialect's stat-row label (`tech`, 1.6) stepped down one rung in
//               size and one in tracking together — the same dense-register
//               argument the last exception in this comment makes for the peer
//               card, applied to the dialect rather than to one panel.
//
//               This rule is PARTIAL, and `hudDiscipline.test.ts` says so where
//               it states it. A label, a caption and a right-aligned meta stamp
//               are the SAME THREE PROPERTIES in source — `color: dim`,
//               `fontSize: micro`, a string — and differ only by where they sit
//               in the row, which is not written in the style object. Thirty-
//               nine dim `micro` style objects in the DOM overlay carry eight
//               different trackings and most of them are right. So the oracle
//               NAMES the surfaces this role is on rather than pretending to
//               derive them, and a new one has to be added by hand. A narrow
//               rule that admits it is narrow beats a broad one that is wrong,
//               which is the same ruling the type scale's scene exemption got.
//
// Declared exceptions, each one a place where the rung would be wrong rather
// than merely different:
//
//   4.2 / 2.6   `StatusStrip` CKNERV wordmark, wide and dense. The brand is not
//               a label; the spacing IS the logotype, and the dense variant is
//               the same logotype fitted to a narrow bar.
//   4           `WarningBar` 警告. Two mincho glyphs at 19px need air between
//               them or they read as one dense block instead of a siren.
//   −0.25       `DaoStateReadout` deposit hero. The only NEGATIVE tracking in
//               the HUD, and it is there to keep a long CKB figure inside its
//               column at the `hero` rung — tightening a hero is how you avoid
//               demoting it.
//
// And one exception that is about SIZE rather than tracking, recorded here
// because it is the same kind of declared divergence — the dense register:
//
//   dense register  `PeerLinkCard`'s `PeerScanFact` sizes a fact one rung below
//               `CellDetailPanel`'s `CellScanFact` (micro/label vs
//               label/value). Not drift: the peer card is 340px wide and lays
//               its facts out two to a row, so cell-card type would ellipsis
//               away the ends of the values that matter most. The two files
//               name each other in a comment so neither gets "fixed" into the
//               other.

// ——— Time —————————————————————————————————————————————————————————————————
//
// The fourth ladder, and the last dimension of this system that had none.
// Colour has a palette with a separation floor, type has eleven rungs,
// tracking has eight and alpha has three — and time had TWENTY-SEVEN distinct
// durations under four seconds and SEVEN easings, every one of them a literal
// typed at the site that needed it (report E, E-1). Two things follow from
// that, and the second is the reason this table exists at all:
//
//   a reader cannot learn a language with twenty-seven words for six ideas.
//   140 and 160 and 180 are not three speeds; they are one speed, spelled
//   three times, and the difference between them is below the threshold at
//   which anybody can tell two transitions apart.
//
//   and nothing could be RESERVED. `steps(2)` is meant to say ALARM and
//   `linear` is meant to say INSTRUMENT — a machine's own time, moving at a
//   rate that has nothing to do with a reader's attention. Neither can mean
//   anything while any file may reach for either.
//
// SIX RUNGS, and they are about WHAT MOVES rather than about how long:
//
//   flip    120   A state change with no travel: a colour, a background, a
//                 caret sliding to the row it belongs to, a lamp. And a card
//                 LEAVING, which is the same event — going is not an arrival
//                 played backwards, it is the end of one, and a slow exit
//                 reads as hesitation.
//   reveal  260   Something becoming visible IN PLACE. The reveal ghost every
//                 staged card wears, a fact's value arriving under the probe,
//                 the card chassis itself, a panel giving way under one.
//   enter   360   Something ARRIVING — with a shape, from somewhere else. A
//                 bar growing to its measure, a hop locking on the route, a
//                 level kicking on a block. Longer than a reveal because
//                 there is a distance in it to read.
//   linger  700   A beat HELD so it can be read: the boot band's last frame,
//                 the alarm's flash period.
//   grow  1,200   A change with a shape to watch: the scene's births and its
//                 nerve growth (`cellPositions`, `fabricEdgeRender`), and the
//                 fast breathe — the one an unmoving reading wears to say it
//                 is stopped rather than gone.
//   hold  2,400   A state kept alive after its cause is over: the peer card's
//                 LINK LOST retention, the reader's COPY toast, an attract
//                 loop, the specimen sweep, the calm breathe.
//
// FIVE EASINGS, each with a job, and three of them RESERVED:
//
//   enterEase   The one bezier. A fast start into a long settle, which is what
//               makes a thing read as arriving rather than as a light being
//               turned up. There were two of these 0.02 apart, which is one
//               bezier typed twice.
//   fadeEase    `ease`, for every fade and every exit. Leaving needs no
//               character.
//   loopEase    `ease-in-out`, and ONLY for the breathe — a loop that eases
//               one way and not the other is a loop with a seam in it.
//   instrumentEase  `linear`, RESERVED for instruments: the scan beam, the
//               specimen sweep, the ECG. A machine's own time is not eased,
//               and a reader who has learned that reads "this is being
//               measured" from the motion alone.
//   alarmEase   `steps(2)`, RESERVED for the alarm. One idea, one wearer: a
//               hard two-state flash is what a siren looks like, and nothing
//               that is not a siren may borrow it.
//
// WHAT IS NOT ON THIS LADDER, named rather than left to be discovered — an
// INSTRUMENT'S OWN CLOCK. These are not motion; they are the rate at which a
// machine samples or advances, and rounding one to a rung would change what
// the instrument measures rather than how it looks:
//
// Named per FILE, because a number is exempt where its instrument lives and
// nowhere else, and `hudDiscipline.test.ts` reads both halves of each line —
// so an exemption cannot outlive the number it was granted for:
//
//   `probeScan.ts` 300  the CELL SCAN's landmark dwell, spelled `PROBE_STEP_S`
//                       = 0.30 s. The walk is six of them and every staged
//                       gate in the dossier is a threshold on the count.
//   `cellScanClock.ts` 80  its sampling period. The beam's own transition
//                       READS this constant, so the beam interpolates between
//                       two samples rather than racing them.
//   `cellConstellationCameraMotion.ts` 80  the camera classifier's evidence
//                       window. It waits for cumulative screen drift to stay
//                       below its settle threshold; no visual transition is
//                       assigned this duration.
//   `BlockCadenceEcg.tsx` 100 · 1000  the trace's 10 fps redraw and the PULSE
//                       stopwatch's tick, which drops to 1 Hz when motion is
//                       reduced — a slower instrument, not a stopped one.
//   `hudClock.tsx` 1000  the page's one wall clock.
//   `HudOverlay.tsx` 1000  the composition sampler's period. Its settle and
//                       quiet windows (15 s, 60 s) are over this ladder's
//                       four-second horizon and are policy, not motion.
//   `orbit-gesture-state.ts` 180  input, not motion: it decides whether a
//                       pointer-up counts as a click after a drag. Nobody sees
//                       it, and shortening it to a rung would be retuning a
//                       gesture in order to tidy a table.
//   `adaptiveQuality.ts` 750 · 1500 · 250  the frame sampler's window, the EMA
//                       it feeds, and the length at which a frame stops being
//                       a frame. MEASUREMENT, not motion — nothing moves at any
//                       of the three, and each was chosen against how a machine
//                       proves it cannot carry a tier. The crossfade that file
//                       DOES own reads `linger` like everything else that
//                       moves.
//
// `hudDiscipline.test.ts` parses every `transition:` and `animation:` string
// in the overlay and every visual timer constant, and holds them to this.
export const HUD_MOTION = {
  flip: 120,
  reveal: 260,
  enter: 360,
  linger: 700,
  grow: 1_200,
  hold: 2_400,
  enterEase: 'cubic-bezier(.2,.82,.2,1)',
  fadeEase: 'ease',
  loopEase: 'ease-in-out',
  instrumentEase: 'linear',
  alarmEase: 'steps(2)',
} as const;

// ——— Alpha ————————————————————————————————————————————————————————————————
//
// The one dimension of this system nobody had declared, and the evidence that
// it needed declaring is a single idea drawn six ways: the RULE between two
// blocks of the cell dossier was 0.09, 0.13, 0.15, 0.18, 0.24 and 0.32.
//
// 0.09 is not merely inconsistent with the others. It is below the value this
// HUD has already written down as INVISIBLE: `CellDetailPanel.tsx` says of the
// two rules between its three ranks that they "were drawn at 0.12 and 0.18
// alpha — under this background that is no rule at all", and raises them. The
// MEMORY TRACE separator a thousand lines up in the same file was still 0.09 —
// and drawn in the consensus cyan, inside a provenance footer that is violet.
//
// Three rungs, and they are about WHAT A LINE SEPARATES:
//
//   0.16   A RULE. The line between two sections of one readout, or between two
//          clusters inside one section: the DAO capacity band's brackets, the
//          activity feed's and the chain and horizon readouts' section tops,
//          every separator in the content window, the dossier's MEMORY TRACE.
//   0.32   A ZONE BREAK. The line between two RANKS of a card — the dossier's
//          register/analysis break and the break into its provenance footer.
//          Twice a rule, because a rank is not a section.
//   0.07   A rule on the STATUS STRIP, between the bands of the instrument's
//          own chrome. It has a rung of its own and the reason is measured,
//          below; it is not a grandfathering.
//
// And one more that is not a rule at all but is the same class of promise, so
// it is recorded here and lives where its machinery lives:
//
//   ghost  `REVEAL_GHOST_OPACITY` in `primitives.tsx` — 0.18, the dark an
//          unreached stage of a card's reveal wears. Its own doc comment says
//          "One number so no two stages can disagree about what dark means",
//          and two files were writing the literal instead of importing it, one
//          of them without importing the module at all.
//
// WHY THE STRIP GETS ITS OWN RUNG. A rule is read as its alpha TIMES the
// brightness of the ink it is drawn in, and this palette's inks are nothing
// like one brightness: `cyanWire` is twice the relative luminance of `memory`,
// and about 1.6× `orange`. The strip's hairlines are cyan; a panel's rule is
// its accent. Measured against the near-black both surfaces are painted on,
// cyan at 0.07 and orange at 0.16 land within 1.4× of each other — so snapping
// the strip to the panel rung would not tidy anything, it would make three
// hairlines two and a half times louder than the rules they currently match.
// The strip had three values for one job (0.055, 0.06, 0.07) and now has one.
//
// AND WHY THE ZONE BREAK IS THE HIGHER OF ITS TWO. The dossier's two rank
// rules were 0.24 in cyan and 0.32 in violet. Nothing argued the pair: they
// were raised together, in one edit, out of one comment, and landed on two
// numbers. They are one rung now, and it is 0.32 — because the recorded
// failure mode of this line is that it went INVISIBLE, and the rung has to be
// set by the dimmest ink that has to wear it, which is the violet at half the
// cyan's luminance. The same arithmetic is why the MEMORY TRACE rule keeps its
// weight while moving two rungs and changing colour: violet at 0.16 is within
// a hair of what cyan at 0.09 was.
//
// WHAT THIS LADDER DOES NOT GOVERN, and why, because a ladder that reached for
// all of them would be wrong about most:
//
//   material alpha   The scene is additive light on the stage ground with tone
//               mapping off, not ink composited onto a lit panel — the same
//               argument that exempts it from the type scale. A shader uniform
//               and a `<meshBasicMaterial opacity>` are that medium; an alpha
//               rule written for a DOM hairline would be nonsense there.
//   canvas       The ECG's trace is phosphor drawn with `globalAlpha` on its
//               own canvas, which is neither.
//   a wash       `background: rgba(c, a)` under a block. How much ground shows
//               through is a property of THE PAIR — the colour and the surface
//               it tints — not of a role, and the dossier's composition block
//               argues its own 0.07 on exactly those terms.
//   a glow       `boxShadow` / `textShadow`. Atmosphere, sized to its source.
//   a track      The empty half of a meter is `trackGround`, a colour.
//
// ——— And the RAILS, which are the same idea turned on its side —————————————
//
// Two things this ladder said about itself were not true, and the scan
// (report F, F-1 and F-7) measured both:
//
//   "a rail: `PLATE_ROW_RAIL_ALPHA`, already one number in one place" — the
//   overlay drew FOURTEEN vertical rails at twelve alphas, from 0.14 to 0.561.
//   One number was in one place; thirteen rails were somewhere else.
//
//   "an EDGE … `spatialPlate` … is single-sourced in `primitives.tsx` so it
//   cannot drift anyway" — true of `spatialPlate`, and the exemption was read
//   as covering every edge. `ConsensusIdentityPlate` and `CellCausalLensReadout`
//   draw their own plates by hand, in a hex-suffix notation this file's rule
//   sweep could not even parse, at seven more alphas between 0.102 and 0.478.
//
// A rail is a rule stood upright: it separates a row from the measure it hangs
// in, and it is read the same way — alpha times the brightness of its ink. So
// it gets the same treatment, and the rungs are about WHAT HANGS ON IT. They
// live in `primitives.tsx` beside the row grammar that wears them, and this
// table is the record of what each one means:
//
//   RAIL 0.34   A ROW's rail — `PLATE_ROW_RAIL_ALPHA`. Every fact of every
//               card dialect, the DAO's second hero, the peer's sync ladder,
//               the memory ledger's evidence rows. The overlay's default.
//   RAIL 0.46   A PLATE's own left edge — `PLATE_EDGE_ALPHA.rail`, with 0.15
//               on top and 0.09 underneath. Lit from the left, and now read by
//               the two hand-drawn plates as well as by `spatialPlate`.
//   RAIL 0.55   A LIT rail — `PLATE_ROW_RAIL_LIT_ALPHA`, drawn 2px, worn by
//               the dossier's composition blocks. Louder than the plate that
//               holds it on purpose: the block's own comment says "this is a
//               card among rows, and the edge is what says so before the type
//               does", and a rail that only matched its neighbours could not
//               say it.
//   RAIL 1      Under the pointer — `PLATE_ROW_RAIL_HOT_ALPHA`, and a corner
//               bracket, which is a mark rather than a rail and is drawn at
//               its own colour for the same reason.
//   RAIL 0.14   The STATUS STRIP's, for exactly the reason its rule rung is
//               0.07: the strip's hairlines are cyan on the instrument's own
//               chrome, and cyan at 0.14 lands where a panel's accent lands at
//               0.34. Its two rails were 0.14 and 0.3; the control that wore
//               the louder one says its state in its COLOUR — cyan at the
//               default, orange when you have diverged from it — so a second
//               rail weight was saying it twice, and only for the half of the
//               time the chip is cyan.
//
// ——— And DIMMING, which is not an alpha at all ——————————————————————————————
//
// `opacity` on a whole object — the third notation the same idea was written
// in, and the one with no ladder of any kind: the overlay dimmed things at
// 0.55, 0.6, 0.62, 0.68, 0.7, 0.72, 0.75 and 0.8, and the eight numbers were
// saying two things.
//
// They are two because the READER does two different things with them. A
// dimmed READING is one you are being told not to trust yet — you look at it
// and then look for why. A dimmed COMPANION is one you are being told you may
// skip — a name's second name, which you read once and never again. Nothing in
// between needs a weight of its own, and eight weights for two sentences means
// no sentence had a weight.
//
//   STALE      0.88 — a reading whose source has gone quiet, a bar whose data
//              is partial, a compass with nothing measured on it, a proof not
//              yet read, a row that cannot be armed. Eight of the nine
//              staleness sites already wore 0.68; DAO's 0.72 was the ninth.
//   COMPANION  0.88 — the CJK name beside its Latin (细胞, 对端, 节点, 字节元,
//              and every `SpatialPlateHeader`) and the scope tag beside its
//              count (`CHAIN`, `OBSERVED`, `STAGE`). Same role, same shape: a
//              qualifier set one rung down beside a name, dimmed so it never
//              competes with the thing it qualifies. It was 0.7 in two places
//              and 0.72 in five; the tags were 0.8.
//
// AND NEITHER WEIGHT IS A TASTE. BOTH ARE THE FLOOR (the user's rulings, 14
// and 17, 2026-09-05). At 0.72 a companion in `dim` composited to 3.35 : 1 on
// the panel and 3.11 on a rose-lit one, at `label` — 9px, the smallest size
// this HUD sets Chinese at, and a mincho stroke is thinner than the Latin
// beside it at the same size. "You may skip this" and "you cannot read this"
// are different sentences, and the first is what a companion means: the
// reader's EYE is meant to pass over it, not the reader's ability to. So the
// number is derived rather than chosen — the least dimming that still puts
// the dimmest ink a companion wears (`dim`; every other companion is drawn in
// a card or plate ACCENT, all of them brighter) over 4.5 : 1 on the panel,
// which is 0.872, rounded up to 0.88 → 4.57. `hudDiscipline.test.ts` computes
// that floor rather than pinning the number, so a companion put in a new ink
// tomorrow moves the constant instead of quietly falling under it.
//
// A STALE READING IS STILL A READING, and that is the same sentence one role
// along. 0.68 put the unread identity proof — `dim`, at `label` — at 3.08 : 1,
// which is not "do not trust this yet", it is "do not read this"; and the two
// are opposite instructions, because the whole point of flagging a reading as
// stale is that you should go and LOOK at it. Same ink, same surface, same
// floor, so the same 0.88. The two names stay two because the ROLES are two
// and each is derived from its own dimmest ink — they coincide today, and a
// companion set tomorrow in an ink no stale reading wears would move one of
// them and not the other.
//
// What carries the difference once the weight cannot: the WORD. Every stale
// site says so in language — `· STALE` on the four rail readouts and the DAO
// footer, `ATLAS STALE` on the atlas, `OBSERVED` on a partial byte segment,
// `SPENT INPUTS` on the memory ledger's unroutable ones, ◇ against ◆ on the
// identity proof, an `aria-label` on the unmeasured compass — and the dimming
// is the hint that sends the eye to the word, not the statement itself. That
// inversion is the ruling: a reading dimmed to the edge of legibility says
// "this does not matter", and the one thing a stale reading is NOT is
// unimportant.
//
// What it costs, both times: the gap between a name and its companion, and
// between a fresh reading and a stale one, is now carried mostly by SIZE, by
// the face and by the word — `label` mincho beside `section` tech; `· STALE`
// beside a number — with the dimming as the smallest of the signals rather
// than the loudest. Which is the right order: anything that had to be dimmed
// into illegibility to make its point was making it the wrong way.
//
// NOT this ladder: a control you cannot press. `CellCausalLensReadout`'s
// disabled toggle at 0.34 and `CellContentMemory`'s at 0.4 are not saying "do
// not trust this", they are saying "this does not work", and the reader is
// meant to stop at them rather than look past them. A far dimmer statement, on
// purpose, and folding it in here would make a dead control look merely stale.
export const STALE_OPACITY = 0.88;
export const COMPANION_OPACITY = 0.88;

// ——— Reduced motion, which is a policy and was a courtesy ————————————————
//
// `prefers-reduced-motion` was honoured by whatever file happened to think of
// it: thirteen HUD surfaces, the Jukebox chip, the boot count-off and the nine
// guided scene files all stopped, and the STAGE did not — galaxy rotation,
// births and withers, nerve growth and decay, block waves, couriers, cohort
// mist and the star drift all ran, with `reducedMotion` scoring zero hits in
// six of the scene's largest files (report E, E-6). Meanwhile the overlay
// removed its STATIC SCAN LINES, which is the request inverted: a gradient
// that has never moved was taken away while twelve thousand cells kept
// spinning under it.
//
// Nothing in the UI claimed reduced motion, so this was not dishonest. It was
// unstated, and a rule nobody wrote down is a rule each file decides again.
// The user's D-11 settles it: the stage honours it too. Written here, beside
// the alpha ladder, because this is where the HUD keeps the rules that are
// about a reader rather than about a component.
//
//   DOM      No infinite loop. The breathe, the alarm flash, the specimen
//            sweep, the attract EQ: every `infinite` animation is skipped.
//            FADES ARE ALLOWED — a card that appears without a transition is
//            a cut, which is harder to follow, not easier. TEXTURE STAYS:
//            the scan lines, the grain, the graticule. None of it moves.
//   STAGE    Rotation 0 — both planes, through `motionScale()` in
//            `tweaks/liveTweaks.ts`. Ambient loops off: the star drift, the
//            mist, anything running because the scene is on screen. An EVENT
//            plays at its END STATE rather than at zero speed — a wave frozen
//            halfway is a defect and a wave that never arrives is a lie — so
//            a block reads as a one-frame flash and a lifecycle as its
//            finished form. The camera stops where the hand stopped: a drag
//            is the visitor's OWN motion and stays; the damping tail after it
//            is not.
//   NEVER    Colour, contrast, layout, density or content. A visitor who
//            asked for stillness asked for stillness, not for a different,
//            quieter instrument.
//
// The flag reaches the stage through `LIVE.time.reduced`, published by
// `useReducedMotion`: a `useFrame` callback is not a component and cannot hold
// a hook, and threading a boolean down the scene graph to reach a
// `rotation.y +=` would be the noise the boot record already refused to carry.
export const MOTION_POLICY = {
  /** A DOM surface may fade; it may not loop. */
  dom: { fades: true, infiniteLoops: false, texture: true },
  /** The stage stops turning and stops drifting; an event shows its end. */
  stage: { rotation: false, ambientLoops: false, eventsAtEndState: true, dampingTail: false },
} as const;

/** The optical correction every CJK COMPANION wears, and the reason it needs
 *  one.
 *
 *  A companion sits inline beside Latin on a shared baseline — `PanelHeader`'s
 *  `cjk`, 细胞 on the cell masthead, `CellByteBudget`'s 字节元.
 *  `alignItems: baseline`
 *  is the right alignment for text and it is not the whole story here: the
 *  Latin the HUD sets beside these runs is UPPERCASE, so it stops at the
 *  baseline with nothing below it, while a mincho glyph's ideographic box hangs
 *  under the baseline the way a Latin descender does. Aligned correctly by the
 *  metrics, the Chinese therefore reads as sitting a notch low.
 *
 *  MEASURED off rendered pixels rather than off font metrics, which say the two
 *  are level: the ink of every companion in the overlay ended exactly 1px below
 *  its Latin sibling's — 共识基, 元胞汤, 节点场, 道, 脉搏 at `section`, 字节元 at
 *  `label`. One pixel at BOTH sizes, so this is a constant and not a ratio.
 *
 *  It moves paint, never layout: `position: relative` leaves the row's metrics
 *  exactly where they were, so nothing reflows and no measure downstream of a
 *  companion has to know about it.
 *
 *  ⚠️ NOT for `WarningBar`'s 警告. That is not a companion — it is the siren
 *  itself at `heroSub`, and the bar's height is a stated judgement about how
 *  its line box clears 4px of hazard banding. Shifting it is a decision about
 *  that composition, not this correction. */
export const CJK_BASELINE_LIFT = { position: 'relative', top: -1 } as const;

/** The angle of the HUD's diamond, and the ONLY place it is written down.
 *
 *  `DiamondMark` in `primitives.tsx` draws every diamond in the overlay, and
 *  one of them cannot be a component: the route ledger's scroll marker is
 *  positioned from a CSS custom property the scrollbar writes, so it lives in
 *  the stylesheet below. Two authors, one angle — which is what this constant
 *  is for, and what lets `hudDiscipline.test.ts` ban the literal outright. */
export const DIAMOND_ROTATION = 'rotate(45deg)';

/** A `#RRGGBB` palette color as an `rgba(r,g,b,a)` string — single source for
 *  canvas/border tints that need an alpha the hex form can't carry. */
export function rgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// Self-hosted, subset webfonts — no third-party CDN at runtime. Latin faces are
// Google's latin-range woff2. Huiwen-mincho (public domain) carries the 32 HUD
// glyphs 共识基元胞汤脉搏节点场字对端状态警告道样本细记录交易输入谱系见证 — exactly what
// the panels, the inspector-card companions and the consensus-memory endpoint
// markers render, so any new Chinese needs a re-subset (see fonts/README.md) or
// it silently falls back to a system serif. The last ten arrived with the
// markers, which had been asking a Latin face for Chinese: the string and the
// face are one fix, and `hudDiscipline.test.ts` now checks both.
//
// The two `* Local` families back the in-scene labels (cell-galaxy label,
// consensus-memory markers, route-hop callouts) that name them directly in
// inline `fontFamily` stacks — and JetBrains Mono now backs the three DOM
// voices too, as the symbol fallback `HUD_FONTS` argues for above. Both are
// hand-subset to ASCII printable plus the symbols the HUD renders
// (· × – — • ← → ↓ ↗ ≈ ≤ ≥ ◆ ◇ ✓) with all optional layout features dropped —
// JetBrains Mono's programming ligatures must never fire on a hex id.
// Regenerate with:
//   pyftsubset <face>.ttf --layout-features="" --no-hinting --desubroutinize \
//     --flavor=woff2 --unicodes=U+0020-007E,U+00B7,U+00D7,U+2013,U+2014,\
//     U+2022,U+2190,U+2192,U+2193,U+2197,U+2248,U+2264,U+2713,U+25C6,U+25C7
// Orbitron ships Medium only and the galaxy label asks for 400/500, so the one
// face declares the whole span rather than letting the browser synthesize.
const FONT_FACES = [
  `@font-face{font-family:'Saira';font-weight:100 900;font-display:swap;src:url("${sairaUrl}") format("woff2")}`,
  `@font-face{font-family:'Chakra Petch';font-weight:500;font-display:swap;src:url("${chakra500Url}") format("woff2")}`,
  `@font-face{font-family:'Chakra Petch';font-weight:700;font-display:swap;src:url("${chakra700Url}") format("woff2")}`,
  `@font-face{font-family:'Share Tech Mono';font-weight:400;font-display:swap;src:url("${shareTechUrl}") format("woff2")}`,
  `@font-face{font-family:'Huiwen-mincho';font-display:swap;src:url("${huiwenUrl}") format("woff2")}`,
  `@font-face{font-family:'JetBrains Mono Local';font-weight:400;font-display:swap;src:url("${jbmUrl}") format("woff2")}`,
  `@font-face{font-family:'Orbitron Local';font-weight:400 500;font-display:swap;src:url("${orbitronUrl}") format("woff2")}`,
];

export const HUD_THEME_STYLE_ID = 'cknerv-hud-theme';

export function injectHudTheme(doc: Document = document): void {
  if (doc.getElementById(HUD_THEME_STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = HUD_THEME_STYLE_ID;
  const vars = Object.entries(HUD_COLORS).map(([k, v]) => `--hud-${k}:${v};`).join('');
  style.textContent =
    FONT_FACES.join('') + `\n:root{${vars}}` +
    // THE FOUR KEYFRAMES, and the ONE breathe. The application ran two —
    // this one and a `cknerv-jukebox-breathe` (.72 → 1 over 3.4 s) injected by
    // SND·06's own stylesheet, one idea drawn twice at two depths four hundred
    // milliseconds apart (report E, E-1). The chip wears this one now, and
    // every duration these are played at is a rung of `HUD_MOTION` at the
    // element that plays them: a keyframe says WHAT moves, the rung says how
    // long, and neither is spelled twice.
    `\n@keyframes cknerv-hud-flash{50%{opacity:.45}}`
    + `\n@keyframes cknerv-hud-breathe{0%,100%{opacity:.82}50%{opacity:1}}`
    + `\n@keyframes cknerv-cell-specimen-sweep{0%{transform:translate3d(0,0,0);opacity:0}12%{opacity:.82}88%{opacity:.72}100%{transform:translate3d(0,100%,0);opacity:0}}`
    + `\n@keyframes cknerv-route-hop-lock-pulse{0%{filter:brightness(1) drop-shadow(0 0 0 transparent)}18%{filter:brightness(1.58) drop-shadow(0 0 7px var(--route-hop-pulse-color,${rgba(HUD_COLORS.goldInk, 0.76)}))}52%{filter:brightness(1.16) drop-shadow(0 0 3px var(--route-hop-pulse-color,${rgba(HUD_COLORS.goldInk, 0.42)}))}100%{filter:brightness(1) drop-shadow(0 0 0 transparent)}}`
    + `\n.cknerv-hud-control-button:hover{filter:brightness(1.35)}`
    // ——— WHAT A HAND CAN REACH, WHICH IS NOT WHAT THE INSTRUMENT DRAWS ———
    //
    // Measured on an 11" iPad in landscape: every one of the eleven controls
    // in the top bar was under Apple's 44 pt minimum, and the worst axis was
    // always the same one. The quality options are 23 x 18 px — 4.5 x 3.5 mm
    // against a fingertip's 8-10 — and the AUTO/MAN button and the stage-cells
    // track are 18 tall too. The bar itself is 36.
    //
    // The density of this row is a design commitment and the row has 77 px of
    // headroom before it folds (`useStatusStripFold`), so the CONTROLS do not
    // grow: their REACH does, through a pseudo-element that paints nothing.
    //
    // ⭐ HEIGHT ONLY, and that is the load-bearing half. Growing the width
    // would overlap the neighbours — H, M and L stand 23 px apart — and the
    // reader would press one letter and get another, which is worse than a
    // small target. Vertically there is nothing beside these controls but the
    // bar's own ground, so the reach costs nothing and takes nothing.
    //
    // ⚠️ In the folded and phone layouts the controls row carries
    // `overflow-y: hidden` (it scrolls horizontally), so there the reach is
    // clipped to that row's 32 px band. Still nearly double what it was, and
    // the alternative is a row that scrolls in both directions.
    + `\n@media (pointer: coarse){`
    + `.cknerv-touch-target{position:relative}`
    + `.cknerv-touch-target::after{content:'';position:absolute;left:0;right:0;top:50%;height:${TOUCH_TARGET_MIN_PX}px;transform:translateY(-50%)}`
    + `}`
    + `\n.cknerv-hud-link{color:${HUD_COLORS.dim};text-decoration:underline;text-decoration-color:${rgba(HUD_COLORS.cyanWire, 0.25)};text-underline-offset:3px}`
    + `\n.cknerv-hud-link:hover,.cknerv-hud-link:focus-visible{color:${HUD_COLORS.cyanInk};text-decoration-color:currentColor}`
    + `\n.cknerv-hud-link:focus-visible{outline:1px solid ${rgba(HUD_COLORS.cyanWire, 0.55)};outline-offset:2px}`
    // THE FOCUS RING IS THE HUD'S, ON EVERY BUTTON.
    //
    // The class rule below it covered the four strip controls and the Jukebox;
    // the other dozen `<button>`s in the overlay — the two fact dialects,
    // `CellContentMemory`'s five, the byte reader's, the causal lens's — fell
    // back to the browser's default ring, which on Chromium is a white-and-blue
    // double outline drawn on top of a design that owns neither colour (report
    // E, E-13). A keyboard user's position on screen is a HUD state like any
    // other, so it is drawn in the HUD's own ink.
    //
    // Element selector, not a class, because the point is that no button has
    // to opt in. The class rule stays for the SAME ring at higher specificity
    // on the controls that also brighten — one declaration, one appearance.
    + `\nbutton:focus-visible,.cknerv-hud-control-button:focus-visible{outline:1px solid ${rgba(HUD_COLORS.cyanWire, 0.55)};outline-offset:1px}`
    // A selected hex string is a reading being COPIED, which is the one thing
    // the reader can do with the card that leaves the page. The browser's
    // default highlight is the OS accent — the last unbranded surface in the
    // instrument, on the surface that carries its longest strings.
    + `\n::selection{background:${rgba(HUD_COLORS.cyanWire, 0.32)}}`
    + `\n.cknerv-cell-display-track:focus-within{filter:brightness(1.35)}`
    + `\n.cknerv-cell-display-track:focus-within::after{content:'';position:absolute;left:0;right:0;bottom:0;height:1px;background:${rgba(HUD_COLORS.cyanWire, 0.42)};box-shadow:0 0 5px ${rgba(HUD_COLORS.cyanWire, 0.3)}}`
    + `\n.cknerv-mesh-rail::-webkit-scrollbar{width:5px}`
    + `\n.cknerv-mesh-rail::-webkit-scrollbar-thumb{background:${rgba(HUD_COLORS.orange, 0.35)};border-radius:3px}`
    + `\n.cknerv-mesh-rail::-webkit-scrollbar-track{background:transparent}`
    // ——— the constellation's one scroller ————————————————————————————
    // Only the register can outgrow the band it stands in, and only on a short
    // stage. Until it does, it may not grow a rail at all: a scrollbar on a
    // panel showing all of itself is a claim there is more. The cap is written
    // into the host by the frame writer, so the rules key on it and nothing
    // re-renders to switch them.
    + `\n.cknerv-constellation-scroller{overflow:hidden}`
    + `\n[data-cell-panel-capped="true"] .cknerv-constellation-scroller{overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:${rgba(CELL_CARD_ACCENT, 0.35)} transparent}`
    + `\n[data-cell-panel-capped="true"] .cknerv-constellation-scroller::-webkit-scrollbar{width:5px}`
    + `\n[data-cell-panel-capped="true"] .cknerv-constellation-scroller::-webkit-scrollbar-thumb{background:${rgba(CELL_CARD_ACCENT, 0.35)};border-radius:3px}`
    + `\n[data-cell-panel-capped="true"] .cknerv-constellation-scroller::-webkit-scrollbar-track{background:transparent}`
    // …and the fade over the cut, which exists only where there is a cut.
    + `\n[data-cell-panel-fade]{opacity:0}`
    + `\n[data-cell-panel-capped="true"] [data-cell-panel-fade]{opacity:1}`
    + `\n.cknerv-chain-cluster::-webkit-scrollbar{height:5px}`
    + `\n.cknerv-chain-cluster::-webkit-scrollbar-thumb{background:${rgba(HUD_COLORS.orange, 0.35)};border-radius:3px}`
    + `\n.cknerv-chain-cluster::-webkit-scrollbar-track{background:transparent}`
    + `\n.cknerv-chain-panel-scroll::-webkit-scrollbar{width:5px}`
    + `\n.cknerv-chain-panel-scroll::-webkit-scrollbar-thumb{background:${rgba(HUD_COLORS.orange, 0.35)};border-radius:3px}`
    + `\n.cknerv-chain-panel-scroll::-webkit-scrollbar-track{background:transparent}`
    + `\n.cknerv-status-controls::-webkit-scrollbar{display:none}`
    + `\n.cknerv-status-context::-webkit-scrollbar{display:none}`
    // CKBYTES hides its native scrollbar because the 8 px byte map beside the
    // dump IS the scrollbar (the user's R2-4 ruling): the map is a scale
    // drawing of the payload with the viewport as its thumb, and a real bar
    // next to it would be a second, redundant one. Two dialects, because
    // `scrollbar-width` is the standard property and `::-webkit-scrollbar` is
    // the pseudo-element Chromium still answers — and neither can be reached
    // from an inline style, which is why this is a class at all.
    + `\n.cknerv-cell-bytes-dump{scrollbar-width:none}`
    + `\n.cknerv-cell-bytes-dump::-webkit-scrollbar{display:none}`
    // The portrait's drei `Html` labels are moved every frame the braid turns
    // by a `transform` on the wrapper drei owns — and it rewrites that
    // wrapper's whole inline style per move, which is why the hint is a class
    // rule and not an inline property: a layer of its own makes the move
    // compositor-only instead of a repaint of the square beneath.
    + `\n.cknerv-portrait-label{will-change:transform}`
    + `\n.cknerv-memory-route-ledger{position:absolute;right:calc(100% + 30px);top:-1px;width:272px}`
    + `\n.cknerv-memory-route-ledger-lens{width:312px}`
    + `\n.cknerv-memory-route-ledger-viewport{position:relative;display:flex;flex:1 1 auto;min-height:0}`
    + `\n.cknerv-memory-route-ledger-scroll{position:relative;flex:1 1 auto;min-width:0;min-height:0;box-sizing:border-box}`
    + `\n.cknerv-memory-route-scroll-edge{position:absolute;left:0;right:9px;z-index:2;height:14px;pointer-events:none;opacity:0}`
    + `\n.cknerv-memory-route-scroll-edge-before{top:0;background:linear-gradient(180deg,${rgba(HUD_COLORS.stageGround, 0.98)},${rgba(HUD_COLORS.stageGround, 0)});box-shadow:inset 0 1px 0 ${rgba(HUD_COLORS.cyanWire, 0.14)}}`
    + `\n.cknerv-memory-route-scroll-edge-after{bottom:0;background:linear-gradient(0deg,${rgba(HUD_COLORS.stageGround, 0.98)},${rgba(HUD_COLORS.stageGround, 0)});box-shadow:inset 0 -1px 0 ${rgba(HUD_COLORS.cyanWire, 0.14)}}`
    + `\n.cknerv-memory-route-scroll-position{position:absolute;top:3px;right:4px;bottom:3px;z-index:3;width:4px;border-right:1px solid ${rgba(HUD_COLORS.cyanWire, 0.18)};pointer-events:none;opacity:0}`
    + `\n.cknerv-memory-route-scroll-position-marker{position:absolute;left:100%;top:var(--route-ledger-scroll-progress,0%);width:4px;height:4px;border:1px solid ${rgba(HUD_COLORS.cyanInk, 0.88)};background:${HUD_COLORS.ground};box-shadow:0 0 6px ${rgba(HUD_COLORS.cyanWire, 0.72)};transform:translate(-50%,-50%) ${DIAMOND_ROTATION}}`
    + `\n.cknerv-memory-route-ledger-lens .cknerv-memory-route-scroll-position-marker{border-color:${rgba(HUD_COLORS.goldInk, 0.9)};box-shadow:0 0 7px ${rgba(HUD_COLORS.goldInk, 0.66)}}`
    + `\n.cknerv-memory-route-ledger-scroll::-webkit-scrollbar{width:3px}`
    + `\n.cknerv-memory-route-ledger-scroll::-webkit-scrollbar-thumb{background:${rgba(HUD_COLORS.cyanWire, 0.28)}}`
    + `\n.cknerv-memory-route-ledger-scroll::-webkit-scrollbar-track{background:transparent}`
    + `\n.cknerv-memory-route-cells::-webkit-scrollbar{width:3px}`
    + `\n.cknerv-memory-route-cells::-webkit-scrollbar-thumb{background:${rgba(HUD_COLORS.cyanWire, 0.28)}}`
    + `\n.cknerv-memory-route-cells::-webkit-scrollbar-track{background:transparent}`
    + `\n.cknerv-memory-route-connector-tail{display:none}`
    + `\n@media (min-width:1101px) and (max-width:1373px),(min-width:1374px) and (max-height:860px){.cknerv-memory-route-ledger{top:-106px}.cknerv-memory-route-connector-tail{display:block;height:106px}}`
    + `\n@media (max-width:1100px){.cknerv-top-bar-action-label{display:none}}`
    // A HUD panel a transparent card window is standing on. The CELL SCAN
    // square is a hole — the braid is painted in the SCENE, under the whole DOM
    // HUD, so a rail panel between the canvas and the card prints straight
    // through the specimen (`#20,356,026`, `57.96 G·CKB` and `152.9 MB` were
    // legible across a braid at 1000×720). The placement solver keeps the
    // square off the panels wherever there is room; where there is not, the
    // panel gives way instead of printing on the specimen.
    //
    // It is a class rule and not an inline style because the attribute is
    // written from OUTSIDE React — the card's own frame decides it, and a
    // React render of the HUD would take an inline opacity straight back off.
    + `\n[data-hud-occlusion="true"]{transition:opacity ${HUD_MOTION.reveal}ms ${HUD_MOTION.fadeEase}}`
    + `\n[data-hud-occlusion="true"][data-hud-dim="true"]{opacity:.25}`
    + `\n@media (prefers-reduced-motion:reduce){[data-hud-occlusion="true"]{transition:none}}`
    + `\n@media (max-width:560px){.cknerv-build-label{display:none}}`
    + `\n@media (max-width:380px){.cknerv-cell-display-label,.cknerv-quality-label,.cknerv-panel-toggle-label{display:none}}`
    + `\n@media (max-width:1100px){.cknerv-memory-route-ledger{position:static;width:auto;max-height:100px;margin:4px 4px 2px 0;overflow:hidden}.cknerv-memory-route-ledger-scroll{overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:${rgba(HUD_COLORS.cyanWire, 0.28)} transparent;padding-right:8px}.cknerv-memory-route-ledger-viewport[data-memory-evidence-route-scrollable="true"] .cknerv-memory-route-scroll-position{opacity:1}.cknerv-memory-route-ledger-viewport[data-memory-evidence-route-scroll-before="true"] .cknerv-memory-route-scroll-edge-before{opacity:1}.cknerv-memory-route-ledger-viewport[data-memory-evidence-route-scroll-after="true"] .cknerv-memory-route-scroll-edge-after{opacity:1}.cknerv-memory-route-connector,.cknerv-memory-route-connector-tail{display:none}}`;
  doc.head.appendChild(style);
}
