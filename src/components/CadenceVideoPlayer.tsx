import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Settings,
  SkipForward,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {
  loadYouTubeIframeApi,
  YTPlayerInstance,
} from '@/src/lib/youtubeApi';
import { resolveAssetUrl } from '@/src/lib/utils';

interface CadenceVideoPlayerProps {
  videoId: string;
  title: string;
  subtitle?: string;
  posterImage?: string;
  playTrigger?: number;
  hasNextLecture?: boolean;
  onNextLecture?: () => void;
  onEnded?: () => void;
  compact?: boolean;
}

const SPEED_OPTIONS = [0.75, 1, 1.25, 1.5, 2] as const;
const FALLBACK_QUALITY_LEVELS = ['hd1080', 'hd720', 'large', 'medium', 'small'] as const;
const QUALITY_ORDER = [
  'highres',
  'hd2160',
  'hd1440',
  'hd1080',
  'hd720',
  'large',
  'medium',
  'small',
  'tiny',
] as const;

function formatQualityShort(quality: string): string {
  switch (quality) {
    case 'highres':
    case 'hd2160':
      return '4K';
    case 'hd1440':
      return '1440p';
    case 'hd1080':
      return '1080p';
    case 'hd720':
      return '720p';
    case 'large':
      return '480p';
    case 'medium':
      return '360p';
    case 'small':
      return '240p';
    case 'tiny':
      return '144p';
    default:
      return 'Auto';
  }
}

function formatQualityLabel(quality: string): string {
  switch (quality) {
    case 'highres':
      return 'Original (4K+)';
    case 'hd2160':
      return '2160p (4K)';
    case 'hd1440':
      return '1440p HD';
    case 'hd1080':
      return '1080p HD';
    case 'hd720':
      return '720p HD';
    case 'large':
      return '480p';
    case 'medium':
      return '360p';
    case 'small':
      return '240p';
    case 'tiny':
      return '144p';
    default:
      return 'Auto';
  }
}

