import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { posix } from 'node:path';

export type Platform = NodeJS.Platform;
export interface Cmd { cmd: string; args: string[] }
export type Runner = (c: Cmd) => Promise<{ stdout: string }>;
export type PickKind = 'file' | 'folder';

const VIDEO_EXTS = ['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v', 'mpg', 'mpeg'];

export const MAC_PICK_FILE = `tell application "System Events" to activate
set f to choose file with prompt "Choose a video for ViralClips" of type {"public.movie", "public.mpeg-4", "com.apple.quicktime-movie"}
POSIX path of f`;
export const MAC_PICK_FOLDER = `tell application "System Events" to activate
set f to choose folder with prompt "Choose where to save exported clips"
POSIX path of f`;

/** One-line PowerShell script; a TopMost owner form keeps the dialog in front. */
const psScript = (kind: PickKind) =>
  [
    '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8',
    'Add-Type -AssemblyName System.Windows.Forms',
    '$o=New-Object System.Windows.Forms.Form -Property @{TopMost=$true}',
    kind === 'file'
      ? `$d=New-Object System.Windows.Forms.OpenFileDialog;$d.Title='Choose a video for ViralClips';$d.Filter='Video files|${VIDEO_EXTS.map((e) => `*.${e}`).join(';')}|All files|*.*'`
      : "$d=New-Object System.Windows.Forms.FolderBrowserDialog;$d.Description='Choose where to save exported clips'",
    kind === 'file'
      ? 'if($d.ShowDialog($o) -eq [System.Windows.Forms.DialogResult]::OK){$d.FileName}'
      : 'if($d.ShowDialog($o) -eq [System.Windows.Forms.DialogResult]::OK){$d.SelectedPath}',
  ].join(';');

/** Candidate commands for the platform's native chooser, tried in order. */
export function pickerCommands(platform: Platform, kind: PickKind): Cmd[] {
  if (platform === 'darwin') return [{ cmd: 'osascript', args: ['-e', kind === 'file' ? MAC_PICK_FILE : MAC_PICK_FOLDER] }];
  if (platform === 'win32') {
    return [{ cmd: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-STA', '-Command', psScript(kind)] }];
  }
  const exts = VIDEO_EXTS.map((e) => `*.${e}`).join(' ');
  return [
    {
      cmd: 'zenity',
      args: kind === 'file'
        ? ['--file-selection', '--title=Choose a video for ViralClips', `--file-filter=Video files | ${exts}`]
        : ['--file-selection', '--directory', '--title=Choose where to save exported clips'],
    },
    {
      cmd: 'kdialog',
      args: kind === 'file'
        ? ['--getopenfilename', homedir(), `Video files (${exts})`]
        : ['--getexistingdirectory', homedir()],
    },
  ];
}

/** Strips trailing separators but keeps filesystem roots ("/", "C:\"). */
export function cleanDir(p: string): string {
  if (/^[A-Za-z]:[\\/]*$/.test(p)) return `${p.slice(0, 2)}\\`;
  return p.replace(/(.)[\\/]+$/, '$1');
}

export const execRunner: Runner = ({ cmd, args }) =>
  new Promise((resolve, reject) =>
    execFile(cmd, args, { timeout: 10 * 60_000 }, (err, stdout, stderr) =>
      err ? reject(Object.assign(err, { stderr })) : resolve({ stdout })));

export function revealCommand(platform: Platform, path: string): Cmd {
  if (platform === 'darwin') return { cmd: 'open', args: ['-R', path] };
  if (platform === 'win32') return { cmd: 'explorer.exe', args: [`/select,${path}`] };
  return { cmd: 'xdg-open', args: [posix.dirname(path)] }; // Linux file managers can't select a file portably
}

export async function revealPath(path: string, platform: Platform = process.platform, run: Runner = execRunner): Promise<void> {
  try {
    await run(revealCommand(platform, path));
  } catch (e) {
    if (platform === 'win32') return; // explorer.exe exits 1 even when it worked
    throw e;
  }
}
