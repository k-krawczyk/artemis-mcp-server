import { describe, expect, it } from 'vitest';
import { isOlderThan } from '../../src/artemis/version.js';

describe('isOlderThan', () => {
  it('returns false for equal versions', () => {
    expect(isOlderThan('2.30.0', '2.30.0')).toBe(false);
  });

  it('detects older versions', () => {
    expect(isOlderThan('2.29.0', '2.30.0')).toBe(true);
    expect(isOlderThan('1.5.0', '2.30.0')).toBe(true);
  });

  it('detects newer versions', () => {
    expect(isOlderThan('2.44.0', '2.30.0')).toBe(false);
    expect(isOlderThan('3.0.0', '2.30.0')).toBe(false);
  });

  it('compares numerically rather than lexically', () => {
    expect(isOlderThan('2.9.0', '2.30.0')).toBe(true);
    expect(isOlderThan('2.100.0', '2.30.0')).toBe(false);
  });
});
