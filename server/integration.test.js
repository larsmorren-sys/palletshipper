import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';
import XLSX from 'xlsx';
import sharp from 'sharp';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
const dir = mkdtempSync(path.join(tmpdir(), 'palletshipper-test-'));
const port = 31987;
// Exercise migration from the schema used before automatic numbering.
const legacy = new DatabaseSync(path.join(dir, 'shipments.sqlite'));
legacy.exec(`CREATE TABLE shipments (id TEXT PRIMARY KEY, name TEXT NOT NULL, destination TEXT NOT NULL, createdAt TEXT NOT NULL);
CREATE TABLE pallets (id TEXT PRIMARY KEY, shipmentId TEXT NOT NULL REFERENCES shipments(id), name TEXT NOT NULL, photo TEXT);
CREATE TABLE items (id TEXT PRIMARY KEY, shipmentId TEXT NOT NULL REFERENCES shipments(id), palletId TEXT REFERENCES pallets(id), name TEXT NOT NULL, code TEXT NOT NULL, note TEXT NOT NULL, statuses TEXT NOT NULL);
INSERT INTO shipments VALUES ('legacy', 'Bestaande shipment', '', '2026-10-05T12:00:00Z');
INSERT INTO pallets VALUES ('legacy-pallet', 'legacy', 'Pallet 4', '/uploads/legacy.png');
INSERT INTO items VALUES ('legacy-1', 'legacy', 'legacy-pallet', 'Lamp', 'L1', 'Bestaand object', '{"outWarehouse":"2026-10-05T12:00:00Z"}');
INSERT INTO items VALUES ('legacy-2', 'legacy', NULL, 'Lamp', 'L1', '', '{}');`);
legacy.close();
const pngSample = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=', 'base64');
mkdirSync(path.join(dir, 'uploads')); writeFileSync(path.join(dir, 'uploads', 'legacy.png'), pngSample);
let server;
const adminSession = { cookie: '', csrfToken: '' };
const setupToken = 'integration-test-setup-token';
function pdfFixture(contents) {
  const pageIds = contents.map((_, i) => 4 + i * 2);
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${contents.length} >>`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  contents.forEach((content, i) => objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageIds[i] + 1} 0 R >>`, `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`));
  let pdf = '%PDF-1.4\n'; const offsets = [];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}
