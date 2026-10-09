import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import FilterSheet, { FilterChip } from './FilterSheet';

afterEach(cleanup);

function renderSheet(props = {}, onToggle = vi.fn()) {
  render(
    <FilterSheet {...props}>
      <FilterChip id="trails" active onToggle={onToggle}>Trails</FilterChip>
    </FilterSheet>
  );
  return onToggle;
}

describe('FilterSheet', () => {
  it('keeps the chips out of the page until Filters is pressed', () => {
    renderSheet();
    const button = screen.getByRole('button', { name: 'Filters' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('dialog', { name: 'Filters' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Trails' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('shows how many filters are narrowing the list', () => {
    renderSheet({ activeCount: 2 });
    expect(screen.getByRole('button', { name: 'Filters · 2' })).toBeTruthy();
  });

  it('toggles a chip and stays open', () => {
    const onToggle = renderSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    fireEvent.click(screen.getByRole('button', { name: 'Trails' }));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('closes on Done, on Escape and on the backdrop, and returns focus to the button', () => {
    renderSheet();
    const button = screen.getByRole('button', { name: 'Filters' });

    fireEvent.click(button);
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(button);

    fireEvent.click(button);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(button);
    fireEvent.click(document.querySelector('.filter-sheet-backdrop'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
