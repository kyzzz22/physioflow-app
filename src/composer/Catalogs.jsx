import { useMemo, useRef, useState } from 'react';
import { createId } from '../core/index.js';
import { createProtocolChangeSet, mergeProtocolChangeSet } from '../collaboration/index.js';
import { createDeploymentBundle, validateDeploymentBundle } from '../deployment/index.js';
import { HostedExecutionClient, LocalHostedExecutionService, validateParticipantBootstrap } from '../hosted/index.js';
import { calibrationReport } from '../visualAngle.js';
import { translate, useLanguage } from '../i18n.jsx';
import { endpointValue, groupDataPorts, parseEndpoint } from './NodeInspector.jsx';
import { downloadJson } from './toolbox.js';

export function GroupCatalog({ registry: componentRegistry, groups, nodes, locked, onUpdate, onRemove, onPublish }) {
  const { language } = useLanguage();
  const t = key => translate(key, language);

  return <section className="group-catalog">
    <h3>{t('Groups')}</h3>
    <p>Visual containers organize related nodes without creating a second execution model.</p>
    {!groups.length && <small>No groups yet. Select a node and create one from its Inspector.</small>}
    {groups.map(group => <article key={group.id}>
      <input disabled={locked} aria-label={`${group.name} group name`} value={group.name} onChange={event => onUpdate(group.id, { name: event.target.value })} />
      <select disabled={locked} aria-label={`${group.name} group kind`} value={group.kind || 'container'} onChange={event => {
        const kind = event.target.value;
        onUpdate(group.id, kind === 'subflow' ? { kind, entryNodeId: group.entryNodeId || group.nodeIds[0], exitNodeIds: group.exitNodeIds?.length ? group.exitNodeIds : [group.nodeIds.at(-1)] } : { kind, entryNodeId: null, exitNodeIds: [] });
      }}><option value="container">container</option><option value="subflow">subflow</option></select>
      <small>{group.nodeIds.length} node(s) · {group.kind}</small>
      {group.kind === 'subflow' && <div className="subflow-settings">
        <label>Entry<select disabled={locked} aria-label={`${group.name} subflow entry`} value={group.entryNodeId || ''} onChange={event => onUpdate(group.id, { entryNodeId: event.target.value })}>{group.nodeIds.map(nodeId => <option key={nodeId} value={nodeId}>{nodes.find(node => node.id === nodeId)?.label || nodeId}</option>)}</select></label>
        <fieldset className="subflow-exits"><legend>Exits</legend>{group.nodeIds.map(nodeId => <label key={nodeId}><input disabled={locked} type="checkbox" checked={(group.exitNodeIds || []).includes(nodeId)} onChange={event => onUpdate(group.id, { exitNodeIds: event.target.checked ? [...(group.exitNodeIds || []), nodeId] : (group.exitNodeIds || []).filter(id => id !== nodeId) })} />{nodes.find(node => node.id === nodeId)?.label || nodeId}</label>)}</fieldset>
        {(group.parameters || []).map((parameter, index) => {
          const ports = groupDataPorts(group, nodes, parameter.direction, componentRegistry);
          const endpointName = parameter.direction === 'output' ? 'source' : 'target';
          return <div className="subflow-parameter" key={index}>
          <input disabled={locked} aria-label={`${group.name} parameter ${index + 1} name`} value={parameter.name} onChange={event => onUpdate(group.id, { parameters: group.parameters.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item) })} />
          <select disabled={locked} aria-label={`${group.name} parameter ${index + 1} type`} value={parameter.type} onChange={event => onUpdate(group.id, { parameters: group.parameters.map((item, itemIndex) => itemIndex === index ? { ...item, type: event.target.value } : item) })}>{['string', 'number', 'boolean', 'enum', 'object', 'array', 'unknown'].map(type => <option key={type}>{type}</option>)}</select>
          <select disabled={locked} aria-label={`${group.name} parameter ${index + 1} direction`} value={parameter.direction} onChange={event => {
            const direction = event.target.value;
            const firstPort = groupDataPorts(group, nodes, direction, componentRegistry)[0];
            onUpdate(group.id, { parameters: group.parameters.map((item, itemIndex) => itemIndex === index ? { ...item, direction, type: firstPort?.dataType || item.type, target: direction === 'input' && firstPort ? { nodeId: firstPort.nodeId, portId: firstPort.portId } : undefined, source: direction === 'output' && firstPort ? { nodeId: firstPort.nodeId, portId: firstPort.portId } : undefined } : item) });
          }}><option value="input">input</option><option value="output">output</option></select>
          <select disabled={locked || !ports.length} aria-label={`${group.name} parameter ${index + 1} endpoint`} value={endpointValue(parameter[endpointName])} onChange={event => onUpdate(group.id, { parameters: group.parameters.map((item, itemIndex) => itemIndex === index ? { ...item, [endpointName]: parseEndpoint(event.target.value) } : item) })}><option value="">Select port</option>{ports.map(port => <option key={`${port.nodeId}:${port.portId}`} value={endpointValue(port)}>{port.label}</option>)}</select>
          <button disabled={locked} aria-label={`Delete parameter ${parameter.name}`} onClick={() => onUpdate(group.id, { parameters: group.parameters.filter((_, itemIndex) => itemIndex !== index) })}>×</button>
        </div>})}
        <button disabled={locked || (!groupDataPorts(group, nodes, 'input', componentRegistry).length && !groupDataPorts(group, nodes, 'output', componentRegistry).length)} onClick={() => {
          const direction = groupDataPorts(group, nodes, 'input', componentRegistry).length ? 'input' : 'output';
          const port = groupDataPorts(group, nodes, direction, componentRegistry)[0];
          const endpointName = direction === 'output' ? 'source' : 'target';
          onUpdate(group.id, { parameters: [...(group.parameters || []), { name: `parameter_${(group.parameters || []).length + 1}`, type: port.dataType || 'unknown', direction, [endpointName]: { nodeId: port.nodeId, portId: port.portId } }] });
        }}>Add parameter</button>
        <button disabled={locked} onClick={() => onPublish(group.id)}>Publish reusable template</button>
      </div>}
      <button disabled={locked} aria-label={`Delete group ${group.name}`} onClick={() => onRemove(group.id)}>×</button>
    </article>)}
  </section>;
}

