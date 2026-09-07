// The package boundary, as an oracle over the package's own source.
//
// `ui-app/src/pulse-stats-hook.ts` has always stated the contract in one
// sentence — "the library itself stays window-free" — and for most of that
// sentence's life it was false. Every dev counter but two was an export the
// app's hook module installed; the two were written from inside the library
// onto `window` directly, one of them from a component effect that also had to
// delete it again. That is a second, undeclared consumer: the package ships a
// devtools surface nothing in it declares, nothing in it can type, and no
// consumer can choose not to have. It also makes the package untestable on its
// own terms — a counter that only exists once a global has been written cannot
// be read by anything that did not agree to be a browser.
//
// So the rule is a rule rather than a habit, and it is stated as a text sweep
// for the same reason `hudDiscipline` states the palette as one: a boundary
// that is only kept by everyone remembering it is kept until the first edit
// where somebody needs a value in a hurry.
//
// THE RULE: no `__`-prefixed name in this package's code. Every such name in
// this repository is a devtools surface on `window`, and this package does not
// own that surface — its counters are module singletons (`pulseStats`,
// `fabricStats`, `blockFrameStats`, `cellPickStats`, `qualitySampleLog`) or
// registries (`populationFieldStats`), exported, and installed on `window` by
// the app. Comments are stripped before the sweep, because prose here names
// `__tests__` paths and `__fabricStats()` readings constantly and should go on
// being able to.
//
// What the rule does NOT touch, stated so the next reader does not go looking:
// the two worker entry points reach `globalThis` — `neighborGraph.worker.ts`
// and `populationField.worker.ts` each take it once through a typed alias,
// because in a worker the global scope IS the module's own message port. They
// write `onmessage`, not a `__` surface, and that is the honest use of a
// global rather than an exception to this rule.
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC_DIR = resolve(process.cwd(), 'src');
const HOOK_MODULE = resolve(process.cwd(), '../../ui-app/src/pulse-stats-hook.ts');

interface Source { name: string; text: string }

function readSources(root: string): Source[] {
  const sources: Source[] = [];
  const walk = (directory: string, prefix: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(path, name);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name)) continue;
      sources.push({ name, text: readFileSync(path, 'utf8') });
    }
  };
  walk(root, '');
  return sources;
}

/** A source with its comments taken out. The question is what RUNS. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

const SOURCES = readSources(SRC_DIR);

/** Any `__`-prefixed identifier, however the global it hangs off was reached —
 *  `window.__x`, `global.__x`, `globalThis.__x`, or the cast-then-property
 *  spelling `(window as unknown as Record<string, unknown>).__x` that both
 *  offenders actually used. Matching the NAME rather than the receiver is what
 *  makes the rule un-evadable by another cast. */
const DUNDER = /__[A-Za-z_$][\w$]*/g;

describe('@cknerv/ui stays window-free', () => {
  it('writes no `__` devtools surface anywhere in the package', () => {
    expect(SOURCES.length).toBeGreaterThan(100);
    const offenders = SOURCES.flatMap(({ name, text }) => {
      const found = code(text).match(DUNDER) ?? [];
      return found.map((hit) => `${name}: ${hit}`);
    });
    expect(
      offenders,
      'a `__` name in this package is a devtools surface the app is supposed to '
      + 'own: export the counter and install it from `pulse-stats-hook.ts`',
    ).toEqual([]);
  });

  it('reaches a global only where the global is the module\'s own scope', () => {
    const reaching = SOURCES.filter(
      ({ text }) => /\b(?:window|globalThis)\b/.test(code(text)),
    ).map(({ name }) => name).sort();
    // A `typeof window === 'undefined'` guard is a legitimate reach and there
    // are several; what this pins is that no NEW file starts reaching for one
    // without the pin being read. The two workers are named because their
    // reach is a write.
    expect(reaching).toContain('geometry/neighborGraph.worker.ts');
    expect(reaching).toContain('geometry/populationField.worker.ts');
    expect(
      reaching.filter((name) => name.endsWith('.worker.ts')),
      'a third worker means a third file writing its own global scope — fine, '
      + 'but say so here',
    ).toEqual([
      'geometry/neighborGraph.worker.ts',
      'geometry/populationField.worker.ts',
    ]);
  });

  it('has an app-side installer for the two counters that used to write window', () => {
    const hook = readFileSync(HOOK_MODULE, 'utf8');
    // The other half of the move: a counter taken off `window` inside the
    // library and never put back is not a boundary kept, it is an instrument
    // lost — and both of these answer questions (which windows the tier was
    // decided from; what the halo's three draws submit) that cannot be asked
    // of a scene any other way.
    expect(hook).toContain('window.__cknervQualitySamples = snapshotQualitySamples');
    expect(hook).toContain('window.__populationFieldStats = snapshotPopulationFieldStats');
  });
});
