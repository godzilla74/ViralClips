// Pure helpers for scripts/setup.mjs (kept dependency-free so setup runs before `npm install`).
import { createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const WHISPER_MODEL = {
  name: 'ggml-small.en.bin',
  url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin',
  minBytes: 450_000_000,
};

export function nodeVersionOk(version, min = 22) {
  const m = /^v?(\d+)\./.exec(version);
  return !!m && Number(m[1]) >= min;
}

const manual = (text) => ({ kind: 'manual', text });
const cmd = (label, c, args, extra = {}) => ({ kind: 'command', label, cmd: c, args, ...extra });

/** What to do to get `tool` ('ffmpeg' | 'whisper' | 'ollama') on this system. `have` maps command names to booleans. */
export function installPlan(tool, { platform, have }) {
  if (tool === 'ffmpeg') {
    if (platform === 'darwin') {
      return have.brew ? cmd('Install ffmpeg with Homebrew', 'brew', ['install', 'ffmpeg'])
        : manual('Install Homebrew from https://brew.sh, then run: brew install ffmpeg');
    }
    if (platform === 'win32') {
      if (have.winget) {
        return cmd('Install ffmpeg with winget', 'winget',
          ['install', '-e', '--id', 'Gyan.FFmpeg', '--accept-source-agreements', '--accept-package-agreements'],
          { note: 'Open a NEW terminal afterwards so ffmpeg is on your PATH, then run `npm run setup` again.' });
      }
      return manual('Install ffmpeg from https://www.gyan.dev/ffmpeg/builds/ (or `choco install ffmpeg`), make sure it is on your PATH, then run `npm run setup` again.');
    }
    if (have['apt-get']) return cmd('Install ffmpeg with apt', 'sudo', ['apt-get', 'install', '-y', 'ffmpeg'], { sudo: true });
    if (have.dnf) return cmd('Install ffmpeg with dnf', 'sudo', ['dnf', 'install', '-y', 'ffmpeg'], { sudo: true, note: 'On Fedora you may need the RPM Fusion repository enabled for ffmpeg.' });
    if (have.pacman) return cmd('Install ffmpeg with pacman', 'sudo', ['pacman', '-S', '--noconfirm', 'ffmpeg'], { sudo: true });
    return manual('Install ffmpeg with your distribution\'s package manager, then run `npm run setup` again.');
  }
  if (tool === 'whisper') {
    if (platform === 'darwin') {
      return have.brew ? cmd('Install whisper.cpp with Homebrew', 'brew', ['install', 'whisper-cpp'])
        : manual('Install Homebrew from https://brew.sh, then run: brew install whisper-cpp');
    }
    if (platform === 'win32') return { kind: 'download-whisper' };
    if (have.brew) return cmd('Install whisper.cpp with Homebrew', 'brew', ['install', 'whisper-cpp']);
    if (have.git && have.cmake && (have['g++'] || have.cc || have.gcc)) return { kind: 'build-whisper' };
    return manual('whisper.cpp has to be built from source on Linux. Install git, cmake and a C++ compiler (e.g. `sudo apt install git cmake build-essential`), then run `npm run setup` again.');
  }
  if (tool === 'ollama') {
    if (platform === 'darwin' && have.brew) return cmd('Install Ollama with Homebrew', 'brew', ['install', '--cask', 'ollama']);
    if (platform === 'win32' && have.winget) return cmd('Install Ollama with winget', 'winget', ['install', '-e', '--id', 'Ollama.Ollama', '--accept-source-agreements', '--accept-package-agreements']);
    return manual('Install Ollama from https://ollama.com/download, start it, then run `npm run setup` again.');
  }
  throw new Error(`unknown tool ${tool}`);
}

/** The plain CPU Windows build of whisper.cpp from a GitHub release JSON. */
export function pickWhisperWindowsAsset(release, arch) {
  const want = arch === 'ia32' ? 'whisper-bin-Win32.zip' : 'whisper-bin-x64.zip'; // arm64 Windows runs x64 builds
  const a = (release?.assets ?? []).find((x) => x.name === want);
  return a ? { name: a.name, url: a.browser_download_url } : null;
}

export function recommendOllamaModel(totalMemBytes) {
  const gb = totalMemBytes / 1024 ** 3;
  if (gb >= 14) return { name: 'qwen2.5:14b', size: '~9 GB' };
  if (gb >= 7) return { name: 'llama3.1:8b', size: '~4.9 GB' };
  return { name: 'llama3.2:3b', size: '~2 GB' };
}

/** Plain text models are best for clip-finding; reasoning/vision/coder models misbehave. */
export function hasUsableModel(installed) {
  return installed.some((n) => /^(qwen2\.5|llama3\.[12]|gemma3|mistral|phi4)/.test(n) && !/coder|vl|vision|embed/.test(n));
}

/** Finds `name` under `dir`, a few levels deep (zip/build layouts vary). Mirrors server/src/deps.ts. */
export function findBinary(dir, name, depth = 3) {
  if (depth < 0 || !existsSync(dir)) return null;
  const entries = readdirSync(dir, { withFileTypes: true });
  const hit = entries.find((e) => e.isFile() && e.name === name);
  if (hit) return join(dir, hit.name);
  for (const e of entries) {
    if (e.isDirectory()) {
      const f = findBinary(join(dir, e.name), name, depth - 1);
      if (f) return f;
    }
  }
  return null;
}

/** Streams `url` to `dest` via a .part file; reports 0-100. Leaves nothing behind on failure. */
export async function downloadFile(url, dest, onProgress, fetchFn = fetch) {
  mkdirSync(dirname(dest), { recursive: true });
  const part = `${dest}.part`;
  try {
    const res = await fetchFn(url, { redirect: 'follow', headers: { 'user-agent': 'viralclips-setup' } });
    if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status} for ${url}`);
    const total = Number(res.headers.get('content-length') ?? 0);
    let got = 0;
    const src = Readable.fromWeb(res.body);
    src.on('data', (c) => { got += c.length; if (total) onProgress(Math.min(99, Math.floor((got / total) * 100))); });
    await pipeline(src, createWriteStream(part));
    if (total && got !== total) throw new Error(`Download incomplete (${got} of ${total} bytes)`);
    renameSync(part, dest);
    onProgress(100);
  } catch (e) {
    rmSync(part, { force: true });
    throw e;
  }
}
