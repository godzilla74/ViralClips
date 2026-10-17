#!/usr/bin/env node
// ViralClips setup: checks and (with your permission) installs everything the app needs.
//   node scripts/setup.mjs            interactive: asks before each install
//   node scripts/setup.mjs --check    only report what is missing
//   node scripts/setup.mjs --yes      install without asking (no prompts; sudo may still ask for your password)
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { arch, platform as osPlatform, totalmem } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import {
  WHISPER_MODEL, downloadFile, findBinary, hasUsableModel, installPlan, nodeVersionOk, pickWhisperWindowsAsset, recommendOllamaModel,
} from './setup-lib.mjs';

const args = new Set(process.argv.slice(2));
const CHECK = args.has('--check');
const YES = args.has('--yes') || args.has('-y');
const platform = osPlatform();
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DATA = process.env.VC_DATA ?? join(ROOT, 'data');
const exe = platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli';

const green = (s) => `\x1b[32m${s}\x1b[0m`, red = (s) => `\x1b[31m${s}\x1b[0m`, dim = (s) => `\x1b[2m${s}\x1b[0m`, bold = (s) => `\x1b[1m${s}\x1b[0m`;
const say = (s = '') => console.log(s);
const results = [];
const record = (name, ok, required, detail = '') => {
  results.push({ name, ok, required });
  say(`${ok ? green('✓') : red('✗')} ${bold(name)}${detail ? dim(`  ${detail}`) : ''}`);
};

const succeeds = (cmd, a = ['--version']) => spawnSync(cmd, a, { stdio: 'ignore', timeout: 8000 }).status === 0;
const exists = (cmd) => spawnSync(platform === 'win32' ? 'where' : 'which', [cmd], { stdio: 'ignore' }).status === 0;
const run = (cmd, a, opts = {}) => spawnSync(cmd, a, { stdio: 'inherit', shell: platform === 'win32' && cmd === 'npm', ...opts }).status === 0;

async function confirm(question) {
  if (YES) return true;
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const a = (await rl.question(`${question} [Y/n] `)).trim();
  rl.close();
  return a === '' || /^y(es)?$/i.test(a);
}

const have = Object.fromEntries(['brew', 'winget', 'choco', 'apt-get', 'dnf', 'pacman', 'git', 'cmake', 'g++', 'cc', 'gcc'].map((c) => [c, exists(c)]));
const ctx = { platform, arch: arch(), have };

async function whisperFromRelease() {
  const rel = await (await fetch('https://api.github.com/repos/ggml-org/whisper.cpp/releases/latest', { headers: { 'user-agent': 'viralclips-setup' } })).json();
  const asset = pickWhisperWindowsAsset(rel, arch());
  if (!asset) throw new Error('Could not find a Windows build in the latest whisper.cpp release. Download one manually from https://github.com/ggml-org/whisper.cpp/releases into data/bin');
  const zip = join(DATA, 'tmp', asset.name);
  say(`Downloading ${asset.name}…`);
  await downloadFile(asset.url, zip, progress);
  mkdirSync(join(DATA, 'bin'), { recursive: true });
  const ok = run('tar', ['-xf', zip, '-C', join(DATA, 'bin')]); // bsdtar ships with Windows 10+
  rmSync(zip, { force: true });
  if (!ok) throw new Error('Could not extract the download (tar failed). Extract it into data/bin yourself.');
}

function buildWhisper() {
  const src = join(DATA, 'src', 'whisper.cpp');
  mkdirSync(join(DATA, 'src'), { recursive: true });
  if (!existsSync(src) && !run('git', ['clone', '--depth', '1', 'https://github.com/ggml-org/whisper.cpp', src])) throw new Error('git clone failed');
  if (!run('cmake', ['-B', 'build', '-DCMAKE_BUILD_TYPE=Release'], { cwd: src })) throw new Error('cmake configure failed');
  if (!run('cmake', ['--build', 'build', '-j', '--config', 'Release'], { cwd: src })) throw new Error('cmake build failed');
  const out = join(src, 'build', 'bin');
  mkdirSync(join(DATA, 'bin'), { recursive: true });
  for (const f of readdirSync(out)) if (statSync(join(out, f)).isFile()) copyFileSync(join(out, f), join(DATA, 'bin', f));
}

let lastPct = -1;
const progress = (pct) => {
  if (pct !== lastPct) { process.stdout.write(`\r  ${pct}%   `); lastPct = pct; }
  if (pct === 100) process.stdout.write('\n');
};

/** Offers the install plan for a tool; returns true if something ran successfully. */
async function applyPlan(tool, label) {
  const plan = installPlan(tool, ctx);
  if (plan.kind === 'manual') { say(`  ${plan.text}`); return false; }
  if (CHECK) { say(dim(`  Fix: run \`npm run setup\``)); return false; }
  const what = plan.kind === 'command' ? `${plan.cmd} ${plan.args.join(' ')}`
    : plan.kind === 'download-whisper' ? 'download the official whisper.cpp Windows build into data/bin'
    : 'build whisper.cpp from source into data/bin (needs a few minutes)';
  if (!(await confirm(`  Install ${label}? → ${what}${plan.kind === 'command' && plan.sudo ? ' (asks for your sudo password)' : ''}`))) {
    say(dim('  Skipped.')); return false;
  }
  try {
    if (plan.kind === 'command') { if (!run(plan.cmd, plan.args)) throw new Error(`${plan.cmd} failed`); if (plan.note) say(`  ${plan.note}`); }
    else if (plan.kind === 'download-whisper') await whisperFromRelease();
    else buildWhisper();
    return true;
  } catch (e) {
    say(red(`  ${e.message}`));
    return false;
  }
}

