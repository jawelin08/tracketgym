/* opengym-db — Storage layer for openGym API
   Uses MySQL when DB_HOST is configured, falls back to JSON files otherwise.
   Even with DB_HOST set, if MySQL is unavailable it silently falls back to JSON. */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/* ---------- determine storage backend ---------- */
// When DB_HOST is set AND not 'localhost', try MySQL first; fall back to JSON on any failure.
const USE_MYSQL = !!(process.env.DB_HOST && process.env.DB_HOST !== 'localhost' && process.env.DB_HOST !== '127.0.0.1');

let mysqlPool = null;

/* ---------- MySQL pool (lazy) ---------- */
async function getMysqlPool() {
  if (!mysqlPool) {
    const mysql = await import('mysql2/promise');
    mysqlPool = mysql.createPool({
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
  return mysqlPool;
}

async function queryMysql(sql, params = []) {
  const p = await getMysqlPool();
  return p.query(sql, params);
}

/* ---------- JSON file storage ---------- */
const DB_DIR = process.env.DATA_DIR || '/data';
const DB_FILE = path.join(DB_DIR, 'db.json');

function ensureDir() {
  try { fs.mkdirSync(DB_DIR, { recursive: true }); } catch {}
}

function readJson() {
  try {
    ensureDir();
    if (!fs.existsSync(DB_FILE)) return defaultDb();
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch {
    return defaultDb();
  }
}

function defaultDb() {
  return {
    users: [], creds: [], subs: [], invites: [], gyms: [], platformInvites: []
  };
}

function writeJson(data) {
  ensureDir();
  const tmp = DB_FILE + '.tmp.' + crypto.randomBytes(4).toString('hex');
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, DB_FILE);
}

/* ---------- in-memory cache ---------- */
let users = [];
let creds = [];
let subs = [];
let invites = [];
let gyms = [];
let platformInvites = [];
let cacheLoaded = false;

async function loadCache() {
  if (cacheLoaded) return;
  cacheLoaded = true;
  const json = readJson();
  if (USE_MYSQL) {
    // Try to load from MySQL; if it fails, use JSON data
    try {
      const p = await getMysqlPool();
      const [u] = await p.query('SELECT * FROM users'); users = u;
      const [c] = await p.query('SELECT * FROM credentials'); creds = c;
      const [s] = await p.query('SELECT * FROM subscriptions'); subs = s;
      const [i] = await p.query('SELECT * FROM invites'); invites = i;
      const [g] = await p.query('SELECT * FROM gyms'); gyms = g;
      const [pi] = await p.query('SELECT * FROM platform_invites'); platformInvites = pi;
      console.log('MySQL cache loaded');
      return;
    } catch (e) {
      console.warn('MySQL unavailable, falling back to JSON storage:', e.message);
      users = json.users || [];
      creds = json.creds || [];
      subs = json.subs || [];
      invites = json.invites || [];
      gyms = json.gyms || [];
      platformInvites = json.platformInvites || [];
    }
  } else {
    users = json.users || [];
    creds = json.creds || [];
    subs = json.subs || [];
    invites = json.invites || [];
    gyms = json.gyms || [];
    platformInvites = json.platformInvites || [];
  }
}

/* ---------- legacy array access (read/write via CRUD functions) ---------- */
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
  set platformInvites(v) { platformInvites = v; },
  /* functions */
  initDb,
  saveDb,
  loadCache,
  getUserById,
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
  useInvite,
  getPlatformInviteByToken,
  createPlatformInvite,
  usePlatformInvite,
  getGymById,
  getAllGyms,
  createGym,
  updateGym,
  getSubByEndpoint,
  createSub,
  deleteSubByEndpoint
};

/* ---------- persistent save ---------- */
export async function saveDb() {
  if (USE_MYSQL) {
    // MySQL already persisted via individual writes; nothing extra needed
    return;
  }
  const data = {
    users: [...users],
    creds: [...creds],
    subs: [...subs],
    invites: [...invites],
    gyms: [...gyms],
    platformInvites: [...platformInvites]
  };
  writeJson(data);
}

/* ---------- schema init (MySQL only, fails silently) ---------- */
export async function initDb() {
  if (!USE_MYSQL) return;
  try {
    await queryMysql(`CREATE TABLE IF NOT EXISTS users (
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

    await queryMysql(`CREATE TABLE IF NOT EXISTS credentials (
      id VARCHAR(255) PRIMARY KEY,
      userId VARCHAR(50),
      publicKey LONGTEXT,
      counter INT,
      transports JSON,
      created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    )`);

    await queryMysql(`CREATE TABLE IF NOT EXISTS subscriptions (
      id VARCHAR(100) PRIMARY KEY,
      userId VARCHAR(50),
      endpoint TEXT,
      auth VARCHAR(255),
      p256dh VARCHAR(255),
      created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    )`);

    await queryMysql(`CREATE TABLE IF NOT EXISTS invites (
      code VARCHAR(50) PRIMARY KEY,
      createdBy VARCHAR(50),
      usedBy VARCHAR(50),
      usedAt TIMESTAMP,
      revoked BOOLEAN DEFAULT FALSE,
      created TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    await queryMysql(`CREATE TABLE IF NOT EXISTS gyms (
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

    await queryMysql(`CREATE TABLE IF NOT EXISTS platform_invites (
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
  } catch (e) {
    console.warn('MySQL initDb failed, using JSON storage:', e.message);
  }
}

/* ---------- user operations ---------- */
export async function getUserById(id) {
  if (USE_MYSQL) {
    try {
      const [rows] = await queryMysql('SELECT * FROM users WHERE id = ?', [id]);
      return rows[0] || null;
    } catch { return users.find(u => u.id === id) || null; }
  }
  return users.find(u => u.id === id) || null;
}

export async function getUserByEmail(email) {
  const lower = (email || '').toLowerCase();
  if (USE_MYSQL) {
    try {
      const [rows] = await queryMysql('SELECT * FROM users WHERE emailLower = ?', [lower]);
      return rows[0] || null;
    } catch { return users.find(u => u.emailLower === lower) || null; }
  }
  return users.find(u => u.emailLower === lower) || null;
}

export async function getUserByUsername(username) {
  const lower = (username || '').toLowerCase();
  if (USE_MYSQL) {
    try {
      const [rows] = await queryMysql('SELECT * FROM users WHERE usernameLower = ?', [lower]);
      return rows[0] || null;
    } catch { return users.find(u => u.usernameLower === lower) || null; }
  }
  return users.find(u => u.usernameLower === lower) || null;
}

export async function getAllUsers() {
  if (USE_MYSQL) {
    try {
      const [rows] = await queryMysql('SELECT * FROM users');
      return rows;
    } catch { return [...users]; }
  }
  return [...users];
}

export async function createUser(user) {
  user.usernameLower = (user.username || '').toLowerCase();
  user.emailLower = (user.email || '').toLowerCase();
  if (USE_MYSQL) {
    try {
      await queryMysql(
        `INSERT INTO users (id, name, username, email, usernameLower, emailLower, passwordSalt, passwordHash, gymId, admin, disabled, created, invitedBy, sv)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          user.id, user.name, user.username || null, user.email,
          user.usernameLower, user.emailLower,
          user.passwordSalt || null, user.passwordHash || null,
          user.gymId || null, user.admin ? 1 : 0, user.disabled ? 1 : 0,
          user.created || new Date().toISOString(),
          user.invitedBy || null, user.sv || 0
        ]
      );
      users.push(user);
      return user;
    } catch (e) {
      console.warn('MySQL createUser failed, using JSON:', e.message);
    }
  }
  // JSON fallback
  users.push(user);
  await saveDb();
  return user;
}

export async function updateUser(user) {
  if (USE_MYSQL) {
    try {
      await queryMysql(
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
      const idx = users.findIndex(u => u.id === user.id);
      if (idx >= 0) users[idx] = user;
      return;
    } catch (e) {
      console.warn('MySQL updateUser failed, using JSON:', e.message);
    }
  }
  // JSON fallback
  const idx = users.findIndex(u => u.id === user.id);
  if (idx >= 0) users[idx] = user;
  await saveDb();
}

export async function addUserAdmin(id) {
  const user = users.find(u => u.id === id);
  if (user) await updateUser({ ...user, admin: true });
}

/* ---------- credential operations ---------- */
export async function getCredById(id) {
  if (USE_MYSQL) {
    try {
      const [rows] = await queryMysql('SELECT * FROM credentials WHERE id = ?', [id]);
      return rows[0] || null;
    } catch { return creds.find(c => c.id === id) || null; }
  }
  return creds.find(c => c.id === id) || null;
}

export async function createCred(cred) {
  if (USE_MYSQL) {
    try {
      await queryMysql(
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
      return;
    } catch (e) {
      console.warn('MySQL createCred failed, using JSON:', e.message);
    }
  }
  creds.push(cred);
  await saveDb();
}

export async function updateCredCounter(id, counter) {
  if (USE_MYSQL) {
    try {
      await queryMysql('UPDATE credentials SET counter = ? WHERE id = ?', [counter, id]);
      const idx = creds.findIndex(c => c.id === id);
      if (idx >= 0) creds[idx].counter = counter;
      return;
    } catch (e) {
      console.warn('MySQL updateCredCounter failed, using JSON:', e.message);
    }
  }
  const idx = creds.findIndex(c => c.id === id);
  if (idx >= 0) creds[idx].counter = counter;
  await saveDb();
}

/* ---------- invite operations ---------- */
export async function getInviteByCode(code) {
  const upper = (code || '').toUpperCase();
  if (USE_MYSQL) {
    try {
      const [rows] = await queryMysql('SELECT * FROM invites WHERE code = ?', [upper]);
      return rows[0] || null;
    } catch { return invites.find(i => i.code === upper) || null; }
  }
  return invites.find(i => i.code === upper) || null;
}

export async function useInvite(code, userId) {
  const upper = (code || '').toUpperCase();
  if (USE_MYSQL) {
    try {
      await queryMysql('UPDATE invites SET usedBy = ?, usedAt = NOW() WHERE code = ?', [userId, upper]);
      const idx = invites.findIndex(i => i.code === upper);
      if (idx >= 0) invites[idx].usedBy = userId;
      return;
    } catch (e) {
      console.warn('MySQL useInvite failed, using JSON:', e.message);
    }
  }
  const idx = invites.findIndex(i => i.code === upper);
  if (idx >= 0) invites[idx].usedBy = userId;
  await saveDb();
}

/* ---------- platform invite operations ---------- */
export async function getPlatformInviteByToken(token) {
  if (USE_MYSQL) {
    try {
      const [rows] = await queryMysql('SELECT * FROM platform_invites WHERE token = ?', [token]);
      return rows[0] || null;
    } catch { return platformInvites.find(i => i.token === token) || null; }
  }
  return platformInvites.find(i => i.token === token) || null;
}

export async function createPlatformInvite(invite) {
  if (USE_MYSQL) {
    try {
      await queryMysql(
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
      return;
    } catch (e) {
      console.warn('MySQL createPlatformInvite failed, using JSON:', e.message);
    }
  }
  platformInvites.push(invite);
  await saveDb();
}

export async function usePlatformInvite(token, userId) {
  if (USE_MYSQL) {
    try {
      await queryMysql('UPDATE platform_invites SET usedBy = ?, usedAt = NOW() WHERE token = ?', [userId, token]);
      const idx = platformInvites.findIndex(i => i.token === token);
      if (idx >= 0) platformInvites[idx].usedBy = userId;
      return;
    } catch (e) {
      console.warn('MySQL usePlatformInvite failed, using JSON:', e.message);
    }
  }
  const idx = platformInvites.findIndex(i => i.token === token);
  if (idx >= 0) platformInvites[idx].usedBy = userId;
  await saveDb();
}

/* ---------- gym operations ---------- */
export async function getGymById(id) {
  if (USE_MYSQL) {
    try {
      const [rows] = await queryMysql('SELECT * FROM gyms WHERE id = ?', [id]);
      return rows[0] || null;
    } catch { return gyms.find(g => g.id === id) || null; }
  }
  return gyms.find(g => g.id === id) || null;
}

export async function getAllGyms() {
  if (USE_MYSQL) {
    try {
      const [rows] = await queryMysql('SELECT * FROM gyms');
      return rows;
    } catch { return [...gyms]; }
  }
  return [...gyms];
}

export async function createGym(gym) {
  if (USE_MYSQL) {
    try {
      await queryMysql(
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
      return;
    } catch (e) {
      console.warn('MySQL createGym failed, using JSON:', e.message);
    }
  }
  gyms.push(gym);
  await saveDb();
}

export async function updateGym(id, updates) {
  if (USE_MYSQL) {
    try {
      const fields = Object.keys(updates);
      if (fields.length > 0) {
        const setClause = fields.map(f => `${f} = ?`).join(', ');
        await queryMysql(`UPDATE gyms SET ${setClause} WHERE id = ?`, [...fields.map(f => updates[f]), id]);
      }
      const idx = gyms.findIndex(g => g.id === id);
      if (idx >= 0) Object.assign(gyms[idx], updates);
      return;
    } catch (e) {
      console.warn('MySQL updateGym failed, using JSON:', e.message);
    }
  }
  const idx = gyms.findIndex(g => g.id === id);
  if (idx >= 0) Object.assign(gyms[idx], updates);
  await saveDb();
}

/* ---------- subscription operations ---------- */
export async function getSubByEndpoint(endpoint) {
  if (USE_MYSQL) {
    try {
      const [rows] = await queryMysql('SELECT * FROM subscriptions WHERE endpoint = ?', [endpoint]);
      return rows[0] || null;
    } catch { return subs.find(s => s.endpoint === endpoint) || null; }
  }
  return subs.find(s => s.endpoint === endpoint) || null;
}

export async function createSub(sub) {
  sub.id = sub.id || crypto.randomBytes(12).toString('base64url');
  if (USE_MYSQL) {
    try {
      await queryMysql(
        `INSERT INTO subscriptions (id, userId, endpoint, auth, p256dh, created)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          sub.id, sub.userId, sub.endpoint, sub.auth, sub.p256dh,
          sub.created || new Date().toISOString()
        ]
      );
      subs.push(sub);
      return;
    } catch (e) {
      console.warn('MySQL createSub failed, using JSON:', e.message);
    }
  }
  subs.push(sub);
  await saveDb();
}

export async function deleteSubByEndpoint(endpoint) {
  if (USE_MYSQL) {
    try {
      await queryMysql('DELETE FROM subscriptions WHERE endpoint = ?', [endpoint]);
      subs = subs.filter(s => s.endpoint !== endpoint);
      return;
    } catch (e) {
      console.warn('MySQL deleteSubByEndpoint failed, using JSON:', e.message);
    }
  }
  subs = subs.filter(s => s.endpoint !== endpoint);
  await saveDb();
}

/* ---------- migration from db.json ---------- */
export async function migrateFromDbJson(dbJson) {
  if (!dbJson || !dbJson.users || !dbJson.users.length) return;
  if (!USE_MYSQL) return;
  try {
    for (const user of dbJson.users) {
      const created = user.created ? new Date(user.created) : new Date();
      await queryMysql(
        `INSERT IGNORE INTO users (id, name, username, email, usernameLower, emailLower, passwordSalt, passwordHash, gymId, admin, superadmin, disabled, created, invitedBy, sv, lastReminder)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          user.id, user.name, user.username, user.email,
          user.usernameLower, user.emailLower,
          user.passwordSalt, user.passwordHash,
          user.gymId, user.admin ? 1 : 0, user.superadmin ? 1 : 0, user.disabled ? 1 : 0,
          created, user.invitedBy, user.sv || 0, user.lastReminder || null
        ]
      );
    }
    for (const cred of (dbJson.creds || [])) {
      await queryMysql(
        `INSERT IGNORE INTO credentials (id, userId, publicKey, counter, transports, created)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [cred.id, cred.userId, cred.publicKey, cred.counter || 0, JSON.stringify(cred.transports || []), cred.created || new Date().toISOString()]
      );
    }
    for (const sub of (dbJson.subs || [])) {
      await queryMysql(
        `INSERT IGNORE INTO subscriptions (id, userId, endpoint, auth, p256dh, created)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [sub.id || crypto.randomBytes(12).toString('base64url'), sub.userId, sub.endpoint, sub.auth, sub.p256dh, sub.created || new Date().toISOString()]
      );
    }
    for (const invite of (dbJson.invites || [])) {
      await queryMysql(
        `INSERT IGNORE INTO invites (code, createdBy, usedBy, usedAt, revoked, created)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [invite.code, invite.createdBy, invite.usedBy, invite.usedAt || null, invite.revoked ? 1 : 0, invite.created || new Date().toISOString()]
      );
    }
    for (const gym of (dbJson.gyms || [])) {
      await queryMysql(
        `INSERT IGNORE INTO gyms (id, name, slug, status, plan, seats, ownerId, note, licenseExpiresAt, created)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [gym.id, gym.name, gym.slug, gym.status, gym.plan, gym.seats, gym.ownerId, gym.note, gym.licenseExpiresAt || null, gym.created || new Date().toISOString()]
      );
    }
    for (const invite of (dbJson.platformInvites || [])) {
      await queryMysql(
        `INSERT IGNORE INTO platform_invites (token, gymId, email, role, name, usedBy, usedAt, expiresAt, created)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [invite.token, invite.gymId, invite.email, invite.role, invite.name, invite.usedBy, invite.usedAt || null, invite.expiresAt || null, invite.created || new Date().toISOString()]
      );
    }
    console.log('MySQL migration completed');
  } catch (e) {
    console.warn('MySQL migration failed:', e.message);
  }
}
