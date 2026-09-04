import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const webRoot = path.join(repositoryRoot, 'web');
const dist = path.join(webRoot, 'dist');
const html = await readFile(path.join(dist, 'index.html'), 'utf8');
const assets = await readdir(path.join(dist, 'assets'));
const vercel = JSON.parse(await readFile(path.join(webRoot, 'vercel.json'), 'utf8'));

assert.match(html, /<div id="root"><\/div>/, 'root mount point is missing');
assert.match(html, /Revelation MIDI to MML/, 'product title is missing');

const wasmName = assets.find((name) => /^reve_midi_wasm_bg-.*\.wasm$/.test(name));
const workerName = assets.find((name) => /^converter\.worker-.*\.js$/.test(name));
const javascriptNames = assets.filter((name) => name.endsWith('.js'));
const stylesheetNames = assets.filter((name) => name.endsWith('.css'));
assert.ok(wasmName, 'hashed WASM asset is missing from production output');
assert.ok(workerName, 'converter Web Worker is missing from production output');
assert.match(html, /assets\/index-.*\.js/, 'JavaScript entry is missing');
assert.match(html, /assets\/index-.*\.css/, 'stylesheet entry is missing');

const wasmSize = (await stat(path.join(dist, 'assets', wasmName))).size;
assert.ok(wasmSize > 0 && wasmSize < 1_000_000, `unexpected WASM size: ${wasmSize}`);
const javascriptSize = (await Promise.all(javascriptNames.map(async (name) => (await stat(path.join(dist, 'assets', name))).size))).reduce((sum, size) => sum + size, 0);
const stylesheetSize = (await Promise.all(stylesheetNames.map(async (name) => (await stat(path.join(dist, 'assets', name))).size))).reduce((sum, size) => sum + size, 0);
assert.ok(javascriptSize < 700_000, `JavaScript budget exceeded: ${javascriptSize}`);
assert.ok(stylesheetSize < 250_000, `stylesheet budget exceeded: ${stylesheetSize}`);

const soundFontSize = (await stat(path.join(dist, 'soundfonts', 'generaluser-gs.sf2'))).size;
const soundFontLicenseSize = (await stat(path.join(dist, 'soundfonts', 'GENERALUSER-GS-LICENSE.txt'))).size;
const synthProcessorSize = (await stat(path.join(dist, 'spessasynth', 'spessasynth_processor.min.js'))).size;
assert.ok(soundFontSize > 20_000_000 && soundFontSize < 40_000_000, `SoundFont is missing or unexpectedly sized: ${soundFontSize}`);
assert.ok(soundFontLicenseSize > 1_000, 'SoundFont license is missing');
assert.ok(synthProcessorSize > 100_000, `synth processor is missing or unexpectedly small: ${synthProcessorSize}`);
const globalHeaders = vercel.headers.find((rule) => rule.source === '/(.*)')?.headers ?? [];
const contentSecurityPolicy = globalHeaders.find((header) => header.key === 'Content-Security-Policy')?.value ?? '';
assert.match(contentSecurityPolicy, /'wasm-unsafe-eval'/, 'CSP must allow browser WASM compilation');
assert.match(contentSecurityPolicy, /worker-src 'self'/, 'CSP must allow the converter worker');
assert.match(contentSecurityPolicy, /object-src 'none'/, 'CSP must disable plugins');
assert.ok(globalHeaders.some((header) => header.key === 'X-Content-Type-Options' && header.value === 'nosniff'));

console.log(
  `Static web build verified: JS ${javascriptSize} bytes, CSS ${stylesheetSize} bytes, WASM ${wasmSize} bytes, SoundFont ${soundFontSize} bytes, synth processor ${synthProcessorSize} bytes.`,
);
