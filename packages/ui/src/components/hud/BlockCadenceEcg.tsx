import { useEffect, useRef } from 'react';
import type { EcgCondition } from '../../derives/ecgCondition';
import { HUD_COLORS, HUD_FONTS } from './hudTheme';

const COND_COLOR: Record<EcgCondition, string> = {
  FINE: HUD_COLORS.nominal, CAUTION: HUD_COLORS.caution, DANGER: HUD_COLORS.danger,
  FLATLINE: HUD_COLORS.danger, SYNCING: HUD_COLORS.cyanWire,
};

// PQRST complex repeating every 32 columns (RE2-style vertical-segment trace).
function sig(c: number): number {
  const p = c % 32;
  if (p === 5) return 0.16; if (p === 10) return -0.18; if (p === 11) return 1.0;
  if (p === 12) return -0.5; if (p === 18) return 0.30; return 0;
}

export default function BlockCadenceEcg({ tip, condition, reducedMotion = false }: { tip: number; condition: EcgCondition; reducedMotion?: boolean }) {
  const cvs = useRef<HTMLCanvasElement | null>(null);
  const head = useRef(0);
  const color = COND_COLOR[condition];

  useEffect(() => {
    const cv = cvs.current; if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx || typeof ctx.fillRect !== 'function' || typeof ctx.clearRect !== 'function') return; // jsdom-safe
    const W = cv.width, H = cv.height, N = 128, mid = H * 0.6, amp = H * 0.46, colW = W / N;
    const rgb = condition === 'FINE' ? '39,255,90' : condition === 'CAUTION' ? '246,226,1'
      : condition === 'SYNCING' ? '32,240,255' : '255,48,48';
    const draw = () => {
      ctx.clearRect(0, 0, W, H);
      for (let c = 0; c < N; c++) {
        const d = (head.current - c + N) % N;
        const b = 1 - d * 0.028; if (b <= 0) continue;
        const y = condition === 'FLATLINE' ? mid : mid - sig(c) * amp;
        ctx.fillStyle = `rgba(${rgb},${b})`;
        ctx.fillRect(c * colW, Math.min(y, mid), Math.max(1.4, colW * 0.85), Math.max(1, Math.abs(mid - y)));
      }
    };
    draw();
    if (reducedMotion || typeof requestAnimationFrame !== 'function') return; // static trace; test-safe
    let raf = requestAnimationFrame(function loop() {
      head.current = (head.current + 1) % N;
      draw();
      raf = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(raf);
  }, [condition, reducedMotion, tip]);

  return (
    <div style={{ position: 'absolute', left: 14, bottom: 14, width: 430, zIndex: 12, border: '1px solid rgba(39,255,90,.22)', background: 'rgba(0,12,4,.45)', padding: '10px 12px 9px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 6 }}>
        <span style={{ fontFamily: HUD_FONTS.display, fontWeight: 600, fontSize: 10.5, letterSpacing: 2.5, color: HUD_COLORS.nominal, textTransform: 'uppercase' }}>BLOCK CADENCE</span>
        <span style={{ fontFamily: HUD_FONTS.cjk, fontSize: 10, color: '#2f7a44' }}>脉搏</span>
        <span style={{ marginLeft: 'auto', fontFamily: HUD_FONTS.tech, fontWeight: 700, fontSize: 11, letterSpacing: 3, color, textShadow: `0 0 9px ${color}` }}>● {condition}</span>
      </div>
      <canvas ref={cvs} width={406} height={60} style={{ display: 'block', width: '100%', height: 60, background: '#000409' }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5, fontFamily: HUD_FONTS.mono, fontSize: 8.5, color: '#3a5a44', letterSpacing: 1 }}>
        <span>BEAT = NEW BLOCK</span><span>FLATLINE = NO BLOCKS</span>
      </div>
    </div>
  );
}
