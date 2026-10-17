import { describe, it, expect } from 'vitest';
import { pickerCommands, revealCommand, cleanDir, type Cmd } from '../src/platform.js';
import { pickVideoFile, pickFolder } from '../src/picker.js';
import { revealPath } from '../src/platform.js';

const bin = (c: Cmd) => c.cmd;

describe('pickerCommands', () => {
  it('macOS uses osascript, Windows uses an STA PowerShell Forms dialog, Linux tries zenity then kdialog', () => {
    expect(pickerCommands('darwin', 'file').map(bin)).toEqual(['osascript']);
    const win = pickerCommands('win32', 'file');
    expect(win.map(bin)).toEqual(['powershell.exe']);
    expect(win[0].args).toContain('-STA');
    expect(win[0].args.join(' ')).toContain('System.Windows.Forms');
    expect(win[0].args.join(' ')).toContain('OpenFileDialog');
    expect(pickerCommands('win32', 'folder')[0].args.join(' ')).toContain('FolderBrowserDialog');
    expect(pickerCommands('linux', 'file').map(bin)).toEqual(['zenity', 'kdialog']);
    expect(pickerCommands('linux', 'folder')[0].args).toContain('--directory');
  });
});

describe('cleanDir', () => {
  it('strips trailing separators but keeps roots', () => {
    expect(cleanDir('/Users/me/Shorts/')).toBe('/Users/me/Shorts');
    expect(cleanDir('/')).toBe('/');
    expect(cleanDir('C:\\Users\\me\\Shorts\\')).toBe('C:\\Users\\me\\Shorts');
    expect(cleanDir('C:\\')).toBe('C:\\');
    expect(cleanDir('D:')).toBe('D:\\');
  });
});

const fail = (code: number | string, stderr = '') => async () => { throw Object.assign(new Error('x'), { code, stderr }); };

describe('picking per platform', () => {
  it('returns the trimmed path (spaces, unicode, Windows backslashes)', async () => {
    expect(await pickVideoFile(async () => ({ stdout: '/Users/me/My Movies/café.mp4\n' }), 'darwin')).toBe('/Users/me/My Movies/café.mp4');
    expect(await pickVideoFile(async () => ({ stdout: 'C:\\Users\\me\\Videos\\clip é.mp4\r\n' }), 'win32')).toBe('C:\\Users\\me\\Videos\\clip é.mp4');
    expect(await pickFolder(async () => ({ stdout: 'C:\\Users\\me\\Shorts\\\r\n' }), 'win32')).toBe('C:\\Users\\me\\Shorts');
  });
  it('cancel gives null on every platform', async () => {
    expect(await pickVideoFile(fail(1, 'User canceled. (-128)'), 'darwin')).toBeNull();
    expect(await pickVideoFile(async () => ({ stdout: '\r\n' }), 'win32')).toBeNull(); // PowerShell prints nothing on cancel
    expect(await pickVideoFile(fail(1), 'linux')).toBeNull(); // zenity/kdialog exit 1
  });
  it('linux falls back from zenity to kdialog, and explains when neither is installed', async () => {
    const tried: string[] = [];
    const run = async (c: Cmd) => {
      tried.push(c.cmd);
      if (c.cmd === 'zenity') throw Object.assign(new Error('nf'), { code: 'ENOENT' });
      return { stdout: '/home/me/v.mp4\n' };
    };
    expect(await pickVideoFile(run, 'linux')).toBe('/home/me/v.mp4');
    expect(tried).toEqual(['zenity', 'kdialog']);
    await expect(pickVideoFile(fail('ENOENT'), 'linux')).rejects.toThrow(/zenity|kdialog/);
  });
  it('other failures give a readable error', async () => {
    await expect(pickVideoFile(fail(2, 'boom'), 'darwin')).rejects.toThrow(/file chooser/i);
  });
});

describe('revealCommand / revealPath', () => {
  it('builds the right command per platform', () => {
    expect(revealCommand('darwin', '/a/b.mp4')).toEqual({ cmd: 'open', args: ['-R', '/a/b.mp4'] });
    expect(revealCommand('win32', 'C:\\a\\b.mp4')).toEqual({ cmd: 'explorer.exe', args: ['/select,C:\\a\\b.mp4'] });
    expect(revealCommand('linux', '/a/b.mp4')).toEqual({ cmd: 'xdg-open', args: ['/a'] });
  });
  it('ignores explorer.exe non-zero exit codes (it returns 1 even on success)', async () => {
    await expect(revealPath('C:\\a\\b.mp4', 'win32', fail(1))).resolves.toBeUndefined();
    await expect(revealPath('/a/b.mp4', 'darwin', fail(1))).rejects.toThrow();
  });
});
