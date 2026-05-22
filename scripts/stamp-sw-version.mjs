#!/usr/bin/env node
/**
 * Pre-build script: stamp the package.json version into the service worker's
 * CACHE_VERSION constant.
 *
 * Why: the service worker uses CACHE_VERSION as the cache key for static
 * resources. When the version changes, the SW evicts old caches and pulls
 * fresh content, which fixes stale-deploy issues like "Failed to find Server
 * Action ..." (the browser is serving the old HTML from cache, complete with
 * old action hashes that the new server doesn't recognize).
 *
 * This script reads package.json, then replaces the line in public/sw.js that
 * declares CACHE_VERSION. Runs automatically before `next build` via the
 * "prebuild" npm hook.
 *
 * Idempotent — safe to run multiple times. Bails harmlessly if the SW file
 * or the expected line is missing.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname || process.cwd(), '..');
const pkgPath = resolve(root, 'package.json');
const swPath = resolve(root, 'public/sw.js');

try {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const version = pkg.version;
  if (!version) {
    console.warn('[stamp-sw-version] No version in package.json; skipping.');
    process.exit(0);
  }

  let sw;
  try {
    sw = readFileSync(swPath, 'utf8');
  } catch {
    console.warn('[stamp-sw-version] public/sw.js not found; skipping.');
    process.exit(0);
  }

  // Match the existing CACHE_VERSION line. The string after the equals can
  // be anything (single-quoted). We replace it with `v{version}`.
  const pattern = /const CACHE_VERSION = '[^']*';/;
  if (!pattern.test(sw)) {
    console.warn('[stamp-sw-version] CACHE_VERSION line not found in sw.js; skipping.');
    process.exit(0);
  }

  const newLine = `const CACHE_VERSION = 'v${version}';`;
  const updated = sw.replace(pattern, newLine);
  if (updated === sw) {
    // Already up to date
    console.log(`[stamp-sw-version] sw.js already at v${version}.`);
    process.exit(0);
  }

  writeFileSync(swPath, updated, 'utf8');
  console.log(`[stamp-sw-version] sw.js CACHE_VERSION → v${version}`);
} catch (err) {
  console.warn('[stamp-sw-version] Failed:', err.message);
  // Don't fail the build over this — worst case is stale cache, not a build break
  process.exit(0);
}