export function SubflowTemplateCatalog({ templates, variables, locked, onInstantiate, onRemove }) {
  const { language } = useLanguage();
  const t = key => translate(key, language);

  const [mappings, setMappings] = useState({});
  if (!templates.length) return null;
  return <section className="subflow-template-catalog">
    <h3>{t('Reusable subflows')}</h3>
    <p>Instances are expanded into the same executable graph and keep their template provenance.</p>
    {templates.map(template => {
      const compatible = parameter => variables.filter(variable => parameter.type === 'unknown' || variable.type === 'unknown' || variable.type === parameter.type);
      const currentMappings = mappings[template.id] || {};
      const resolvedMappings = Object.fromEntries((template.parameters || []).map(parameter => [parameter.name, currentMappings[parameter.name] || compatible(parameter)[0]?.name || '']));
      const ready = (template.parameters || []).every(parameter => resolvedMappings[parameter.name]);
      return <article key={template.id}>
        <div><b>{template.name}</b><small>v{template.version} · {template.nodes.length} nodes</small></div>
        {(template.parameters || []).map(parameter => <label key={parameter.name}>{parameter.direction} {parameter.name}<select disabled={locked} aria-label={`${template.name} ${parameter.name} variable mapping`} value={resolvedMappings[parameter.name]} onChange={event => setMappings(current => ({ ...current, [template.id]: { ...(current[template.id] || {}), [parameter.name]: event.target.value } }))}><option value="">Select variable</option>{compatible(parameter).map(variable => <option key={variable.name}>{variable.name}</option>)}</select></label>)}
        {!ready && Boolean(template.parameters?.length) && <small>Add compatible protocol variables before instantiating.</small>}
        <div className="subflow-template-actions"><button disabled={locked || !ready} onClick={() => onInstantiate(template.id, resolvedMappings)}>Create instance</button><button disabled={locked} onClick={() => onRemove(template.id)}>Delete template</button></div>
      </article>;
    })}
  </section>;
}

function snapshotLabel(state) {
  if (!state?.exists) return '(missing)';
  const serialized = typeof state.value === 'string' ? state.value : JSON.stringify(state.value);
  const text = serialized === undefined ? String(state.value) : serialized;
  return text.length > 90 ? `${text.slice(0, 87)}…` : text;
}

