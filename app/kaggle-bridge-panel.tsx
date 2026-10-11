'use client';

import { useEffect, useState } from 'react';

type Pipeline = {
  id: 'cinema' | 'voice' | 'musetalk';
  title: string;
  notebookUrl: string;
  model: string;
  purpose: string;
  expectedTypes: readonly string[];
  artifactHint: string;
};
type ImportedAsset = {
  id: string;
  pipeline: string;
  projectId: string;
  filename: string;
  sizeBytes: number;
  completedAt: string;
  downloadUrl: string;
};
type Catalog = {
  pipelines: Pipeline[];
  bridgeConfigured: boolean;
  liveNotebookExecution: boolean;
  message: string;
  configuration: { tokenConfigured: boolean; storageConfigured: boolean };
  build: { version: number; commit: string | null; uploaderUrl: string | null };
};

function notebookCell(pipeline: string, scriptUrl: string) {
  return [
    'import urllib.request',
    `urllib.request.urlretrieve("${scriptUrl}", "/kaggle/working/kaggle_upload.py")`,
    `%run /kaggle/working/kaggle_upload.py --pipeline ${pipeline} --scan --project mabrig-cinema --dry-run`,
  ].join('\n');
}

export function KaggleBridgePanel() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [ownerToken, setOwnerToken] = useState('');
  const [assets, setAssets] = useState<ImportedAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [copied, setCopied] = useState('');
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [pipelineFilter, setPipelineFilter] = useState('');
  const [diagnostic, setDiagnostic] = useState('');
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    fetch('/api/kaggle', { cache: 'no-store' })
      .then(async (response) => {
        if (response.status === 404) throw new Error('This deployment does not include the notebook bridge. Check the production release.');
        if (!response.ok) throw new Error('Kaggle integration unavailable.');
        const body = await response.json() as Catalog;
        if (body.build?.version !== 2 || !body.configuration) throw new Error('Notebook bridge version mismatch. Refresh after the release finishes.');
        setCatalog(body);
      })
      .catch((error) => setNotice(error instanceof Error ? error.message : 'Could not load Kaggle notebook registry.'));
  }, []);

  async function copyCell(pipeline: string) {
    if (!catalog?.build.uploaderUrl) {
      setNotice('This build has no verified source revision. Use the setup guide to select the reviewed uploader.');
      return;
    }
    try {
      await navigator.clipboard.writeText(notebookCell(pipeline, catalog.build.uploaderUrl));
      setCopied(pipeline);
      setNotice('Preview cell copied. Review the file list first; replace --dry-run with --consent only when ready to import.');
    } catch {
      setNotice('Clipboard access was blocked. Open the integration guide to copy the cell.');
    }
  }

  async function loadAssets(append = false) {
    if (!ownerToken.trim()) {
      setNotice('Enter the private owner token to load your imported files. It is not saved.');
      return;
    }
    setLoading(true);
    setNotice('');
    try {
      const query = new URLSearchParams({ action: 'assets' });
      if (pipelineFilter) query.set('pipeline', pipelineFilter);
      if (append && nextCursor) query.set('cursor', nextCursor);
      const response = await fetch(`/api/kaggle?${query}`, {
        cache: 'no-store',
        headers: { Authorization: `Bearer ${ownerToken.trim()}` },
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || 'Unable to load imported assets.');
      const incoming: ImportedAsset[] = Array.isArray(body.assets) ? body.assets : [];
      setAssets((current) => append ? [...new Map([...current, ...incoming].map(asset => [asset.id, asset])).values()] : incoming);
      setNextCursor(body.nextCursor || null);
      setNotice(body.assets?.length ? 'Private imported media loaded. Links expire after 10 minutes.' : 'No files on this page. Continue loading if more pages are available.');
    } catch (error) {
      if (!append) { setAssets([]); setNextCursor(null); }
      setNotice(error instanceof Error ? error.message : 'Unable to load media.');
    } finally {
      setLoading(false);
    }
  }

  async function checkStorage() {
    setChecking(true);
    setDiagnostic('');
    try {
      const response = await fetch('/api/kaggle?action=diagnostics', {
        cache: 'no-store', headers: { Authorization: `Bearer ${ownerToken.trim()}` },
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Storage check failed.');
      setDiagnostic(body.message);
    } catch (error) {
      setDiagnostic(error instanceof Error ? error.message : 'Storage check failed.');
    } finally { setChecking(false); }
  }

  return (
    <section className="output" id="kaggle-studio">
      <p className="eyebrow">KAGGLE → AI VIDEO</p>
      <h2>Three GPU notebooks. One creative workspace.</h2>
      <p>
        Create cinema shots, consented voice tracks and lip-synced performance in Kaggle,
        then import the finished files into private Cloudflare R2 storage. This bridge
        imports artifacts; it does not run a Kaggle GPU from your public website.
      </p>
      <div className="render">
        <b>{catalog?.bridgeConfigured ? '● Import settings present — test storage before importing' : '○ Artifact import needs owner setup'}</b>
        <span>
          Kaggle compute stays inside the user-operated notebook. R2 provides durable
          storage after a completed manual import. Voice and portrait use require permission.
          {catalog?.liveNotebookExecution ? '' : ' Notebook runtime status is not available to this website.'}
        </span>
      </div>

      {catalog && <p className="hint">
        Owner access: {catalog.configuration.tokenConfigured ? 'configured' : 'setup needed'} ·
        Media storage: {catalog.configuration.storageConfigured ? 'settings present' : 'setup needed'}
      </p>}
      <div className="templateGrid">
        {(catalog?.pipelines || []).map((pipeline, index) => (
          <article className="templateCard" key={pipeline.id}>
            <b>{index === 0 ? '🎬' : index === 1 ? '🎙' : '🗣'} {pipeline.title}</b>
            <span>{pipeline.purpose}</span>
            <small>{pipeline.model}</small>
            <small>Outputs: {pipeline.expectedTypes.join(', ')}</small>
            <a href={pipeline.notebookUrl} target="_blank" rel="noopener noreferrer"
               style={{ color: '#f1c87d', fontSize: 12, fontWeight: 'bold' }}>
              Open Kaggle notebook ↗
            </a>
            <button type="button" onClick={() => copyCell(pipeline.id)}
               className="generate" style={{ marginTop: 4, padding: 10 }}>
              {copied === pipeline.id ? '✓ Copied preview cell' : 'Copy preview cell'}
            </button>
            <small>This cell lists finished files without uploading. Review them before confirming the import.</small>
          </article>
        ))}
      </div>

      <div className="studio" style={{ padding: '24px 0 0' }}>
        <div className="panel">
          <h2>PRIVATE IMPORT SETTINGS</h2>
          <p style={{ color: '#aaa', fontSize: 13, lineHeight: 1.7 }}>
            Configure KAGGLE_BRIDGE_TOKEN and R2 server variables on Vercel.
            Add the same token to each Kaggle notebook under
            Add-ons → Secrets as AIVIDEO_BRIDGE_TOKEN. Do not paste the token into shared cells.
          </p>
          <a href="https://github.com/mabrig1/aivideo/blob/main/docs/KAGGLE_BRIDGE.md"
             target="_blank" rel="noopener noreferrer" style={{ color: '#f1c87d' }}>
            Read the integration and security guide ↗
          </a>
          <p className="hint" style={{ textAlign: 'left' }}>
            Files are private. Nothing is automatically published, charged to a paid provider,
            or used to clone a voice without an explicit consent flag.
          </p>
        </div>
        <div className="panel">
          <h2>IMPORTED CINEMA LIBRARY</h2>
          <label htmlFor="kaggle-owner-token">Owner token (held only while this page is open)</label>
          <input id="kaggle-owner-token" type="password" value={ownerToken}
            autoComplete="off" disabled={loading || checking} placeholder="Private bridge token"
            onChange={(event) => { setOwnerToken(event.target.value); setAssets([]); setNextCursor(null); setDiagnostic(''); }} />
          <button type="button" className="generate" onClick={() => loadAssets()}
            disabled={loading || checking || !ownerToken.trim() || !catalog?.bridgeConfigured}>
            {loading ? 'Loading media…' : 'Load my imported renders'}
          </button>
          <label htmlFor="kaggle-pipeline">Show imports from</label>
          <select id="kaggle-pipeline" value={pipelineFilter} disabled={loading}
            onChange={(event) => { setPipelineFilter(event.target.value); setAssets([]); setNextCursor(null); }}>
            <option value="">All notebooks</option>
            {(catalog?.pipelines || []).map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
          <button type="button" onClick={checkStorage} disabled={checking || !ownerToken.trim() || !catalog?.bridgeConfigured}>
            {checking ? 'Checking storage…' : 'Check storage access'}
          </button>
          <button type="button" disabled={loading || checking} onClick={() => { setOwnerToken(''); setAssets([]); setNextCursor(null); setDiagnostic(''); setNotice('Private session cleared.'); }}>
            Clear private session
          </button>
          {diagnostic && <p role="status">{diagnostic}</p>}
          {notice && <p role="status" style={{ color: '#f1c87d', fontSize: 12 }}>{notice}</p>}
          <div style={{ display: 'grid', gap: 10, marginTop: 16 }}>
            {assets.map((asset) => (
              <div className="render" style={{ margin: 0 }} key={asset.id}>
                <b>{asset.pipeline.toUpperCase()} · {asset.filename}</b>
                <span>{asset.projectId} · {(asset.sizeBytes / 1048576).toFixed(1)} MB · {new Date(asset.completedAt).toLocaleString()}</span>
                <a href={asset.downloadUrl} target="_blank" rel="noopener noreferrer"
                  style={{ color: '#f1c87d', fontSize: 12 }}>Preview or download privately ↗</a>
              </div>
            ))}
          </div>
          {nextCursor && <button type="button" onClick={() => loadAssets(true)} disabled={loading}>Load more imports</button>}
        </div>
      </div>
      {catalog?.build.commit && <p className="hint">Bridge v{catalog.build.version} · Release {catalog.build.commit.slice(0, 7)}</p>}
    </section>
  );
}
