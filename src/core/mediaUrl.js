// Media-source URL helpers. Pure, DOM-free, unit-testable.

/**
 * Convert a YouTube watch / youtu.be / /shorts/ / /embed/ URL into an embeddable
 * iframe URL. Returns '' when the URL is not a recognizable YouTube video link.
 * @param {string} url
 * @returns {string} youtube-nocookie embed URL or ''
 */
export function youtubeEmbedUrl(url) {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    let id = parsed.hostname.includes('youtu.be') ? parsed.pathname.slice(1) : parsed.searchParams.get('v');
    if (parsed.pathname.includes('/embed/')) id = parsed.pathname.split('/embed/')[1].split('/')[0];
    if (parsed.pathname.includes('/shorts/')) id = parsed.pathname.split('/shorts/')[1].split('/')[0];
    // enablejsapi=1 lets the player report start/ended state via postMessage.
    return id ? `https://www.youtube-nocookie.com/embed/${id}?rel=0&playsinline=1&enablejsapi=1` : '';
  } catch { return ''; }
}

/**
 * Whether a media source should render as an embedded YouTube player rather than a
 * bare <video src>. Mirrors youtubeEmbedUrl() so callers don't double-parse.
 * @param {string} url
 * @returns {boolean}
 */
export function isYoutubeSource(url) {
  return Boolean(url && youtubeEmbedUrl(url));
}
