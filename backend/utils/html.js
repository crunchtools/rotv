/**
 * Escape a string for safe use in HTML text and double- or single-quoted
 * attributes. Falsy input returns ''.
 */
export function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
