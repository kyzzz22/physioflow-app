import { validateProtocol, stepContentIssues } from './domain.js';
import { Modal } from './Modal.jsx';

const parseTarget = message => {
  const text = String(message || '');
  // Format: "Block N / Trial M / Step K: message" or "Block N / Trial M: message"
  let match = text.match(/Block\s+(\d+)\s*\/\s*Trial\s+(\d+)\s*\/\s*Step\s+(\d+)/i);
  if (match) return { blockIndex: Number(match[1]) - 1, trialIndex: Number(match[2]) - 1, stepIndex: Number(match[3]) - 1 };
  // Format: "Block N / Trial M: message"
  match = text.match(/Block\s+(\d+)\s*\/\s*Trial\s+(\d+)/i);
  if (match) return { blockIndex: Number(match[1]) - 1, trialIndex: Number(match[2]) - 1, stepIndex: null };
  // Format: "Step name (step_id)" — try to find by name reference
  match = text.match(/"([^"]+)"/);
  if (match) return { blockIndex: null, trialIndex: null, stepIndex: null, stepName: match[1] };
  return null;
};

const issueAdvice = message => {
  const text = String(message || '');
  // ── Questionnaire ──
  if (/Prompt.*empty|question title|no question title/i.test(text)) return {
    title: '问卷题目缺少标题',
    summary: 'Questionnaire 中有一道题的 Prompt 在所有语言中都是空的，参与者无法知道该回答什么。',
    steps: ['点击”定位并修改”打开对应的 Questionnaire 节点。', '在右侧检查器中找到对应的问题（Question 1, 2...）。', '在 Prompt 中至少填写一种语言（中文/日文/英文）。'],
  };
  if (/Options.*required|add at least one/i.test(text)) return {
    title: '选择题缺少选项',
    summary: '单选题或多选题需要至少一个可选项，否则参与者无法作答。',
    steps: ['点击”定位并修改”打开对应的 Questionnaire 节点。', '在对应问题的 Options 中添加至少一个选项。'],
  };
  if (/external questionnaire URL/i.test(text)) return {
    title: '外部问卷链接缺失',
    summary: '外部问卷模式需要 Google Forms、Qualtrics 或其他问卷服务的链接。',
    steps: ['点击”定位并修改”打开 Questionnaire 节点。', '在 External form URL 中粘贴完整的问卷链接（https://...）。'],
  };
  // ── Flow ──
  if (/not placed in the flow/i.test(text)) return {
    title: '步骤未放入流程图',
    summary: '这个 Step 在 Trial 中存在，但流程图中没有对应的事件节点，运行时会被跳过。',
    steps: ['从左侧”Add to flow”面板添加对应类型的事件节点。', '或者从”Steps outside flow”面板中点击 Insert 插入。', '如果不需要这个步骤，可以点击 Remove unused 删除。'],
  };
  // ── Media ──
  if (/Source URL|uploaded file|media source|No media source/i.test(text)) return {
    title: '媒体来源缺失',
    summary: '视频、音频或图片节点没有可播放的文件或链接。',
    steps: ['点击”定位并修改”打开对应的媒体节点。', '在右侧检查器的 Media source 中填写 URL 或上传本地文件。'],
  };
  // ── Duration / end mode ──
  if (/Manual continue/i.test(text)) return {
    title: '结束方式需要设为手动',
    summary: '外部问卷等节点需要参与者或操作员手动确认完成，不能用定时自动跳过。',
    steps: ['点击”定位并修改”打开对应节点。', '把 End mode 切换为 Manual continue。'],
  };
  if (/Duration.*required|Fixed time.*duration/i.test(text)) return {
    title: '缺少固定时长',
    summary: '节点设置为 Fixed time 模式但还没有填写 Duration 毫秒数。',
    steps: ['点击”定位并修改”打开对应节点。', '在 Duration (ms) 输入框中填写一个大于 0 的毫秒数。'],
  };
  // ── Response ──
  if (/Response variable.*empty|response.*variable.*required/i.test(text)) return {
    title: 'Response 变量名缺失',
    summary: 'Response 步骤需要一个变量名（如 response 或 rating），用于在 Condition 节点中引用。',
    steps: ['点击”定位并修改”打开 Response 节点。', '在 Response variable 中填写变量名。'],
  };
  if (/response options/i.test(text)) return {
    title: 'Response 选项缺失',
    summary: 'Response 步骤需要至少一个选项（value | label | key 格式）。',
    steps: ['点击”定位并修改”打开 Response 节点。', '在 Options 文本框里添加至少一行选项。'],
  };
  // ── Content ──
  if (/Content is empty|No instruction text/i.test(text)) return {
    title: '参与者内容为空',
    summary: '该步骤的「Participant content」在所有语言中都是空的。这不影响试运行，但参与者可能看不到引导信息。',
    steps: ['点击”定位并修改”打开对应节点。', '在 Participant content 中至少填写一种语言的内容。'],
  };
  // ── Analysis ──
  if (/analysis window/i.test(text)) return {
    title: '未设置分析窗口',
    summary: '整个方案中没有步骤启用 Generate analysis window，导出的 analysis_windows.csv 将为空。',
    steps: ['选择一个 baseline、stimulus、task 或 recovery 节点。', '勾选 ↗ analysis 并设置合适的 Role。'],
  };
  // ── Looping ──
  if (/looping.*never ends|loop.*media/i.test(text)) return {
    title: '循环播放与结束模式冲突',
    summary: '媒体节点开启了循环（Loop）但结束模式设为”When media ends”，这样播放永远不会停止。',
    steps: ['点击”定位并修改”打开对应的媒体节点。', '关闭 Loop，或将 End mode 改为 Fixed time / Manual continue。'],
  };
  // ── Controls ──
  if (/controls.*hidden|participant.*click.*controls/i.test(text)) return {
    title: '手动开始与播放控件冲突',
    summary: '开始模式设为”Participant click”但播放控件被隐藏了，参与者无法触发播放。',
    steps: ['点击”定位并修改”打开对应的媒体节点。', '开启 Show player controls，或将 Start mode 改为 Automatic。'],
  };
  // ── Structural ──
  if (/Protocol name|protocol name/i.test(text)) return {
    title: '方案名称未填写',
    summary: '请给方案一个名称，便于在项目列表中区分。',
    steps: ['在编辑器顶部标题栏输入方案名称。'],
  };
  if (/At least one block/i.test(text)) return {
    title: '方案结构为空',
    summary: '方案中没有任何 Block，需要先创建 Block → Trial → Step 的层级结构。',
    steps: ['点击”+ Add block”创建第一个 Block。', '然后在 Block 里添加 Trial 和 Step。'],
  };
  if (/no Trials|no Steps|trial.*no Step/i.test(text)) return {
    title: '层级结构不完整',
    summary: 'Block 内缺少 Trial，或 Trial 内缺少 Step。',
    steps: ['点击”定位并修改”跳转到对应位置。', '添加缺失的 Trial 或 Step。'],
  };
  // ── Default ──
  return {
    title: '需要检查配置',
    summary: text,
    steps: ['点击”定位并修改”跳转到对应位置。', '根据右侧检查器的提示补充缺失字段。'],
  };
};

