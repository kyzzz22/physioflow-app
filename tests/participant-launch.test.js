import assert from 'node:assert/strict';
import test from 'node:test';
import { createCoreComponentRegistry, createProtocolGraph, createSequentialIdFactory, freezeProtocolGraph } from '../src/core/index.js';
import { createDeploymentBundle } from '../src/deployment/index.js';
import { createHostedHttpHandler, createParticipantLaunchUrl, HostedExecutionClient, isParticipantEntryLocation, LocalHostedExecutionService, parseParticipantLaunchLocation, prepareParticipantLaunch } from '../src/hosted/index.js';

async function hostedLaunchFixture() {
  const protocol = await freezeProtocolGraph(
    createProtocolGraph({ idFactory: createSequentialIdFactory(), now: '2026-08-23T00:00:00.000Z' }),
    createCoreComponentRegistry(),
    { now: '2026-08-23T01:00:00.000Z' },
  );
  const bundle = await createDeploymentBundle(protocol, { bundleId: 'public_page_bundle', createdAt: '2026-08-23T02:00:00.000Z' });
  let id = 0;
  const service = new LocalHostedExecutionService({
    actors: [{ actorId: 'public-owner', role: 'owner', accessToken: 'public-owner-token' }],
    idFactory: prefix => `${prefix}_public_page_${++id}`,
    clock: () => '2026-08-23T03:00:00.000Z',
  });
  const owner = new HostedExecutionClient(service, 'public-owner-token');
  const deployment = await owner.publish(bundle, { idempotencyKey: 'public-page-publish' });
  owner.processNextDeployment();
  const link = await owner.createLaunchLink(deployment.deploymentId, { idempotencyKey: 'public-page-link', maximumUses: 1 });
  const handler = createHostedHttpHandler(service);
  return { link, protocol, service, fetch: (input, init) => handler(new Request(input, init)) };
}

test('participant entry uses fragment credentials and rejects an unsafe API origin', () => {
  const location = {
    origin: 'https://experiments.example',
    pathname: '/participant',
    search: '',
    hash: '#launch=opaque-token&api=https%3A%2F%2Fapi.example&participantId=P-42',
  };
  assert.equal(isParticipantEntryLocation(location), true);
  assert.deepEqual(parseParticipantLaunchLocation(location), {
    apiBaseUrl: 'https://api.example',
    launchToken: 'opaque-token',
    participantId: 'P-42',
  });
  assert.throws(() => parseParticipantLaunchLocation({ ...location, hash: '#launch=x&api=http%3A%2F%2Fapi.example' }), /must use HTTPS/);
  assert.equal(createParticipantLaunchUrl('secret token', { origin: location.origin }), 'https://experiments.example/participant#launch=secret+token');
});

test('standalone participant preparation redeems idempotently and validates its bootstrap', async () => {
  const { fetch, link, protocol, service } = await hostedLaunchFixture();
  const request = { apiBaseUrl: 'https://hosted.example', launchToken: link.launchToken, participantId: 'PUBLIC-PAGE', fetch };
  const first = await prepareParticipantLaunch(request);
  const refreshed = await prepareParticipantLaunch(request);
  assert.equal(first.session.sessionId, refreshed.session.sessionId);
  assert.equal(first.session.participantId, 'PUBLIC-PAGE');
  assert.equal(first.bootstrap.protocol.freeze.configHash, protocol.freeze.configHash);
  assert.equal(first.session.participantAccessToken, undefined);
  assert.equal(service.launchLinks.get(link.launchLinkId).useCount, 1);
});
