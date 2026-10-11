import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import ListChallenge from './ListChallenge';
import { fillListForm, saveFile } from '../../utils/listForm';
import { useAuth } from '../../hooks/useAuth';

vi.mock('../../hooks/useAuth', () => ({ useAuth: vi.fn() }));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
// The entries are worked out for real; only writing the PDF and saving it are stubbed.
vi.mock('../../utils/listForm', async (importOriginal) => ({
  ...(await importOriginal()),
  fillListForm: vi.fn(async () => new Uint8Array([1, 2, 3])),
  saveFile: vi.fn()
}));

const list = {
  id: 1, slug: 'fall-hiking-spree', edition: 2026, name: 'Fall Hiking Spree',
  description: 'Hike at least eight of these trails.', goal_count: 2, choice_label: null,
  starts_on: '2026-09-01', ends_on: '2026-11-30', source_url: 'https://example.org/spree',
  hero_image: '/lists/fall-hiking-spree-2026.webp', hero_credit: 'Summit Metro Parks',
  items: [{ id: 11, poi_id: 1081, label: 'Quarry Trail' }, { id: 12, poi_id: 1054, label: 'Missing Link Trail' }]
};

const renderWith = (overrides = {}, listCheckins = [], contact = {}) => {
  useAuth.mockReturnValue({ isAuthenticated: true, user: { fullName: 'Scott McCarty', email: 'scott@example.com' }, contact, listCheckins, saveListCheckin: vi.fn(), removeListCheckin: vi.fn() });
  return render(<ListChallenge list={{ ...list, ...overrides }} />);
};

afterEach(cleanup);

describe('ListChallenge', () => {
  it('shows the banner, credited with a link to the organizer', () => {
    renderWith();

    const banner = screen.getByRole('img', { name: 'Fall Hiking Spree, September 1 to November 30' });
    expect(banner.getAttribute('src')).toBe('/lists/fall-hiking-spree-2026.webp');
    const credit = screen.getByRole('link', { name: 'Summit Metro Parks' });
    expect(credit.getAttribute('href')).toBe('https://example.org/spree');
    expect(credit.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('credits the banner in plain text when the list has no page to link', () => {
    renderWith({ source_url: null });

    expect(screen.queryByRole('link', { name: 'Summit Metro Parks' })).toBeNull();
    expect(screen.getByText(/Summit Metro Parks/)).toBeTruthy();
  });

  it('shows the description and tally without a banner', () => {
    const { container } = renderWith({ hero_image: null });

    expect(container.querySelector('.list-hero')).toBeNull();
    expect(screen.getByText('Hike at least eight of these trails.')).toBeTruthy();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('0');
  });

  it('counts the hikes logged and says when the badge is earned', () => {
    renderWith({}, [
      { list_id: 1, item_id: 11, poi_id: 1081, done_on: '2026-09-05' },
      { list_id: 1, item_id: 12, poi_id: 1054, done_on: '2026-09-12' }
    ]);

    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('2');
    expect(screen.getByText('Badge earned September 12.')).toBeTruthy();
  });

  it('offers the completed form only when the list has one', () => {
    renderWith();
    expect(screen.queryByRole('button', { name: /download completed form/i })).toBeNull();
    cleanup();

    renderWith({ form_file: '/lists/form.pdf', form_layout: { page: 0 } });
    expect(screen.getByRole('button', { name: /download completed form/i })).toBeTruthy();
    expect(screen.getByText(/hike dates, name and email filled in/i)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Settings' }).getAttribute('href')).toBe('/settings/general');
  });

  describe('the completed form', () => {
    const form = {
      form_file: '/lists/form.pdf',
      form_layout: {
        page: 0, dateX: 552, rows: { 1: 277.65, 2: 262.8 }, choice: { x: 164, y: 86, dateY: 84.6 },
        lastName: { x: 207, y: 488.5 }, firstName: { x: 333, y: 488.5 }, address: { x: 207, y: 467.5 },
        email: { x: 207, y: 446.5 }, phone: { x: 407, y: 446.5 }, returning: { x: 509.8, y: 486.3 }
      },
      items: [{ id: 11, position: 1, poi_id: 1081, label: 'Quarry Trail' }, { id: 12, position: 2, poi_id: 1054, label: 'Missing Link Trail' }]
    };
    const hikes = [{ list_id: 1, item_id: 12, poi_id: 1054, done_on: '2026-10-03' }];
    const written = () => Object.fromEntries(fillListForm.mock.calls.at(-1)[1].map(entry => [`${entry.x},${entry.y}`, entry.text]));

    it('writes the saved details, the account email and the hike dates, and saves the file', async () => {
      renderWith(form, hikes, { firstName: 'S.', lastName: 'McCarty', address: '1 Main St', phone: '330-555-0100' });

      fireEvent.click(screen.getByRole('button', { name: /download completed form/i }));

      await waitFor(() => expect(saveFile).toHaveBeenCalledWith(expect.any(Uint8Array), 'fall-hiking-spree-2026-form.pdf'));
      expect(written()).toEqual({
        '207,488.5': 'McCarty', '333,488.5': 'S.', '207,467.5': '1 Main St', '207,446.5': 'scott@example.com',
        '407,446.5': '330-555-0100', '552,262.8': '10/3/26'
      });
    });

    it('falls back to the account\'s name only where none was given, not where it was cleared', async () => {
      renderWith(form, hikes, { firstName: '' });

      fireEvent.click(screen.getByRole('button', { name: /download completed form/i }));

      await waitFor(() => expect(fillListForm).toHaveBeenCalled());
      expect(written()['207,488.5']).toBe('McCarty');
      expect(written()['333,488.5']).toBeUndefined();
    });

    it('says so, and saves nothing, when earlier years cannot be loaded', async () => {
      saveFile.mockClear();
      vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503 })));
      vi.spyOn(console, 'error').mockImplementation(() => {});
      renderWith(form, [...hikes, { list_id: 7, item_id: 70, poi_id: 1, done_on: '2025-10-01' }]);

      fireEvent.click(screen.getByRole('button', { name: /download completed form/i }));

      expect((await screen.findByRole('alert')).textContent).toContain('could not be filled in');
      expect(saveFile).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    });
  });
});