const pdfText = (x, y, text) => `BT /F1 12 Tf 1 0 0 1 ${x} ${y} Tm (${text.replace(/[\\()]/g, '\\$&')}) Tj ET`;
async function previewPdf(contents) {
  const form = new FormData(); form.append('file', new Blob([pdfFixture(contents)], { type: 'application/pdf' }), 'materiaal.pdf');
  return request('/import-preview', 'POST', form);
}
async function request(endpoint, method = 'GET', body, session = adminSession, extraHeaders = {}) {
  const headers = { 'X-Palletshipper': '1', ...(session?.cookie ? { Cookie: session.cookie, 'X-CSRF-Token': session.csrfToken } : {}), ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...extraHeaders };
  const response = await fetch(`http://127.0.0.1:${port}/api${endpoint}`, { method, headers, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined });
  const data = await response.json();
  if (session && data.csrfToken) { session.cookie = response.headers.get('set-cookie')?.split(';')[0] || session.cookie; session.csrfToken = data.csrfToken; }
  return { status: response.status, data, headers: response.headers };
}
async function start(overrides = {}) {
  server = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(port), DATA_DIR: dir, SETUP_TOKEN: setupToken, ...overrides }, stdio: 'pipe' });
  let output = '';
  server.stderr.on('data', chunk => { output += chunk; });
  for (let i = 0; i < 100; i++) { try { if ((await request('/health')).status === 200) return; } catch {} if (server.exitCode !== null) throw new Error(output); await setTimeout(100); }
  throw new Error(`Server startte niet: ${output}`);
}
async function stop() { if (server.exitCode === null) { const exited = new Promise(resolve => server.once('exit', resolve)); server.kill(); await exited; } }
before(async () => {
  await start();
  assert.equal((await request('/shipments', 'GET', undefined, null)).status, 401);
  assert.equal((await request('/auth/setup', 'POST', { setupToken: 'wrong', name: 'Admin', email: 'admin@example.test', password: 'test-password-123' }, null)).status, 403);
  const result = await request('/auth/setup', 'POST', { setupToken, name: 'Admin', email: 'admin@example.test', password: 'test-password-123' });
  assert.equal(result.status, 201); assert.equal(result.data.user.role, 'admin');
  assert.ok(result.headers.get('set-cookie').includes('HttpOnly')); assert.ok(result.headers.get('set-cookie').includes('SameSite=Strict'));
  assert.equal((await request('/auth/setup', 'POST', { setupToken, name: 'Second', email: 'second@example.test', password: 'test-password-123' })).status, 409);
});
after(async () => { await stop(); rmSync(dir, { recursive: true, force: true }); });
test('Items have independent tracking, valid pallets and persistent storage', async () => {
  const shipment = (await request('/shipments', 'POST', { name: 'Testshipment', destination: 'Antwerpen' })).data;
  const pallet = (await request(`/shipments/${shipment.id}/pallets`, 'POST', { name: 'Pallet 1' })).data;
  assert.equal((await request(`/shipments/${shipment.id}/items`, 'POST', { rows: [{ name: 'Lamp', code: 'L001', quantity: 2, palletId: pallet.id }] })).data.added, 2);
  let data = (await request(`/shipments/${shipment.id}`)).data;
  assert.equal(data.items.length, 2); assert.notEqual(data.items[0].id, data.items[1].id);
  const id = data.items[0].id;
  const updated = await request(`/items/${id}`, 'PATCH', { status: 'outWarehouse', checked: true });
  assert.ok(updated.data.statuses.outWarehouse);
  data = (await request(`/shipments/${shipment.id}`)).data;
  assert.deepEqual(data.items[1].statuses, {});
  const otherShipment = (await request('/shipments', 'POST', { name: 'Andere shipment' })).data;
  const otherPallet = (await request(`/shipments/${otherShipment.id}/pallets`, 'POST', { name: 'Andere pallet' })).data;
  assert.equal((await request(`/items/${id}`, 'PATCH', { palletId: otherPallet.id })).status, 400);
  assert.equal((await request(`/shipments/${shipment.id}/items`, 'POST', { rows: [{ name: 'Geldig', quantity: 1 }, { name: '', quantity: 1 }] })).status, 400);
  assert.equal((await request(`/shipments/${shipment.id}`)).data.items.length, 2);
  await stop(); await start();
  data = (await request(`/shipments/${shipment.id}`)).data;
  assert.ok(data.items[0].statuses.outWarehouse); assert.equal(data.items.length, 2);
  assert.equal((await request(`/items/${id}`, 'PATCH', { status: 'outWarehouse', checked: false })).data.statuses.outWarehouse, null);
  assert.equal((await request(`/items/${id}`, 'PATCH', { palletId: null })).data.palletId, null);
});
test('CSV and Excel provide reviewable imports without adding items automatically', async () => {
  const csv = new FormData(); csv.append('file', new Blob(['Description;Code;Quantity\n"Lamp; groot";L1;3\nKabel;K1;2']), 'materiaal.csv');
  const result = await request('/import-preview', 'POST', csv);
  assert.equal(result.status, 200); assert.equal(result.data.rows[1][0], 'Lamp; groot'); assert.equal(result.data.rows[1][2], '3');
  const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['Description', 'Quantity'], ['Scherm', 2]]), 'Materiaal');
  const excel = new FormData(); excel.append('file', new Blob([XLSX.write(book, { type: 'buffer', bookType: 'xlsx' })]), 'materiaal.xlsx');
  const preview = await request('/import-preview', 'POST', excel);
  assert.equal(preview.status, 200); assert.equal(preview.data.rows[1][0], 'Scherm'); assert.equal(preview.data.rows[1][1], '2');
  const invalid = new FormData(); invalid.append('file', new Blob(['test']), 'materiaal.txt');
  assert.equal((await request('/import-preview', 'POST', invalid)).status, 400);
});
test('Pallet photos are stored and non-images are rejected', async () => {
  const shipment = (await request('/shipments', 'POST', { name: 'Fototest' })).data;
  const pallet = (await request(`/shipments/${shipment.id}/pallets`, 'POST', { name: 'Fotopallet' })).data;
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=', 'base64');
  const form = new FormData(); form.append('file', new Blob([png], { type: 'image/png' }), 'foto.png');
  assert.equal((await request(`/pallets/${pallet.id}/photo`, 'POST', form)).status, 200);
  const photo = (await request(`/shipments/${shipment.id}`)).data.pallets[0].photo;
  assert.ok(photo.startsWith('/uploads/'));
  const response = await fetch(`http://127.0.0.1:${port}${photo}`, { headers: { Cookie: adminSession.cookie } }); assert.equal(response.status, 200); assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
  const invalid = new FormData(); invalid.append('file', new Blob(['<html>test</html>'], { type: 'image/png' }), 'fake.png');
  assert.equal((await request(`/pallets/${pallet.id}/photo`, 'POST', invalid)).status, 400);
});
test('Text PDFs produce readable rows for review', async () => {
  const content = 'BT /F1 12 Tf 50 750 Td (LED scherm) Tj 0 -20 Td (Kabel) Tj ET';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${content.length} >>\nstream\n${content}\nendstream`];
  let pdf = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const form = new FormData(); form.append('file', new Blob([pdf], { type: 'application/pdf' }), 'materiaal.pdf');
  const result = await request('/import-preview', 'POST', form);
  assert.equal(result.status, 200); assert.equal(result.data.pdf, true);
  assert.ok(result.data.rows.some(row => row[0].includes('LED scherm')));
  assert.ok(result.data.warning.includes('Scanned'));
});
test('PDF columns recognize headers, empty cells and wrapped descriptions across pages', async () => {
  const page1 = [pdfText(50, 790, 'Material list'), pdfText(50, 750, 'Code'), pdfText(170, 750, 'Description'), pdfText(460, 750, 'Qty'),
    // Intentionally emit cells out of reading order and split description words.
    pdfText(475, 724, '2'), pdfText(197, 724, 'screen'), pdfText(50, 724, 'L001'), pdfText(170, 724, 'LED'), pdfText(170, 704, 'with mounting bracket'),
    pdfText(170, 674, 'Cable'), pdfText(475, 674, '3'), pdfText(50, 40, 'Page 1 of 2')].join('\n');
  const page2 = [pdfText(70, 750, 'Code'), pdfText(190, 750, 'Description'), pdfText(480, 750, 'Qty'), pdfText(70, 724, 'S002'), pdfText(190, 724, 'Speaker'), pdfText(495, 724, '1')].join('\n');
  for (const grid of ['', '50 760 m 520 760 l S 50 740 m 520 740 l S 50 660 m 520 660 l S 50 660 m 50 760 l S 150 660 m 150 760 l S 440 660 m 440 760 l S 520 660 m 520 760 l S']) {
    const result = await previewPdf([page1 + '\n' + grid, page2]);
    assert.equal(result.status, 200); assert.equal(result.data.hasHeader, true);
    assert.deepEqual(result.data.columns, { name: 1, code: 0, quantity: 2 });
    assert.deepEqual(result.data.rows, [['Code', 'Description', 'Qty'], ['L001', 'LED screen with mounting bracket', '2'], ['', 'Cable', '3'], ['S002', 'Speaker', '1']]);
    assert.ok(result.data.warning.includes('3 PDF columns'));
  }
});
test('PDFs without headers preserve every equipment row and empty cell', async () => {
  const page = [pdfText(50, 750, 'L001'), pdfText(170, 750, 'Lamp'), pdfText(475, 750, '2'), pdfText(170, 724, 'Cable'), pdfText(475, 724, '3'), pdfText(50, 698, 'S001'), pdfText(170, 698, 'Speaker'), pdfText(475, 698, '1')].join('\n');
  const result = await previewPdf([page]);
  assert.equal(result.status, 200); assert.equal(result.data.hasHeader, false);
  assert.deepEqual(result.data.rows, [['L001', 'Lamp', '2'], ['', 'Cable', '3'], ['S001', 'Speaker', '1']]);
  assert.ok(result.data.warning.includes('without recognizable headers'));
});
test('Scanned pages are reported and PDFs without readable text are rejected', async () => {
  const result = await previewPdf([pdfText(50, 750, 'Lamp'), '']);
  assert.equal(result.status, 200); assert.ok(result.data.warning.includes('1 pages'));
  assert.equal((await previewPdf([''])).status, 400);
});
test('Bulk pallets receive consecutive numbering per shipment', async () => {
  const shipment = (await request('/shipments', 'POST', { name: 'Bulkpalletten' })).data;
  const endpoint = `/shipments/${shipment.id}/pallets`;
  assert.deepEqual((await request(endpoint, 'POST', { quantity: 3 })).data.pallets.map(p => p.name), ['Pallet 1', 'Pallet 2', 'Pallet 3']);
  assert.deepEqual((await request(endpoint, 'POST', { quantity: 2 })).data.pallets.map(p => p.name), ['Pallet 4', 'Pallet 5']);
  await request(endpoint, 'POST', { name: 'Pallet 8' });
  assert.equal((await request(endpoint, 'POST', {})).data.pallets[0].name, 'Pallet 9');
  const concurrent = await Promise.all([request(endpoint, 'POST', { quantity: 2 }), request(endpoint, 'POST', { quantity: 2 })]);
  assert.deepEqual(concurrent.flatMap(result => result.data.pallets.map(p => p.name)).sort(), ['Pallet 10', 'Pallet 11', 'Pallet 12', 'Pallet 13']);
  const before = (await request(`/shipments/${shipment.id}`)).data.pallets.length;
  for (const quantity of [0, -1, 1.5, 201, 'abc']) assert.equal((await request(endpoint, 'POST', { quantity })).status, 400);
  assert.equal((await request(endpoint, 'POST', { name: 'Pallet 1' })).status, 400);
  assert.equal((await request(`/shipments/${shipment.id}`)).data.pallets.length, before);
  const other = (await request('/shipments', 'POST', { name: 'Nieuwe nummering' })).data;
  assert.equal((await request(`/shipments/${other.id}/pallets`, 'POST', { quantity: 1 })).data.pallets[0].name, 'Pallet 1');
});
test('Item numbering continues per name across additions, imports and pallet changes', async () => {
  const shipment = (await request('/shipments', 'POST', { name: 'Objectnummering' })).data;
  const endpoint = `/shipments/${shipment.id}`;
  await request(`${endpoint}/items`, 'POST', { rows: [{ name: 'LED-scherm', quantity: 2 }, { name: 'Kabel', quantity: 1 }] });
  await request(`${endpoint}/items`, 'POST', { rows: [{ name: 'LED-scherm', quantity: 1 }, { name: 'LED-scherm', quantity: 2 }, { name: 'Kabel', quantity: 1 }] });
  const data = (await request(endpoint)).data;
  assert.deepEqual(data.items.map(i => i.displayName), ['LED-scherm 1', 'LED-scherm 2', 'Kabel 1', 'LED-scherm 3', 'LED-scherm 4', 'LED-scherm 5', 'Kabel 2']);
  assert.equal(data.items[0].name, 'LED-scherm');
  const pallet = (await request(`${endpoint}/pallets`, 'POST', { quantity: 1 })).data;
  assert.equal((await request(`/items/${data.items[0].id}`, 'PATCH', { palletId: pallet.id })).data.displayName, 'LED-scherm 1');
  await stop(); await start();
  assert.deepEqual((await request(endpoint)).data.items.map(i => i.displayName), data.items.map(i => i.displayName));
  await request(`${endpoint}/items`, 'POST', { rows: [{ name: 'led-scherm', quantity: 1 }] });
  assert.equal((await request(endpoint)).data.items.at(-1).instanceNumber, 6);
  const other = (await request('/shipments', 'POST', { name: 'Andere objectnummering' })).data;
  await request(`/shipments/${other.id}/items`, 'POST', { rows: [{ name: 'LED-scherm' }] });
  assert.equal((await request(`/shipments/${other.id}`)).data.items[0].displayName, 'LED-scherm 1');
});
test('Existing items receive stable numbers without losing tracking or assignment', async () => {
  let data = (await request('/shipments/legacy')).data;
  assert.deepEqual(data.items.map(i => i.displayName), ['Lamp 1', 'Lamp 2']);
  assert.equal(data.items[0].palletId, 'legacy-pallet');
  assert.equal(data.items[0].statuses.outWarehouse, '2026-10-05T12:00:00Z');
  assert.equal(data.items[0].note, 'Bestaand object');
  await request('/shipments/legacy/items', 'POST', { rows: [{ name: 'Lamp', quantity: 1 }] });
  assert.equal((await request('/shipments/legacy')).data.items.at(-1).displayName, 'Lamp 3');
  const pallets = (await request('/shipments/legacy/pallets', 'POST', { quantity: 2 })).data;
  assert.deepEqual(pallets.pallets.map(p => p.name), ['Pallet 5', 'Pallet 6']);
});

async function createMember(email, name = 'User', role = 'member', participates = false) {
  const result = await request('/users', 'POST', { name, email, role, password: 'member-password-123' });
  assert.equal(result.status, 201); assert.equal('passwordHash' in result.data, false);
  const session = { cookie: '', csrfToken: '' };
  assert.equal((await request('/auth/login', 'POST', { email, password: 'member-password-123' }, session)).status, 200);
  if (participates) await request('/auth/profile', 'PATCH', { nickname: '', challengeParticipating: true }, session);
  return { user: result.data, session };
}
test('Login and CSRF are required and users cannot promote themselves', async () => {
  const { session } = await createMember('security@example.test');
  assert.equal((await request('/users', 'GET', undefined, session)).status, 403);
  assert.equal((await request('/users', 'POST', { role: 'admin' }, session)).status, 403);
  assert.equal((await request('/shipments', 'POST', { name: 'Zonder CSRF' }, session, { 'X-CSRF-Token': '' })).status, 403);
  assert.equal((await request('/auth/login', 'POST', { email: 'security@example.test', password: 'member-password-123' }, null, { 'X-Palletshipper': '' })).status, 403);
  assert.equal((await request('/auth/login', 'POST', { email: 'security@example.test', password: 'member-password-123' }, null, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await request('/import-preview', 'POST', undefined, null)).status, 401);
  assert.equal((await request('/health', 'GET', undefined, null)).status, 200);
  assert.equal((await request('/auth/logout', 'POST', undefined, session)).status, 200);
  assert.equal((await request('/shipments', 'GET', undefined, session)).status, 401);
});
test('Shipment permissions protect lists, items, pallets and photos and can be revoked', async () => {
  const owner = await createMember('owner@example.test', 'Maker');
  const member = await createMember('assigned@example.test', 'Toegewezen');
  const shipment = (await request('/shipments', 'POST', { name: 'Privéshipment', ownerId: 'legacy' }, owner.session)).data;
  assert.equal(shipment.ownerId, owner.user.id); assert.equal(shipment.canManage, true);
  const endpoint = `/shipments/${shipment.id}`;
  const pallet = (await request(`${endpoint}/pallets`, 'POST', { quantity: 1 }, owner.session)).data;
  await request(`${endpoint}/items`, 'POST', { rows: [{ name: 'Privéobject', quantity: 1, palletId: pallet.id }] }, owner.session);
  const item = (await request(endpoint, 'GET', undefined, owner.session)).data.items[0];
  const form = new FormData(); form.append('file', new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=', 'base64')]), 'foto.png');
  await request(`/pallets/${pallet.id}/photo`, 'POST', form, owner.session);
  const photo = (await request(endpoint, 'GET', undefined, owner.session)).data.pallets[0].photo;
  const getPhoto = async session => fetch(`http://127.0.0.1:${port}${photo}`, { headers: session ? { Cookie: session.cookie } : {} });
  assert.equal((await request('/shipments', 'GET', undefined, member.session)).data.some(s => s.id === shipment.id), false);
  assert.equal((await request(endpoint, 'GET', undefined, member.session)).status, 404);
  assert.equal((await request(`${endpoint}/pallets`, 'POST', { quantity: 1 }, member.session)).status, 404);
  assert.equal((await request(`${endpoint}/items`, 'POST', { rows: [{ name: 'Verboden' }] }, member.session)).status, 404);
  assert.equal((await request(`/items/${item.id}`, 'PATCH', { status: 'outWarehouse', checked: true }, member.session)).status, 404);
  assert.equal((await request(`/pallets/${pallet.id}/photo`, 'POST', form, member.session)).status, 404);
  assert.equal((await getPhoto(member.session)).status, 404); assert.equal((await getPhoto(null)).status, 401);
  assert.equal((await request(`${endpoint}/access`, 'PUT', { userIds: [member.user.id] }, owner.session)).status, 200);
  assert.equal((await request(`${endpoint}/access`, 'GET', undefined, member.session)).status, 404);
  assert.equal((await request(`${endpoint}/access`, 'PUT', { userIds: [] }, member.session)).status, 404);
  assert.equal((await request(endpoint, 'GET', undefined, member.session)).status, 200);
  assert.equal((await request('/shipments', 'GET', undefined, member.session)).data.find(s => s.id === shipment.id).canManage, false);
  assert.equal((await request(`/items/${item.id}`, 'PATCH', { status: 'outWarehouse', checked: true }, member.session)).status, 200);
  const image = await getPhoto(member.session); assert.equal(image.status, 200); assert.equal(image.headers.get('cache-control'), 'no-store');
  assert.equal((await request(endpoint)).status, 200);
  await request(`${endpoint}/access`, 'PUT', { userIds: [] }, owner.session);
  assert.equal((await request(endpoint, 'GET', undefined, member.session)).status, 404); assert.equal((await getPhoto(member.session)).status, 404);
  assert.equal((await request(`/items/${item.id}`, 'PATCH', { status: 'outWarehouse', checked: false }, member.session)).status, 404);
  assert.ok((await request(endpoint)).data.items[0].statuses.outWarehouse);
  assert.equal((await request('/shipments/legacy', 'GET', undefined, member.session)).status, 404);
});
test('Tracking columns can be hidden independently per user and shipment without losing status', async () => {
  const member = await createMember('columns@example.test');
  const shipment = (await request('/shipments', 'POST', { name: 'Kolommen' }, member.session)).data;
  const endpoint = `/shipments/${shipment.id}`;
  await request(`${endpoint}/items`, 'POST', { rows: [{ name: 'Lamp' }] }, member.session);
  const initial = (await request(endpoint, 'GET', undefined, member.session)).data;
  const all = { outWarehouse: true, inLocation: true, outLocation: true, inWarehouse: true };
  assert.deepEqual(initial.columns, all);
  await request(`/items/${initial.items[0].id}`, 'PATCH', { status: 'outWarehouse', checked: true }, member.session);
  for (const key of Object.keys(all)) {
    const columns = { ...all, [key]: false };
    assert.equal((await request(`${endpoint}/columns`, 'PUT', { columns }, member.session)).status, 200);
    assert.deepEqual((await request(endpoint, 'GET', undefined, member.session)).data.columns, columns);
    assert.deepEqual((await request(endpoint)).data.columns, all);
  }
  const hidden = Object.fromEntries(Object.keys(all).map(key => [key, false]));
  await request(`${endpoint}/columns`, 'PUT', { columns: hidden }, member.session);
  await stop(); await start();
  const persisted = (await request(endpoint, 'GET', undefined, member.session)).data;
  assert.deepEqual(persisted.columns, hidden); assert.ok(persisted.items[0].statuses.outWarehouse);
  assert.equal((await request(`${endpoint}/columns`, 'PUT', { columns: { outWarehouse: 'false' } }, member.session)).status, 400);
  assert.deepEqual((await request(endpoint, 'GET', undefined, member.session)).data.columns, hidden);
  const other = (await request('/shipments', 'POST', { name: 'Andere kolommen' }, member.session)).data;
  assert.deepEqual((await request(`/shipments/${other.id}`, 'GET', undefined, member.session)).data.columns, all);
});
test('User management supports deactivation, password resets and session revocation', async () => {
  const currentAdmin = (await request('/auth/session')).data.user;
  assert.equal((await request(`/users/${currentAdmin.id}`, 'PATCH', { role: 'member' })).status, 400);
  assert.equal((await request(`/users/${currentAdmin.id}`, 'PATCH', { active: false })).status, 400);
  const { user, session } = await createMember('account@example.test', 'Accounttest');
  assert.equal((await request('/users', 'POST', { name: 'Dubbel', email: user.email, password: 'member-password-123' })).status, 400);
  await request(`/users/${user.id}`, 'PATCH', { active: false });
  assert.equal((await request('/shipments', 'GET', undefined, session)).status, 401);
  assert.equal((await request('/auth/login', 'POST', { email: user.email, password: 'member-password-123' }, session)).status, 401);
  await request(`/users/${user.id}`, 'PATCH', { active: true, password: 'replacement-password-123' });
  assert.equal((await request('/auth/login', 'POST', { email: user.email, password: 'member-password-123' }, session)).status, 401);
  assert.equal((await request('/auth/login', 'POST', { email: user.email, password: 'replacement-password-123' }, session)).status, 200);
  await request(`/users/${user.id}`, 'PATCH', { role: 'admin' });
  assert.equal((await request('/users', 'GET', undefined, session)).status, 401);
  await request('/auth/login', 'POST', { email: user.email, password: 'replacement-password-123' }, session);
  assert.equal((await request('/users', 'GET', undefined, session)).status, 200);
  await request(`/users/${user.id}`, 'PATCH', { role: 'member' });
});
test('Password changes terminate other sessions and secrets are not stored as plaintext', async () => {
  const { user, session } = await createMember('password@example.test');
  const other = { cookie: '', csrfToken: '' };
  await request('/auth/login', 'POST', { email: user.email, password: 'member-password-123' }, other);
  assert.equal((await request('/auth/password', 'POST', { currentPassword: 'wrong', password: 'new-password-1234' }, session)).status, 400);
  assert.equal((await request('/auth/password', 'POST', { currentPassword: 'member-password-123', password: 'new-password-1234' }, session)).status, 200);
  assert.equal((await request('/shipments', 'GET', undefined, session)).status, 200);
  assert.equal((await request('/shipments', 'GET', undefined, other)).status, 401);
  const connection = new DatabaseSync(path.join(dir, 'shipments.sqlite'));
  const stored = connection.prepare('SELECT passwordHash FROM users WHERE id=?').get(user.id);
  assert.notEqual(stored.passwordHash, 'new-password-1234'); assert.ok(stored.passwordHash.includes(':'));
  const token = session.cookie.split('=')[1];
  assert.equal(connection.prepare('SELECT 1 FROM sessions WHERE tokenHash=?').get(token), undefined);
  connection.prepare('UPDATE sessions SET expiresAt=0 WHERE userId=?').run(user.id); connection.close();
  assert.equal((await request('/shipments', 'GET', undefined, session)).status, 401);
});
test('Repeated invalid login attempts are limited', async () => {
  for (let i = 0; i < 10; i++) assert.equal((await request('/auth/login', 'POST', { email: 'unknown@example.test', password: 'wrong' }, null, { 'X-Forwarded-For': '192.0.2.23' })).status, 401);
  assert.equal((await request('/auth/login', 'POST', { email: 'unknown@example.test', password: 'wrong' }, null, { 'X-Forwarded-For': '192.0.2.23' })).status, 429);
});
test('Production sessions use Secure cookies and the public healthcheck remains accessible', async () => {
  await stop(); await start({ NODE_ENV: 'production' });
  const session = { cookie: '', csrfToken: '' };
  const result = await request('/auth/login', 'POST', { email: 'admin@example.test', password: 'test-password-123' }, session);
  assert.equal(result.status, 200);
  assert.ok(result.headers.get('set-cookie').includes('Secure'));
  assert.equal((await request('/health', 'GET', undefined, null)).status, 200);
});
test('Item editing preserves tracking and validates every change before saving', async () => {
  const shipment = (await request('/shipments', 'POST', { name: 'Objectbewerking' })).data;
  const endpoint = `/shipments/${shipment.id}`;
  await request(`${endpoint}/items`, 'POST', { rows: [{ name: 'Lamp', quantity: 2 }, { name: 'Kabel' }] });
  const items = (await request(endpoint)).data.items, id = items[0].id;
  const pallet = (await request(`${endpoint}/pallets`, 'POST', { quantity: 1 })).data;
  const tracked = (await request(`/items/${id}`, 'PATCH', { status: 'outWarehouse', checked: true })).data;
  const edited = await request(`/items/${id}`, 'PATCH', { name: 'LED-lamp', code: 'LED1', note: 'Fragiel', palletId: pallet.id });
  assert.equal(edited.status, 200); assert.equal(edited.data.displayName, 'LED-lamp 1');
  assert.deepEqual(edited.data.statuses, tracked.statuses); assert.equal(edited.data.code, 'LED1'); assert.equal(edited.data.note, 'Fragiel');
  assert.equal((await request(`/items/${id}`, 'PATCH', { name: ' ', code: 'Niet opslaan', palletId: null })).status, 400);
  assert.equal((await request(endpoint)).data.items[0].code, 'LED1'); assert.equal((await request(endpoint)).data.items[0].palletId, pallet.id);
  assert.equal((await request(`/items/${id}`, 'PATCH', { name: 'Kabel' })).data.displayName, 'Kabel 2');
  assert.equal((await request(`/items/${id}`, 'PATCH', { name: 'Kabel', note: 'x'.repeat(1001) })).status, 400);
  const stranger = await createMember('edit-stranger@example.test');
  assert.equal((await request(`/items/${id}`, 'PATCH', { name: 'Verboden' }, stranger.session)).status, 404);
  assert.equal((await request(`/items/${id}`, 'DELETE', undefined, stranger.session)).status, 404);
  assert.equal((await request(`/items/${id}`, 'DELETE', undefined, null)).status, 401);
  assert.equal((await request(`/items/${id}`, 'DELETE', undefined, adminSession, { 'X-CSRF-Token': '' })).status, 403);
  assert.equal((await request(`/items/${id}`, 'DELETE')).status, 200);
  assert.equal((await request(endpoint)).data.items.length, 2);
  assert.equal((await request(`/items/${id}`, 'DELETE')).status, 404);
});
test('Deleting items never reuses their numbers, including after a restart', async () => {
  const shipment = (await request('/shipments', 'POST', { name: 'Verwijdernummering' })).data;
  const endpoint = `/shipments/${shipment.id}`;
  await request(`${endpoint}/items`, 'POST', { rows: [{ name: 'Lamp', quantity: 2 }] });
  const items = (await request(endpoint)).data.items;
  for (const item of items) await request(`/items/${item.id}`, 'DELETE');
  await stop(); await start();
  await request(`${endpoint}/items`, 'POST', { rows: [{ name: 'Lamp' }] });
  assert.equal((await request(endpoint)).data.items[0].displayName, 'Lamp 3');
});
test('Multiple pallet photos are preserved and deletion removes only the selected file', async () => {
  const shipment = (await request('/shipments', 'POST', { name: 'Fotogalerij' })).data;
  const endpoint = `/shipments/${shipment.id}`;
  const pallet = (await request(`${endpoint}/pallets`, 'POST', { quantity: 1 })).data;
  const batch = new FormData();
  for (let i = 0; i < 3; i++) batch.append('files', new Blob([pngSample]), `foto-${i}.png`);
  const result = await request(`/pallets/${pallet.id}/photos`, 'POST', batch);
  assert.equal(result.status, 200); assert.equal(result.data.added, 3);
  let gallery = (await request(endpoint)).data.pallets[0];
  assert.equal(gallery.photos.length, 3); assert.equal(new Set(gallery.photos.map(photo => photo.id)).size, 3);
  const first = gallery.photos[0];
  const single = new FormData(); single.append('file', new Blob([pngSample]), 'extra.png');
  await request(`/pallets/${pallet.id}/photo`, 'POST', single);
  assert.equal((await request(endpoint)).data.pallets[0].photos.length, 4);
  await stop(); await start();
  gallery = (await request(endpoint)).data.pallets[0]; assert.equal(gallery.photos.length, 4); assert.equal(gallery.photos[0].id, first.id);
  const stranger = await createMember('gallery-stranger@example.test');
  const deleteEndpoint = `/pallets/${pallet.id}/photos/${first.id}`;
  assert.equal((await request(deleteEndpoint, 'DELETE', undefined, stranger.session)).status, 404);
  assert.equal((await request(deleteEndpoint, 'DELETE', undefined, null)).status, 401);
  assert.equal((await request(deleteEndpoint, 'DELETE', undefined, adminSession, { 'X-CSRF-Token': '' })).status, 403);
  assert.equal((await request(deleteEndpoint, 'DELETE')).status, 200);
  assert.equal(existsSync(path.join(dir, 'uploads', path.basename(first.url))), false);
  gallery = (await request(endpoint)).data.pallets[0]; assert.equal(gallery.photos.length, 3); assert.equal(gallery.photo, gallery.photos[0].url);
  assert.equal((await fetch(`http://127.0.0.1:${port}${first.url}`, { headers: { Cookie: adminSession.cookie } })).status, 404);
  assert.equal((await request(deleteEndpoint, 'DELETE')).status, 404);
  const mixed = new FormData(); mixed.append('files', new Blob([pngSample]), 'valid.png'); mixed.append('files', new Blob(['invalid']), 'invalid.png');
  assert.equal((await request(`/pallets/${pallet.id}/photos`, 'POST', mixed)).status, 400);
  assert.equal((await request(endpoint)).data.pallets[0].photos.length, 3);
  const tooMany = new FormData(); for (let i = 0; i < 11; i++) tooMany.append('files', new Blob([pngSample]), `foto-${i}.png`);
  assert.equal((await request(`/pallets/${pallet.id}/photos`, 'POST', tooMany)).status, 400);
});
test('Legacy photos are migrated once and do not return after deletion', async () => {
  let pallet = (await request('/shipments/legacy')).data.pallets.find(p => p.id === 'legacy-pallet');
  assert.equal(pallet.photos.length, 1); assert.equal(pallet.photos[0].url, '/uploads/legacy.png');
  await stop(); await start();
  pallet = (await request('/shipments/legacy')).data.pallets.find(p => p.id === 'legacy-pallet'); assert.equal(pallet.photos.length, 1);
  assert.equal((await request(`/pallets/${pallet.id}/photos/${pallet.photos[0].id}`, 'DELETE')).status, 200);
  await stop(); await start();
  pallet = (await request('/shipments/legacy')).data.pallets.find(p => p.id === 'legacy-pallet'); assert.deepEqual(pallet.photos, []); assert.equal(pallet.photo, null);
});
test('Packing lists and A6 labels respect the selected pallet, permissions and column preferences', async () => {
  const shipment = (await request('/shipments', 'POST', { name: 'Beurs <Antwerpen>', destination: 'Expo' })).data;
  const endpoint = `/shipments/${shipment.id}`;
  const pallets = (await request(`${endpoint}/pallets`, 'POST', { quantity: 2 })).data.pallets;
  await request(`${endpoint}/items`, 'POST', { rows: [{ name: 'Lamp', quantity: 2, palletId: pallets[0].id, note: '=1+1' }, { name: 'Andere pallet', palletId: pallets[1].id }, { name: 'Unassigned' }] });
  await request(`${endpoint}/columns`, 'PUT', { columns: { outWarehouse: true, inLocation: false, outLocation: false, inWarehouse: false } });
  const url = `/api/pallets/${pallets[0].id}/export`;
  const get = (format, session = adminSession) => fetch(`http://127.0.0.1:${port}${url}?format=${format}`, { headers: session ? { Cookie: session.cookie } : {} });
  const csv = await get('csv'); const text = await csv.text();
  assert.equal(csv.status, 200); assert.ok(csv.headers.get('content-disposition').includes('.csv'));
  assert.ok(text.includes('Lamp 1')); assert.ok(text.includes('Lamp 2')); assert.ok(text.includes("'=1+1")); assert.ok(text.includes('Out warehouse')); assert.ok(!text.includes('In location')); assert.ok(!text.includes('Andere pallet')); assert.ok(!text.includes('Unassigned'));
  const excel = await get('xlsx'); const book = XLSX.read(Buffer.from(await excel.arrayBuffer()), { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { header: 1 });
  assert.equal(rows.length, 3); assert.equal(rows[1][2], 'Lamp 1'); assert.equal(book.Sheets[book.SheetNames[0]].F2.f, undefined);
  const label = await (await get('label')).text(); assert.ok(label.includes('105mm 148mm')); assert.ok(label.includes('Beurs &lt;Antwerpen&gt;')); assert.ok(label.includes('Pallet 1')); assert.ok(label.includes('Palletshipper.'));
  const print = await (await get('print')).text(); assert.ok(print.includes('A4 landscape')); assert.ok(print.includes('Lamp 2')); assert.ok(!print.includes('Andere pallet'));
  const stranger = await createMember('export-stranger@example.test'); assert.equal((await get('label', stranger.session)).status, 404); assert.equal((await get('csv', null)).status, 401);
  const logo = new FormData(); logo.append('file', new Blob([pngSample]), 'logo.png');
  assert.equal((await request(`${endpoint}/logo`, 'POST', logo)).status, 200);
  assert.equal((await request(endpoint)).data.hasLogo, true);
  const branded = await (await get('label')).text(); assert.ok(branded.includes('data:image/png;base64,')); assert.ok(!branded.includes('<span>Palletshipper.</span>'));
  assert.equal((await request(`${endpoint}/logo`, 'POST', logo, stranger.session)).status, 404);
  await request(`${endpoint}/access`, 'PUT', { userIds: [stranger.user.id] });
  assert.equal((await get('label', stranger.session)).status, 200);
  assert.equal((await request(`${endpoint}/logo`, 'POST', logo, stranger.session)).status, 404);
  await stop(); await start(); assert.ok((await (await get('label')).text()).includes('data:image/png;base64,'));
  await request(`${endpoint}/logo`, 'DELETE'); assert.equal((await request(endpoint)).data.hasLogo, false);
});
test('Whole shipment exports include every pallet list and one A6 label per pallet', async () => {
  const shipment = (await request('/shipments', 'POST', { name: 'Volledige export' })).data;
  const endpoint = `/shipments/${shipment.id}`;
  const pallets = (await request(`${endpoint}/pallets`, 'POST', { quantity: 3 })).data.pallets;
  await request(`${endpoint}/items`, 'POST', { rows: [{ name: 'Lamp', quantity: 2, palletId: pallets[0].id }, { name: 'Kabel', palletId: pallets[1].id }, { name: 'Los object' }] });
  const get = (format, session = adminSession) => fetch(`http://127.0.0.1:${port}/api${endpoint}/export?format=${format}`, { headers: session ? { Cookie: session.cookie } : {} });
  const book = XLSX.read(Buffer.from(await (await get('xlsx')).arrayBuffer()), { type: 'buffer' });
  assert.equal(book.SheetNames.length, 5); assert.equal(book.SheetNames[0], 'Overview'); assert.ok(book.SheetNames.includes('Unassigned'));
  const first = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[1]], { header: 1 }); assert.equal(first.length, 3); assert.equal(first[1][1], 'Pallet 1');
  const empty = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[3]], { header: 1 }); assert.equal(empty.length, 1);
  const csv = await (await get('csv')).text(); assert.ok(csv.includes('Lamp 2')); assert.ok(csv.includes('Kabel 1')); assert.ok(csv.includes('Unassigned')); assert.ok(csv.includes('Los object 1'));
  const label = await (await get('label')).text(); assert.equal((label.match(/class="label"/g) || []).length, 3); assert.ok(label.includes('break-after:page')); assert.ok(label.includes('Pallet 3')); assert.ok(!label.includes('Los object'));
  const print = await (await get('print')).text(); assert.equal((print.match(/class="packing-list"/g) || []).length, 4); assert.ok(print.includes('Pallet 3')); assert.ok(print.includes('Unassigned')); assert.ok(print.includes('break-before:page'));
  const stranger = await createMember('bulk-export-stranger@example.test'); assert.equal((await get('xlsx', stranger.session)).status, 404); assert.equal((await get('label', null)).status, 401);
  const emptyShipment = (await request('/shipments', 'POST', { name: 'Lege export' })).data;
  const response = await fetch(`http://127.0.0.1:${port}/api/shipments/${emptyShipment.id}/export?format=label`, { headers: { Cookie: adminSession.cookie } }); assert.equal(response.status, 400);
});

