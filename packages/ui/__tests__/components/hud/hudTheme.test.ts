import { describe, it, expect, beforeEach } from 'vitest';
import { HUD_COLORS, HUD_FONTS, injectHudTheme, HUD_THEME_STYLE_ID } from '../../../src/components/hud/hudTheme';

describe('hudTheme', () => {
  beforeEach(() => { document.getElementById(HUD_THEME_STYLE_ID)?.remove(); });

  it('exposes the locked palette + fonts', () => {
    expect(HUD_COLORS.orange).toBe('#FF9830');
    expect(HUD_COLORS.nominal).toBe('#27FF5A');
    expect(HUD_COLORS.danger).toBe('#FF3030');
    expect(HUD_FONTS.cjk).toContain('Huiwen-mincho');
  });

  it('injects a single idempotent <style> with font imports + css vars', () => {
    injectHudTheme(document);
    injectHudTheme(document);
    const els = document.querySelectorAll(`#${HUD_THEME_STYLE_ID}`);
    expect(els.length).toBe(1);
    const css = els[0].textContent ?? '';
    expect(css).toContain('@import');
    expect(css).toContain('fontsapi.zeoseven.com/256');
    expect(css).toContain('--hud-orange:#FF9830');
  });
});
