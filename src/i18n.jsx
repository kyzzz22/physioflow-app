import { createContext, useContext, useEffect, useRef, useState } from 'react';

const dictionaries = {
  zh: {
    'EXPERIMENT WORKSPACE':'实验工作区','Design the flow.':'设计流程。','Trust the timeline.':'信任时间线。','New protocol':'新建实验方案','Import protocol':'导入实验方案','Edit flow':'编辑流程','New version':'新版本','Duplicate':'复制','Archive':'归档','Run':'正式运行','Sessions':'实验记录','Manage sessions':'管理实验记录',
    'Add to flow':'添加到流程','Drag later to arrange':'添加后可拖动排列','Presentation':'呈现','Media':'媒体','Interaction':'交互','Flow control':'流程控制','Instruction':'指导语','Fixation':'注视点','Timer':'计时器','Rest':'休息','Video':'视频','Audio':'音频','Image':'图片','Questionnaire':'问卷','Manual event':'手动事件','Device check':'设备检查','Condition':'条件','True / false':'真 / 假','Loop':'循环','Body / exit':'循环体 / 退出','Auto layout':'自动布局','Ready':'就绪','Select a node':'选择节点','Delete node':'删除节点','Delete connection':'删除连接','Display label':'显示名称','Event type':'事件类型','Timing & behavior':'时间与行为','Start mode':'开始方式','End mode':'结束方式','Duration (milliseconds)':'时长（毫秒）','Automatically continue':'自动继续','Operator may skip':'实验员可跳过','Media resource':'媒体资源','Source':'来源','Upload file':'上传文件','Resource URL':'资源地址','Show player controls':'显示播放器控件','Participant content':'参与者内容','Questionnaire designer':'问卷设计器','Add question':'添加问题','Required':'必填','Questionnaire name':'问卷名称','Minimum':'最小值','Maximum':'最大值','Continue when':'满足以下条件时继续','Variable':'变量','Comparison':'比较方式','Value':'值','Maximum iterations':'最大循环次数',
    'Review, export and validate':'审核、导出与验证','Select a Session':'选择一条实验记录','Automatic integrity check':'自动完整性检查','Researcher validity':'研究者有效性判断','Researcher notes':'研究者备注','Save review':'保存审核','Delete Session':'删除实验记录','No Sessions stored.':'尚无实验记录。','No integrity issue detected':'未检测到完整性问题','Export complete bundle':'导出完整数据包',
    'Create protocol':'新建实验方案','Use emotion template':'使用情绪实验模板','Import JSON':'导入 JSON','Protocols':'实验方案','Recent sessions':'最近的实验记录','saved locally':'保存在本地','stored':'条记录','No protocol yet. Start from a blank canvas or load the five-condition template.':'暂无实验方案。可从空白方案或五条件情绪实验模板开始。','Local-first workspace':'本地优先工作区','Projects':'项目','Export config':'导出配置','Save':'保存','Freeze':'冻结版本','Test run':'试运行','Step palette':'步骤组件','Protocol check':'方案检查','Ready to run':'可以运行','Add trial':'添加 Trial','Add block':'添加 Block','Customize complete trial interface':'自定义完整 Trial 界面','Background':'背景','Text color':'文字颜色','Content width':'内容宽度','Alignment':'对齐方式','Padding':'内边距','Spacing':'间距','Progress':'显示进度','Step label':'显示步骤类型','End mode':'结束方式','Fixed time':'固定时间','When media ends':'媒体结束时','Manual continue':'手动继续','Duration (ms)':'时长（毫秒）','Start':'开始方式','Automatic':'自动','Participant click':'参与者点击','Auto advance':'自动跳转','Media source':'媒体来源','Direct URL':'直链','YouTube embed':'YouTube 嵌入','Upload local file':'上传本地文件','Choose media file':'选择媒体文件','Source URL':'媒体地址','Volume':'音量','Controls':'播放器控件','Muted':'静音','Loop':'循环','SESSION SETUP':'SESSION 设置','Participant ID':'参与者 ID','Participant language':'参与者语言','Operator ID':'实验员 ID','Device start reference':'设备开始时间参考','Order row':'顺序行','Protocol integrity':'方案完整性','Start session':'开始实验','READY':'准备就绪','Begin experiment':'开始实验','Pause':'暂停','Resume':'继续','Skip':'跳过','Abort':'中止','Continue':'继续','Quick markers':'快速异常标记','events captured':'个事件已记录','SESSION COMPLETE':'实验完成','events':'事件','steps':'步骤','export files':'导出文件','Export complete bundle':'导出完整数据包','Return to projects':'返回项目','How do you feel right now?':'您现在感觉如何？','Submit response':'提交回答','Waiting for operator confirmation.':'等待实验员确认。','seconds planned':'计划秒数','Left':'左对齐','Center':'居中','Right':'右对齐','Draft test run — no frozen hash':'草稿试运行——尚无冻结哈希','No media source assigned':'未设置媒体来源','Invalid YouTube URL':'无效的 YouTube 地址'
  },
  ja: {
    'EXPERIMENT WORKSPACE':'実験ワークスペース','Design the flow.':'フローを設計。','Trust the timeline.':'タイムラインを信頼。','New protocol':'新規プロトコル','Import protocol':'プロトコル読込','Edit flow':'フロー編集','New version':'新しいバージョン','Duplicate':'複製','Archive':'アーカイブ','Run':'本実行','Sessions':'セッション','Manage sessions':'セッション管理',
    'Add to flow':'フローに追加','Drag later to arrange':'追加後にドラッグして配置','Presentation':'提示','Media':'メディア','Interaction':'インタラクション','Flow control':'フロー制御','Instruction':'教示','Fixation':'注視点','Timer':'タイマー','Rest':'休憩','Video':'動画','Audio':'音声','Image':'画像','Questionnaire':'アンケート','Manual event':'手動イベント','Device check':'デバイス確認','Condition':'条件','True / false':'真 / 偽','Loop':'ループ','Body / exit':'本体 / 終了','Auto layout':'自動配置','Ready':'準備完了','Select a node':'ノードを選択','Delete node':'ノード削除','Delete connection':'接続削除','Display label':'表示ラベル','Event type':'イベント種別','Timing & behavior':'時間と動作','Start mode':'開始方法','End mode':'終了方法','Duration (milliseconds)':'時間（ミリ秒）','Automatically continue':'自動で続行','Operator may skip':'実験者がスキップ可能','Media resource':'メディア資源','Source':'ソース','Upload file':'ファイルをアップロード','Resource URL':'リソースURL','Show player controls':'プレイヤー操作を表示','Participant content':'参加者向け内容','Questionnaire designer':'アンケート設計','Add question':'質問を追加','Required':'必須','Questionnaire name':'アンケート名','Minimum':'最小値','Maximum':'最大値','Continue when':'次の条件で続行','Variable':'変数','Comparison':'比較','Value':'値','Maximum iterations':'最大反復回数',
    'Review, export and validate':'確認・出力・検証','Select a Session':'セッションを選択','Automatic integrity check':'自動整合性チェック','Researcher validity':'研究者による有効性','Researcher notes':'研究者メモ','Save review':'確認を保存','Delete Session':'セッション削除','No Sessions stored.':'保存済みセッションはありません。','No integrity issue detected':'整合性の問題は検出されませんでした','Export complete bundle':'完全データを書き出す',
    'Create protocol':'プロトコル作成','Use emotion template':'感情実験テンプレート','Import JSON':'JSONを読み込む','Protocols':'プロトコル','Recent sessions':'最近のセッション','saved locally':'ローカル保存','stored':'件保存','No protocol yet. Start from a blank canvas or load the five-condition template.':'プロトコルはまだありません。空白または5条件テンプレートから開始できます。','Local-first workspace':'ローカル優先ワークスペース','Projects':'プロジェクト','Export config':'設定を書き出す','Save':'保存','Freeze':'凍結','Test run':'テスト実行','Step palette':'ステップ一覧','Protocol check':'プロトコル確認','Ready to run':'実行できます','Add trial':'Trialを追加','Add block':'Blockを追加','Customize complete trial interface':'Trial画面全体をカスタマイズ','Background':'背景','Text color':'文字色','Content width':'コンテンツ幅','Alignment':'配置','Padding':'余白','Spacing':'間隔','Progress':'進捗を表示','Step label':'ステップ種別を表示','End mode':'終了方法','Fixed time':'固定時間','When media ends':'メディア終了時','Manual continue':'手動で続行','Duration (ms)':'時間（ミリ秒）','Start':'開始方法','Automatic':'自動','Participant click':'参加者がクリック','Auto advance':'自動で次へ','Media source':'メディアソース','Direct URL':'直接URL','YouTube embed':'YouTube埋め込み','Upload local file':'ローカルファイル','Choose media file':'メディアを選択','Source URL':'ソースURL','Volume':'音量','Controls':'再生コントロール','Muted':'ミュート','Loop':'ループ','SESSION SETUP':'セッション設定','Participant ID':'参加者ID','Participant language':'参加者の言語','Operator ID':'実験者ID','Device start reference':'デバイス開始時刻の参照','Order row':'順序行','Protocol integrity':'プロトコル整合性','Start session':'セッション開始','READY':'準備完了','Begin experiment':'実験開始','Pause':'一時停止','Resume':'再開','Skip':'スキップ','Abort':'中止','Continue':'次へ','Quick markers':'クイックマーカー','events captured':'件のイベント','SESSION COMPLETE':'セッション完了','events':'イベント','steps':'ステップ','export files':'出力ファイル','Export complete bundle':'完全データを書き出す','Return to projects':'プロジェクトへ戻る','How do you feel right now?':'今の気分を教えてください。','Submit response':'回答を送信','Waiting for operator confirmation.':'実験者の確認を待っています。','seconds planned':'予定秒数','Left':'左','Center':'中央','Right':'右','Draft test run — no frozen hash':'ドラフトテスト——凍結ハッシュなし','No media source assigned':'メディアソース未設定','Invalid YouTube URL':'無効なYouTube URL'
  },
  en: {},
};