export function CollaborationCatalog({ protocol, baseline, locked, onSetBaseline, onApply, onMessage }) {
  const { language } = useLanguage();
  const t = key => translate(key, language);

  const [author, setAuthor] = useState('local-author');
  const [summary, setSummary] = useState('');
  const [pending, setPending] = useState(null);
  const [resolutions, setResolutions] = useState({});
  const [error, setError] = useState('');
  const preview = useMemo(() => {
    if (!pending) return null;
    try { return mergeProtocolChangeSet(protocol, pending, { resolutions }); }
    catch (nextError) { return { error: nextError.message, conflicts: [], unresolved: 0 }; }
  }, [pending, protocol, resolutions]);
  const exportChanges = async () => {
    try {
      const changeSet = await createProtocolChangeSet(baseline, protocol, { authorId: author.trim() || 'local-author', authorName: author.trim() || 'Local author', summary: summary.trim() });
      if (!changeSet.operations.length) throw new Error('No changes exist relative to the current collaboration baseline');
      downloadJson(`${protocol.metadata?.name || 'protocol'}.${changeSet.id}.changeset.json`, changeSet);
      setError('');
      onMessage(`Exported ${changeSet.operations.length} collaboration operation(s)`);
    } catch (nextError) { setError(nextError.message); }
  };
  const readChangeSet = async event => {
    try {
      const file = event.target.files?.[0];
      if (!file) return;
      setPending(JSON.parse(await file.text()));
      setResolutions({});
      setError('');
    } catch (nextError) { setPending(null); setError(nextError.message); }
    event.target.value = '';
  };
  const history = protocol.collaboration?.history || [];
  return <section className="collaboration-catalog">
    <h3>{t('Collaboration change sets')}</h3>
    <p>Exchange auditable protocol changes without requiring a server. Independent fields merge automatically; same-field edits require an explicit choice.</p>
    <label>Author ID<input value={author} onChange={event => setAuthor(event.target.value)} /></label>
    <label>Summary<input value={summary} onChange={event => setSummary(event.target.value)} placeholder="What changed?" /></label>
    <small>Baseline: v{baseline.version?.number} · {baseline.audit?.updatedAt || 'unknown time'}</small>
    <div className="collaboration-actions"><button disabled={locked} onClick={onSetBaseline}>Use current as baseline</button><button disabled={locked} onClick={exportChanges}>Export changes</button></div>
    <label className="collaboration-import">Import change set<input disabled={locked} type="file" accept="application/json,.json" onChange={readChangeSet} /></label>
    {error && <small className="package-error">{error}</small>}
    {preview?.error && <small className="package-error">{preview.error}</small>}
    {pending && !preview?.error && <article className="collaboration-preview">
      <b>{pending.summary || pending.id}</b>
      <small>{pending.author?.name || pending.author?.id} · {pending.operations?.length || 0} operation(s)</small>
      <small>{preview.appliedOperations} ready · {preview.alreadyAppliedOperations} already applied · {preview.unresolved} conflict(s)</small>
      {preview.conflicts.map(conflict => <label key={conflict.operationId} className="collaboration-conflict">
        <span><b>{conflict.target}{conflict.entityKey ? ` · ${conflict.entityKey}` : ''}</b><small>{conflict.path.join('.') || '(whole entity)'}</small><small>Local: {snapshotLabel(conflict.local)}</small><small>Incoming: {snapshotLabel(conflict.incoming)}</small></span>
        <select aria-label={`${conflict.operationId} conflict resolution`} value={resolutions[conflict.operationId] || ''} onChange={event => setResolutions(current => ({ ...current, [conflict.operationId]: event.target.value }))}><option value="">Resolve…</option><option value="local">Keep local</option><option value="incoming">Use incoming</option></select>
      </label>)}
      <div><button disabled={locked || preview.unresolved > 0} onClick={() => { onApply(preview.protocol); setPending(null); setResolutions({}); }}>Apply change set</button><button onClick={() => { setPending(null); setResolutions({}); }}>Cancel</button></div>
    </article>}
    <details><summary>Applied history ({history.length})</summary>{history.map(item => <small key={`${item.changeSetId}:${item.appliedAt}`}>{item.changeSetId} · {item.author?.name || item.author?.id} · {item.appliedOperations} applied · {item.appliedAt}</small>)}</details>
  </section>;
}

