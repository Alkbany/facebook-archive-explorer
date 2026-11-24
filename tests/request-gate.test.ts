import { describe, expect, it } from 'vitest';
import { createRequestGate } from '../src/shared/request-gate';

describe('async request gate', () => {
  it('only accepts the latest request after a newer request starts', () => {
    const gate = createRequestGate();
    const first = gate.begin();
    const second = gate.begin();

    expect(gate.isCurrent(first)).toBe(false);
    expect(gate.isCurrent(second)).toBe(true);
  });

  it('invalidates outstanding requests when the selected view changes', () => {
    const gate = createRequestGate();
    const pending = gate.begin();

    gate.invalidate();

    expect(gate.isCurrent(pending)).toBe(false);
    const next = gate.begin();
    expect(gate.isCurrent(next)).toBe(true);
  });
});
