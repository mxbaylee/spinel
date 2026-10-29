import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { appendFile, chmod, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

// Refresh only the disposable hosted test machine. Ordinary application bundles
// and their native permission/storage policies are used, not a testing browser.
assert.equal(process.platform, 'darwin');
assert.equal(process.env.GITHUB_ACTIONS, 'true');
assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted');
const kind = process.argv[2];
assert.ok(kind === 'chrome' || kind === 'firefox' || kind === 'safari');
const directory = resolve(`test-results/desktop-browser-release-${kind}`);
const output = resolve(`artifacts/desktop-offline/${kind}`);
await mkdir(directory, { recursive: true });
await mkdir(output, { recursive: true });
const run = promisify(execFile);
const command = async (file: string, args: string[], timeout = 120_000) => {
  const result = await run(file, args, { timeout, maxBuffer: 4 * 1024 * 1024 });
  return result.stdout + result.stderr;
};
const app = `/Applications/${{ chrome: 'Google Chrome', firefox: 'Firefox', safari: 'Safari' }[kind]}.app`;
const version = () =>
  command('/usr/libexec/PlistBuddy', [
    '-c',
    'Print :CFBundleShortVersionString',
    join(app, 'Contents/Info.plist'),
  ]);
const currentOrNewer = (actual: string, required: string) => {
  assert.match(actual, /^\d+(?:\.\d+)*$/);
  assert.match(required, /^\d+(?:\.\d+)*$/);
  const left = actual.split('.').map(Number);
  const right = required.split('.').map(Number);
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    if ((left[index] ?? 0) !== (right[index] ?? 0)) return (left[index] ?? 0) > (right[index] ?? 0);
  }
  return true;
};
const download = (url: string, path: string) =>
  command('/usr/bin/curl', [
    '--fail',
    '--location',
    '--silent',
    '--show-error',
    '--proto',
    '=https',
    '--proto-redir',
    '=https',
    '--output',
    path,
    url,
  ]);
async function json(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  assert.ok(response.ok, `Release metadata ${url}: ${response.status}`);
  return response.json();
}
const report: Record<string, unknown> = {
  sourceSha: process.env.SOURCE_SHA,
  checkedAt: new Date().toISOString(),
  kind,
  status: 'failed',
};

async function installDmg(url: string, bundle: string, identifier: string) {
  const disk = join(directory, 'browser.dmg');
  const mount = join(directory, 'mounted');
  await mkdir(mount, { recursive: true });
  await download(url, disk);
  await command('/usr/bin/hdiutil', [
    'attach',
    disk,
    '-nobrowse',
    '-readonly',
    '-mountpoint',
    mount,
  ]);
  try {
    // A mounted distribution can carry Finder/resource-fork metadata which
    // strict codesign rejects (Apple QA1940). Copy regular signed bytes first;
    // then require the same strict signature and Gatekeeper checks on that copy.
    const source = join(directory, bundle);
    await command('/usr/bin/ditto', ['--norsrc', join(mount, bundle), source]);
    report.installationCopy =
      'ditto --norsrc, followed by strict codesign and Gatekeeper assessment';
    const id = (
      await command('/usr/libexec/PlistBuddy', [
        '-c',
        'Print :CFBundleIdentifier',
        join(source, 'Contents/Info.plist'),
      ])
    ).trim();
    assert.equal(id, identifier);
    await command('/usr/bin/codesign', ['--verify', '--deep', '--strict', source]);
    report.signature = await command('/usr/sbin/spctl', [
      '--assess',
      '--type',
      'execute',
      '--verbose=2',
      source,
    ]);
    // Preserve the image's original bundle until the VM is disposed. No profile
    // exists for this acceptance run yet, and no user machine reaches this code.
    await command('/usr/bin/sudo', ['/bin/mv', app, join(directory, 'previous.app')]);
    await command('/usr/bin/sudo', ['/usr/bin/ditto', source, app]);
    report.download = url;
  } finally {
    await command('/usr/bin/hdiutil', ['detach', mount]);
  }
}

