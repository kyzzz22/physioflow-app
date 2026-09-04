// Module-level geometry / validation helpers for the Composer V2 editor.
// Pure functions — no React, no component state.

export const UI_TEMPLATE_KIND = {
  'display.screen': 'instruction',
  'display.media': 'media',
  'input.rating': 'rating',
  'input.text': 'text',
  'timing.wait': 'instruction',
  'stimulus.fixation': 'fixation',
  'stimulus.attention-check': 'attention',
  'input.response': 'response',
  'setup.device-check': 'device',
  'operator.manual-event': 'manual',
  'stimulus.screen-calibration': 'calibration',
  'stimulus.custom-html': 'html',
  'utility.note': 'instruction',
  'utility.junction': 'instruction',
};

export const NODE_WIDTH = 188;
export const NODE_HEIGHT = 112;

export function downloadJson(name, value) {
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
}

export function getPath(value, path) {
  return path.split('.').reduce((current, key) => current?.[key], value);
}

export function setPath(value, path, nextValue) {
  const next = structuredClone(value || {});
  const keys = path.split('.');
  let cursor = next;
  keys.slice(0, -1).forEach(key => { cursor[key] = { ...(cursor[key] || {}) }; cursor = cursor[key]; });
  cursor[keys.at(-1)] = nextValue;
  return next;
}

// zh-CN explanations for validation issue codes surfaced in the inspector.
export const VALIDATION_MESSAGES_ZH = {
  'protocol.invalid': '协议文档结构无效',
  'protocol.id_missing': '协议缺少 ID',
  'protocol.name_missing': '协议缺少名称',
  'graph.empty': '协议流程为空，请先添加节点',
  'graph.entry_missing': '流程缺少开始节点',
  'graph.entry_not_start': '入口节点不是 start 节点',
  'graph.start_count': '流程中存在多个开始节点',
  'graph.end_missing': '流程缺少结束节点',
  'graph.end_unreachable': '结束节点不可达（有节点未连到主路径）',
  'node.unreachable': '节点不可达，缺少输入边',
  'node.id_missing': '节点缺少 ID',
  'node.id_duplicate': '节点 ID 重复',
  'node.component_missing': '节点缺少组件类型',
  'node.component_unknown': '未知的组件类型，请安装对应 SDK 包',
  'edge.source_missing': '连线缺少源节点',
  'edge.target_missing': '连线缺少目标节点',
  'edge.source_port_missing': '连线缺少源端口',
  'edge.target_port_missing': '连线缺少目标端口',
  'edge.source_direction': '连线源方向错误（应从输出端口出发）',
  'edge.target_direction': '连线目标方向错误（应指向输入端口）',
  'edge.kind_mismatch': '连线类型与控制流端口不匹配',
  'edge.target_multiple': '控制端口已有多条连线，只能保留一条',
  'port.required_unbound': '必需端口未绑定变量',
  'port.required_unconnected': '必需端口未连接',
  'binding.variable_missing': '绑定的变量不存在',
  'binding.variable_type_mismatch': '绑定变量的类型与端口不匹配',
  'variable.name_missing': '变量缺少名称',
  'variable.name_duplicate': '变量名称重复',
  'variable.type_invalid': '变量类型无效',
  'variable.scope_invalid': '变量作用域无效',
  'group.name_missing': '分组缺少名称',
  'group.empty': '分组为空',
  'group.node_missing': '分组中的节点不存在',
  'group.node_multiple': '节点只能属于一个分组',
  'subflow.parameter_mapping_missing': '子流程参数映射缺失',
  'subflow.parameter_mapping_type_mismatch': '子流程参数映射类型不匹配',
  'subflow.template_empty': '子流程模板为空',
  'subflow.entry_invalid': '子流程入口节点无效',
  'subflow.exit_invalid': '子流程出口节点无效',
  'sdk.permission_unapproved': 'SDK 权限未批准',
  'sdk.permission_variable_read': 'SDK 缺少变量读取权限',
  'sdk.permission_network_media': 'SDK 缺少网络媒体权限',
  'sdk.permission_asset_read': 'SDK 缺少资产读取权限',
  'device.connector_missing': '未安装设备连接器',
  'device.connector_invalid': '设备连接器无效',
  'device.permission_unapproved': '设备权限未批准',
  'config.media_source_missing': '媒体节点缺少 URL 或资产',
  'config.media_url_invalid': '媒体 URL 无效，请检查地址或改用资产',
  'config.media_mode_invalid': '媒体完成模式无效',
  'config.stimulus_pool_id_invalid': '刺激池 ID 缺失或重复',
  'config.stimulus_pool_name_missing': '刺激池缺少名称',
  'config.stimulus_pool_type_invalid': '刺激池媒体类型无效',
  'config.stimulus_pool_missing': '节点引用的刺激池不存在',
  'config.stimulus_pool_empty': '刺激池中还没有可用刺激',
  'config.stimulus_pool_asset_missing': '刺激池引用的媒体资源不存在',
  'config.stimulus_pool_type_mismatch': '刺激池与媒体节点的类型不一致',
  'config.stimulus_pool_inconsistent': '旧版内嵌刺激池配置不一致',
  'config.stimulus_pool_too_small': '刺激数量不足以进行无放回分配',
  'config.participant_ui_missing': '界面模板为空',
  'config.ui_variable_missing': '界面绑定引用了不存在的变量',
  'config.input_missing': '界面缺少输入控件',
  'config.completion_action_missing': '手动完成模式需要界面中有提交按钮',
  'config.duration_invalid': '持续时间无效（需为正数）',
  'config.wait_duration_invalid': '等待时长无效（需为正数）',
  'config.rating_range_invalid': '评分范围无效（min 需小于 max）',
  'config.loop_limit_invalid': '循环次数无效（需为正整数）',
  'config.condition_operator_invalid': '条件运算符无效',
  'config.loop_until_operator_invalid': '循环终止运算符无效',
  'config.random_probability_invalid': '随机概率需在 0–100 之间',
  'config.fixation_shape_invalid': '注视点形状无效',
  'config.cognitive_task_kind_invalid': '认知任务类型无效',
  'config.cognitive_task_trials_empty': '认知任务没有试次，请先生成',
  'config.cognitive_task_trial_id_invalid': '认知任务试次 ID 无效',
  'config.cognitive_task_timing_invalid': '认知任务试次时长无效',
  'config.migration.review_required': '迁移后需要人工复核配置',
};

