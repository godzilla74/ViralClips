import { describe, it, expect } from 'vitest';
import { openDb, createProject, getProject, listProjects, saveTranscript, getTranscript,
  replaceClips, listClips, updateClip, setProjectStatus } from '../src/db.js';

describe('db', () => {
  it('round-trips project, transcript and clips', () => {
    const db = openDb(':memory:');
    const p = createProject(db, { name: 'a', videoPath: '/x.mp4', duration: 100 });
    expect(getProject(db, p.id)?.status).toBe('new');
    expect(listProjects(db)).toHaveLength(1);
    saveTranscript(db, p.id, { language: 'en', duration: 100, words: [{ text: 'hi', start: 0, end: 1 }] });
    expect(getTranscript(db, p.id)?.words[0].text).toBe('hi');
    replaceClips(db, p.id, [{ start: 1, end: 40, title: 't', score: 80, reason: 'r', selected: true }]);
    const [c] = listClips(db, p.id);
    expect(c.score).toBe(80);
    updateClip(db, c.id, { end: 50, selected: false });
    expect(listClips(db, p.id)[0]).toMatchObject({ end: 50, selected: false });
    setProjectStatus(db, p.id, 'error', 'boom');
    expect(getProject(db, p.id)).toMatchObject({ status: 'error', error: 'boom' });
  });
});