const whisperPath = () => {
  if (process.env.VC_WHISPER && existsSync(process.env.VC_WHISPER)) return process.env.VC_WHISPER;
  return findBinary(join(DATA, 'bin'), exe) ?? (succeeds('whisper-cli', ['--help']) ? 'whisper-cli' : null);
};

async function main() {
  say(bold('\nViralClips setup') + dim(`  (${platform}/${arch()}${CHECK ? ', check only' : ''})\n`));

  // 1. Node
  if (!nodeVersionOk(process.version)) {
    record('Node.js 22+', false, true, `found ${process.version}`);
    say('  Install Node 22 LTS: https://nodejs.org  (Windows: `winget install OpenJS.NodeJS.LTS`, macOS: `brew install node@22`)');
    return finish();
  }
  record('Node.js 22+', true, true, process.version);

  // 2. npm packages
  if (existsSync(join(ROOT, 'node_modules'))) record('npm packages', true, true);
  else if (!CHECK && (await confirm('npm packages are not installed. Run `npm install`?')) && run('npm', ['install'], { cwd: ROOT })) record('npm packages', true, true, 'installed');
  else record('npm packages', false, true, 'run `npm install`');

  // 3. ffmpeg
  const ffOk = () => succeeds('ffmpeg', ['-version']) && succeeds('ffprobe', ['-version']);
  if (!ffOk()) { say(dim('ffmpeg not found.')); await applyPlan('ffmpeg', 'ffmpeg'); }
  record('ffmpeg + ffprobe', ffOk(), true, ffOk() ? '' : 'not found on PATH (after installing, open a new terminal and re-run)');

  // 4. whisper.cpp
  if (!whisperPath()) { say(dim('whisper.cpp not found.')); await applyPlan('whisper', 'whisper.cpp'); }
  const w = whisperPath();
  record('whisper.cpp (whisper-cli)', !!w, true, w ?? 'not found');

  // 5. whisper model
  const modelPath = join(DATA, 'models', WHISPER_MODEL.name);
  const modelOk = () => existsSync(modelPath) && statSync(modelPath).size >= WHISPER_MODEL.minBytes;
  if (!modelOk()) {
    say(dim('Whisper speech model not found.'));
    if (CHECK) say(dim('  Fix: run `npm run setup` (downloads ~470 MB)'));
    else if (await confirm(`  Download the speech model (~470 MB) to ${modelPath}?`)) {
      try { await downloadFile(WHISPER_MODEL.url, modelPath, progress); } catch (e) { say(red(`  ${e.message}`)); }
    } else say(dim('  Skipped.'));
  }
  record('Whisper speech model', modelOk(), true, modelOk() ? WHISPER_MODEL.name : 'missing');

  // 6. Ollama (optional: OpenAI can be used instead)
  const tags = async () => fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(2000) }).then((r) => r.json()).catch(() => null);
  let t = await tags();
  if (!t && !succeeds('ollama')) {
    say(`${dim('•')} ${bold('Ollama')} ${dim('(optional — skip it if you will use an OpenAI API key instead)')}`);
    if (await applyPlan('ollama', 'Ollama')) t = await tags();
  }
  if (!t) {
    record('Ollama', false, false, succeeds('ollama') ? 'installed but not running — open the Ollama app or run `ollama serve`' : 'not installed (optional)');
  } else {
    const names = (t.models ?? []).map((m) => m.name);
    if (hasUsableModel(names)) record('Ollama + a text model', true, false, names.filter((n) => hasUsableModel([n])).join(', '));
    else {
      const rec = recommendOllamaModel(totalmem());
      say(dim('No plain text model found in Ollama (reasoning/vision models fail at clip-finding).'));
      if (!CHECK && (await confirm(`  Pull ${rec.name} (${rec.size}) — sized for your ${(totalmem() / 1024 ** 3).toFixed(0)} GB of RAM?`))) run('ollama', ['pull', rec.name]);
      const after = await tags();
      record('Ollama + a text model', hasUsableModel((after?.models ?? []).map((m) => m.name)), false, `recommended: ${rec.name}`);
    }
  }
  finish();
}

function finish() {
  const missing = results.filter((r) => r.required && !r.ok);
  say();
  if (missing.length) {
    say(red(`Still needed: ${missing.map((m) => m.name).join(', ')}.`) + ' Fix those, then run `npm run setup` again.');
    process.exitCode = 1;
  } else {
    say(green('All set!') + ' Start the app with:  ' + bold('npm run dev') + '   then open http://localhost:5173');
  }
}

main().catch((e) => { console.error(red(`Setup failed: ${e.message}`)); process.exit(1); });
