import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { ubuntuMirrorEvidence } from './ubuntu-mirror-evidence.ts';

// Exact input observed in diagnostic run 41463712789, job 125340702446.
const original =
  'http://azure.archive.ubuntu.com/ubuntu/\tpriority:1\n' +
  'https://archive.ubuntu.com/ubuntu/\tpriority:2\n' +
  'https://security.ubuntu.com/ubuntu/\tpriority:3\n';
const preferred =
  'http://azure.archive.ubuntu.com/ubuntu/\tpriority:2\n' +
  'https://archive.ubuntu.com/ubuntu/\tpriority:1\n' +
  'https://security.ubuntu.com/ubuntu/\tpriority:3\n';
// Exact rejected input from run 41470825163, job 125363957600.
const ec2Original =
  'http://us-east-2.ec2.archive.ubuntu.com/ubuntu/\tpriority:1\n' +
  'https://archive.ubuntu.com/ubuntu/\tpriority:2\n' +
  'https://security.ubuntu.com/ubuntu/\tpriority:3\n';
const ec2Preferred =
  'http://us-east-2.ec2.archive.ubuntu.com/ubuntu/\tpriority:2\n' +
  'https://archive.ubuntu.com/ubuntu/\tpriority:1\n' +
  'https://security.ubuntu.com/ubuntu/\tpriority:3\n';
const entrypoint = readFileSync(new URL('./prefer-ubuntu-archive.ts', import.meta.url), 'utf8');
const imports = [
  "import { execFileSync } from 'node:child_process';",
  "import { readFileSync } from 'node:fs';",
  "import { ubuntuMirrorEvidence } from './ubuntu-mirror-evidence.ts';",
];
let executable = entrypoint;
for (const statement of imports) {
  assert.equal(executable.split(statement).length, 2, 'entrypoint import boundary changed');
  executable = executable.replace(statement, '');
}
assert.doesNotMatch(executable, /^import\b/m);
executable = stripTypeScriptTypes(executable);

// Execute the actual CLI, replacing only its OS boundary: no sudo or host-file
// mutation is permitted from these offline controls. The transformer is not copied.
function inspect(input: string) {
  const writes: { command: string; args: string[]; input: string }[] = [];
  const logs: string[] = [];
  let error: unknown;
  try {
    runInNewContext(
      executable,
      {
        process: { env: {} },
        console: { log: (value: string) => logs.push(value) },
        ubuntuMirrorEvidence,
        readFileSync: (file: string, encoding: string) => {
          assert.equal(file, '/etc/apt/apt-mirrors.txt');
          assert.equal(encoding, 'utf8');
          return input;
        },
        execFileSync: (command: string, args: string[], options: { input: string }) => {
          writes.push({ command, args: [...args], input: options.input });
        },
      },
      { timeout: 1_000 },
    );
  } catch (caught) {
    error = caught;
  }
  return { writes, logs, error };
}

test('the observed original pair changes only its preference and preserves the security fallback', () => {
  assert.equal(
    createHash('sha256').update(original).digest('hex'),
    'e0d6b0af979e4662d16357a27ae456cc6f21e26da031540f4df8706ebed1d583',
  );
  const result = inspect(original);
  assert.equal(result.error, undefined);
  assert.deepEqual(result.writes, [
    { command: 'sudo', args: ['-n', 'tee', '--', '/etc/apt/apt-mirrors.txt'], input: preferred },
  ]);
  assert.equal(JSON.parse(result.logs[0]).sha256, ubuntuMirrorEvidence(original).sha256);
});

test('an already preferred pair performs no write', () => {
  const result = inspect(preferred);
  assert.equal(result.error, undefined);
  assert.deepEqual(result.writes, []);
  assert.match(result.logs.at(-1)!, /already has priority 1/);
});

test('the observed EC2 pair changes only its preference and retains exact input evidence', () => {
  assert.equal(Buffer.byteLength(ec2Original), 152);
  assert.equal(
    createHash('sha256').update(ec2Original).digest('hex'),
    'af9816b59bc904eaf28838ae673ac2b625b6628bebfc67a7cbeae78ba06e226a',
  );
  const result = inspect(ec2Original);
  assert.equal(result.error, undefined);
  assert.deepEqual(result.writes, [
    { command: 'sudo', args: ['-n', 'tee', '--', '/etc/apt/apt-mirrors.txt'], input: ec2Preferred },
  ]);
  assert.deepEqual(
    JSON.parse(result.logs[0]).lines.map((line: { text: string }) => line.text),
    ec2Original.split('\n'),
  );
  const unchanged = inspect(ec2Preferred);
  assert.equal(unchanged.error, undefined);
  assert.deepEqual(unchanged.writes, []);
});

test('line endings, spacing and unrelated entries survive unchanged', () => {
  const prefix = '# Maintained by the runner image\r\n\r\n';
  const suffix = 'https://other.example/ubuntu/\tpriority:4\r\n';
  const spaced = (text: string) => text.replaceAll('\n', '  \r\n').replaceAll('http', ' \thttp');
  const result = inspect(prefix + spaced(original) + suffix);
  assert.equal(result.error, undefined);
  assert.equal(result.writes.length, 1);
  assert.equal(result.writes[0].input, prefix + spaced(preferred) + suffix);
  assert.doesNotMatch(result.logs[0], /Maintained by|other\.example/);
});

for (const [name, input] of [
  ['empty input', ''],
  ['missing archive', original.replace('https://archive.ubuntu.com/ubuntu/\tpriority:2\n', '')],
  ['missing Azure', original.replace('http://azure.archive.ubuntu.com/ubuntu/\tpriority:1\n', '')],
  ['duplicate Azure', original + 'http://azure.archive.ubuntu.com/ubuntu/\tpriority:2\n'],
  ['duplicate archive', original + 'https://archive.ubuntu.com/ubuntu/\tpriority:1\n'],
  ['equal priorities', original.replace('priority:2', 'priority:1')],
  ['unsupported priority', original.replace('priority:2', 'priority:4')],
  ['malformed metadata', original.replace('priority:2', 'priority:2 private-token')],
  ['duplicate EC2', ec2Original + 'http://us-east-2.ec2.archive.ubuntu.com/ubuntu/\tpriority:2\n'],
  [
    'EC2 missing archive',
    ec2Original.replace('https://archive.ubuntu.com/ubuntu/\tpriority:2\n', ''),
  ],
  ['EC2 equal priorities', ec2Original.replace('priority:2', 'priority:1')],
  ['EC2 unsupported priority', ec2Original.replace('priority:1', 'priority:4')],
  ['EC2 malformed metadata', ec2Original.replace('priority:1', 'priority:1 private-token')],
  ['both known fallbacks', ec2Original + 'http://azure.archive.ubuntu.com/ubuntu/\tpriority:2\n'],
  [
    'both fallbacks without archive',
    ec2Original.replace(
      'https://archive.ubuntu.com/ubuntu/',
      'http://azure.archive.ubuntu.com/ubuntu/',
    ),
  ],
  ['unknown replacement fallback', ec2Original.replace('us-east-2.ec2', 'unobserved.ec2')],
] as const) {
  test(`${name} fails before any write and retains safe original-input evidence`, () => {
    const result = inspect(input);
    assert.match(String(result.error), /Unexpected .*expected one supported hosted\/archive pair/);
    assert.deepEqual(result.writes, []);
    const evidence = JSON.parse(result.logs[0]);
    assert.equal(evidence.sha256, ubuntuMirrorEvidence(input).sha256);
    assert.doesNotMatch(result.logs.join('\n'), /private-token/);
  });
}