export function DeploymentCatalog({ protocol, onHostedRun, onMessage }) {
  const [providerId, setProviderId] = useState('org.physioflow.portable');
  const [environment, setEnvironment] = useState('portable');
  const [error, setError] = useState('');
  const [inspection, setInspection] = useState(null);
  const [hostedDeployment, setHostedDeployment] = useState(null);
  const [hostedSession, setHostedSession] = useState(null);
  const [hostedBootstrap, setHostedBootstrap] = useState(null);
  const [participantId, setParticipantId] = useState('SANDBOX-P001');
  const [maximumSessions, setMaximumSessions] = useState('5');
  const [launchLink, setLaunchLink] = useState(null);
  const sandboxRef = useRef(null);
  const participantClientRef = useRef(null);
  if (!sandboxRef.current) {
    const service = new LocalHostedExecutionService({ actors: [{ actorId: 'local-owner', role: 'owner', accessToken: 'local-owner-token' }] });
    sandboxRef.current = new HostedExecutionClient(service, 'local-owner-token');
  }
  const frozen = protocol.version?.status === 'frozen';
  const exportBundle = async () => {
    try {
      const bundle = await createDeploymentBundle(protocol, { providerId: providerId.trim(), environment: environment.trim(), createdBy: 'local-operator', maximumSessions: Number(maximumSessions) });
      downloadJson(`${protocol.metadata?.name || 'protocol'}.deployment.json`, bundle);
      setError('');
      onMessage(`Exported deployment bundle ${bundle.bundleId}`);
    } catch (nextError) { setError(nextError.message); }
  };
  const inspectBundle = async event => {
    try {
      const file = event.target.files?.[0];
      if (!file) return;
      const bundle = JSON.parse(await file.text());
      const result = await validateDeploymentBundle(bundle);
      setInspection({ bundle, result });
      setError('');
    } catch (nextError) { setInspection(null); setError(nextError.message); }
    event.target.value = '';
  };
  const publishToSandbox = async () => {
    try {
      const bundle = await createDeploymentBundle(protocol, { providerId: 'org.physioflow.local-sandbox', environment: 'sandbox', createdBy: 'local-owner', maximumSessions: Number(maximumSessions) });
      const client = sandboxRef.current;
      const queued = await client.publish(bundle, { idempotencyKey: `composer:${protocol.protocolId}:${protocol.freeze.configHash}:${maximumSessions}` });
      const ready = client.processNextDeployment() || client.deployment(queued.deploymentId);
      setHostedDeployment(ready);
      setHostedSession(null);
      setHostedBootstrap(null);
      setLaunchLink(null);
      setError('');
      onMessage(`Sandbox deployment ${ready.status}`);
    } catch (nextError) { setError(nextError.message); }
  };
  const createSandboxSession = async () => {
    try {
      const session = await sandboxRef.current.createSession(hostedDeployment.deploymentId, { participantId: participantId.trim() || undefined, idempotencyKey: `participant:${participantId.trim() || 'generated'}` });
      participantClientRef.current = new HostedExecutionClient(sandboxRef.current.service, session.participantAccessToken);
      const bootstrap = await participantClientRef.current.bootstrap(session.sessionId);
      const check = await validateParticipantBootstrap(bootstrap);
      if (!check.valid) throw new Error(`Participant bootstrap failed validation: ${check.errors.join('; ')}`);
      setHostedSession(session);
      setHostedBootstrap(bootstrap);
      setError('');
      onMessage(`Created hosted sandbox session ${session.sessionId}`);
    } catch (nextError) { setError(nextError.message); }
  };
  const createSandboxLaunchLink = async () => {
    try {
      const link = await sandboxRef.current.createLaunchLink(hostedDeployment.deploymentId, { idempotencyKey: `launch:${hostedDeployment.deploymentId}`, maximumUses: 1 });
      setLaunchLink(link);
      setError('');
      onMessage(`Created revocable launch token ${link.launchLinkId}`);
    } catch (nextError) { setError(nextError.message); }
  };
  const redeemSandboxLaunchLink = async () => {
    try {
      const result = await sandboxRef.current.redeemLaunchLink(launchLink.launchToken, { idempotencyKey: `redeem:${participantId.trim() || 'generated'}`, participantId: participantId.trim() || undefined });
      participantClientRef.current = new HostedExecutionClient(sandboxRef.current.service, result.session.participantAccessToken);
      const bootstrap = await participantClientRef.current.bootstrap(result.session.sessionId);
      const check = await validateParticipantBootstrap(bootstrap);
      if (!check.valid) throw new Error(`Participant bootstrap failed validation: ${check.errors.join('; ')}`);
      setHostedSession(result.session);
      setHostedBootstrap(bootstrap);
      setLaunchLink(current => ({ ...current, ...result.launchLink }));
      setError('');
      onMessage(`Redeemed launch token for ${result.session.sessionId}`);
    } catch (nextError) { setError(nextError.message); }
  };
  const revokeSandboxLaunchLink = async () => {
    try {
      const revoked = await sandboxRef.current.revokeLaunchLink(launchLink.launchLinkId, { idempotencyKey: `revoke:${launchLink.launchLinkId}`, expectedRevision: launchLink.revision });
      setLaunchLink(current => ({ ...current, ...revoked }));
      setError('');
      onMessage(`Revoked launch token ${revoked.launchLinkId}`);
    } catch (nextError) { setError(nextError.message); }
  };
  const deactivateSandbox = async () => {
    try {
      const deactivated = await sandboxRef.current.deactivateDeployment(hostedDeployment.deploymentId, { idempotencyKey: `deactivate:${hostedDeployment.deploymentId}`, expectedRevision: hostedDeployment.revision });
      setHostedDeployment(deactivated);
      setError('');
      onMessage(`Deactivated sandbox deployment ${deactivated.deploymentId}`);
    } catch (nextError) { setError(nextError.message); }
  };
  return <section className="deployment-catalog">
    <h3>Portable deployment</h3>
    <p>Package one frozen protocol, its dependency manifest, execution policy, and integrity hashes for a compatible local or remote execution provider.</p>
    <label>Provider ID<input value={providerId} onChange={event => setProviderId(event.target.value)} /></label>
    <label>Environment<input value={environment} onChange={event => setEnvironment(event.target.value)} /></label>
    <label>Session quota<input type="number" min="1" step="1" value={maximumSessions} onChange={event => setMaximumSessions(event.target.value)} /></label>
    <button disabled={!frozen} onClick={exportBundle}>Export deployment bundle</button>
    <button disabled={!frozen} onClick={publishToSandbox}>Publish to local hosted sandbox</button>
    {!frozen && <small>Freeze this protocol version before deployment.</small>}
    <label className="deployment-import">Inspect deployment bundle<input type="file" accept="application/json,.json" onChange={inspectBundle} /></label>
    {error && <small className="package-error">{error}</small>}
    {inspection && <article className={inspection.result.valid ? 'deployment-valid' : 'deployment-invalid'}>
      <b>{inspection.result.valid ? 'Bundle integrity verified' : 'Bundle rejected'}</b>
      <small>{inspection.bundle.bundleId || 'Unknown bundle'} · {inspection.bundle.target?.providerId || 'Unknown provider'}</small>
      {inspection.result.errors.map(item => <small key={item}>{item}</small>)}
    </article>}
    {hostedDeployment && <article className="deployment-valid">
      <b>Hosted sandbox · {hostedDeployment.status}</b>
      <small>{hostedDeployment.deploymentId} · revision {hostedDeployment.revision} · {hostedDeployment.sessionCount}/{hostedDeployment.maximumSessions ?? '∞'} sessions</small>
      <label>Participant ID<input value={participantId} onChange={event => setParticipantId(event.target.value)} /></label>
      <button disabled={hostedDeployment.status !== 'ready'} onClick={createSandboxSession}>Create sandbox session</button>
      <button disabled={hostedDeployment.status !== 'ready' || Boolean(launchLink)} onClick={createSandboxLaunchLink}>Create one-use launch token</button>
      {launchLink && <><small>Launch {launchLink.launchLinkId} · {launchLink.status} · {launchLink.useCount}/{launchLink.maximumUses} uses</small><code>{launchLink.launchToken}</code><button disabled={launchLink.status !== 'active' || launchLink.useCount >= launchLink.maximumUses} onClick={redeemSandboxLaunchLink}>Redeem launch token</button><button disabled={launchLink.status !== 'active'} onClick={revokeSandboxLaunchLink}>Revoke launch token</button></>}
      <button disabled={hostedDeployment.status === 'deactivated'} onClick={deactivateSandbox}>Deactivate deployment</button>
      {hostedSession && <><small>Session {hostedSession.sessionId} · {hostedSession.status} · revision {hostedSession.revision}</small>{hostedBootstrap && <small>Bootstrap verified · {hostedBootstrap.resources.filter(item => item.status === 'ready').length}/{hostedBootstrap.resources.length} resources ready</small>}<button disabled={!hostedBootstrap} onClick={() => {
        const session = structuredClone(hostedSession);
        delete session.participantAccessToken;
        onHostedRun?.({ client: participantClientRef.current, session, protocol: hostedBootstrap.protocol, resources: hostedBootstrap.resources });
      }}>Run hosted session</button></>}
    </article>}
  </section>;
}

