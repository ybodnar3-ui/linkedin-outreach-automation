import { describe, it, expect } from 'vitest';
import { backoffSeconds, isDeadLettered, nextFailureAction, MAX_LEAD_ATTEMPTS } from './retry';

describe('backoffSeconds', () => {
  it('doubles each attempt starting at 1h', () => {
    expect(backoffSeconds(1)).toBe(3600);       // 1h
    expect(backoffSeconds(2)).toBe(7200);       // 2h
    expect(backoffSeconds(3)).toBe(14400);      // 4h
    expect(backoffSeconds(4)).toBe(28800);      // 8h
    expect(backoffSeconds(5)).toBe(57600);      // 16h
  });

  it('caps at 24h', () => {
    expect(backoffSeconds(6)).toBe(86400);
    expect(backoffSeconds(50)).toBe(86400);
  });

  it('treats <1 as the first attempt', () => {
    expect(backoffSeconds(0)).toBe(3600);
    expect(backoffSeconds(-3)).toBe(3600);
  });
});

describe('isDeadLettered', () => {
  it('is false below the max and true at/above it', () => {
    expect(isDeadLettered(MAX_LEAD_ATTEMPTS - 1)).toBe(false);
    expect(isDeadLettered(MAX_LEAD_ATTEMPTS)).toBe(true);
    expect(isDeadLettered(MAX_LEAD_ATTEMPTS + 2)).toBe(true);
  });
});

describe('nextFailureAction', () => {
  it('retries with backoff before the limit', () => {
    expect(nextFailureAction(1)).toEqual({ action: 'retry', delaySeconds: 3600 });
    expect(nextFailureAction(3)).toEqual({ action: 'retry', delaySeconds: 14400 });
  });

  it('dead-letters at the limit', () => {
    expect(nextFailureAction(MAX_LEAD_ATTEMPTS)).toEqual({ action: 'dead_letter' });
  });
});
