import React, { useState } from 'react';
import { packingColumns } from '../shared/packing-columns.js';

export function PackingListExport({ shipmentId, extraLabels, tracking }) {
  const options=packingColumns(extraLabels);
  const [selected,setSelected]=useState(()=>options.filter(column=>!column.id.startsWith('tracking:')||tracking[column.id.slice(9)]).map(column=>column.id));
  const url=`/api/shipments/${shipmentId}/export?format=print&columns=${encodeURIComponent(JSON.stringify(selected))}`;
  return <section className="packing-export"><fieldset><legend>Packing list / PDF columns</legend>
    <p className="form-hint">Choose the columns to include in every packing list. Shipment and transport-unit names stay in the page heading.</p>
    <div className="packing-column-actions"><button type="button" className="secondary" onClick={()=>setSelected(options.map(column=>column.id))}>Select all</button><button type="button" className="secondary" onClick={()=>setSelected([])}>Clear selection</button></div>
    <div className="packing-column-options">{options.map(column=><label key={column.id}><input type="checkbox" checked={selected.includes(column.id)} onChange={event=>setSelected(current=>event.target.checked?[...current,column.id]:current.filter(id=>id!==column.id))}/>{column.label}</label>)}</div>
    {!selected.length&&<p className="form-error" role="status">Select at least one column.</p>}
    </fieldset>{selected.length?<a className="button secondary" target="_blank" rel="noreferrer" href={url}>All packing lists / PDF</a>:<button className="secondary" disabled>All packing lists / PDF</button>}
  </section>;
}
