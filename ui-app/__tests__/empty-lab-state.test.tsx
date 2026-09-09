import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { getBootSequence, resetBootSequenceForTest } from '@cknerv/ui';
import EmptyLabState from '../src/EmptyLabState';

afterEach(() => {
  cleanup();
  resetBootSequenceForTest();
});

describe('empty Visual Review handoff', () => {
  it('reports presentation only after the shared DOM empty state commits', () => {
    expect(getBootSequence().viewPresented).toBe(false);
    const { getByRole } = render(<EmptyLabState />);
    expect(getByRole('status').textContent).toContain('No Cell data available.');
    expect(getBootSequence()).toMatchObject({ viewPresented: true, viewKind: 'empty' });
  });

  it.each([
    'ProtocolEventLab.tsx',
    'CellFormLab.tsx',
    'CellIdentityProofLab.tsx',
    'CellRelicLab.tsx',
  ])('%s uses the shared empty-state handoff', (file) => {
    const source = readFileSync(resolve(process.cwd(), 'src', file), 'utf8');
    expect(source).toContain("import EmptyLabState from './EmptyLabState'");
    expect(source).toContain('<EmptyLabState />');
    expect(source).not.toContain('No Cell data available.</pre>');
  });
});