try {
  report.before = (await version()).trim();
  if (kind === 'chrome') {
    const metadataUrl =
      'https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json';
    const metadata = await json(metadataUrl);
    const stable = metadata.channels.Stable as {
      version: string;
      downloads: { chromedriver: { platform: string; url: string }[] };
    };
    report.releaseSource = metadataUrl;
    report.requiredStable = stable.version;
    await installDmg(
      'https://dl.google.com/chrome/mac/universal/stable/GGRO/googlechrome.dmg',
      'Google Chrome.app',
      'com.google.Chrome',
    );
    const installed = (await version()).trim();
    assert.ok(
      currentOrNewer(installed, stable.version),
      'The ordinary Chrome download is older than current stable metadata.',
    );
    assert.equal(
      installed.split('.').slice(0, 3).join('.'),
      stable.version.split('.').slice(0, 3).join('.'),
      'The driver must match the ordinary stable Chrome build.',
    );
    const platform = process.arch === 'arm64' ? 'mac-arm64' : 'mac-x64';
    const driver = stable.downloads.chromedriver.find((entry) => entry.platform === platform);
    assert.ok(driver);
    assert.equal(
      driver.url,
      `https://storage.googleapis.com/chrome-for-testing-public/${stable.version}/${platform}/chromedriver-${platform}.zip`,
    );
    const archive = join(directory, 'driver.zip');
    await download(driver.url, archive);
    await command('/usr/bin/ditto', ['-x', '-k', archive, directory]);
    const driverDirectory = join(directory, `chromedriver-${platform}`);
    await chmod(join(driverDirectory, 'chromedriver'), 0o755);
    assert.ok(process.env.GITHUB_ENV);
    await appendFile(process.env.GITHUB_ENV, `CHROMEWEBDRIVER=${driverDirectory}\n`);
    report.driver = await command(join(driverDirectory, 'chromedriver'), ['--version']);
  } else if (kind === 'firefox') {
    const metadataUrl = 'https://product-details.mozilla.org/1.0/firefox_versions.json';
    const metadata = await json(metadataUrl);
    report.releaseSource = metadataUrl;
    report.requiredStable = metadata.LATEST_FIREFOX_VERSION;
    await installDmg(
      'https://download.mozilla.org/?product=firefox-latest-ssl&os=osx&lang=en-US',
      'Firefox.app',
      'org.mozilla.firefox',
    );
    assert.ok(
      currentOrNewer((await version()).trim(), metadata.LATEST_FIREFOX_VERSION),
      'Firefox must match the current ordinary stable release.',
    );
  } else {
    // Apple supplies Safari through Software Update. Select Safari only: never
    // install an OS upgrade, reboot the runner, or alter its update policy.
    report.releaseSource = 'https://support.apple.com/en-us/149527';
    report.requiredStable = '27.2'; // Published 2026-10-26; run also installs any newer offered Safari.
    const listing = await command('/usr/sbin/softwareupdate', ['--list'], 180_000);
    report.availableUpdates = listing;
    const labels = [...listing.matchAll(/^\s*\*\s*Label:\s*(Safari\d[^\r\n]*)/gm)].map((match) =>
      match[1].trim(),
    );
    assert.ok(labels.length <= 1, 'Ambiguous Safari updates require inspection.');
    if (labels.length)
      report.install = await command(
        '/usr/bin/sudo',
        ['/usr/sbin/softwareupdate', '--install', labels[0], '--verbose'],
        480_000,
      );
    assert.ok(
      currentOrNewer((await version()).trim(), '27.2'),
      'Current Safari is unavailable on this image; do not count an older Safari as current acceptance.',
    );
  }
  report.installed = (await version()).trim();
  report.status = 'passed';
} catch (error) {
  report.error = String(error);
  process.exitCode = 1;
} finally {
  await writeFile(join(output, 'versions.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
