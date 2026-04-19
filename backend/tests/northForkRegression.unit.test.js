/**
 * North Fork Trail Regression Tests
 *
 * Bug 1: collectNewsForPoi returns { news: [], events: [] } without metadata
 *        when AI response contains no JSON. The caller destructures metadata
 *        and reads metadata.usedDedicatedNewsUrl, causing TypeError.
 *
 * Bug 2: PUT /api/admin/linear-features/:id RETURNING clause references
 *        non-existent 'era' column instead of 'era_id', causing every
 *        linear feature save to fail with a PostgreSQL error.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('North Fork Trail Regression Tests', () => {

  describe('Bug 1: collectPoi metadata contract', () => {
    it('should include metadata in all return paths of collectPoi', () => {
      // Read the source file and find all return statements within collectPoi
      const source = readFileSync(
        join(__dirname, '..', 'services', 'newsService.js'),
        'utf-8'
      );

      // Find the function boundaries
      const fnStart = source.indexOf('export async function collectPoi(');
      expect(fnStart).toBeGreaterThan(-1);

      // Find the next export function after collectPoi to bound the search
      const fnBody = source.slice(fnStart);
      const nextExport = fnBody.indexOf('\nexport ', 1);
      const fnText = nextExport > 0 ? fnBody.slice(0, nextExport) : fnBody;

      // Find all return statements that return objects with news/events
      const returnPattern = /return\s*\{[^}]*news\s*:/g;
      const returns = [...fnText.matchAll(returnPattern)];

      expect(returns.length).toBeGreaterThan(0);

      // Every return that includes news should also include metadata
      for (const match of returns) {
        // Get enough context around the return to check for metadata
        const returnStart = match.index;
        // Find the matching closing brace (handle nested objects)
        let depth = 0;
        let i = fnText.indexOf('{', returnStart);
        const braceStart = i;
        for (; i < fnText.length; i++) {
          if (fnText[i] === '{') depth++;
          if (fnText[i] === '}') depth--;
          if (depth === 0) break;
        }
        const returnObj = fnText.slice(braceStart, i + 1);

        expect(returnObj).toContain('metadata');
      }
    });
  });

  describe('Bug 2: linear-features RETURNING clause schema alignment', () => {
    it('should not reference non-existent era column in admin routes', () => {
      const source = readFileSync(
        join(__dirname, '..', 'routes', 'admin.js'),
        'utf-8'
      );

      // Find all RETURNING clauses
      const returningPattern = /RETURNING\s+[\s\S]*?(?=\s*\`|\s*\'\s*,)/g;
      const matches = [...source.matchAll(returningPattern)];

      for (const match of matches) {
        const clause = match[0];
        // Split into individual column references
        const columns = clause.replace('RETURNING', '').split(',').map(c => c.trim());

        // 'era' is not a column in pois — only 'era_id' exists
        // Allow 'era_id', 'era_name', etc. but not bare 'era'
        const bareEra = columns.find(c => c === 'era');
        expect(bareEra).toBeUndefined();
      }
    });

    it('should use era_id (not era) in allowedFields for linear features', () => {
      const source = readFileSync(
        join(__dirname, '..', 'routes', 'admin.js'),
        'utf-8'
      );

      // Find the allowedFields array in the PUT linear-features handler
      const putHandler = source.indexOf("router.put('/linear-features/:id'");
      expect(putHandler).toBeGreaterThan(-1);

      const handlerBody = source.slice(putHandler, putHandler + 500);
      const allowedFieldsMatch = handlerBody.match(/allowedFields\s*=\s*\[([\s\S]*?)\]/);
      expect(allowedFieldsMatch).not.toBeNull();

      const fields = allowedFieldsMatch[1];
      // Should contain era_id, not bare 'era'
      expect(fields).toContain('era_id');
      // Should not have 'era' as a standalone field (but 'era_id' is fine)
      const fieldList = fields.match(/'([^']+)'/g).map(f => f.replace(/'/g, ''));
      expect(fieldList).not.toContain('era');
      expect(fieldList).toContain('era_id');
    });
  });
});