test('Pallet tracking starts empty after migration and remains independent of item tracking', async () => {
  assert.deepEqual((await request('/shipments/legacy')).data.pallets[0].statuses, {});
  const shipment = (await request('/shipments', 'POST', { name: 'Camionlading' })).data;
  const { pallets } = (await request(`/shipments/${shipment.id}/pallets`, 'POST', { quantity: 2 })).data;
  await request(`/shipments/${shipment.id}/items`, 'POST', { rows: [{ name: 'Kist', quantity: 2, palletId: pallets[0].id }] });
  let data = (await request(`/shipments/${shipment.id}`)).data;
  const item = data.items[0];
  for (const status of ['outWarehouse', 'inLocation', 'outLocation', 'inWarehouse']) {
    const result = await request(`/pallets/${pallets[0].id}`, 'PATCH', { status, checked: true });
    assert.equal(result.status, 200); assert.ok(result.data.statuses[status]);
  }
  data = (await request(`/shipments/${shipment.id}`)).data;
  assert.ok(data.items.every(i => Object.keys(i.statuses).length === 0));
  assert.deepEqual(data.pallets[1].statuses, {});
  const statuses = data.pallets[0].statuses;
  await request(`/items/${item.id}`, 'PATCH', { status: 'outWarehouse', checked: true });
  await request(`/items/${item.id}`, 'PATCH', { palletId: pallets[1].id });
  assert.deepEqual((await request(`/shipments/${shipment.id}`)).data.pallets[0].statuses, statuses);
  await stop(); await start();
  data = (await request(`/shipments/${shipment.id}`)).data;
  assert.deepEqual(data.pallets[0].statuses, statuses);
  assert.equal((await request(`/pallets/${pallets[0].id}`, 'PATCH', { status: 'outWarehouse', checked: false })).data.statuses.outWarehouse, null);
  assert.ok((await request(`/shipments/${shipment.id}`)).data.items[0].statuses.outWarehouse);
  await request(`/items/${item.id}`, 'DELETE');
  assert.ok((await request(`/shipments/${shipment.id}`)).data.pallets[0].statuses.inWarehouse);
});

