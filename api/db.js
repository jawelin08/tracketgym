/* opengym-db — MySQL storage layer for openGym API
   Replaces JSON-file storage (db.json, state-*.json) with MySQL. */

import mysql from 'mysql2/promise';

/* ---------- pool ---------- */
let pool = null;

function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.DB_HOST || 'localhost',
      port: +(process.env.DB_PORT || 3306),
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'tracketgym',
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0
    });
  }
  return pool;
}

/* ---------- schema ---------- */
export async function initDb() {
  const p = getPool();

  await p.query(`CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100),
    username VARCHAR(100),
    email VARCHAR(255),
    usernameLower VARCHAR(100),
    emailLower VARCHAR(255),
    passwordSalt VARCHAR(255),
    passwordHash VARCHAR(255),
    gymId VARCHAR(50),
    admin BOOLEAN DEFAULT FALSE,
    superadmin BOOLEAN DEFAULT FALSE,
    disabled BOOLEAN DEFAULT FALSE,
    created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    invitedBy VARCHAR(100),
    sv INT DEFAULT 0,
    lastReminder DATE,
    UNIQUE KEY unique_username (username),
    UNIQUE KEY unique_email (email),
    INDEX idx_emailLower (emailLower),
    INDEX idx_usernameLower (usernameLower),
    INDEX idx_gymId (gymId)
  )`);

  await p.query(`CREATE TABLE IF NOT EXISTS credentials (
    id VARCHAR(255) PRIMARY KEY,
    userId VARCHAR(50),
    publicKey LONGTEXT,
    counter INT,
    transports JSON,
    created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
  )`);

  await p.query(`CREATE TABLE IF NOT EXISTS subscriptions (
    id VARCHAR(100) PRIMARY KEY,
    userId VARCHAR(50),
    endpoint TEXT,
    auth VARCHAR(255),
    p256dh VARCHAR(255),
    created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
  )`);

  await p.query(`CREATE TABLE IF NOT EXISTS invites (
    code VARCHAR(50) PRIMARY KEY,
    createdBy VARCHAR(50),
    usedBy VARCHAR(50),
    usedAt TIMESTAMP,
    revoked BOOLEAN DEFAULT FALSE,
    created TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

  await p.query(`CREATE TABLE IF NOT EXISTS gyms (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100),
    slug VARCHAR(100),
    status VARCHAR(50),
    plan VARCHAR(50),
    seats INT,
    ownerId VARCHAR(50),
    note TEXT,
    licenseExpiresAt TIMESTAMP,
    created TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

  await p.query(`CREATE TABLE IF NOT EXISTS platform_invites (
    token VARCHAR(100) PRIMARY KEY,
    gymId VARCHAR(50),
    email VARCHAR(255),
    role VARCHAR(50),
    name VARCHAR(100),
    usedBy VARCHAR(50),
    usedAt TIMESTAMP,
    expiresAt TIMESTAMP,
    created TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);
}

/* ---------- in-memory cache (loaded from MySQL) ---------- */
let users = [];
let creds = [];
let subs = [];
let invites = [];
let gyms = [];
let platformInvites = [];
let cacheLoaded = false;

async function loadCache() {
  if (cacheLoaded) return;
  const p = getPool();
  const [u] = await p.query('SELECT * FROM users');
  users = u;
  const [c] = await p.query('SELECT * FROM credentials');
  creds = c;
  const [s] = await p.query('SELECT * FROM subscriptions');
  subs = s;
  const [i] = await p.query('SELECT * FROM invites');
  invites = i;
  const [g] = await p.query('SELECT * FROM gyms');
  gyms = g;
  const [pi] = await p.query('SELECT * FROM platform_invites');
  platformInvites = pi;
  cacheLoaded = true;
}

/* ---------- legacy array access (for code that does db.users.push etc.) ---------- */
// These are read-only getters. Write operations go through the CRUD functions below.
export const db = {
  get users() { return users; },
  set users(v) { users = v; },
  get creds() { return creds; },
  set creds(v) { creds = v; },
  get subs() { return subs; },
  set subs(v) { subs = v; },
  get invites() { return invites; },
  set invites(v) { invites = v; },
  get gyms() { return gyms; },
  set gyms(v) { gyms = v; },
  get platformInvites() { return platformInvites; },
  set platformInvites(v) { platformInvites = v; }
};

/* ---------- user operations ---------- */
export async function getUserById(id) {
  const p = getPool();
  const [rows] = await p.query('SELECT * FROM users WHERE id = ?', [id]);
  return rows[0] || null;
}

export async function getUserByEmail(email) {
  const p = getPool();
  const [rows] = await p.query('SELECT * FROM users WHERE emailLower = ?', [email.toLowerCase()]);
  return rows[0] || null;
}

export async function getUserByUsername(username) {
  const p = getPool();
  const [rows] = await p.query('SELECT * FROM users WHERE usernameLower = ?', [username.toLowerCase()]);
  return rows[0] || null;
}

export async function getAllUsers() {
  const p = getPool();
  const [rows] = await p.query('SELECT * FROM users');
  return rows;
}

export async function createUser(user) {
  const p = getPool();
  await p.query(
    `INSERT INTO users (id, name, username, email, usernameLower, emailLower, passwordSalt, passwordHash, gymId, admin, disabled, created, invitedBy, sv)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      user.id, user.name, user.username || null, user.email,
      user.usernameLower || null, user.emailLower || null,
      user.passwordSalt || null, user.passwordHash || null,
      user.gymId || null, user.admin ? 1 : 0, user.disabled ? 1 : 0,
      user.created || new Date().toISOString(),
      user.invitedBy || null, user.sv || 0
    ]
  );
  // Update in-memory cache
  users.push(user);
  return user;
}

