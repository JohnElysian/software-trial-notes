import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { digest, parseDescription } from 'mailschema';
import { startLab } from './gate.mjs';

const startedAt = new Date().toISOString();
const baseDirectory = fileURLToPath(new URL('.', import.meta.url));
const packageVersion = JSON.parse(await readFile(new URL('node_modules/mailschema/package.json', import.meta.url), 'utf8')).version;
if (packageVersion !== '0.3.2') throw new Error('This recorded trial requires mailschema0.3.2; run npm ci first.');
const rerunsDirectory = join(baseDirectory, 'reruns');
await mkdir(rerunsDirectory, { recursive: true });
const runDirectory = await mkdtemp(join(rerunsDirectory, 'trial-'));
const lab = await startLab();
const cli = fileURLToPath(new URL('node_modules/mailschema/bin/mailschema.js', import.meta.url));
const contract = join(baseDirectory, 'publication-contract.json');
const run = name => {
  const started = new Date().toISOString();
  const command = [cli, 'description', join(runDirectory, name), '--contract', contract];
  const result = spawnSync(process.execPath, command, { encoding: 'utf8' });
  if (result.error) throw result.error;
  return { startedAt: started, completedAt: new Date().toISOString(), command: [process.execPath, ...command], exitCode: result.status, stdout: result.stdout, stderr: result.stderr };
};
try {
  await writeFile(join(runDirectory, 'description.json'), JSON.stringify(lab.description, null, 2) + '\n');
  await writeFile(join(runDirectory, 'content-artifact.json'), JSON.stringify(lab.artifact, null, 2) + '\n');
  const valid = run('description.json');
  if (valid.exitCode !== 0) throw new Error(valid.stderr);
  const broken = structuredClone(lab.description); broken.details.content.digest = 'sha-256:invalid';
  await writeFile(join(runDirectory, 'description.broken.json'), JSON.stringify(broken, null, 2) + '\n');
  const negative = run('description.broken.json');
  if (negative.exitCode !== 1) throw new Error('The deliberately broken content digest was not rejected.');
  const restored = run('description.json');
  const calculated = digest(parseDescription(await readFile(join(runDirectory, 'description.json'))));
  if (restored.exitCode !== 0 || !restored.stdout.includes(calculated)) throw new Error('Restoration/digest disagreement.');
  const evidence = {
    startedAt, nodeVersion: process.version, packageVersion, runDirectory,
    dependencyStatus: 'The dependency was present before this invocation; trial.mjs does not install packages.',
    timingScope: 'Current invocation from before local service setup to first valid CLI result. Excludes dependency installation and certificate generation. Does not replay the original recorded timing.',
    valid, negative, restored, descriptionDigest: calculated,
    runToValidMinutes: (Date.parse(valid.completedAt) - Date.parse(startedAt)) / 60000,
    contentDigest: digest(lab.artifact),
    note: 'New local rerun only. The original package description/report/evidence are unchanged. The local service closes after this run. No email delivery, DKIM authentication, external publication or production MAP conformance is claimed.',
  };
  await writeFile(join(runDirectory, 'validation-evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
  await writeFile(join(runDirectory, 'description-digest.txt'), calculated + '\n');
  console.log(JSON.stringify(evidence, null, 2));
} finally { await lab.close(); }
