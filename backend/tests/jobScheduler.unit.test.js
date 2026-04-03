import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withJitter } from '../services/jobScheduler.js';

describe('withJitter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should call the wrapped handler', async () => {
    const handler = vi.fn().mockResolvedValue('done');
    const wrapped = withJitter(handler, 'test-job');

    const promise = wrapped('arg1', 'arg2');
    await vi.runAllTimersAsync();
    const returnValue = await promise;

    expect(handler).toHaveBeenCalledWith('arg1', 'arg2');
    expect(returnValue).toBe('done');
  });

  it('should delay between minSeconds and maxSeconds (default 1-60)', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');

    const wrapped = withJitter(handler, 'test-job');
    const promise = wrapped();
    await vi.runAllTimersAsync();
    await promise;

    const jitterCall = setTimeoutSpy.mock.calls.find(
      ([, ms]) => ms >= 1000 && ms <= 60000
    );
    expect(jitterCall).toBeDefined();
    const delayMs = jitterCall[1];
    expect(delayMs).toBeGreaterThanOrEqual(1000);
    expect(delayMs).toBeLessThanOrEqual(60000);
    expect(delayMs % 1000).toBe(0);

    setTimeoutSpy.mockRestore();
  });

  it('should respect custom min/max seconds', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');

    const wrapped = withJitter(handler, 'test-job', 5, 10);
    const promise = wrapped();
    await vi.runAllTimersAsync();
    await promise;

    const jitterCall = setTimeoutSpy.mock.calls.find(
      ([, ms]) => ms >= 5000 && ms <= 10000
    );
    expect(jitterCall).toBeDefined();

    setTimeoutSpy.mockRestore();
  });

  it('should propagate errors from the handler', async () => {
    vi.useRealTimers();
    const error = new Error('handler failed');
    const handler = vi.fn().mockRejectedValue(error);
    const wrapped = withJitter(handler, 'test-job', 0, 0);

    await expect(wrapped()).rejects.toThrow('handler failed');
    vi.useFakeTimers();
  });

  it('should log the jitter delay', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const handler = vi.fn().mockResolvedValue(undefined);
    const wrapped = withJitter(handler, 'my-job');

    const promise = wrapped();
    await vi.runAllTimersAsync();
    await promise;

    const jitterLog = consoleSpy.mock.calls.find(
      ([msg]) => typeof msg === 'string' && msg.includes('[Jitter] my-job delayed by')
    );
    expect(jitterLog).toBeDefined();

    consoleSpy.mockRestore();
  });
});
