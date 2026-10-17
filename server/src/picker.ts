import { cleanDir, execRunner, pickerCommands, type PickKind, type Platform, type Runner } from './platform.js';

export { MAC_PICK_FILE as PICK_SCRIPT, MAC_PICK_FOLDER as PICK_FOLDER_SCRIPT } from './platform.js';
export type { Runner } from './platform.js';

async function pick(kind: PickKind, run: Runner, platform: Platform): Promise<string | null> {
  const what = kind === 'file' ? 'file' : 'folder';
  let missing = 0;
  const cmds = pickerCommands(platform, kind);
  for (const c of cmds) {
    try {
      const { stdout } = await run(c);
      const p = stdout.trim();
      return p ? (kind === 'folder' ? cleanDir(p) : p) : null; // no output = cancelled (Windows)
    } catch (e) {
      const { code, stderr } = e as { code?: number | string; stderr?: string };
      if (code === 'ENOENT') { missing++; continue; } // chooser not installed: try the next one
      if (String(stderr ?? '').includes('-128')) return null; // macOS: user cancelled
      if (platform === 'linux' && code === 1) return null; // zenity/kdialog: cancelled
      throw new Error(`Could not open the ${what} chooser. ${kind === 'file' ? 'Paste the file path instead.' : 'Type the folder path instead.'}`);
    }
  }
  if (missing === cmds.length) {
    throw new Error(`No ${what} chooser found. Install zenity (or kdialog), or ${kind === 'file' ? 'paste the file path' : 'type the folder path'} instead.`);
  }
  return null;
}

/** Returns the chosen absolute path, or null if the user cancelled. */
export const pickVideoFile = (run: Runner = execRunner, platform: Platform = process.platform) => pick('file', run, platform);
/** Returns the chosen absolute folder (no trailing separator), or null if the user cancelled. */
export const pickFolder = (run: Runner = execRunner, platform: Platform = process.platform) => pick('folder', run, platform);
