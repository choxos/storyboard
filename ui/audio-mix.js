export function audioGain(audio, time, projectDuration) {
  if (!audio || audio.mix?.muted) return 0;
  const end = Math.min(audio.duration_ms, projectDuration);
  if (time < 0 || time >= end) return 0;
  const mix = audio.mix || {};
  const fadeIn = Math.min(mix.fade_in_ms || 0, end);
  const fadeOut = Math.min(mix.fade_out_ms || 0, end);
  return (
    (mix.volume ?? 1) *
    (fadeIn ? Math.min(1, time / fadeIn) : 1) *
    (fadeOut ? Math.min(1, (end - time) / fadeOut) : 1)
  );
}