export async function updateUser(user) {
  const p = getPool();
  await p.query(
    `UPDATE users SET name = ?, username = ?, email = ?, usernameLower = ?, emailLower = ?,
     passwordSalt = ?, passwordHash = ?, gymId = ?, admin = ?, disabled = ?,
     invitedBy = ?, sv = ?, lastReminder = ? WHERE id = ?`,
    [
      user.name, user.username || null, user.email,
      user.usernameLower || null, user.emailLower || null,
      user.passwordSalt || null, user.passwordHash || null,
      user.gymId || null,
      user.admin ? 1 : 0, user.disabled ? 1 : 0,
      user.invitedBy || null, user.sv || 0,
      user.lastReminder || null, user.id
    ]
  );
  // Update in-memory cache
  const idx = users.findIndex(u => u.id === user.id);
  if (idx >= 0) users[idx] = user;
}

export async function addUserAdmin(id) {
  await updateUser({ id, admin: true });
}

/* ---------- credential operations ---------- */
export async function getCredById(id) {
  const p = getPool();
  const [rows] = await p.query('SELECT * FROM credentials WHERE id = ?', [id]);
  return rows[0] || null;
}

export async function createCred(cred) {
  const p = getPool();
  await p.query(
    `INSERT INTO credentials (id, userId, publicKey, counter, transports, created)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      cred.id, cred.userId, cred.publicKey,
      cred.counter || 0,
      JSON.stringify(cred.transports || []),
      cred.created || new Date().toISOString()
    ]
  );
  creds.push(cred);
}

export async function updateCredCounter(id, counter) {
  const p = getPool();
  await p.query('UPDATE credentials SET counter = ? WHERE id = ?', [counter, id]);
  const idx = creds.findIndex(c => c.id === id);
  if (idx >= 0) creds[idx].counter = counter;
}

/* ---------- invite operations ---------- */
export async function getInviteByCode(code) {
  const p = getPool();
  const [rows] = await p.query('SELECT * FROM invites WHERE code = ?', [code.toUpperCase()]);
  return rows[0] || null;
}

export async function useInvite(code, userId) {
  const p = getPool();
  await p.query('UPDATE invites SET usedBy = ?, usedAt = NOW() WHERE code = ?', [userId, code.toUpperCase()]);
  const idx = invites.findIndex(i => i.code === code.toUpperCase());
  if (idx >= 0) invites[idx].usedBy = userId;
}

/* ---------- platform invite operations ---------- */
export async function getPlatformInviteByToken(token) {
  const p = getPool();
  const [rows] = await p.query('SELECT * FROM platform_invites WHERE token = ?', [token]);
  return rows[0] || null;
}

export async function createPlatformInvite(invite) {
  const p = getPool();
  await p.query(
    `INSERT INTO platform_invites (token, gymId, email, role, name, created, expiresAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      invite.token, invite.gymId, invite.email,
      invite.role || 'owner', invite.name || null,
      invite.created || new Date().toISOString(),
      invite.expiresAt || null
    ]
  );
  platformInvites.push(invite);
}

export async function usePlatformInvite(token, userId) {
  const p = getPool();
  await p.query('UPDATE platform_invites SET usedBy = ?, usedAt = NOW() WHERE token = ?', [userId, token]);
  const idx = platformInvites.findIndex(i => i.token === token);
  if (idx >= 0) platformInvites[idx].usedBy = userId;
}

/* ---------- gym operations ---------- */
export async function getGymById(id) {
  const p = getPool();
  const [rows] = await p.query('SELECT * FROM gyms WHERE id = ?', [id]);
  return rows[0] || null;
}

export async function getAllGyms() {
  const p = getPool();
  const [rows] = await p.query('SELECT * FROM gyms');
  return rows;
}

