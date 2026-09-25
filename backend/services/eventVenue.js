// Event venues from schema.org JSON-LD. The extraction model only sees the
// Readability markdown, which on Summit Metro Parks pages drops the venue
// block and keeps "please call the Nature Realm Visitors Center", so 159 of
// 258 SMP events were saved at Nature Realm. The Events Calendar emits the
// real venue as Event.location on every event page; prefer it.

// WordPress JSON-LD carries HTML entities ("Let&#8217;s", "Kayak &amp; Canoe")
const NAMED_ENTITIES = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };
function decodeEntities(text) {
  return (text || '')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (entity, name) => NAMED_ENTITIES[name.toLowerCase()] ?? entity);
}

function formatPlace(place) {
  if (!place) return null;
  if (typeof place === 'string') return decodeEntities(place).trim() || null;
  if (Array.isArray(place)) return formatPlace(place.find(p => formatPlace(p)));

  const name = decodeEntities(place.name).trim();
  const address = place.address;
  let addressText = '';
  if (typeof address === 'string') {
    addressText = decodeEntities(address).trim();
  } else if (address) {
    // Some sites stuff the whole address into streetAddress; don't repeat
    // the locality or region it already contains.
    addressText = decodeEntities(address.streetAddress).trim();
    for (const part of [address.addressLocality, address.addressRegion]) {
      const trimmed = decodeEntities(part).trim();
      if (trimmed && !addressText.toLowerCase().includes(trimmed.toLowerCase())) {
        addressText = addressText ? `${addressText}, ${trimmed}` : trimmed;
      }
    }
  }

  if (!addressText) return name || null;
  const leadingNumber = (text) => text.match(/^\d+/)?.[0];
  const nameIsAddress = leadingNumber(name) && leadingNumber(name) === leadingNumber(addressText);
  if (!name || nameIsAddress || addressText.toLowerCase().includes(name.toLowerCase())) return addressText;
  return `${name}, ${addressText}`;
}

const normalizeTitle = (title) => decodeEntities(title).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Pick the JSON-LD event this extracted item came from: a title match, or the
// page's only event. Listing pages with several events and no title match
// return null so the model's answer stands.
export function jsonLdVenueFor(item, jsonLdEvents) {
  const events = (jsonLdEvents || []).filter(e => formatPlace(e.location));
  if (events.length === 0) return null;

  const title = normalizeTitle(item.title);
  const match = title && events.find(e => normalizeTitle(e.name) === title);
  if (match) return formatPlace(match.location);
  if ((jsonLdEvents || []).length === 1) return formatPlace(events[0].location);
  return null;
}
