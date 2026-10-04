// Stored as a StoreSetting data URL and synced to every terminal, so it's
// shrunk here first. 256px stays sharp on the POS customer display (112px
// @2x); the backend rejects anything over ~90KB.
export const STORE_ICON_KEY = 'store_icon';
const STORE_ICON_MAX_PX = 256;

/** Accepts an uploaded File/Blob or an existing image URL (e.g. an online-pos data URL). */
export function resizeImageToDataUrl(source) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const isBlob = source instanceof Blob;
    const url = isBlob ? URL.createObjectURL(source) : source;
    const cleanup = () => {
      if (isBlob) URL.revokeObjectURL(url);
    };
    img.onload = () => {
      cleanup();
      const scale = Math.min(1, STORE_ICON_MAX_PX / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      // WebP where the browser can encode it (falls back to PNG otherwise).
      resolve(canvas.toDataURL('image/webp', 0.85));
    };
    img.onerror = () => {
      cleanup();
      reject(new Error('Could not read that image.'));
    };
    img.src = url;
  });
}
