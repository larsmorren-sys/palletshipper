import React, { useState } from 'react';

export function ItemExtraFields({ initialFields = [], disabled }) {
  const [fields,setFields]=useState(()=>initialFields.map(field=>({...field})));
  const change=(index,key,value)=>setFields(current=>current.map((field,i)=>i===index?{...field,[key]:value}:field));
  return <section className="manual-extra-fields" aria-label="Extra columns">
    <input type="hidden" name="extraFields" value={JSON.stringify(fields)}/>
    {fields.map((field,index)=><div className="manual-extra-row" key={index}>
      <label>Column name<input aria-label={`Extra column ${index+1} name`} required pattern={'.*\\S.*'} maxLength={80} value={field.label} disabled={disabled} onChange={e=>change(index,'label',e.target.value)}/></label>
      <label>Value<input aria-label={`Extra column ${index+1} value`} maxLength={1000} value={field.value} disabled={disabled} onChange={e=>change(index,'value',e.target.value)}/></label>
      <button type="button" className="delete-button" aria-label={`Remove extra column ${index+1}`} disabled={disabled} onClick={()=>setFields(current=>current.filter((_,i)=>i!==index))}>Remove</button>
    </div>)}
    <button type="button" className="secondary" disabled={disabled||fields.length>=12} onClick={()=>setFields(current=>[...current,{label:'',value:''}])}>Add column</button>
  </section>;
}
