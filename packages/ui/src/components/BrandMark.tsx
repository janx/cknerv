import { CKNERV_BRAND } from '../brandIdentity';

export function BrandMark({ size = 24, title }: { size?: number; title?: string }) {
  const { colors, compact } = CKNERV_BRAND;
  return (
    <svg
      data-cknerv-brand-mark
      viewBox="0 0 32 32"
      width={size}
      height={size}
      fill="none"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      style={{ display: 'block', flex: '0 0 auto' }}
    >
      {title ? <title>{title}</title> : null}
      <g strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.3">
        <path d={compact.cellOuter} stroke={colors.cell} opacity=".94" />
        <path d={compact.cellInner} stroke={colors.cell} opacity=".68" />
        <path d={compact.peerOuter} stroke={colors.peer} opacity=".72" />
        <path d={compact.peerInner} stroke={colors.peer} opacity=".49" />
      </g>
      <circle cx="16" cy="16" r="2.2" fill={colors.ground} />
      <circle cx="16" cy="16" r="1.35" fill={colors.ink} />
    </svg>
  );
}