export function ComponentPackageCatalog({ packages, locked, onInstallExample, onImport, onRemove }) {
  const { language } = useLanguage();
  const t = key => translate(key, language);

  const [pending, setPending] = useState(null);
  const [approved, setApproved] = useState([]);
  const [error, setError] = useState('');
  const readPackage = async event => {
    try {
      const file = event.target.files?.[0];
      if (!file) return;
      const parsed = JSON.parse(await file.text());
      setPending(parsed);
      setApproved([]);
      setError('');
    } catch (nextError) { setError(nextError.message); setPending(null); }
    event.target.value = '';
  };
  const permissions = pending?.permissions || [];
  return <section className="component-package-catalog">
    <h3>{t('Project component library')}</h3>
    <p>SDK packages are declarative, versioned, permission-gated, and cannot inject JavaScript into Runtime V2.</p>
    <button disabled={locked || packages.some(item => item.packageId === 'org.physioflow.examples.reaction-button')} onClick={onInstallExample}>Install Reaction Button example</button>
    <label className="component-package-import">Import SDK package<input disabled={locked} type="file" accept="application/json,.json" onChange={readPackage} /></label>
    {error && <small className="package-error">{error}</small>}
    {pending && <article className="package-approval">
      <b>{pending.name || pending.packageId}</b><small>{pending.packageId}@{pending.version}</small>
      <p>Approve every requested capability before installation:</p>
      {!permissions.length && <small>No permissions requested.</small>}
      {permissions.map(permission => <label key={permission}><input type="checkbox" checked={approved.includes(permission)} onChange={event => setApproved(current => event.target.checked ? [...current, permission] : current.filter(item => item !== permission))} />{permission}</label>)}
      <div><button disabled={permissions.some(permission => !approved.includes(permission))} onClick={() => { onImport(pending); setPending(null); setApproved([]); }}>Approve and install</button><button onClick={() => setPending(null)}>Cancel</button></div>
    </article>}
    {packages.map(componentPackage => <article key={`${componentPackage.packageId}@${componentPackage.version}`}>
      <div><b>{componentPackage.name}</b><small>{componentPackage.packageId}@{componentPackage.version} · {componentPackage.components.length} component(s)</small></div>
      <small>{componentPackage.permissions?.length ? `Permissions: ${componentPackage.permissions.join(', ')}` : 'No permissions'}</small>
      <button disabled={locked} onClick={() => onRemove(componentPackage.packageId, componentPackage.version)}>Uninstall</button>
    </article>)}
  </section>;
}

