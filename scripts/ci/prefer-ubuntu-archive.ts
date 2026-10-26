import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const mirrorFile = '/etc/apt/apt-mirrors.txt';
const original = readFileSync(mirrorFile, 'utf8');
const azure = 'http://azure.archive.ubuntu.com/ubuntu/';
const archive = 'https://archive.ubuntu.com/ubuntu/';
const priorities = new Map<string, string>();
const unexpected = `Unexpected ${mirrorFile}: expected one Azure/archive pair with priorities 1 and 2.`;

// Slow Azure OS-package transfers have exhausted browser-job budgets:
// https://github.com/actions/runner-images/issues/14823
// Lower numbers win. Keep both existing mirrors and all unrelated entries intact.
const updated = original.replace(
  /^([ \t]*(?:http:\/\/azure\.archive\.ubuntu\.com\/ubuntu\/|https:\/\/archive\.ubuntu\.com\/ubuntu\/))(?=\s|$)([^\r\n]*)(\r?)$/gm,
  (line: string, address: string, metadata: string) => {
    const uri = address.trimStart();
    const priority = /^[ \t]+priority:([12])[ \t]*$/.exec(metadata)?.[1];
    if (!priority || priorities.has(uri)) throw new Error(unexpected);
    priorities.set(uri, priority);
    return line.replace(`priority:${priority}`, `priority:${uri === archive ? '1' : '2'}`);
  },
);

// Validate both entries before sudo: only the original pair or its inverse is known.
if (priorities.size !== 2 || priorities.get(azure) === priorities.get(archive)) {
  throw new Error(unexpected);
}
if (updated === original) {
  console.log('The official Ubuntu archive already has priority 1.');
} else {
  execFileSync('sudo', ['-n', 'tee', '--', mirrorFile], {
    input: updated,
    stdio: ['pipe', 'ignore', 'inherit'],
  });
  console.log('Preferred the official Ubuntu archive; Azure remains the fallback.');
}
