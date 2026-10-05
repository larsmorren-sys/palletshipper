import { formatDate } from '../shared/dates.js';
import React, { useState } from 'react';
import { stages } from '../shared/tracking.js';

const collator = new Intl.Collator('nl-BE', { numeric: true, sensitivity: 'base' });
const normalize = value => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

export function PalletOverview({ pallets, items, columns, onColumnChange, busy, loading, onStatusChange, onEdit, onDelete, onAdd, onOpen }) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const visibleStages = stages.filter(([key]) => columns[key]);
  const activeStage = stages.find(([key]) => !pallets.length || pallets.some(p => !p.statuses[key]));
  const currentStage = activeStage || stages[stages.length - 1];
  const completed = pallets.filter(p => p.statuses[currentStage[0]]).length;
  const progressLabels = {
    outWarehouse: ['geladen', 'nog te laden'],
    inLocation: ['op locatie aangekomen', 'nog op locatie te ontvangen'],
    outLocation: ['van locatie vertrokken', 'nog van locatie te vertrekken'],
    inWarehouse: ['terug in warehouse', 'nog terug te ontvangen'],
  };
  const [doneLabel, pendingLabel] = progressLabels[currentStage[0]];
  const filtered = pallets.filter(p => normalize(p.name).includes(normalize(search.trim())) && (filter === 'all' || (filter === 'loaded' ? !!p.statuses.outWarehouse : !p.statuses.outWarehouse))).sort((a, b) => collator.compare(a.name, b.name));
  return <section className="materials-panel pallet-overview">
    <div className="materials-heading"><div><h2>Palletoverzicht <span className="count-badge">{pallets.length}</span></h2><p>Vink Out warehouse aan wanneer de pallet in de camion geladen is. Objecttracking blijft afzonderlijk.</p></div><button className="primary" disabled={busy} onClick={onAdd}>Palletten toevoegen</button></div>
    <p className="pallet-loading-summary" role="status">{!activeStage ? `Alle vier trackingstappen voltooid · ${pallets.length} van ${pallets.length} palletten terug in warehouse` : `${currentStage[1]} · ${completed} van ${pallets.length} palletten ${doneLabel} · ${pallets.length - completed} ${pendingLabel}`}</p>
    <div className="table-toolbar"><input className="search" type="search" aria-label="Palletten zoeken" placeholder="Zoek een pallet…" value={search} onChange={e => setSearch(e.target.value)}/><label className="sort-controls">Lading<select aria-label="Palletten filteren" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">Alle palletten</option><option value="pending">Nog te laden</option><option value="loaded">Geladen</option></select></label><details className="column-picker"><summary>Trackingkolommen</summary><div>{stages.map(([key, label]) => <label key={key}><input type="checkbox" checked={columns[key]} disabled={busy} onChange={e => onColumnChange(key, e.target.checked)}/>{label}</label>)}<small>Jouw palletweergave voor deze shipment</small></div></details></div>
    <div className="table-scroll"><table><thead><tr><th>Pallet</th><th>Objecten</th>{visibleStages.map(([key, label]) => <th className="status-column" key={key}>{label}</th>)}<th>Acties</th></tr></thead><tbody>{filtered.map(p => <tr key={p.id}><td><div className="object-name">{p.name}</div><div className="object-meta">{p.photos.length} foto’s</div></td><td>{items.filter(i => i.palletId === p.id).length}</td>{visibleStages.map(([key, label]) => <td className="status-cell" key={key}><label title={p.statuses[key] ? formatDate(p.statuses[key]) : label}><input type="checkbox" checked={!!p.statuses[key]} disabled={busy} aria-label={`${label}: ${p.name}`} onChange={e => onStatusChange(p.id, { status: key, checked: e.target.checked })}/>{p.statuses[key] && <small>{formatDate(p.statuses[key])}</small>}</label></td>)}<td><div className="object-actions"><button className="secondary" aria-label={`Inhoud bekijken: ${p.name}`} onClick={() => onOpen(p.id)}>Inhoud bekijken</button><button className="secondary" disabled={busy} aria-label={`Hernoemen: ${p.name}`} onClick={() => onEdit(p)}>Hernoemen</button><button className="delete-button" disabled={busy} aria-label={`Verwijderen: ${p.name}`} onClick={() => onDelete(p)}>Verwijderen</button></div></td></tr>)}</tbody></table></div>
    {!filtered.length && <div className="empty-table"><h3>{loading ? 'Palletten laden…' : !pallets.length ? 'Nog geen palletten' : 'Geen palletten gevonden'}</h3><p>{!pallets.length ? 'Voeg palletten toe om de lading op te volgen.' : 'Pas je zoekterm of laadfilter aan.'}</p></div>}
    <div className="table-footer"><span>{filtered.length} palletten zichtbaar</span><span>Elke palletcheckbox wordt automatisch opgeslagen, los van de objecten.</span></div>
  </section>;
}
