'use client';

const components = [
  { name: 'Web client', detail: 'React · 42 files', tone: 'cyan' },
  { name: 'API layer', detail: 'FastAPI · 13 routes', tone: 'violet' },
  { name: 'Services', detail: '16 modules', tone: 'amber' },
  { name: 'PostgreSQL', detail: '11 models', tone: 'green' },
];

export default function Home() {
  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" aria-label="RepoDNA home">
          <span className="brand-mark">R</span>
          <span>RepoDNA</span>
          <span className="version">LOCAL</span>
        </a>
        <div className="repo-pill"><span className="status-dot" /> acme / pulse-api</div>
        <button className="analyse-button" type="button">Analyse repository</button>
      </header>

      <aside className="sidebar">
        <p className="eyebrow">Workspace</p>
        {['Overview', 'Architecture', 'Routes', 'Dependencies', 'Files'].map((item, index) => (
          <button className={`nav-item ${index === 1 ? 'active' : ''}`} key={item} type="button">
            <span className="nav-index">0{index + 1}</span>{item}
          </button>
        ))}
        <div className="privacy-card">
          <span className="shield">◆</span>
          <div><strong>Local by design</strong><p>Your source never leaves this machine.</p></div>
        </div>
      </aside>

      <section className="workspace">
        <div className="workspace-heading">
          <div>
            <p className="eyebrow cyan-text">Architecture map</p>
            <h1>See how the system<br />actually works.</h1>
          </div>
          <div className="summary">
            <span><strong>147</strong> source files</span>
            <span><strong>18.4k</strong> lines indexed</span>
            <span><strong>94%</strong> parsed</span>
          </div>
        </div>

        <div className="graph-stage" aria-label="Repository architecture graph">
          <div className="graph-grid" />
          <div className="flow-row">
            {components.map((component, index) => (
              <div className="flow-item" key={component.name}>
                <button className={`node ${component.tone}`} type="button">
                  <span className="node-type">{index === 3 ? 'DATA' : `LAYER 0${index + 1}`}</span>
                  <strong>{component.name}</strong>
                  <span>{component.detail}</span>
                  <i>{index === 0 ? '03' : index === 1 ? '08' : index === 2 ? '12' : '04'} links</i>
                </button>
                {index < components.length - 1 && <span className="connector">→</span>}
              </div>
            ))}
          </div>
          <div className="graph-caption">
            <span>Request path</span>
            <p>Browser request → API router → business logic → persistence</p>
          </div>
        </div>
      </section>

      <aside className="detail-panel">
        <p className="eyebrow">Selected component</p>
        <div className="detail-icon">A</div>
        <h2>API layer</h2>
        <p className="muted">HTTP boundaries and request handlers discovered from framework evidence.</p>
        <dl>
          <div><dt>Framework</dt><dd>FastAPI</dd></div>
          <div><dt>Confidence</dt><dd className="good">96%</dd></div>
          <div><dt>Files</dt><dd>8</dd></div>
          <div><dt>Routes</dt><dd>13</dd></div>
        </dl>
        <p className="eyebrow section-label">Evidence</p>
        <ul className="evidence-list">
          <li>FastAPI application instance</li>
          <li>8 registered route handlers</li>
          <li>Imports service modules</li>
        </ul>
        <button className="trace-button" type="button">Trace this component <span>↗</span></button>
      </aside>
    </main>
  );
}
