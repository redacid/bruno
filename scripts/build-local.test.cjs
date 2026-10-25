const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { spawnSync } = require('node:child_process');
const { findArtifacts, checksumArtifacts } = require('./build-local.cjs');

function fixture(t, names) {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'bruno-build-'));
  t.after(() => fs.rmSync(output, { recursive: true, force: true }));
  for (const name of names) fs.writeFileSync(path.join(output, name), 'package content');
  return output;
}

test('finds Debian and RPM architecture names without selecting another architecture', (t) => {
  const output = fixture(t, [
    'bruno_4.3.0_amd64_linux.deb',
    'bruno_4.3.0_x86_64_linux.rpm',
    'bruno_4.3.0_aarch64_linux.rpm'
  ]);
  assert.equal(path.basename(findArtifacts('deb', '4.3.0', 'x64', output)[0]), 'bruno_4.3.0_amd64_linux.deb');
  assert.equal(path.basename(findArtifacts('rpm', '4.3.0', 'arm64', output)[0]), 'bruno_4.3.0_aarch64_linux.rpm');
});

test('requires both macOS formats and the requested release', (t) => {
  const output = fixture(t, ['bruno_4.3.0_arm64_mac.dmg']);
  assert.throws(() => findArtifacts('macos', '4.3.0', 'arm64', output), /\.zip artifact/);
  fs.writeFileSync(path.join(output, 'bruno_4.3.0_arm64_mac.zip'), 'zip content');
  assert.equal(findArtifacts('macos', '4.3.0', 'arm64', output).length, 2);
  assert.throws(() => findArtifacts('macos', '4.2.0', 'arm64', output), /found 0/);
});

test('writes portable SHA-256 checksums and rejects a changed installer', async (t) => {
  const filename = 'bruno_4.3.0_x64_win.exe';
  const output = fixture(t, [filename]);
  await checksumArtifacts('windows', '4.3.0', 'x64', false, output);
  const hash = crypto.createHash('sha256').update('package content').digest('hex');
  assert.equal(fs.readFileSync(path.join(output, `${filename}.sha256`), 'utf8'), `${hash}  ${filename}\n`);
  await checksumArtifacts('windows', '4.3.0', 'x64', true, output);
  fs.appendFileSync(path.join(output, filename), 'modified');
  await assert.rejects(checksumArtifacts('windows', '4.3.0', 'x64', true, output), /SHA-256 mismatch/);
});

test('local macOS configuration does not use upstream signing or notarization', () => {
  const upstream = require('../packages/bruno-electron/electron-builder-config');
  const local = require('../packages/bruno-electron/electron-builder-local.cjs');
  assert.equal(local.mac.identity, '-');
  assert.equal(local.mac.hardenedRuntime, false);
  assert.equal(local.mac.notarize, false);
  assert.equal(local.afterSign, null);
  assert.notEqual(upstream.mac.identity, local.mac.identity);
  assert.notEqual(upstream.afterSign, null);
});

test('local configuration passes the installed electron-builder schema', async () => {
  const { validateConfig } = require('app-builder-lib/out/util/config');
  const local = require('../packages/bruno-electron/electron-builder-local.cjs');
  await validateConfig(local, { isEnabled: false });
});

test('macOS packaging fails on a non-Mac before installation or compilation', { skip: process.platform === 'darwin' }, () => {
  const result = spawnSync('make', ['macos'], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8', shell: process.platform === 'win32' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Build macOS DMG\/ZIP packages on a Mac/);
  assert.doesNotMatch(result.stdout, /npm ci|npm run build/);
});

test('Windows preflight rejects Wine that is installed but cannot run', { skip: process.platform === 'win32' }, (t) => {
  const directory = fixture(t, []);
  const wine = path.join(directory, 'wine');
  fs.writeFileSync(wine, '#!/bin/sh\nexit 42\n', { mode: 0o755 });
  const result = spawnSync('make', ['check-windows', 'HOST_PLATFORM=linux'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, PATH: `${directory}${path.delimiter}${process.env.PATH}` },
    encoding: 'utf8'
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Wine cannot run in this environment/);
});
