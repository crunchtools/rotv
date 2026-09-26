import { describe, it, expect, afterEach, vi } from 'vitest';
import { createLogger } from '../utils/logger.js';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function spyConsole() {
  return {
    info: vi.spyOn(console, 'info').mockImplementation(() => {}),
    warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
    error: vi.spyOn(console, 'error').mockImplementation(() => {})
  };
}

describe('createLogger', () => {
  it('prefixes a string message with the tag and passes extra args through', () => {
    const sinks = spyConsole();
    createLogger('Moderation').info('scored item', 42);
    expect(sinks.info).toHaveBeenCalledWith('[Moderation] scored item', 42);
  });

  it('puts the tag before a non-string first argument', () => {
    const sinks = spyConsole();
    const detail = { id: 7 };
    createLogger('Server').error(detail);
    expect(sinks.error).toHaveBeenCalledWith('[Server]', detail);
  });

  it('routes warn and error to their console sinks', () => {
    const sinks = spyConsole();
    const logger = createLogger('T');
    logger.warn('w');
    logger.error('e');
    expect(sinks.warn).toHaveBeenCalledWith('[T] w');
    expect(sinks.error).toHaveBeenCalledWith('[T] e');
  });

  it('drops debug at the default info level', () => {
    const sinks = spyConsole();
    createLogger('T').debug('hidden');
    expect(sinks.info).not.toHaveBeenCalled();
  });

  it('emits debug when LOG_LEVEL=debug', () => {
    vi.stubEnv('LOG_LEVEL', 'DEBUG');
    const sinks = spyConsole();
    createLogger('T').debug('shown');
    expect(sinks.info).toHaveBeenCalledWith('[T] shown');
  });

  it('filters below LOG_LEVEL=warn', () => {
    vi.stubEnv('LOG_LEVEL', 'warn');
    const sinks = spyConsole();
    const logger = createLogger('T');
    logger.info('quiet');
    logger.warn('loud');
    expect(sinks.info).not.toHaveBeenCalled();
    expect(sinks.warn).toHaveBeenCalledWith('[T] loud');
  });

  it('falls back to info for an unknown LOG_LEVEL', () => {
    vi.stubEnv('LOG_LEVEL', 'verbose');
    const sinks = spyConsole();
    const logger = createLogger('T');
    logger.debug('hidden');
    logger.info('shown');
    expect(sinks.info).toHaveBeenCalledTimes(1);
    expect(sinks.info).toHaveBeenCalledWith('[T] shown');
  });
});
