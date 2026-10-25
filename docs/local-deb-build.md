# Local desktop packages

Use Node.js from `.nvmrc` (or a compatible newer version), npm, GNU Make, Git, and
curl. On Windows, run Make from Git Bash with GNU Make available in PATH.

| Command | Output | Build host |
| --- | --- | --- |
| `make deb` | Debian `.deb` | Linux |
| `make rpm` | RPM `.rpm` | Linux with `rpmbuild` (the `rpm` package on Debian/Ubuntu) |
| `make windows` / `make win` | Windows NSIS `.exe` installer | Windows, or Linux/macOS with Wine |
| `make macos` / `make mac` | macOS `.dmg` and `.zip` | macOS with `codesign` and `hdiutil` |

```sh
make deb
make verify
make rpm windows
make verify FORMAT=rpm
make verify FORMAT=windows
make test-build
```

`make` also defaults to `deb`. Dependencies are installed with the committed npm
lockfile and reused until a package manifest, lockfile, or build helper changes. Shared libraries
and the frontend are rebuilt before packaging. Remote changelog images are cached
using curl before the frontend build, so they are included in the package.

The version defaults to the nearest reachable release tag. To build a specific
release, check out its tag first; changing `VERSION` only changes the package
metadata, not the source revision.

```sh
make deb VERSION=4.3.0 ARCH=x64
```

Supported architectures are `x64` (Debian `amd64`) and `arm64`. The default is the
host Node.js architecture. Both architectures' PTY binaries for all three platforms
are installed for packaging. Architecture cross-compilation and native Windows/macOS
builds require validation on the corresponding machines.

The local Electron configuration uses ad-hoc macOS signing without notarization,
and does not use the upstream authors' signing identity or notarization hook.
It produces local installers, not Developer ID notarized distribution builds.
Publishing is explicitly disabled. Windows builds have no configured signing
certificate.

Packaging targets run sequentially because they share staging/output directories.
Multiple targets in one invocation reuse the same frontend build. macOS packaging
fails before dependency installation when invoked on a non-Mac host.
Windows preflight also runs `wine --version` on non-Windows hosts. If a restricted
container cannot execute Wine, use a Windows host or a Linux/macOS host where Wine
runs normally.

Packages and SHA-256 checksum files are written to `packages/bruno-electron/out/`.
Build caches stay in `work/cache/`; override `CACHE_DIR` to use another location.
`make clean` removes frontend and Electron build outputs while keeping caches and
installed dependencies. `make verify FORMAT=macos` checks both the existing DMG
and ZIP; the default format is `deb`. Verification streams SHA-256 in Node.js, so
neither `sha256sum` nor `dpkg-deb` is required by the Makefile.

To force dependency reinstallation, remove `node_modules/.bruno-build-deps-*` and run
`make deps`. The Makefile does not install the resulting package into the system.
