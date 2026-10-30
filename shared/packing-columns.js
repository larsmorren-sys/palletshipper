import { stages } from './tracking.js';
export function packingColumns(extraLabels=[]) {
  return [
    {id:'item',label:'Item'}, {id:'code',label:'Item code'},
    {id:'quantity',label:'Quantity'}, {id:'note',label:'Note'},
    {id:'type',label:'Unit type'},
    ...extraLabels.map(label=>({id:`extra:${label}`,label})),
    ...stages.map(([key,label])=>({id:`tracking:${key}`,label})),
  ];
}
