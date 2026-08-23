function normalizedChecksum(value) { return String(value || '').replace(/^sha256:/, '').toLowerCase(); }

export function workspaceDeploymentAssets(bundle) {
  return (bundle?.dependencies?.assets || []).filter(asset => asset.source === 'workspace').map(asset => structuredClone(asset));
}

export async function uploadDeploymentAssets({ client, deploymentId, bundle, loadAsset, onProgress } = {}) {
  if (!client?.uploadDeploymentAsset || !client?.deploymentAssets) throw new Error('Deployment asset upload requires a hosted HTTP client');
  if (!deploymentId) throw new Error('Deployment asset upload requires a deployment ID');
  if (typeof loadAsset !== 'function') throw new Error('Deployment asset upload requires an asset loader');
  const assets = workspaceDeploymentAssets(bundle);
  const uploaded = [];
  for (const [index, declared] of assets.entries()) {
    const stored = await loadAsset(declared.id);
    if (!stored) throw new Error(`Deployment asset ${declared.name || declared.id} is unavailable locally`);
    if (declared.checksum && stored.checksum && normalizedChecksum(declared.checksum) !== normalizedChecksum(stored.checksum)) throw new Error(`Deployment asset ${declared.name || declared.id} checksum does not match its frozen manifest`);
    const content = stored.file || stored.blob || stored.content || stored;
    const mediaType = declared.mediaType || stored.type || stored.file?.type || 'application/octet-stream';
    const result = await client.uploadDeploymentAsset(deploymentId, declared.id, content, { mediaType });
    uploaded.push(result);
    onProgress?.({ index: index + 1, total: assets.length, asset: structuredClone(declared), result: structuredClone(result) });
  }
  const status = await client.deploymentAssets(deploymentId);
  if (!status.ready) throw new Error('Hosted deployment assets remain incomplete after upload');
  return { uploaded, status };
}
