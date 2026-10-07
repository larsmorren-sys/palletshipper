import QRCode from 'qrcode';
import { createHash, randomUUID } from 'node:crypto';
import { formatDate } from '../shared/dates.js';
import multer from 'multer';
import XLSX from 'xlsx';
import { stages } from '../shared/tracking.js';

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const filename = value => String(value).normalize('NFKD').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100) || 'pallet';
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const collator = new Intl.Collator('en-GB', { numeric: true, sensitivity: 'base' });
const mark = '<svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="m3 7 9-4 9 4-9 4-9-4Zm0 0v10l9 4 9-4V7M12 11v10M7 5l10 4"/></svg><span>Palletshipper.</span>';
const documentHtml = (title, css, content) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title><style>*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#172d24;margin:0;background:#eef2ec}.print-tools{padding:18px;display:flex;gap:15px;align-items:center;justify-content:center;font-size:13px}.print-tools button{padding:12px 18px;border:0;border-radius:6px;background:#254d3d;color:white;cursor:pointer}.brand{display:flex;align-items:center;gap:10px;font-size:21px;font-weight:bold}.logo{max-width:85mm;max-height:24mm;object-fit:contain}h1,h2,p{margin:0} @media print{body{background:white}.print-tools{display:none!important}}${css}</style></head><body>${content}</body></html>`;