const enrichTarget = (protocol, target) => {
  if (!target) return null;
  // If we only have a step name, search the protocol to resolve indices
  let blockIndex = target.blockIndex;
  let trialIndex = target.trialIndex;
  let stepIndex = target.stepIndex;
  if (target.stepName && (blockIndex == null || trialIndex == null)) {
    for (let bi = 0; bi < (protocol.blocks || []).length; bi++) {
      for (let ti = 0; ti < (protocol.blocks[bi].trials || []).length; ti++) {
        const si = (protocol.blocks[bi].trials[ti].steps || []).findIndex(s => s.name === target.stepName || s.type === target.stepName);
        if (si >= 0) { blockIndex = bi; trialIndex = ti; stepIndex = si; break; }
      }
      if (blockIndex != null) break;
    }
  }
  if (blockIndex == null) {
    // Can't resolve — return partial info
    return { ...target, blockName: '', trialName: '', stepName: target.stepName || '' };
  }
  const block = protocol.blocks?.[blockIndex];
  const trial = block?.trials?.[trialIndex];
  const step = stepIndex == null ? null : trial?.steps?.[stepIndex];
  return {
    blockIndex, trialIndex, stepIndex,
    block_id: block?.block_id,
    trial_id: trial?.trial_id,
    step_id: step?.step_id,
    blockName: block?.name || `Block ${blockIndex + 1}`,
    trialName: trial?.name || `Trial ${trialIndex + 1}`,
    stepName: step?.name || step?.type || (stepIndex == null ? '' : `Step ${stepIndex + 1}`),
  };
};

function FixCard({ severity = 'error', title, summary, steps = [], location, raw, onFix }) {
  const canFix = Boolean(onFix && location);
  return <article className={`fix-card ${severity}`}>
    <div className="fix-card-main">
      <b>{title}</b>
      <p>{summary}</p>
      {location && <small>{location.blockName} → {location.trialName}{location.stepName ? ` → ${location.stepName}` : ''}</small>}
    </div>
    {steps.length > 0 && <ol>{steps.map((step, index) => <li key={index}>{step}</li>)}</ol>}
    <div className="fix-card-actions">
      {canFix && <button className="primary" onClick={() => onFix(location)}>定位并修改</button>}
      {raw && <details><summary>查看原始提示</summary><code>{raw}</code></details>}
    </div>
  </article>;
}