test('Pallet status requires shipment access, valid stages and boolean values', async () => {
  const pallet = (await request('/shipments/legacy')).data.pallets[0];
  for (const body of [{ status: 'invalid', checked: true }, { status: 'outWarehouse', checked: 'true' }, {}]) {
    assert.equal((await request(`/pallets/${pallet.id}`, 'PATCH', body)).status, 400);
  }
  assert.equal((await request('/pallets/missing', 'PATCH', { status: 'outWarehouse', checked: true })).status, 404);
  assert.equal((await request(`/pallets/${pallet.id}`, 'PATCH', { status: 'outWarehouse', checked: true }, null)).status, 401);
  const member = {};
  await request('/users', 'POST', { name: 'Lader', email: 'loader@example.test', password: 'test-password-123', role: 'member' });
  await request('/auth/login', 'POST', { email: 'loader@example.test', password: 'test-password-123' }, member);
  assert.equal((await request(`/pallets/${pallet.id}`, 'PATCH', { status: 'outWarehouse', checked: true }, member)).status, 404);
  assert.deepEqual((await request('/shipments/legacy')).data.pallets[0].statuses, {});
});

test('Archiving and restoring preserve content and require management permissions', async () => {
  const member = await createMember('archive-member@example.test');
  const shipment = (await request('/shipments', 'POST', { name: 'Archieftest' })).data;
  const pallet = (await request(`/shipments/${shipment.id}/pallets`, 'POST', {})).data;
  await request(`/shipments/${shipment.id}/items`, 'POST', { rows: [{ name: 'Lamp', palletId: pallet.id }] });
  await request(`/shipments/${shipment.id}/access`, 'PUT', { userIds: [member.user.id] });
  assert.equal((await request(`/shipments/${shipment.id}`, 'PATCH', { archived: true }, member.session)).status, 404);
  assert.equal((await request(`/shipments/${shipment.id}`, 'PATCH', { archived: 'yes' })).status, 400);
  const before = (await request(`/shipments/${shipment.id}`)).data;
  assert.ok((await request(`/shipments/${shipment.id}`, 'PATCH', { archived: true })).data.archivedAt);
  await stop(); await start();
  assert.ok((await request('/shipments')).data.find(s => s.id === shipment.id).archivedAt);
  assert.deepEqual((await request(`/shipments/${shipment.id}`, 'GET', undefined, member.session)).data, before);
  assert.equal((await request(`/shipments/${shipment.id}`, 'PATCH', { archived: false })).data.archivedAt, null);
  const owned = (await request('/shipments', 'POST', { name: 'Eigen archief' }, member.session)).data;
  assert.equal((await request(`/shipments/${owned.id}`, 'PATCH', { archived: true }, member.session)).status, 200);
});

