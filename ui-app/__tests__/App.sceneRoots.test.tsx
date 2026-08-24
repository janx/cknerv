// The three scene roots are memoized (packages/ui pins the wrappers). A memo
// bails out only when EVERY prop compares equal, so one fresh object handed
// down from App defeats the whole thing silently — nothing throws, nothing
// warns, the roots just keep re-running. These tests guard the App half of that
// contract: the runtime config is resolved once, the two overlay fragments are
// hoisted into memos, and each memo's dep list still mirrors every binding its
// body reads.
//
// The dep-list check is the one that earns its keep. This repo runs no eslint
// gate, so `react-hooks/exhaustive-deps` catches nothing in CI; a prop added to
// the overlay without its source added to the deps would be a stale closure —
// a real bug, and a worse one than the re-render the memo was avoiding.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { HUD_COLORS } from '@cknerv/ui';

const APP_SOURCE = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');
const INDEX_HTML = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');

interface HoistedOverlay {
  body: string;
  deps: string[];
}

/** Split `const <name> = useMemo(() => (<jsx>), [<deps>]);` into its halves. */
function hoistedOverlay(name: string): HoistedOverlay {
  const opening = `const ${name} = useMemo(() => (\n`;
  const start = APP_SOURCE.indexOf(opening);
  expect(start, `${name} is not a hoisted useMemo`).toBeGreaterThan(-1);
  const closing = APP_SOURCE.indexOf('\n  ), [\n', start);
  expect(closing, `${name} has no dep list`).toBeGreaterThan(start);
  const depsEnd = APP_SOURCE.indexOf('\n  ]);', closing);
  expect(depsEnd, `${name}'s dep list is unterminated`).toBeGreaterThan(closing);

  return {
    body: APP_SOURCE.slice(start + opening.length, closing),
    deps: APP_SOURCE.slice(closing + '\n  ), [\n'.length, depsEnd)
      .split('\n')
      .map((line) => line.trim().replace(/,$/, ''))
      .filter((line) => line.length > 0 && !line.startsWith('//')),
  };
}

/**
 * Every component-scope binding the JSX reads: `prop={value}` / `key={value}`
 * on the left, and the roots of the `x ? …` / `x && y ? …` guards on the right.
 * UPPER_SNAKE names are module constants, which are not deps and cannot go
 * stale.
 */
