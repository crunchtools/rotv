import { describe, it, expect } from 'vitest';
import { listTourSteps } from './GuidedTour';

const list = {
  name: 'Fall Hiking Spree', goal_count: 8, items: Array.from({ length: 13 }, (_, i) => ({ id: i })),
  form_file: '/lists/fall-hiking-spree-2026-form.pdf', form_layout: { page: 0 }
};

describe('listTourSteps', () => {
  it('walks from checking a trail off to the filled-in form, in the list\'s own numbers', () => {
    const steps = listTourSteps(list);

    expect(steps.map(step => step.selector)).toEqual([
      '.list-challenge', '.list-checkin-btn', '.list-checkin-date', '.list-challenge-progress',
      '.general-settings .settings-grid', '.list-challenge-form', '.list-challenge-form'
    ]);
    expect(steps[0].title).toBe('Fall Hiking Spree');
    expect(steps[0].description).toContain('8 of these 13 trails');
    expect(steps[4].action).toBe('listTourSettings');
    expect(steps[6].image).toBe('/lists/fall-hiking-spree-2026-form-sample.webp');
  });

  it('leaves the form steps out for a list with no form, and has no steps without a list', () => {
    const steps = listTourSteps({ ...list, form_file: null, form_layout: null });

    expect(steps).toHaveLength(4);
    expect(steps.every(step => step.action === 'listTourOpen')).toBe(true);
    expect(listTourSteps(null)).toEqual([]);
  });
});
