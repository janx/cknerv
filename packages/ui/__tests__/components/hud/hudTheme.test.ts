import { describe, it, expect, beforeEach } from 'vitest';
import { HUD_COLORS, HUD_FONTS, injectHudTheme, HUD_THEME_STYLE_ID, rgba } from '../../../src/components/hud/hudTheme';

describe('hudTheme', () => {
  beforeEach(() => { document.getElementById(HUD_THEME_STYLE_ID)?.remove(); });

  it('exposes the locked palette + fonts', () => {
    expect(HUD_COLORS.orange).toBe('#FF9830');
    expect(HUD_COLORS.nominal).toBe('#27FF5A');
    expect(HUD_COLORS.danger).toBe('#FF3030');
    expect(HUD_FONTS.cjk).toContain('Huiwen-mincho');
  });

  it('rgba() expands a palette hex to an rgba() string (byte-identical to the old literals)', () => {
    expect(rgba(HUD_COLORS.nominal, 0.06)).toBe('rgba(39,255,90,0.06)');
    expect(rgba(HUD_COLORS.nominal, 0.22)).toBe('rgba(39,255,90,0.22)');
    expect(rgba(HUD_COLORS.danger, 0)).toBe('rgba(255,48,48,0)');
  });

  it('injects a single idempotent <style> with font imports + css vars', () => {
    injectHudTheme(document);
    injectHudTheme(document);
    const els = document.querySelectorAll(`#${HUD_THEME_STYLE_ID}`);
    expect(els.length).toBe(1);
    const css = els[0].textContent ?? '';
    expect(css).toContain('@font-face');
    expect(css).toContain("font-family:'Huiwen-mincho'");
    expect(css).toContain('--hud-orange:#FF9830');
    expect(css).toContain('.cknerv-memory-route-ledger');
    expect(css).toContain('@media (min-width:1101px) and (max-width:1373px)');
    expect(css).toContain('@media (max-width:1100px)');
    expect(css).not.toContain('@import');
    expect(css).not.toContain('fontsapi.zeoseven.com');
  });
});
