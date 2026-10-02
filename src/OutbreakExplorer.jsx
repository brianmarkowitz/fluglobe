import React, { useState, useMemo, useEffect } from 'react';
import { recordsToCsv, sortRecords } from './explorer.js';

export default function OutbreakExplorer({ rows, sample, onFocus, onReset, selected }) {
  const [sort, setSort] = useState('recent');
  const [page, setPage] = useState(0);
  const sorted = useMemo(() => sortRecords(rows, sort), [rows, sort]);
  useEffect(() => setPage(0), [rows, sort]);
  const lastPage = Math.max(0, Math.ceil(rows.length / 10) - 1);
  const currentPage = Math.min(page, lastPage);
  const exportCsv = () => {
    const url = URL.createObjectURL(new Blob([recordsToCsv(sorted, sample)], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `fluglobe-${sample ? 'sample' : 'source'}-records.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <section className="explorer" aria-labelledby="explorer-title">
    <div className="section-heading">
      <div><span className="eyebrow">EXPLORE THE DATA</span><h2 id="explorer-title">Outbreak records <span className="count-pill">{rows.length}</span></h2></div>
      <div className="explorer-actions"><label>Sort by <select value={sort} onChange={e => setSort(e.target.value)}><option value="recent">Most recent</option><option value="location">Location A–Z</option><option value="count">Reported count</option></select></label><button disabled={!rows.length} onClick={exportCsv}>↓ Export CSV</button></div>
    </div>
    <p className="muted">Select a location to inspect it on the globe. Counts use source-specific units and should not be compared across hosts.</p>
    {rows.length ? <div className="table-scroll"><table><thead><tr><th>Location</th><th>Report date</th><th>Strain</th><th>Host</th><th className="numeric">Reported count</th><th>Source</th></tr></thead><tbody>
      {sorted.slice(currentPage * 10, currentPage * 10 + 10).map(row => <tr key={row.id} className={selected?.id === row.id ? 'selected-row' : ''}>
        <td><button className="location-link" onClick={() => onFocus(row)}>{row.country} <span aria-hidden="true">↗</span></button></td><td>{row.date}</td><td><span className="strain-tag">{row.virus}</span></td><td className="host-cell">{row.type}</td><td className="numeric">{Number(row.cases || 0).toLocaleString()}</td><td className="source-cell">{row.source || (sample ? 'Sample dataset' : 'Unavailable')}</td>
      </tr>)}
    </tbody></table></div> : <div className="empty-state"><h3>No matching records</h3><p>Try another location, strain, or date range.</p><button onClick={onReset}>Clear all filters</button></div>}
    {rows.length > 0 && <div className="pagination"><span>{currentPage * 10 + 1}–{Math.min((currentPage + 1) * 10, rows.length)} of {rows.length} records</span><div><button disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>← Previous</button><button disabled={currentPage === lastPage} onClick={() => setPage(currentPage + 1)}>Next →</button></div></div>}
  </section>;
}
