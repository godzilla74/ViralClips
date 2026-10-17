import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Clip, Project, Transcript } from './types.js';

export type Db = Database.Database;

export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, video_path TEXT NOT NULL,
      duration REAL NOT NULL, status TEXT NOT NULL DEFAULT 'new', error TEXT,
      transcript TEXT, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS clips (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      start REAL NOT NULL, end REAL NOT NULL, title TEXT NOT NULL,
      score REAL NOT NULL, reason TEXT NOT NULL, selected INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS exports (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      path TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL
    );
  `);
  db.pragma('foreign_keys = ON');
  return db;
}

const toProject = (r: any): Project => ({
  id: r.id, name: r.name, videoPath: r.video_path, duration: r.duration,
  status: r.status, ...(r.error ? { error: r.error } : {}),
});
const toClip = (r: any): Clip => ({
  id: r.id, projectId: r.project_id, start: r.start, end: r.end, title: r.title,
  score: r.score, reason: r.reason, selected: !!r.selected,
});

export function createProject(db: Db, p: { name: string; videoPath: string; duration: number }): Project {
  const id = randomUUID();
  db.prepare('INSERT INTO projects (id,name,video_path,duration,created_at) VALUES (?,?,?,?,?)')
    .run(id, p.name, p.videoPath, p.duration, Date.now());
  return getProject(db, id)!;
}
export const getProject = (db: Db, id: string): Project | undefined => {
  const r = db.prepare('SELECT * FROM projects WHERE id=?').get(id);
  return r ? toProject(r) : undefined;
};
export const listProjects = (db: Db): Project[] =>
  db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all().map(toProject);
export const deleteProject = (db: Db, id: string) => db.prepare('DELETE FROM projects WHERE id=?').run(id);

export function setProjectStatus(db: Db, id: string, status: Project['status'], error?: string) {
  db.prepare('UPDATE projects SET status=?, error=? WHERE id=?').run(status, error ?? null, id);
}
export function saveTranscript(db: Db, id: string, t: Transcript) {
  db.prepare('UPDATE projects SET transcript=? WHERE id=?').run(JSON.stringify(t), id);
}
export function getTranscript(db: Db, id: string): Transcript | null {
  const r = db.prepare('SELECT transcript FROM projects WHERE id=?').get(id) as any;
  return r?.transcript ? JSON.parse(r.transcript) : null;
}

export function replaceClips(db: Db, projectId: string, clips: Omit<Clip, 'id' | 'projectId'>[]) {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM clips WHERE project_id=?').run(projectId);
    const ins = db.prepare('INSERT INTO clips VALUES (?,?,?,?,?,?,?,?)');
    for (const c of clips)
      ins.run(randomUUID(), projectId, c.start, c.end, c.title, c.score, c.reason, c.selected ? 1 : 0);
  });
  tx();
}
export const listClips = (db: Db, projectId: string): Clip[] =>
  db.prepare('SELECT * FROM clips WHERE project_id=? ORDER BY score DESC').all(projectId).map(toClip);
export const getClip = (db: Db, id: string): Clip | undefined => {
  const r = db.prepare('SELECT * FROM clips WHERE id=?').get(id);
  return r ? toClip(r) : undefined;
};
export function updateClip(db: Db, id: string, patch: Partial<Pick<Clip, 'start' | 'end' | 'title' | 'selected'>>) {
  const cur = getClip(db, id);
  if (!cur) return;
  const n = { ...cur, ...patch };
  db.prepare('UPDATE clips SET start=?,end=?,title=?,selected=? WHERE id=?')
    .run(n.start, n.end, n.title, n.selected ? 1 : 0, id);
}

/** Projects left mid-job by a crash/restart can never finish; surface them as errors. */
export function resetInterrupted(db: Db) {
  db.prepare("UPDATE projects SET status='error', error=? WHERE status IN ('transcribing','analyzing')")
    .run('Interrupted by a restart — click “Find best clips” to run again');
}

export function addExport(db: Db, projectId: string, path: string) {
  db.prepare('INSERT INTO exports VALUES (?,?,?,?) ON CONFLICT(path) DO UPDATE SET created_at=excluded.created_at')
    .run(randomUUID(), projectId, path, Date.now());
}
export const listExportPaths = (db: Db, projectId: string): string[] =>
  (db.prepare('SELECT path FROM exports WHERE project_id=? ORDER BY created_at DESC').all(projectId) as { path: string }[]).map((r) => r.path);
