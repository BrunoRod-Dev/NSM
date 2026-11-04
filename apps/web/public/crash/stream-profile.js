const profiles = {
  smooth: { bitrate: 1200000, fps: 30, width: 480, height: 360 },
  balanced: { bitrate: 2000000, fps: 30, width: 640, height: 480 },
  quality: { bitrate: 4000000, fps: 30, width: 960, height: 720 },
};
export const validProfile = value => Object.hasOwn(profiles, value);
export const isAppleMobile = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function preferCompatibleVideo(pc) {
  const codecs = globalThis.RTCRtpReceiver?.getCapabilities?.('video')?.codecs;
  if (!codecs?.some(codec => codec.mimeType.toLowerCase() === 'video/h264')) return;
  const sorted = [...codecs.filter(codec => codec.mimeType.toLowerCase() === 'video/h264'), ...codecs.filter(codec => codec.mimeType.toLowerCase() !== 'video/h264')];
  for (const transceiver of pc.getTransceivers()) {
    if ((transceiver.sender.track?.kind ?? transceiver.receiver.track?.kind) !== 'video') continue;
    try { transceiver.setCodecPreferences?.(sorted); } catch { /* Keep negotiated browser defaults if unsupported. */ }
  }
}

export async function setVideoProfile(entry, key, canvas) {
  if (!validProfile(key) || !entry.videoSender) return;
  entry.requestedProfile = key;
  if (entry.applyingProfile) return;
  entry.applyingProfile = true;
  try {
    while (entry.profile !== entry.requestedProfile) {
      const next = entry.requestedProfile;
      const profile = profiles[next];
      const params = entry.videoSender.getParameters();
      if (!params.encodings?.length) params.encodings = [{}];
      for (const encoding of params.encodings) {
        encoding.maxBitrate = profile.bitrate;
        encoding.maxFramerate = profile.fps;
        encoding.scaleResolutionDownBy = Math.max(1, (canvas?.width || 640) / profile.width, (canvas?.height || 480) / profile.height);
      }
      // Let the browser lower resolution instead of turning motion into a slideshow.
      params.degradationPreference = 'maintain-framerate';
      await entry.videoSender.setParameters(params);
      entry.profile = next;
    }
  } catch { /* Browser congestion control still works without optional settings. */ }
  finally { entry.applyingProfile = false; }
}
