import { forwardRef } from 'react';
import { Html } from '@react-three/drei';
import type {
  CellIdentityProofLabel as CellIdentityProofLabelValue,
} from '../derives/cellIdentityProofLabel.derive';

/** One transient screen-space evidence tag attached to a scene proof marker. */
const CellIdentityProofLabel = forwardRef<
  HTMLDivElement,
  { label: CellIdentityProofLabelValue }
>(function CellIdentityProofLabel({ label }, ref) {
  return (
    <Html
      zIndexRange={[4, 4]}
      occlude={false}
      style={{ pointerEvents: 'none', userSelect: 'none' }}
    >
      <div
        ref={ref}
        aria-hidden="true"
        data-memory-identity-proof-label={label.kind}
        data-memory-identity-proof-label-code={label.code}
        data-memory-identity-proof-label-detail={label.detail}
        data-memory-identity-proof-label-state="idle"
        data-memory-identity-proof-label-side="right"
        data-memory-identity-proof-label-vertical="above"
        data-memory-identity-proof-label-opacity="0.000"
        data-memory-identity-proof-label-color={label.color}
        title={label.title}
        style={{
          display: 'inline-flex',
          alignItems: 'baseline',
          gap: 4,
          boxSizing: 'border-box',
          minWidth: 'max-content',
          padding: '2px 5px 2px 6px',
          borderTop: `1px solid ${label.dimColor}`,
          borderLeft: '1px solid transparent',
          borderRight: '1px solid transparent',
          background: `linear-gradient(105deg, ${label.color}17, rgba(1, 4, 12, .92) 32%, rgba(1, 4, 12, .74))`,
          boxShadow: `0 0 12px rgba(0, 0, 0, .58), inset 0 0 8px ${label.color}0b`,
          color: label.color,
          opacity: 0,
          transform: 'translate3d(12px, -8px, 0)',
          transformOrigin: 'left center',
          whiteSpace: 'nowrap',
          willChange: 'transform, opacity',
        }}
      >
        <span
          style={{
            fontFamily: '"Chakra Petch", system-ui, sans-serif',
            fontSize: 7.4,
            lineHeight: 1,
            fontWeight: 700,
            letterSpacing: 1.05,
            textShadow: `0 0 7px ${label.color}66`,
          }}
        >
          {label.code}
        </span>
        <span
          aria-hidden="true"
          style={{ color: label.dimColor, fontSize: 6.4 }}
        >
          /
        </span>
        <span
          style={{
            fontFamily: '"Share Tech Mono", ui-monospace, monospace',
            fontSize: 7.2,
            lineHeight: 1,
            letterSpacing: 0.45,
            color: '#D9F8FF',
          }}
        >
          {label.detail}
        </span>
      </div>
    </Html>
  );
});

export default CellIdentityProofLabel;
