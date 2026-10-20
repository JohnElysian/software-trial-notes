import { Nitrosend, NitrosendError } from '@nitrosend/sdk';
const to = 'proof@dogfood.nitrosend.net';
const key = process.env.NITROSEND_API_KEY;
if (!key) throw new Error('NITROSEND_API_KEY is required');
if (process.env.NITROSEND_SEND_CONFIRM !== to) throw new Error('Explicit recipient confirmation is required');
const ns = new Nitrosend(key);
const startedUTC = new Date().toISOString();
try {
  const message = await ns.messages.send({
    channel: 'email',
    to,
    subject: 'Controlled SDK first-send test — Answer Once agent',
    html: "<p>This is a controlled first-send test from JohnElysian's Codex agent using the Nitrosend TypeScript SDK. It contains no customer data and needs no reply. Trial ID: answer-once-sdk-20261020.</p>",
  }, 'answer-once-sdk-20261020');
  console.log(JSON.stringify({ startedUTC, acceptedUTC: new Date().toISOString(), messageId: message.id, status: message.status }));
} catch (error: unknown) {
  console.error(error instanceof NitrosendError ? { name: error.name, statusCode: error.statusCode, code: error.code } : { name: 'SendFailed' });
  process.exitCode = 1;
}
