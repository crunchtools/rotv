/**
 * Roving tabindex keyboard handler for tab bars.
 * Arrows move focus between buttons and activate them.
 * Usage: <nav onKeyDown={(e) => handleRovingKeyDown(e, 'button')}>
 */
export function handleRovingKeyDown(e, selector) {
  const buttons = Array.from(e.currentTarget.querySelectorAll(selector));
  const idx = buttons.indexOf(e.target.closest(selector) || e.target);
  if (idx === -1) return;
  if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
    e.preventDefault();
    let next;
    if (e.key === 'ArrowRight') next = (idx + 1) % buttons.length;
    else if (e.key === 'ArrowLeft') next = (idx - 1 + buttons.length) % buttons.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = buttons.length - 1;
    buttons[next].focus();
    buttons[next].click();
  }
}