export default function PreRunChecklist({ protocol, storageInfo, onChooseDataDirectory, onClose, onContinue, onFix }) {
  const check = validateProtocol(protocol);
  const stimuli = protocol.stimuli || [];
  const questionnaires = protocol.questionnaires || [];
  const requiresLocalStorage = protocol.status === 'frozen';
  const storageBlocked = requiresLocalStorage && !storageInfo?.selected;

  const stepIssues = [];
  protocol.blocks.forEach((block, bi) => {
    block.trials.forEach((trial, ti) => {
      trial.steps.forEach((step, si) => {
        const issues = stepContentIssues(step, stimuli, questionnaires);
        if (issues.length) {
          stepIssues.push({
            location: enrichTarget(protocol, { blockIndex: bi, trialIndex: ti, stepIndex: si }),
            issues,
          });
        }
      });
    });
  });

  const protocolErrors = check.errors.map(message => ({
    message,
    location: enrichTarget(protocol, parseTarget(message)),
    advice: issueAdvice(message),
  }));
  const protocolWarnings = check.warnings.map(message => ({
    message,
    location: enrichTarget(protocol, parseTarget(message)),
    advice: issueAdvice(message),
  }));
  const coveredByProtocolError = (location, issue) => (
    issue.key === 'empty_prompt'
    && protocolErrors.some(item => item.location?.step_id === location?.step_id && /Prompt/i.test(item.message))
  );
  const cleanedWarningStepIssues = stepIssues
    .map(item => ({ ...item, issues: item.issues.filter(issue => issue.kind === 'warn' && !coveredByProtocolError(item.location, issue)) }))
    .filter(item => item.issues.length);

  const blockingStepIssues = stepIssues.filter(item => item.issues.some(issue => issue.kind === 'error'));
  const totalIssues = protocolErrors.length + blockingStepIssues.length + (storageBlocked ? 1 : 0);
  const totalWarnings = protocolWarnings.length + cleanedWarningStepIssues.length;

  return (
    <Modal open onClose={onClose}>
      <div className="pre-run-checklist">
        <span className="pre-run-icon">{totalIssues > 0 ? '!' : 'i'}</span>
        <h3>{totalIssues > 0 ? `${totalIssues} 个问题需要先修复` : '可以开始试运行'}</h3>
        <p className="pre-run-lead">
          {totalIssues > 0
            ? '下面每一项都写了为什么不能运行，以及应该点哪里修改。先处理“必须修复”，建议项可以稍后再看。'
            : `方案已经通过运行前检查。${totalWarnings > 0 ? `还有 ${totalWarnings} 个建议项，不影响试运行。` : ''}`}
        </p>

        {protocolErrors.length > 0 && <section className="fix-section">
          <h4>必须修复</h4>
          {protocolErrors.map((item, index) => (
            <FixCard
              key={`error-${index}`}
              severity="error"
              title={item.advice.title}
              summary={item.advice.summary}
              steps={item.advice.steps}
              location={item.location}
              raw={item.message}
              onFix={onFix}
            />
          ))}
        </section>}

        {storageBlocked && <section className="fix-section">
          <h4>必须修复</h4>
          <FixCard
            severity="error"
            title="需要选择本地数据文件夹"
            summary="正式采集必须写入你选择的本地文件夹，不能只放在浏览器管理的缓存里。"
            steps={['点击下面的按钮选择 PhysioFlow Data 文件夹。', '选择完成后再开始正式 session。']}
          />
          {onChooseDataDirectory && <button className="primary" onClick={onChooseDataDirectory}>选择本地数据文件夹</button>}
        </section>}

        {blockingStepIssues.length > 0 && <section className="fix-section">
          <h4>节点内容问题</h4>
          {blockingStepIssues.map((item, index) => item.issues.filter(issue => issue.kind === 'error').map((issue, issueIndex) => {
            const advice = issueAdvice(issue.message);
            return <FixCard key={`step-error-${index}-${issueIndex}`} severity="error" title={advice.title} summary={advice.summary} steps={advice.steps} location={item.location} raw={issue.message} onFix={onFix} />;
          }))}
        </section>}

        {(protocolWarnings.length > 0 || cleanedWarningStepIssues.length > 0) && <section className="fix-section notes">
          <h4>建议项</h4>
          {protocolWarnings.map((item, index) => (
            <FixCard key={`warning-${index}`} severity="warning" title={item.advice.title} summary={item.advice.summary} steps={item.advice.steps} location={item.location} raw={item.message} onFix={onFix} />
          ))}
          {cleanedWarningStepIssues.map((item, index) => item.issues.map((issue, issueIndex) => {
            const advice = issueAdvice(issue.message);
            return <FixCard key={`step-warning-${index}-${issueIndex}`} severity="warning" title={advice.title} summary={advice.summary} steps={advice.steps} location={item.location} raw={issue.message} onFix={onFix} />;
          }))}
        </section>}

        <div className="modal-actions">
          {totalIssues === 0 && <button className="primary" onClick={onContinue} autoFocus>继续到 Session 设置</button>}
          <button onClick={onClose}>{totalIssues > 0 ? '关闭' : '取消'}</button>
        </div>
      </div>
    </Modal>
  );
}
