import { randomUUID } from 'node:crypto';
const key=label=>label.normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
export function installItemColumns(db) {
  db.exec('CREATE TABLE IF NOT EXISTS item_columns(id TEXT PRIMARY KEY,shipmentId TEXT NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,label TEXT NOT NULL,nameKey TEXT NOT NULL,UNIQUE(shipmentId,nameKey))');
  const columns=id=>db.prepare('SELECT label FROM item_columns WHERE shipmentId=? ORDER BY rowid').all(id).map(row=>row.label);
  function add(id,fields) {
    const existing=columns(id),names=new Set(existing.map(key));
    for(const field of fields)if(!names.has(key(field.label))){
      if(names.size>=12)throw Object.assign(new Error('Use up to 12 extra columns per shipment.'),{status:400});
      db.prepare('INSERT INTO item_columns VALUES(?,?,?,?)').run(randomUUID(),id,field.label,key(field.label));names.add(key(field.label));
    }
  }
  // Keep all existing field values; establish the shared columns once for existing shipments.
  db.exec('SAVEPOINT migrate_item_columns');
  try{for(const row of db.prepare('SELECT shipmentId,extraFields FROM items ORDER BY createdOrder,rowid').all()){
    // Legacy shipments may already contain more than twelve distinct labels.
    for(const field of JSON.parse(row.extraFields||'[]'))db.prepare('INSERT OR IGNORE INTO item_columns VALUES(?,?,?,?)').run(randomUUID(),row.shipmentId,field.label,key(field.label));
  }db.exec('RELEASE migrate_item_columns');}catch(error){db.exec('ROLLBACK TO migrate_item_columns; RELEASE migrate_item_columns');throw error;}
  return {columns,add};
}
export function sharedItemFields(db,row) {
  const values=new Map(JSON.parse(row.extraFields||'[]').map(field=>[key(field.label),field.value]));
  return db.prepare('SELECT label FROM item_columns WHERE shipmentId=? ORDER BY rowid').all(row.shipmentId).map(({label})=>({label,value:values.get(key(label))||''}));
}
