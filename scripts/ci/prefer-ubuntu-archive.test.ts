import assert from 'node:assert/strict';
import { test } from 'node:test';
import { preferUbuntuArchive } from './prefer-ubuntu-archive.ts';

const azure = 'http://azure.archive.ubuntu.com/ubuntu/';
const archive = 'https://archive.ubuntu.com/ubuntu/';
const security = 'https://security.ubuntu.com/ubuntu/';
const normal = `${azure}\tpriority:1\n${archive}\tpriority:2\n${security}\tpriority:3\n`;
const preferred = `${azure}\tpriority:2\n${archive}\tpriority:1\n${security}\tpriority:3\n`;

test('leaves profiles without Azure byte-identical', () => {
  // Synthetic non-Azure inputs, not a claimed capture of a particular runner.
  for (const original of [
    '',
    `${archive}\tpriority:1\n${security}\tpriority:2\n`,
    '# runner-managed sources\r\nhttp://us-east-1.ec2.archive.ubuntu.com/ubuntu/\tpriority:1\r\n',
    'http://ports.ubuntu.com/ubuntu-ports/\n',
  ]) {
    assert.equal(preferUbuntuArchive(original), original);
  }
});

test('changes only the existing Azure/archive priorities and preserves other bytes', () => {
  assert.equal(preferUbuntuArchive(normal), preferred);
  const original = `# mirrors\r\n  ${azure}\tpriority:1  \r\n\t${archive} priority:2\r\n${security}\tpriority:3\r\n`;
  const expected = `# mirrors\r\n  ${azure}\tpriority:2  \r\n\t${archive} priority:1\r\n${security}\tpriority:3\r\n`;
  assert.equal(preferUbuntuArchive(original), expected);
});

test('keeps an already preferred Azure/archive pair unchanged', () => {
  assert.equal(preferUbuntuArchive(preferred), preferred);
});

for (const [name, original] of [
  ['missing archive', `${azure}\tpriority:1\n`],
  ['duplicate Azure', normal + `${azure}\tpriority:1\n`],
  ['duplicate archive', normal + `${archive}\tpriority:2\n`],
  ['equal priorities', normal.replace(`${archive}\tpriority:2`, `${archive}\tpriority:1`)],
  ['unsupported priority', normal.replace(`${azure}\tpriority:1`, `${azure}\tpriority:3`)],
  ['missing priority', normal.replace(`${azure}\tpriority:1`, azure)],
  ['unexpected metadata', normal.replace('priority:1', 'priority:1 extra:yes')],
  ['unrecognized Azure scheme', normal.replace(azure, azure.replace('http:', 'https:'))],
  ['unrecognized Azure case', normal.replace('azure.archive', 'AZURE.archive')],
]) {
  test(`refuses malformed Azure profile: ${name}`, () => {
    assert.throws(() => preferUbuntuArchive(original), /expected one Azure\/archive pair/);
  });
}
