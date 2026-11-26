import { SubjectColorKey, VALIDATION_LIMITS } from '@/src/types';

export function getTodayDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatMinutesAsHours(totalMinutes: number): string {
  const mins = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  if (hours === 0) return `${rem}m`;
  if (rem === 0) return `${hours}h`;
  return `${hours}h ${rem}m`;
}

export function formatTimerSeconds(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function formatInr(amount: number): string {
  const safe = Number.isFinite(amount) ? Math.max(0, amount) : 0;
  return `₹${safe.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

/**
 * Extracts an 11-character YouTube video ID from standard, unlisted, share,
 * embed, or live YouTube URLs.
 */
export function parseYouTubeVideoId(rawUrl: string): string | null {
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  // Direct 11-character video ID fallback
  if (VALIDATION_LIMITS.youtubeIdPattern.test(trimmed)) {
    return trimmed;
  }

  try {
    const normalized = trimmed.startsWith('http') ? trimmed : `https://${trimmed}`;
    const url = new URL(normalized);
    const host = url.hostname.replace(/^www\./, '').toLowerCase();

    if (host === 'youtu.be') {
      const candidate = url.pathname.split('/').filter(Boolean)[0] ?? '';
      return VALIDATION_LIMITS.youtubeIdPattern.test(candidate) ? candidate : null;
    }

    if (
      host === 'youtube.com' ||
      host === 'm.youtube.com' ||
      host === 'youtube-nocookie.com'
    ) {
      const vParam = url.searchParams.get('v');
      if (vParam && VALIDATION_LIMITS.youtubeIdPattern.test(vParam)) {
        return vParam;
      }
      const segments = url.pathname.split('/').filter(Boolean);
      if (
        segments.length >= 2 &&
        (segments[0] === 'embed' || segments[0] === 'live' || segments[0] === 'shorts')
      ) {
        const candidate = segments[1];
        return VALIDATION_LIMITS.youtubeIdPattern.test(candidate) ? candidate : null;
      }
    }
  } catch {
    return null;
  }

  return null;
}

export function playFocusChime(): void {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    const freqs = [523.25, 659.25, 783.99];
    freqs.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.12);
      gain.gain.setValueAtTime(0.001, now + idx * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.12, now + idx * 0.12 + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.12 + 0.45);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + idx * 0.12);
      osc.stop(now + idx * 0.12 + 0.48);
    });
  } catch {
    // Audio playback blocked or unavailable; silent fallback.
  }
}

export function getSubjectBarClass(colorKey: SubjectColorKey): string {
  switch (colorKey) {
    case 'cobalt':
      return 'bg-blue-600';
    case 'emerald':
      return 'bg-emerald-600';
    case 'amber':
      return 'bg-amber-600';
    case 'rose':
      return 'bg-rose-600';
    case 'slate':
    default:
      return 'bg-slate-700';
  }
}

export function getSubjectLabel(colorKey: SubjectColorKey): string {
  switch (colorKey) {
    case 'cobalt':
      return 'Cobalt';
    case 'emerald':
      return 'Emerald';
    case 'amber':
      return 'Amber';
    case 'rose':
      return 'Rose';
    case 'slate':
    default:
      return 'Slate';
  }
}

export function sanitizeString(value: string, maxLen: number): string {
  return value.trim().slice(0, maxLen);
}

export function resolveAssetUrl(src?: string): string | undefined {
  if (!src) return src;
  if (src.startsWith('/src/assets/')) {
    return `.${src}`;
  }
  return src;
}

const SAFE_THUMBNAIL_REGEX =
  /^(https:\/\/[^\s]+|\/src\/assets\/[^\s]+|data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=]+)$/;

export function isSafeThumbnailUrl(rawUrl: string): boolean {
  const trimmed = rawUrl.trim();
  if (!trimmed) return true;
  if (trimmed.length > VALIDATION_LIMITS.thumbnailUrlMax) return false;
  return SAFE_THUMBNAIL_REGEX.test(trimmed);
}

const SAFE_HTTPS_REGEX = /^https:\/\/[^\s]+$/;

export function isSafeHttpsUrl(rawUrl: string): boolean {
  const trimmed = rawUrl.trim();
  if (!trimmed) return true;
  if (trimmed.length > VALIDATION_LIMITS.paymentLinkUrlMax) return false;
  return SAFE_HTTPS_REGEX.test(trimmed);
}

export async function compressImageToThumbnailDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Please choose a valid image file (JPEG, PNG, or WebP).');
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Unable to read the selected image file.'));
      el.src = objectUrl;
    });

    const targetW = 640;
    const targetH = 360;
    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas image processing is unavailable in this browser.');
    }

    // Center-crop to 16:9
    const srcRatio = img.width / img.height;
    const dstRatio = targetW / targetH;
    let sx = 0;
    let sy = 0;
    let sw = img.width;
    let sh = img.height;
    if (srcRatio > dstRatio) {
      sw = img.height * dstRatio;
      sx = (img.width - sw) / 2;
    } else if (srcRatio < dstRatio) {
      sh = img.width / dstRatio;
      sy = (img.height - sh) / 2;
    }

    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, targetW, targetH);

    for (const quality of [0.8, 0.65, 0.5]) {
      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      if (dataUrl.length <= VALIDATION_LIMITS.thumbnailUrlMax) {
        return dataUrl;
      }
    }

    throw new Error('Compressed thumbnail is still too large. Please pick a simpler image.');
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function compressSquareQrImageDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Please choose a valid image file (JPEG, PNG, or WebP).');
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Unable to read the selected QR image file.'));
      el.src = objectUrl;
    });

    const maxSide = 400;
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const width = Math.max(1, Math.round(img.width * scale));
    const height = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas image processing is unavailable in this browser.');
    }

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);

    const pngUrl = canvas.toDataURL('image/png');
    if (pngUrl.length <= VALIDATION_LIMITS.thumbnailUrlMax) {
      return pngUrl;
    }

    for (const quality of [0.85, 0.7, 0.55]) {
      const jpegUrl = canvas.toDataURL('image/jpeg', quality);
      if (jpegUrl.length <= VALIDATION_LIMITS.thumbnailUrlMax) {
        return jpegUrl;
      }
    }

    throw new Error('QR code image is still too large. Please pick a smaller image.');
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function compressPaymentScreenshotDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Please upload a valid payment screenshot image (JPEG, PNG, or WebP).');
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Unable to read the selected screenshot image.'));
      el.src = objectUrl;
    });

    for (const maxSide of [960, 720, 560]) {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const width = Math.max(1, Math.round(img.width * scale));
      const height = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('Canvas image processing is unavailable in this browser.');
      }

      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);

      for (const quality of [0.82, 0.7, 0.55, 0.42]) {
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        if (dataUrl.length <= VALIDATION_LIMITS.paymentScreenshotMax) {
          return dataUrl;
        }
      }
    }

    throw new Error('Payment screenshot is too large. Please upload a clearer or cropped screenshot.');
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
