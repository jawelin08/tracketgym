/* opengym-db — MySQL storage layer for openGym API */

import mysql from 'mysql2/promise';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/* ---------- MySQL connection pool ---------- */
const databaseUrl = (process.env.DATABASE_URL || process.env.MYSQL_URL || '').trim();
const pool = databaseUrl
  ? mysql.createPool(databaseUrl)
  : mysql.createPool({
      host:     process.env.DB_HOST || 'localhost',
      port:     +(process.env.DB_PORT || 3306),
      user:     process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'tracketgym',
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0
    });

/* ---------- in-memory cache arrays ---------- */
let users = [];
let creds = [];
let subs = [];
let invites = [];
let gyms = [];
let platformInvites = [];
let cacheLoaded = false;

/* ---------- helpers ---------- */
function normalizeEmail(e) {
  return (e || '').trim().toLowerCase().replace(/[^a-z0-9@.]/g, '');
}
function normalizeUsername(u) {
  return (u || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
}

/* ---------- schema init ---------- */
async function initDb() {
  const conn = await pool.getConnection();
  try {
    await conn.query(`CREATE TABLE IF NOT EXISTS users (
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

    await conn.query(`CREATE TABLE IF NOT EXISTS credentials (
      id VARCHAR(255) PRIMARY KEY,
      userId VARCHAR(50),
      publicKey LONGTEXT,
      counter INT,
      transports JSON,
      created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    )`);

    await conn.query(`CREATE TABLE IF NOT EXISTS subscriptions (
      id VARCHAR(100) PRIMARY KEY,
      userId VARCHAR(50),
      endpoint TEXT,
      auth VARCHAR(255),
      p256dh VARCHAR(255),
      created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    )`);

    await conn.query(`CREATE TABLE IF NOT EXISTS invites (
      code VARCHAR(50) PRIMARY KEY,
      createdBy VARCHAR(50),
      usedBy VARCHAR(50),
      usedAt TIMESTAMP,
      revoked BOOLEAN DEFAULT FALSE,
      created TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    await conn.query(`CREATE TABLE IF NOT EXISTS gyms (
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

    await conn.query(`CREATE TABLE IF NOT EXISTS platform_invites (
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

    console.log('MySQL schema initialized');
  } finally {
    conn.release();
  }
}

/* ---------- load cache from MySQL ---------- */
async function loadCache() {
  if (cacheLoaded) return;
  cacheLoaded = true;
  try {
    const [u] = await pool.query('SELECT * FROM users'); users = u || [];
    const [c] = await pool.query('SELECT * FROM credentials'); creds = c || [];
    const [s] = await pool.query('SELECT * FROM subscriptions'); subs = s || [];
    const [i] = await pool.query('SELECT * FROM invites'); invites = i || [];
    const [g] = await pool.query('SELECT * FROM gyms'); gyms = g || [];
    const [pi] = await pool.query('SELECT * FROM platform_invites'); platformInvites = pi || [];
    console.log('MySQL cache loaded');
  } catch (e) {
    console.warn('MySQL cache load failed:', e.message);
    users = []; creds = []; subs = []; invites = []; gyms = []; platformInvites = [];
  }
}

/* ---------- save (no-op for MySQL) ---------- */
async function saveDb() {
  // MySQL writes are direct, nothing to batch-save
}

/* ---------- migrate from db.json ---------- */
async function migrateFromDbJson(dbJson) {
  if (!dbJson || !dbJson.users || !dbJson.users.length) return;
  for (const user of dbJson.users) {
    const created = user.created ? new Date(user.created) : new Date();
    await pool.query(
      `INSERT IGNORE INTO users (id, name, username, email, usernameLower, emailLower, passwordSalt, passwordHash, gymId, admin, superadmin, disabled, created, invitedBy, sv, lastReminder)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [user.id, user.name, user.username, user.email, user.usernameLower, user.emailLower,
       user.passwordSalt, user.passwordHash, user.gymId, user.admin ? 1 : 0, user.superadmin ? 1 : 0,
       user.disabled ? 1 : 0, created, user.invitedBy, user.sv || 0, user.lastReminder || null]
    );
  }
  for (const cred of (dbJson.creds || [])) {
    await pool.query(`INSERT IGNORE INTO credentials (id, userId, publicKey, counter, transports, created) VALUES (?, ?, ?, ?, ?, ?)`,
      [cred.id, cred.userId, cred.publicKey, cred.counter || 0, JSON.stringify(cred.transports || []), cred.created || new Date().toISOString()]);
  }
  for (const sub of (dbJson.subs || [])) {
    await pool.query(`INSERT IGNORE INTO subscriptions (id, userId, endpoint, auth, p256dh, created) VALUES (?, ?, ?, ?, ?, ?)`,
      [sub.id || crypto.randomBytes(12).toString('base64url'), sub.userId, sub.endpoint, sub.auth, sub.p256dh, sub.created || new Date().toISOString()]);
  }
  for (const invite of (dbJson.invites || [])) {
    await pool.query(`INSERT IGNORE INTO invites (code, createdBy, usedBy, usedAt, revoked, created) VALUES (?, ?, ?, ?, ?, ?)`,
      [invite.code, invite.createdBy, invite.usedBy, invite.usedAt || null, invite.revoked ? 1 : 0, invite.created || new Date().toISOString()]);
  }
  for (const gym of (dbJson.gyms || [])) {
    await pool.query(`INSERT IGNORE INTO gyms (id, name, slug, status, plan, seats, ownerId, note, licenseExpiresAt, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [gym.id, gym.name, gym.slug, gym.status, gym.plan, gym.seats, gym.ownerId, gym.note, gym.licenseExpiresAt || null, gym.created || new Date().toISOString()]);
  }
  for (const pi of (dbJson.platformInvites || [])) {
    await pool.query(`INSERT IGNORE INTO platform_invites (token, gymId, email, role, name, usedBy, usedAt, expiresAt, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [pi.token, pi.gymId, pi.email, pi.role, pi.name, pi.usedBy, pi.usedAt || null, pi.expiresAt || null, pi.created || new Date().toISOString()]);
  }
  console.log('MySQL migration completed');
}

/* ---------- user operations ---------- */
function getUserByIdSync(id) {
  const user = users.find(u => u.id === id);
  return user || null;
}

async function getUserByEmail(email) {
  const [[row]] = await pool.query('SELECT * FROM users WHERE emailLower = ?', [normalizeEmail(email)]);
  return row || null;
}

async function getUserByUsername(username) {
  const [[row]] = await pool.query('SELECT * FROM users WHERE usernameLower = ?', [normalizeUsername(username)]);
  return row || null;
}

async function getAllUsers() {
  const [rows] = await pool.query('SELECT * FROM users');
  return rows || [];
}

async function createUser(user) {
  user.usernameLower = normalizeUsername(user.username);
  user.emailLower = normalizeEmail(user.email);
  await pool.query(
    `INSERT INTO users (id, name, username, email, usernameLower, emailLower, passwordSalt, passwordHash, gymId, admin, superadmin, disabled, created, invitedBy, sv)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [user.id, user.name, user.username || null, user.email, user.usernameLower, user.emailLower,
     user.passwordSalt || null, user.passwordHash || null, user.gymId || null,
     user.admin ? 1 : 0, user.superadmin ? 1 : 0, user.disabled ? 1 : 0,
     user.created || new Date().toISOString(), user.invitedBy || null, user.sv || 0]
  );
  users.push(user);
  return user;
}

async function updateUser(user) {
  await pool.query(
    `UPDATE users SET name = ?, username = ?, email = ?, usernameLower = ?, emailLower = ?,
     passwordSalt = ?, passwordHash = ?, gymId = ?, admin = ?, superadmin = ?, disabled = ?,
     invitedBy = ?, sv = ?, lastReminder = ? WHERE id = ?`,
    [user.name, user.username || null, user.email, user.usernameLower || null, user.emailLower || null,
     user.passwordSalt || null, user.passwordHash || null, user.gymId || null,
     user.admin ? 1 : 0, user.superadmin ? 1 : 0, user.disabled ? 1 : 0,
     user.invitedBy || null, user.sv || 0, user.lastReminder || null, user.id]
  );
  const idx = users.findIndex(u => u.id === user.id);
  if (idx >= 0) users[idx] = user;
}

async function addUserAdmin(id) {
  const user = users.find(u => u.id === id);
  if (user) await updateUser({ ...user, admin: true, superadmin: true });
}

/* ---------- credential operations ---------- */
async function getCredById(id) {
  const [[row]] = await pool.query('SELECT * FROM credentials WHERE id = ?', [id]);
  return row || null;
}

async function createCred(cred) {
  await pool.query(
    `INSERT INTO credentials (id, userId, publicKey, counter, transports, created) VALUES (?, ?, ?, ?, ?, ?)`,
    [cred.id, cred.userId, cred.publicKey, cred.counter || 0, JSON.stringify(cred.transports || []), cred.created || new Date().toISOString()]
  );
  creds.push(cred);
}

async function updateCredCounter(id, counter) {
  await pool.query('UPDATE credentials SET counter = ? WHERE id = ?', [counter, id]);
  const idx = creds.findIndex(c => c.id === id);
  if (idx >= 0) creds[idx].counter = counter;
}

/* ---------- invite operations ---------- */
async function getInviteByCode(code) {
  const [[row]] = await pool.query('SELECT * FROM invites WHERE code = ?', [(code || '').toUpperCase()]);
  return row || null;
}

async function createInvite(invite) {
  await pool.query(
    `INSERT INTO invites (code, createdBy, usedBy, usedAt, revoked, created) VALUES (?, ?, ?, ?, ?, ?)`,
    [invite.code, invite.createdBy || null, invite.usedBy || null, invite.usedAt || null, invite.revoked ? 1 : 0, invite.created || new Date().toISOString()]
  );
  invites.push(invite);
}

async function useInvite(code, userId) {
  await pool.query('UPDATE invites SET usedBy = ?, usedAt = NOW() WHERE code = ?', [userId, (code || '').toUpperCase()]);
  const idx = invites.findIndex(i => i.code === (code || '').toUpperCase());
  if (idx >= 0) invites[idx].usedBy = userId;
}

async function revokeInvite(code) {
  await pool.query('UPDATE invites SET revoked = TRUE WHERE code = ?', [(code || '').toUpperCase()]);
  const idx = invites.findIndex(i => i.code === (code || '').toUpperCase());
  if (idx >= 0) invites[idx].revoked = true;
}

/* ---------- platform invite operations ---------- */
async function getPlatformInviteByToken(token) {
  const [[row]] = await pool.query('SELECT * FROM platform_invites WHERE token = ?', [token]);
  return row || null;
}

async function createPlatformInvite(invite) {
  await pool.query(
    `INSERT INTO platform_invites (token, gymId, email, role, name, created, expiresAt) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [invite.token, invite.gymId, invite.email, invite.role || 'owner', invite.name || null, invite.created || new Date().toISOString(), invite.expiresAt || null]
  );
  platformInvites.push(invite);
}

async function usePlatformInvite(token, userId) {
  await pool.query('UPDATE platform_invites SET usedBy = ?, usedAt = NOW() WHERE token = ?', [userId, token]);
  const idx = platformInvites.findIndex(i => i.token === token);
  if (idx >= 0) platformInvites[idx].usedBy = userId;
}

/* ---------- gym operations ---------- */
async function getGymById(id) {
  const [[row]] = await pool.query('SELECT * FROM gyms WHERE id = ?', [id]);
  return row || null;
}

async function getAllGyms() {
  const [rows] = await pool.query('SELECT * FROM gyms');
  return rows || [];
}

async function getAllInvites() {
  const [rows] = await pool.query('SELECT * FROM invites');
  return rows || [];
}

async function createGym(gym) {
  await pool.query(
    `INSERT INTO gyms (id, name, slug, status, plan, seats, ownerId, note, licenseExpiresAt, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [gym.id, gym.name, gym.slug, gym.status || 'active', gym.plan || 'starter', gym.seats || 500,
     gym.ownerId || null, gym.note || null, gym.licenseExpiresAt || null, gym.created || new Date().toISOString()]
  );
  gyms.push(gym);
}

async function updateGym(id, updates) {
  const fields = Object.keys(updates);
  if (fields.length > 0) {
    const setClause = fields.map(f => `${f} = ?`).join(', ');
    await pool.query(`UPDATE gyms SET ${setClause} WHERE id = ?`, [...fields.map(f => updates[f]), id]);
  }
  const idx = gyms.findIndex(g => g.id === id);
  if (idx >= 0) Object.assign(gyms[idx], updates);
}

/* ---------- subscription operations ---------- */
async function getSubByEndpoint(endpoint) {
  const [[row]] = await pool.query('SELECT * FROM subscriptions WHERE endpoint = ?', [endpoint]);
  return row || null;
}

async function createSub(sub) {
  sub.id = sub.id || crypto.randomBytes(12).toString('base64url');
  await pool.query(
    `INSERT INTO subscriptions (id, userId, endpoint, auth, p256dh, created) VALUES (?, ?, ?, ?, ?, ?)`,
    [sub.id, sub.userId, sub.endpoint, sub.auth, sub.p256dh, sub.created || new Date().toISOString()]
  );
  subs.push(sub);
}

async function deleteSubByEndpoint(endpoint) {
  await pool.query('DELETE FROM subscriptions WHERE endpoint = ?', [endpoint]);
  subs = subs.filter(s => s.endpoint !== endpoint);
}

async function getSubsByUserId(userId) {
  const [rows] = await pool.query('SELECT * FROM subscriptions WHERE userId = ?', [userId]);
  return rows || [];
}

async function removeSub(sub) {
  await pool.query('DELETE FROM subscriptions WHERE id = ?', [sub.id]);
  subs = subs.filter(s => s.id !== sub.id);
}

async function getAllPlatformInvites() {
  const [rows] = await pool.query('SELECT * FROM platform_invites');
  return rows || [];
}

/* ---------- db object: legacy array access + all functions ---------- */
const db = {
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
  set platformInvites(v) { platformInvites = v; },

  initDb,
  saveDb,
  loadCache,
  migrateFromDbJson,
  getUserByIdSync,
  getUserByEmail,
  getUserByUsername,
  getAllUsers,
  createUser,
  updateUser,
  addUserAdmin,
  getCredById,
  createCred,
  updateCredCounter,
  getInviteByCode,
  createInvite,
  useInvite,
  revokeInvite,
  getPlatformInviteByToken,
  createPlatformInvite,
  usePlatformInvite,
  getGymById,
  getAllGyms,
  getAllInvites,
  createGym,
  updateGym,
  getSubByEndpoint,
  createSub,
  deleteSubByEndpoint,
  removeSub,
  getSubsByUserId,
  getAllPlatformInvites,
  getAllInvites
};

export { db, pool, getUserByIdSync };

/* ---------- auto-init on import ---------- */
Promise.resolve().then(() => {
  initDb().then(() => loadCache()).catch(e => console.warn('db auto-init failed:', e.message));
}).catch(() => {});