Object.assign(dictionaries.zh,{
  'Projects':'项目','Blocks & Trials':'区块与试次','Stimuli':'刺激资源','Questionnaires':'问卷库','Save flow':'保存流程','Advanced settings':'高级设置','Editing':'正在编辑','EXPERIMENT STRUCTURE':'实验结构','Blocks and Trials':'区块与试次','Add Trial':'添加试次','Add Block':'添加区块','Duplicate project':'复制项目','Archive project':'归档项目','Rename':'重命名','Edit draft':'编辑草稿','Run latest':'运行最新版本','Version history':'版本历史','View':'查看','Close':'关闭','Delete':'删除','Repeat':'重复次数','Condition':'条件','Fixed':'固定','Random':'随机','Latin square':'拉丁方','Manual':'手动',
  'STIMULUS LIBRARY':'刺激资源库','Reusable media resources':'可复用媒体资源','Add stimulus':'添加刺激资源','Local upload':'本地上传','QUESTIONNAIRE LIBRARY':'问卷库','Reusable questionnaires':'可复用问卷','Add questionnaire':'添加问卷','Shared stimulus library':'共享刺激资源库','Reusable resource':'可复用资源','Shared questionnaire library':'共享问卷库','Reusable questionnaire':'可复用问卷','Detach as editable copy':'分离为可编辑副本','Node-local questionnaire':'节点独立问卷',
  'Integrity & analysis':'完整性与分析','Required for a valid Session':'有效 Session 必须完成','Operator may retry':'实验员可重试','Recovery after reload':'刷新后的恢复方式','Resume remaining time':'继续剩余时间','Restart this event':'重新开始此事件','Wait for operator':'等待实验员','Generate analysis window':'生成分析窗口','Analysis role':'分析角色','Analysis label':'分析标签',
  'Device synchronization':'设备时间同步','Sync method':'同步方式','Same computer clock':'同一电脑时钟','Manual offset':'手动偏移','Manual sync marker':'手动同步标记','Offset (ms)':'偏移量（毫秒）','Device time column':'设备时间列','Time format':'时间格式','Epoch milliseconds':'Unix 毫秒','Epoch seconds':'Unix 秒','Relative milliseconds':'相对毫秒','Timezone':'时区','Sampling rate (Hz)':'采样率（Hz）','Actual Trial order preview':'实际试次顺序预览','Manual order':'手动顺序',
  'Instant markers':'瞬时标记','Interval marker':'区间标记','Start interval':'开始区间','End interval':'结束区间','Participant fullscreen':'参与者全屏','SESSION DATA':'Session 数据','Unreviewed':'未审核','Valid':'有效','Invalid':'无效','Exclude from analysis':'排除分析',
  'Analytics':'数据分析','No completed sessions':'暂无完成的实验','timeline':'时间线','windows':'分析窗口','responses':'回答','compare':'对比','Export chart as PNG':'导出图表为PNG','Task':'任务','Recovery':'恢复','Baseline':'基线','Stimulus':'刺激','Custom':'自定义','seconds':'秒',
  // v0.3.0 — new UI text
  'nodes':'节点','connections':'连接','Snap':'吸附','Flow snapshots':'流程快照','+ Save':'+ 保存','Restore':'恢复','Rename':'重命名','Delete':'删除','No snapshots yet. Save a snapshot to preserve your current flow layout.':'暂无快照。保存快照以保留当前流程布局。',
  'Steps outside flow':'未放入流程的步骤','Insert':'插入','Remove unused':'移除未使用','Connect':'连接','Cancel':'取消',
  'Quick note':'快速笔记','Markers':'标记','events captured':'个事件已记录','Recording':'记录中','Start here':'从这里开始','Tutorial':'教程','Storage':'存储','Storage guide':'存储指南','Data folder':'数据文件夹','Help':'帮助',
  'Saved':'已保存','Save flow':'保存流程','Built-in guide':'内置指南','Data format':'数据格式','Export JSON':'导出 JSON','Freeze version':'冻结版本','Unfreeze version':'解冻版本','Advanced settings':'高级设置',
  'Navigation':'导航','Blocks & Trials':'区块与试次','Stimuli library':'刺激资源库','Questionnaire library':'问卷库',
  'Export simplified data':'导出简化数据','Export complete (advanced)':'导出完整数据（高级）','Export complete bundle (advanced)':'导出完整数据包（高级）',
  'Saved to local storage. The export bundle is ready.':'已保存到本地存储。导出数据包已就绪。',
  'Session review saved':'Session 审核已保存','Loading Session…':'正在加载 Session…','Select a Session':'选择一条 Session',
  'No Sessions stored.':'尚无存储的 Session。','Automatic integrity check':'自动完整性检查','No integrity issue detected':'未检测到完整性问题',
  'Researcher validity':'研究者有效性判断','Researcher notes':'研究者备注','Save review':'保存审核',
  'Export package':'导出数据包','Delete this session':'删除此 Session',
  'nodes ·':'节点 ·',
  'node':'节点','edge':'连线','Continue →':'继续 →','Abort session?':'中止 Session？',
  'This will mark the session as aborted. All data so far will be preserved.':'这将标记 Session 为已中止。所有已记录数据将被保留。',
  'SESSION COMPLETE':'Session 完成','events':'事件','steps':'步骤','export files':'导出文件',
  'Return to projects':'返回项目列表','Discard recovery?':'放弃恢复？',
  'Discard':'放弃','Resume experiment':'恢复实验','UNFINISHED SESSION':'未完成的 Session',
  'Building protocol index…':'正在构建方案索引…','No projects yet':'暂无项目',
  'projects':'项目','active projects':'活跃项目','frozen versions':'已冻结版本','sessions':'Session','ready':'就绪',
  'Fix':'定位并修改','Dismiss':'关闭','Show palette':'显示面板','Hide palette':'隐藏面板','Show inspector':'显示检查器','Hide inspector':'隐藏检查器',
  'Preview (double-click)':'预览（双击）','Preview step (double-click)':'预览步骤（双击）',
  'Duration mode':'时长模式','Planned':'计划时长','Start mode':'开始方式','Auto advance':'自动继续',
  'Analysis window':'分析窗口','Close preview':'关闭预览',
  'No media source configured':'未配置媒体来源','Uploaded file':'已上传文件',
  'Source':'来源','YouTube':'YouTube','URL':'链接','Vol':'音量','Muted':'静音','Looping':'循环','Controls visible':'显示控件',
});
Object.assign(dictionaries.ja,{
  'Projects':'プロジェクト','Blocks & Trials':'Block・Trial','Stimuli':'刺激ライブラリ','Questionnaires':'アンケート','Save flow':'フロー保存','Advanced settings':'詳細設定','Editing':'編集中','EXPERIMENT STRUCTURE':'実験構造','Blocks and Trials':'Block と Trial','Add Trial':'Trialを追加','Add Block':'Blockを追加','Duplicate project':'プロジェクト複製','Archive project':'プロジェクトを保管','Rename':'名前変更','Edit draft':'ドラフト編集','Run latest':'最新版を実行','Version history':'バージョン履歴','View':'表示','Close':'閉じる','Delete':'削除','Repeat':'反復回数','Condition':'条件','Fixed':'固定','Random':'ランダム','Latin square':'ラテン方格','Manual':'手動',
  'STIMULUS LIBRARY':'刺激ライブラリ','Reusable media resources':'再利用可能なメディア','Add stimulus':'刺激を追加','Local upload':'ローカルアップロード','QUESTIONNAIRE LIBRARY':'アンケートライブラリ','Reusable questionnaires':'再利用可能なアンケート','Add questionnaire':'アンケートを追加','Shared stimulus library':'共有刺激ライブラリ','Reusable resource':'再利用リソース','Shared questionnaire library':'共有アンケート','Reusable questionnaire':'再利用アンケート','Detach as editable copy':'編集可能なコピーとして分離','Node-local questionnaire':'ノード固有アンケート',
  'Integrity & analysis':'整合性・分析','Required for a valid Session':'有効なSessionに必須','Operator may retry':'実験者が再試行可能','Recovery after reload':'再読込後の復旧','Resume remaining time':'残り時間から再開','Restart this event':'イベントを再開始','Wait for operator':'実験者を待つ','Generate analysis window':'分析区間を生成','Analysis role':'分析役割','Analysis label':'分析ラベル',
  'Device synchronization':'デバイス時刻同期','Sync method':'同期方法','Same computer clock':'同一PC時刻','Manual offset':'手動オフセット','Manual sync marker':'手動同期マーカー','Offset (ms)':'オフセット（ms）','Device time column':'デバイス時刻列','Time format':'時刻形式','Epoch milliseconds':'Unixミリ秒','Epoch seconds':'Unix秒','Relative milliseconds':'相対ミリ秒','Timezone':'タイムゾーン','Sampling rate (Hz)':'サンプリング周波数（Hz）','Actual Trial order preview':'実際のTrial順序プレビュー','Manual order':'手動順序',
  'Instant markers':'瞬時マーカー','Interval marker':'区間マーカー','Start interval':'区間開始','End interval':'区間終了','Participant fullscreen':'参加者画面を全画面表示','SESSION DATA':'Sessionデータ','Unreviewed':'未確認','Valid':'有効','Invalid':'無効','Exclude from analysis':'分析から除外',
  'Analytics':'分析','No completed sessions':'完了したセッションがありません','timeline':'タイムライン','windows':'分析区間','responses':'回答','compare':'比較','Export chart as PNG':'PNGでエクスポート','Task':'課題','Recovery':'回復','Baseline':'ベースライン','Stimulus':'刺激','Custom':'カスタム','seconds':'秒',
  // v0.3.0 — new UI text
  'nodes':'ノード','connections':'接続','Snap':'スナップ','Flow snapshots':'フロースナップショット','+ Save':'+ 保存','Restore':'復元','Rename':'名前変更','Delete':'削除','No snapshots yet. Save a snapshot to preserve your current flow layout.':'スナップショットはまだありません。現在のフローレイアウトを保存してください。',
  'Steps outside flow':'フロー外のステップ','Insert':'挿入','Remove unused':'未使用を削除','Connect':'接続','Cancel':'キャンセル',
  'Quick note':'クイックメモ','Markers':'マーカー','events captured':'イベント記録済','Recording':'記録中','Start here':'ここから始める','Tutorial':'チュートリアル','Storage':'ストレージ','Storage guide':'ストレージガイド','Data folder':'データフォルダ','Help':'ヘルプ',
  'Saved':'保存済','Save flow':'フロー保存','Built-in guide':'内蔵ガイド','Data format':'データ形式','Export JSON':'JSON出力','Freeze version':'バージョン凍結','Unfreeze version':'凍結解除','Advanced settings':'詳細設定',
  'Navigation':'ナビゲーション','Blocks & Trials':'Block・Trial','Stimuli library':'刺激ライブラリ','Questionnaire library':'アンケートライブラリ',
  'Export simplified data':'簡易データ出力','Export complete (advanced)':'完全出力（詳細）','Export complete bundle (advanced)':'完全データ出力（詳細）',
  'Saved to local storage. The export bundle is ready.':'ローカルストレージに保存されました。出力パッケージの準備ができました。',
  'Session review saved':'セッション審査を保存しました','Loading Session…':'セッション読込中…','Select a Session':'セッションを選択',
  'No Sessions stored.':'保存済みセッションはありません。','Automatic integrity check':'自動整合性チェック','No integrity issue detected':'整合性の問題は検出されませんでした',
  'Researcher validity':'研究者による有効性判断','Researcher notes':'研究者メモ','Save review':'審査を保存',
  'Export package':'出力パッケージ','Delete this session':'このセッションを削除',
  'nodes ·':'ノード ·',
  'node':'ノード','edge':'エッジ','Continue →':'続行 →','Abort session?':'セッションを中止しますか？',
  'This will mark the session as aborted. All data so far will be preserved.':'セッションを中止としてマークします。これまでのデータはすべて保持されます。',
  'SESSION COMPLETE':'セッション完了','events':'イベント','steps':'ステップ','export files':'出力ファイル',
  'Return to projects':'プロジェクトに戻る','Discard recovery?':'回復を破棄しますか？',
  'Discard':'破棄','Resume experiment':'実験を再開','UNFINISHED SESSION':'未完了のセッション',
  'Building protocol index…':'プロトコル索引を構築中…','No projects yet':'プロジェクトなし',
  'projects':'プロジェクト','active projects':'アクティブプロジェクト','frozen versions':'凍結バージョン','sessions':'セッション','ready':'準備完了',
  'Fix':'修正','Dismiss':'閉じる','Show palette':'パレットを表示','Hide palette':'パレットを隠す','Show inspector':'インスペクタを表示','Hide inspector':'インスペクタを隠す',
  'Preview (double-click)':'プレビュー（ダブルクリック）','Preview step (double-click)':'ステップをプレビュー（ダブルクリック）',
  'Duration mode':'時間モード','Planned':'予定','Start mode':'開始モード','Auto advance':'自動進行',
  'Analysis window':'分析区間','Close preview':'プレビューを閉じる',
  'No media source configured':'メディアソースが設定されていません','Uploaded file':'アップロードファイル',
  'Source':'ソース','YouTube':'YouTube','URL':'URL','Vol':'音量','Muted':'ミュート','Looping':'ループ中','Controls visible':'コントロール表示',
});