test('Shipment deletion requires confirmation and removes content and photo files', async () => {
  const member = await createMember('delete-shipment@example.test');
  const shipment = (await request('/shipments', 'POST', { name: 'Verwijdertest' })).data;
  const pallet = (await request(`/shipments/${shipment.id}/pallets`, 'POST', {})).data;
  await request(`/shipments/${shipment.id}/items`, 'POST', { rows: [{ name: 'Lamp', palletId: pallet.id }] });
  await request(`/shipments/${shipment.id}/access`, 'PUT', { userIds: [member.user.id] });
  const logo = new FormData(); logo.append('file', new Blob([pngSample], { type: 'image/png' }), 'logo.png');
  await request(`/shipments/${shipment.id}/logo`, 'POST', logo);
  const form = new FormData(); form.append('files', new Blob([pngSample], { type: 'image/png' }), 'photo.png');
  await request(`/pallets/${pallet.id}/photos`, 'POST', form);
  const data = (await request(`/shipments/${shipment.id}`)).data;
  const photo = data.pallets[0].photos[0];
  assert.ok(existsSync(path.join(dir, 'uploads', path.basename(photo.url))));
  assert.equal((await request(`/shipments/${shipment.id}`, 'DELETE', { confirmName: shipment.name }, member.session)).status, 404);
  assert.equal((await request(`/shipments/${shipment.id}`, 'DELETE', { confirmName: 'wrong' })).status, 400);
  assert.equal((await request(`/shipments/${shipment.id}`)).status, 200);
  assert.equal((await request(`/shipments/${shipment.id}`, 'DELETE', { confirmName: shipment.name })).status, 200);
  assert.equal((await request(`/shipments/${shipment.id}`)).status, 404);
  assert.equal((await request(`/items/${data.items[0].id}`, 'PATCH', { status: 'outWarehouse', checked: true })).status, 404);
  assert.equal((await request(`/pallets/${pallet.id}`, 'PATCH', { status: 'outWarehouse', checked: true })).status, 404);
  assert.equal(existsSync(path.join(dir, 'uploads', path.basename(photo.url))), false);
  const check = new DatabaseSync(path.join(dir, 'shipments.sqlite'));
  for (const table of ['items', 'pallets', 'item_sequences', 'shipment_access', 'column_preferences', 'shipment_logos']) assert.equal(check.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE shipmentId=?`).get(shipment.id).n, 0);
  check.close();
});

test('Archiving compresses photos, preserves tracking and does not recompress restored photos', async () => {
  const shipment = (await request('/shipments', 'POST', { name: 'Fotocompressie' })).data;
  const { pallets } = (await request(`/shipments/${shipment.id}/pallets`, 'POST', { quantity: 2 })).data;
  const pixels = randomBytes(2200 * 1400 * 3);
  const original = await sharp(pixels, { raw: { width: 2200, height: 1400, channels: 3 } }).png().toBuffer();
  for (const pallet of pallets) {
    const form = new FormData(); form.append('files', new Blob([original], { type: 'image/png' }), 'large.png');
    assert.equal((await request(`/pallets/${pallet.id}/photos`, 'POST', form)).status, 200);
  }
  await request(`/pallets/${pallets[0].id}`, 'PATCH', { status: 'outWarehouse', checked: true });
  const before = (await request(`/shipments/${shipment.id}`)).data;
  assert.equal((await request(`/shipments/${shipment.id}`, 'PATCH', { archived: true })).status, 200);
  const after = (await request(`/shipments/${shipment.id}`)).data;
  assert.deepEqual(after.pallets[0].statuses, before.pallets[0].statuses);
  for (let i = 0; i < pallets.length; i++) {
    const photo = after.pallets[i].photos[0]; assert.ok(photo.compressedAt); assert.equal(photo.id, before.pallets[i].photos[0].id);
    const bytes = readFileSync(path.join(dir, 'uploads', path.basename(photo.url)));
    assert.ok(bytes.length < original.length);
    const metadata = await sharp(bytes).metadata(); assert.equal(metadata.format, 'webp'); assert.equal(metadata.width, 1600); assert.ok(metadata.height <= 1600);
    assert.equal(existsSync(path.join(dir, 'uploads', path.basename(before.pallets[i].photos[0].url))), false);
    const response = await fetch(`http://127.0.0.1:${port}${photo.url}`, { headers: { Cookie: adminSession.cookie } }); assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /image\/webp/);
  }
  const form = new FormData(); form.append('files', new Blob([original]), 'new.png');
  assert.equal((await request(`/pallets/${pallets[0].id}/photos`, 'POST', form)).status, 409);
  await request(`/shipments/${shipment.id}`, 'PATCH', { archived: false });
  await request(`/shipments/${shipment.id}`, 'PATCH', { archived: true });
  assert.deepEqual((await request(`/shipments/${shipment.id}`)).data.pallets, after.pallets);
});

test('Unreadable photos prevent archiving and preserve originals', async () => {
  const shipment = (await request('/shipments', 'POST', { name: 'Beschadigde foto' })).data;
  const pallet = (await request(`/shipments/${shipment.id}/pallets`, 'POST', {})).data;
  const valid = await sharp({ create: { width: 2000, height: 1000, channels: 3, background: '#abcdef' } }).png().toBuffer();
  const invalid = Buffer.from([137,80,78,71,13,10,26,10]);
  const form = new FormData(); form.append('files', new Blob([valid]), 'valid.png'); form.append('files', new Blob([invalid]), 'broken.png');
  await request(`/pallets/${pallet.id}/photos`, 'POST', form);
  const before = (await request(`/shipments/${shipment.id}`)).data;
  assert.equal((await request(`/shipments/${shipment.id}`, 'PATCH', { archived: true })).status, 400);
  assert.equal((await request('/shipments')).data.find(s => s.id === shipment.id).archivedAt, null);
  assert.deepEqual((await request(`/shipments/${shipment.id}`)).data, before);
  for (const photo of before.pallets[0].photos) assert.ok(existsSync(path.join(dir, 'uploads', path.basename(photo.url))));
});

test('Pallet columns are independent per user and shipment and preserve tracking', async () => {
  const member = await createMember('pallet-columns@example.test');
  const shipment = (await request('/shipments', 'POST', { name: 'Kolommen pallet' })).data;
  const pallet = (await request(`/shipments/${shipment.id}/pallets`, 'POST', {})).data;
  await request(`/pallets/${pallet.id}`, 'PATCH', { status: 'outWarehouse', checked: true });
  await request(`/shipments/${shipment.id}/access`, 'PUT', { userIds: [member.user.id] });
  const columns = { outWarehouse: false, inLocation: true, outLocation: false, inWarehouse: true };
  assert.equal((await request(`/shipments/${shipment.id}/pallet-columns`, 'PUT', { columns })).status, 200);
  let data = (await request(`/shipments/${shipment.id}`)).data;
  assert.deepEqual(data.palletColumns, columns); assert.ok(data.columns.outWarehouse); assert.ok(data.pallets[0].statuses.outWarehouse);
  assert.ok((await request(`/shipments/${shipment.id}`, 'GET', undefined, member.session)).data.palletColumns.outWarehouse);
  await request(`/shipments/${shipment.id}/columns`, 'PUT', { columns: { ...columns, inLocation: false } });
  assert.deepEqual((await request(`/shipments/${shipment.id}`)).data.palletColumns, columns);
  const other = (await request('/shipments', 'POST', { name: 'Andere kolommen' })).data;
  assert.ok((await request(`/shipments/${other.id}`)).data.palletColumns.outWarehouse);
  assert.equal((await request(`/shipments/${other.id}/pallet-columns`, 'PUT', { columns }, member.session)).status, 404);
  assert.equal((await request(`/shipments/${shipment.id}/pallet-columns`, 'PUT', { columns: { outWarehouse: false } })).status, 400);
  await stop(); await start();
  assert.deepEqual((await request(`/shipments/${shipment.id}`)).data.palletColumns, columns);
});