function bindingsRead(body: string): string[] {
  const found = new Set<string>();
  const add = (raw: string) => {
    if (/^[A-Z0-9_]+$/.test(raw.split('.')[0])) return;
    found.add(raw);
  };
  for (const [, path] of body.matchAll(/=\{([A-Za-z_$][\w$]*(?:\.[\w$]+)*)\}/g)) {
    add(path);
  }
  for (const [, path] of body.matchAll(/\{([a-z_$][\w$]*(?:\.[\w$]+)*)\s*(?:\?|&&)/g)) {
    add(path);
  }
  for (const [, path] of body.matchAll(/&&\s*([A-Za-z_$][\w$]*(?:\.[\w$]+)*)\s*\?/g)) {
    add(path);
  }
  return [...found];
}

function coveredByDeps(path: string, deps: string[]): boolean {
  // A dep may name the whole path (`galaxyConfig.cellCap`) or its root
  // (`selectedCell` covering `selectedCell.id`); either pins the identity the
  // body closed over.
  return deps.includes(path) || deps.includes(path.split('.')[0]);
}

describe('scene-root memo inputs', () => {
  it('resolves the injected runtime config once, not per render', () => {
    // `window.__CKNERV_RUNTIME_CONFIG__` is written into the served HTML before
    // the bundle boots and never assigned again, so one resolve covers the
    // page. Per render it rebuilt fresh `topology` / `pulses` objects — handed
    // straight to NeuralNetwork as props, defeating its memo every time.
    expect(APP_SOURCE).toContain(
      'const galaxyConfig = useMemo(() => resolveGalaxyConfig(), []);',
    );
    expect(APP_SOURCE).not.toContain('const galaxyConfig = resolveGalaxyConfig()');
    expect(APP_SOURCE).toContain('topology={galaxyConfig.topology}');
    expect(APP_SOURCE).toContain('pulses={galaxyConfig.pulses}');
  });

  it('hands each memoized root a hoisted overlay, never a fresh fragment', () => {
    expect(APP_SOURCE).toContain('overlay={galaxyOverlay}');
    expect(APP_SOURCE).toContain('overlay={colonyOverlay}');
    // A fragment built in the prop position is a new element every render.
    expect(APP_SOURCE).not.toMatch(/overlay=\{\(?\s*\n\s*<>/);
  });

  it.each(['galaxyOverlay', 'colonyOverlay'])(
    '%s lists every binding its body closes over',
    (name) => {
      const { body, deps } = hoistedOverlay(name);
      const read = bindingsRead(body);

      expect(read.length).toBeGreaterThan(0);
      expect(
        read.filter((path) => !coveredByDeps(path, deps)),
        `${name} reads these without listing them as deps`,
      ).toEqual([]);
    },
  );

  it.each(['galaxyOverlay', 'colonyOverlay'])(
    '%s lists no dep its body stopped reading',
    (name) => {
      const { body, deps } = hoistedOverlay(name);

      expect(
        deps.filter((dep) => !new RegExp(`\\b${dep.split('.')[0]}\\b`).test(body)),
        `${name} lists these but no longer reads them`,
      ).toEqual([]);
    },
  );

  it('keeps the nerve inside the galaxy overlay, where the canopy turns', () => {
    const { body } = hoistedOverlay('galaxyOverlay');

    // The overlay slot is the galaxy's rotating, CELLS_Y-lifted group; the
    // nerve and the write seal are drawn in Cell space and must stay in it.
    expect(body).toContain('<NeuralNetwork');
    expect(body).toContain('<ConsensusWriteSeal');
    expect(body).toContain('<CellInspectionAnchor');
  });
});

describe('canvas ground', () => {
  it('paints its own ground rather than showing one through', () => {
    // ⚠️ This flag does not reach the compositor: three hardcodes `alpha: true`
    // in the context attributes it creates, so the surface always carries an
    // alpha channel and the flag only picks the default clear alpha. It is
    // pinned as the honest value for a scene that paints its own ground — the
    // one the clear falls back to if the background below ever goes away.
    expect(APP_SOURCE).toContain('gl={{ antialias: true, alpha: false }}');
    // The clear IS the ground: the CSS below the canvas carries it until the
    // first frame exists, the scene carries it afterwards, and both now say the
    // one token, so the pre-first-light black cannot shift by half an edit.
    expect(APP_SOURCE).toContain('<color attach="background" args={[HUD_COLORS.stageGround]} />');
    expect(APP_SOURCE).toContain('style={{ background: HUD_COLORS.stageGround }}');
    // Both, or neither: this pair spent its whole life as two literals that
    // happened to agree, which is a guarantee nobody was keeping.
    expect(APP_SOURCE.toLowerCase()).not.toContain(HUD_COLORS.stageGround.toLowerCase());
  });

  it('holds the shell stylesheet to the token it cannot import', () => {
    // `index.html` paints before a module has evaluated, so its copy of the
    // ground is a literal by necessity — the same bargain the boot shell one
    // element down makes with cyanWire / dim / danger. A literal by necessity
    // still needs a keeper: this is the surface a visitor stares at for the
    // whole snapshot download, and nothing else compares it to anything.
    const background = /body\s*\{[^}]*background:\s*(#[0-9a-fA-F]{3,8})/.exec(INDEX_HTML);
    expect(background?.[1]?.toLowerCase()).toBe(HUD_COLORS.stageGround.toLowerCase());
  });
});

describe('colony topology signature', () => {
  it('admits identity, direction and version raw — and a ping only by its step', () => {
    // The signature is what stands between a ~4s peer poll and a full colony
    // rebuild, so every field it reads is a field the colony draws. Raw
    // `latency_ms` reads as one of those and is not: the annulus resolves a
    // ping onto 16 steps, while the adapter deliberately admits a
    // telemetry-only refresh whose own structural key excludes latency — so at
    // raw resolution the whole colony rebuilds on jitter, mid-flood.
    const sig = APP_SOURCE.slice(
      APP_SOURCE.indexOf('const peersSig = useMemo('),
      APP_SOURCE.indexOf('const networkRoster ='),
    );
    expect(sig).toContain('${p.node_id}|${latencyPlacementStep(p.latency_ms)}|${p.direction}|${p.version ?? \'\'}');
    expect(sig).not.toContain('p.latency_ms ??');
    expect(sig).not.toContain('best_known');
  });
});
