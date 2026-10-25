.DEFAULT_GOAL := deb
.DELETE_ON_ERROR:
# Electron packagers share the staging and output directories.
.NOTPARALLEL:

VERSION ?= $(shell git describe --tags --match 'v[0-9]*' --abbrev=0 2>/dev/null | sed 's/^v//')
ARCH ?= $(shell node -p 'process.arch')
HOST_PLATFORM := $(shell node -p 'process.platform')
FORMAT ?= deb
CACHE_DIR ?= $(CURDIR)/work/cache
OUT_DIR := packages/bruno-electron/out
DEPS_STAMP := node_modules/.bruno-build-deps-$(HOST_PLATFORM)
PACKAGE_FILES := package.json package-lock.json $(wildcard packages/*/package.json)
BUILDER := npm exec --workspace=packages/bruno-electron -- electron-builder
BUILDER_FLAGS = --config electron-builder-local.cjs --$(ARCH) --publish never -c.extraMetadata.version="$(VERSION)"

export npm_config_cache := $(CACHE_DIR)/npm
export XDG_CACHE_HOME := $(CACHE_DIR)
export electron_config_cache := $(CACHE_DIR)/electron
export ELECTRON_CACHE := $(CACHE_DIR)/electron
export ELECTRON_BUILDER_CACHE := $(CACHE_DIR)/electron-builder
export HUSKY := 0
export NODE_OPTIONS ?= --max-old-space-size=8192
export WINEPREFIX := $(CACHE_DIR)/wine
export CSC_IDENTITY_AUTO_DISCOVERY := false

.PHONY: help check-tools check-linux check-windows check-macos check-rpm deps setup shared assets web stage deb rpm windows win macos mac verify test-build clean

help:
	@printf '%s\n' \
	  'make                 Build a Debian package (same as make deb)' \
	  'make deps            Install dependencies when package manifests change' \
	  'make setup           Install dependencies and build shared libraries' \
	  'make web             Build shared libraries and the frontend' \
	  'make deb             Build .deb and write its SHA-256 checksum' \
	  'make rpm             Build .rpm on Linux' \
	  'make windows         Build a Windows NSIS .exe (Wine required on other hosts)' \
	  'make macos           Build macOS .dmg and .zip on a Mac' \
	  'make verify          Verify existing artifacts (FORMAT=deb|rpm|windows|macos)' \
	  'make test-build      Test artifact checksums and platform build guards' \
	  'make clean           Remove frontend and Electron build outputs' \
	  'Overrides: VERSION=4.3.0 ARCH=x64 CACHE_DIR=/path/to/cache' \
	  'Output: packages/bruno-electron/out/'

check-tools:
	@for tool in node npm git curl; do \
	  command -v "$$tool" >/dev/null || { printf 'Missing tool: %s\n' "$$tool" >&2; exit 1; }; \
	done
	@node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 22 || (major === 22 && minor < 12)) { console.error("Node.js >=22.12 is required; see .nvmrc"); process.exit(1); }'
	@case '$(ARCH)' in x64|arm64) ;; *) printf 'Unsupported ARCH: %s\n' '$(ARCH)' >&2; exit 1;; esac
	@test -n '$(VERSION)' || { printf '%s\n' 'No release tag found. Pass VERSION=x.y.z.' >&2; exit 1; }

check-linux: check-tools
	@test '$(HOST_PLATFORM)' = linux || { printf '%s\n' 'Build Linux packages on Linux.' >&2; exit 1; }

check-rpm: check-linux
	@command -v rpmbuild >/dev/null || { printf '%s\n' 'RPM packaging requires rpmbuild (install the rpm package).' >&2; exit 1; }

check-windows: check-tools
	@if test '$(HOST_PLATFORM)' != win32; then \
	  command -v wine >/dev/null || { printf '%s\n' 'Windows builds on this host require Wine.' >&2; exit 1; }; \
	  wine --version >/dev/null || { printf '%s\n' 'Wine cannot run in this environment. Build on Windows or a host with working Wine.' >&2; exit 1; }; \
	fi

check-macos: check-tools
	@test '$(HOST_PLATFORM)' = darwin || { printf '%s\n' 'Build macOS DMG/ZIP packages on a Mac.' >&2; exit 1; }
	@command -v codesign >/dev/null && command -v hdiutil >/dev/null

deps: $(DEPS_STAMP)

$(DEPS_STAMP): $(PACKAGE_FILES) .npmrc .nvmrc scripts/build-local.cjs | check-tools
	mkdir -p "$(CACHE_DIR)"
	npm ci --legacy-peer-deps --prefer-offline --no-audit --no-fund
	node scripts/build-local.cjs platform-deps
	touch "$@"

setup: shared

shared: deps
	npm run build:graphql-docs
	npm run build:bruno-query
	npm run build:bruno-common
	npm run build:bruno-converters
	npm run build:bruno-requests
	npm run build:schema-types
	npm run build:bruno-filestore
	npm run build:bruno-sqlite
	npm run sandbox:bundle-libraries --workspace=packages/bruno-js

assets: deps
	node scripts/build-local.cjs assets

web: shared assets
	npm run build:web

stage: web
	node scripts/build-local.cjs stage

deb: check-linux stage
	$(BUILDER) --linux deb $(BUILDER_FLAGS)
	node scripts/build-local.cjs checksums deb "$(VERSION)" "$(ARCH)"

rpm: check-rpm stage
	$(BUILDER) --linux rpm $(BUILDER_FLAGS)
	node scripts/build-local.cjs checksums rpm "$(VERSION)" "$(ARCH)"

windows: check-windows stage
	$(BUILDER) --win nsis $(BUILDER_FLAGS)
	node scripts/build-local.cjs checksums windows "$(VERSION)" "$(ARCH)"

win: windows

macos: check-macos stage
	$(BUILDER) --mac dmg zip $(BUILDER_FLAGS)
	node scripts/build-local.cjs checksums macos "$(VERSION)" "$(ARCH)"

mac: macos

verify: check-tools
	node scripts/build-local.cjs verify "$(FORMAT)" "$(VERSION)" "$(ARCH)"

test-build: deps
	node --test scripts/build-local.test.cjs

clean:
	rm -rf packages/bruno-app/dist packages/bruno-electron/web "$(OUT_DIR)"
