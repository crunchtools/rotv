/**
 * Server-side markdown for the legal pages' crawler fallback (#700).
 * Covers only the subset those pages use: headings, bullet and numbered
 * lists, links (http(s) and site-relative only), bold and italic.
 * Everything is HTML-escaped before markup is added.
 */

import { escapeHtml } from './html.js';

function renderInline(text) {
  return escapeHtml(text)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label, href) =>
      /^(https?:\/\/|\/)/.test(href) ? `<a href="${href}">${label}</a>` : label)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

export function renderLegalMarkdown(md) {
  const out = [];
  let list = null;
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const raw of String(md).split('\n')) {
    const line = raw.trim();
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    const bullet = line.match(/^[-*]\s+(.*)$/);
    const numbered = line.match(/^\d+\.\s+(.*)$/);
    if (heading) {
      closeList();
      out.push(`<h${heading[1].length}>${renderInline(heading[2])}</h${heading[1].length}>`);
    } else if (bullet || numbered) {
      const tag = bullet ? 'ul' : 'ol';
      if (list !== tag) { closeList(); out.push(`<${tag}>`); list = tag; }
      out.push(`<li>${renderInline((bullet || numbered)[1])}</li>`);
    } else if (line) {
      closeList();
      out.push(`<p>${renderInline(line)}</p>`);
    } else {
      closeList();
    }
  }
  closeList();
  return out.join('\n');
}
