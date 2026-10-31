import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import TrailNameLabel, { TRAIL_LABEL_MIN_ZOOM } from './TrailNameLabel';

vi.mock('react-leaflet', () => ({
  Marker: ({ position, icon, interactive }) => (
    <div data-testid="label" data-position={position.join(',')} data-interactive={String(interactive)}>
      {icon.options.html.outerHTML}
    </div>
  ),
}));

afterEach(cleanup);

const trail = {
  name: 'West Creek Skills Area',
  poi_roles: ['trail'],
  geometry: { type: 'LineString', coordinates: [[-81, 41], [-81, 43]] },
};

describe('TrailNameLabel', () => {
  it('labels a trail at the threshold zoom, at its midpoint, without catching taps', () => {
    render(<TrailNameLabel feature={trail} zoom={TRAIL_LABEL_MIN_ZOOM} />);
    const label = screen.getByTestId('label');
    expect(label.getAttribute('data-position')).toBe('42,-81');
    expect(label.getAttribute('data-interactive')).toBe('false');
    expect(label.textContent).toContain('West Creek Skills Area');
  });

  it('stays off the map below the threshold zoom', () => {
    render(<TrailNameLabel feature={trail} zoom={TRAIL_LABEL_MIN_ZOOM - 1} />);
    expect(screen.queryByTestId('label')).toBeNull();
  });

  it('does not label other linear features', () => {
    render(<TrailNameLabel feature={{ ...trail, poi_roles: ['river'] }} zoom={18} />);
    expect(screen.queryByTestId('label')).toBeNull();
  });

  it('renders the name as text, not markup', () => {
    render(<TrailNameLabel feature={{ ...trail, name: '<img src=x>' }} zoom={18} />);
    expect(screen.getByTestId('label').textContent).toContain('&lt;img src=x&gt;');
  });
});
