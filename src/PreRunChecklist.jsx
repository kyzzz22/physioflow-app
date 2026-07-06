import { validateProtocol, stepContentIssues } from './domain.js';
import { Modal } from './Modal.jsx';

const parseTarget = message => {
  const match = String(message || '').match(/Block\s+(\d+)\s*\/\s*Trial\s+(\d+)(?:\s*\/\s*Step\s+(\d+))?/i);
  if (!match) return null;
  return {
    blockIndex: Number(match[1]) - 1,
    trialIndex: Number(match[2]) - 1,
    stepIndex: match[3] ? Number(match[3]) - 1 : null,
  };
};

const issueAdvice = message => {
  const text = String(message || '');
  if (/Prompt.*empty|question title|Prompt/i.test(text)) return {
    title: '问卷题目没有填写',
    summary: '这个 Questionnaire 里有一道题没有标题。参与者看到空白题目时不知道该回答什么。',
    steps: ['点击“定位并修改”打开对应 Questionnaire node。', '在右侧 Questionnaire 区域找到 Question 1。', '在 Prompt 的中文、日文或英文里至少填写一个题目标题。'],
  };
  if (/not placed in the flow/i.test(text)) return {
    title: '步骤没有放进流程图',
    summary: '这个 Step 存在于 Trial 里，但没有对应的 flow node。运行时不会执行它。',
    steps: ['点击“定位并修改”打开对应 Trial。', '如果这个步骤需要运行，请从左侧 Add to flow 重新添加对应 node 并连接。', '如果这是多余步骤，请在高级设置里删除它。'],
  };
  if (/Source URL|uploaded file|media source/i.test(text)) return {
    title: '媒体文件或链接缺失',
    summary: '视频、音频或图片节点没有可播放的来源。',
    steps: ['点击“定位并修改”打开对应媒体 node。', '在右侧 Media source 中填写 URL，或上传本地文件。'],
  };
  if (/external questionnaire URL/i.test(text)) return {
    title: '外部问卷链接缺失',
    summary: '外部问卷模式需要一个 Google Forms、Qualtrics 或其他问卷链接。',
    steps: ['点击“定位并修改”打开 Questionnaire node。', '在 External form URL 中粘贴问卷链接。'],
  };
  if (/Manual continue/i.test(text)) return {
    title: '结束方式需要改为手动继续',
    summary: '这个节点需要参与者或实验员确认完成，不能用固定时间自动跳过。',
    steps: ['点击“定位并修改”打开对应 node。', '把 End mode 改为 Manual continue。'],
  };
  if (/analysis window/i.test(text)) return {
    title: '还没有设置分析窗口',
    summary: '这不会阻止试运行，但导出的 analysis_windows.csv 会没有可直接分析的时间段。',
    steps: ['选择一个 baseline、stimulus、task 或 recovery 节点。', '打开 Generate analysis window，并设置合适的 Role。'],
  };
  return {
    title: '需要检查设置',
    summary: text,
    steps: ['点击“定位并修改”打开相关位置。', '根据右侧提示补齐缺失字段。'],
  };
};

const enrichTarget = (protocol, target) => {
  if (!target) return null;
  const block = protocol.blocks?.[target.blockIndex];
  const trial = block?.trials?.[target.trialIndex];
  const step = target.stepIndex == null ? null : trial?.steps?.[target.stepIndex];
  return {
    ...target,
    block_id: block?.block_id,
    trial_id: trial?.trial_id,
    step_id: step?.step_id,
    blockName: block?.name || `Block ${target.blockIndex + 1}`,
    trialName: trial?.name || `Trial ${target.trialIndex + 1}`,
    stepName: step?.name || step?.type || (target.stepIndex == null ? '' : `Step ${target.stepIndex + 1}`),
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
