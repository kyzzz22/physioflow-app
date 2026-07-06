import { useEffect, useMemo, useRef, useState } from 'react';
import { loadAsset } from './assetStore';

function youtubeEmbedUrl(url) {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    let id = parsed.hostname.includes('youtu.be') ? parsed.pathname.slice(1) : parsed.searchParams.get('v');
    if (parsed.pathname.includes('/embed/')) id = parsed.pathname.split('/embed/')[1].split('/')[0];
    if (parsed.pathname.includes('/shorts/')) id = parsed.pathname.split('/shorts/')[1].split('/')[0];
    // enablejsapi=1 lets us receive postMessage state-change events
    return id ? `https://www.youtube-nocookie.com/embed/${id}?rel=0&playsinline=1&enablejsapi=1` : '';
  } catch { return ''; }
}

export default function MediaStep({ step, onMediaEvent, onComplete, preview }) {
  const [localUrl, setLocalUrl] = useState('');
  const mediaRef = useRef(null);
  const eventHandler = useRef(onMediaEvent);
  const completeHandler = useRef(onComplete);
  const resumeAfterPause = useRef(false);
  const source = step.source_url || '';
  const youtubeUrl = useMemo(() => step.source_mode === 'youtube' ? youtubeEmbedUrl(source) : '', [source, step.source_mode]);
  const ytReady = useRef(false);
  const ytEnded = useRef(false);

  useEffect(() => { eventHandler.current = onMediaEvent; }, [onMediaEvent]);
  useEffect(() => { completeHandler.current = onComplete; }, [onComplete]);

  // ── YouTube postMessage listener ──
  useEffect(() => {
    if (step.source_mode !== 'youtube' || !youtubeUrl) return;
    ytEnded.current = false;
    ytReady.current = false;
    const handler = (e) => {
      if (e.origin !== 'https://www.youtube-nocookie.com') return;
      let data;
      try { data = JSON.parse(e.data); } catch { return; }
      // YouTube IFrame API sends infoDelivery events
      if (data.event === 'infoDelivery' && data.info) {
        // Player state: -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued
        const state = data.info.playerState;
        if (!ytReady.current) {
          ytReady.current = true;
          eventHandler.current('media_ready');
        }
        if (state === 1 && !ytReady.current) {
          // started playing
          ytReady.current = true;
        }
        if (state === 1) eventHandler.current('media_play_started');
        if (state === 2) eventHandler.current('media_paused');
        if (state === 0 && !ytEnded.current) {
          ytEnded.current = true;
          eventHandler.current('media_ended');
          if (step.duration_mode === 'media' && step.auto_advance !== false) {
            completeHandler.current();
          }
        }
      }
      // Also handle onReady delivery events
      if (data.event === 'onReady') {
        eventHandler.current('media_ready');
      }
      if (data.event === 'onStateChange' && data.info === 0 && !ytEnded.current) {
        ytEnded.current = true;
        eventHandler.current('media_ended');
        if (step.duration_mode === 'media' && step.auto_advance !== false) {
          completeHandler.current();
        }
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [youtubeUrl, step.source_mode, step.duration_mode, step.auto_advance]);

  useEffect(() => {
    let active = true;
    let objectUrl = '';
    if (step.source_mode === 'upload' && step.asset_id) loadAsset(step.asset_id).then(asset => {
      if (!active) return;
      if (!asset?.file) { eventHandler.current('media_error', { status: 'error', reason: 'uploaded_asset_missing', asset_id: step.asset_id }); return; }
      objectUrl = URL.createObjectURL(asset.file);
      setLocalUrl(objectUrl);
    }).catch(error => { if (active) eventHandler.current('media_error', { status: 'error', reason: 'asset_load_failed', message: error.message }); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [step.asset_id, step.source_mode]);

  const mediaUrl = step.source_mode === 'upload' ? localUrl : source;
  useEffect(() => { if (mediaRef.current && typeof step.volume === 'number') mediaRef.current.volume = step.volume; }, [mediaUrl, step.volume]);

  useEffect(() => {
    const pause = () => { const m = mediaRef.current; if (m && !m.paused) { resumeAfterPause.current = true; m.pause(); } };
    const resume = () => { const m = mediaRef.current; if (m && resumeAfterPause.current) { resumeAfterPause.current = false; eventHandler.current('media_resumed'); m.play().catch(() => {}); } };
    window.addEventListener('physioflow:pause', pause);
    window.addEventListener('physioflow:resume', resume);
    return () => { window.removeEventListener('physioflow:pause', pause); window.removeEventListener('physioflow:resume', resume); };
  }, []);

  const common = {
    ref: mediaRef,
    src: mediaUrl,
    controls: step.show_controls !== false,
    autoPlay: step.start_mode === 'auto',
    muted: Boolean(step.muted),
    loop: Boolean(step.loop),
    preload: 'auto',
    onLoadStart: () => onMediaEvent('media_load_requested'),
    onCanPlay: () => onMediaEvent('media_ready'),
    onPlay: () => onMediaEvent('media_play_started'),
    onPause: () => onMediaEvent('media_paused'),
    onEnded: () => { onMediaEvent('media_ended'); if (step.duration_mode === 'media' && step.auto_advance !== false) onComplete(); },
    onError: () => onMediaEvent('media_error', { status: 'error' }),
    onVolumeChange: e => { if (typeof step.volume === 'number') e.currentTarget.volume = step.volume; },
  };

  if (step.source_mode === 'youtube') return youtubeUrl ? (
    <div className="embed-frame">
      <iframe src={youtubeUrl} title={step.name} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen
        onLoad={() => { /* ready handled by postMessage */ }}
      />
    </div>
  ) : <div className="media-error">Invalid YouTube URL</div>;

  if (step.source_mode === 'upload' && step.asset_id && !localUrl) return <div className="media-loading">Loading uploaded media…</div>;
  if (!mediaUrl) return <div className="media-error">No media source assigned</div>;

  const previewStyle = preview ? { maxWidth: 260, maxHeight: 180, borderRadius: 6, border: '1px solid var(--line)' } : {};
  if (step.type === 'image') return <img className="native-image" src={mediaUrl} alt={step.name} style={previewStyle} onLoad={() => { onMediaEvent('media_ready'); if (step.duration_mode === 'media') onMediaEvent('media_ended', { semantic: 'image_loaded' }); if (step.duration_mode === 'media' && step.auto_advance !== false) onComplete(); }} onError={() => { onMediaEvent('media_error', { status: 'error', code: 'image_load_failed' }); if (step.duration_mode === 'media' && step.auto_advance !== false) onComplete(); }} />;

  return step.type === 'audio'
    ? <div className="audio-player" style={preview ? { padding: '1.5rem', gap: '.5rem' } : {}}><div className="audio-art" style={preview ? { width: 60, height: 60, fontSize: '2rem' } : {}}>♫</div><audio {...common} controls={preview || step.show_controls !== false} /></div>
    : <video className="native-video" playsInline style={preview ? { maxWidth: 260, maxHeight: 160, borderRadius: 6 } : {}} {...common} />;
}
