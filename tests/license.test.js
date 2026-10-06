import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyLicense, entitlement, bytesToB64url, TRIAL_JOBS } from '../app/src/domain/license.js';

async function makePair() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const pub = await crypto.subtle.exportKey('jwk', kp.publicKey);
  const sign = async (payload) => {
    const body = bytesToB64url(new TextEncoder().encode(JSON.stringify(payload)));
    const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, kp.privateKey, new TextEncoder().encode('TK1.' + body));
    return 'TK1.' + body + '.' + bytesToB64url(new Uint8Array(sig));
  };
  return { pub, sign };
}

test('a correctly signed key verifies', async () => {
  const { pub, sign } = await makePair();
  const key = await sign({ name: 'Ace Backflow', exp: '2027-10-06' });
  const res = await verifyLicense('  ' + key + '\n', '2026-10-06', pub);
  assert.equal(res.valid, true);
  assert.equal(res.payload.name, 'Ace Backflow');
});

test('expired, tampered, foreign and malformed keys are rejected', async () => {
  const { pub, sign } = await makePair();
  const other = await makePair();
  const key = await sign({ name: 'Ace', exp: '2026-01-01' });
  const expired = await verifyLicense(key, '2026-10-06', pub);
  assert.equal(expired.valid, false);
  assert.equal(expired.expired, true);

  const good = await sign({ name: 'Ace', exp: '2027-01-01' });
  const parts = good.split('.');
  const forgedBody = bytesToB64url(new TextEncoder().encode(JSON.stringify({ name: 'Ace', exp: '2099-01-01' })));
  assert.equal((await verifyLicense(`TK1.${forgedBody}.${parts[2]}`, '2026-10-06', pub)).valid, false);
  assert.equal((await verifyLicense(good, '2026-10-06', other.pub)).valid, false);
  for (const bad of ['', 'hello', 'TK1.a.b', 'TK2.' + parts[1] + '.' + parts[2], null]) {
    assert.equal((await verifyLicense(bad, '2026-10-06', pub)).valid, false);
  }
});

test('the shipped public key is present and rejects an unsigned key', async () => {
  const res = await verifyLicense('TK1.e30.AAAA', '2026-10-06');
  assert.equal(res.valid, false);
  assert.doesNotMatch(res.reason, /no licence key configured/);
});

test('entitlement: trial counts down, then blocks only new reports', () => {
  assert.deepEqual(entitlement({ license: null, jobsSaved: 0 }), { mode: 'trial', canCreate: true, left: TRIAL_JOBS });
  assert.equal(entitlement({ license: null, jobsSaved: TRIAL_JOBS - 1 }).left, 1);
  assert.equal(entitlement({ license: null, jobsSaved: TRIAL_JOBS }).canCreate, false);
  assert.equal(entitlement({ license: { valid: false, expired: true }, jobsSaved: 99 }).mode, 'expired');
  const lic = entitlement({ license: { valid: true, payload: { exp: '2027-01-01', name: 'Ace' } }, jobsSaved: 999 });
  assert.equal(lic.canCreate, true);
  assert.equal(lic.until, '2027-01-01');
});
