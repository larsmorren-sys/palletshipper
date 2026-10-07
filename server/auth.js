import { revision } from './revisions.js';
import { randomBytes, randomUUID, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { defaultColumns, stages } from '../shared/tracking.js';

const derive = promisify(scrypt);
const digest = value => createHash('sha256').update(String(value)).digest('hex');
const same = (a, b) => timingSafeEqual(Buffer.from(digest(a), 'hex'), Buffer.from(digest(b), 'hex'));
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const safeUser = row => ({ id: row.id, name: row.name, email: row.email, role: row.role, active: !!row.active, nickname: row.nickname || '', challengeParticipating: !!row.challengeParticipating });
const normalizeEmail = value => String(value || '').trim().toLowerCase();
const passwordOptions = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
function validPassword(password) { if (typeof password !== 'string' || password.length < 12 || password.length > 256) throw fail('Use a password of 12 to 256 characters.'); }
async function hashPassword(password) {
  validPassword(password);
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${(await derive(password, salt, 64, passwordOptions)).toString('hex')}`;
}
async function checkPassword(password, hash) {
  if (typeof password !== 'string' || password.length > 256) return false;
  const [salt, expected] = hash.split(':');
  const actual = await derive(password, salt, 64, passwordOptions);
  return timingSafeEqual(actual, Buffer.from(expected, 'hex'));
}
function userInput(body) {
  const name = String(body.name || '').trim(), email = normalizeEmail(body.email), role = body.role ?? 'member';
  if (!name || name.length > 200 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw fail('Enter a name and a valid email address.');
  if (!['admin', 'member'].includes(role)) throw fail('Invalid user role.');
  return { name, email, role };
}

export function installAuth(app, db, dataDir) {
  db.exec(`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, passwordHash TEXT NOT NULL, role TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS sessions (tokenHash TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES users(id), csrfToken TEXT NOT NULL, expiresAt INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS shipment_access (shipmentId TEXT NOT NULL REFERENCES shipments(id), userId TEXT NOT NULL REFERENCES users(id), PRIMARY KEY(shipmentId, userId));
    CREATE TABLE IF NOT EXISTS column_preferences (shipmentId TEXT NOT NULL REFERENCES shipments(id), userId TEXT NOT NULL REFERENCES users(id), columns TEXT NOT NULL, PRIMARY KEY(shipmentId, userId));
    CREATE TABLE IF NOT EXISTS auth_attempts (key TEXT PRIMARY KEY, count INTEGER NOT NULL, resetAt INTEGER NOT NULL);`);
  for (const [field, type] of [['nickname', "TEXT NOT NULL DEFAULT ''"], ['challengeParticipating', 'INTEGER NOT NULL DEFAULT 0']]) {
    if (!db.prepare('PRAGMA table_info(users)').all().some(column => column.name === field)) db.exec(`ALTER TABLE users ADD COLUMN ${field} ${type}`);
  }
  if (!db.prepare('PRAGMA table_info(shipments)').all().some(c => c.name === 'ownerId')) db.exec('ALTER TABLE shipments ADD COLUMN ownerId TEXT REFERENCES users(id)');
  const setupPath = path.join(dataDir, 'setup-token.txt');
  const setupRequired = () => db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0;
  if (setupRequired() && !process.env.SETUP_TOKEN && !existsSync(setupPath)) writeFileSync(setupPath, randomBytes(24).toString('hex'), { mode: 0o600 });
  const setupToken = process.env.SETUP_TOKEN || (existsSync(setupPath) ? readFileSync(setupPath, 'utf8').trim() : '');
  const cookieName = 'palletshipper_session';
  const cookieOptions = { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 8 * 60 * 60 * 1000 };
  const readSession = req => {
    const cookie = req.headers.cookie?.split(';').map(c => c.trim()).find(c => c.startsWith(`${cookieName}=`));
    if (!cookie) return null;
    const token = cookie.slice(cookieName.length + 1);
    return db.prepare('SELECT u.*, s.csrfToken, s.tokenHash FROM sessions s JOIN users u ON u.id=s.userId WHERE s.tokenHash=? AND s.expiresAt>? AND u.active=1').get(digest(token), Date.now());
  };
  const issueSession = (req, res, user) => {
    const previous = readSession(req);
    if (previous) db.prepare('DELETE FROM sessions WHERE tokenHash=?').run(previous.tokenHash);
    const token = randomBytes(32).toString('hex'), csrfToken = randomBytes(24).toString('hex');
    db.prepare('DELETE FROM sessions WHERE expiresAt<=?').run(Date.now());
    db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?)').run(digest(token), user.id, csrfToken, Date.now() + cookieOptions.maxAge);
    res.cookie(cookieName, token, cookieOptions);
    return { user: safeUser(user), csrfToken, setupRequired: false };
  };
  const admin = req => { if (req.user.role !== 'admin') throw fail('Only administrators can manage users.', 403); };
  const canManage = (user, shipment) => user.role === 'admin' || shipment.ownerId === user.id;
  const requireShipment = (user, id, manage = false) => {
    const shipment = db.prepare('SELECT * FROM shipments WHERE id=?').get(id);
    if (!shipment || !(canManage(user, shipment) || !manage && db.prepare('SELECT 1 FROM shipment_access WHERE shipmentId=? AND userId=?').get(id, user.id))) throw fail('Shipment not found or access denied.', 404);
    return shipment;
  };
  const viewShipment = (user, shipment) => ({ ...shipment, revision: revision(db.prepare('SELECT * FROM shipments WHERE id=?').get(shipment.id)), canManage: canManage(user, shipment) });
  function throttle(req, scope) {
    const key = `${scope}:${req.ip}`, now = Date.now();
    db.prepare('DELETE FROM auth_attempts WHERE resetAt<=?').run(now);
    const row = db.prepare('SELECT * FROM auth_attempts WHERE key=?').get(key);
    if (row && row.count >= 10) throw fail('Too many attempts. Try again in 15 minutes.', 429);
    db.prepare('INSERT INTO auth_attempts VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count=count+1').run(key, now + 15 * 60 * 1000);
    return key;
  }
  app.set('trust proxy', 1);
  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin' });
    if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) res.set('Cache-Control', 'no-store');
    next();
  });
  // Custom headers and no CORS prevent cross-origin form submissions, including login CSRF.
  app.use('/api', (req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && (req.headers['x-palletshipper'] !== '1' || req.headers['sec-fetch-site'] === 'cross-site')) throw fail('Invalid request. Reload the page.', 403);
    next();
  });
  app.get('/api/auth/session', (req, res) => {
    const session = readSession(req);
    res.json({ user: session ? safeUser(session) : null, csrfToken: session?.csrfToken || null, setupRequired: setupRequired() });
  });
  app.post('/api/auth/setup', async (req, res) => {
    const key = throttle(req, 'setup');
    if (!setupRequired()) throw fail('The first administrator has already been created.', 409);
    if (!setupToken || !same(req.body.setupToken || '', setupToken)) throw fail('Invalid setup code.', 403);
    const input = userInput({ ...req.body, role: 'admin' });
    const passwordHash = await hashPassword(req.body.password);
    if (!setupRequired()) throw fail('The first administrator has already been created.', 409);
    const user = { id: randomUUID(), ...input, active: 1 };
    db.prepare('INSERT INTO users (id,name,email,passwordHash,role,active) VALUES (?, ?, ?, ?, ?, 1)').run(user.id, user.name, user.email, passwordHash, 'admin');
    db.prepare('DELETE FROM auth_attempts WHERE key=?').run(key);
    if (existsSync(setupPath)) unlinkSync(setupPath);
    res.status(201).json(issueSession(req, res, user));
  });
  app.post('/api/auth/login', async (req, res) => {
    const key = throttle(req, 'login');
    const user = db.prepare('SELECT * FROM users WHERE email=?').get(normalizeEmail(req.body.email));
    const valid = await checkPassword(req.body.password, user?.passwordHash || `${'0'.repeat(32)}:${'0'.repeat(128)}`);
    if (!user || !user.active || !valid) throw fail('Incorrect email address or password.', 401);
    // Re-read after password derivation so deactivation/reset immediately takes effect.
    const current = db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
    if (!current.active || current.passwordHash !== user.passwordHash) throw fail('Incorrect email address or password.', 401);
    db.prepare('DELETE FROM auth_attempts WHERE key=?').run(key);
    res.json(issueSession(req, res, current));
  });
  app.use(['/api', '/uploads'], (req, res, next) => {
    if (req.path === '/health' && req.method === 'GET' && req.baseUrl === '/api') return next();
    const session = readSession(req);
    if (!session) throw fail('Log in to continue.', 401);
    req.user = safeUser(session); req.session = session;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !same(req.headers['x-csrf-token'] || '', session.csrfToken)) throw fail('Invalid session. Reload the page.', 403);
    next();
  });
  app.post('/api/auth/logout', (req, res) => {
    db.prepare('DELETE FROM sessions WHERE tokenHash=?').run(req.session.tokenHash);
    res.clearCookie(cookieName, { ...cookieOptions, maxAge: undefined }); res.json({ ok: true });
  });
  app.patch('/api/auth/profile', (req, res) => {
    const { nickname, challengeParticipating } = req.body;
    if (Object.keys(req.body).some(key => !['nickname', 'challengeParticipating'].includes(key)) || typeof nickname !== 'string' || nickname.trim().length > 40 || /[\u0000-\u001f\u007f]/.test(nickname) || typeof challengeParticipating !== 'boolean') throw fail('Enter a nickname of up to 40 characters and a valid participation choice.');
    db.prepare('UPDATE users SET nickname=?,challengeParticipating=? WHERE id=?').run(nickname.trim(), Number(challengeParticipating), req.user.id);
    res.json({ user: safeUser(db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id)) });
  });
  app.post('/api/auth/password', async (req, res) => {
    throttle(req, 'password');
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
    if (!await checkPassword(req.body.currentPassword, user.passwordHash)) throw fail('Incorrect current password.');
    const passwordHash = await hashPassword(req.body.password);
    const current = db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
    if (!readSession(req) || current.passwordHash !== user.passwordHash) throw fail('Your session has changed. Log in again.', 401);
    db.prepare('UPDATE users SET passwordHash=? WHERE id=?').run(passwordHash, user.id);
    db.prepare('DELETE FROM sessions WHERE userId=?').run(user.id);
    res.json(issueSession(req, res, current));
  });
  app.get('/api/users', (req, res) => { admin(req); res.json(db.prepare('SELECT * FROM users ORDER BY name').all().map(safeUser)); });
  app.post('/api/users', async (req, res) => {
    admin(req); const input = userInput(req.body);
    if (db.prepare('SELECT id FROM users WHERE email=?').get(input.email)) throw fail('This email address is already in use.');
    const passwordHash = await hashPassword(req.body.password);
    const user = { id: randomUUID(), ...input, active: 1 };
    admin({ user: db.prepare('SELECT * FROM users WHERE id=? AND active=1').get(req.user.id) || { role: 'member' } });
    try { db.prepare('INSERT INTO users (id,name,email,passwordHash,role,active) VALUES (?, ?, ?, ?, ?, 1)').run(user.id, user.name, user.email, passwordHash, user.role); }
    catch { throw fail('This email address is already in use.'); }
    res.status(201).json(safeUser(user));
  });
  app.patch('/api/users/:id', async (req, res) => {
    admin(req);
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
    if (!user) throw fail('User not found.', 404);
    const input = userInput({ ...user, ...req.body });
    const active = 'active' in req.body ? req.body.active : !!user.active;
    if (typeof active !== 'boolean') throw fail('Invalid account status.');
    const passwordHash = 'password' in req.body ? await hashPassword(req.body.password) : user.passwordHash;
    admin({ user: db.prepare('SELECT * FROM users WHERE id=? AND active=1').get(req.user.id) || { role: 'member' } });
    const current = db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
    if (current.role === 'admin' && current.active && (!active || input.role !== 'admin') && db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='admin' AND active=1").get().n <= 1) throw fail('At least one active administrator must remain.');
    if (db.prepare('SELECT id FROM users WHERE email=? AND id<>?').get(input.email, user.id)) throw fail('This email address is already in use.');
    db.prepare('UPDATE users SET name=?, email=?, role=?, active=?, passwordHash=? WHERE id=?').run(input.name, input.email, input.role, Number(active), passwordHash, user.id);
    if ('password' in req.body || input.role !== current.role || !active) db.prepare('DELETE FROM sessions WHERE userId=?').run(user.id);
    res.json(safeUser({ ...user, ...input, active }));
  });
  app.get('/api/shipments/:id/access', (req, res) => {
    const shipment = requireShipment(req.user, req.params.id, true);
    const owner = shipment.ownerId ? db.prepare('SELECT * FROM users WHERE id=?').get(shipment.ownerId) : null;
    const users = req.user.role === 'admin' ? db.prepare('SELECT * FROM users ORDER BY name').all() : db.prepare("SELECT * FROM users WHERE active=1 AND role='member' ORDER BY name").all();
    res.json({ owner: owner ? safeUser(owner) : null, users: users.map(safeUser), userIds: db.prepare('SELECT userId FROM shipment_access WHERE shipmentId=?').all(shipment.id).map(row => row.userId) });
  });
  app.put('/api/shipments/:id/access', (req, res) => {
    requireShipment(req.user, req.params.id, true);
    const ids = req.body.userIds;
    if (!Array.isArray(ids) || ids.length > 1000 || ids.some(id => typeof id !== 'string' || !db.prepare('SELECT id FROM users WHERE id=? AND active=1').get(id))) throw fail('Select valid active users.');
    db.exec('BEGIN');
    try {
      db.prepare('DELETE FROM shipment_access WHERE shipmentId=?').run(req.params.id);
      const insert = db.prepare('INSERT INTO shipment_access VALUES (?, ?)');
      for (const id of new Set(ids)) insert.run(req.params.id, id);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    res.json({ ok: true });
  });
  if (!db.prepare('PRAGMA table_info(column_preferences)').all().some(column => column.name === 'palletColumns')) db.exec("ALTER TABLE column_preferences ADD COLUMN palletColumns TEXT NOT NULL DEFAULT '{}'");
  const getColumns = (userId, shipmentId, scope = 'items') => {
    const row = db.prepare('SELECT * FROM column_preferences WHERE userId=? AND shipmentId=?').get(userId, shipmentId);
    return { ...defaultColumns, ...JSON.parse((scope === 'pallets' ? row?.palletColumns : row?.columns) || '{}') };
  };
  app.put(['/api/shipments/:id/columns', '/api/shipments/:id/pallet-columns'], (req, res) => {
    requireShipment(req.user, req.params.id);
    const columns = req.body.columns;
    if (!columns || Object.keys(columns).length !== stages.length || stages.some(([key]) => typeof columns[key] !== 'boolean')) throw fail('Set the visibility of all four columns.');
    const field = req.path.endsWith('/pallet-columns') ? 'palletColumns' : 'columns';
    db.prepare(`INSERT INTO column_preferences (shipmentId, userId, columns, palletColumns) VALUES (?, ?, ?, ?) ON CONFLICT(shipmentId,userId) DO UPDATE SET ${field}=excluded.${field}`).run(req.params.id, req.user.id, JSON.stringify(field === 'columns' ? columns : defaultColumns), JSON.stringify(field === 'palletColumns' ? columns : defaultColumns));
    res.json({ columns });
  });
  app.use('/uploads', (req, res, next) => {
    const photo = `/uploads${req.path}`;
    const pallet = db.prepare('SELECT p.shipmentId FROM pallet_photos ph JOIN pallets p ON p.id=ph.palletId WHERE ph.url=?').get(photo);
    if (!pallet) throw fail('Photo not found.', 404);
    requireShipment(req.user, pallet.shipmentId); next();
  });
  return { requireShipment, canManage, viewShipment, getColumns };
}
