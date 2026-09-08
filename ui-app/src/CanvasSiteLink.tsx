import { HUD_COLORS, HUD_FONTS, rgba } from '@cknerv/ui';

/** Sits beside the sound chip, or docks on its own when sound is disabled. */
export default function CanvasSiteLink({ floating = false }: { floating?: boolean }) {
  return (
    <a
      className="cknerv-hud-link"
      href="https://web5.info/"
      target="_blank"
      rel="noopener noreferrer"
      title="Open web5.info in a new tab"
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      style={{
        position: floating ? 'fixed' : undefined,
        right: floating ? 'max(14px, env(safe-area-inset-right, 0px))' : undefined,
        bottom: floating ? 'max(14px, env(safe-area-inset-bottom, 0px))' : undefined,
        zIndex: floating ? 22 : undefined,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        minHeight: 24,
        padding: '0 4px',
        fontFamily: HUD_FONTS.mono,
        fontSize: 9,
        letterSpacing: 1.2,
        whiteSpace: 'nowrap',
        background: rgba(HUD_COLORS.stageGround, 0.8),
        pointerEvents: 'auto',
      }}
    >
      WEB5.INFO <span aria-hidden="true">↗</span>
    </a>
  );
}
