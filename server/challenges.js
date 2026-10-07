import { revision, checkRevision } from './revisions.js';
import { routingConfigured, searchAddress, straightLineDistances, coordinates } from './routing.js';
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const periodFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit' });
const periodOf = value => { const parts = periodFormatter.formatToParts(new Date(value)); return { year: Number(parts.find(p => p.type === 'year').value), month: Number(parts.find(p => p.type === 'month').value) }; };
export function installChallenges(app, db, auth) {
  for (const [field, type] of [['warehouseAddress', "TEXT NOT NULL DEFAULT ''"], ['outboundAddress', "TEXT NOT NULL DEFAULT ''"], ['warehouseCoordinates', 'TEXT'], ['outboundCoordinates', 'TEXT'], ['outboundKm', 'REAL'], ['returnKm', 'REAL'], ['distanceSource', 'TEXT'], ['distanceUpdatedAt', 'TEXT']]) {
    if (!db.prepare('PRAGMA table_info(shipments)').all().some(c => c.name === field)) db.exec(`ALTER TABLE shipments ADD COLUMN ${field} ${type}`);
  }
  db.exec(`CREATE TABLE IF NOT EXISTS challenge_settings (id INTEGER PRIMARY KEY CHECK(id=1), shared INTEGER NOT NULL DEFAULT 0, warehouseAddress TEXT NOT NULL DEFAULT '');
    INSERT OR IGNORE INTO challenge_settings(id) VALUES(1);
    CREATE TABLE IF NOT EXISTS pallet_checks(palletId TEXT NOT NULL REFERENCES pallets(id) ON DELETE CASCADE, stage TEXT NOT NULL, userId TEXT NOT NULL REFERENCES users(id), checkedAt TEXT NOT NULL, active INTEGER NOT NULL, PRIMARY KEY(palletId,stage));`);
  // Upgrade previously automatic road distances; preserve all manual overrides.
  for (const shipment of db.prepare("SELECT * FROM shipments WHERE distanceSource='openrouteservice'").all()) {
    try {
      const distances = straightLineDistances(JSON.parse(shipment.warehouseCoordinates), JSON.parse(shipment.outboundCoordinates));
      db.prepare("UPDATE shipments SET outboundKm=?,returnKm=?,distanceSource='straight-line',distanceUpdatedAt=? WHERE id=?").run(distances.outboundKm, distances.returnKm, new Date().toISOString(), shipment.id);
    } catch { /* Keep incomplete legacy routes available for manual correction. */ }
  }
  const visibleShipments = user => user.role === 'admin' ? db.prepare('SELECT * FROM shipments').all() : db.prepare('SELECT * FROM shipments s WHERE s.ownerId=? OR EXISTS(SELECT 1 FROM shipment_access a WHERE a.shipmentId=s.id AND a.userId=?)').all(user.id, user.id);
  const settings = () => db.prepare('SELECT * FROM challenge_settings WHERE id=1').get();
  app.get('/api/challenges/settings', (req, res) => res.json({ ...settings(), shared: !!settings().shared, routingConfigured: routingConfigured() }));
  app.put('/api/challenges/settings', (req, res) => {
    if (req.user.role !== 'admin') throw fail('Only administrators can change challenge settings.', 403);
    const current = settings();
    const { shared = !!current.shared, warehouseAddress = current.warehouseAddress } = req.body;
    if (typeof shared !== 'boolean' || typeof warehouseAddress !== 'string' || warehouseAddress.trim().length > 500) throw fail('Enter valid challenge settings.');
    db.prepare('UPDATE challenge_settings SET shared=?, warehouseAddress=? WHERE id=1').run(Number(shared), warehouseAddress.trim());
    res.json({ ok: true });
  });
  const attempts = new Map();
  function routeLimit(req) {
    const now = Date.now(), entry = attempts.get(req.user.id);
    if (!entry || entry.until < now) attempts.set(req.user.id, { count: 1, until: now + 60000 });
    else if (++entry.count > 15) throw fail('Too many route requests. Please wait a minute.', 429);
    if (attempts.size > 1000) for (const [key, value] of attempts) if (value.until < now) attempts.delete(key);
  }
  app.post('/api/routing/search', async (req, res) => { routeLimit(req); res.json({ matches: await searchAddress(req.body.address) }); });
  app.post('/api/routing/check', async (req, res) => {
    if (req.user.role !== 'admin') throw fail('Only administrators can test the route connection.', 403);
    routeLimit(req);
    await searchAddress('Heidelberg, Germany');
    res.json({ ok: true, message: 'API key accepted. Address search is working. Straight-line distances are calculated locally.' });
  });
  app.put('/api/shipments/:id/route', async (req, res) => {
    const initial = auth.requireShipment(req.user, req.params.id, true);
    checkRevision(req.body, revision(initial));
    const { warehouseAddress, outboundAddress } = req.body;
    if ([warehouseAddress, outboundAddress].some(v => typeof v !== 'string' || !v.trim() || v.length > 500)) throw fail('Enter full warehouse and outbound addresses.');
    const warehouse = coordinates(req.body.warehouseCoordinates), outbound = coordinates(req.body.outboundCoordinates);
    let distances, source;
    if (req.body.calculate === true) { distances = straightLineDistances(warehouse, outbound); source = 'straight-line'; }
    else {
      const number = value => { if (value === '' || value === null || value === undefined) return null; if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 50000) throw fail('Enter distances between 0 and 50,000 km.'); return value; };
      distances = { outboundKm: number(req.body.outboundKm), returnKm: number(req.body.returnKm) }; source = 'manual';
    }
    // Recheck permissions and revision after the asynchronous provider request.
    const current = auth.requireShipment(req.user, req.params.id, true);
    checkRevision({ revision: revision(initial) }, revision(current));
    db.prepare('UPDATE shipments SET warehouseAddress=?,outboundAddress=?,warehouseCoordinates=?,outboundCoordinates=?,outboundKm=?,returnKm=?,distanceSource=?,distanceUpdatedAt=? WHERE id=?').run(warehouseAddress.trim(), outboundAddress.trim(), warehouse ? JSON.stringify(warehouse) : null, outbound ? JSON.stringify(outbound) : null, distances.outboundKm, distances.returnKm, source, new Date().toISOString(), initial.id);
    res.json(auth.viewShipment(req.user, db.prepare('SELECT * FROM shipments WHERE id=?').get(initial.id)));
  });
  app.get('/api/challenges', (req, res) => {
    const currentPeriod = periodOf(new Date().toISOString());
    const year = Number(req.query.year || currentPeriod.year), month = req.query.month ? Number(req.query.month) : null;
    if (!Number.isInteger(year) || year < 2000 || year > 2200 || month !== null && (!Number.isInteger(month) || month < 1 || month > 12)) throw fail('Choose a valid year and month.');
    const shared = !!settings().shared;
    const shipments = shared || req.user.role === 'admin' ? db.prepare('SELECT * FROM shipments').all() : visibleShipments(req.user);
    const allowed = new Set(shipments.map(s => s.id));
    const detailAllowed = new Set(visibleShipments(req.user).map(s => s.id));
    const checks = db.prepare('SELECT c.*,p.shipmentId FROM pallet_checks c JOIN pallets p ON p.id=c.palletId WHERE c.active=1').all().filter(c => allowed.has(c.shipmentId));
    const users = db.prepare("SELECT id,CASE WHEN nickname<>'' THEN nickname ELSE name END AS name FROM users WHERE challengeParticipating=1 AND active=1").all();
    const scores = new Map(users.map(u => [u.id, { ...u, checks: 0, pallets: 0, palletKm: 0, provisionalKm: 0 }]));
    const inPeriod = date => { const period = periodOf(date); return period.year === year && (!month || period.month === month); };
    for (const check of checks) if (scores.has(check.userId) && inPeriod(check.checkedAt)) { scores.get(check.userId).checks++; if (['inLocation', 'inWarehouse'].includes(check.stage)) scores.get(check.userId).pallets++; }
    const byShipment = new Map();
    for (const check of checks) { if (!byShipment.has(check.shipmentId)) byShipment.set(check.shipmentId, []); byShipment.get(check.shipmentId).push(check); }
    const transports = [];
    for (const shipment of shipments) {
      const palletCount = db.prepare('SELECT COUNT(*) AS n FROM pallets WHERE shipmentId=?').get(shipment.id).n;
      for (const [leg, stages, arrival, distance] of [['outbound', ['outWarehouse','inLocation'], 'inLocation', shipment.outboundKm], ['return', ['outLocation','inWarehouse'], 'inWarehouse', shipment.returnKm]]) {
        const legChecks = (byShipment.get(shipment.id) || []).filter(c => stages.includes(c.stage));
        const votes = new Map(); for (const check of legChecks) if (scores.has(check.userId)) votes.set(check.userId, (votes.get(check.userId) || 0) + 1);
        const top = Math.max(0, ...votes.values());
        const winners = [...votes].filter(([, count]) => count === top).map(([id]) => id);
        const arrivals = legChecks.filter(c => c.stage === arrival);
        const periodArrivals = arrivals.filter(c => inPeriod(c.checkedAt));
        const completed = palletCount > 0 && arrivals.length === palletCount;
        const kilometres = distance === null ? 0 : distance * periodArrivals.length;
        for (const id of winners) { scores.get(id).palletKm += kilometres / winners.length; if (!completed) scores.get(id).provisionalKm += kilometres / winners.length; }
        if (detailAllowed.has(shipment.id) && periodArrivals.length) transports.push({ shipmentId: shipment.id, name: shipment.name, leg, distanceKm: distance, arrived: periodArrivals.length, totalPallets: palletCount, completed, palletKm: kilometres, winners: winners.map(id => ({ id, name: scores.get(id).name })) });
      }
    }
    const rows = [...scores.values()].filter(s => s.checks || s.palletKm || s.id === req.user.id).map(s => ({ ...s, badges: [s.pallets >= 1 && 'First Delivery', s.checks >= 100 && '100 Pallet Checks', s.palletKm >= 1000 && '1,000 Pallet Kilometres'].filter(Boolean) }));
    const years = [...new Set([currentPeriod.year, ...checks.map(c => periodOf(c.checkedAt).year)])].sort((a,b) => b-a);
    res.json({ year, month, years, shared, participating: scores.has(req.user.id), rows, transports });
  });
  return {
    defaultWarehouse: () => settings().warehouseAddress,
    record(pallet, stage, checked, userId, timestamp) {
      const wasChecked = !!JSON.parse(pallet.statuses)[stage];
      if (wasChecked === checked) return;
      if (checked) db.prepare('INSERT INTO pallet_checks VALUES(?,?,?,?,1) ON CONFLICT(palletId,stage) DO UPDATE SET active=1').run(pallet.id, stage, userId, timestamp);
      else db.prepare('UPDATE pallet_checks SET active=0 WHERE palletId=? AND stage=?').run(pallet.id, stage);
    }
  };
}
