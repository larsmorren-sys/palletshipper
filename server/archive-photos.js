import sharp from 'sharp';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

// Prepare every replacement before committing: unreadable images leave the archive unchanged.
export async function archiveShipment(db, dataDir, shipmentId) {
  const photos = db.prepare('SELECT ph.* FROM pallet_photos ph JOIN pallets p ON p.id=ph.palletId WHERE p.shipmentId=? AND ph.compressedAt IS NULL').all(shipmentId);
  const prepared = [];
  let committed = false;
  const now = new Date().toISOString();
  try {
    for (const photo of photos) {
      const original = path.join(dataDir, 'uploads', path.basename(photo.url));
      const bytes = await readFile(original);
      const compressed = await sharp(bytes, { limitInputPixels: 80000000 }).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).webp({ quality: 75, effort: 4 }).toBuffer();
      if (compressed.length >= bytes.length) {
        prepared.push({ photo, url: photo.url });
      } else {
        const url = `/uploads/${randomUUID()}.webp`;
        const filename = path.join(dataDir, 'uploads', path.basename(url));
        prepared.push({ photo, url, filename, original });
        await writeFile(filename, compressed, { flag: 'wx' });
      }
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const entry of prepared) db.prepare('UPDATE pallet_photos SET url=?, compressedAt=? WHERE id=?').run(entry.url, now, entry.photo.id);
      db.prepare('UPDATE shipments SET archivedAt=? WHERE id=?').run(now, shipmentId);
      db.exec('COMMIT'); committed = true;
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  } finally {
    for (const entry of prepared) {
      const filename = committed ? entry.original : entry.filename;
      if (filename) await unlink(filename).catch(error => { if (error.code !== 'ENOENT') console.error('Archieffoto opruimen mislukt:', error.code); });
    }
  }
}
