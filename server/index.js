import { revision, checkRevision } from './revisions.js';
import express from 'express';
import multer from 'multer';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';
import XLSX from 'xlsx';
import { extractPdfRows } from './pdf-import.js';
import { nextPalletNumber, palletName, objectNameKey } from '../shared/numbering.js';
import { installAuth } from './auth.js';
import { archiveShipment } from './archive-photos.js';
import { installExports } from './exports.js';
import { installChallenges } from './challenges.js';
import { coordinates, straightLineDistances } from './routing.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.DATA_DIR || path.join(root, 'data');
mkdirSync(path.join(dataDir, 'uploads'), { recursive: true });
const db = new DatabaseSync(path.join(dataDir, 'shipments.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS shipments (id TEXT PRIMARY KEY, name TEXT NOT NULL, destination TEXT NOT NULL, createdAt TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS pallets (id TEXT PRIMARY KEY, shipmentId TEXT NOT NULL REFERENCES shipments(id), name TEXT NOT NULL, photo TEXT);
CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY, shipmentId TEXT NOT NULL REFERENCES shipments(id), palletId TEXT REFERENCES pallets(id), name TEXT NOT NULL, code TEXT NOT NULL, note TEXT NOT NULL, statuses TEXT NOT NULL);`);
if (!db.prepare('PRAGMA table_info(shipments)').all().some(column => column.name === 'archivedAt')) {
  db.exec('ALTER TABLE shipments ADD COLUMN archivedAt TEXT');
}
for (const field of ['returnDestination', 'outboundDate', 'returnDate']) {
  if (!db.prepare('PRAGMA table_info(shipments)').all().some(column => column.name === field)) db.exec(`ALTER TABLE shipments ADD COLUMN ${field} TEXT NOT NULL DEFAULT ''`);
}
// Pallet tracking is independent of every object's tracking, including existing data.
if (!db.prepare('PRAGMA table_info(pallets)').all().some(column => column.name === 'statuses')) {
  db.exec("ALTER TABLE pallets ADD COLUMN statuses TEXT NOT NULL DEFAULT '{}'");
}
// Give existing objects stable instance numbers without changing their names or tracking.
if (!db.prepare('PRAGMA table_info(items)').all().some(column => column.name === 'instanceNumber')) {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec('ALTER TABLE items ADD COLUMN instanceNumber INTEGER');
    const numbers = new Map();
    const update = db.prepare('UPDATE items SET instanceNumber=? WHERE id=?');
    for (const item of db.prepare('SELECT id, shipmentId, name FROM items ORDER BY rowid').all()) {
      const key = JSON.stringify([item.shipmentId, objectNameKey(item.name)]);
      const number = (numbers.get(key) || 0) + 1;
      numbers.set(key, number); update.run(number, item.id);
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
db.exec(`CREATE TABLE IF NOT EXISTS pallet_photos (id TEXT PRIMARY KEY, palletId TEXT NOT NULL REFERENCES pallets(id), url TEXT NOT NULL UNIQUE, createdAt TEXT NOT NULL)`);
if (!db.prepare('PRAGMA table_info(pallet_photos)').all().some(column => column.name === 'compressedAt')) db.exec('ALTER TABLE pallet_photos ADD COLUMN compressedAt TEXT');
db.exec('BEGIN');
try {
  const insertPhoto = db.prepare('INSERT OR IGNORE INTO pallet_photos (id, palletId, url, createdAt) VALUES (?, ?, ?, ?)');
  for (const pallet of db.prepare('SELECT id, photo FROM pallets WHERE photo IS NOT NULL').all()) insertPhoto.run(randomUUID(), pallet.id, pallet.photo, new Date().toISOString());
  db.exec('UPDATE pallets SET photo=NULL WHERE photo IS NOT NULL; COMMIT');
} catch (error) { db.exec('ROLLBACK'); throw error; }
const palletView = pallet => {
  const photos = db.prepare('SELECT * FROM pallet_photos WHERE palletId=? ORDER BY rowid').all(pallet.id);
  return { ...pallet, revision: revision({ ...pallet, photos }), statuses: JSON.parse(pallet.statuses), photo: photos[0]?.url || null, photos };
};
const app = express();
app.use(express.json({ limit: '2mb' }));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const clean = (value, max = 200) => String(value ?? '').trim().slice(0, max);
const auth = installAuth(app, db, dataDir);
const archiving = new Set();
app.use('/api', (req, res, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const parts = req.path.split('/');
    const shipmentId = parts[1] === 'shipments' ? parts[2] : parts[1] === 'pallets' ? db.prepare('SELECT shipmentId FROM pallets WHERE id=?').get(parts[2])?.shipmentId : parts[1] === 'items' ? db.prepare('SELECT shipmentId FROM items WHERE id=?').get(parts[2])?.shipmentId : null;
    if (archiving.has(shipmentId)) throw fail('This shipment is being archived. Try again shortly.', 409);
  }
  next();
});
const challenges = installChallenges(app, db, auth);
installExports(app, db, auth);
const requireShipment = auth.requireShipment;
const requirePallet = (id, shipmentId) => { if (!db.prepare('SELECT id FROM pallets WHERE id=? AND shipmentId=?').get(id, shipmentId)) throw fail('This pallet does not belong to this shipment.'); };
const itemView = row => ({ ...row, revision: revision(row), displayName: `${row.name} ${row.instanceNumber}`, statuses: JSON.parse(row.statuses) });
// Keep a high-water mark so removing an object never reuses its number.
db.exec('CREATE TABLE IF NOT EXISTS item_sequences (shipmentId TEXT NOT NULL REFERENCES shipments(id), nameKey TEXT NOT NULL, lastNumber INTEGER NOT NULL, PRIMARY KEY(shipmentId, nameKey))');
const reserveNumber = db.prepare('INSERT INTO item_sequences VALUES (?, ?, ?) ON CONFLICT(shipmentId,nameKey) DO UPDATE SET lastNumber=MAX(lastNumber,excluded.lastNumber)');
for (const item of db.prepare('SELECT shipmentId, name, instanceNumber FROM items').all()) reserveNumber.run(item.shipmentId, objectNameKey(item.name), item.instanceNumber);
app.get('/api/health', (_, res) => res.json({ ok: true }));
app.get('/api/shipments', (req, res) => {
  const rows = req.user.role === 'admin' ? db.prepare('SELECT * FROM shipments ORDER BY createdAt DESC').all() : db.prepare('SELECT * FROM shipments s WHERE s.ownerId=? OR EXISTS (SELECT 1 FROM shipment_access a WHERE a.shipmentId=s.id AND a.userId=?) ORDER BY createdAt DESC').all(req.user.id, req.user.id);
  res.json(rows.map(row => auth.viewShipment(req.user, row)));
});
function routeFields(body) {
  const fields = {};
  for (const key of ['returnDestination', 'outboundDate', 'returnDate']) {
    if (!(key in body)) continue;
    if (typeof body[key] !== 'string') throw fail('Invalid destination or date.');
    const value = body[key].trim();
    if (key === 'returnDestination') { if (value.length > 200) throw fail('Use no more than 200 characters for the return destination.'); }
    else if (value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) throw fail('Enter a valid date.');
    fields[key] = value;
  }
  return fields;
}
app.post('/api/shipments', (req, res) => {
  const name = clean(req.body.name), destination = clean(req.body.destination);
  if (!name) throw fail('Enter a shipment name.');
  for (const key of ['warehouseAddress', 'outboundAddress']) if (key in req.body && (typeof req.body[key] !== 'string' || req.body[key].length > 500)) throw fail('Enter an address of up to 500 characters.');
  const defaultWarehouse = challenges.defaultWarehouse();
  const warehouseAddress = req.body.warehouseAddress?.trim() || defaultWarehouse.address;
  const warehouse = coordinates(req.body.warehouseCoordinates) || (warehouseAddress === defaultWarehouse.address ? defaultWarehouse.coordinates : null), outbound = coordinates(req.body.outboundCoordinates);
  if (warehouse && !warehouseAddress || outbound && !req.body.outboundAddress?.trim()) throw fail('Provide the address for each confirmed location.');
  const distances = warehouse && outbound ? straightLineDistances(warehouse, outbound) : null;
  const shipment = { id: randomUUID(), name, destination, createdAt: new Date().toISOString(), ownerId: req.user.id, returnDestination: '', outboundDate: '', returnDate: '', ...routeFields(req.body) };
  db.prepare('INSERT INTO shipments (id, name, destination, createdAt, ownerId, returnDestination, outboundDate, returnDate) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(shipment.id, name, destination, shipment.createdAt, shipment.ownerId, shipment.returnDestination, shipment.outboundDate, shipment.returnDate);
  db.prepare('UPDATE shipments SET warehouseAddress=?,outboundAddress=?,warehouseCoordinates=?,outboundCoordinates=?,outboundKm=?,returnKm=?,distanceSource=?,distanceUpdatedAt=? WHERE id=?').run(warehouseAddress, req.body.outboundAddress?.trim() || '', warehouse ? JSON.stringify(warehouse) : null, outbound ? JSON.stringify(outbound) : null, distances?.outboundKm ?? null, distances?.returnKm ?? null, distances ? 'straight-line' : null, distances ? new Date().toISOString() : null, shipment.id);
  res.status(201).json(auth.viewShipment(req.user, db.prepare('SELECT * FROM shipments WHERE id=?').get(shipment.id)));
});
app.patch('/api/shipments/:id', async (req, res) => {
  const shipment = requireShipment(req.user, req.params.id, true);
  checkRevision(req.body, revision(shipment));
  const changes = routeFields(req.body);
  if (!['archived', 'name', 'destination', 'returnDestination', 'outboundDate', 'returnDate'].some(key => key in req.body)) throw fail('Specify a change.');
  for (const key of ['name', 'destination']) {
    if (key in req.body) {
      if (typeof req.body[key] !== 'string' || req.body[key].trim().length > 200 || key === 'name' && !req.body[key].trim()) throw fail(key === 'name' ? 'Enter a shipment name of up to 200 characters.' : 'Enter a location of up to 200 characters.');
      changes[key] = req.body[key].trim();
    }
  }
  if ('archived' in req.body && typeof req.body.archived !== 'boolean') throw fail('Invalid archive status.');
  if (req.body.archived) {
    archiving.add(req.params.id);
    try { await archiveShipment(db, dataDir, req.params.id); }
    catch { throw fail('Archiving failed: a photo could not be processed. The shipment and original photos have been preserved.'); }
    finally { archiving.delete(req.params.id); }
  } else if ('archived' in req.body) db.prepare('UPDATE shipments SET archivedAt=NULL WHERE id=?').run(req.params.id);
  for (const [key, value] of Object.entries(changes)) db.prepare(`UPDATE shipments SET ${key}=? WHERE id=?`).run(value, req.params.id);
  res.json(auth.viewShipment(req.user, db.prepare('SELECT * FROM shipments WHERE id=?').get(req.params.id)));
});
app.delete('/api/shipments/:id', (req, res) => {
  const shipment = requireShipment(req.user, req.params.id, true);
  checkRevision(req.body, revision(shipment));
  if (req.body.confirmName !== shipment.name) throw fail('Type the shipment name to confirm deletion.');
  const photos = db.prepare('SELECT url FROM pallet_photos WHERE palletId IN (SELECT id FROM pallets WHERE shipmentId=?)').all(shipment.id);
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('DELETE FROM pallet_photos WHERE palletId IN (SELECT id FROM pallets WHERE shipmentId=?)').run(shipment.id);
    for (const table of ['items', 'pallets', 'item_sequences', 'shipment_access', 'column_preferences', 'shipment_logos']) db.prepare(`DELETE FROM ${table} WHERE shipmentId=?`).run(shipment.id);
    db.prepare('DELETE FROM shipments WHERE id=?').run(shipment.id);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  for (const photo of photos) {
    try { unlinkSync(path.join(dataDir, 'uploads', path.basename(photo.url))); }
    catch (error) { if (error.code !== 'ENOENT') console.error('Could not delete photo file:', error.code); }
  }
  res.json({ ok: true });
});
app.get('/api/shipments/:id', (req, res) => {
  requireShipment(req.user, req.params.id);
  res.json({ hasLogo: !!db.prepare('SELECT 1 FROM shipment_logos WHERE shipmentId=?').get(req.params.id), columns: auth.getColumns(req.user.id, req.params.id), palletColumns: auth.getColumns(req.user.id, req.params.id, 'pallets'), pallets: db.prepare('SELECT * FROM pallets WHERE shipmentId=? ORDER BY rowid').all(req.params.id).map(palletView), items: db.prepare('SELECT * FROM items WHERE shipmentId=? ORDER BY rowid').all(req.params.id).map(itemView) });
});
app.post('/api/shipments/:id/pallets', (req, res) => {
  requireShipment(req.user, req.params.id);
  const name = clean(req.body.name);
  const prefix = req.body.prefix === undefined ? 'Pallet' : req.body.prefix;
  const postfix = req.body.postfix === undefined ? '' : req.body.postfix;
  if (typeof prefix !== 'string' || typeof postfix !== 'string' || prefix.trim().length > 90 || postfix.trim().length > 90) throw fail('Use no more than 90 characters for the prefix and postfix.');
  const quantity = Number(req.body.quantity ?? 1);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 200) throw fail('Choose a whole quantity from 1 to 200 pallets.');
  if (name && quantity > 1) throw fail('Multiple pallets are named automatically. Leave the name blank.');
  const pallets = [];
  db.exec('BEGIN IMMEDIATE');
  try {
    const existing = db.prepare('SELECT name FROM pallets WHERE shipmentId=?').all(req.params.id);
    if (name && existing.some(pallet => objectNameKey(pallet.name) === objectNameKey(name))) throw fail('A pallet with this name already exists.');
    const start = nextPalletNumber(existing, prefix, postfix);
    const insert = db.prepare('INSERT INTO pallets (id, shipmentId, name, photo) VALUES (?, ?, ?, NULL)');
    for (let i = 0; i < quantity; i++) {
      const pallet = { id: randomUUID(), name: name || palletName(start + i, prefix, postfix), shipmentId: req.params.id, photo: null, photos: [], statuses: {} };
      if (existing.some(p => objectNameKey(p.name) === objectNameKey(pallet.name))) throw fail('A pallet with this name already exists.');
      insert.run(pallet.id, pallet.shipmentId, pallet.name); pallets.push(pallet);
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  res.status(201).json({ id: pallets[0].id, added: pallets.length, pallets });
});
app.patch('/api/pallets/:id', (req, res) => {
  const pallet = db.prepare('SELECT * FROM pallets WHERE id=?').get(req.params.id);
  if (!pallet) throw fail('Pallet not found.', 404);
  requireShipment(req.user, pallet.shipmentId);
  checkRevision(req.body, palletView(pallet).revision);
  if (!('name' in req.body) && !('status' in req.body)) throw fail('Specify a name or status.');
  let name = pallet.name;
  if ('name' in req.body) {
    if (typeof req.body.name !== 'string' || !req.body.name.trim() || req.body.name.trim().length > 200) throw fail('Enter a pallet name of up to 200 characters.');
    name = req.body.name.trim();
    if (db.prepare('SELECT id, name FROM pallets WHERE shipmentId=? AND id<>?').all(pallet.shipmentId, pallet.id).some(p => objectNameKey(p.name) === objectNameKey(name))) throw fail('A pallet with this name already exists.');
  }
  const statuses = JSON.parse(pallet.statuses);
  if ('status' in req.body) {
    if (!['outWarehouse', 'inLocation', 'outLocation', 'inWarehouse'].includes(req.body.status) || typeof req.body.checked !== 'boolean') throw fail('Invalid status.');
    statuses[req.body.status] = req.body.checked ? (statuses[req.body.status] || new Date().toISOString()) : null;
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    if ('status' in req.body) challenges.record(pallet, req.body.status, req.body.checked, req.user.id, statuses[req.body.status]);
    db.prepare('UPDATE pallets SET name=?, statuses=? WHERE id=?').run(name, JSON.stringify(statuses), pallet.id);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  res.json(palletView(db.prepare('SELECT * FROM pallets WHERE id=?').get(pallet.id)));
});
app.delete('/api/pallets/:id', (req, res) => {
  const pallet = db.prepare('SELECT * FROM pallets WHERE id=?').get(req.params.id);
  if (!pallet) throw fail('Pallet not found.', 404);
  requireShipment(req.user, pallet.shipmentId);
  checkRevision(req.body, palletView(pallet).revision);
  const photos = db.prepare('SELECT url FROM pallet_photos WHERE palletId=?').all(pallet.id);
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('UPDATE items SET palletId=NULL WHERE palletId=?').run(pallet.id);
    db.prepare('DELETE FROM pallet_photos WHERE palletId=?').run(pallet.id);
    db.prepare('DELETE FROM pallets WHERE id=?').run(pallet.id);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  for (const photo of photos) {
    try { unlinkSync(path.join(dataDir, 'uploads', path.basename(photo.url))); }
    catch (error) { if (error.code !== 'ENOENT') console.error('Failed to clean up pallet photo:', error.code); }
  }
  res.json({ ok: true });
});
app.post('/api/shipments/:id/items', (req, res) => {
  requireShipment(req.user, req.params.id);
  const rows = req.body.rows;
  if (!Array.isArray(rows) || !rows.length || rows.length > 2000) throw fail('Add 1 to 2000 equipment rows.');
  let total = 0;
  const prepared = rows.map(row => {
    const name = clean(row.name), code = clean(row.code), note = clean(row.note, 1000), quantity = Number(row.quantity ?? 1), palletId = row.palletId || null;
    if (!name || !Number.isInteger(quantity) || quantity < 1 || quantity > 2000) throw fail('Each row needs a description and a whole quantity from 1 to 2000.');
    if (palletId) requirePallet(palletId, req.params.id);
    total += quantity;
    return { name, code, note, quantity, palletId };
  });
  if (total > 2000) throw fail('Add no more than 2000 items at a time.');
  db.exec('BEGIN');
  try {
    const numbers = new Map();
    for (const row of db.prepare('SELECT nameKey, lastNumber FROM item_sequences WHERE shipmentId=?').all(req.params.id)) numbers.set(row.nameKey, row.lastNumber);
    const insert = db.prepare('INSERT INTO items (id, shipmentId, palletId, name, code, note, statuses, instanceNumber) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    for (const row of prepared) for (let i = 0; i < row.quantity; i++) {
      const key = objectNameKey(row.name), number = (numbers.get(key) || 0) + 1;
      numbers.set(key, number);
      reserveNumber.run(req.params.id, key, number);
      insert.run(randomUUID(), req.params.id, row.palletId, row.name, row.code, row.note, '{}', number);
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  res.status(201).json({ added: total });
});
app.patch('/api/items/:id', (req, res) => {
  const item = db.prepare('SELECT * FROM items WHERE id=?').get(req.params.id);
  if (!item) throw fail('Item not found.', 404);
  requireShipment(req.user, item.shipmentId);
  checkRevision(req.body, revision(item));
  if ('status' in req.body && (!['outWarehouse', 'inLocation', 'outLocation', 'inWarehouse'].includes(req.body.status) || typeof req.body.checked !== 'boolean')) throw fail('Invalid status.');
  const updated = { ...item };
  for (const [key, max] of [['name', 200], ['code', 200], ['note', 1000]]) {
    if (key in req.body) {
      if (typeof req.body[key] !== 'string' || req.body[key].trim().length > max) throw fail(`Invalid ${key === 'name' ? 'description' : key === 'code' ? 'item code' : 'note'}.`);
      updated[key] = req.body[key].trim();
    }
  }
  if (!updated.name) throw fail('Enter an item description.');
  if ('palletId' in req.body) {
    const palletId = req.body.palletId || null;
    if (palletId) requirePallet(palletId, item.shipmentId);
    updated.palletId = palletId;
  }
  if ('status' in req.body) {
    const statuses = JSON.parse(item.statuses);
    statuses[req.body.status] = req.body.checked ? new Date().toISOString() : null;
    updated.statuses = JSON.stringify(statuses);
  }
  if (objectNameKey(updated.name) !== objectNameKey(item.name)) {
    const last = db.prepare('SELECT lastNumber FROM item_sequences WHERE shipmentId=? AND nameKey=?').get(item.shipmentId, objectNameKey(updated.name))?.lastNumber || 0;
    if (updated.instanceNumber <= last) updated.instanceNumber = last + 1;
  }
  db.exec('BEGIN');
  try {
    reserveNumber.run(item.shipmentId, objectNameKey(updated.name), updated.instanceNumber);
    db.prepare('UPDATE items SET name=?, code=?, note=?, palletId=?, statuses=?, instanceNumber=? WHERE id=?').run(updated.name, updated.code, updated.note, updated.palletId, updated.statuses, updated.instanceNumber, item.id);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  res.json(itemView(db.prepare('SELECT * FROM items WHERE id=?').get(item.id)));
});
app.delete('/api/items/:id', (req, res) => {
  const item = db.prepare('SELECT * FROM items WHERE id=?').get(req.params.id);
  if (!item) throw fail('Item not found.', 404);
  requireShipment(req.user, item.shipmentId);
  checkRevision(req.body, revision(item));
  db.prepare('DELETE FROM items WHERE id=?').run(item.id);
  res.json({ ok: true });
});
const photoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 10 } });
app.post(['/api/pallets/:id/photo', '/api/pallets/:id/photos'], (req, res, next) => {
  const pallet = db.prepare('SELECT shipmentId FROM pallets WHERE id=?').get(req.params.id);
  if (!pallet) throw fail('Pallet not found.', 404);
  const shipment = requireShipment(req.user, pallet.shipmentId);
  if (shipment.archivedAt) throw fail('Restore the shipment before adding new photos.', 409);
  next();
}, photoUpload.fields([{ name: 'file', maxCount: 1 }, { name: 'files', maxCount: 10 }]), (req, res) => {
  const pallet = db.prepare('SELECT shipmentId FROM pallets WHERE id=?').get(req.params.id);
  if (!pallet) throw fail('Pallet not found.', 404);
  const shipment = requireShipment(req.user, pallet.shipmentId);
  if (archiving.has(shipment.id) || shipment.archivedAt) throw fail('This shipment is being archived or is archived. Restore it before adding photos.', 409);
  const files = [...(req.files?.file || []), ...(req.files?.files || [])];
  if (!files.length) throw fail('Select at least one photo.');
  const photos = files.map(file => {
    const bytes = file.buffer;
    const extension = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? 'jpg' : bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'png' : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP' ? 'webp' : null;
    if (!extension) throw fail('Use JPG, PNG or WebP photos.');
    const id = randomUUID();
    return { id, palletId: req.params.id, url: `/uploads/${id}.${extension}`, createdAt: new Date().toISOString(), bytes };
  });
  const written = [];
  db.exec('BEGIN');
  try {
    const insert = db.prepare('INSERT INTO pallet_photos (id, palletId, url, createdAt) VALUES (?, ?, ?, ?)');
    for (const photo of photos) {
      const filename = path.join(dataDir, 'uploads', path.basename(photo.url));
      writeFileSync(filename, photo.bytes, { flag: 'wx' }); written.push(filename);
      insert.run(photo.id, photo.palletId, photo.url, photo.createdAt);
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); for (const filename of written) unlinkSync(filename); throw error; }
  res.json({ ok: true, added: photos.length });
});
app.delete('/api/pallets/:id/photos/:photoId', (req, res) => {
  const photo = db.prepare('SELECT ph.*, p.shipmentId FROM pallet_photos ph JOIN pallets p ON p.id=ph.palletId WHERE ph.id=? AND ph.palletId=?').get(req.params.photoId, req.params.id);
  if (!photo) throw fail('Photo not found.', 404);
  requireShipment(req.user, photo.shipmentId);
  try { unlinkSync(path.join(dataDir, 'uploads', path.basename(photo.url))); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  db.prepare('DELETE FROM pallet_photos WHERE id=?').run(photo.id);
  res.json({ ok: true });
});
app.post('/api/import-preview', upload.single('file'), async (req, res) => {
  if (!req.file) throw fail('Select an equipment list.');
  const ext = path.extname(req.file.originalname).toLowerCase();
  let rows, warning = '', pdfMetadata = {};
  if (ext === '.csv') {
    let content = req.file.buffer.toString('utf8').replace(/^\uFEFF/, '');
    const first = content.split(/\r?\n/)[0];
    const delimiter = [';', ',', '\t'].sort((a,b) => first.split(b).length - first.split(a).length)[0];
    rows = parse(content, { delimiter, skip_empty_lines: true, relax_column_count: true });
  } else if (['.xlsx', '.xls'].includes(ext)) {
    const book = XLSX.read(req.file.buffer, { type: 'buffer' });
    rows = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { header: 1, defval: '' });
    warning = 'The first worksheet has been read. Check the columns and quantities.';
  } else if (ext === '.pdf') {
    const result = await extractPdfRows(req.file.buffer);
    rows = result.rows; warning = result.warning;
    pdfMetadata = { hasHeader: result.hasHeader, columns: result.columns };
  } else throw fail('Use CSV, Excel (.xlsx/.xls) or PDF.');
  rows = rows.filter(row => row.some(v => String(v).trim()));
  if (!rows.length) throw fail('No readable equipment found. For a scan, use a CSV or Excel version.');
  if (rows.length > 2001) throw fail('The file contains too many rows. Use no more than 2000 equipment rows.');
  res.json({ rows: rows.map(row => row.map(v => String(v).slice(0, 1000))), warning, pdf: ext === '.pdf', ...pdfMetadata });
});
app.use('/uploads', express.static(path.join(dataDir, 'uploads'), { cacheControl: false, etag: false, lastModified: false }));
app.use('/api', (_, res) => res.status(404).json({ error: 'Endpoint not found.' }));
app.use(express.static(path.join(root, 'dist')));
app.get('/{*path}', (_, res) => res.sendFile(path.join(root, 'dist', 'index.html')));
app.use((error, req, res, next) => {
  console.error(error.message);
  const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : error.status || 400;
  res.status(status).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'The file must be no larger than 15 MB.' : error.code === 'LIMIT_FILE_COUNT' || error.code === 'LIMIT_UNEXPECTED_FILE' ? 'Upload up to 10 photos at a time.' : status >= 500 ? 'Something went wrong on the server.' : error.message });
});
app.listen(Number(process.env.PORT || 3001), '0.0.0.0', () => console.log('Palletshipper server started.'));
