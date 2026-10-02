export function monthlyCounts(rows) {
  const counts = {};
  for (const row of rows) {
    const month = String(row.date || '').slice(0, 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) continue;
    counts[month] = (counts[month] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}
