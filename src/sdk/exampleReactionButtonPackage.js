import { createParticipantScreen, createUiElement } from '../core/participantUi.js';
import { COMPONENT_SDK_VERSION } from './componentPackage.js';

export function exampleReactionButtonPackage() {
  const ui = createParticipantScreen({
    children: [
      createUiElement('Text', { props: { text: 'Respond when you are ready', variant: 'heading' } }),
      createUiElement('Button', { props: { label: 'Respond', action: 'submit', value: true } }),
    ],
  });
  return {
    sdkVersion: COMPONENT_SDK_VERSION,
    packageId: 'org.physioflow.examples.reaction-button',
    version: '1.0.0',
    name: 'Reaction Button Example',
    publisher: 'PhysioFlow',
    permissions: ['events.emit'],
    components: [{
      type: 'example.reaction-button',
      version: '1.0.0',
      label: 'Reaction Button',
      category: 'interaction',
      description: 'A declarative SDK example that completes on button press.',
      runtime: { kind: 'participant', uiAdapter: 'schema', completion: 'submit' },
      ports: [
        { id: 'in', kind: 'control', direction: 'input', required: true },
        { id: 'next', kind: 'control', direction: 'output', required: true },
        { id: 'pressed', kind: 'data', direction: 'output', dataType: 'boolean' },
      ],
      defaultConfig: { ui },
      editorFields: [],
      events: ['component_entered', 'ui_action', 'component_completed'],
      dataFields: ['pressed', 'reaction_time_ms'],
    }],
  };
}
