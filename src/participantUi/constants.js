export const defaults = {
  Layout: { direction: 'column', gap: 16 },
  Text: { text: 'New text', variant: 'body' },
  Media: { mediaType: 'image', sourceUrl: '', alt: 'Stimulus' },
  Input: { name: 'response', inputType: 'text', label: 'Response', required: false },
  Button: { label: 'Continue', variant: 'primary' },
  Progress: { value: 0, max: 100, label: '' },
  Html: { html: '<div style="text-align:center">Custom HTML</div>' },
  Divider: { orientation: 'horizontal', thickness: 1 },
  Rectangle: { width: 120, height: 80 },
  Ellipse: { width: 120, height: 80 },
};

export const TEMPLATE_KINDS = ['instruction', 'media', 'form', 'text', 'rating', 'fixation', 'attention', 'device', 'manual', 'html', 'calibration'];
export const CONTAINERS = new Set(['Screen', 'Layout']);
export const COLOR_TOKENS = ['ink', 'green', 'greenStrong', 'lime', 'mint', 'blue', 'amber', 'paper', 'paperSoft', 'surface', 'line', 'lineStrong', 'danger', 'warning', 'muted', 'mutedStrong'];
export const FONT_TOKENS = ['fontFamily', 'headingFamily', 'fontSizeBase'];
export const SPACING_TOKENS = ['spacingUnit', 'radius', 'maxWidth'];

export const LIBRARY_GROUPS = [
  { label: 'Content', types: ['Text', 'Media', 'Html'] },
  { label: 'Form', types: ['Input', 'Button', 'Progress'] },
  { label: 'Layout', types: ['Layout', 'Divider'] },
  { label: 'Shapes', types: ['Rectangle', 'Ellipse'] },
];

export const TYPE_HINTS = {
  Layout: 'Group children in a row or column',
  Text: 'Heading or body copy',
  Media: 'Image, audio or video',
  Input: 'Response field',
  Button: 'Continue / action button',
  Progress: 'Progress indicator',
  Html: 'Custom HTML fragment',
  Divider: 'Horizontal or vertical separator line',
  Rectangle: 'Filled rectangle shape',
  Ellipse: 'Filled ellipse / circle shape',
};

export const DEVICES = [
  { id: 'phone', label: 'Phone', width: 375 },
  { id: 'tablet', label: 'Tablet', width: 768 },
  { id: 'desktop', label: 'Desktop', width: null },
];

export const THEME_PRESETS_V2 = {
  'Physio Green': { green: '#197453', greenStrong: '#0f5c40', mint: '#e8f5ee', paper: '#ffffff', ink: '#17231d', radius: '12px' },
  'Ocean Blue': { green: '#356fae', greenStrong: '#2a5a92', mint: '#e8f0fa', paper: '#ffffff', ink: '#1c2a3a', radius: '10px' },
  'Warm Amber': { green: '#b66f15', greenStrong: '#96590f', mint: '#fbf1e2', paper: '#fffdf7', ink: '#33281c', radius: '14px' },
  'High Contrast': { green: '#0f5c40', greenStrong: '#0a3d2a', mint: '#e8f5ee', paper: '#ffffff', ink: '#000000', radius: '4px' },
  'Minimal Mono': { green: '#46564d', greenStrong: '#2e3a33', mint: '#f4f6f5', paper: '#fcfcfc', ink: '#222222', radius: '0px' },
};
