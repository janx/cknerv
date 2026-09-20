import { describe, expect, it } from 'vitest';
import * as root from '../src/index';
import * as boot from '../src/boot';
import * as quality from '../src/quality';

describe('narrow startup exports', () => {
  it('share the same boot and quality stores as the package root', () => {
    expect(boot.getBootSequence).toBe(root.getBootSequence);
    expect(boot.subscribeBootSequence).toBe(root.subscribeBootSequence);
    expect(quality.setQualityMode).toBe(root.setQualityMode);
    expect(quality.getQualityRuntimeSnapshot).toBe(root.getQualityRuntimeSnapshot);
  });
});
