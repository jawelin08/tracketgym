import crypto from 'node:crypto';
import fs from 'node:fs';

export function atomicWrite(file, content) {
  const tmp = file + '.' + process.pid + '.' + crypto.randomBytes(6).toString('hex') + '.tmp';
  fs.writeFileSync(tmp, content, { mode: 0o600 });
  fs.renameSync(tmp, file);
}