test('Renaming and deleting pallets preserve items and tracking and remove photo files', async () => {
  const shipment = (await request('/shipments', 'POST', { name: 'Palletbeheer' })).data;
  const { pallets } = (await request(`/shipments/${shipment.id}/pallets`, 'POST', { quantity: 2 })).data;
  await request(`/shipments/${shipment.id}/items`, 'POST', { rows: [{ name: 'Kist', palletId: pallets[0].id }] });
  let data = (await request(`/shipments/${shipment.id}`)).data;
  await request(`/items/${data.items[0].id}`, 'PATCH', { status: 'outWarehouse', checked: true });
  await request(`/pallets/${pallets[0].id}`, 'PATCH', { status: 'inLocation', checked: true });
  const form = new FormData(); form.append('files', new Blob([pngSample]), 'photo.png');
  await request(`/pallets/${pallets[0].id}/photos`, 'POST', form);
  const before = (await request(`/shipments/${shipment.id}`)).data;
  assert.equal((await request(`/pallets/${pallets[0].id}`, 'PATCH', { name: '  Transportkist  ' })).data.name, 'Transportkist');
  data = (await request(`/shipments/${shipment.id}`)).data;
  assert.deepEqual(data.items, before.items); assert.deepEqual(data.pallets[0].statuses, before.pallets[0].statuses); assert.deepEqual(data.pallets[0].photos, before.pallets[0].photos);
  for (const name of ['', '   ', 'x'.repeat(201), 'pallet 2']) assert.equal((await request(`/pallets/${pallets[0].id}`, 'PATCH', { name })).status, 400);
  const member = await createMember('pallet-edit@example.test');
  assert.equal((await request(`/pallets/${pallets[0].id}`, 'PATCH', { name: 'Unauthorized' }, member.session)).status, 404);
  assert.equal((await request(`/pallets/${pallets[0].id}`, 'DELETE', undefined, member.session)).status, 404);
  assert.equal((await request(`/pallets/${pallets[0].id}`, 'DELETE')).status, 200);
  data = (await request(`/shipments/${shipment.id}`)).data;
  assert.deepEqual(data.items[0], { ...before.items[0], palletId: null, revision: data.items[0].revision }); assert.equal(data.pallets.length, 1);
  assert.equal(existsSync(path.join(dir, 'uploads', path.basename(before.pallets[0].photos[0].url))), false);
  assert.equal((await request(`/pallets/${pallets[0].id}`, 'DELETE')).status, 404);
  await stop(); await start(); assert.equal((await request(`/shipments/${shipment.id}`)).data.items[0].palletId, null);
});

test('Shipment name and location edits preserve archive state and content and require management access', async () => {
  const shipment = (await request('/shipments', 'POST', { name: 'Oude naam', destination: 'Gent' })).data;
  const pallet = (await request(`/shipments/${shipment.id}/pallets`, 'POST', {})).data;
  await request(`/shipments/${shipment.id}/items`, 'POST', { rows: [{ name: 'Kist', palletId: pallet.id }] });
  await request(`/shipments/${shipment.id}`, 'PATCH', { archived: true });
  const before = (await request(`/shipments/${shipment.id}`)).data;
  const member = await createMember('shipment-rename@example.test');
  await request(`/shipments/${shipment.id}/access`, 'PUT', { userIds: [member.user.id] });
  assert.equal((await request(`/shipments/${shipment.id}`, 'PATCH', { name: 'Verboden' }, member.session)).status, 404);
  const updated = await request(`/shipments/${shipment.id}`, 'PATCH', { name: '  Nieuwe naam  ', destination: ' Antwerpen ' });
  assert.equal(updated.status, 200); assert.equal(updated.data.name, 'Nieuwe naam'); assert.equal(updated.data.destination, 'Antwerpen'); assert.ok(updated.data.archivedAt);
  assert.deepEqual((await request(`/shipments/${shipment.id}`)).data, before);
  for (const body of [{ name: '' }, { name: 123 }, { destination: 'x'.repeat(201) }, { name: 'Bad update', archived: 'yes' }]) assert.equal((await request(`/shipments/${shipment.id}`, 'PATCH', body)).status, 400);
  assert.equal((await request('/shipments')).data.find(s => s.id === shipment.id).name, 'Nieuwe naam');
  assert.equal((await request(`/shipments/${shipment.id}`, 'PATCH', { destination: '' })).data.destination, '');
  await stop(); await start(); assert.equal((await request('/shipments')).data.find(s => s.id === shipment.id).name, 'Nieuwe naam');
});

test('Stale edits and deletions are rejected without overwriting newer data', async () => {
  const shipment = (await request('/shipments', 'POST', { name: 'Samenwerken' })).data;
  const pallet = (await request(`/shipments/${shipment.id}/pallets`, 'POST', {})).data;
  await request(`/shipments/${shipment.id}/items`, 'POST', { rows: [{ name: 'Lamp', palletId: pallet.id }] });
  const initial = (await request(`/shipments/${shipment.id}`)).data;
  const item = initial.items[0], p = initial.pallets[0];
  const edited = await request(`/items/${item.id}`, 'PATCH', { name: 'Nieuwe lamp', revision: item.revision });
  assert.equal(edited.status, 200); assert.notEqual(edited.data.revision, item.revision);
  assert.equal((await request(`/items/${item.id}`, 'PATCH', { note: 'Oude invoer', revision: item.revision })).status, 409);
  assert.equal((await request(`/items/${item.id}`, 'DELETE', { revision: item.revision })).status, 409);
  assert.equal((await request(`/pallets/${p.id}`, 'PATCH', { name: 'Nieuwe pallet', revision: p.revision })).status, 200);
  assert.equal((await request(`/pallets/${p.id}`, 'PATCH', { status: 'outWarehouse', checked: true, revision: p.revision })).status, 409);
  assert.equal((await request(`/pallets/${p.id}`, 'DELETE', { revision: p.revision })).status, 409);
  assert.equal((await request(`/shipments/${shipment.id}`, 'PATCH', { destination: 'Gent', revision: shipment.revision })).status, 200);
  assert.equal((await request(`/shipments/${shipment.id}`, 'PATCH', { name: 'Oud', revision: shipment.revision })).status, 409);
  assert.equal((await request(`/shipments/${shipment.id}`, 'DELETE', { confirmName: shipment.name, revision: shipment.revision })).status, 409);
  const current = (await request(`/shipments/${shipment.id}`)).data;
  assert.equal(current.items[0].name, 'Nieuwe lamp'); assert.equal(current.items[0].note, ''); assert.equal(current.pallets[0].name, 'Nieuwe pallet');
});

test('Shipment routes preserve outbound and return dates and appear on every label', async () => {
  const shipment = (await request('/shipments', 'POST', { name: 'Route', destination: 'Antwerpen', outboundDate: '2026-10-08', returnDestination: 'Gent', returnDate: '2026-10-12' })).data;
  assert.equal(shipment.outboundDate, '2026-10-08'); assert.equal(shipment.returnDestination, 'Gent');
  await request(`/shipments/${shipment.id}/pallets`, 'POST', { quantity: 2 });
  const response = await fetch(`http://127.0.0.1:${port}/api/shipments/${shipment.id}/export?format=label`, { headers: { Cookie: adminSession.cookie } });
  const html = await response.text(); assert.equal(response.status, 200);
  for (const value of ['Antwerpen', 'Gent', '08/10/2026', '12/10/2026']) assert.equal(html.split(value).length - 1, 2);
  for (const date of ['2026-02-30', '2026-13-01', '08/10/2026']) assert.equal((await request(`/shipments/${shipment.id}`, 'PATCH', { outboundDate: date })).status, 400);
  assert.equal((await request(`/shipments/${shipment.id}`, 'PATCH', { returnDestination: 'Brussel', returnDate: '' })).data.returnDate, '');
  await stop(); await start();
  const persisted = (await request('/shipments')).data.find(s => s.id === shipment.id);
  assert.equal(persisted.returnDestination, 'Brussel'); assert.equal(persisted.outboundDate, '2026-10-08');
});

test('The logo library saves uploads and reuses logos with management permissions', async () => {
  const shipment = (await request('/shipments', 'POST', { name: 'Bibliotheek' })).data;
  const form = new FormData(); form.append('file', new Blob([pngSample], { type: 'image/png' }), 'Bedrijfslogo.png');
  assert.equal((await request(`/shipments/${shipment.id}/logo`, 'POST', form)).status, 200);
  const logos = (await request('/logos')).data;
  assert.ok(logos.length > 0);
  const logo = logos.find(l => l.name === 'Bedrijfslogo') || logos[0];
  const target = (await request('/shipments', 'POST', { name: 'Herbruik logo' })).data;
  assert.equal((await request(`/shipments/${target.id}/logo`, 'PUT', { logoId: logo.id })).status, 200);
  assert.ok((await request(`/shipments/${target.id}`)).data.hasLogo);
  const member = await createMember('logo-library@example.test');
  assert.equal((await request('/logos', 'GET', undefined, null)).status, 401);
  assert.equal((await request(`/shipments/${target.id}/logo`, 'PUT', { logoId: logo.id }, member.session)).status, 404);
  assert.equal((await request(`/shipments/${target.id}/logo`, 'PUT', { logoId: 'missing' })).status, 404);
  await request(`/shipments/${shipment.id}/logo`, 'DELETE');
  assert.ok((await request(`/shipments/${target.id}`)).data.hasLogo);
  const before = (await request('/logos')).data.length;
  await stop(); await start(); assert.equal((await request('/logos')).data.length, before);
});

test('The logo library checks shipment access for listing, images and selection', async () => {
  const owner = await createMember('logo-owner@example.test');
  const viewer = await createMember('logo-viewer@example.test');
  const shipment = (await request('/shipments', 'POST', { name: 'Privé logo' }, owner.session)).data;
  const bytes = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#abc123' } }).png().toBuffer();
  const form = new FormData(); form.append('file', new Blob([bytes]), 'PrivaatLogo.png');
  await request(`/shipments/${shipment.id}/logo`, 'POST', form, owner.session);
  const logo = (await request('/logos', 'GET', undefined, owner.session)).data.find(l => l.name === 'PrivaatLogo'); assert.ok(logo);
  assert.equal((await request('/logos', 'GET', undefined, viewer.session)).data.some(l => l.id === logo.id), false);
  const imageStatus = async () => (await fetch(`http://127.0.0.1:${port}/api/logos/${logo.id}`, { headers: { Cookie: viewer.session.cookie } })).status;
  assert.equal(await imageStatus(), 404);
  const target = (await request('/shipments', 'POST', { name: 'Eigen shipment' }, viewer.session)).data;
  assert.equal((await request(`/shipments/${target.id}/logo`, 'PUT', { logoId: logo.id }, viewer.session)).status, 404);
  await request(`/shipments/${shipment.id}/access`, 'PUT', { userIds: [viewer.user.id] }, owner.session);
  assert.ok((await request('/logos', 'GET', undefined, viewer.session)).data.some(l => l.id === logo.id)); assert.equal(await imageStatus(), 200);
  await request(`/shipments/${shipment.id}/access`, 'PUT', { userIds: [] }, owner.session);
  assert.equal(await imageStatus(), 404);
  assert.equal((await request('/logos', 'GET', undefined, viewer.session)).data.some(l => l.id === logo.id), false);
  await request(`/shipments/${shipment.id}`, 'DELETE', { confirmName: shipment.name }, owner.session);
  assert.equal((await request('/logos', 'GET', undefined, owner.session)).data.some(l => l.id === logo.id), false);
});