export function DeviceConnectorCatalog({ connectors, locked, onInstallExample, onImport, onRemove }) {
  const { language } = useLanguage();
  const t = key => translate(key, language);

  const [pending, setPending] = useState(null);
  const [approved, setApproved] = useState([]);
  const [error, setError] = useState('');
  const readConnector = async event => {
    try {
      const file = event.target.files?.[0];
      if (!file) return;
      setPending(JSON.parse(await file.text()));
      setApproved([]);
      setError('');
    } catch (nextError) { setError(nextError.message); setPending(null); }
    event.target.value = '';
  };
  const permissions = pending?.permissions || [];
  return <section className="device-connector-catalog">
    <h3>{t('Device connectors')}</h3>
    <p>Versioned adapters expose typed I/O channels with explicit connect/read/write permissions and provenance events.</p>
    <button disabled={locked || connectors.some(item => item.connectorId === 'org.physioflow.simulated-sensor')} onClick={onInstallExample}>Install simulated sensor</button>
    <label className="device-connector-import">Import connector manifest<input disabled={locked} type="file" accept="application/json,.json" onChange={readConnector} /></label>
    {error && <small className="package-error">{error}</small>}
    {pending && <article className="package-approval">
      <b>{pending.name || pending.connectorId}</b><small>{pending.connectorId}@{pending.version} · {pending.transport}</small>
      <p>Approve every requested device capability:</p>
      {permissions.map(permission => <label key={permission}><input type="checkbox" checked={approved.includes(permission)} onChange={event => setApproved(current => event.target.checked ? [...current, permission] : current.filter(item => item !== permission))} />{permission}</label>)}
      <div><button disabled={permissions.some(permission => !approved.includes(permission))} onClick={() => { onImport(pending); setPending(null); setApproved([]); }}>Approve and install</button><button onClick={() => setPending(null)}>Cancel</button></div>
    </article>}
    {connectors.map(connector => <article key={`${connector.connectorId}@${connector.version}`}>
      <div><b>{connector.name}</b><small>{connector.connectorId}@{connector.version} · {connector.transport}</small></div>
      <small>{(connector.channels || []).map(channel => `${channel.direction} ${channel.id}:${channel.dataType}${channel.unit ? ` (${channel.unit})` : ''}`).join(' · ') || 'No channels'}</small>
      <small>Permissions: {(connector.approvedPermissions || []).join(', ') || 'none'}</small>
      <button disabled={locked} onClick={() => onRemove(connector.connectorId, connector.version)}>Uninstall</button>
    </article>)}
  </section>;
}