const LanguageContext = createContext(null);
const translationState = new WeakMap();

export function LanguageProvider({ children }) {
  const [language, setLanguageState] = useState(() => localStorage.getItem('physioflow.ui-language') || 'en');
  const root = useRef(null);
  const setLanguage = next => { localStorage.setItem('physioflow.ui-language', next); setLanguageState(next); };
  useEffect(() => {
    const translate = () => {
      if (!root.current) return;
      const walker = document.createTreeWalker(root.current, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const current=node.nodeValue.trim(),known=translationState.get(node);
        const raw=known&&current===known.rendered?known.raw:current;
        if (!raw || (!dictionaries.zh[raw] && !dictionaries.ja[raw])) continue;
        const leading = node.nodeValue.match(/^\s*/)?.[0] || '';
        const trailing = node.nodeValue.match(/\s*$/)?.[0] || '';
        const rendered=dictionaries[language][raw]||raw,nextValue=leading+rendered+trailing;
        translationState.set(node,{raw,rendered});
        if (node.nodeValue !== nextValue) node.nodeValue = nextValue;
      }
    };
    translate();
    if (root.current) {
      const observer = new MutationObserver(translate);
      observer.observe(root.current, { childList: true, subtree: true, characterData: true });
      return () => observer.disconnect();
    }
  }, [language]);
  return <LanguageContext.Provider value={{ language, setLanguage }}><div ref={root}>{children}</div></LanguageContext.Provider>;
}

export function useLanguage() { return useContext(LanguageContext); }
export function LanguageToggle() {
  const { language, setLanguage } = useLanguage();
  return <div className="language-toggle" aria-label="Language"><button className={language==='zh'?'active':''} onClick={() => setLanguage('zh')}>中文</button><button className={language==='ja'?'active':''} onClick={() => setLanguage('ja')}>日本語</button><button className={language==='en'?'active':''} onClick={() => setLanguage('en')}>EN</button></div>;
}

export function DarkModeToggle() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark-mode'));
  const toggle = () => {
    setDark(d => {
      const next = !d;
      document.documentElement.classList.toggle('dark-mode', next);
      document.documentElement.classList.toggle('light-mode', !next);
      localStorage.setItem('physioflow.dark-mode', next ? '1' : '0');
      return next;
    });
  };
  return <button className="dark-mode-btn" onClick={toggle} title={dark ? 'Switch to light mode' : 'Switch to dark mode'}>{dark ? '☀' : '🌙'}</button>;
}