function formatVideoTime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
    return '0:00';
  }
  const rounded = Math.floor(totalSeconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const seconds = rounded % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function mapYouTubeError(code: number): string {
  switch (code) {
    case 2:
      return 'Invalid lecture video ID. Verify the unlisted YouTube link in Admin Console.';
    case 5:
      return 'This browser could not initialize HTML5 video playback.';
    case 100:
      return 'This lecture video is unavailable or has been set to Private. Unlisted videos must remain Unlisted.';
    case 101:
    case 150:
      return 'Embedding is disabled on this video. Enable "Allow embedding" in YouTube Studio for this unlisted lecture.';
    default:
      return 'Unable to play this lecture video right now.';
  }
}

function autoStartInitial(playTrigger: number): boolean {
  return playTrigger > 0;
}

export function CadenceVideoPlayer({
  videoId,
  title,
  subtitle,
  posterImage,
  playTrigger = 0,
  hasNextLecture = false,
  onNextLecture,
  onEnded,
  compact = false,
}: CadenceVideoPlayerProps) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const mountHostRef = useRef<HTMLDivElement | null>(null);
  const qualityMenuRef = useRef<HTMLDivElement | null>(null);
  const scrubTrackRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YTPlayerInstance | null>(null);
  const pendingPlayRef = useRef(false);
  const hideControlsTimerRef = useRef<number | null>(null);
  const autoplayWatchdogRef = useRef<number | null>(null);
  const spinnerFailsafeRef = useRef<number | null>(null);
  const playTriggerRef = useRef(playTrigger);
  const prevVideoIdRef = useRef(videoId);
  const selectedQualityRef = useRef<string>('default');
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;

  const [playerReady, setPlayerReady] = useState(false);
  const [hasStarted, setHasStarted] = useState(autoStartInitial(playTrigger));
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(autoStartInitial(playTrigger));
  const [isEnded, setIsEnded] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedFraction, setBufferedFraction] = useState(0);
  const [isSeeking, setIsSeeking] = useState(false);
  const [volume, setVolume] = useState(100);
  const [isMuted, setIsMuted] = useState(false);
  const [autoMutedHint, setAutoMutedHint] = useState(false);
  const [playbackRate, setPlaybackRate] = useState<number>(1);
  const [availableRates, setAvailableRates] = useState<number[]>([...SPEED_OPTIONS]);
  const [selectedQuality, setSelectedQuality] = useState<string>('default');
  const [actualQuality, setActualQuality] = useState<string>('unknown');
  const [availableQualities, setAvailableQualities] = useState<string[]>([]);
  const [showQualityMenu, setShowQualityMenu] = useState(false);
  const [isNativeFullscreen, setIsNativeFullscreen] = useState(false);
  const [isFallbackFullscreen, setIsFallbackFullscreen] = useState(false);
  const [isRotatedLandscape, setIsRotatedLandscape] = useState(false);
  const isFullscreen = isNativeFullscreen || isFallbackFullscreen;
  const [showControls, setShowControls] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  playTriggerRef.current = playTrigger;
  selectedQualityRef.current = selectedQuality;

  const scheduleHideControls = useCallback(() => {
    if (hideControlsTimerRef.current) {
      window.clearTimeout(hideControlsTimerRef.current);
      hideControlsTimerRef.current = null;
    }
    setShowControls(true);
    if (isPlaying && !showQualityMenu) {
      hideControlsTimerRef.current = window.setTimeout(() => {
        setShowControls(false);
      }, 2400);
    }
  }, [isPlaying, showQualityMenu]);

  useEffect(() => {
    if (!isPlaying || showQualityMenu) {
      if (hideControlsTimerRef.current) {
        window.clearTimeout(hideControlsTimerRef.current);
        hideControlsTimerRef.current = null;
      }
      setShowControls(true);
    } else {
      scheduleHideControls();
    }
  }, [isPlaying, showQualityMenu, scheduleHideControls]);

  useEffect(() => {
    const onFullscreenChange = () => {
      const active = document.fullscreenElement === stageRef.current;
      setIsNativeFullscreen(active);
      if (!active) {
        setIsRotatedLandscape(false);
        try {
          (
            screen.orientation as ScreenOrientation & { unlock?: () => void }
          )?.unlock?.();
        } catch {
          // Ignore if unsupported
        }
      }
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange);
    };
  }, []);

  useEffect(() => {
    if (!isRotatedLandscape) return;
    const handleResize = () => {
      // If user physically rotates device to landscape, stop CSS 90deg rotation so it doesn't double-rotate
      if (window.innerWidth >= window.innerHeight) {
        setIsRotatedLandscape(false);
      }
    };
    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
    };
  }, [isRotatedLandscape]);

  useEffect(() => {
    if (!isFallbackFullscreen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        setIsFallbackFullscreen(false);
        setIsRotatedLandscape(false);
      }
    };
    window.addEventListener('keydown', handleEsc, true);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', handleEsc, true);
    };
  }, [isFallbackFullscreen]);

  // Close quality menu when clicking or tapping outside
  useEffect(() => {
    if (!showQualityMenu) return;
    const handleOutside = (e: MouseEvent | TouchEvent) => {
      if (
        qualityMenuRef.current &&
        !qualityMenuRef.current.contains(e.target as Node)
      ) {
        setShowQualityMenu(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('touchstart', handleOutside, { passive: true });
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('touchstart', handleOutside);
    };
  }, [showQualityMenu]);

  const syncQualityLevels = useCallback((player: YTPlayerInstance) => {
    try {
      const levels = player.getAvailableQualityLevels?.() ?? [];
      const filtered = QUALITY_ORDER.filter((q) => levels.includes(q));
      if (filtered.length > 0) {
        setAvailableQualities(filtered);
      }
      const activeQ = player.getPlaybackQuality?.();
      if (activeQ && activeQ !== 'unknown') {
        setActualQuality(activeQ);
      }
    } catch {
      // Ignore while transitioning
    }
  }, []);

  // Mount & configure YouTube IFrame API player into an isolated DOM node
  useEffect(() => {
    let cancelled = false;
    const autoStart = playTriggerRef.current > 0;
    prevVideoIdRef.current = videoId;

    setPlayerReady(false);
    setHasStarted(autoStart);
    setIsPlaying(false);
    setIsBuffering(autoStart);
    setIsEnded(false);
    setCurrentTime(0);
    setDuration(0);
    setBufferedFraction(0);
    setActualQuality('unknown');
    setAvailableQualities([]);
    setAutoMutedHint(false);
    setShowQualityMenu(false);
    setErrorMessage(null);
    pendingPlayRef.current = autoStart;

    if (autoplayWatchdogRef.current) {
      window.clearTimeout(autoplayWatchdogRef.current);
      autoplayWatchdogRef.current = null;
    }
    if (spinnerFailsafeRef.current) {
      window.clearTimeout(spinnerFailsafeRef.current);
      spinnerFailsafeRef.current = null;
    }

    const hostEl = mountHostRef.current;
    if (!hostEl) return;
    hostEl.innerHTML = '';

    const mountNode = document.createElement('div');
    mountNode.className = 'w-full h-full';
    hostEl.appendChild(mountNode);

    const startAutoplayWithMobileFallback = (player: YTPlayerInstance, YT: Awaited<ReturnType<typeof loadYouTubeIframeApi>>) => {
      if (autoplayWatchdogRef.current) {
        window.clearTimeout(autoplayWatchdogRef.current);
        autoplayWatchdogRef.current = null;
      }
      if (spinnerFailsafeRef.current) {
        window.clearTimeout(spinnerFailsafeRef.current);
        spinnerFailsafeRef.current = null;
      }

      player.playVideo();

      // Mobile browsers (iOS Safari / Android Chrome) often block unmuted cross-origin iframe autoplay
      // once the tap activation expires during YT initialization; fall back to muted autoplay so video starts automatically.
      autoplayWatchdogRef.current = window.setTimeout(() => {
        if (cancelled) return;
        try {
          const st = player.getPlayerState?.();
          if (st !== YT.PlayerState.PLAYING) {
            player.mute();
            setIsMuted(true);
            setAutoMutedHint(true);
            player.playVideo();

            spinnerFailsafeRef.current = window.setTimeout(() => {
              if (cancelled) return;
              try {
                const stAfter = player.getPlayerState?.();
                if (stAfter !== YT.PlayerState.PLAYING && stAfter !== YT.PlayerState.BUFFERING) {
                  setIsBuffering(false);
                  setHasStarted(false);
                  setAutoMutedHint(false);
                }
              } catch {
                setIsBuffering(false);
              }
            }, 1800);
          }
        } catch {
          // Ignore transient state read errors
        }
      }, 750);
    };

    loadYouTubeIframeApi()
      .then((YT) => {
        if (cancelled || !mountHostRef.current) return;

        const instance = new YT.Player(mountNode, {
          host: 'https://www.youtube-nocookie.com',
          videoId,
          width: '100%',
          height: '100%',
          playerVars: {
            autoplay: autoStart ? 1 : 0,
            controls: 0,
            disablekb: 1,
            enablejsapi: 1,
            fs: 0,
            iv_load_policy: 3,
            modestbranding: 1,
            origin: window.location.origin,
            playsinline: 1,
            rel: 0,
          },
          events: {
            onReady: (event) => {
              if (cancelled) return;
              playerRef.current = event.target;
              const iframeEl = mountHostRef.current?.querySelector('iframe');
              if (iframeEl) {
                iframeEl.setAttribute(
                  'allow',
                  'autoplay; encrypted-media; picture-in-picture; fullscreen'
                );
                iframeEl.setAttribute('playsinline', '1');
              }
              setPlayerReady(true);
              const dur = event.target.getDuration();
              if (Number.isFinite(dur) && dur > 0) {
                setDuration(dur);
              }
              const rates = event.target.getAvailablePlaybackRates?.();
              if (Array.isArray(rates) && rates.length > 0) {
                setAvailableRates(
                  SPEED_OPTIONS.filter((r) => rates.includes(r))
                );
              }
              syncQualityLevels(event.target);
              if (selectedQualityRef.current !== 'default') {
                event.target.setPlaybackQuality(selectedQualityRef.current);
              }
              if (pendingPlayRef.current) {
                pendingPlayRef.current = false;
                startAutoplayWithMobileFallback(event.target, YT);
              }
            },
            onStateChange: (event) => {
              if (cancelled) return;
              const state = event.data;
              const PS = YT.PlayerState;
              const dur = event.target.getDuration();
              if (Number.isFinite(dur) && dur > 0) {
                setDuration(dur);
              }

              if (state === PS.PLAYING) {
                if (autoplayWatchdogRef.current) {
                  window.clearTimeout(autoplayWatchdogRef.current);
                  autoplayWatchdogRef.current = null;
                }
                if (spinnerFailsafeRef.current) {
                  window.clearTimeout(spinnerFailsafeRef.current);
                  spinnerFailsafeRef.current = null;
                }
                setHasStarted(true);
                setIsPlaying(true);
                setIsBuffering(false);
                setIsEnded(false);
                syncQualityLevels(event.target);
                if (selectedQualityRef.current !== 'default') {
                  event.target.setPlaybackQuality(selectedQualityRef.current);
                }
              } else if (state === PS.PAUSED || state === PS.CUED) {
                setIsPlaying(false);
                setIsBuffering(false);
              } else if (state === PS.BUFFERING) {
                setHasStarted(true);
                setIsBuffering(true);
              } else if (state === PS.ENDED) {
                setIsPlaying(false);
                setIsBuffering(false);
                setIsEnded(true);
                setCurrentTime(dur > 0 ? dur : event.target.getCurrentTime());
                onEndedRef.current?.();
              }
            },
            onPlaybackRateChange: (event) => {
              if (!cancelled && Number.isFinite(event.data)) {
                setPlaybackRate(event.data);
              }
            },
            onPlaybackQualityChange: (event) => {
              if (!cancelled && typeof event.data === 'string') {
                setActualQuality(event.data);
                syncQualityLevels(event.target);
              }
            },
            onError: (event) => {
              if (cancelled) return;
              setIsPlaying(false);
              setIsBuffering(false);
              setErrorMessage(mapYouTubeError(event.data));
            },
          },
        });

        playerRef.current = instance;
      })
      .catch((err) => {
        if (!cancelled) {
          setErrorMessage(
            err instanceof Error ? err.message : 'Unable to initialize lecture player.'
          );
        }
      });

    return () => {
      cancelled = true;
      if (hideControlsTimerRef.current) {
        window.clearTimeout(hideControlsTimerRef.current);
        hideControlsTimerRef.current = null;
      }
      if (autoplayWatchdogRef.current) {
        window.clearTimeout(autoplayWatchdogRef.current);
        autoplayWatchdogRef.current = null;
      }
      if (spinnerFailsafeRef.current) {
        window.clearTimeout(spinnerFailsafeRef.current);
        spinnerFailsafeRef.current = null;
      }
      if (playerRef.current) {
        try {
          playerRef.current.destroy();
        } catch {
          // Ignore teardown errors when iframe is already detached
        }
        playerRef.current = null;
      }
      if (mountHostRef.current) {
        mountHostRef.current.innerHTML = '';
      }
    };
  }, [videoId, reloadNonce, syncQualityLevels]);

  // If user clicks the currently active lecture again in the playlist, start/resume playback immediately
  useEffect(() => {
    if (playTrigger <= 0) return;
    if (prevVideoIdRef.current !== videoId) return;
    if (errorMessage) return;

    setHasStarted(true);
    setIsEnded(false);
    const player = playerRef.current;
    if (player && playerReady) {
      player.playVideo();
    } else {
      pendingPlayRef.current = true;
      setIsBuffering(true);
    }
  }, [playTrigger, videoId, playerReady, errorMessage]);

  // Poll playback progress while active
  useEffect(() => {
    if (!playerReady) return;
    const timer = window.setInterval(() => {
      const player = playerRef.current;
      if (!player || isSeeking) return;
      try {
        const t = player.getCurrentTime();
        const d = player.getDuration();
        const frac = player.getVideoLoadedFraction();
        if (Number.isFinite(t)) setCurrentTime(t);
        if (Number.isFinite(d) && d > 0) setDuration(d);
        if (Number.isFinite(frac)) setBufferedFraction(Math.min(1, Math.max(0, frac)));
      } catch {
        // Player may be transitioning
      }
    }, 250);

    return () => window.clearInterval(timer);
  }, [playerReady, isSeeking]);

  const handleTogglePlay = useCallback(() => {
    scheduleHideControls();
    setShowQualityMenu(false);
    if (errorMessage) return;

    const player = playerRef.current;
    if (!player || !playerReady) {
      pendingPlayRef.current = true;
      setHasStarted(true);
      setIsBuffering(true);
      return;
    }

    if (isEnded) {
      player.seekTo(0, true);
      player.playVideo();
      setIsEnded(false);
      return;
    }

    if (isPlaying) {
      player.pauseVideo();
    } else {
      setHasStarted(true);
      player.playVideo();
    }
  }, [errorMessage, isEnded, isPlaying, playerReady, scheduleHideControls]);

  const handleSkipBy = useCallback(
    (deltaSeconds: number) => {
      const player = playerRef.current;
      if (!player || !playerReady) return;
      scheduleHideControls();
      const target = Math.min(duration || 0, Math.max(0, currentTime + deltaSeconds));
      setCurrentTime(target);
      player.seekTo(target, true);
      if (isEnded && target < duration) {
        setIsEnded(false);
      }
    },
    [currentTime, duration, isEnded, playerReady, scheduleHideControls]
  );

  const handleScrubChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = Number(e.target.value);
    setCurrentTime(next);
    scheduleHideControls();
  };

  const handleScrubCommit = (value: number) => {
    setIsSeeking(false);
    const player = playerRef.current;
    if (!player || !playerReady) return;
    player.seekTo(value, true);
    if (isEnded && value < duration) {
      setIsEnded(false);
    }
  };

  const handleToggleMute = useCallback(() => {
    const player = playerRef.current;
    if (!player || !playerReady) return;
    scheduleHideControls();
    if (isMuted) {
      player.unMute();
      const restored = volume > 0 ? volume : 80;
      player.setVolume(restored);
      setVolume(restored);
      setIsMuted(false);
      setAutoMutedHint(false);
    } else {
      player.mute();
      setIsMuted(true);
      setAutoMutedHint(false);
    }
  }, [isMuted, playerReady, scheduleHideControls, volume]);

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextVol = Number(e.target.value);
    setVolume(nextVol);
    const player = playerRef.current;
    if (!player || !playerReady) return;
    if (nextVol === 0) {
      player.mute();
      setIsMuted(true);
    } else {
      if (isMuted) player.unMute();
      player.setVolume(nextVol);
      setIsMuted(false);
    }
  };

  const handleCyclePlaybackRate = () => {
    const rates = availableRates.length > 0 ? availableRates : [...SPEED_OPTIONS];
    const currentIdx = rates.indexOf(playbackRate);
    const nextRate = rates[(currentIdx + 1) % rates.length];
    setPlaybackRate(nextRate);
    const player = playerRef.current;
    if (player && playerReady) {
      player.setPlaybackRate(nextRate);
    }
    scheduleHideControls();
  };

  const handleSelectQuality = (qualityKey: string) => {
    setSelectedQuality(qualityKey);
    setShowQualityMenu(false);
    const player = playerRef.current;
    if (player && playerReady) {
      player.setPlaybackQuality(qualityKey);
      if (qualityKey !== 'default') {
        setActualQuality(qualityKey);
      }
    }
    scheduleHideControls();
  };

  const handleToggleFullscreen = useCallback(async () => {
    const el = stageRef.current;
    if (!el) return;

    const unlockOrientation = () => {
      try {
        (
          screen.orientation as ScreenOrientation & { unlock?: () => void }
        )?.unlock?.();
      } catch {
        // Ignore if unsupported
      }
    };

    if (isFallbackFullscreen || document.fullscreenElement === el) {
      setIsFallbackFullscreen(false);
      setIsRotatedLandscape(false);
      unlockOrientation();
      if (document.fullscreenElement === el) {
        try {
          await document.exitFullscreen();
        } catch {
          // Ignore exit errors
        }
      }
      return;
    }

    const isMobileDevice =
      window.matchMedia('(pointer: coarse)').matches ||
      /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
      window.innerWidth < 768;

    let enteredNative = false;
    if (typeof el.requestFullscreen === 'function') {
      try {
        await el.requestFullscreen();
        enteredNative = document.fullscreenElement === el;
      } catch {
        enteredNative = false;
      }
    }

    if (!enteredNative) {
      setIsFallbackFullscreen(true);
    }

    if (isMobileDevice) {
      let lockedLandscape = false;
      if (enteredNative) {
        try {
          const orientation = screen.orientation as ScreenOrientation & {
            lock?: (
              mode: 'landscape' | 'landscape-primary' | 'portrait'
            ) => Promise<void>;
          };
          if (orientation && typeof orientation.lock === 'function') {
            await orientation.lock('landscape');
            lockedLandscape = true;
          }
        } catch {
          lockedLandscape = false;
        }
      }

      // If OS orientation lock is unavailable or rejected (e.g., iOS Safari or restricted webviews)
      // while the phone is in portrait, rotate the fullscreen stage 90deg into landscape.
      if (!lockedLandscape && window.innerHeight > window.innerWidth) {
        setIsRotatedLandscape(true);
      }
    }
  }, [isFallbackFullscreen]);

  const computeRotatedScrubTime = (clientY: number): number => {
    const track = scrubTrackRef.current;
    if (!track || duration <= 0) return currentTime;
    const rect = track.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientY - rect.top) / Math.max(1, rect.height)));
    return ratio * duration;
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT') return;

    switch (e.key.toLowerCase()) {
      case ' ':
      case 'k':
        e.preventDefault();
        handleTogglePlay();
        break;
      case 'arrowleft':
      case 'j':
        e.preventDefault();
        handleSkipBy(-10);
        break;
      case 'arrowright':
      case 'l':
        e.preventDefault();
        handleSkipBy(10);
        break;
      case 'm':
        e.preventDefault();
        handleToggleMute();
        break;
      case 'f':
        e.preventDefault();
        void handleToggleFullscreen();
        break;
      case 'escape':
        setShowQualityMenu(false);
        if (isFallbackFullscreen || isRotatedLandscape) {
          e.stopPropagation();
          setIsFallbackFullscreen(false);
          setIsRotatedLandscape(false);
        }
        break;
    }
  };

  const qualityOptions = useMemo(() => {
    const levels =
      availableQualities.length > 0
        ? availableQualities
        : [...FALLBACK_QUALITY_LEVELS];
    return ['default', ...levels];
  }, [availableQualities]);

  const progressPercent = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
  const bufferedPercent = Math.min(100, bufferedFraction * 100);

  return (
    <div
      ref={stageRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onMouseMove={scheduleHideControls}
      onTouchStart={scheduleHideControls}
      onMouseLeave={() => {
        if (isPlaying && !showQualityMenu) setShowControls(false);
      }}
      aria-label={`Lecture video player: ${title}`}
      className={`bg-slate-950 select-none overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
        isFallbackFullscreen
          ? 'fixed inset-0 z-[60] w-screen h-[100dvh] flex items-center justify-center'
          : isNativeFullscreen
          ? 'relative flex items-center justify-center h-[100dvh] w-screen'
          : 'relative w-full aspect-video shrink-0'
      }`}
    >
      {/* Orientation wrapper: keeps DOM tree identical across normal, OS landscape, and CSS-rotated landscape */}
      <div
        className={
          isFullscreen
            ? isRotatedLandscape
              ? 'w-[100dvh] h-[100vw] rotate-90 origin-center flex items-center justify-center shrink-0'
              : 'w-full h-full flex items-center justify-center'
            : 'w-full h-full'
        }
      >
      {/* Aspect-locked 16:9 canvas with vertical overscan cropping YouTube's top channel header & bottom watermark */}
      <div
        className={`relative overflow-hidden bg-slate-950 ${
          isFullscreen
            ? isRotatedLandscape
              ? 'w-full max-w-[177.78vw] max-h-full aspect-video'
              : 'w-full max-w-[177.78dvh] max-h-full aspect-video'
            : 'w-full h-full'
        }`}
      >
        <div
          ref={mountHostRef}
          aria-hidden="true"
          className="absolute inset-x-0 -top-[18%] h-[136%] sm:-top-[72px] sm:h-[calc(100%+144px)] pointer-events-none select-none"
        />

        {/* Click capture layer — prevents hovering/clicking underlying YouTube iframe */}
        <button
          type="button"
          aria-label={isPlaying ? 'Pause lecture' : 'Play lecture'}
          onClick={handleTogglePlay}
          onDoubleClick={() => void handleToggleFullscreen()}
          className="absolute inset-0 w-full h-full cursor-pointer bg-transparent focus:outline-none"
        />

        {/* Mobile Autoplay Unmute Prompt (shown when mobile browser blocked unmuted autoplay and auto-muted fallback started) */}
        {hasStarted && !isEnded && !errorMessage && autoMutedHint && isMuted && (
          <button
            type="button"
            onClick={handleToggleMute}
            className="absolute top-3 left-3 z-20 inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-950/85 hover:bg-slate-900 border border-white/20 text-white text-xs font-medium rounded-lg shadow-md backdrop-blur-xs transition-colors"
          >
            <VolumeX className="w-3.5 h-3.5 text-amber-400" />
            <span>Tap to Unmute</span>
          </button>
        )}

        {/* Top subtle edge mask to guarantee zero channel text bleed on start/pause */}
        {hasStarted && !isEnded && !errorMessage && (
          <div
            aria-hidden="true"
            className={`pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-slate-950/90 via-slate-950/35 to-transparent transition-opacity duration-200 ${
              showControls || !isPlaying ? 'opacity-100' : 'opacity-0'
            }`}
          />
        )}

        {/* Pre-play Cadence Poster Cover — clicking anywhere on the poster starts playing immediately */}
        {!hasStarted && !errorMessage && (
          <div
            role="button"
            tabIndex={0}
            aria-label={`Play lecture: ${title}`}
            onClick={handleTogglePlay}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleTogglePlay();
              }
            }}
            className="absolute inset-0 bg-slate-950 flex flex-col items-center justify-center p-4 sm:p-6 text-center cursor-pointer group"
          >
            {posterImage && (
              <img
                src={resolveAssetUrl(posterImage)}
                alt={title}
                referrerPolicy="no-referrer"
                className="absolute inset-0 w-full h-full object-cover opacity-45 group-hover:opacity-55 transition-opacity"
              />
            )}
            <div
              aria-hidden="true"
              className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/75 to-slate-950/55"
            />
            <div className="relative z-10 max-w-lg flex flex-col items-center">
              {subtitle && !compact && (
                <p className="text-[11px] sm:text-xs font-medium text-slate-300 mb-1 sm:mb-1.5">
                  {subtitle}
                </p>
              )}
              {!compact && (
                <h3 className="text-sm sm:text-lg md:text-xl font-bold text-white leading-snug mb-3 sm:mb-5 line-clamp-2">
                  {title}
                </h3>
              )}
              <span
                className={`inline-flex items-center gap-2 bg-blue-600 group-hover:bg-blue-500 text-white font-semibold rounded-lg transition-colors whitespace-nowrap ${
                  compact ? 'px-4 py-2 text-xs' : 'px-4 py-2 sm:px-5 sm:py-2.5 text-xs sm:text-sm'
                }`}
              >
                <Play className="w-4 h-4 fill-current" />
                <span>{compact ? 'Preview Lecture' : 'Play Lecture'}</span>
              </span>
            </div>
          </div>
        )}

        {/* Buffering indicator */}
        {isBuffering && !errorMessage && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-slate-950/45">
            <div className="w-10 h-10 rounded-full border-2 border-white/25 border-t-white animate-spin" />
          </div>
        )}

        {/* End of Lecture Overlay (completely suppresses YouTube related-videos shelf) */}
        {isEnded && !errorMessage && (
          <div className="absolute inset-0 bg-slate-950/92 flex flex-col items-center justify-center p-6 text-center z-20">
            {subtitle && !compact && (
              <p className="text-xs text-slate-400 mb-1">{subtitle}</p>
            )}
            <h3 className={`${compact ? 'text-sm' : 'text-lg'} font-semibold text-white mb-4 max-w-md`}>
              {compact ? 'Preview finished' : `Completed: ${title}`}
            </h3>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={handleTogglePlay}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white text-xs font-medium rounded-lg transition-colors whitespace-nowrap"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Replay Lecture</span>
              </button>
              {hasNextLecture && onNextLecture && (
                <button
                  type="button"
                  onClick={onNextLecture}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded-lg transition-colors whitespace-nowrap"
                >
                  <span>Next Lecture</span>
                  <SkipForward className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Error Overlay */}
        {errorMessage && (
          <div className="absolute inset-0 bg-slate-950 flex flex-col items-center justify-center p-6 text-center z-20">
            <AlertCircle className="w-8 h-8 text-rose-400 mb-2.5" />
            <p className="text-sm font-medium text-white max-w-md mb-3">
              {errorMessage}
            </p>
            <button
              type="button"
              onClick={() => setReloadNonce((n) => n + 1)}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white text-xs font-medium rounded-lg transition-colors"
            >
              Retry Video
            </button>
          </div>
        )}

        {/* Custom Cadence Study Player Controls */}
        {hasStarted && !errorMessage && (
          <div
            className={`absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/90 via-black/60 to-transparent px-2.5 sm:px-4 pb-2.5 sm:pb-3 pt-8 sm:pt-10 transition-opacity duration-200 ${
              showControls || !isPlaying || showQualityMenu
                ? 'opacity-100'
                : 'opacity-0 pointer-events-none'
            }`}
          >
            {/* Interactive Scrub Bar */}
            <div
              ref={scrubTrackRef}
              onPointerDown={(e) => {
                if (!isRotatedLandscape) return;
                e.preventDefault();
                e.currentTarget.setPointerCapture(e.pointerId);
                setIsSeeking(true);
                const t = computeRotatedScrubTime(e.clientY);
                setCurrentTime(t);
                scheduleHideControls();
              }}
              onPointerMove={(e) => {
                if (!isRotatedLandscape || !isSeeking) return;
                const t = computeRotatedScrubTime(e.clientY);
                setCurrentTime(t);
                scheduleHideControls();
              }}
              onPointerUp={(e) => {
                if (!isRotatedLandscape) return;
                const t = computeRotatedScrubTime(e.clientY);
                handleScrubCommit(t);
              }}
              onPointerCancel={() => {
                if (isRotatedLandscape) setIsSeeking(false);
              }}
              className="relative h-7 sm:h-5 flex items-center mb-1.5 sm:mb-2 group touch-none"
            >
              <div className="w-full h-1 bg-white/25 rounded-full overflow-hidden">
                <div
                  className="h-full bg-white/35 transition-[width] duration-150"
                  style={{ width: `${bufferedPercent}%` }}
                />
              </div>
              <div
                className="absolute left-0 h-1 bg-blue-500 rounded-full pointer-events-none"
                style={{ width: `${progressPercent}%` }}
              />
              <input
                type="range"
                aria-label="Seek lecture timeline"
                min={0}
                max={duration || 100}
                step={0.5}
                value={currentTime}
                onMouseDown={() => setIsSeeking(true)}
                onTouchStart={() => setIsSeeking(true)}
                onChange={handleScrubChange}
                onMouseUp={(e) =>
                  handleScrubCommit(Number((e.target as HTMLInputElement).value))
                }
                onTouchEnd={(e) =>
                  handleScrubCommit(Number((e.target as HTMLInputElement).value))
                }
                className={`absolute inset-0 w-full h-full opacity-0 cursor-pointer ${
                  isRotatedLandscape ? 'pointer-events-none' : ''
                }`}
              />
            </div>

            {/* Bottom Transport Row */}
            <div className="flex items-center justify-between gap-1.5 sm:gap-2 text-white">
              <div className="flex items-center gap-1 sm:gap-2 min-w-0">
                <button
                  type="button"
                  aria-label={isPlaying ? 'Pause' : 'Play'}
                  onClick={handleTogglePlay}
                  className="min-h-[36px] min-w-[36px] sm:min-h-0 sm:min-w-0 p-1.5 inline-flex items-center justify-center rounded-md hover:bg-white/15 transition-colors shrink-0"
                >
                  {isPlaying ? (
                    <Pause className="w-4 h-4 fill-current" />
                  ) : (
                    <Play className="w-4 h-4 fill-current" />
                  )}
                </button>

                {!compact && (
                  <>
                    <button
                      type="button"
                      aria-label="Rewind 10 seconds"
                      onClick={() => handleSkipBy(-10)}
                      className="hidden sm:inline-flex items-center justify-center p-1.5 rounded-md hover:bg-white/15 transition-colors shrink-0"
                      title="Rewind 10s"
                    >
                      <RotateCcw className="w-4 h-4" />
                    </button>

                    <button
                      type="button"
                      aria-label="Forward 10 seconds"
                      onClick={() => handleSkipBy(10)}
                      className="hidden sm:inline-flex items-center justify-center p-1.5 rounded-md hover:bg-white/15 transition-colors shrink-0"
                      title="Forward 10s"
                    >
                      <RotateCw className="w-4 h-4" />
                    </button>
                  </>
                )}

                <span className="text-[11px] sm:text-xs font-mono tabular-nums text-slate-200 whitespace-nowrap ml-0.5 sm:ml-1 truncate">
                  {formatVideoTime(currentTime)} / {formatVideoTime(duration)}
                </span>
              </div>

              <div className="flex items-center gap-0.5 sm:gap-2 shrink-0">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label={isMuted ? 'Unmute' : 'Mute'}
                    onClick={handleToggleMute}
                    className="min-h-[36px] min-w-[36px] sm:min-h-0 sm:min-w-0 p-1.5 inline-flex items-center justify-center rounded-md hover:bg-white/15 transition-colors"
                  >
                    {isMuted || volume === 0 ? (
                      <VolumeX className="w-4 h-4" />
                    ) : (
                      <Volume2 className="w-4 h-4" />
                    )}
                  </button>
                  {!compact && (
                    <input
                      type="range"
                      aria-label="Volume"
                      min={0}
                      max={100}
                      value={isMuted ? 0 : volume}
                      onChange={handleVolumeChange}
                      className="hidden sm:block w-16 accent-blue-500 cursor-pointer h-1"
                    />
                  )}
                </div>

                {!compact && (
                  <button
                    type="button"
                    aria-label={`Playback speed ${playbackRate}x`}
                    onClick={handleCyclePlaybackRate}
                    className="min-h-[36px] sm:min-h-0 px-2 py-1 text-[11px] sm:text-xs font-mono tabular-nums rounded-md hover:bg-white/15 transition-colors whitespace-nowrap"
                    title="Change playback speed"
                  >
                    {playbackRate}x
                  </button>
                )}

                {/* Video Quality Selector */}
                <div ref={qualityMenuRef} className="relative">
                  <button
                    type="button"
                    aria-label="Video quality"
                    aria-expanded={showQualityMenu}
                    aria-haspopup="menu"
                    onClick={() => {
                      setShowQualityMenu((v) => !v);
                      scheduleHideControls();
                    }}
                    className="min-h-[36px] sm:min-h-0 inline-flex items-center gap-1 px-2 py-1 text-[11px] sm:text-xs font-mono tabular-nums rounded-md hover:bg-white/15 transition-colors whitespace-nowrap"
                    title="Video quality"
                  >
                    <Settings className="w-3.5 h-3.5 shrink-0" />
                    <span>
                      {selectedQuality === 'default' ? (
                        actualQuality !== 'unknown' ? (
                          <>
                            <span className="hidden sm:inline">Auto · </span>
                            {formatQualityShort(actualQuality)}
                          </>
                        ) : (
                          'Auto'
                        )
                      ) : (
                        formatQualityShort(selectedQuality)
                      )}
                    </span>
                  </button>

                  {showQualityMenu && (
                    <div
                      role="menu"
                      aria-label="Select video quality"
                      className="absolute bottom-full right-0 mb-2 w-44 py-1.5 bg-slate-950/95 border border-white/15 rounded-lg shadow-xl z-30"
                    >
                      <p className="px-3 py-1 text-[11px] font-medium text-slate-400 border-b border-white/10">
                        Video Quality
                      </p>
                      <div className="max-h-48 sm:max-h-52 overflow-y-auto py-1">
                        {qualityOptions.map((q) => {
                          const isSelected = selectedQuality === q;
                          const label =
                            q === 'default' && actualQuality !== 'unknown'
                              ? `Auto (${formatQualityShort(actualQuality)})`
                              : formatQualityLabel(q);
                          return (
                            <button
                              key={q}
                              type="button"
                              role="menuitemradio"
                              aria-checked={isSelected}
                              onClick={() => handleSelectQuality(q)}
                              className={`w-full px-3 py-2 sm:py-1.5 text-left text-xs flex items-center justify-between gap-2 transition-colors ${
                                isSelected
                                  ? 'text-blue-400 bg-white/10 font-medium'
                                  : 'text-slate-100 hover:bg-white/10'
                              }`}
                            >
                              <span className="font-mono tabular-nums whitespace-nowrap">
                                {label}
                              </span>
                              {isSelected && <Check className="w-3.5 h-3.5 shrink-0" />}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                  onClick={() => void handleToggleFullscreen()}
                  className="min-h-[36px] min-w-[36px] sm:min-h-0 sm:min-w-0 p-1.5 inline-flex items-center justify-center rounded-md hover:bg-white/15 transition-colors"
                >
                  {isFullscreen ? (
                    <Minimize2 className="w-4 h-4" />
                  ) : (
                    <Maximize2 className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
