import { randomUUID } from 'node:crypto';
import { revision, checkRevision } from './revisions.js';
const key=label=>label.normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
export function installItemColumns(db) {
  const migrate=!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='item_columns'").get();
  db.exec('CREATE TABLE IF NOT EXISTS item_columns(id TEXT PRIMARY KEY,shipmentId TEXT NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,label TEXT NOT NULL,nameKey TEXT NOT NULL,UNIQUE(shipmentId,nameKey))');
  if(!db.prepare('PRAGMA table_info(item_columns)').all().some(column=>column.name==='aliases'))db.exec("ALTER TABLE item_columns ADD COLUMN aliases TEXT NOT NULL DEFAULT '[]'");
  if(!db.prepare('PRAGMA table_info(item_columns)').all().some(column=>column.name==='position'))db.exec('ALTER TABLE item_columns ADD COLUMN position INTEGER NOT NULL DEFAULT 0');
  db.exec('UPDATE item_columns SET position=rowid WHERE position=0');
  for(const entry of db.prepare('SELECT id,changes FROM edit_history ORDER BY sequence').all()){
    const changes=JSON.parse(entry.changes);let changed=false;
    for(const change of changes)if(change.table==='item_columns')for(const side of ['before','after'])if(change[side]){
      const row=change[side];if(row.aliases===undefined){row.aliases='[]';changed=true;}
      if(row.position===undefined){row.position=db.prepare('SELECT position FROM item_columns WHERE id=?').get(row.id)?.position||1;changed=true;}
    }
    if(changed)db.prepare('UPDATE edit_history SET changes=? WHERE id=?').run(JSON.stringify(changes),entry.id);
  }
  const columns=id=>db.prepare('SELECT label FROM item_columns WHERE shipmentId=? ORDER BY position,id').all(id).map(row=>row.label);
  function add(id,fields) {
    const existing=columns(id),names=new Set(existing.map(key));
    for(const field of fields)if(!names.has(key(field.label))){
      if(names.size>=12)throw Object.assign(new Error('Use up to 12 extra columns per shipment.'),{status:400});
      db.prepare('INSERT INTO item_columns(id,shipmentId,label,nameKey,position) VALUES(?,?,?,?,?)').run(randomUUID(),id,field.label,key(field.label),(db.prepare('SELECT COALESCE(MAX(position),0)+1 AS n FROM item_columns WHERE shipmentId=?').get(id)).n);names.add(key(field.label));
    }
  }
  // Keep all existing field values; establish the shared columns once for existing shipments.
  db.exec('SAVEPOINT migrate_item_columns');
  try{if(migrate)for(const row of db.prepare('SELECT shipmentId,extraFields FROM items ORDER BY createdOrder,rowid').all()){
    // Legacy shipments may already contain more than twelve distinct labels.
    for(const field of JSON.parse(row.extraFields||'[]'))db.prepare('INSERT OR IGNORE INTO item_columns(id,shipmentId,label,nameKey,position) VALUES(?,?,?,?,?)').run(randomUUID(),row.shipmentId,field.label,key(field.label),(db.prepare('SELECT COALESCE(MAX(position),0)+1 AS n FROM item_columns WHERE shipmentId=?').get(row.shipmentId)).n);
  }db.exec('RELEASE migrate_item_columns');}catch(error){db.exec('ROLLBACK TO migrate_item_columns; RELEASE migrate_item_columns');throw error;}
  const version=id=>revision({columns:columns(id),items:db.prepare('SELECT id,extraFields FROM items WHERE shipmentId=? ORDER BY id').all(id)});
  function check(body,id){if(typeof body.revision!=='string')throw Object.assign(new Error('Refresh the shipment before changing columns.'),{status:409});checkRevision(body,version(id));}
  function remove(id,body) {
    check(body,id);
    if(typeof body.label!=='string'||body.confirmLabel!==body.label)throw Object.assign(new Error('Confirm the column name to delete it.'),{status:400});
    const column=db.prepare('SELECT * FROM item_columns WHERE shipmentId=? AND nameKey=?').get(id,key(body.label));
    if(!column)throw Object.assign(new Error('Column not found.'),{status:404});
    const update=db.prepare('UPDATE items SET extraFields=? WHERE id=?');
    for(const item of db.prepare('SELECT id,extraFields FROM items WHERE shipmentId=?').all(id)){
      const fields=JSON.parse(item.extraFields||'[]').filter(field=>![column.nameKey,...JSON.parse(column.aliases)].includes(key(field.label)));
      if(JSON.stringify(fields)!==item.extraFields)update.run(JSON.stringify(fields),item.id);
    }
    db.prepare('DELETE FROM item_columns WHERE id=?').run(column.id);
  }
  function rename(id,body){
    check(body,id);
    if(typeof body.label!=='string'||typeof body.name!=='string'||!body.name.trim()||body.name.trim().length>80)throw Object.assign(new Error('Enter a column name of up to 80 characters.'),{status:400});
    const column=db.prepare('SELECT * FROM item_columns WHERE shipmentId=? AND nameKey=?').get(id,key(body.label));
    if(!column)throw Object.assign(new Error('Column not found.'),{status:404});
    const name=body.name.trim(),nameKey=key(name);
    if(db.prepare('SELECT id FROM item_columns WHERE shipmentId=? AND nameKey=? AND id<>?').get(id,nameKey,column.id))throw Object.assign(new Error('A column with this name already exists.'),{status:400});
    const aliases=[...new Set([...JSON.parse(column.aliases),column.nameKey])].filter(value=>value!==nameKey);
    const update=db.prepare('UPDATE items SET extraFields=? WHERE id=?');
    for(const item of db.prepare('SELECT id,extraFields FROM items WHERE shipmentId=?').all(id)){
      const fields=JSON.parse(item.extraFields||'[]').map(field=>[column.nameKey,...aliases].includes(key(field.label))?{...field,label:name}:field);
      if(JSON.stringify(fields)!==item.extraFields)update.run(JSON.stringify(fields),item.id);
    }
    db.prepare('UPDATE item_columns SET label=?,nameKey=?,aliases=? WHERE id=?').run(name,nameKey,JSON.stringify(aliases),column.id);
  }
  return {columns,add,version,remove,rename};
}
export function sharedItemFields(db,row) {
  const values=new Map(JSON.parse(row.extraFields||'[]').map(field=>[key(field.label),field.value]));
  return db.prepare('SELECT label,aliases FROM item_columns WHERE shipmentId=? ORDER BY position,id').all(row.shipmentId).map(({label,aliases})=>({label,value:values.get(key(label))??JSON.parse(aliases).map(alias=>values.get(alias)).find(value=>value!==undefined)??''}));
}
