// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFile, writeFile } from 'fs/promises';
import { PDFDocument } from 'pdf-lib';
import { formatFormDate, splitName, formEntries, fillListForm } from './listForm';

const layout = {
  page: 0, fontSize: 9, dateX: 552,
  rows: Object.fromEntries(Array.from({ length: 13 }, (_, i) => [String(i + 1), Math.round((277.65 - 14.85 * i) * 100) / 100])),
  choice: { x: 164, y: 86, maxWidth: 130, dateY: 84.6 },
  lastName: { x: 207, y: 488.5, maxWidth: 120 },
  firstName: { x: 333, y: 488.5, maxWidth: 72 },
  email: { x: 207, y: 446.5, maxWidth: 190 },
  returning: { x: 509.8, y: 486.3 }
};
const list = {
  id: 1, choice_label: "Hiker's Choice", form_file: '/lists/fall-hiking-spree-2026-form.pdf', form_layout: layout,
  items: Array.from({ length: 13 }, (_, i) => ({ id: 100 + i, position: i + 1, poi_id: 1000 + i }))
};
const hike = (itemId, doneOn) => ({ list_id: 1, item_id: itemId, poi_id: 1, done_on: doneOn });

afterEach(() => vi.unstubAllGlobals());

describe('formatFormDate and splitName', () => {
  it('writes a date the way a person fills a form', () => {
    expect(formatFormDate('2026-10-03')).toBe('10/3/26');
    expect(formatFormDate('2026-09-15')).toBe('9/15/26');
  });

  it('splits a name into first and last', () => {
    expect(splitName('Scott McCarty')).toEqual({ first: 'Scott', last: 'McCarty' });
    expect(splitName(' Mary Jo  Van Buren ')).toEqual({ first: 'Mary Jo Van', last: 'Buren' });
    expect(splitName('Scott')).toEqual({ first: 'Scott', last: '' });
    expect(splitName('')).toEqual({ first: '', last: '' });
  });
});

describe('formEntries', () => {
  it('puts each hike\'s date on its own row', () => {
    const entries = formEntries(list, [hike(100, '2026-10-03'), hike(104, '2026-09-15'), hike(112, '2026-11-01')]);
    expect(entries).toEqual([
      { text: '10/3/26', x: 552, y: 277.65 },
      { text: '9/15/26', x: 552, y: 218.25 },
      { text: '11/1/26', x: 552, y: 99.45 }
    ]);
  });

  it('writes the free choice\'s trail and date on the choice row', () => {
    expect(formEntries(list, [hike(null, '2026-10-10')], { choiceName: 'Gorge Trail' })).toEqual([
      { text: 'Gorge Trail', x: 164, y: 86, maxWidth: 130 },
      { text: '10/10/26', x: 552, y: 84.6 }
    ]);
    expect(formEntries(list, [hike(null, '2026-10-10')])).toEqual([{ text: '10/10/26', x: 552, y: 84.6 }]);
  });

  it('fills in what the account knows about the hiker, and nothing it does not', () => {
    expect(formEntries(list, [], { name: 'Scott McCarty', email: 'scott@example.com', returning: true })).toEqual([
      { text: 'McCarty', ...layout.lastName },
      { text: 'Scott', ...layout.firstName },
      { text: 'scott@example.com', ...layout.email },
      { text: 'X', ...layout.returning }
    ]);
    expect(formEntries(list, [])).toEqual([]);
  });

  it('ignores hikes on other lists, and a list with no form', () => {
    expect(formEntries(list, [{ ...hike(100, '2026-10-03'), list_id: 2 }])).toEqual([]);
    expect(formEntries({ ...list, form_layout: null }, [hike(100, '2026-10-03')])).toEqual([]);
  });
});

describe('fillListForm', () => {
  const stubForm = async () => {
    const bytes = await readFile(new URL('../../public/lists/fall-hiking-spree-2026-form.pdf', import.meta.url));
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) })));
    return bytes;
  };

  it('writes onto the organizer\'s form and keeps both of its pages', async () => {
    const original = await stubForm();
    const entries = formEntries(
      list,
      [...list.items.map((item, i) => hike(item.id, `2026-10-${String(i + 1).padStart(2, '0')}`)), hike(null, '2026-11-05')],
      { name: 'Scott McCarty', email: 'scott.mccarty@example.com', choiceName: 'Buckeye / Parkway Jogging / Valley Link Trail', returning: true }
    );

    const filled = await fillListForm(list, entries);

    // Set LIST_FORM_OUT to keep the result and look at where the writing landed.
    if (process.env.LIST_FORM_OUT) await writeFile(process.env.LIST_FORM_OUT, filled);
    expect(fetch).toHaveBeenCalledWith('/lists/fall-hiking-spree-2026-form.pdf');
    const pdf = await PDFDocument.load(filled);
    expect(pdf.getPageCount()).toBe(2);
    expect(pdf.getPage(0).getSize()).toEqual({ width: 654, height: 546 });
    expect(Buffer.from(filled).equals(original)).toBe(false);
  });

  it('says so when the form cannot be fetched', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })));
    await expect(fillListForm(list, [])).rejects.toThrow('Could not fetch the form: 404');
  });
});
