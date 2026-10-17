import { execFile } from 'node:child_process';

/** Native macOS file chooser. System Events is activated so the dialog comes to the front. */
export const PICK_SCRIPT = `tell application "System Events" to activate
set f to choose file with prompt "Choose a video for ViralClips" of type {"public.movie", "public.mpeg-4", "com.apple.quicktime-movie"}
POSIX path of f`;

export const PICK_FOLDER_SCRIPT = `tell application "System Events" to activate
set f to choose folder with prompt "Choose where to save exported clips"
POSIX path of f`;

export type Runner = () => Promise<{ stdout: string }>;

const osascript = (script: string): Runner => () =>
  new Promise((resolve, reject) =>
    execFile('osascript', ['-e', script], { timeout: 10 * 60_000 }, (err, stdout, stderr) =>
      err ? reject(Object.assign(err, { stderr })) : resolve({ stdout })));

/** Returns the chosen absolute path, or null if the user cancelled. */
export async function pickVideoFile(run: Runner = osascript(PICK_SCRIPT)): Promise<string | null> {
  try {
    const { stdout } = await run();
    return stdout.trim() || null;
  } catch (e) {
    if (String((e as { stderr?: string }).stderr ?? '').includes('-128')) return null; // user canceled
    throw new Error('Could not open the file chooser. Paste the file path instead.');
  }
}

/** Returns the chosen absolute folder (no trailing slash), or null if the user cancelled. */
export async function pickFolder(run: Runner = osascript(PICK_FOLDER_SCRIPT)): Promise<string | null> {
  try {
    const { stdout } = await run();
    const p = stdout.trim().replace(/(.)\/+$/, '$1');
    return p || null;
  } catch (e) {
    if (String((e as { stderr?: string }).stderr ?? '').includes('-128')) return null;
    throw new Error('Could not open the folder chooser. Type the folder path instead.');
  }
}
