// Customer display standby picture (issue #4). Picked in Settings and kept in
// this register's local store_settings only -- sync never sends or receives
// it. Stored as a data URL, so it's downscaled first: the local database is
// rewritten in full on every save, and a raw phone photo can be 5MB+.
export const STANDBY_IMAGE_KEY = 'customer_display_standby_image';
const MAX_PX = 1920; // a 1080p customer screen; larger adds size, not sharpness

// Also used for the shop image (issue #5), at a smaller maxPx.
export function imageFileToDataUrl(file, maxPx = MAX_PX) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('That file is not an image.'));
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/webp', 0.85));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read that image.'));
    };
    img.src = url;
  });
}
