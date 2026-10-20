LOCAL MAP PUBLICATION-GATE DEVELOPER LAB

This is original local developer integration work, not a production MAP service or authenticated email interaction. It authors a publication proposal for the included original software-trial note, freezes that exact JSON-wrapped UTF-8 Markdown artifact, and starts an actual localhost-only HTTPS service on an ephemeral port. The installed local client pins the freshly generated self-signed certificate. No certificate enters the machine's trust store, and no credential or private key is delivered or published.

The description's localhost origin was real and active during the recorded CLI run. It is a local authority identifier, not a public deployment. The service closes at the end of the run. The review and restricted publication routes are local JSON APIs, not a claimed browser UI or internet publication. The recipient local-reviewer@localhost is a synthetic development-mailbox identifier; no mail was delivered to it.

The default MAP entry point always rejects inputs without a trusted mailbox verifier, before doing a service read. No real DKIM, email-delivery or mailbox-control adapter is supplied. Positive unit tests explicitly inject synthetic trusted-message evidence. These tests establish local gate behaviour only; they do not establish the normative email-authentication and recipient-control requirements of Core. Parsing a description is separate from making it actionable.

Native local service controls
- A random session credential, held in memory, is required for every read or decision. HTTPS requests are made only to installed constant paths at the local origin; MAP data cannot select endpoints.
- The bundled Publication Approval contract is parsed with mailschema0.3.2 and pinned to its official digest.
- terms.version is the mailschema RFC8785 digest of the complete description with that version member omitted. It binds subject, recipient, tenant, contract, artifact, audience, destination, schedule and expiry.
- Authoritative content readback returns the original frozen JSON artifact; digest() covers exactly {mediaType,body}. This is a documented JSON representation, not the SHA256 of only Markdown bytes.
- The decision compares exact terms, authenticated principal/recipient, expiry and pending state synchronously. The check and terminal-state commit contain no await. At most one terminal decision wins.
- Decline never publishes. Request-changes records untrusted feedback and terminates the proposal without editing or generating anything. Approve in synthetic tests makes a clone available only in local service memory to its restricted session; no external publication occurs.
- All state is in memory and disappears on close. There is no multi-process coordination, durable audit log, email transport or production security certification.

Reproduce locally with PowerShell7 and Node22+
Copy this package into a writable empty directory first, then run these commands from that directory. npm ci installs the exact lockfile dependencies there; no original workspace node_modules junction or historical timing file is required.
1. npm ci --ignore-scripts --no-audit --no-fund
2. pwsh -NoProfile -File ./Generate-LocalTls.ps1
3. node --test gate.test.mjs
4. node trial.mjs

The trial creates a NEW proposal each time and writes it into a new reruns/trial-* directory beside trial.mjs. It leaves the original description.json, report.md, validation-evidence.json and description-digest.txt unchanged. New rerun evidence measures only the current script invocation, starting before local service setup and ending at its first valid CLI result. It excludes npm installation and certificate generation. A rerun has fresh identifiers, times, localhost port and digest; it does not reproduce the original timing or replace the frozen original artifact.

The original evidence was generated once at2026-10-20T13:10:27Z, not retrospectively reconstructed. No new install happened in that original run: the existing0.3.2 dependencies were reused. The earlier07:18 install/2.82-minute inert-fixture exploration is preserved separately in validation-evidence.json; it is not presented as this prototype's timing. Preserve the original description and its recorded digest together. Generated localhost-key.pem is private local test material: do not publish it or a reruns directory containing local test artefacts without reviewing them.

CLI sequence actually run
node ./node_modules/mailschema/bin/mailschema.js description description.json --contract publication-contract.json
node ./node_modules/mailschema/bin/mailschema.js description description.broken.json --contract publication-contract.json
node ./node_modules/mailschema/bin/mailschema.js description description.json --contract publication-contract.json

The broken file changes only details.content.digest to sha-256:invalid. The restored file is byte-identical to the original valid file. digest(parseDescription(bytes)) independently agrees with the CLI digest. Test logs cover ten distinct local behaviours: default no-email trust denial, untrusted/wrong-recipient denial, changed terms, wrong description recipient, stale native version, immutable content readback, decline and duplicate refusal, racing terminal decisions, feedback-only request-changes and decision-time expiry.

Public references checked
https://mailschema.org/registry/map-0.3.json
https://mailschema.org/artifacts/map-0.3/contracts/publication-approval-0.1.json
https://mailschema.org/specification/core
https://unpkg.com/mailschema@0.3.2/README.md

No package defect was found. Two initial local tests exposed our own mistake of passing null to a no-input operation; the library correctly requires omitted/undefined input. That prototype bug was fixed before the final ten-test pass. It is not reported as a mailschema defect.
