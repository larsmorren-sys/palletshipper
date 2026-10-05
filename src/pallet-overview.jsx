import { formatDate } from '../shared/dates.js';
import React, { useState } from 'react';
import { stages } from '../shared/tracking.js';

const collator = new Intl.Collator('en-GB', { numeric: true, sensitivity: 'base' });
const normalize = value => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

export function PalletOverview({ pallets, items, columns, onColumnChange, busy, loading, onStatusChange, onEdit, onDelete, onAdd, onOpen }) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const visibleStages = stages.filter(([key]) => columns[key]);
  const activeStage = stages.find(([key]) => !pallets.length || pallets.some(p => !p.statuses[key]));
  const currentStage = activeStage || stages[stages.length - 1];
  const completed = pallets.filter(p => p.statuses[currentStage[0]]).length;
  const progressLabels = {
    outWarehouse: ['loaded', 'still to load'],
    inLocation: ['arrived at location', 'still to receive at location'],
    outLocation: ['departed from location', 'still to depart from location'],
    inWarehouse: ['back in warehouse', 'still to receive back'],
  };
  const [doneLabel, pendingLabel] = progressLabels[currentStage[0]];
  const filtered = pallets.filter(p => normalize(p.name).includes(normalize(search.trim())) && (filter === 'all' || (filter === 'loaded' ? !!p.statuses.outWarehouse : !p.statuses.outWarehouse))).sort((a, b) => collator.compare(a.name, b.name));
  return <section className="materials-panel pallet-overview">
    <div className="materials-heading"><div><h2>Pallet overview <span className="count-badge">{pallets.length}</span></h2><p>Check Out warehouse when a pallet has been loaded onto the truck. Item tracking remains independent.</p></div><button className="primary" disabled={busy} onClick={onAdd}>Add pallets</button></div>
    <p className="pallet-loading-summary" role="status">{!activeStage ? `All four tracking stages completed · ${pallets.length} of ${pallets.length} pallets back in warehouse` : `${currentStage[1]} · ${completed} of ${pallets.length} pallets ${doneLabel} · ${pallets.length - completed} ${pendingLabel}`}</p>
    <div className="table-toolbar"><input className="search" type="search" aria-label="Search pallets" placeholder="Search for a pallet…" value={search} onChange={e => setSearch(e.target.value)}/><label className="sort-controls">Loading<select aria-label="Filter pallets" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All pallets</option><option value="pending">Not loaded yet</option><option value="loaded">Loaded</option></select></label><details className="column-picker"><summary>Tracking columns</summary><div>{stages.map(([key, label]) => <label key={key}><input type="checkbox" checked={columns[key]} disabled={busy} onChange={e => onColumnChange(key, e.target.checked)}/>{label}</label>)}<small>Your pallet view for this shipment</small></div></details></div>
    <div className="table-scroll"><table><thead><tr><th>Pallet</th><th>Items</th>{visibleStages.map(([key, label]) => <th className="status-column" key={key}>{label}</th>)}<th>Actions</th></tr></thead><tbody>{filtered.map(p => <tr key={p.id}><td><div className="object-name">{p.name}</div><div className="object-meta">{p.photos.length} photos</div></td><td>{items.filter(i => i.palletId === p.id).length}</td>{visibleStages.map(([key, label]) => <td className="status-cell" key={key}><label title={p.statuses[key] ? formatDate(p.statuses[key]) : label}><input type="checkbox" checked={!!p.statuses[key]} disabled={busy} aria-label={`${label}: ${p.name}`} onChange={e => onStatusChange(p.id, { status: key, checked: e.target.checked })}/>{p.statuses[key] && <small>{formatDate(p.statuses[key])}</small>}</label></td>)}<td><div className="object-actions"><button className="secondary" aria-label={`View contents: ${p.name}`} onClick={() => onOpen(p.id)}>View contents</button><button className="secondary" disabled={busy} aria-label={`Rename: ${p.name}`} onClick={() => onEdit(p)}>Rename</button><button className="delete-button" disabled={busy} aria-label={`Delete: ${p.name}`} onClick={() => onDelete(p)}>Delete</button></div></td></tr>)}</tbody></table></div>
    {!filtered.length && <div className="empty-table"><h3>{loading ? 'Loading pallets…' : !pallets.length ? 'No pallets yet' : 'No pallets found'}</h3><p>{!pallets.length ? 'Add pallets to track the load.' : 'Adjust your search or loading filter.'}</p></div>}
    <div className="table-footer"><span>{filtered.length} pallets visible</span><span>Each pallet checkbox is saved automatically, independently of items.</span></div>
  </section>;
}
