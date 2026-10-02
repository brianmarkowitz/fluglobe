import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesSearch, sortRecords, recordsToCsv } from '../src/explorer.js';
const rows = [
  { country: 'Japan', virus: 'H5N1', type: 'wild', date: '2024-12', cases: 4 },
  { country: 'France', virus: 'H5N5', type: 'poultry', date: '2025-01', cases: 20 }
];
test('search matches all words across fields and ignores case', () => {
  assert.ok(matchesSearch(rows[0], ' JAPAN h5n1 '));
  assert.ok(matchesSearch(rows[0], ''));
  assert.equal(matchesSearch(rows[0], 'Japan poultry'), false);
});
test('sorts dates, numeric counts and locations without mutating input', () => {
  for (const sort of ['recent', 'count', 'location']) assert.equal(sortRecords(rows, sort)[0].country, 'France');
  assert.equal(rows[0].country, 'Japan');
});
test('CSV preserves quoting and marks sample data while escaping spreadsheet formulas', () => {
  const csv = recordsToCsv([{ country: '=SUM(1,2)', source: 'A "quoted" source\nnext' }], true);
  assert.ok(csv.includes('"\'=SUM(1,2)"'));
  assert.ok(csv.includes('"A ""quoted"" source\nnext"'));
  assert.ok(csv.includes('"Sample dataset"'));
});
