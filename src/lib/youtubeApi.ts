export interface YTPlayerOptions {
  host?: string;
  videoId: string;
  width?: string | number;
  height?: string | number;
  playerVars?: {
    autoplay?: 0 | 1;
    controls?: 0 | 1;
    disablekb?: 0 | 1;
    enablejsapi?: 0 | 1;
    fs?: 0 | 1;
    iv_load_policy?: 1 | 3;
    modestbranding?: 0 | 1;
    origin?: string;
    playsinline?: 0 | 1;
    rel?: 0 | 1;
  };
  events?: {
    onReady?: (event: { target: YTPlayerInstance }) => void;
    onStateChange?: (event: { target: YTPlayerInstance; data: number }) => void;
    onPlaybackRateChange?: (event: { target: YTPlayerInstance; data: number }) => void;
    onPlaybackQualityChange?: (event: { target: YTPlayerInstance; data: string }) => void;
    onError?: (event: { target: YTPlayerInstance; data: number }) => void;
  };
}

export interface YTPlayerInstance {
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  mute: () => void;
  unMute: () => void;
  isMuted: () => boolean;
  setVolume: (volume: number) => void;
  getVolume: () => number;
  setPlaybackRate: (suggestedRate: number) => void;
  getPlaybackRate: () => number;
  getAvailablePlaybackRates: () => number[];
  setPlaybackQuality: (suggestedQuality: string) => void;
  getPlaybackQuality: () => string;
  getAvailableQualityLevels: () => string[];
  getCurrentTime: () => number;
  getDuration: () => number;
  getVideoLoadedFraction: () => number;
  getPlayerState: () => number;
  destroy: () => void;
}

export interface YTNamespace {
  Player: new (element: HTMLElement | string, options: YTPlayerOptions) => YTPlayerInstance;
  PlayerState: {
    UNSTARTED: number;
    ENDED: number;
    PLAYING: number;
    PAUSED: number;
    BUFFERING: number;
    CUED: number;
  };
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiLoadPromise: Promise<YTNamespace> | null = null;

export function loadYouTubeIframeApi(): Promise<YTNamespace> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('YouTube player requires a browser environment.'));
  }

  if (window.YT?.Player) {
    return Promise.resolve(window.YT);
  }

  if (apiLoadPromise) {
    return apiLoadPromise;
  }

  apiLoadPromise = new Promise<YTNamespace>((resolve, reject) => {
    const existingCallback = window.onYouTubeIframeAPIReady;

    window.onYouTubeIframeAPIReady = () => {
      if (existingCallback) {
        existingCallback();
      }
      if (window.YT?.Player) {
        resolve(window.YT);
      } else {
        apiLoadPromise = null;
        reject(new Error('YouTube Player API initialized without Player constructor.'));
      }
    };

    const existingScript = document.querySelector<HTMLScriptElement>(
      'script[src="https://www.youtube.com/iframe_api"]'
    );

    if (!existingScript) {
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.async = true;
      script.onerror = () => {
        apiLoadPromise = null;
        reject(new Error('Unable to load the video playback engine. Check your connection or ad-blocker.'));
      };
      document.head.appendChild(script);
    }

    // Safety check in case script loaded concurrently right before listener attached
    const poll = window.setInterval(() => {
      if (window.YT?.Player) {
        window.clearInterval(poll);
        resolve(window.YT);
      }
    }, 100);

    window.setTimeout(() => {
      window.clearInterval(poll);
    }, 15000);
  });

  return apiLoadPromise;
}
