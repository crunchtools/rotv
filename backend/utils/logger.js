// Leveled, tagged logger for the backend. Output stays plain text
// ("[Tag] message") so journald and ./run.sh logs read the same as before;
// LOG_LEVEL (debug | info | warn | error, default info) filters it.
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

function threshold() {
  return LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] ?? LEVELS.info;
}

function emit(sink, level, tag, args) {
  if (LEVELS[level] < threshold()) return;
  if (typeof args[0] === 'string') {
    sink(`[${tag}] ${args[0]}`, ...args.slice(1));
  } else {
    sink(`[${tag}]`, ...args);
  }
}

/**
 * Create a logger whose lines are prefixed with `[tag]`.
 *
 * @param {string} tag - Subsystem label, e.g. 'Moderation' or 'pg-boss'.
 * @returns {{debug: Function, info: Function, warn: Function, error: Function}}
 *   Each method takes console-style arguments; a string first argument is
 *   joined to the tag, anything else is passed through after it.
 */
export function createLogger(tag) {
  return {
    debug: (...args) => emit(console.info, 'debug', tag, args),
    info: (...args) => emit(console.info, 'info', tag, args),
    warn: (...args) => emit(console.warn, 'warn', tag, args),
    error: (...args) => emit(console.error, 'error', tag, args)
  };
}
