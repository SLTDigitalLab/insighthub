const fs = require('fs');
// Reads and appends the registry file, and creates the lock file
const path = require('path');
// Builds the registry path
const crypto = require('crypto');
// Cryptographically secure random numbers (crypto.randomInt)

const REGISTRY = process.env.PROPOSAL_REFS_FILE || path.join(__dirname, '..', 'data', 'proposal_refs.jsonl');
// One line per issued reference: {"ref","prefix","issuedAt"} — no names, emails or other personal data (git-ignored runtime data)
const LOCK = `${REGISTRY}.lock`;
// Exists only while one process is issuing a reference, so two backends can never issue at the same moment
const LOCK_STALE_MS = 10000;
// A lock older than this was left by a crashed process and is removed
const LOCK_WAIT_MS = 15000;
// How long a request waits for the lock before giving up

const PREFIXES = { 'Enterprise Large': 'EL', 'Enterprise Medium': 'EM', Government: 'G', 'Carrier business': 'CB', REBM: 'REBM' };
// The 5 Section values of the Request Access / Pre-Authorize forms -> reference prefix
const NEUTRAL_PREFIX = 'SLT';
// Used when the account has no Section and no usable department (never a made-up section)
const MIN = 10000000;
const MAX = 100000000;
// 8-digit number part: 10000000 … 99999999

function prefixFor(account = {}) {
  const section = String(account.section || '').trim();
  if (PREFIXES[section]) return { prefix: PREFIXES[section], fromSection: true };
  // 1. The account's Section
  const department = String(account.department || '').trim();
  if (PREFIXES[department]) return { prefix: PREFIXES[department], fromSection: true };
  if (/^REBM\b/i.test(department)) return { prefix: 'REBM', fromSection: true };
  // 2. Its department, which is built from the Section ("Enterprise Large", or "REBM - WPC1" -> REBM)
  return { prefix: NEUTRAL_PREFIX, fromSection: false };
  // 3. Neither: the neutral prefix
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  // Short synchronous pause while another process holds the lock
}

function withLock(fn) {
  fs.mkdirSync(path.dirname(REGISTRY), { recursive: true });
  const until = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    let fd;
    try {
      fd = fs.openSync(LOCK, 'wx');
      // 'wx' = create only if it doesn't exist: exactly one process can hold the lock
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      try {
        if (Date.now() - fs.statSync(LOCK).mtimeMs > LOCK_STALE_MS) fs.unlinkSync(LOCK);
        // Left behind by a crashed process
      } catch { /* the other process just released it */ }
      if (Date.now() > until) throw Object.assign(new Error('Could not issue a proposal reference number (registry busy). Please try again.'), { status: 503 });
      sleep(15);
      continue;
    }
    try {
      return fn();
    } finally {
      fs.closeSync(fd);
      fs.unlinkSync(LOCK);
      // Always released, even if writing failed
    }
  }
}

function issuedNumbers() {
  if (!fs.existsSync(REGISTRY)) return new Set();
  const numbers = new Set();
  for (const line of fs.readFileSync(REGISTRY, 'utf8').split('\n')) {
    const m = line.match(/"ref":"[A-Z]+-(\d+)"/);
    if (m) numbers.add(m[1]);
  }
  return numbers;
  // Every number ever issued, whatever its prefix (read inside the lock, so it includes other processes' entries)
}

function issueRef(prefix) {
  if (!Object.values(PREFIXES).includes(prefix) && prefix !== NEUTRAL_PREFIX) throw new Error(`Unknown reference prefix: ${prefix}`);
  return withLock(() => {
    const used = issuedNumbers();
    let number;
    do {
      number = String(crypto.randomInt(MIN, MAX));
    } while (used.has(number));
    // A number already issued (under any prefix) is never used again: draw another
    const ref = `${prefix}-${number}`;
    fs.appendFileSync(REGISTRY, `${JSON.stringify({ ref, prefix, issuedAt: new Date().toISOString() })}\n`);
    // Recorded before it is returned, so it can't be handed out twice
    return ref;
  });
}

module.exports = { prefixFor, issueRef, PREFIXES, NEUTRAL_PREFIX, REGISTRY };
// Used by routes/proposals.js (/generate)