test('Pallet labels contain distinct QR links without access tokens and require login', async () => {
  const shipment = (await request('/shipments', 'POST', { name: 'QR shipment' })).data;
  const { pallets } = (await request(`/shipments/${shipment.id}/pallets`, 'POST', { quantity: 2 })).data;
  const endpoint = `http://127.0.0.1:${port}/api/shipments/${shipment.id}/export?format=label`;
  assert.equal((await fetch(endpoint)).status, 401);
  const response = await fetch(endpoint, { headers: { Cookie: adminSession.cookie } });
  const html = await response.text();
  assert.equal((html.match(/class="pallet-qr"/g) || []).length, 2);
  for (const pallet of pallets) assert.ok(html.includes(`shipment=${shipment.id}&amp;pallet=${pallet.id}`));
  assert.ok(html.includes('data:image/png;base64,')); assert.ok(!html.includes('Login vereist')); assert.ok(!html.includes('Scan voor palletinhoud')); assert.ok(html.includes('width:20mm;height:20mm')); assert.ok(!html.includes(adminSession.csrfToken));
  const member = await createMember('qr-no-access@example.test');
  assert.equal((await request(`/shipments/${shipment.id}`, 'GET', undefined, member.session)).status, 404);
});

test('Pallet prefixes and postfixes receive consecutive bulk numbers without duplicate names', async () => {
  const shipment = (await request('/shipments', 'POST', { name: 'Naamformaten' })).data;
  const add = body => request(`/shipments/${shipment.id}/pallets`, 'POST', body);
  assert.deepEqual((await add({ quantity: 2, prefix: 'Stage', postfix: 'Antwerpen' })).data.pallets.map(p => p.name), ['Stage 1 Antwerpen', 'Stage 2 Antwerpen']);
  assert.equal((await add({ prefix: 'Stage', postfix: 'Antwerpen' })).data.pallets[0].name, 'Stage 3 Antwerpen');
  assert.equal((await add({ prefix: 'Stage', postfix: 'Gent' })).data.pallets[0].name, 'Stage 1 Gent');
  assert.equal((await add({ prefix: '', postfix: '' })).data.pallets[0].name, '1');
  assert.equal((await add({ prefix: '', postfix: '' })).data.pallets[0].name, '2');
  assert.equal((await add({ prefix: 'A+', postfix: '(B)' })).data.pallets[0].name, 'A+ 1 (B)');
  assert.equal((await add({ prefix: 'A+', postfix: '(B)' })).data.pallets[0].name, 'A+ 2 (B)');
  assert.equal((await add({ prefix: 'x'.repeat(91) })).status, 400);
  assert.equal((await add({ prefix: 123 })).status, 400);
});

test('Transport routes validate manual distances, revisions, defaults and shipment permissions', async () => {
  const member = await createMember('route-member@example.test');
  const outsider = await createMember('route-outsider@example.test');
  assert.equal((await request('/challenges/settings', 'PUT', { warehouseAddress: 'Warehouse Street 1, Antwerp, Belgium', shared: false })).status, 200);
  assert.equal((await request('/challenges/settings', 'PUT', { shared: true }, member.session)).status, 403);
  const shipment = (await request('/shipments', 'POST', { name: 'Physical route', destination:'Event display name', returnDestination:'Warehouse display name' }, member.session)).data;
  assert.equal(shipment.warehouseAddress, 'Warehouse Street 1, Antwerp, Belgium');
  const body = { warehouseAddress: 'Warehouse Street 1, Antwerp, Belgium', outboundAddress: 'Event Street 2, Brussels, Belgium', outboundKm: 50.2, returnKm: 53.4, warehouseCoordinates: [4.4,51.2], outboundCoordinates: [4.35,50.85], revision: shipment.revision };
  assert.equal((await request(`/shipments/${shipment.id}/route`, 'PUT', body, outsider.session)).status, 404);
  assert.equal((await request(`/shipments/${shipment.id}/route`, 'PUT', { ...body, outboundKm: -1 }, member.session)).status, 400);
  assert.equal((await request(`/shipments/${shipment.id}/route`, 'PUT', { ...body, warehouseCoordinates: [190,51] }, member.session)).status, 400);
  const saved = await request(`/shipments/${shipment.id}/route`, 'PUT', body, member.session);
  assert.equal(saved.status, 200); assert.equal(saved.data.outboundKm, 50.2); assert.equal(saved.data.distanceSource, 'manual');
  assert.equal((await request(`/shipments/${shipment.id}/route`, 'PUT', body, member.session)).status, 409);
  assert.equal((await request('/routing/check', 'POST', {}, member.session)).status, 403);
  const response = await fetch(`http://127.0.0.1:${port}/api/shipments/${shipment.id}/export?format=label`, { headers: { Cookie: member.session.cookie } });
  assert.equal(response.status,400); // No pallets yet, rather than leaking an inaccessible route.
  await request(`/shipments/${shipment.id}/pallets`, 'POST', {quantity:1}, member.session);
  const label = await fetch(`http://127.0.0.1:${port}/api/shipments/${shipment.id}/export?format=label`, { headers: { Cookie: member.session.cookie } });
  const html=await label.text();assert.ok(!html.includes(body.warehouseAddress));assert.ok(!html.includes(body.outboundAddress));assert.ok(html.includes('Event display name'));assert.ok(html.includes('Warehouse display name'));
  const lists = await fetch(`http://127.0.0.1:${port}/api/shipments/${shipment.id}/export?format=print`, { headers: { Cookie: member.session.cookie } });
  const listHtml=await lists.text();assert.ok(!listHtml.includes(body.warehouseAddress));assert.ok(!listHtml.includes(body.outboundAddress));
});

test('Pallet challenges attribute checks once, share tied leg distances and recalculate corrections', async () => {
  const a = await createMember('challenge-a@example.test', 'User', 'member', true), b = await createMember('challenge-b@example.test', 'User', 'member', true), outsider = await createMember('challenge-outsider@example.test');
  const shipment = (await request('/shipments', 'POST', { name: 'Private challenge' }, a.session)).data;
  await request(`/shipments/${shipment.id}/access`, 'PUT', { userIds:[b.user.id] }, a.session);
  await request(`/shipments/${shipment.id}/route`, 'PUT', { warehouseAddress:'Antwerp, Belgium',outboundAddress:'Brussels, Belgium',outboundKm:100,returnKm:120 }, a.session);
  const {pallets} = (await request(`/shipments/${shipment.id}/pallets`, 'POST', {quantity:3}, a.session)).data;
  const check = (pallet,stage,checked,session) => request(`/pallets/${pallet.id}`, 'PATCH', {status:stage,checked},session);
  const board = async session => (await request('/challenges','GET',undefined,session)).data;
  await check(pallets[0],'outWarehouse',true,a.session);await check(pallets[1],'outWarehouse',true,a.session);
  await check(pallets[0],'inLocation',true,b.session);await check(pallets[1],'inLocation',true,b.session);
  let scores=await board(a.session);const score=(data,id)=>data.rows.find(r=>r.id===id);
  assert.equal(score(scores,a.user.id).checks,2);assert.equal(score(scores,b.user.id).checks,2);
  assert.equal(score(scores,a.user.id).palletKm,100);assert.equal(score(scores,b.user.id).palletKm,100);
  assert.equal(score(scores,a.user.id).provisionalKm,100);assert.equal(scores.transports[0].completed,false);
  assert.equal((await board(outsider.session)).transports.length,0);assert.ok(!(await board(outsider.session)).rows.some(r=>r.id===a.user.id));
  await check(pallets[0],'outWarehouse',true,b.session);scores=await board(a.session);assert.equal(score(scores,a.user.id).checks,2);assert.equal(score(scores,b.user.id).checks,2);
  await check(pallets[0],'outWarehouse',false,b.session);scores=await board(a.session);assert.equal(score(scores,a.user.id).checks,1);assert.equal(score(scores,b.user.id).palletKm,200);
  await check(pallets[0],'outWarehouse',true,b.session);scores=await board(a.session);assert.equal(score(scores,a.user.id).checks,2);assert.equal(score(scores,b.user.id).checks,2);
  await check(pallets[2],'outWarehouse',true,a.session);await check(pallets[2],'inLocation',true,a.session);
  scores=await board(a.session);assert.equal(score(scores,a.user.id).palletKm,300);assert.equal(score(scores,b.user.id).palletKm,0);assert.equal(scores.transports[0].completed,true);
  await check(pallets[0],'outLocation',true,b.session);await check(pallets[0],'inWarehouse',true,b.session);
  scores=await board(a.session);assert.equal(score(scores,b.user.id).palletKm,120);assert.equal(score(scores,b.user.id).pallets,3);
  await request(`/shipments/${shipment.id}/items`,'POST',{rows:[{name:'Box',palletId:pallets[0].id}]},a.session);
  const item=(await request(`/shipments/${shipment.id}`,'GET',undefined,a.session)).data.items[0];
  await request(`/items/${item.id}`,'PATCH',{status:'outWarehouse',checked:true},a.session);
  assert.equal(score(await board(a.session),a.user.id).checks,4);
  await request(`/shipments/${shipment.id}`,'PATCH',{archived:true},a.session);assert.equal(score(await board(a.session),a.user.id).palletKm,300);
  await request('/challenges/settings','PUT',{shared:true});let publicBoard=await board(outsider.session);assert.ok(publicBoard.rows.some(r=>r.id===a.user.id));assert.equal(publicBoard.transports.length,0);
  await request('/challenges/settings','PUT',{shared:false});
  await request(`/pallets/${pallets[0].id}`,'DELETE',{},a.session);scores=await board(a.session);assert.equal(score(scores,b.user.id).palletKm,0);assert.equal(score(scores,a.user.id).palletKm,200);
  await request(`/shipments/${shipment.id}`,'DELETE',{confirmName:shipment.name},a.session);assert.equal(score(await board(a.session),a.user.id).checks,0);
});

