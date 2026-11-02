import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { ubuntuMirrorEvidence } from './ubuntu-mirror-evidence.ts';

const mirrorFile = '/etc/apt/apt-mirrors.txt';
const original = readFileSync(mirrorFile, 'utf8');
// Diagnose the original hosted configuration before the strict validation or any
// write. A failed setup is retained as failure, never treated as a browser pass.
console.log(
  JSON.stringify(
    {
      kind: 'ubuntu-mirror-input',
      imageOS: process.env.ImageOS ?? null,
      imageVersion: process.env.ImageVersion ?? null,
      ...ubuntuMirrorEvidence(original),
    },
    null,
    2,
  ),
);
const archive = 'https://archive.ubuntu.com/ubuntu/';
const priorities = new Map<string, string>();
const unexpected = `Unexpected ${mirrorFile}: expected one supported hosted/archive pair with priorities 1 and 2.`;

// Slow Azure OS-package transfers have exhausted browser-job budgets:
// https://github.com/actions/runner-images/issues/14823
// Lower numbers win. Keep both existing mirrors and all unrelated entries intact.
// The exact EC2 fallback was captured in CI job 125363957600 (SPN-131).
// Select by observed file contents, never by provider or runner-region guesses.
const updated = original.replace(
  /^([ \t]*(?:http:\/\/(?:azure|us-east-2\.ec2)\.archive\.ubuntu\.com\/ubuntu\/|https:\/\/archive\.ubuntu\.com\/ubuntu\/))(?=\s|$)([^\r\n]*)(\r?)$/gm,
  (line: string, address: string, metadata: string) => {
    const uri = address.trimStart();
    const priority = /^[ \t]+priority:([12])[ \t]*$/.exec(metadata)?.[1];
    if (!priority || priorities.has(uri)) throw new Error(unexpected);
    priorities.set(uri, priority);
    return line.replace(`priority:${priority}`, `priority:${uri === archive ? '1' : '2'}`);
  },
);

// Require the archive and exactly one supported fallback before sudo. Both
// fallbacks together are ambiguous; only priorities 1/2 or their inverse are known.
if (priorities.size !== 2 || !priorities.has(archive) || new Set(priorities.values()).size !== 2) {
  throw new Error(unexpected);
}
if (updated === original) {
  console.log('The official Ubuntu archive already has priority 1.');
} else {
  execFileSync('sudo', ['-n', 'tee', '--', mirrorFile], {
    input: updated,
    stdio: ['pipe', 'ignore', 'inherit'],
  });
  console.log('Preferred the official Ubuntu archive; the hosted mirror remains the fallback.');
}
