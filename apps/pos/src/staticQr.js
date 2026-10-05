// Fixed bank KHQR codes (issue #12). An admin adds each bank's printed/app QR
// as an image in Settings > KHQR; when the cashier takes a "Bank QR" payment
// and picks that bank, the customer display shows its QR to scan. Kept in
// this register's local store_settings only, as a JSON list -- one QR per bank.
export const STATIC_QR_KEY = 'static_qr_codes';

export const BANKS = ['ABA', 'ACLEDA', 'Wing', 'KB Prasac', 'Sathapana', 'Canadia', 'Maybank', 'CHIP Mong', 'Hattha', 'Prince', 'Other'];

// Large enough to scan from a customer screen, small enough to keep the
// local database light (it's rewritten in full on every save).
export const QR_IMAGE_MAX_PX = 800;

/** [{ bank, image }] from the stored setting; anything malformed is dropped. */
export function parseStaticQrCodes(value) {
  try {
    const list = JSON.parse(value || '[]');
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    return list.filter((c) => {
      const ok = c && typeof c.bank === 'string' && typeof c.image === 'string' && c.image.startsWith('data:image/') && !seen.has(c.bank);
      if (ok) seen.add(c.bank);
      return ok;
    });
  } catch {
    return [];
  }
}

export const serializeStaticQrCodes = (codes) => JSON.stringify(codes.map(({ bank, image }) => ({ bank, image })));

/** Banks in the usual order, so the register's buttons don't reorder as QR codes are added. */
export const sortByBank = (codes) =>
  [...codes].sort((a, b) => BANKS.indexOf(a.bank) - BANKS.indexOf(b.bank));
