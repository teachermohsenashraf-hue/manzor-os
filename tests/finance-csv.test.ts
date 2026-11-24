import test from 'node:test';
import assert from 'node:assert/strict';
import { safeCsvCell, csvDocument } from '../src/lib/csv';

test('CSV export quotes fields and neutralizes spreadsheet formulas', () => {
  assert.equal(safeCsvCell('=HYPERLINK("https://bad")'), '"\'=HYPERLINK(""https://bad"")"');
  assert.equal(safeCsvCell('  +SUM(1,2)'), '"\'  +SUM(1,2)"');
  assert.equal(safeCsvCell('normal\nname'), '"normal name"');
  assert.ok(csvDocument([['name'],['test']]).startsWith('\uFEFF'));
});