export function VariableCatalog({ variables, locked, mode, onAdd, onUpdate, onRemove, onError }) {
  const { language } = useLanguage();
  const t = key => translate(key, language);

  const [draft, setDraft] = useState({ name: '', type: 'string', scope: 'session', defaultValue: '' });
  const submit = () => {
    let defaultValue = draft.defaultValue;
    if (draft.type === 'number') defaultValue = draft.defaultValue === '' ? 0 : Number(draft.defaultValue);
    if (draft.type === 'boolean') defaultValue = draft.defaultValue === 'true';
    try {
      onAdd({ ...draft, defaultValue });
      setDraft({ name: '', type: 'string', scope: 'session', defaultValue: '' });
    } catch (error) { onError(error); }
  };
  return <section className="variable-catalog">
    <h3>{t('Variables')}</h3>
    <p>Typed values available to conditions and participant UI bindings.</p>
    {variables.map(variable => <article key={variable.name}>
      <input disabled={locked} aria-label={`${variable.name} variable name`} value={variable.name} onChange={event => {
        try { onUpdate(variable.name, { name: event.target.value }); } catch { /* keep editing stable until valid */ }
      }} />
      <select disabled={locked} aria-label={`${variable.name} variable type`} value={variable.type} onChange={event => { try { onUpdate(variable.name, { type: event.target.value }); } catch (error) { onError(error); } }}>{['string', 'number', 'boolean', 'enum', 'object', 'array', 'unknown'].map(type => <option key={type}>{type}</option>)}</select>
      <select disabled={locked} aria-label={`${variable.name} variable scope`} value={variable.scope} onChange={event => onUpdate(variable.name, { scope: event.target.value })}>{['session', 'trial', 'component', 'container', 'project'].map(scope => <option key={scope}>{scope}</option>)}</select>
      {variable.type === 'boolean' ? <select disabled={locked} aria-label={`${variable.name} default value`} value={String(Boolean(variable.defaultValue))} onChange={event => onUpdate(variable.name, { defaultValue: event.target.value === 'true' })}><option value="false">false</option><option value="true">true</option></select>
        : <input disabled={locked} aria-label={`${variable.name} default value`} value={typeof variable.defaultValue === 'object' ? JSON.stringify(variable.defaultValue) : variable.defaultValue ?? ''} onChange={event => onUpdate(variable.name, { defaultValue: variable.type === 'number' ? Number(event.target.value) : event.target.value })} />}
      {mode === 'advanced' && <><select disabled={locked} aria-label={`${variable.name} variable source`} value={variable.source || 'manual'} onChange={event => onUpdate(variable.name, { source: event.target.value })}><option value="manual">manual</option><option value="participant">participant</option><option value="component">component</option><option value="computed">computed</option></select>
        <select disabled={locked} aria-label={`${variable.name} export policy`} value={variable.exportPolicy || 'include'} onChange={event => onUpdate(variable.name, { exportPolicy: event.target.value })}><option value="include">include</option><option value="exclude">exclude</option><option value="hash">hash</option></select></>}
      <button disabled={locked} aria-label={`Delete variable ${variable.name}`} onClick={() => onRemove(variable.name)}>×</button>
    </article>)}
    {!locked && <div className="variable-create">
      <input aria-label="New variable name" placeholder="variable_name" value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} />
      <select aria-label="New variable type" value={draft.type} onChange={event => setDraft({ ...draft, type: event.target.value })}>{['string', 'number', 'boolean', 'enum'].map(type => <option key={type}>{type}</option>)}</select>
      <select aria-label="New variable scope" value={draft.scope} onChange={event => setDraft({ ...draft, scope: event.target.value })}>{['session', 'trial', 'component', 'container', 'project'].map(scope => <option key={scope}>{scope}</option>)}</select>
      <input aria-label="New variable default" placeholder="Default" value={draft.defaultValue} onChange={event => setDraft({ ...draft, defaultValue: event.target.value })} />
      <button disabled={!draft.name.trim()} onClick={submit}>Add variable</button>
    </div>}
  </section>;
}

