/**
 * Named things a story is about ("Primate Forest", "Boo at the Zoo"), used as
 * evidence that two items report one story even when they are filed under
 * different POIs. Place and region names are not evidence: every week has a
 * dozen stories that mention "Cuyahoga Valley" or "Summit Metro Parks".
 */
import * as chrono from 'chrono-node';
import { decodeEntities, foldCase, dayInTimezone } from './normalize.js';

// Allowed inside a name ("Boo at the Zoo", "Día de los Muertos"), never at its ends.
// "and" is not one: it joins two names ("Euclid Beach and Edgewater Beach").
const CONNECTORS = new Set(['of', 'the', 'at', 'de', 'los', 'las', 'la', 'del', 'in', 'on', 'for']);
// Capitalized only because they start a sentence or a phrase
const LEADING_FILLER = new Set([
  'the', 'a', 'an', 'this', 'that', 'these', 'join', 'visit', 'come', 'see', 'our', 'its',
  'his', 'her', 'their', 'on', 'in', 'at', 'for', 'from', 'with', 'after', 'before',
  'during', 'each', 'every', 'new', 'all', 'some', 'when', 'while', 'if', 'as', 'by'
]);
// Calendar words are dates, not names
const CALENDAR = new Set([
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september',
  'october', 'november', 'december', 'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep',
  'sept', 'oct', 'nov', 'dec', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday',
  'saturday', 'sunday', 'am', 'pm', 'est', 'edt', 'day', 'days', 'week', 'weekend', 'year'
]);
const TITLE_CASE_RATIO = 0.7;

/**
 * Fold a plural to its singular, so "Fishing Derbies" and "Fishing Derby" are
 * one name. Deliberately light: only -ies and a trailing -s on longer words.
 * @param {string} word lowercase word
 * @returns {string}
 */
export function stemWord(word) {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

const isCapitalized = (word) => /^\p{Lu}/u.test(word);
const cleanWord = (word) => word.replace(/^[^\p{L}\p{N}&]+|[^\p{L}\p{N}&]+$/gu, '').replace(/['’]s$/i, '');

/**
 * True when nearly every longer word is capitalized ("Zoo Unveils First Phase
 * of Primate Forest"). Capitalization in such a title marks nothing.
 * @param {string} title
 * @returns {boolean}
 */
export function isTitleCase(title) {
  const words = decodeEntities(title).split(/\s+/).map(cleanWord).filter(w => w.length >= 4);
  if (words.length < 3) return false;
  return words.filter(isCapitalized).length / words.length >= TITLE_CASE_RATIO;
}

function phrasesIn(text) {
  const phrases = [];
  for (const sentence of decodeEntities(text).split(/(?<=[.!?:;])\s+|\n+|\s[|–—]\s/)) {
    let run = [];
    const flush = () => {
      while (run.length && CONNECTORS.has(run[run.length - 1])) run.pop();
      while (run.length && (CONNECTORS.has(run[0]) || LEADING_FILLER.has(run[0]))) run.shift();
      if (run.length >= 2) phrases.push(run.map(stemWord).join(' '));
      run = [];
    };
    for (const raw of sentence.split(/\s+/)) {
      const word = cleanWord(raw);
      const folded = foldCase(word);
      if (word && isCapitalized(word) && !CALENDAR.has(folded)) {
        run.push(folded);
      } else if (run.length && CONNECTORS.has(folded)) {
        run.push(folded);
      } else {
        flush();
      }
      // Punctuation after a word ends the name ("Primate Forest, its largest…")
      if (/[,()"“”]$/.test(raw)) flush();
    }
    flush();
  }
  return phrases;
}

/**
 * Distinctive multi-word names in an item's title and summary, folded to
 * lowercase. A name made only of place words, connectors and calendar words is
 * dropped. Title Case titles contribute nothing (every word is capitalized);
 * their names still count when the summary repeats them.
 * @param {{title?: string, summary?: string, description?: string}} item
 * @param {Set<string>} placeWords words of every POI name plus region words
 * @returns {Set<string>}
 */
export function extractEntities(item, placeWords) {
  const sources = [item.summary || item.description || ''];
  if (item.title && !isTitleCase(item.title)) sources.push(item.title);
  const isPlain = (w) => CONNECTORS.has(w) || placeWords.has(w) || CALENDAR.has(w);
  const entities = new Set();
  for (const source of sources) {
    for (const phrase of phrasesIn(source)) {
      const name = trimPlaceTail(phrase.split(' '), placeWords);
      if (name.length >= 2 && name.some(w => !isPlain(w))) entities.add(name.join(' '));
    }
  }
  return entities;
}

// "Asian Lantern Festival at Cleveland Metroparks Zoo" names the festival; the
// part after the last connector only says where, so drop it when it is all place
// words and a name of two or more words remains ("Boo at the Zoo" stays whole)
function trimPlaceTail(words, placeWords) {
  const cut = words.findLastIndex(w => CONNECTORS.has(w));
  if (cut <= 0) return words;
  const head = words.slice(0, cut);
  while (head.length && CONNECTORS.has(head[head.length - 1])) head.pop();
  if (head.length < 2 || !words.slice(cut + 1).every(w => placeWords.has(w))) return words;
  return trimPlaceTail(head, placeWords);
}

/**
 * Calendar days mentioned in the text, resolved against a reference date.
 * Only dates with an explicit day count ("October 22", "Oct. 24"), not "this weekend".
 * @param {string} text
 * @param {Date} referenceDate
 * @param {string} tz
 * @returns {Set<string>} YYYY-MM-DD days
 */
export function mentionedDays(text, referenceDate, tz) {
  const days = new Set();
  if (!text) return days;
  for (const result of chrono.parse(text, referenceDate)) {
    if (result.start.isCertain('day') && result.start.isCertain('month')) {
      days.add(dayInTimezone(result.start.date(), tz));
    }
  }
  return days;
}
