import { describe, it, expect, beforeEach } from 'vitest';
import { HUD_COLORS, HUD_FONTS, HUD_MOTION, injectHudTheme, HUD_THEME_STYLE_ID, rgba } from '../../../src/components/hud/hudTheme';

describe('hudTheme', () => {
  beforeEach(() => { document.getElementById(HUD_THEME_STYLE_ID)?.remove(); });

  it('exposes the locked palette + fonts', () => {
    expect(HUD_COLORS.orange).toBe('#FF9830');
    expect(HUD_COLORS.peerWire).toBe('#1AD1FF');
    expect(HUD_COLORS.nominal).toBe('#27FF5A');
    expect(HUD_COLORS.danger).toBe('#FF3030');
    expect(HUD_FONTS.cjk).toMatch(/^'Huiwen-mincho'/);
    expect(HUD_FONTS.cjk).toContain('Noto Serif CJK SC');
  });

  it('rgba() expands a palette hex to an rgba() string (byte-identical to the old literals)', () => {
    expect(rgba(HUD_COLORS.nominal, 0.06)).toBe('rgba(39,255,90,0.06)');
    expect(rgba(HUD_COLORS.nominal, 0.22)).toBe('rgba(39,255,90,0.22)');
    expect(rgba(HUD_COLORS.danger, 0)).toBe('rgba(255,48,48,0)');
  });

  it('gives a panel under a transparent card window a class rule to dim by', () => {
    // The mark is written from OUTSIDE React — the card's frame decides which
    // panel is standing under its CELL SCAN hole — so the opacity cannot be an
    // inline style: the next HUD render would take it straight back off.
    injectHudTheme(document);
    const css = document.getElementById(HUD_THEME_STYLE_ID)?.textContent ?? '';

    expect(css).toContain('[data-hud-occlusion="true"][data-hud-dim="true"]{opacity:.25}');
    expect(css).toContain(`[data-hud-occlusion="true"]{transition:opacity ${HUD_MOTION.reveal}ms ${HUD_MOTION.fadeEase}}`);
    // …and the ease is motion, so it answers to the OS setting like the rest.
    expect(css).toContain('@media (prefers-reduced-motion:reduce){[data-hud-occlusion="true"]{transition:none}}');
  });

  it('injects a single idempotent <style> with font imports + css vars', () => {
    injectHudTheme(document);
    injectHudTheme(document);
    const els = document.querySelectorAll(`#${HUD_THEME_STYLE_ID}`);
    expect(els.length).toBe(1);
    const css = els[0].textContent ?? '';
    expect(css).toContain('@font-face');
    expect(css).toContain("font-family:'Huiwen-mincho'");
    expect(css).not.toContain("font-family:'Cknerv-dao-serif'");
    // The in-scene labels name these two families in inline fontFamily stacks
    // (CellGalaxy, ConsensusMemoryMarkers, ConsensusRouteHopMarker,
    // hud/ConsensusMemory). Unregistered they fall silently through to
    // ui-monospace on any machine without the face installed locally.
    expect(css).toContain("font-family:'JetBrains Mono Local';font-weight:400");
    expect(css).toContain("font-family:'Orbitron Local';font-weight:400 500");
    expect(css).toContain('--hud-orange:#FF9830');
    // The two card ENTER keyframes are gone (C8): one fade on the chassis
    // replaced a body slide, a frame fade and a dot pop, so neither the card
    // nor its tether declares a keyframe any more.
    expect(css).not.toContain('cknerv-cell-detail-anchor-enter');
    expect(css).not.toContain('cknerv-cell-consensus-enter');
    expect(css).toContain('@keyframes cknerv-cell-specimen-sweep');
    expect(css).toContain('transform:translate3d(0,100%,0)');
    expect(css).not.toContain('100%{top:91%');
    expect(css).toContain('@keyframes cknerv-route-hop-lock-pulse');
    expect(css).toContain('var(--route-hop-pulse-color');
    expect(css).toContain('.cknerv-hud-control-button:focus-visible');
    expect(css).toContain('.cknerv-cell-display-track:focus-within');
    expect(css).not.toContain('.cknerv-cell-inspection-scroll');
    expect(css).toContain(
      '@media (max-width:1100px){.cknerv-top-bar-action-label{display:none}',
    );
    expect(css).toContain(
      '@media (max-width:380px){.cknerv-cell-display-label,.cknerv-quality-label,.cknerv-panel-toggle-label{display:none}',
    );
    expect(css).toContain('.cknerv-memory-route-ledger');
    expect(css).toContain('max-height:100px');
    expect(css).toContain(
      '.cknerv-memory-route-ledger-scroll{overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain',
    );
    expect(css).toContain('.cknerv-memory-route-scroll-edge-before');
    expect(css).toContain(
      '.cknerv-memory-route-ledger-viewport{position:relative;display:flex;flex:1 1 auto;min-height:0}',
    );
    expect(css).toContain(
      '.cknerv-memory-route-ledger-scroll{position:relative;flex:1 1 auto',
    );
    expect(css).toContain('top:var(--route-ledger-scroll-progress,0%)');
    expect(css).toContain(
      '[data-memory-evidence-route-scrollable="true"] .cknerv-memory-route-scroll-position{opacity:1}',
    );
    expect(css).toContain(
      '[data-memory-evidence-route-scroll-after="true"] .cknerv-memory-route-scroll-edge-after{opacity:1}',
    );
    expect(css).toContain('@media (min-width:1101px) and (max-width:1373px)');
    expect(css).toContain('(min-width:1374px) and (max-height:860px)');
    expect(css).toContain('@media (max-width:1100px)');
    expect(css).not.toContain('@import');
    expect(css).not.toContain('fontsapi.zeoseven.com');
  });
});
