import React from 'react';
import { unitTypes } from '../shared/transport-units.js';

export function UnitTypeFields({ value, onChange, disabled }) {
  return <div className="unit-type-fields"><label>Unit type<select name="type" aria-label="Unit type" value={value.type || 'pallet'} disabled={disabled} onChange={e=>onChange({...value,type:e.target.value,otherType:e.target.value==='other'?value.otherType||'':''})}>{unitTypes.map(([type,label])=><option key={type} value={type}>{label}</option>)}</select></label>{value.type==='other'&&<label>Specify type<input name="otherType" aria-label="Specify unit type" maxLength={80} required value={value.otherType||''} disabled={disabled} placeholder="e.g. Trunk or trolley" onChange={e=>onChange({...value,otherType:e.target.value})}/></label>}</div>;
}
