/** Inherits the top bar's action module typography and spacing. */
export default function TopBarSiteLink() {
  return (
    <a
      className="cknerv-hud-link cknerv-touch-target"
      href="https://web5.info/"
      target="_blank"
      rel="noopener noreferrer"
      title="Open web5.info in a new tab"
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        height: '100%',
        pointerEvents: 'auto',
      }}
    >
      WEB5.INFO
    </a>
  );
}
