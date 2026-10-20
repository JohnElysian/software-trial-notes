import https from 'node:https';
import { readFile } from 'node:fs/promises';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { Contract, digest, parseDescription } from 'mailschema';

export const CONTRACT_DIGEST = 'sha-256:de91a49de4cba91209be253456e7c56709791fff877a060560d4eada0cc9468c';
export const RECIPIENT = 'local-reviewer@localhost';
export const clone = value => structuredClone(value);
export function termsDigest(description) {
  const value = clone(description);
  delete value.terms.version;
  return digest(value);
}
function fail(message) { throw new Error(message); }

// This is an in-memory developer service. No email authentication adapter exists.
// Its TLS certificate is pinned by the installed local client, never by MAP data.
export async function startLab({ now = () => Date.now() } = {}) {
  const contract = Contract.parse(await readFile(new URL('publication-contract.json', import.meta.url)));
  if (contract.digest !== CONTRACT_DIGEST) fail('untrusted-contract');
  const key = await readFile(new URL('localhost-key.pem', import.meta.url));
  const ca = await readFile(new URL('localhost-cert.pem', import.meta.url));
  const credential = randomBytes(32).toString('hex');
  const principal = `urn:uuid:${randomUUID()}`;
  const tenant = `urn:uuid:${randomUUID()}`;
  const artifact = {
    mediaType: 'text/markdown; charset=utf-8',
    body: '# Local publication gate trial\n\nThis authored developer note describes a local-only software trial. The prototype uses mailschema0.3.2 for contract and digest checking, freezes a content revision, and separates native service decisions from email trust. No authenticated email, public publication or production MAP conformance is claimed. The default MAP entry point must refuse mail whose trust has not been established.\n',
  };
  let description;
  let state = 'pending';
  let published = null;
  let feedback = null;
  let reads = 0;
  const server = https.createServer({ key, cert: ca }, async (req, res) => {
    const supplied = Buffer.from(req.headers.authorization ?? '');
    const required = Buffer.from(`Bearer ${credential}`);
    if (supplied.length !== required.length || !timingSafeEqual(supplied, required)) {
      res.writeHead(401).end(); return;
    }
    try {
      const url = new URL(req.url, 'https://localhost');
      if (req.method === 'GET' && ['/proposal', '/review'].includes(url.pathname)) {
        reads++; res.end(JSON.stringify({ description, state, principal })); return;
      }
      if (req.method === 'GET' && url.pathname === '/content') {
        reads++; res.end(JSON.stringify(artifact)); return;
      }
      if (req.method === 'GET' && url.pathname === '/published' && published) {
        res.end(JSON.stringify(published)); return;
      }
      if (req.method !== 'POST' || url.pathname !== '/decision') {
        res.writeHead(404).end(); return;
      }
      let data = '';
      for await (const chunk of req) { data += chunk; if (Buffer.byteLength(data) > 8192) fail('input-too-large'); }
      const input = JSON.parse(data);
      if (input.principal !== principal || input.recipient !== RECIPIENT) fail('not-authorized');
      if (input.expectedVersion !== description.terms.version) fail('stale-terms');
      if (now() >= Date.parse(description.expiresAt)) fail('expired');
      if (state !== 'pending') fail('already-decided');
      if (!['approve', 'decline', 'request-changes'].includes(input.operation)) fail('unknown-operation');
      const errors = contract.inputErrors(input.operation, input.input);
      if (errors.length) fail('invalid-operation-input');
      // No await may separate checking pending state and committing its terminal state.
      state = input.operation === 'approve' ? 'approved' : input.operation === 'decline' ? 'declined' : 'changes-requested';
      if (state === 'approved') published = clone(artifact); // local memory only
      if (state === 'changes-requested') feedback = input.input.comment;
      res.end(JSON.stringify({ state, published: published !== null }));
    } catch (error) { res.writeHead(409).end(JSON.stringify({ error: error.message })); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `https://localhost:${server.address().port}`;
  const issuedAt = new Date(now()).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const expiresAt = new Date(now() + 3600_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  description = {
    '@context': 'https://mailschema.org/contexts/map-0.3.jsonld', '@type': 'MailAction',
    '@id': `urn:uuid:${randomUUID()}`, profile: 'https://mailschema.org/profiles/map/0.3',
    type: { id: contract.value?.id ?? 'https://mailschema.org/types/publication-approval', version: '0.1', contractDigest: CONTRACT_DIGEST },
    issuedAt, expiresAt, inLanguage: 'en', service: { id: origin, tenant }, recipient: RECIPIENT,
    subject: { id: `urn:uuid:${randomUUID()}`, title: 'LOCAL LAB: publication gate trial note' },
    terms: { id: `urn:uuid:${randomUUID()}`, version: '' },
    details: {
      summary: 'Developer-only proposal to release this frozen trial note to the local restricted review space. No mail delivery or internet publication is proposed.',
      requester: 'JohnElysian Codex agent, local development session',
      content: { id: `${origin}/content`, revision: randomUUID(), digest: digest(artifact), title: 'Local publication gate trial' },
      destinations: [{ id: `${origin}/published`, account: principal, visibility: 'restricted', audience: { id: principal, revision: 'local-session-v1' } }],
      schedule: { mode: 'immediate' },
    }, operations: [{ id: 'approve' }, { id: 'decline' }, { id: 'request-changes' }],
    human: { url: `${origin}/review` },
  };
  description.terms.version = termsDigest(description);
  parseDescription(JSON.stringify(description));
  const errors = contract.descriptionErrors(description);
  if (errors.length) { server.close(); fail(JSON.stringify(errors)); }
  return {
    description: clone(description), artifact: clone(artifact), principal, origin, ca, credential, contract,
    state: () => ({ state, published: clone(published), feedback, reads }),
    close: () => new Promise(resolve => server.close(resolve)),
  };
}

export function request(lab, path, body) {
  // Paths are installed constants. A description cannot select an arbitrary URL.
  if (!['/proposal', '/content', '/decision'].includes(path)) fail('unmapped-path');
  return new Promise((resolve, reject) => {
    const req = https.request(`${lab.origin}${path}`, {
      family: 4, ca: lab.ca, method: body ? 'POST' : 'GET',
      headers: { authorization: `Bearer ${lab.credential}`, 'content-type': 'application/json' },
    }, res => { let data = ''; res.on('data', chunk => data += chunk); res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(data) })); });
    req.on('error', reject); req.end(body ? JSON.stringify(body) : undefined);
  });
}

export async function processMap(lab, bytes, { trustedMailboxVerifier, operation = 'decline', input } = {}) {
  // There is deliberately no default verifier. Test doubles do not prove DKIM.
  if (typeof trustedMailboxVerifier !== 'function') fail('mail-trust-unavailable');
  const evidence = await trustedMailboxVerifier(bytes);
  if (!evidence?.qualifyingDkim || !evidence?.delivered || !evidence?.controlsMailbox || evidence.recipient !== RECIPIENT) fail('mail-trust-required');
  const parsed = parseDescription(bytes);
  if (parsed.recipient !== RECIPIENT || parsed.service.id !== lab.origin || parsed.service.tenant !== lab.description.service.tenant) fail('wrong-recipient-or-service');
  if (parsed.type.contractDigest !== CONTRACT_DIGEST || lab.contract.descriptionErrors(parsed).length) fail('contract-mismatch');
  if (termsDigest(parsed) !== parsed.terms.version) fail('changed-terms');
  const readback = (await request(lab, '/proposal')).data;
  if (digest(parsed) !== digest(readback.description)) fail('stale-readback');
  const content = (await request(lab, '/content')).data;
  if (digest(content) !== parsed.details.content.digest) fail('content-mismatch');
  return request(lab, '/decision', { principal: lab.principal, recipient: RECIPIENT, expectedVersion: parsed.terms.version, operation, input });
}
