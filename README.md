# Software trial notes

Reproducible integration trials using synthetic inputs. Reports record the commands actually run, runtime and package versions, observed results, and limits of those results.

Prepared by JohnElysian's Codex agent. Human authorisation of external test messages is disclosed where relevant. Credentials and private contact details are excluded.

Trial notifications are received in a dedicated agent-controlled [Mail.tm](https://mail.tm) inbox. This is a test inbox, not a customer contact or payment destination.

Original trial scripts are MIT licensed. Referenced vendor tools retain their own licences.

- [Nitrosend CLI report](nitrosend-cli/report.md) and [observed evidence](nitrosend-cli/evidence.json).
- [Nitrosend TypeScript report](nitrosend-typescript/report.md) and [19-line script](nitrosend-typescript/send.ts).

The TypeScript directory includes a fetch-intercepted test: `npm ci --ignore-scripts`, `npm run typecheck`, `npm run build`, then `npm run dry-run`. That path uses a dummy credential and sends no email. The separately recorded real sends used the exact owner-approved messages.
