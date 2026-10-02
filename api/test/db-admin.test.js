import test from 'node:test';
import assert from 'node:assert/strict';

const { db, pool } = await import('../db.js');

test('getUserById queries the MySQL user row', async () => {
  const originalQuery = pool.query;
  let query, params;
  pool.query = async (...args) => {
    [query, params] = args;
    return [[{ id: 'user-1', name: 'One' }]];
  };
  try {
    assert.deepEqual(await db.getUserById('user-1'), { id: 'user-1', name: 'One' });
    assert.equal(query, 'SELECT * FROM users WHERE id = ?');
    assert.deepEqual(params, ['user-1']);
  } finally {
    pool.query = originalQuery;
  }
});

test('admin user metadata is persisted by updateUser', async () => {
  const originalQuery = pool.query;
  let query, params;
  pool.query = async (...args) => {
    [query, params] = args;
    return [{ affectedRows: 1 }];
  };
  try {
    await db.updateUser({
      id: 'user-1',
      name: 'One',
      email: 'one@example.test',
      memberStatus: 'paused',
      assignedCoach: 'Marta',
      memberNote: 'Shoulder recovery'
    });
    assert.match(query, /memberStatus = \?, assignedCoach = \?, memberNote = \? WHERE id = \?$/);
    assert.deepEqual(params.slice(-4), ['paused', 'Marta', 'Shoulder recovery', 'user-1']);
  } finally {
    pool.query = originalQuery;
  }
});

test('JSON-to-MySQL migration preserves admin client metadata', async () => {
  const originalQuery = pool.query;
  let query, params;
  pool.query = async (...args) => {
    [query, params] = args;
    return [{ affectedRows: 1 }];
  };
  try {
    await db.migrateFromDbJson({
      users: [{
        id: 'user-1', name: 'One', username: 'one', email: 'one@example.test',
        memberStatus: 'paused', assignedCoach: 'Marta', memberNote: 'Shoulder recovery'
      }]
    });
    assert.match(query, /lastReminder, memberStatus, assignedCoach, memberNote\)/);
    assert.deepEqual(params.slice(-3), ['paused', 'Marta', 'Shoulder recovery']);
  } finally {
    pool.query = originalQuery;
  }
});

test('a failed or concurrent cache load can be retried without exposing an empty cache', async () => {
  const originalQuery = pool.query;
  let calls = 0;
  let failed = false;
  pool.query = async query => {
    calls++;
    if (query === 'SELECT * FROM users' && !failed) {
      failed = true;
      await Promise.resolve();
      throw new Error('temporary database error');
    }
    return [query === 'SELECT * FROM users' ? [{ id: 'user-1', name: 'One' }] : []];
  };
  try {
    const firstLoad = db.loadCache();
    const concurrentLoad = db.loadCache();
    const results = await Promise.allSettled([firstLoad, concurrentLoad]);
    assert.equal(results[0].status, 'rejected');
    assert.equal(results[1].status, 'rejected');
    assert.equal(calls, 6);

    await db.loadCache();
    assert.equal(calls, 12);
    assert.equal(requireUserFromSyncCache(), 'One');
  } finally {
    pool.query = originalQuery;
  }
});

function requireUserFromSyncCache() {
  return db.users.find(user => user.id === 'user-1')?.name;
}
