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
};
const SCRIPT_URL = 'https://raw.githubusercontent.com/mabrig1/aivideo/main/scripts/kaggle_upload.py';

function notebookCell(pipeline: string) {
  return [
    'import urllib.request',
    `urllib.request.urlretrieve("${SCRIPT_URL}", "/kaggle/working/kaggle_upload.py")`,
    `%run /kaggle/working/kaggle_upload.py --pipeline ${pipeline} --scan --project mabrig-cinema --consent`,
  ].join('\n');
}

export function KaggleBridgePanel() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [ownerToken, setOwnerToken] = useState('');
  const [assets, setAssets] = useState<ImportedAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [copied, setCopied] = useState('');

  useEffect(() => {
    fetch('/api/kaggle', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Kaggle integration unavailable.');
        setCatalog(await response.json() as Catalog);
      })
      .catch(() => setNotice('Could not load Kaggle notebook registry.'));
  }, []);

  async function copyCell(pipeline: string) {
    try {
      await navigator.clipboard.writeText(notebookCell(pipeline));
      setCopied(pipeline);
      setNotice('Kaggle cell copied. Add AIVIDEO_BRIDGE_TOKEN in Kaggle Secrets before running it.');
    } catch {
      setNotice('Clipboard access was blocked. Open the integration guide to copy the cell.');
    }
  }

  async function loadAssets() {
    if (!ownerToken.trim()) {
      setNotice('Enter the private owner token to load your imported files. It is not saved.');
      return;
    }
    setLoading(true);
    setNotice('');
    try {
      const response = await fetch('/api/kaggle?action=assets', {
        cache: 'no-store',
        headers: { Authorization: `Bearer ${ownerToken.trim()}` },
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || 'Unable to load imported assets.');
      setAssets(Array.isArray(body.assets) ? body.assets : []);
      setNotice(body.assets?.length ? 'Private imported media loaded. Links expire after 10 minutes.' : 'No imported files found yet.');
    } catch (error) {
      setAssets([]);
      setNotice(error instanceof Error ? error.message : 'Unable to load media.');
    } finally {
      setLoading(false);
    }
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
        <b>{catalog?.bridgeConfigured ? '● Private artifact import configured' : '○ Artifact import needs owner setup'}</b>
        <span>
          Kaggle compute stays inside the user-operated notebook. R2 provides durable
          storage after a completed manual import. Voice and portrait use require permission.
          {catalog?.liveNotebookExecution ? '' : ' Notebook runtime status is not available to this website.'}
        </span>
      </div>

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
              {copied === pipeline.id ? '✓ Copied import cell' : 'Copy import cell'}
            </button>
            <small>Run this cell only after the notebook has created output files.</small>
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
          <label htmlFor="kaggle-owner-token">Owner token (never stored in your browser)</label>
          <input id="kaggle-owner-token" type="password" value={ownerToken}
            autoComplete="off" placeholder="Private bridge token"
            onChange={(event) => setOwnerToken(event.target.value)} />
          <button type="button" className="generate" onClick={loadAssets}
            disabled={loading || !catalog?.bridgeConfigured}>
            {loading ? 'Loading media…' : 'Load my imported renders'}
          </button>
          {notice && <p style={{ color: '#f1c87d', fontSize: 12 }}>{notice}</p>}
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
        </div>
      </div>
    </section>
  );
}
