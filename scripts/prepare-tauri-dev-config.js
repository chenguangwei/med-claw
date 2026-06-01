#!/usr/bin/env node

/**
 * Keep `tauri dev` from requiring optional release-only CLI sidecars.
 *
 * The release build script adds Codex/Claude launchers and cli-bundle resources
 * when building with `--with-cli`. Those files are target-specific, so a later
 * dev run on another platform can fail before Rust compilation starts.
 */
import { readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const configPath = resolve(root, 'src-tauri/tauri.conf.json');

const config = JSON.parse(readFileSync(configPath, 'utf8'));
const bundle = config.bundle ?? {};

const externalBin = Array.isArray(bundle.externalBin) ? bundle.externalBin : [];
const resources = Array.isArray(bundle.resources) ? bundle.resources : [];

const optionalCliBins = new Set([
  '../src-api/dist/claude',
  '../src-api/dist/codex',
]);
const optionalCliResourceNames = [
  'claude-bundle',
  'cli-bundle',
  'codex-bundle',
];

const nextExternalBin = externalBin.filter(
  (entry) => !optionalCliBins.has(entry)
);
const nextResources = resources.filter(
  (entry) =>
    !optionalCliResourceNames.some((name) => String(entry).includes(name))
);

const changed =
  nextExternalBin.length !== externalBin.length ||
  nextResources.length !== resources.length ||
  nextExternalBin.some((entry, index) => entry !== externalBin[index]) ||
  nextResources.some((entry, index) => entry !== resources[index]);

if (changed) {
  config.bundle = {
    ...bundle,
    externalBin: nextExternalBin,
    resources: nextResources,
  };
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  console.log('Removed optional CLI bundle sidecars from Tauri dev config.');
} else {
  console.log(
    'Tauri dev config already excludes optional CLI bundle sidecars.'
  );
}
