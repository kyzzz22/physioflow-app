/**
 * Visual angle calculator for vision science experiments.
 * Converts between physical units (cm, pixels) and visual angle (degrees).
 *
 * Key formulas:
 *   visual_angle_deg = 2 * atan(stimulus_size_cm / (2 * viewing_distance_cm)) * (180 / PI)
 *   stimulus_size_cm  = 2 * viewing_distance_cm * tan(visual_angle_deg / 2 * PI / 180)
 *   pixels_per_cm     = display_width_px / display_width_cm
 *   pixels_per_deg    = pixels_per_cm * viewing_distance_cm * tan(1° in radians) * 2 (approx)
 */

const PI = Math.PI;

/**
 * Convert stimulus size in cm to visual angle in degrees.
 * @param {number} sizeCm - stimulus size in centimeters
 * @param {number} viewingDistanceCm - viewing distance in centimeters
 * @returns {number} visual angle in degrees
 */
export function cmToVisualAngle(sizeCm, viewingDistanceCm) {
  if (!sizeCm || !viewingDistanceCm || viewingDistanceCm <= 0) return 0;
  return 2 * Math.atan(sizeCm / (2 * viewingDistanceCm)) * (180 / PI);
}

/**
 * Convert visual angle in degrees to stimulus size in cm.
 * @param {number} angleDeg - visual angle in degrees
 * @param {number} viewingDistanceCm - viewing distance in centimeters
 * @returns {number} stimulus size in centimeters
 */
export function visualAngleToCm(angleDeg, viewingDistanceCm) {
  if (!angleDeg || !viewingDistanceCm || viewingDistanceCm <= 0) return 0;
  return 2 * viewingDistanceCm * Math.tan((angleDeg / 2) * PI / 180);
}

/**
 * Compute pixels per degree of visual angle.
 * @param {number} displayWidthPx - display width in pixels
 * @param {number} displayWidthCm - display width in centimeters
 * @param {number} viewingDistanceCm - viewing distance in centimeters
 * @returns {number} pixels per visual degree
 */
export function pixelsPerDegree(displayWidthPx, displayWidthCm, viewingDistanceCm) {
  if (!displayWidthPx || !displayWidthCm || !viewingDistanceCm || displayWidthCm <= 0 || viewingDistanceCm <= 0) return 0;
  const cmPerDegree = visualAngleToCm(1, viewingDistanceCm);
  const pixelsPerCm = displayWidthPx / displayWidthCm;
  return Math.round(pixelsPerCm * cmPerDegree * 100) / 100;
}

/**
 * Convert pixels to visual angle degrees.
 * @param {number} pixels - size in pixels
 * @param {number} ppd - pixels per degree (from pixelsPerDegree())
 * @returns {number} visual angle in degrees
 */
export function pixelsToVisualAngle(pixels, ppd) {
  if (!ppd || ppd <= 0) return 0;
  return Math.round(pixels / ppd * 100) / 100;
}

/**
 * Convert visual angle degrees to pixels.
 * @param {number} angleDeg - visual angle in degrees
 * @param {number} ppd - pixels per degree
 * @returns {number} size in pixels
 */
export function visualAngleToPixels(angleDeg, ppd) {
  if (!ppd || ppd <= 0) return 0;
  return Math.round(angleDeg * ppd);
}

/**
 * Compute a complete calibration report.
 * @param {object} params
 * @param {number} params.displayWidthPx - screen width in pixels
 * @param {number} params.displayHeightPx - screen height in pixels
 * @param {number} params.displayWidthCm - screen width in cm (optional)
 * @param {number} params.displayHeightCm - screen height in cm (optional)
 * @param {number} params.viewingDistanceCm - viewing distance in cm
 * @returns {object} calibration report
 */
export function calibrationReport({ displayWidthPx, displayHeightPx, displayWidthCm, displayHeightCm, viewingDistanceCm }) {
  const ppd = displayWidthCm ? pixelsPerDegree(displayWidthPx, displayWidthCm, viewingDistanceCm) : null;
  const report = {
    display_width_px: displayWidthPx,
    display_height_px: displayHeightPx,
    display_width_cm: displayWidthCm || null,
    display_height_cm: displayHeightCm || null,
    viewing_distance_cm: viewingDistanceCm,
    pixels_per_degree: ppd,
    pixels_per_cm: displayWidthCm ? Math.round(displayWidthPx / displayWidthCm * 100) / 100 : null,
    // Common reference sizes
    references: ppd ? {
      one_degree_px: Math.round(ppd),
      two_degrees_px: Math.round(ppd * 2),
      five_degrees_px: Math.round(ppd * 5),
      ten_degrees_px: Math.round(ppd * 10),
      foveal_region_px: Math.round(ppd * 2),   // ~2° central vision
      parafoveal_region_px: Math.round(ppd * 5), // ~5°
    } : null,
  };
  return report;
}

/**
 * Estimate screen dimensions from diagonal size and aspect ratio.
 * @param {number} diagonalInches - screen diagonal in inches
 * @param {number} [aspectRatioX=16] - aspect ratio width component
 * @param {number} [aspectRatioY=9] - aspect ratio height component
 * @returns {{ widthCm: number, heightCm: number }}
 */
export function estimateScreenSize(diagonalInches, aspectRatioX = 16, aspectRatioY = 9) {
  const diagCm = diagonalInches * 2.54;
  const ratio = aspectRatioX / aspectRatioY;
  // width^2 + (width/ratio)^2 = diagCm^2
  // width^2 * (1 + 1/ratio^2) = diagCm^2
  const widthCm = diagCm / Math.sqrt(1 + 1 / (ratio * ratio));
  const heightCm = widthCm / ratio;
  return {
    widthCm: Math.round(widthCm * 10) / 10,
    heightCm: Math.round(heightCm * 10) / 10,
  };
}

/**
 * Get current browser viewport pixel dimensions.
 * Useful for quick calibration estimates.
 * @returns {{ widthPx: number, heightPx: number, devicePixelRatio: number }}
 */
export function getViewportDimensions() {
  return {
    widthPx: window.screen.width * (window.devicePixelRatio || 1),
    heightPx: window.screen.height * (window.devicePixelRatio || 1),
    devicePixelRatio: window.devicePixelRatio || 1,
  };
}
