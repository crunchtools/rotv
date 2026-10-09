import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

vi.mock('./ParkNews', () => ({ default: ({ label }) => <p>news list {label}</p> }));
vi.mock('./ParkEvents', () => ({ default: ({ label }) => <p>events list {label}</p> }));

const { default: HappeningTab } = await import('./HappeningTab');

afterEach(cleanup);

describe('HappeningTab', () => {
  it('shows news or events by the view it is given, passing each its own props', () => {
    const props = { onViewChange: vi.fn(), newsProps: { label: 'n' }, eventsProps: { label: 'e' } };
    const { rerender } = render(<HappeningTab view="news" {...props} />);
    expect(screen.getByText('news list n')).toBeTruthy();
    expect(screen.queryByText('events list e')).toBeNull();
    expect(screen.getByRole('button', { name: 'News' }).getAttribute('aria-pressed')).toBe('true');

    rerender(<HappeningTab view="events" {...props} />);
    expect(screen.getByText('events list e')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Events' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('asks for the other view when its button is pressed', () => {
    const onViewChange = vi.fn();
    render(<HappeningTab view="news" onViewChange={onViewChange} newsProps={{}} eventsProps={{}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Events' }));
    expect(onViewChange).toHaveBeenCalledWith('events');
  });
});
