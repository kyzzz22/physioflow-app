import { useRef, useEffect } from 'react';
import { drawBarChart, drawScatterPlot, COLORS } from './charts.js';

// ResponseCharts — Visualize questionnaire responses
export default function ResponseCharts({ responses, protocol }) {
  if (!responses?.length) {
    return <div className="empty" style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}>No responses recorded</div>;
  }

  // Build question index
  const questions = buildQuestionIndex(protocol);
  const groups = groupByQuestion(responses, questions);

  if (!Object.keys(groups).length) {
    return <div className="empty" style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}>No questionnaire data found in protocol</div>;
  }

  // Check for SAM data
  const valence = groups['sam_valence']?.map(r => parseInt(r.value));
  const arousal = groups['sam_arousal']?.map(r => parseInt(r.value));
  const hasSam = valence?.length > 0 && arousal?.length > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <h3 style={{ fontSize: '0.95rem', fontWeight: 600 }}>Response Analysis ({responses.length} answers)</h3>

      {/* SAM plot */}
      {hasSam && <SAMPlot valence={valence} arousal={arousal} />}

      {/* Bar charts for each Likert / choice question */}
      {Object.entries(groups).map(([qId, answers]) => {
        const q = questions[qId];
        if (!q || ['sam_valence', 'sam_arousal'].includes(q.type)) return null;
        return <QuestionChart key={qId} question={q} answers={answers} />;
      })}

      {/* Summary table */}
      <ResponseTable groups={groups} questions={questions} />
    </div>
  );
}

function SAMPlot({ valence, arousal }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    const points = valence.map((v, i) => ({ x: v, y: arousal[i] || 0 }));

    // Heatmap: multiple points at same position get bigger size
    const countMap = new Map();
    points.forEach(p => {
      const key = `${p.x}_${p.y}`;
      countMap.set(key, (countMap.get(key) || 0) + 1);
    });

    const uniquePoints = [...new Map(points.map(p => [`${p.x}_${p.y}`, {
      x: p.x, y: p.y,
      count: countMap.get(`${p.x}_${p.y}`),
      color: `rgba(59, 130, 246, ${0.2 + (countMap.get(`${p.x}_${p.y}`) / Math.max(...countMap.values())) * 0.6})`,
    }])).values()].map(p => ({
      ...p,
      size: 6 + (p.count / Math.max(...countMap.values())) * 18,
    }));

    drawScatterPlot(canvasRef.current, {
      points: uniquePoints,
      width: 380,
      height: 380,
      xLabel: 'Valence',
      yLabel: 'Arousal',
      title: 'SAM: Valence × Arousal',
      xMax: 9,
      yMax: 9,
      pointSize: 8,
    });
  }, [valence, arousal]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', color: COLORS.muted }}>
        <span>Valence: Low (1) → High (9) pleasure</span>
        <span>Arousal: Low (1) → High (9) excitement</span>
      </div>
      <canvas ref={canvasRef} />
      <div style={{ fontSize: '0.7rem', color: COLORS.muted, textAlign: 'center' }}>
        Bubble size = frequency. {valence.length} responses.
      </div>
    </div>
  );
}

function QuestionChart({ question, answers }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    if (['likert'].includes(question.type) || (question.scale_min != null && question.scale_max != null)) {
      // Likert / scale: show bar chart of distribution
      const min = question.scale_min ?? 1;
      const max = question.scale_max ?? 7;
      const range = Array.from({ length: max - min + 1 }, (_, i) => min + i);
      const counts = range.map(v => answers.filter(a => parseInt(a.value) === v).length);
      drawBarChart(canvasRef.current, {
        data: counts,
        labels: range.map(String),
        width: 500,
        height: 220,
        padding: 40,
        title: (question.prompt || question.question_id).substring(0, 40),
        valueFormatter: v => String(v),
      });
    } else if (['single_choice', 'multiple_choice'].includes(question.type)) {
      // Choice: count per option
      const options = question.options || [];
      const counts = options.map(opt => {
        if (question.type === 'multiple_choice') {
          return answers.filter(a => (a.value || '').split('|').includes(opt.value || opt)).length;
        }
        return answers.filter(a => a.value === (opt.value || opt)).length;
      });
      drawBarChart(canvasRef.current, {
        data: counts,
        labels: options.map(o => (o.label || o.value || '').substring(0, 8)),
        width: 500,
        height: 220,
        padding: 45,
        title: (question.prompt || question.question_id).substring(0, 40),
        valueFormatter: v => String(v),
      });
    }
  }, [question, answers]);

  const qType = question.type || 'unknown';
  if (!['likert', 'single_choice', 'multiple_choice'].includes(qType) && question.scale_min == null) {
    // Text/number responses — show summary
    return (
      <div style={{ fontSize: '0.8rem', padding: '0.5rem' }}>
        <b>{question.question_id}</b>: {answers.length} text responses
      </div>
    );
  }

  return <canvas ref={canvasRef} style={{ width: '100%', maxWidth: 500 }} />;
}

function ResponseTable({ groups, questions }) {
  return (
    <details>
      <summary style={{ fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer' }}>Response summary table</summary>
      <table style={{ width: '100%', fontSize: '0.75rem', borderCollapse: 'collapse', marginTop: '0.5rem' }}>
        <thead>
          <tr style={{ background: '#f8fafc' }}>
            <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '2px solid var(--line)' }}>Question</th>
            <th style={{ padding: '6px 8px', textAlign: 'center', borderBottom: '2px solid var(--line)' }}>Type</th>
            <th style={{ padding: '6px 8px', textAlign: 'center', borderBottom: '2px solid var(--line)' }}>Count</th>
            <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '2px solid var(--line)' }}>Values</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(groups).map(([qId, answers]) => {
            const q = questions[qId] || {};
            const values = [...new Set(answers.map(a => a.value))]
              .filter(Boolean)
              .sort()
              .slice(0, 5);
            return (
              <tr key={qId} style={{ borderBottom: '1px solid var(--line)' }}>
                <td style={{ padding: '4px 8px' }}>{q.prompt || qId}</td>
                <td style={{ padding: '4px 8px', textAlign: 'center', color: COLORS.muted, fontSize: '0.7rem' }}>{q.type || '?'}</td>
                <td style={{ padding: '4px 8px', textAlign: 'center', fontWeight: 600 }}>{answers.length}</td>
                <td style={{ padding: '4px 8px', color: COLORS.muted, fontSize: '0.7rem' }}>
                  {values.join(', ')}
                  {values.length < [...new Set(answers.map(a => a.value))].length ? ' …' : ''}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </details>
  );
}

// ── Helpers ──
function buildQuestionIndex(protocol) {
  const index = {};
  try {
    (protocol?.blocks || []).forEach(b =>
      (b.trials || []).forEach(t =>
        (t.steps || []).forEach(s => {
          if (s.questionnaire?.questions) {
            s.questionnaire.questions.forEach(q => { index[q.question_id] = q; });
          }
        })
      ));
    (protocol?.questionnaires || []).forEach(lib => {
      (lib.questions || []).forEach(q => { index[q.question_id] = q; });
    });
  } catch { /* ignore */ }
  return index;
}

function groupByQuestion(responses) {
  const groups = {};
  responses.forEach(r => {
    if (!groups[r.question_id]) groups[r.question_id] = [];
    groups[r.question_id].push(r);
  });
  return groups;
}
