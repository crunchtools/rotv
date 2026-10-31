import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import TrailNameLabel from './TrailNameLabel';

vi.mock('react-leaflet', () => ({
  Marker: ({ position, icon, interactive }) => (
    <div data-testid="label" data-position={position.join(',')} data-interactive={String(interactive)}>
      {icon.options.html.outerHTML}
    </div>
  ),
}));

afterEach(cleanup);

const geometry = { type: 'LineString', coordinates: [[-81, 41], [-81, 43]] };

describe('TrailNameLabel', () => {
  it('labels the trail at its midpoint without catching taps', () => {
    render(<TrailNameLabel name="West Creek Skills Area" geometry={geometry} />);
    const label = screen.getByTestId('label');
    expect(label.getAttribute('data-position')).toBe('42,-81');
    expect(label.getAttribute('data-interactive')).toBe('false');
    expect(label.textContent).toContain('West Creek Skills Area');
  });

  it('renders nothing without a usable line', () => {
    render(<TrailNameLabel name="No line" geometry={{ type: 'Point', coordinates: [-81, 41] }} />);
    expect(screen.queryByTestId('label')).toBeNull();
  });

  it('renders the name as text, not markup', () => {
    render(<TrailNameLabel name="<img src=x>" geometry={geometry} />);
    expect(screen.getByTestId('label').textContent).toContain('&lt;img src=x&gt;');
  });
});