export async function createGym(gym) {
  const p = getPool();
  await p.query(
    `INSERT INTO gyms (id, name, slug, status, plan, seats, ownerId, note, licenseExpiresAt, created)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      gym.id, gym.name, gym.slug, gym.status || 'active',
      gym.plan || 'starter', gym.seats || 500,
      gym.ownerId || null, gym.note || null,
      gym.licenseExpiresAt || null,
      gym.created || new Date().toISOString()
    ]
  );
  gyms.push(gym);
}

export async function updateGym(id, updates) {
  const p = getPool();
  const fields = Object.keys(updates);
  if (fields.length === 0) return;
  const setClause = fields.map(f => `${f} = ?`).join(', ');
  const values = fields.map(f => updates[f]);
  await p.query(`UPDATE gyms SET ${setClause} WHERE id = ?`, [...values, id]);
  const idx = gyms.findIndex(g => g.id === id);
  if (idx >= 0) Object.assign(gyms[idx], updates);
}

/* ---------- subscription operations ---------- */
export async function getSubByEndpoint(endpoint) {
  const p = getPool();
  const [rows] = await p.query('SELECT * FROM subscriptions WHERE endpoint = ?', [endpoint]);
  return rows[0] || null;
}

export async function createSub(sub) {
  const p = getPool();
  await p.query(
    `INSERT INTO subscriptions (id, userId, endpoint, auth, p256dh, created)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      sub.id || crypto.randomBytes(12).toString('base64url'),
      sub.userId, sub.endpoint, sub.auth, sub.p256dh,
      sub.created || new Date().toISOString()
    ]
  );
  subs.push(sub);
}

export async function deleteSubByEndpoint(endpoint) {
  const p = getPool();
  await p.query('DELETE FROM subscriptions WHERE endpoint = ?', [endpoint]);
  subs = subs.filter(s => s.endpoint !== endpoint);
}

/* ---------- migration from db.json (called once on startup if needed) ---------- */
export async function migrateFromDbJson(dbJson) {
  // dbJson is the old { users, creds, subs, invites, gyms, platformInvites } object
  if (!dbJson || !dbJson.users || !dbJson.users.length) return;
  const p = getPool();
  for (const user of dbJson.users) {
    const created = user.created ? new Date(user.created) : new Date();
    await p.query(
      `INSERT IGNORE INTO users (id, name, username, email, usernameLower, emailLower, passwordSalt, passwordHash, gymId, admin, superadmin, disabled, created, invitedBy, sv, lastReminder)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        user.id, user.name, user.username, user.email,
        user.usernameLower, user.emailLower,
        user.passwordSalt, user.passwordHash,
        user.gymId, user.admin ? 1 : 0, user.superadmin ? 1 : 0,
        user.disabled ? 1 : 0,
        created, user.invitedBy, user.sv || 0, user.lastReminder || null
      ]
    );
  }
  for (const cred of (dbJson.creds || [])) {
    await p.query(
      `INSERT IGNORE INTO credentials (id, userId, publicKey, counter, transports, created)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [cred.id, cred.userId, cred.publicKey, cred.counter || 0, JSON.stringify(cred.transports || []), cred.created || new Date().toISOString()]
    );
  }
  for (const sub of (dbJson.subs || [])) {
    await p.query(
      `INSERT IGNORE INTO subscriptions (id, userId, endpoint, auth, p256dh, created)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [sub.id || crypto.randomBytes(12).toString('base64url'), sub.userId, sub.endpoint, sub.auth, sub.p256dh, sub.created || new Date().toISOString()]
    );
  }
  for (const invite of (dbJson.invites || [])) {
    await p.query(
      `INSERT IGNORE INTO invites (code, createdBy, usedBy, usedAt, revoked, created)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [invite.code, invite.createdBy, invite.usedBy, invite.usedAt || null, invite.revoked ? 1 : 0, invite.created || new Date().toISOString()]
    );
  }
  for (const gym of (dbJson.gyms || [])) {
    await p.query(
      `INSERT IGNORE INTO gyms (id, name, slug, status, plan, seats, ownerId, note, licenseExpiresAt, created)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [gym.id, gym.name, gym.slug, gym.status, gym.plan, gym.seats, gym.ownerId, gym.note, gym.licenseExpiresAt || null, gym.created || new Date().toISOString()]
    );
  }
  for (const invite of (dbJson.platformInvites || [])) {
    await p.query(
      `INSERT IGNORE INTO platform_invites (token, gymId, email, role, name, usedBy, usedAt, expiresAt, created)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [invite.token, invite.gymId, invite.email, invite.role, invite.name, invite.usedBy, invite.usedAt || null, invite.expiresAt || null, invite.created || new Date().toISOString()]
    );
  }
}