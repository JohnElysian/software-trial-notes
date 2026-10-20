# Meeting flow feasibility proof

**Synthetic orchestration only. Every meeting, calendar, invitation and CRM adapter is fake. No service, vendor SDK, n8n instance, account, email recipient or network endpoint is contacted.** This is a small buyer-specific pre-sales sample, not a completed MirrorFly integration or an accepted paid deliverable.

## Run

Node.js 22+; no npm install or external dependencies needed. Tested on Windows, Node 24.20.0.

```sh
npm test
npm run demo
```

`demo-result.json` contains the actual reproducible output on the included synthetic records. `validation.tap` contains the final automated test output. No private customer records are needed.

## What the proof does

1. Accept a versioned schedule request with stable request/event IDs.
2. Ask an injected meeting adapter for a shortcode; retain that code without inventing a hosted joining URL.
3. Pass that code to injected calendar, invitation and CRM adapters.
4. Checkpoint each step, so an explicit recovery resumes the incomplete step.
5. Retry recognised temporary/429 failures at most three times per explicit run, with bounded waits and per-attempt timeouts. Long Retry-After values pause until the requested time rather than retrying early.
6. Reject conflicting event-ID reuse, out-of-order updates and overlapping unresolved changes. Duplicate completed events do not make new calls. Duplicate paused events do not reset the retry budget.
7. Invalidate the previous reminder as soon as a reschedule/cancel event is accepted; emit only the current version's due reminder.
8. Write structured logs using hashed correlation IDs, safe operation names and allowlisted error codes. Raw adapter errors, tokens, titles, email addresses and shortcode content are not logged.

The modelled schedule → reschedule → cancel sequence retains one fake meeting, one calendar record and one CRM record. Each intentional new version has its own invitation/update effect. Replayed events add none.

## What actually passed

Fifteen tests assert the fake services' resulting records and effect/call counters, including simultaneous duplicate events, 429 timing, lost acknowledgement after a meeting was committed, retry exhaustion, duplicate retry-budget preservation, explicit recovery, long Retry-After deferral, permanent-error redaction, reminder invalidation, exactly one due reminder, blocked overlapping updates, conflicting events, persisted restart recovery, hung-adapter timeout, malformed inputs, invalid adapter response rejection and explicit paused-reminder recovery.

In the recorded demo, the meeting adapter first returns a synthetic 429 and later succeeds. CRM fails three times; calendar and invitation have already completed. A duplicate trigger adds zero calls. Explicit recovery completes CRM while meeting/calendar/invitation remain single effects. Reschedule/cancel update the same records and suppress the reminder. Simulated waits are 750, 100 and 200 ms; these are fake-clock waits, not measured vendor latency.

## Adapter contract and limits

See `adapter-contract.txt`. The fake services honour stable idempotency keys and preserve their service ledger independently of the orchestration instance. **Exactly-once external effects require equivalent real-provider idempotency or a reliable lookup/reconciliation mechanism.** An orchestrator alone cannot create that guarantee, especially after a lost acknowledgement or timeout. Aborting a request does not prove the remote action was cancelled.

`MemoryStore` is for demonstrations. `JsonFileStore` supplies local atomic checkpoints for the restart test; it assumes one runner/process. It is not a multi-worker n8n database, distributed lock or production secret store. A real deployment needs transactional shared storage, unique keys/locking, authenticated webhook validation, access controls, retention rules and durable scheduling. Persisted operational state can contain request data; only synthetic data is supplied here. Do not use this sample store for live customer material.

Reminder failures pause rather than looping forever. After repair, an explicit `sendDueReminders({resumeFailed:true})` grants a new bounded budget while retaining the same key and respecting Retry-After. Routine duplicate timer ticks do not reset it. A production implementation still needs authenticated repair controls and durable scheduling. Failed scheduling does not roll back already sent invitations or created calendar records: the state makes the partial result recoverable instead. Vendor-specific compensation requires separate capability verification.

## Commercial boundary

This sample supports a **proposed £100 feasibility milestone credited within an £800 base**. If the buyer accepts the later base, that means £100 feasibility plus £700 remaining base work, not £900. The buyer must approve scope, acceptance and payment before the paid phase begins. No approval or money due exists now.

The paid feasibility phase would deliver a capability matrix plus either one tested path in the buyer's existing licensed sandbox/host application or a reproducible documented blocker. The sample has not done that live work. MirrorFly plan entitlement, SDK/host capabilities, real joining UI/URLs, authentic calendar/invitation permissions, CRM scope, deployment and post-meeting event availability remain buyer-sandbox questions. The fake CRM leg is illustrative; live CRM/advanced scope is not silently included in the proposed base.

Official MirrorFly evidence is limited to the documented client SDK paths: [create meet link](https://www.mirrorfly.com/docs/meet/angular/quick-start/#create-meet-link), [schedule messaging](https://www.mirrorfly.com/docs/meet/angular/schedule-a-meet/) and [joining/ending calls](https://www.mirrorfly.com/docs/meet/angular/joining-a-meet/). These do not verify a server REST creation endpoint, hosted joining page or server end-of-meeting webhook. No such endpoint is invented here.

Created by Codex on the owner's behalf. No previous MirrorFly client deployment, personal human implementation/review, accepted contract or customer outcome is claimed. Spend £0; fees earned or due £0.
