import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import Mosaic from './Mosaic';

vi.mock('./Lightbox', () => ({
  default: ({ media, initialIndex }) => (
    <div data-testid="lightbox" data-count={media.length} data-index={initialIndex} />
  )
}));

const photo = (id) => ({
  id,
  media_type: 'image',
  thumbnail_url: `/thumb/${id}.jpg`,
  medium_url: `/medium/${id}.jpg`
});

afterEach(cleanup);

describe('Mosaic compact', () => {
  it('shows one thumbnail and no count for a single photo', () => {
    const { container } = render(<Mosaic compact media={[photo(1)]} />);

    const thumb = screen.getByRole('button', { name: 'View 1 photo' });
    expect(thumb.querySelector('img').getAttribute('src')).toBe('/thumb/1.jpg');
    expect(container.querySelector('.mosaic-thumb-count')).toBeNull();
    expect(container.querySelector('.mosaic')).toBeNull();
  });

  it('counts the whole gallery, not just the mosaic slice', () => {
    const all = [1, 2, 3, 4, 5].map(photo);
    const { container } = render(<Mosaic compact media={all.slice(0, 3)} allMedia={all} />);

    expect(screen.getByRole('button', { name: 'View 5 photos' })).toBeTruthy();
    expect(container.querySelector('.mosaic-thumb-count').textContent).toBe('5');
  });

  it('falls back to the medium image when there is no thumbnail', () => {
    render(<Mosaic compact media={[{ ...photo(7), thumbnail_url: null }]} />);

    expect(screen.getByRole('button').querySelector('img').getAttribute('src')).toBe('/medium/7.jpg');
  });

  it('opens the gallery at the first photo', () => {
    const all = [1, 2, 3, 4].map(photo);
    render(<Mosaic compact media={all.slice(0, 3)} allMedia={all} />);
    expect(screen.queryByTestId('lightbox')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'View 4 photos' }));

    const lightbox = screen.getByTestId('lightbox');
    expect(lightbox.dataset.count).toBe('4');
    expect(lightbox.dataset.index).toBe('0');
  });

  it('renders nothing without media', () => {
    const { container } = render(<Mosaic compact media={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