export const VALIDATION_MESSAGES_JA = {
  'protocol.invalid': 'プロトコルのデータ構造が無効です',
  'protocol.id_missing': 'プロトコルIDがありません',
  'protocol.name_missing': 'プロトコル名を入力してください',
  'graph.empty': 'フローが空です。ノードを追加してください',
  'graph.entry_missing': '開始ノードがありません',
  'graph.entry_not_start': '入口はStartノードである必要があります',
  'graph.start_count': 'Startノードは1つだけ必要です',
  'graph.end_missing': 'Endノードがありません',
  'graph.end_unreachable': 'Endノードに到達できません',
  'node.unreachable': 'このノードはフローから到達できません',
  'node.component_unknown': '未登録のコンポーネントです',
  'edge.source_missing': '接続元ノードがありません',
  'edge.target_missing': '接続先ノードがありません',
  'edge.source_port_missing': '接続元ポートがありません',
  'edge.target_port_missing': '接続先ポートがありません',
  'edge.kind_mismatch': '接続タイプとポートタイプが一致しません',
  'edge.target_multiple': 'この入力ポートには複数接続できません',
  'port.required_unbound': '必須ポートに変数が割り当てられていません',
  'port.required_unconnected': '必須ポートが接続されていません',
  'binding.variable_missing': '参照している変数がありません',
  'binding.variable_type_mismatch': '変数とポートの型が一致しません',
  'config.media_source_missing': 'メディアURL、アセット、または刺激プールを設定してください',
  'config.media_url_invalid': 'メディアURLが無効です',
  'config.media_mode_invalid': 'メディアの完了方法が無効です',
  'config.participant_ui_missing': '参加者画面がありません',
  'config.input_missing': '参加者画面に入力項目がありません',
  'config.completion_action_missing': '手動完了には送信または次へボタンが必要です',
  'config.duration_invalid': '表示時間は0以上で指定してください',
  'config.wait_duration_invalid': '待機時間は0以上で指定してください',
  'config.rating_range_invalid': '評価の最大値は最小値より大きくしてください',
  'config.loop_limit_invalid': 'ループ回数は1以上の整数で指定してください',
  'config.random_probability_invalid': 'ランダム分岐の確率が無効です',
  'config.stimulus_pool_id_invalid': '刺激プールIDがないか重複しています',
  'config.stimulus_pool_name_missing': '刺激プール名を入力してください',
  'config.stimulus_pool_type_invalid': '刺激プールのメディア種別が無効です',
  'config.stimulus_pool_missing': '選択した刺激プールがありません',
  'config.stimulus_pool_empty': '刺激プールに刺激を追加してください',
  'config.stimulus_pool_asset_missing': '刺激プールのメディアが見つかりません',
  'config.stimulus_pool_type_mismatch': '刺激プールとMediaノードの種別が一致しません',
  'config.stimulus_pool_too_small': '重複なしで割り当てるための刺激数が不足しています',
};

export function isValidMediaUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  const trimmed = value.trim();
  if (/[\s]/.test(trimmed)) return false;
  try {
    const parsed = new URL(trimmed);
    return ['http:', 'https:', 'data:', 'blob:'].includes(parsed.protocol);
  } catch {
    // Relative paths (local dev / packaged asset files) must look like a file path.
    return trimmed.includes('/') && !/^[a-z][a-z0-9+.-]*:/i.test(trimmed);
  }
}

