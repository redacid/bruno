const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { findRemoteImageUrls } = require('../packages/bruno-app/plugins/remote-images/utils');

const root = path.resolve(__dirname, '..');
const frontend = path.join(root, 'packages/bruno-app');

function installPlatformDeps() {
  // Keep foreign-platform prebuilt PTYs available when packaging Windows on Linux.
  const metadata = require('@lydell/node-pty/package.json');
  const packages = Object.entries(metadata.optionalDependencies)
    .filter(([name]) => name.startsWith('@lydell/node-pty-'))
    .map(([name, version]) => `${name}@${version}`);
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  execFileSync(npm, ['install', '--legacy-peer-deps', '--no-save', '--force', '--prefer-offline', '--no-audit', '--no-fund', ...packages], {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });
}

function* files(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      yield* files(filename);
    } else if (entry.isFile()) {
      yield filename;
    }
  }
}

function cacheImages() {
  const domains = (process.env.BRUNO_REMOTE_IMAGE_DOMAINS || 'd3icksk7srk4uh.cloudfront.net').split(',');
  const urls = new Set();
  for (const filename of files(path.join(frontend, 'src'))) {
    if (!filename.endsWith('.md')) continue;
    for (const url of findRemoteImageUrls(fs.readFileSync(filename, 'utf8'), domains)) urls.add(url);
  }

  // Match the remote-images loader cache; npm runs the frontend build in this workspace.
  const cache = path.join(frontend, 'node_modules/.cache/bruno-remote-images');
  fs.mkdirSync(cache, { recursive: true });
  for (const url of urls) {
    const filename = path.join(cache, crypto.createHash('sha256').update(url).digest('hex'));
    if (!fs.existsSync(filename)) {
      const temporary = `${filename}.${process.pid}.tmp`;
      try {
        execFileSync('curl', ['--fail', '--location', '--silent', '--show-error', '--retry', '2', '--max-time', '60', '--output', temporary, url], { stdio: 'inherit' });
        fs.renameSync(temporary, filename);
      } finally {
        fs.rmSync(temporary, { force: true });
      }
    }
    const hash = crypto.createHash('md5').update(fs.readFileSync(filename)).digest('hex').slice(0, 16);
    fs.writeFileSync(`${filename}.hash`, hash);
  }
  console.log(`Cached ${urls.size} frontend images.`);
}

function stageFrontend() {
  const source = path.join(frontend, 'dist');
  const target = path.join(root, 'packages/bruno-electron/web');
  if (!fs.existsSync(path.join(source, 'index.html'))) {
    throw new Error('Frontend build missing; run make web first.');
  }
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(source, target, { recursive: true });
  for (const filename of files(target)) {
    if (filename.endsWith('.map')) {
      fs.unlinkSync(filename);
    } else if (filename.endsWith('.html')) {
      fs.writeFileSync(filename, fs.readFileSync(filename, 'utf8').replaceAll('/static', './static'));
    } else if (filename.endsWith('.css')) {
      fs.writeFileSync(filename, fs.readFileSync(filename, 'utf8').replaceAll('/static/font', '../../static/font'));
    }
  }
  console.log('Frontend staged for Electron.');
}

function findArtifacts(format, version, arch, output = path.join(root, 'packages/bruno-electron/out')) {
  const formats = {
    deb: { platform: 'linux', extensions: ['deb'] },
    rpm: { platform: 'linux', extensions: ['rpm'] },
    windows: { platform: 'win', extensions: ['exe'] },
    macos: { platform: 'mac', extensions: ['dmg', 'zip'] }
  };
  const target = formats[format];
  if (!target || !version || !['x64', 'arm64'].includes(arch)) {
    throw new Error('Specify format deb|rpm|windows|macos, version, and architecture x64|arm64.');
  }
  const names = fs.readdirSync(output);
  const prefix = `bruno_${version}_`;
  const aliases = arch === 'x64' ? ['x64', 'amd64', 'x86_64'] : ['arm64', 'aarch64'];
  return target.extensions.map((extension) => {
    const suffix = `_${target.platform}.${extension}`;
    const matches = names.filter((name) => name.startsWith(prefix) && name.endsWith(suffix)
      && aliases.includes(name.slice(prefix.length, -suffix.length)));
    if (matches.length !== 1) throw new Error(`Expected one ${format} ${arch} .${extension} artifact for ${version}, found ${matches.length}.`);
    return path.join(output, matches[0]);
  });
}

async function checksumArtifacts(format, version, arch, verify, output) {
  for (const filename of findArtifacts(format, version, arch, output)) {
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(filename)) hash.update(chunk);
    const line = `${hash.digest('hex')}  ${path.basename(filename)}\n`;
    if (verify) {
      if (fs.readFileSync(`${filename}.sha256`, 'utf8') !== line) {
        throw new Error(`SHA-256 mismatch: ${filename}`);
      }
      console.log(`Verified: ${path.basename(filename)}`);
    } else {
      fs.writeFileSync(`${filename}.sha256`, line);
      console.log(`Package: ${filename}`);
    }
  }
}

async function main() {
  const [, , command, format, version, arch] = process.argv;
  switch (command) {
    case 'platform-deps': installPlatformDeps(); break;
    case 'assets': cacheImages(); break;
    case 'stage': stageFrontend(); break;
    case 'checksums': await checksumArtifacts(format, version, arch, false); break;
    case 'verify': await checksumArtifacts(format, version, arch, true); break;
    default: throw new Error('Usage: node scripts/build-local.cjs platform-deps|assets|stage|checksums|verify');
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { findArtifacts, checksumArtifacts };
