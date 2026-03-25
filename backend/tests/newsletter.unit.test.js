/**
 * Newsletter Service Unit Tests
 * Tests extractContentFromEmail (HTML → markdown conversion)
 */
import { describe, it, expect } from 'vitest';
import { extractContentFromEmail } from '../services/newsletterService.js';

describe('Newsletter Content Extraction', () => {

  it('should convert HTML newsletter to markdown', () => {
    const html = `
      <html>
        <body>
          <h1>Park Newsletter</h1>
          <p>Trail updates for Cuyahoga Valley National Park.</p>
          <h2>Brandywine Falls Trail Reopens</h2>
          <p>The Brandywine Falls trail has reopened after seasonal maintenance.</p>
        </body>
      </html>
    `;

    const result = extractContentFromEmail(html, null);
    expect(result).toContain('Park Newsletter');
    expect(result).toContain('Brandywine Falls Trail Reopens');
    expect(result).toContain('reopened after seasonal maintenance');
  });

  it('should strip unsubscribe and footer elements', () => {
    const html = `
      <html>
        <body>
          <p>Important trail news.</p>
          <footer><p>Footer content</p></footer>
          <div class="unsubscribe"><a href="https://example.com/unsubscribe">Unsubscribe</a></div>
        </body>
      </html>
    `;

    const result = extractContentFromEmail(html, null);
    expect(result).toContain('Important trail news');
    expect(result).not.toContain('Footer content');
  });

  it('should fall back to plain text when no HTML', () => {
    const result = extractContentFromEmail(null, 'Plain text newsletter content');
    expect(result).toBe('Plain text newsletter content');
  });

  it('should return empty string when no content', () => {
    const result = extractContentFromEmail(null, null);
    expect(result).toBe('');
  });

  it('should collapse excessive whitespace', () => {
    const html = `
      <html>
        <body>
          <p>Line one.</p>
          <br><br><br><br><br>
          <p>Line two.</p>
        </body>
      </html>
    `;

    const result = extractContentFromEmail(html, null);
    // Should not have more than 2 consecutive newlines
    expect(result).not.toMatch(/\n{3,}/);
  });
});
