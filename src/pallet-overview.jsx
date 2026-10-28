import { unitTypes,unitTypeLabel } from '../shared/transport-units.js';
import { InlinePalletName, PalletPicker } from './editing.jsx';
import { formatDate } from '../shared/dates.js';
import React, { useState } from 'react';
import { stages } from '../shared/tracking.js';

const collator = new Intl.Collator('en-GB', { numeric: true, sensitivity: 'base' });
const normalize = value => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

export function PalletOverview({ pallets, items, columns, onColumnChange, busy, loading, onStatusChange, onEdit, onDelete, onAdd, onOpen, editMode, archived, hasDirty, onSave, onDirty, onBulk }) {
  const [selected,setSelected]=useState([]),[moving,setMoving]=useState(false);
  const [search, setSearch] = useState('');
  const [typeFilter,setTypeFilter]=useState('all');
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
  const filtered = pallets.filter(p => (typeFilter==='all'||p.type===typeFilter)&&normalize(`${p.name} ${unitTypeLabel(p)}`).includes(normalize(search.trim())) && (filter === 'all' || (filter === 'loaded' ? !!p.statuses.outWarehouse : !p.statuses.outWarehouse))).sort((a, b) => collator.compare(a.name, b.name));
  const available=selected.filter(id=>filtered.some(p=>p.id===id));
  const all=filtered.length>0&&filtered.every(p=>available.includes(p.id));
  async function bulk(operation,palletId=null){
    if(operation==='delete'&&!window.confirm(`Delete ${available.length} pallets? Their items move to Unassigned. ${archived?"Photos and unit tracking are permanently deleted.":"Undo can restore the units, photos and tracking."}`))return;
    const result=await onBulk(operation,available.map(id=>{const p=pallets.find(p=>p.id===id);return{id,revision:p.revision};}),palletId);
    if(result!==false){setSelected([]);setMoving(false);}
  }
  return <section className="materials-panel pallet-overview">
    <div className="materials-heading"><div><h2>Transport overview <span className="count-badge">{pallets.length}</span></h2><p>Check Out warehouse when a transport unit has been loaded onto the truck. Item tracking remains independent.</p></div><button className="primary" disabled={busy||hasDirty} onClick={onAdd}>Add transport units</button></div>
    <p className="pallet-loading-summary" role="status">{!activeStage ? `All four tracking stages completed · ${pallets.length} of ${pallets.length} units back in warehouse` : `${currentStage[1]} · ${completed} of ${pallets.length} units ${doneLabel} · ${pallets.length - completed} ${pendingLabel}`}</p>
    <div className="table-toolbar"><input className="search" type="search" aria-label="Search transport units" disabled={hasDirty} placeholder="Search for a transport unit…" value={search} onChange={e => setSearch(e.target.value)}/><label className="sort-controls">Type<select aria-label="Filter unit type" value={typeFilter} disabled={hasDirty} onChange={e=>setTypeFilter(e.target.value)}><option value="all">All types</option>{unitTypes.map(([type,label])=><option key={type} value={type}>{label}</option>)}</select></label><label className="sort-controls">Loading<select aria-label="Filter transport units" disabled={hasDirty} value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All units</option><option value="pending">Not loaded yet</option><option value="loaded">Loaded</option></select></label><details className="column-picker"><summary>Tracking columns</summary><div>{stages.map(([key, label]) => <label key={key}><input type="checkbox" checked={columns[key]} disabled={busy||hasDirty} onChange={e => onColumnChange(key, e.target.checked)}/>{label}</label>)}<small>Your unit view for this shipment</small></div></details></div>
    {editMode&&<div className="bulk-toolbar"><strong>{available.length} selected</strong><button className="secondary" disabled={busy||!filtered.length} onClick={()=>setSelected(all?[]:filtered.map(p=>p.id))}>{all?'Deselect all':'Select all visible'}</button><button className="secondary" disabled={busy||!available.length} onClick={()=>setMoving(v=>!v)}>Move contents to unit…</button><button className="delete-button" disabled={busy||!available.length} onClick={()=>bulk('delete')}>Delete selected units</button><small>Items stay intact when deleting units.</small></div>}
    {editMode&&moving&&<section className="move-panel"><strong>Move the contents; keep the source units</strong><PalletPicker pallets={pallets} exclude={available} disabled={busy||!available.length} onPick={id=>bulk('assign',id)}/></section>}
    <div className="table-scroll"><table><thead><tr>{editMode&&<th className="selection-column"><input type="checkbox" aria-label="Select all visible units" checked={all} disabled={busy||!filtered.length} onChange={()=>setSelected(all?[]:filtered.map(p=>p.id))}/></th>}<th>Transport unit</th><th>Items</th>{visibleStages.map(([key, label]) => <th className="status-column" key={key}>{label}</th>)}<th>Actions</th></tr></thead><tbody>{filtered.map(p => <tr key={p.id} className={editMode&&available.includes(p.id)?"selected-row":""}>{editMode&&<td className="selection-column"><input type="checkbox" aria-label={`Select: ${p.name}`} checked={available.includes(p.id)} disabled={busy||hasDirty} onChange={e=>setSelected(ids=>e.target.checked?[...ids,p.id]:ids.filter(id=>id!==p.id))}/></td>}<td>{editMode?<InlinePalletName pallet={p} disabled={busy} onSave={onSave} onDirty={onDirty}/>:<div className="object-name">{p.name}</div>}<div className="object-meta">{unitTypeLabel(p)} · {p.photos.length} photos</div></td><td>{items.filter(i => i.palletId === p.id).length}</td>{visibleStages.map(([key, label]) => <td className="status-cell" key={key}><label title={p.statuses[key] ? formatDate(p.statuses[key]) : label}><input type="checkbox" checked={!!p.statuses[key]} disabled={busy||hasDirty} aria-label={`${label}: ${p.name}`} onChange={e => onStatusChange(p.id, { status: key, checked: e.target.checked })}/>{p.statuses[key] && <small>{formatDate(p.statuses[key])}</small>}</label></td>)}<td><div className="object-actions"><button className="secondary" disabled={hasDirty} aria-label={`View contents: ${p.name}`} onClick={() => onOpen(p.id)}>View contents</button><button className="secondary" disabled={busy||hasDirty} aria-label={`Edit: ${p.name}`} onClick={() => onEdit(p)}>Edit</button><button className="delete-button" disabled={busy||hasDirty} aria-label={`Delete: ${p.name}`} onClick={() => onDelete(p)}>Delete</button></div></td></tr>)}</tbody></table></div>
    {!filtered.length && <div className="empty-table"><h3>{loading ? 'Loading transport units…' : !pallets.length ? 'No transport units yet' : 'No transport units found'}</h3><p>{!pallets.length ? 'Add transport units to track the load.' : 'Adjust your search or loading filter.'}</p></div>}
    <div className="table-footer"><span>{filtered.length} units visible</span><span>Each unit checkbox is saved automatically, independently of items.</span></div>
  </section>;
}
