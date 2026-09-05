import { cleanup, fireEvent, render } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useSceneInspectionDismiss } from '../../src/components/sceneInspection';

afterEach(cleanup);

// ——— One key, four claimants ————————————————————————————————————————————
//
// Escape closes the innermost thing. The card's dismissal listened on
// `document` in the CAPTURE phase and called `stopPropagation`, so it was the
// FIRST thing to see the key and nothing after it ever ran (report E, E-14):
// the memory ledger's own Escape (unlock a hop, collapse expanded evidence),
// the PANELS menu's and the Jukebox dialog's were all dead in the app, and a
// keyboard user who pressed Escape to unlock a hop lost the whole card.

function Card({ onDismiss, children }: {
  onDismiss: () => void;
  children?: React.ReactNode;
}) {
  const boundary = useRef<HTMLDivElement>(null);
  useSceneInspectionDismiss(boundary, onDismiss);
  return <div ref={boundary} data-card>{children}</div>;
}

describe('Escape closes the innermost thing', () => {
  it('closes the card when nothing nearer has answered', () => {
    const onDismiss = vi.fn();
    render(<Card onDismiss={onDismiss} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('stands down when something inside the card answered first', () => {
    // The ledger's own handlers mark the key handled; the card reads that
    // rather than racing for it.
    const onDismiss = vi.fn();
    const inner = vi.fn();
    const { getByTestId } = render(
      <Card onDismiss={onDismiss}>
        <button
          type="button"
          data-testid="hop"
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            inner();
          }}
        >
          hop
        </button>
      </Card>,
    );
    fireEvent.keyDown(getByTestId('hop'), { key: 'Escape' });
    expect(inner).toHaveBeenCalledTimes(1);
    expect(onDismiss, 'the card closed over its own ledger').not.toHaveBeenCalled();
  });

  it('listens in the bubble phase, so a nearer handler runs at all', () => {
    // The half `defaultPrevented` cannot show: under the old capture listener
    // this inner handler never ran, whatever it did with the event.
    const onDismiss = vi.fn();
    const order: string[] = [];
    const { getByTestId } = render(
      <Card onDismiss={() => { order.push('card'); onDismiss(); }}>
        <button
          type="button"
          data-testid="hop"
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return;
            order.push('hop');
          }}
        >
          hop
        </button>
      </Card>,
    );
    fireEvent.keyDown(getByTestId('hop'), { key: 'Escape' });
    expect(order).toEqual(['hop', 'card']);
  });

  it('answers no other key', () => {
    const onDismiss = vi.fn();
    render(<Card onDismiss={onDismiss} />);
    for (const key of ['Enter', 'Tab', 'a', 'ArrowLeft']) {
      fireEvent.keyDown(document, { key });
    }
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