export function validationIssueMessage(issue, language, protocol) {
  const messages = language === 'zh' ? VALIDATION_MESSAGES_ZH : language === 'ja' ? VALIDATION_MESSAGES_JA : null;
  if (!messages) return issue.message;
  const template = messages[issue.code];
  if (!template) return issue.message;
  const node = protocol?.graph?.nodes?.find(item => item.id === issue.nodeId);
  return node?.label ? `「${node.label}」${language === 'ja' ? ': ' : ''}${template}` : template;
}

export function bindingValue(binding) {
  if (!binding) return '';
  if (binding.kind === 'variable') return `variable:${binding.variable}`;
  if (binding.kind === 'output') return `output:${binding.nodeId}:${binding.portId}`;
  return '';
}

export function parseBindingValue(raw) {
  if (!raw) return null;
  if (raw.startsWith('variable:')) return { kind: 'variable', variable: raw.slice(9) };
  if (raw.startsWith('output:')) {
    const match = raw.slice(7).match(/^([^:]+):(.+)$/);
    return match ? { kind: 'output', nodeId: match[1], portId: match[2] } : null;
  }
  return null;
}

export function portPosition(node, port, definition) {
  const ports = definition.ports.filter(item => item.direction === port.direction);
  const index = ports.findIndex(item => item.id === port.id);
  const gap = NODE_HEIGHT / (ports.length + 1);
  return {
    x: node.layout.x + (port.direction === 'output' ? NODE_WIDTH : 0),
    y: node.layout.y + gap * (index + 1),
  };
}

export function edgePath(source, target) {
  const bend = Math.max(54, Math.abs(target.x - source.x) * 0.45);
  return `M ${source.x} ${source.y} C ${source.x + bend} ${source.y}, ${target.x - bend} ${target.y}, ${target.x} ${target.y}`;
}

export const GUIDE_TOLERANCE = 6;
export function computeGuides(ids, positions, nodes) {
  const xs = [], ys = [];
  for (const id of ids) {
    const p = positions[id];
    if (!p) continue;
    xs.push(p.x, p.x + NODE_WIDTH / 2, p.x + NODE_WIDTH);
    ys.push(p.y, p.y + NODE_HEIGHT / 2, p.y + NODE_HEIGHT);
  }
  if (!xs.length) return { guides: [], dx: 0, dy: 0 };
  const left = Math.min(...xs), right = Math.max(...xs);
  const top = Math.min(...ys), bottom = Math.max(...ys);
  const boxX = [left, (left + right) / 2, right];
  const boxY = [top, (top + bottom) / 2, bottom];
  const others = nodes.filter(node => !ids.includes(node.id));
  const find = axis => {
    let best = { value: Infinity, pos: null, a: null, b: null };
    for (const other of others) {
      const refs = axis === 'x'
        ? [[other.layout.x, other.layout.y, other.layout.y + NODE_HEIGHT], [other.layout.x + NODE_WIDTH / 2, other.layout.y, other.layout.y + NODE_HEIGHT], [other.layout.x + NODE_WIDTH, other.layout.y, other.layout.y + NODE_HEIGHT]]
        : [[other.layout.y, other.layout.x, other.layout.x + NODE_WIDTH], [other.layout.y + NODE_HEIGHT / 2, other.layout.x, other.layout.x + NODE_WIDTH], [other.layout.y + NODE_HEIGHT, other.layout.x, other.layout.x + NODE_WIDTH]];
      const targets = axis === 'x' ? boxX : boxY;
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
          const diff = refs[i][0] - targets[j];
          if (Math.abs(diff) < GUIDE_TOLERANCE && Math.abs(diff) < Math.abs(best.value)) {
            best = { value: diff, pos: refs[i][0], a: refs[i][1], b: refs[i][2] };
          }
        }
      }
    }
    return best;
  };
  const bx = find('x'), by = find('y');
  const guides = [];
  let dx = 0, dy = 0;
  if (bx.pos !== null) { dx = bx.value; guides.push({ dir: 'v', pos: bx.pos, a: Math.min(top, bx.a), b: Math.max(bottom, bx.b) }); }
  if (by.pos !== null) { dy = by.value; guides.push({ dir: 'h', pos: by.pos, a: Math.min(left, by.a), b: Math.max(right, by.b) }); }
  return { guides, dx, dy };
}

export function groupBounds(group, nodes) {
  const members = nodes.filter(node => group.nodeIds.includes(node.id));
  if (!members.length) return null;
  const left = Math.min(...members.map(node => node.layout.x)) - 34;
  const top = Math.min(...members.map(node => node.layout.y)) - 42;
  const right = Math.max(...members.map(node => node.layout.x + NODE_WIDTH)) + 34;
  const bottom = Math.max(...members.map(node => node.layout.y + NODE_HEIGHT)) + 34;
  return { left, top, width: right - left, height: bottom - top };
}
