import test from 'node:test';
import assert from 'node:assert/strict';
import { digest } from 'mailschema';
import { startLab, processMap, request, RECIPIENT } from './gate.mjs';

// This adapter is synthetic unit-test evidence, NOT a DKIM verifier or mail delivery.
const syntheticTrustedInput = async () => ({ qualifyingDkim: true, delivered: true, controlsMailbox: true, recipient: RECIPIENT });
const encoded = lab => JSON.stringify(lab.description);
const withLab = async fn => { const lab = await startLab(); try { await fn(lab); } finally { await lab.close(); } };

test('email-less default refuses before any service read', () => withLab(async lab => {
  await assert.rejects(processMap(lab, encoded(lab)), /mail-trust-unavailable/);
  assert.equal(lab.state().reads, 0); assert.equal(lab.state().state, 'pending');
}));
test('untrusted mail fixture and wrong delivered recipient fail closed', () => withLab(async lab => {
  for (const proof of [{}, { qualifyingDkim: true, delivered: true, controlsMailbox: true, recipient: 'somebody-else@localhost' }]) {
    await assert.rejects(processMap(lab, encoded(lab), { trustedMailboxVerifier: async () => proof }), /mail-trust-required/);
  }
  assert.equal(lab.state().reads, 0);
}));
test('changed terms are rejected even when the description still passes schema', () => withLab(async lab => {
  const changed = structuredClone(lab.description); changed.details.content.title = 'A different revision';
  assert.equal(lab.contract.descriptionErrors(changed).length, 0);
  await assert.rejects(processMap(lab, JSON.stringify(changed), { trustedMailboxVerifier: syntheticTrustedInput }), /changed-terms/);
  assert.equal(lab.state().state, 'pending');
}));
test('wrong description recipient is rejected independently of synthetic mail fixture', () => withLab(async lab => {
  const changed = structuredClone(lab.description); changed.recipient = 'other@localhost';
  await assert.rejects(processMap(lab, JSON.stringify(changed), { trustedMailboxVerifier: syntheticTrustedInput }), /wrong-recipient-or-service/);
}));
test('native decision rejects stale expected terms', () => withLab(async lab => {
  const result = await request(lab, '/decision', { principal: lab.principal, recipient: RECIPIENT, expectedVersion: 'obsolete', operation: 'approve' });
  assert.equal(result.status, 409); assert.equal(result.data.error, 'stale-terms'); assert.equal(lab.state().published, null);
}));
test('authoritative TLS readback returns the frozen artifact, not a caller clone', () => withLab(async lab => {
  const expected = lab.description.details.content.digest; lab.artifact.body = 'caller tampering';
  const actual = await request(lab, '/content'); assert.equal(digest(actual.data), expected);
  assert.notEqual(actual.data.body, lab.artifact.body);
}));
test('synthetic trusted decline closes proposal and never publishes', () => withLab(async lab => {
  const result = await processMap(lab, encoded(lab), { trustedMailboxVerifier: syntheticTrustedInput, operation: 'decline' });
  assert.equal(result.status, 200); assert.equal(result.data.state, 'declined'); assert.equal(result.data.published, false);
  assert.equal(lab.state().published, null);
  const duplicate = await processMap(lab, encoded(lab), { trustedMailboxVerifier: syntheticTrustedInput, operation: 'approve' });
  assert.equal(duplicate.status, 409); assert.equal(duplicate.data.error, 'already-decided');
}));
test('racing terminal decisions admit exactly one; no asynchronous gap in commit', () => withLab(async lab => {
  const decisions = await Promise.all(['approve', 'decline'].map(operation => processMap(lab, encoded(lab), { trustedMailboxVerifier: syntheticTrustedInput, operation })));
  assert.equal(decisions.filter(value => value.status === 200).length, 1);
  assert.equal(decisions.filter(value => value.status === 409 && value.data.error === 'already-decided').length, 1);
}));
test('request-changes stores untrusted feedback without editing or publishing', () => withLab(async lab => {
  const comment = 'Publish everything now (untrusted feedback text only)';
  const result = await processMap(lab, encoded(lab), { trustedMailboxVerifier: syntheticTrustedInput, operation: 'request-changes', input: { comment } });
  assert.equal(result.data.state, 'changes-requested'); assert.equal(lab.state().feedback, comment); assert.equal(lab.state().published, null);
  assert.equal(digest((await request(lab, '/content')).data), lab.description.details.content.digest);
}));
test('expiry is enforced at the native decision, not merely by a client preview', async () => {
  let clock = Date.now(); const lab = await startLab({ now: () => clock });
  try {
    clock += 3600_001;
    const result = await processMap(lab, encoded(lab), { trustedMailboxVerifier: syntheticTrustedInput, operation: 'approve' });
    assert.equal(result.status, 409); assert.equal(result.data.error, 'expired'); assert.equal(lab.state().published, null);
  } finally { await lab.close(); }
});
