// The portrait's drei `Html` labels move every frame the braid turns. drei
// writes the wrapper's whole inline style on each move, so the compositor
// hint has to be a class rule the theme injects; and the evidence labels'
// opacity is written only when the printed thousandth changes. Both are
// mechanical and invisible, which is why they are pinned here.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HUD_THEME_STYLE_ID, injectHudTheme } from '../../../src/components/hud/hudTheme';

function source(file: string): string {
  return readFileSync(resolve(process.cwd(), `src/components/hud/${file}`), 'utf8');
}

afterEach(() => {
  document.getElementById(HUD_THEME_STYLE_ID)?.remove();
});

describe('portrait Html labels', () => {
  it('ask drei for a wrapper class the theme composites', () => {
    // ONE file draws Html in the portrait now. `CellSemanticMorphologyOverlay`
    // hung `LOCK · JoyID` and `TYPE · xUDT` off the braid at 6 px, inside a
    // 280 px box that clipped them, saying what the LOCK and ASSET facts print
    // twenty pixels to the left. Round 3 removed them — so the rule is that a
    // file which draws `Html` here asks for the hint, and a file which draws
    // none may not carry a stale mention of it either.
    for (const file of ['ConsensusMemory.tsx']) {
      expect(source(file), `${file} positions its labels without the hint`)
        .toContain('wrapperClass="cknerv-portrait-label"');
    }
    const overlay = source('CellSemanticMorphologyOverlay.tsx');
    expect(overlay).not.toContain('<Html');
    expect(overlay).not.toContain('cknerv-portrait-label');
    injectHudTheme(document);
    const css = document.getElementById(HUD_THEME_STYLE_ID)?.textContent ?? '';
    expect(css).toContain('.cknerv-portrait-label{will-change:transform}');
  });

  it('write an evidence label\'s opacity only when its thousandth moved', () => {
    const memory = source('ConsensusMemory.tsx');
    expect(memory).toContain('const quantized = Math.round(opacity * 1000);');
    expect(memory).toContain('if (evidenceLabelOpacityRef.current[index] === quantized) return;');
    // One write site, behind the guard — and a remounted node owes a first
    // write, so the ref callback forgets what was written to its predecessor.
    expect(memory.match(/label\.style\.opacity = /g)).toHaveLength(1);
    expect(memory).toContain('evidenceLabelOpacityRef.current[index] = -1;');
  });
});
