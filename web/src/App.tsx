import { useEffect, useState } from 'react';
import { getSetup, type Dep } from './api';
import { Projects } from './pages/Projects';
import { Project } from './pages/Project';
import { Settings } from './pages/Settings';
import { Setup } from './pages/Setup';

function useHash() {
  const [h, setH] = useState(location.hash || '#/');
  useEffect(() => {
    const f = () => setH(location.hash || '#/');
    addEventListener('hashchange', f);
    return () => removeEventListener('hashchange', f);
  }, []);
  return h;
}

export function App() {
  const hash = useHash();
  const [deps, setDeps] = useState<Dep[]>([]);
  useEffect(() => { getSetup().then(setDeps).catch(() => {}); }, [hash === '#/setup']);
  const missing = deps.filter((d) => !d.ok && d.name !== 'ollama');
  const [, , page, id] = hash.split('/');

  return (
    <>
      <header>
        <a className="brand" href="#/">▶ ViralClips</a>
        <nav>
          <a href="#/" className={!page ? 'on' : ''}>Projects</a>
          <a href="#/settings" className={page === 'settings' ? 'on' : ''}>Settings</a>
          <a href="#/setup" className={page === 'setup' ? 'on' : ''}>Setup{missing.length ? ` (${missing.length})` : ''}</a>
        </nav>
      </header>
      {missing.length > 0 && page !== 'setup' && (
        <div className="banner warn">
          Missing: {missing.map((d) => d.name).join(', ')}. <a href="#/setup">See how to fix</a>
        </div>
      )}
      <main>
        {page === 'settings' ? <Settings /> : page === 'setup' ? <Setup deps={deps} /> :
          page === 'p' && id ? <Project id={id} key={id} /> : <Projects />}
      </main>
    </>
  );
}
