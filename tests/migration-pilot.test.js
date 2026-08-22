import assert from 'node:assert/strict';
import test from 'node:test';
import { createCoreComponentRegistry, createSequentialIdFactory, validateParticipantUi, validateProtocolGraph } from '../src/core/index.js';
import { emotionTemplate, gonogoTemplate, stroopTemplate } from '../src/domain.js';
import { migrateLegacyProtocolV1 } from '../src/legacy/migrateProtocolV1.js';

for (const [name, factory] of [['emotion', emotionTemplate], ['stroop', stroopTemplate], ['go/no-go', gonogoTemplate]]) {
  test(`${name} representative protocol migrates with at least 90% native coverage`, () => {
    const source = factory();
    const sourceSteps = source.blocks.flatMap(block => block.trials.flatMap(trial => trial.steps));
    const { protocol, report } = migrateLegacyProtocolV1(source, { idFactory: createSequentialIdFactory(), now: '2026-08-22T00:00:00.000Z' });
    const graphCheck = validateProtocolGraph(protocol, createCoreComponentRegistry());
    const migratedNodes = protocol.graph.nodes.filter(node => !node.component.type.startsWith('core.'));

    assert.equal(graphCheck.valid, true, JSON.stringify(graphCheck.errors));
    assert.ok(report.coverage.mappedPercent >= 90, String(report.coverage.mappedPercent));
    assert.equal(migratedNodes.length, sourceSteps.length);
    assert.equal(migratedNodes.every(node => node.config.legacyStep), true);
    for (const node of migratedNodes.filter(node => node.config.ui)) assert.equal(validateParticipantUi(node.config.ui).valid, true, node.label);
  });
}