test('Legacy pallet checks have no attribution and challenge periods use the Belgian calendar', async () => {
  const member=await createMember('challenge-calendar@example.test', 'User', 'member', true);
  const shipment=(await request('/shipments','POST',{name:'Calendar challenge'},member.session)).data;
  const pallet=(await request(`/shipments/${shipment.id}/pallets`,'POST',{},member.session)).data;
  const database=new DatabaseSync(path.join(dir,'shipments.sqlite'));
  database.prepare('UPDATE pallets SET statuses=? WHERE id=?').run(JSON.stringify({outWarehouse:'2025-12-31T23:30:00Z'}),pallet.id);
  await request(`/pallets/${pallet.id}`,'PATCH',{status:'outWarehouse',checked:true},member.session);
  assert.equal(database.prepare('SELECT COUNT(*) AS n FROM pallet_checks WHERE palletId=?').get(pallet.id).n,0);
  await request(`/pallets/${pallet.id}`,'PATCH',{status:'inLocation',checked:true},member.session);
  database.prepare('UPDATE pallet_checks SET checkedAt=? WHERE palletId=?').run('2025-12-31T23:30:00Z',pallet.id);database.close();
  let result=await request('/challenges?year=2026&month=1','GET',undefined,member.session);assert.equal(result.data.rows.find(r=>r.id===member.user.id).checks,1);
  result=await request('/challenges?year=2025','GET',undefined,member.session);assert.equal(result.data.rows.find(r=>r.id===member.user.id).checks,0);
  assert.equal((await request('/challenges?month=13')).status,400);
});

test('Automatic challenge distances cross oceans without road API calls and migrate old road distances while preserving manual entries', async () => {
  const member=await createMember('straight-line@example.test');
  const shipment=(await request('/shipments','POST',{name:'Vilvoorde to Whistler'},member.session)).data;
  const body={warehouseAddress:'Vilvoorde, Belgium',outboundAddress:'Whistler, BC, Canada',warehouseCoordinates:[4.43,50.93],outboundCoordinates:[-122.96,50.12],calculate:true,revision:shipment.revision};
  assert.equal((await request(`/shipments/${shipment.id}/route`,'PUT',{...body,warehouseCoordinates:null},member.session)).status,400);
  const saved=await request(`/shipments/${shipment.id}/route`,'PUT',body,member.session);
  assert.equal(saved.status,200);assert.equal(saved.data.distanceSource,'straight-line');assert.equal(saved.data.outboundKm,saved.data.returnKm);assert.ok(Number.isInteger(saved.data.outboundKm));assert.ok(saved.data.outboundKm>7500);
  assert.equal((await request(`/shipments/${shipment.id}/route`,'PUT',body,member.session)).status,409);
  const manual=(await request('/shipments','POST',{name:'Manual retained'},member.session)).data;
  await request(`/shipments/${manual.id}/route`,'PUT',{...body,calculate:false,outboundKm:9000,returnKm:9200,revision:manual.revision},member.session);
  const database=new DatabaseSync(path.join(dir,'shipments.sqlite'));
  database.prepare("UPDATE shipments SET distanceSource='openrouteservice',outboundKm=8000,returnKm=8200 WHERE id=?").run(shipment.id);database.close();
  await stop();await start();
  const rows=(await request('/shipments','GET',undefined,member.session)).data;
  const migrated=rows.find(s=>s.id===shipment.id),unchanged=rows.find(s=>s.id===manual.id);
  assert.equal(migrated.distanceSource,'straight-line');assert.equal(migrated.outboundKm,saved.data.outboundKm);assert.equal(migrated.returnKm,saved.data.returnKm);
  assert.equal(unchanged.distanceSource,'manual');assert.equal(unchanged.outboundKm,9000);assert.equal(unchanged.returnKm,9200);
});


test('Own profile supports nickname and optional challenge participation without changing passwords, permissions or tracking', async () => {
  const a=await createMember('nickname-a@example.test','Real Account Name'),b=await createMember('nickname-b@example.test','Second User');
  const current=(await request('/auth/session','GET',undefined,a.session)).data.user;
  assert.equal(current.nickname,'');assert.equal(current.challengeParticipating,false);
  const dbBefore=new DatabaseSync(path.join(dir,'shipments.sqlite'));const hashBefore=dbBefore.prepare('SELECT passwordHash FROM users WHERE id=?').get(a.user.id).passwordHash;dbBefore.close();
  assert.equal((await request('/auth/profile','PATCH',{nickname:'Captain Pallet',challengeParticipating:true},null)).status,401);
  assert.equal((await request('/auth/profile','PATCH',{nickname:'Captain Pallet',challengeParticipating:true},a.session,{'X-CSRF-Token':'wrong'})).status,403);
  assert.equal((await request('/auth/profile','PATCH',{nickname:'x'.repeat(41),challengeParticipating:true},a.session)).status,400);
  assert.equal((await request('/auth/profile','PATCH',{nickname:'Captain',challengeParticipating:'yes'},a.session)).status,400);
  assert.equal((await request('/auth/profile','PATCH',{nickname:'Captain',challengeParticipating:true,role:'admin'},a.session)).status,400);
  let updated=await request('/auth/profile','PATCH',{nickname:' Captain Pallet ',challengeParticipating:true},a.session);
  assert.equal(updated.status,200);assert.equal(updated.data.user.nickname,'Captain Pallet');assert.equal(updated.data.user.name,'Real Account Name');assert.equal(updated.data.user.role,'member');assert.ok(!('passwordHash' in updated.data.user));
  const shipment=(await request('/shipments','POST',{name:'Nickname challenge'},a.session)).data;
  await request(`/shipments/${shipment.id}/access`,'PUT',{userIds:[b.user.id]},a.session);
  await request(`/shipments/${shipment.id}/route`,'PUT',{warehouseAddress:'Vilvoorde, Belgium',outboundAddress:'Whistler, Canada',outboundKm:100,returnKm:100},a.session);
  const pallet=(await request(`/shipments/${shipment.id}/pallets`,'POST',{},a.session)).data;
  await request(`/pallets/${pallet.id}`,'PATCH',{status:'outWarehouse',checked:true},a.session);
  await request(`/pallets/${pallet.id}`,'PATCH',{status:'inLocation',checked:true},b.session);
  let board=(await request('/challenges','GET',undefined,a.session)).data;
  assert.equal(board.participating,true);assert.equal(board.rows.find(r=>r.id===a.user.id).name,'Captain Pallet');assert.equal(board.rows.find(r=>r.id===a.user.id).palletKm,100);assert.ok(!board.rows.some(r=>r.id===b.user.id));assert.equal(board.transports[0].winners[0].name,'Captain Pallet');
  await request('/auth/profile','PATCH',{nickname:'Captain Pallet',challengeParticipating:false},a.session);
  board=(await request('/challenges','GET',undefined,a.session)).data;assert.equal(board.participating,false);assert.ok(!board.rows.some(r=>r.id===a.user.id));assert.deepEqual(board.transports[0].winners,[]);
  assert.equal((await request(`/shipments/${shipment.id}`,'GET',undefined,a.session)).data.pallets[0].statuses.outWarehouse!==null,true);
  await request('/auth/profile','PATCH',{nickname:'',challengeParticipating:true},a.session);
  board=(await request('/challenges','GET',undefined,a.session)).data;assert.equal(board.rows.find(r=>r.id===a.user.id).name,'Real Account Name');assert.equal(board.rows.find(r=>r.id===a.user.id).palletKm,100);
  await stop();await start();assert.equal((await request('/auth/session','GET',undefined,a.session)).data.user.challengeParticipating,true);
  const dbAfter=new DatabaseSync(path.join(dir,'shipments.sqlite'));assert.equal(dbAfter.prepare('SELECT passwordHash FROM users WHERE id=?').get(a.user.id).passwordHash,hashBefore);dbAfter.close();
});

test('Shipment creation preserves manual names and selected address coordinates and calculates challenge distance', async () => {
  const member=await createMember('new-addresses@example.test');
  const body={name:'Grouped creation',destination:'Outbound label name',returnDestination:'Return label name',outboundDate:'2026-11-01',returnDate:'2026-11-15',warehouseAddress:'Vilvoorde, Belgium',outboundAddress:'Whistler, Canada',warehouseCoordinates:[4.43,50.93],outboundCoordinates:[-122.96,50.12]};
  const result=await request('/shipments','POST',body,member.session);assert.equal(result.status,201);
  for(const key of ['destination','returnDestination','outboundDate','returnDate','warehouseAddress','outboundAddress'])assert.equal(result.data[key],body[key]);
  assert.deepEqual(JSON.parse(result.data.warehouseCoordinates),body.warehouseCoordinates);assert.deepEqual(JSON.parse(result.data.outboundCoordinates),body.outboundCoordinates);
  assert.equal(result.data.distanceSource,'straight-line');assert.ok(result.data.outboundKm>7500);assert.equal(result.data.returnKm,result.data.outboundKm);
  const before=(await request('/shipments','GET',undefined,member.session)).data.length;
  assert.equal((await request('/shipments','POST',{...body,warehouseCoordinates:[500,50]},member.session)).status,400);
  assert.equal((await request('/shipments','POST',{...body,outboundAddress:''},member.session)).status,400);
  assert.equal((await request('/shipments','GET',undefined,member.session)).data.length,before);
  const partial=await request('/shipments','POST',{...body,warehouseCoordinates:null},member.session);assert.equal(partial.status,201);assert.equal(partial.data.distanceSource,null);assert.equal(partial.data.outboundKm,null);
});

test('Confirmed default warehouse is reused for new shipments and invalidated when its address changes', async () => {
  const member = await createMember('default-warehouse@test.example');
  const settings = {warehouseAddress:'Confirmed warehouse, Belgium',warehouseCoordinates:[4.43,50.93],shared:false};
  assert.equal((await request('/challenges/settings','PUT',settings,member.session)).status,403);
  assert.equal((await request('/challenges/settings','PUT',{...settings,warehouseCoordinates:[500,50]})).status,400);
  assert.equal((await request('/challenges/settings','PUT',settings)).status,200);
  assert.deepEqual((await request('/challenges/settings','GET',undefined,member.session)).data.warehouseCoordinates,settings.warehouseCoordinates);
  await request('/challenges/settings','PUT',{shared:true});
  for (const extra of [{},{warehouseAddress:settings.warehouseAddress,warehouseCoordinates:null}]) {
    const result = await request('/shipments','POST',{name:'Inherited warehouse',outboundAddress:'Whistler, Canada',outboundCoordinates:[-122.96,50.12],...extra},member.session);
    assert.equal(result.status,201);
    assert.equal(result.data.warehouseAddress,settings.warehouseAddress);
    assert.deepEqual(JSON.parse(result.data.warehouseCoordinates),settings.warehouseCoordinates);
    assert.equal(result.data.distanceSource,'straight-line');
    assert.ok(result.data.outboundKm>7000);
  }
  const other = await request('/shipments','POST',{name:'Other warehouse',warehouseAddress:'Different warehouse',outboundAddress:'Whistler, Canada',outboundCoordinates:[-122.96,50.12]},member.session);
  assert.equal(other.data.warehouseCoordinates,null);
  assert.equal(other.data.distanceSource,null);
  assert.equal((await request('/challenges/settings','PUT',{warehouseAddress:'Changed warehouse'})).status,200);
  assert.equal((await request('/challenges/settings')).data.warehouseCoordinates,null);
});
