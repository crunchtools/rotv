import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

// Each view shows the menu it is handed beside its own Filters button
vi.mock('./ParkNews', () => ({ default: ({ label, viewPicker }) => <div><p>news list {label}</p>{viewPicker}</div> }));
vi.mock('./ParkEvents', () => ({ default: ({ label, viewPicker }) => <div><p>events list {label}</p>{viewPicker}</div> }));

vi.mock('./FeatureBanner', () => ({ default: ({ exclude }) => <p>banner without {exclude}</p> }));

const { default: HappeningTab } = await import('./HappeningTab');

afterEach(cleanup);

describe('HappeningTab', () => {
  it('shows news or events by the view it is given, passing each its own props', () => {
    const props = { onViewChange: vi.fn(), newsProps: { label: 'n' }, eventsProps: { label: 'e' } };
    const { rerender } = render(<HappeningTab view="news" {...props} />);
    expect(screen.getByText('news list n')).toBeTruthy();
    expect(screen.queryByText('events list e')).toBeNull();
    // The banner advertises the rest of the site, not the tab it sits on
    expect(screen.getByText('banner without happening')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'News' }).getAttribute('aria-haspopup')).toBe('menu');

    rerender(<HappeningTab view="events" {...props} />);
    expect(screen.getByText('events list e')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Events' })).toBeTruthy();
  });

  it('asks for the other view when it is picked from the menu', () => {
    const onViewChange = vi.fn();
    render(<HappeningTab view="news" onViewChange={onViewChange} newsProps={{}} eventsProps={{}} />);

    fireEvent.click(screen.getByRole('button', { name: 'News' }));
    expect(screen.getByRole('menuitemradio', { name: 'News' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Events' }));

    expect(onViewChange).toHaveBeenCalledWith('events');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes the menu on Escape without changing the view', () => {
    const onViewChange = vi.fn();
    render(<HappeningTab view="news" onViewChange={onViewChange} newsProps={{}} eventsProps={{}} />);

    fireEvent.click(screen.getByRole('button', { name: 'News' }));
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });

    expect(screen.queryByRole('menu')).toBeNull();
    expect(onViewChange).not.toHaveBeenCalled();
  });
});