export function installExports(app, db, auth) {
  db.exec('CREATE TABLE IF NOT EXISTS shipment_logos (shipmentId TEXT PRIMARY KEY REFERENCES shipments(id), content BLOB NOT NULL, mimeType TEXT NOT NULL)');
  db.exec('CREATE TABLE IF NOT EXISTS logo_library (id TEXT PRIMARY KEY, name TEXT NOT NULL, content BLOB NOT NULL, mimeType TEXT NOT NULL, digest TEXT NOT NULL UNIQUE)');
  db.exec('CREATE TABLE IF NOT EXISTS logo_library_shipments (logoId TEXT NOT NULL REFERENCES logo_library(id), shipmentId TEXT NOT NULL REFERENCES shipments(id) ON DELETE CASCADE, PRIMARY KEY (logoId, shipmentId))');
  const linkLogo = (logoId, shipmentId) => db.prepare('INSERT OR IGNORE INTO logo_library_shipments VALUES (?, ?)').run(logoId, shipmentId);
  const saveLogo = (name, bytes, mimeType) => {
    const digest = createHash('sha256').update(bytes).digest('hex');
    const existing = db.prepare('SELECT id, name FROM logo_library WHERE digest=?').get(digest);
    if (existing) return existing;
    const id = randomUUID();
    db.prepare('INSERT INTO logo_library VALUES (?, ?, ?, ?, ?)').run(id, name.slice(0, 200), bytes, mimeType, digest);
    return { id, name: name.slice(0, 200) };
  };
  for (const logo of db.prepare('SELECT l.*, s.name FROM shipment_logos l JOIN shipments s ON s.id=l.shipmentId').all()) {
    linkLogo(saveLogo(logo.name, Buffer.from(logo.content), logo.mimeType).id, logo.shipmentId);
  }
  const visibleLogos = user => user.role === 'admin' ? db.prepare('SELECT id, name FROM logo_library ORDER BY name COLLATE NOCASE').all() : db.prepare(`SELECT l.id, l.name FROM logo_library l WHERE EXISTS (
    SELECT 1 FROM logo_library_shipments ls JOIN shipments s ON s.id=ls.shipmentId
    WHERE ls.logoId=l.id AND (s.ownerId=? OR EXISTS (SELECT 1 FROM shipment_access a WHERE a.shipmentId=s.id AND a.userId=?))
  ) ORDER BY l.name COLLATE NOCASE`).all(user.id, user.id);
  const requireLibraryLogo = (user, id) => {
    if (typeof id !== 'string' || !visibleLogos(user).some(logo => logo.id === id)) throw fail('Logo not found or access denied.', 404);
    return db.prepare('SELECT * FROM logo_library WHERE id=?').get(id);
  };
  app.get('/api/logos', (req, res) => res.json(visibleLogos(req.user)));
  app.get('/api/logos/:id', (req, res) => {
    const logo = requireLibraryLogo(req.user, req.params.id);
    res.type(logo.mimeType).send(Buffer.from(logo.content));
  });
  app.put('/api/shipments/:id/logo', (req, res) => {
    auth.requireShipment(req.user, req.params.id, true);
    const logo = requireLibraryLogo(req.user, req.body.logoId);
    db.prepare('INSERT INTO shipment_logos VALUES (?, ?, ?) ON CONFLICT(shipmentId) DO UPDATE SET content=excluded.content,mimeType=excluded.mimeType').run(req.params.id, logo.content, logo.mimeType);
    linkLogo(logo.id, req.params.id);
    res.json({ ok: true });
  });
  const logoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });
  app.post('/api/shipments/:id/logo', (req, res, next) => { auth.requireShipment(req.user, req.params.id, true); next(); }, logoUpload.single('file'), (req, res) => {
    const bytes = req.file?.buffer;
    if (!bytes) throw fail('Select a logo.');
    const mimeType = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? 'image/jpeg' : bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'image/png' : bytes.subarray(0,4).toString() === 'RIFF' && bytes.subarray(8,12).toString() === 'WEBP' ? 'image/webp' : null;
    if (!mimeType) throw fail('Use a PNG, JPG or WebP logo.');
    db.prepare('INSERT INTO shipment_logos VALUES (?, ?, ?) ON CONFLICT(shipmentId) DO UPDATE SET content=excluded.content,mimeType=excluded.mimeType').run(req.params.id, bytes, mimeType);
    linkLogo(saveLogo(req.file.originalname.replace(/\.[^.]+$/, '') || 'Logo', bytes, mimeType).id, req.params.id);
    res.json({ ok: true });
  });
  app.get('/api/shipments/:id/logo', (req, res) => {
    auth.requireShipment(req.user, req.params.id);
    const logo = db.prepare('SELECT * FROM shipment_logos WHERE shipmentId=?').get(req.params.id);
    if (!logo) throw fail('Logo not found.', 404);
    res.type(logo.mimeType).send(Buffer.from(logo.content));
  });
  app.delete('/api/shipments/:id/logo', (req, res) => { auth.requireShipment(req.user, req.params.id, true); db.prepare('DELETE FROM shipment_logos WHERE shipmentId=?').run(req.params.id); res.json({ ok: true }); });

  app.get(['/api/pallets/:id/export', '/api/shipments/:id/export'], async (req, res) => {
    const bulk = req.path.startsWith('/api/shipments/');
    const pallet = bulk ? null : db.prepare('SELECT * FROM pallets WHERE id=?').get(req.params.id);
    if (!bulk && !pallet) throw fail('Pallet not found.', 404);
    const shipment = auth.requireShipment(req.user, bulk ? req.params.id : pallet.shipmentId);
    const pallets = bulk ? db.prepare('SELECT * FROM pallets WHERE shipmentId=? ORDER BY rowid').all(shipment.id) : [pallet];
    const source = bulk ? db.prepare('SELECT * FROM items WHERE shipmentId=? ORDER BY rowid').all(shipment.id) : db.prepare('SELECT * FROM items WHERE palletId=? ORDER BY rowid').all(pallet.id);
    const items = source.map(item => ({ ...item, displayName: `${item.name} ${item.instanceNumber}`, statuses: JSON.parse(item.statuses) })).sort((a,b) => collator.compare(a.displayName,b.displayName));
    const groups = pallets.map(pallet => ({ ...pallet, items: items.filter(item => item.palletId === pallet.id) }));
    const unassigned = items.filter(item => !item.palletId);
    if (bulk && unassigned.length) groups.push({ id: null, name: 'Unassigned', items: unassigned });
    const format = req.query.format || 'csv';
    const heading = bulk ? shipment.name : `${shipment.name} — ${pallet.name}`;
    const brand = db.prepare('SELECT * FROM shipment_logos WHERE shipmentId=?').get(shipment.id);
    const logo = brand ? `<img class="logo" alt="Shipment logo" src="data:${brand.mimeType};base64,${Buffer.from(brand.content).toString('base64')}">` : `<div class="brand">${mark}</div>`;
    if (format === 'label') {
      const css = `@page{size:105mm 148mm;margin:0}.label{width:105mm;height:148mm;margin:20px auto;padding:9mm;background:white;display:flex;flex-direction:column;overflow:hidden}.label .branding{height:22mm;flex-shrink:0;display:flex;align-items:center}.label .caption{font-size:9pt;text-transform:uppercase;letter-spacing:1.5px;color:#667660;margin-bottom:4mm}.label .shipment{font-size:${shipment.name.length > 80 ? 10 : 21}pt;font-weight:bold;overflow-wrap:anywhere;line-height:1.2;margin:0 0 5mm}.label .pallet{font-size:40pt;font-weight:bold;overflow-wrap:anywhere;line-height:1.15}.label-route{margin-top:5mm;display:grid;grid-template-columns:1fr 1fr;gap:4mm;font-size:9pt;line-height:1.3}.label-route strong,.label-route span{display:block;overflow-wrap:anywhere}.label-route strong{margin-bottom:2mm}.label .bottom{display:flex;align-items:center;justify-content:space-between;gap:3mm;margin-top:auto;border-top:1px solid #acb9a4;padding-top:4mm;font-size:10pt}.pallet-qr{width:20mm;height:20mm;display:block}.label .bottom span{font-size:8pt;line-height:1.5}@media print{.label{margin:0;break-after:page}.label:last-child{break-after:auto}}@media screen and (max-width:450px){.label{max-width:100%;height:auto;min-height:148mm}.print-tools{flex-wrap:wrap}}`;
      if (!pallets.length) throw fail('Create at least one pallet to export labels.');
      const route = `<div class="label-route"><div><strong>Outbound</strong><span>${escapeHtml(shipment.outboundAddress || shipment.destination || 'Not specified')}</span>${shipment.outboundDate ? `<span>${escapeHtml(formatDate(shipment.outboundDate))}</span>` : ''}</div><div><strong>Return</strong><span>${escapeHtml(shipment.warehouseAddress || shipment.returnDestination || 'Not specified')}</span>${shipment.returnDate ? `<span>${escapeHtml(formatDate(shipment.returnDate))}</span>` : ''}</div></div>`;
      const labels = (await Promise.all(groups.filter(group => group.id).map(async group => {
        const url = new URL('/', process.env.APP_URL || `${req.protocol}://${req.get('host')}`);
        url.searchParams.set('shipment', shipment.id); url.searchParams.set('pallet', group.id);
        const qr = await QRCode.toDataURL(url.href, { errorCorrectionLevel: 'M', margin: 4, width: 300 });
        return `<article class="label"><div class="branding">${logo}</div><p class="caption">Shipment</p><h1 class="shipment">${escapeHtml(shipment.name)}</h1><p class="caption">Pallet</p><h2 class="pallet" style="font-size:${group.name.length > 80 ? 10 : group.name.length > 35 ? 18 : 40}pt">${escapeHtml(group.name)}</h2>${route}<div class="bottom"><span>${group.items.length} items</span><a href="${escapeHtml(url.href)}"><img class="pallet-qr" src="${qr}" alt="QR code for ${escapeHtml(group.name)}"/></a></div></article>`;
      }))).join('');
      res.type('html').send(documentHtml(heading, css, `<div class="print-tools"><button onclick="window.print()">Print labels / save as PDF</button><span>${pallets.length} labels · A6 · 105 × 148 mm · 100% scale · no headers or footers</span></div>${labels}`));
      return;
    }
    const columns = auth.getColumns(req.user.id, shipment.id);
    const tracking = stages.filter(([key]) => columns[key]);
    const headers = ['Shipment', 'Pallet', 'Item', 'Item code', 'Quantity', 'Note', ...tracking.map(([,label]) => label)];
    const groupRows = group => group.items.map(item => [shipment.name, group.name, item.displayName, item.code, 1, item.note, ...tracking.map(([key]) => formatDate(item.statuses[key]))]);
    const rows = groups.flatMap(groupRows);
    if (format === 'print') {
      const table = group => `<table><thead><tr>${headers.slice(2).map(header => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead><tbody>${groupRows(group).map(row => `<tr>${row.slice(2).map(cell => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
      const css = '@page{size:A4 landscape;margin:12mm}.packing-list{background:white;margin:20px auto;max-width:1200px;padding:30px}.packing-list header{display:flex;justify-content:space-between;align-items:center;gap:25px;margin-bottom:25px}.packing-list h1{font-size:23px;overflow-wrap:anywhere}.packing-list p{margin-top:10px;font-size:12px}table{border-collapse:collapse;width:100%;font-size:11px;table-layout:fixed}th,td{border:1px solid #d5ddcf;padding:8px;text-align:left;overflow-wrap:anywhere;vertical-align:top}thead{display:table-header-group}tr{break-inside:avoid}th{background:#edf2e8}@media print{.packing-list{padding:0;margin:0;max-width:none;break-before:page}.packing-list:first-of-type{break-before:auto}}';
      const lists = groups.map(group => `<article class="packing-list"><header>${logo}<div><h1>${escapeHtml(shipment.name)} — ${escapeHtml(group.name)}</h1><p>${group.items.length} individual items${shipment.destination ? ` · ${escapeHtml(shipment.destination)}` : ''}</p></div></header>${table(group)}${!group.items.length ? '<p>This pallet has no items yet.</p>' : ''}</article>`).join('');
      res.type('html').send(documentHtml(heading, css, `<div class="print-tools"><button onclick="window.print()">Print all lists / save as PDF</button><span>A4 landscape · ${pallets.length} pallets${unassigned.length ? ' + unassigned items' : ''}</span></div>${lists || '<article class="packing-list"><p>This shipment has no pallets or items yet.</p></article>'}`));
      return;
    }
    if (!['csv','xlsx'].includes(format)) throw fail('Choose CSV, Excel, a packing list or an A6 label.');
    // Keep user text as text, including spreadsheet formula-like prefixes.
    const safeRows = rows.map(row => row.map(value => typeof value === 'string' && /^[\s]*[=+@-]/.test(value) ? `'${value}` : value));
    const sheet = XLSX.utils.aoa_to_sheet([headers, ...(format === 'csv' ? safeRows : rows)]);
    const base = filename(bulk ? shipment.name : `${shipment.name}-${pallet.name}`);
    res.set('Content-Disposition', `attachment; filename="${base}.${format}"`);
    if (format === 'csv') res.type('text/csv').send('\uFEFF' + XLSX.utils.sheet_to_csv(sheet, { FS: ';' }));
    else { const book = XLSX.utils.book_new();
      if (bulk) {
        XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['Shipment','Pallet','Items'], ...groups.map(group => [shipment.name,group.name,group.items.length])]), 'Overview');
        groups.forEach((group, index) => {
          const name = group.id ? `${index + 1} ${group.name.replace(/[\[\]*?:/\\]/g, '_')}`.slice(0,31) : 'Unassigned';
          XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([headers, ...groupRows(group)]), name);
        });
      } else XLSX.utils.book_append_sheet(book,sheet,'Equipment list'); res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(XLSX.write(book,{type:'buffer',bookType:'xlsx'})); }
  });
}