export function VisualAngleCalculator() {
  const [state, setState] = useState({ displayWidthPx: 1920, displayWidthCm: 60, viewingDistanceCm: 60 });
  const widthPx = Number(state.displayWidthPx) || 1920;
  const widthCm = Number(state.displayWidthCm) || 60;
  const distanceCm = Number(state.viewingDistanceCm) || 60;
  const report = calibrationReport({ displayWidthPx: widthPx, displayHeightPx: 1080, displayWidthCm: widthCm, displayHeightCm: Math.round(widthCm * 9 / 16), viewingDistanceCm: distanceCm });
  return <details className="va-calculator"><summary>Visual angle calculator</summary>
    <div className="va-row">
      <label>Width (px)<input type="number" value={state.displayWidthPx} onChange={event => setState(s => ({ ...s, displayWidthPx: event.target.value }))} /></label>
      <label>Width (cm)<input type="number" value={state.displayWidthCm} onChange={event => setState(s => ({ ...s, displayWidthCm: event.target.value }))} /></label>
      <label>Distance (cm)<input type="number" value={state.viewingDistanceCm} onChange={event => setState(s => ({ ...s, viewingDistanceCm: event.target.value }))} /></label>
    </div>
    <div className="va-results">
      {report.pixels_per_degree != null && <><span>1° = {report.references.one_degree_px} px</span><span>px/degree: {Math.round(report.pixels_per_degree * 100) / 100}</span><span>2° = {report.references.two_degrees_px} px</span><span>5° = {report.references.five_degrees_px} px</span></>}
      {report.pixels_per_degree == null && <span>Enter a screen width to compute.</span>}
    </div>
  </details>;
}

export function AssetLibrary({ assets, locked, onUpdate }) {
  const [draft, setDraft] = useState({ name: '', mediaType: 'image', url: '' });
  const add = () => {
    if (!draft.name.trim() && !draft.url.trim()) return;
    onUpdate([...(assets || []), { id: createId('asset'), name: draft.name || draft.url, mediaType: draft.mediaType, sourceUrl: draft.url, checksum: null }]);
    setDraft({ name: '', mediaType: 'image', url: '' });
  };
  const remove = id => onUpdate((assets || []).filter(asset => (asset.id || asset.assetId) !== id));
  return <details className="asset-library"><summary>Media library ({assets.length})</summary>
    {(assets || []).map(asset => <div key={asset.id || asset.assetId} className="asset-row">
      <span>{asset.name || asset.fileName || asset.id}</span>
      <small>{asset.mediaType || asset.type || ''}</small>
      <button disabled={locked} onClick={() => remove(asset.id || asset.assetId)}>×</button>
    </div>)}
    <div className="asset-add">
      <input aria-label="Asset name" placeholder="Name" value={draft.name} onChange={event => setDraft(s => ({ ...s, name: event.target.value }))} />
      <select aria-label="Asset type" value={draft.mediaType} onChange={event => setDraft(s => ({ ...s, mediaType: event.target.value }))}><option>image</option><option>audio</option><option>video</option></select>
      <input aria-label="Asset URL" placeholder="URL" value={draft.url} onChange={event => setDraft(s => ({ ...s, url: event.target.value }))} />
      <button disabled={locked} onClick={add}>Add</button>
    </div>
  </details>;
}
