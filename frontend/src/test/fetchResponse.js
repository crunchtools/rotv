/**
 * Minimal stand-in for a fetch() Response in hook tests.
 *
 * @param {*} body - Value resolved by `json()`.
 * @param {{status?: number, statusText?: string}} [init]
 * @returns {{ok: boolean, status: number, statusText: string, json: () => Promise<*>}}
 */
export function fetchResponse(body, { status = 200, statusText = 'OK' } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: () => Promise.resolve(body)
  };
}
