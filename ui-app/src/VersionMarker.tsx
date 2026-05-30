import type {
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';

import { resolveBuildVersion } from './runtime-config';

export const CKNERV_REPOSITORY_URL = 'https://github.com/janx/cknerv';

const MARKER_STYLE: CSSProperties = {
  position: 'fixed',
  right: 18,
  bottom: 14,
  zIndex: 20,
  color: 'rgba(148, 163, 184, 0.78)',
  fontFamily:
    '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  fontSize: 11,
  lineHeight: '16px',
  letterSpacing: '0.02em',
  textDecoration: 'none',
  textShadow: '0 0 10px rgba(2, 6, 23, 0.9)',
  userSelect: 'none',
};

function stopOverlayEvent(
  event:
    | ReactMouseEvent<HTMLAnchorElement>
    | ReactPointerEvent<HTMLAnchorElement>,
) {
  event.stopPropagation();
}

export default function VersionMarker() {
  const buildVersion = resolveBuildVersion();

  return (
    <a
      href={CKNERV_REPOSITORY_URL}
      target="_blank"
      rel="noreferrer"
      style={MARKER_STYLE}
      onClick={stopOverlayEvent}
      onPointerDown={stopOverlayEvent}
    >
      {buildVersion}
    </a>
  );
}
