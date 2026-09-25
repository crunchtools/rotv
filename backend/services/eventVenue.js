// Event venues from schema.org JSON-LD. The extraction model only sees the
// Readability markdown, which on Summit Metro Parks pages drops the venue
// block and keeps "please call the Nature Realm Visitors Center", so 159 of
// 258 SMP events were saved at Nature Realm. The Events Calendar emits the
// real venue as Event.location on every event page; prefer it.

function formatPlace(place) {
  if (!place) return null;
  if (typeof place === 'string') return place.trim() || null;
  if (Array.isArray(place)) return formatPlace(place.find(p => formatPlace(p)));

  const name = (place.name || '').trim();
  const address = place.address;
  let addressText = '';
  if (typeof address === 'string') {
    addressText = address.trim();
  } else if (address) {
    addressText = [address.streetAddress, address.addressLocality, address.addressRegion]
      .map(part => (part || '').trim())
      .filter(Boolean)
      .join(', ');
  }

  if (!addressText) return name || null;
  if (!name || addressText.toLowerCase().includes(name.toLowerCase())) return addressText;
  return `${name}, ${addressText}`;
}

const normalizeTitle = (title) => (title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

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
