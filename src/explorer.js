export function matchesSearch(row, query) {
  const text = [row.country, row.virus, row.type, row.source, row.date].join(' ').toLowerCase();
  return query.toLowerCase().trim().split(/\s+/).every(term => text.includes(term));
}

export function sortRecords(rows, sort) {
  return [...rows].sort((a, b) => {
    if (sort === 'location') return String(a.country).localeCompare(String(b.country));
    if (sort === 'count') return (Number(b.cases) || 0) - (Number(a.cases) || 0);
    return (Date.parse(b.timestamp || b.date) || 0) - (Date.parse(a.timestamp || a.date) || 0);
  });
}

export function recordsToCsv(rows, sample) {
  const fields = ['country', 'date', 'virus', 'type', 'cases', 'severity', 'source', 'lat', 'lng'];
  const escape = value => {
    let text = String(value ?? '');
    if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return '\uFEFF' + [
    [...fields, 'dataset'].join(','),
    ...rows.map(row => [...fields.map(key => row[key]), sample ? 'Sample dataset' : 'Downloaded source data'].map(escape).join(','))
  ].join('\r\n');
}
