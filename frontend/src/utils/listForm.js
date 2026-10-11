/**
 * The organizer's own paper form for a curated list, handed back filled in
 * (spec 050): each hike's date, the free choice, and the name and email the
 * account holds. A list says where things go in `form_layout` (PDF points,
 * origin at the bottom left of the page).
 */
import { checkinsForList } from './listProgress';

/** An ISO date as the form's short date, e.g. 10/3/26. */
export function formatFormDate(isoDate) {
  const [year, month, day] = isoDate.split('-').map(Number);
  return `${month}/${day}/${String(year).slice(-2)}`;
}

/**
 * Split a person's name the way the form asks for it.
 * @param {string} fullName
 * @returns {{first: string, last: string}} A single word is a first name
 */
export function splitName(fullName) {
  const words = (fullName || '').trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return { first: words[0] || '', last: '' };
  return { first: words.slice(0, -1).join(' '), last: words[words.length - 1] };
}

// Fields of `details` that go on the form as they are, where the layout has a place of the same name.
const DETAIL_FIELDS = ['lastName', 'firstName', 'address', 'city', 'state', 'zip', 'email', 'phone'];

/**
 * What to write on the form, and where.
 *
 * @param {object} list A list from /api/lists, with `form_layout`
 * @param {object[]} checkins Every check-in the person has
 * @param {object} [details] What is known about the person; anything missing is left blank
 * @param {string} [details.firstName]
 * @param {string} [details.lastName]
 * @param {string} [details.address] Street address
 * @param {string} [details.city]
 * @param {string} [details.state]
 * @param {string} [details.zip]
 * @param {string} [details.email]
 * @param {string} [details.phone]
 * @param {string} [details.choiceName] The trail hiked as the free choice
 * @param {boolean} [details.returning] They finished an earlier year, so "Returning hiker" is ticked
 * @returns {{text: string, x: number, y: number, maxWidth?: number}[]} Empty when the list has no layout
 */
export function formEntries(list, checkins, details = {}) {
  const layout = list.form_layout;
  if (!layout) return [];
  const { choiceName = '', returning = false } = details;

  const entries = [];
  for (const field of DETAIL_FIELDS) {
    if (details[field] && layout[field]) entries.push({ text: details[field], ...layout[field] });
  }
  if (returning) entries.push({ text: 'X', ...layout.returning });

  for (const checkin of checkinsForList(list, checkins)) {
    const date = formatFormDate(checkin.done_on);
    if (checkin.item_id == null) {
      if (choiceName) entries.push({ text: choiceName, x: layout.choice.x, y: layout.choice.y, maxWidth: layout.choice.maxWidth });
      entries.push({ text: date, x: layout.dateX, y: layout.choice.dateY });
      continue;
    }
    const item = list.items.find(i => i.id === checkin.item_id);
    const rowBaseline = layout.rows[item.position];
    if (rowBaseline != null) entries.push({ text: date, x: layout.dateX, y: rowBaseline });
  }
  return entries;
}

/**
 * Write entries onto the list's form.
 *
 * @param {object} list A list with `form_file` and `form_layout`
 * @param {{text: string, x: number, y: number, maxWidth?: number}[]} entries From formEntries()
 * @returns {Promise<Uint8Array>} The filled-in PDF
 * @throws When the form cannot be fetched or is not a PDF
 */
export async function fillListForm(list, entries) {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const res = await fetch(list.form_file);
  if (!res.ok) throw new Error(`Could not fetch the form: ${res.status}`);

  const pdf = await PDFDocument.load(await res.arrayBuffer());
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.getPage(list.form_layout.page || 0);
  const ink = rgb(0.07, 0.15, 0.45);

  for (const entry of entries) {
    // Shrink a long name to the space the form gives it, down to a legible floor.
    let size = list.form_layout.fontSize || 9;
    while (entry.maxWidth && size > 5 && font.widthOfTextAtSize(entry.text, size) > entry.maxWidth) size -= 0.5;
    page.drawText(entry.text, { x: entry.x, y: entry.y, size, font, color: ink });
  }
  return pdf.save();
}

/**
 * Hand a file to the browser to save.
 * @param {Uint8Array} bytes
 * @param {string} filename
 */
export function saveFile(bytes, filename) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
