import { assignmentStatuses } from './assignment-tracking.js';
import { itemDisplayName, itemNameKey } from '../shared/item-names.js';
import { randomUUID } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import path from 'node:path';
import { revision, checkRevision } from './revisions.js';
import { objectNameKey } from '../shared/numbering.js';

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
export function extraFields(value) {
  if (!Array.isArray(value) || value.length > 12) throw fail('Use up to 12 extra columns.');
  return value.map(field => {
    if (!field || typeof field.label !== 'string' || !field.label.trim() || field.label.trim().length > 80 || typeof field.value !== 'string' || field.value.length > 1000) throw fail('Extra columns need a label of up to 80 characters and a value of up to 1000 characters.');
    return { label: field.label.trim(), value: field.value.trim() };
  });
}
export function installEditing(app, db, auth, dataDir, palletView, itemView) {
  for (const [field, type] of [['autoNumbered','INTEGER NOT NULL DEFAULT 1'],['extraFields',"TEXT NOT NULL DEFAULT '[]'"],['createdOrder','INTEGER NOT NULL DEFAULT 0'],['imported','INTEGER NOT NULL DEFAULT 0'],['nameKey',"TEXT NOT NULL DEFAULT ''"]]) {
    if (!db.prepare('PRAGMA table_info(items)').all().some(column => column.name === field)) db.exec(`ALTER TABLE items ADD COLUMN ${field} ${type}`);
  }
  db.exec(`CREATE TABLE IF NOT EXISTS editing_counter(id INTEGER PRIMARY KEY CHECK(id=1), value INTEGER NOT NULL);
    INSERT OR IGNORE INTO editing_counter VALUES(1,0);
    CREATE TABLE IF NOT EXISTS deleted_items(id TEXT PRIMARY KEY, shipmentId TEXT NOT NULL REFERENCES shipments(id) ON DELETE CASCADE, content TEXT NOT NULL, deletedAt TEXT NOT NULL, deletedBy TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS edit_history(sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, shipmentId TEXT NOT NULL REFERENCES shipments(id) ON DELETE CASCADE, userId TEXT NOT NULL REFERENCES users(id), label TEXT NOT NULL, changes TEXT NOT NULL, undone INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX IF NOT EXISTS deleted_items_shipment ON deleted_items(shipmentId);
    CREATE INDEX IF NOT EXISTS edit_history_scope ON edit_history(shipmentId,userId,sequence);`);
  for (const row of db.prepare('SELECT id FROM items WHERE createdOrder=0 ORDER BY rowid').all()) db.prepare('UPDATE items SET createdOrder=? WHERE id=?').run(stamp(),row.id);
  // Establish unique visible names without removing items or changing their identities.
  db.exec('SAVEPOINT item_names');
  try {
    const existing=db.prepare('SELECT * FROM items ORDER BY createdOrder,rowid').all();
    const reserved=new Set(existing.map(row=>JSON.stringify([row.shipmentId,itemNameKey(row)]))),seen=new Set();
    for(const row of existing){
      let candidate=itemDisplayName(row),key=itemNameKey(row),scope=JSON.stringify([row.shipmentId,key]);
      if(seen.has(scope)){
        let suffix=2;
        do { candidate=`${itemDisplayName(row)} (${suffix++})`;key=objectNameKey(candidate);scope=JSON.stringify([row.shipmentId,key]); }while(reserved.has(scope)||seen.has(scope));
        db.prepare('UPDATE items SET name=?,autoNumbered=0,nameKey=? WHERE id=?').run(candidate,key,row.id);
      }else if(row.nameKey!==key)db.prepare('UPDATE items SET nameKey=? WHERE id=?').run(key,row.id);
      seen.add(scope);
    }
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS unique_item_names ON items(shipmentId,nameKey) WHERE nameKey<>''");
    db.exec('RELEASE item_names');
  }catch(error){db.exec('ROLLBACK TO item_names; RELEASE item_names');throw error;}
  function uniqueName(item,status=400){
    const key=itemNameKey(item);
    if(db.prepare('SELECT id FROM items WHERE shipmentId=? AND nameKey=? AND id<>?').get(item.shipmentId,key,item.id||''))throw fail(`An item named “${itemDisplayName(item)}” already exists in this shipment. Choose a unique name.`,status);
    return key;
  }
  // Older undo records predate unit types; preserve their ability to undo/redo pallets.
  for(const entry of db.prepare('SELECT id,changes FROM edit_history').all()){
    const changes=JSON.parse(entry.changes);let migrated=false;
    for(const change of changes)for(const side of ['before','after']){
      const row=change[side];if(!row)continue;
      if(change.table==='pallets'){if(row.type===undefined){row.type='pallet';migrated=true;}if(row.otherType===undefined){row.otherType='';migrated=true;}}
      if(change.table==='items'&&row.nameKey===undefined){row.nameKey=itemNameKey(row);migrated=true;}
    }
    if(migrated)db.prepare('UPDATE edit_history SET changes=? WHERE id=?').run(JSON.stringify(changes),entry.id);
  }
  const tables = ['items','pallets','pallet_checks','pallet_photos'];
  const key = (table,row) => table === 'pallet_checks' ? `${row.palletId}:${row.stage}` : row.id;
  const rows = (table,id) => table === 'items' || table === 'pallets' ? db.prepare(`SELECT * FROM ${table} WHERE shipmentId=?`).all(id) : db.prepare(`SELECT t.* FROM ${table} t JOIN pallets p ON p.id=t.palletId WHERE p.shipmentId=?`).all(id);
  const snapshot = id => Object.fromEntries(tables.map(table=>[table,rows(table,id)]));
  function diff(before,after) {
    return tables.flatMap(table => {
      const old=new Map(before[table].map(row=>[key(table,row),row])), next=new Map(after[table].map(row=>[key(table,row),row]));
      return [...new Set([...old.keys(),...next.keys()])].flatMap(id=>JSON.stringify(old.get(id))===JSON.stringify(next.get(id))?[]:[{table,before:old.get(id)||null,after:next.get(id)||null}]);
    });
  }
  function photoUrls(history) { return history.flatMap(h=>JSON.parse(h.changes).filter(c=>c.table==='pallet_photos').flatMap(c=>[c.before?.url,c.after?.url].filter(Boolean))); }
  function cleanup(urls) {
    if (!urls.length) return;
    const keep=new Set([...db.prepare('SELECT url FROM pallet_photos').all().map(p=>p.url),...photoUrls(db.prepare('SELECT changes FROM edit_history').all())]);
    for (const url of new Set(urls)) if (!keep.has(url)) try { unlinkSync(path.join(dataDir,'uploads',path.basename(url))); } catch(error) { if(error.code!=='ENOENT') console.error('Could not clean up undo photo:',error.code); }
  }
  function purge(id) {
    const urls=photoUrls(db.prepare('SELECT changes FROM edit_history WHERE shipmentId=?').all(id));
    db.prepare('DELETE FROM deleted_items WHERE shipmentId=?').run(id);
    db.prepare('DELETE FROM edit_history WHERE shipmentId=?').run(id);
    cleanup(urls);
  }
  function trash(item,userId) {
    if (!db.prepare('SELECT archivedAt FROM shipments WHERE id=?').get(item.shipmentId)?.archivedAt) db.prepare('INSERT OR REPLACE INTO deleted_items VALUES(?,?,?,?,?)').run(item.id,item.shipmentId,JSON.stringify(item),new Date().toISOString(),userId);
  }
  function prune(id) { db.prepare('DELETE FROM deleted_items WHERE shipmentId=? AND id NOT IN (SELECT id FROM deleted_items WHERE shipmentId=? ORDER BY rowid DESC LIMIT 200)').run(id,id); }
  function stamp() { return db.prepare('UPDATE editing_counter SET value=value+1 WHERE id=1 RETURNING value').get().value; }
  // Synchronous edit routes run in one outer savepoint, including their undo record.
  app.use('/api', (req,res,next)=>{
    const input=req.body||{};
    const match=req.path.match(/^\/shipments\/([^/]+)\/(items|pallets)(?:\/bulk)?$/);
    const entity=req.path.match(/^\/(items|pallets)\/([^/]+)(?:\/duplicate)?$/);
    if (!['POST','PATCH','DELETE'].includes(req.method) || !match && !entity) return next();
    const id=match?.[1] || db.prepare(`SELECT shipmentId FROM ${entity[1]} WHERE id=?`).get(entity[2])?.shipmentId;
    if (!id) return next();
    const shipment=auth.requireShipment(req.user,id);
    if(input.expectedArchived!==undefined && input.expectedArchived!==!!shipment.archivedAt) throw fail('The shipment archive status changed. Review the latest shipment before editing.',409);
    if(shipment.archivedAt && (req.method==='DELETE'||input.operation==='delete') && input.permanent!==true) throw fail('This shipment is archived. Restore it or explicitly confirm permanent deletion.',409);
    const before=snapshot(id);
    db.exec('SAVEPOINT editing_action');
    const send=res.json.bind(res);
    res.json=body=>{
      if(res.statusCode>=400){db.exec('ROLLBACK TO editing_action; RELEASE editing_action');return send(body);}
      let cleanupUrls=[];
      try {
        const after=snapshot(id),changes=diff(before,after);
        prune(id);
        if(changes.length && !shipment.archivedAt){
          const label=req.editLabel || (req.method==='DELETE'?'Delete':req.method==='PATCH'?'Edit':input.source==='import'?'Import':'Add')+' '+(match?.[2] || entity?.[1]);
          const removed=db.prepare('SELECT changes FROM edit_history WHERE shipmentId=? AND userId=? AND undone=1').all(id,req.user.id);
          db.prepare('DELETE FROM edit_history WHERE shipmentId=? AND userId=? AND undone=1').run(id,req.user.id);
          db.prepare('INSERT INTO edit_history(id,shipmentId,userId,label,changes) VALUES(?,?,?,?,?)').run(randomUUID(),id,req.user.id,label,JSON.stringify(changes));
          const expired=db.prepare('SELECT sequence,changes FROM edit_history WHERE shipmentId=? AND userId=? ORDER BY sequence DESC LIMIT -1 OFFSET 50').all(id,req.user.id);
          for(const row of expired) db.prepare('DELETE FROM edit_history WHERE sequence=?').run(row.sequence);
          cleanupUrls=photoUrls([...removed,...expired]);
          if(body && typeof body==='object') body.historyAction=label;
        } else if(shipment.archivedAt) cleanupUrls=before.pallet_photos.map(p=>p.url);
        db.exec('RELEASE editing_action');
      }catch(error){db.exec('ROLLBACK TO editing_action; RELEASE editing_action');throw error;}
      cleanup(cleanupUrls);
      return send(body);
    };
    next();
  });
  const state=(id,user)=>({undo:db.prepare('SELECT id,label FROM edit_history WHERE shipmentId=? AND userId=? AND undone=0 ORDER BY sequence DESC LIMIT 1').get(id,user)||null,redo:db.prepare('SELECT id,label FROM edit_history WHERE shipmentId=? AND userId=? AND undone=1 ORDER BY sequence ASC LIMIT 1').get(id,user)||null});
  app.get('/api/shipments/:id/history',(req,res)=>{auth.requireShipment(req.user,req.params.id);res.json(state(req.params.id,req.user.id));});
  app.post('/api/shipments/:id/history/:direction',(req,res)=>{
    const shipment=auth.requireShipment(req.user,req.params.id);
    if(shipment.archivedAt) throw fail('Restore the shipment before using undo or redo.',409);
    const direction=req.params.direction;
    if(!['undo','redo'].includes(direction))throw fail('Unknown history action.');
    const action=state(shipment.id,req.user.id)[direction];
    if(!action || req.body.actionId!==action.id)throw fail('The action history has changed. Refresh and try again.',409);
    const entry=db.prepare('SELECT * FROM edit_history WHERE id=?').get(action.id),changes=JSON.parse(entry.changes);
    const current=snapshot(shipment.id);
    for(const change of changes){
      const expected=direction==='undo'?change.after:change.before;
      const reference=change.before||change.after;
      const actual=current[change.table].find(row=>key(change.table,row)===key(change.table,reference))||null;
      if(JSON.stringify(actual)!==JSON.stringify(expected))throw fail('Cannot '+direction+': another action changed the affected data. Nothing was overwritten.',409);
    }
    db.exec('SAVEPOINT history_apply');
    try{
      // Create parents, reconcile children, then remove parents. Unrecorded dependencies block deletion.
      for(const table of ['pallets','items','pallet_photos','pallet_checks'])for(const change of changes.filter(c=>c.table===table)){
        const desired=direction==='undo'?change.before:change.after;
        if(!desired)continue;
        if(table==='pallets' && db.prepare('SELECT id,name FROM pallets WHERE shipmentId=? AND id<>?').all(shipment.id,desired.id).some(p=>objectNameKey(p.name)===objectNameKey(desired.name)))throw fail('A pallet already uses this name.',409);
        if(table==='items')desired.nameKey=uniqueName(desired,409);
        const columns=Object.keys(desired),pk=table==='pallet_checks'?['palletId','stage']:['id'];
        db.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(()=>'?').join(',')}) ON CONFLICT(${pk.join(',')}) DO UPDATE SET ${columns.filter(c=>!pk.includes(c)).map(c=>`${c}=excluded.${c}`).join(',')}`).run(...Object.values(desired));
        if(table==='items')db.prepare('DELETE FROM deleted_items WHERE id=?').run(desired.id);
      }
      for(const table of ['pallet_checks','pallet_photos','items','pallets'])for(const change of changes.filter(c=>c.table===table)){
        const desired=direction==='undo'?change.before:change.after;
        if(!desired){const row=change.before||change.after;if(table==='items')trash(row,req.user.id);if(table==='pallet_checks')db.prepare('DELETE FROM pallet_checks WHERE palletId=? AND stage=?').run(row.palletId,row.stage);else db.prepare(`DELETE FROM ${table} WHERE id=?`).run(row.id);}
      }
      db.prepare('UPDATE edit_history SET undone=? WHERE id=?').run(direction==='undo'?1:0,entry.id);prune(shipment.id);
      db.exec('RELEASE history_apply');
    }catch(error){db.exec('ROLLBACK TO history_apply; RELEASE history_apply');throw fail('Cannot '+direction+': '+(error.status?error.message:'related data has changed. Nothing was overwritten.'),409);}
    res.json({...state(shipment.id,req.user.id),message:`${direction==='undo'?'Undid':'Redid'}: ${entry.label}`});
  });
  function selected(req,kind){
    auth.requireShipment(req.user,req.params.id);
    if(!Array.isArray(req.body.entries)||!req.body.entries.length||req.body.entries.length>2000||new Set(req.body.entries.map(e=>e.id)).size!==req.body.entries.length)throw fail('Select 1 to 2000 distinct rows.');
    return req.body.entries.map(entry=>{
      const row=db.prepare(`SELECT * FROM ${kind} WHERE id=? AND shipmentId=?`).get(entry.id,req.params.id);
      if(!row)throw fail('A selected row is no longer available.',409);
      const view=kind==='pallets'?palletView(row):kind==='items'?itemView(row):{revision:revision(row)};
      if(typeof entry.revision!=='string')throw fail('Refresh the selected rows before continuing.',409);
      checkRevision(entry,view.revision);return row;
    });
  }
  function target(req){const id=req.body.palletId||null;if(id&&!db.prepare('SELECT id FROM pallets WHERE id=? AND shipmentId=?').get(id,req.params.id))throw fail('Choose a transport unit in this shipment.');return id;}
  app.post('/api/shipments/:id/items/bulk',(req,res)=>{
    const operation=req.body.operation;
    if(!['assign','delete','restore'].includes(operation))throw fail('Choose assign, delete or restore.');
    const records=selected(req,operation==='restore'?'deleted_items':'items');
    const palletId=operation==='assign'?target(req):null;
    if(operation==='restore'&&auth.requireShipment(req.user,req.params.id).archivedAt)throw fail('Restore the shipment before restoring items.',409);
    req.editLabel=`${operation==='assign'?'Move':operation==='restore'?'Restore':'Delete'} ${records.length} item${records.length===1?'':'s'}`;
    for(const row of records){
      if(operation==='assign')db.prepare('UPDATE items SET palletId=?,statuses=? WHERE id=?').run(palletId,assignmentStatuses(row.statuses,palletId,row.palletId),row.id);
      else if(operation==='delete'){trash(row,req.user.id);db.prepare('DELETE FROM items WHERE id=?').run(row.id);}
      else {
        const item=JSON.parse(row.content);
        if(item.palletId&&!db.prepare('SELECT id FROM pallets WHERE id=? AND shipmentId=?').get(item.palletId,req.params.id))item.palletId=null;
        item.nameKey=uniqueName(item,409);
        const columns=Object.keys(item);db.prepare(`INSERT INTO items(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`).run(...Object.values(item));
        db.prepare('DELETE FROM deleted_items WHERE id=?').run(row.id);
      }
    }
    res.json({ok:true,affected:records.length});
  });
  app.post('/api/shipments/:id/pallets/bulk',(req,res)=>{
    const records=selected(req,'pallets'),operation=req.body.operation;
    if(!['delete','assign'].includes(operation))throw fail('Choose delete or move contents.');
    const palletId=operation==='assign'?target(req):null;
    if(records.some(p=>p.id===palletId))throw fail('Choose a destination outside the selected units.');
    // Contents have their own revisions: never overwrite a colleague's item edits.
    const contents=records.flatMap(p=>db.prepare('SELECT * FROM items WHERE palletId=?').all(p.id));
    if(!Array.isArray(req.body.items)||contents.length!==req.body.items.length)throw fail('Pallet contents changed. Refresh and try again.',409);
    for(const item of contents){const expected=req.body.items.find(e=>e.id===item.id);if(!expected||expected.revision!==itemView(item).revision)throw fail('Pallet contents changed. Refresh and try again.',409);}
    req.editLabel=`${operation==='delete'?'Delete':'Move contents of'} ${records.length} unit${records.length===1?'':'s'}`;
    for(const pallet of records){
      for(const item of contents.filter(i=>i.palletId===pallet.id))db.prepare('UPDATE items SET palletId=?,statuses=? WHERE id=?').run(palletId,assignmentStatuses(item.statuses,palletId,item.palletId),item.id);
      if(operation==='delete'){db.prepare('DELETE FROM pallet_photos WHERE palletId=?').run(pallet.id);db.prepare('DELETE FROM pallets WHERE id=?').run(pallet.id);}
    }
    res.json({ok:true,affected:records.length});
  });
  app.post('/api/items/:id/duplicate',(req,res)=>{
    const item=db.prepare('SELECT * FROM items WHERE id=?').get(req.params.id);
    if(!item)throw fail('Item not found.',404);
    auth.requireShipment(req.user,item.shipmentId);checkRevision(req.body,itemView(item).revision);
    const copy={...item,id:randomUUID(),name:`${itemDisplayName(item)} (copy)`,statuses:assignmentStatuses('{}',item.palletId),autoNumbered:0,createdOrder:stamp(),imported:0};
    let suffix=2;while(db.prepare('SELECT id FROM items WHERE shipmentId=? AND nameKey=?').get(item.shipmentId,itemNameKey(copy)))copy.name=`${itemDisplayName(item)} (copy ${suffix++})`;
    copy.nameKey=uniqueName(copy);
    const last=db.prepare('SELECT lastNumber FROM item_sequences WHERE shipmentId=? AND nameKey=?').get(item.shipmentId,objectNameKey(item.name))?.lastNumber||0;
    copy.instanceNumber=last+1;
    db.prepare('INSERT INTO item_sequences VALUES(?,?,?) ON CONFLICT(shipmentId,nameKey) DO UPDATE SET lastNumber=excluded.lastNumber').run(item.shipmentId,objectNameKey(item.name),copy.instanceNumber);
    const columns=Object.keys(copy);db.prepare(`INSERT INTO items(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`).run(...Object.values(copy));
    req.editLabel=`Duplicate ${itemView(item).displayName}`;
    res.status(201).json(itemView(copy));
  });
  function prepareUserDeletion(userId) {
    const removed=db.prepare('SELECT changes FROM edit_history WHERE userId=?').all(userId);
    db.prepare('DELETE FROM edit_history WHERE userId=?').run(userId);
    for(const entry of db.prepare('SELECT id,changes FROM edit_history').all()){
      const changes=JSON.parse(entry.changes);let changed=false;
      for(const change of changes)if(change.table==='pallet_checks')for(const side of ['before','after'])if(change[side]?.userId===userId){change[side].userId=null;changed=true;}
      if(changed)db.prepare('UPDATE edit_history SET changes=? WHERE id=?').run(JSON.stringify(changes),entry.id);
    }
    db.prepare("UPDATE deleted_items SET deletedBy='' WHERE deletedBy=?").run(userId);
    return ()=>cleanup(photoUrls(removed));
  }
  return {trash,purge,stamp,uniqueName,prepareUserDeletion,deleted:id=>db.prepare('SELECT * FROM deleted_items WHERE shipmentId=? ORDER BY rowid DESC LIMIT 200').all(id).map(row=>({...itemView(JSON.parse(row.content)),deletedAt:row.deletedAt,revision:revision(row)})),recent:(id,importedOnly=false)=>db.prepare(`SELECT * FROM items WHERE shipmentId=? ${importedOnly?'AND imported=1':''} ORDER BY createdOrder DESC LIMIT 200`).all(id).map(itemView)};
}
