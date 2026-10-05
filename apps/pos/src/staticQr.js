// Bank QR payments (issue #12). An admin keeps this register's list of banks
// in Settings > KHQR: each has a name and its fixed KHQR image, and can be
// switched off to hide it at checkout. When the cashier takes a "Bank QR"
// payment and picks a bank, the customer display shows its QR to scan.
// Kept in this register's local store_settings only, as a JSON list.
export const STATIC_QR_KEY = 'static_qr_codes';

// Offered as suggestions when typing a new bank's name; any name works.
export const COMMON_BANKS = ['ABA', 'ACLEDA', 'Wing', 'KB Prasac', 'Sathapana', 'Canadia', 'Maybank', 'CHIP Mong', 'Hattha', 'Prince'];

export const MAX_BANK_NAME = 40;

// Large enough to scan from a customer screen, small enough to keep the
// local database light (it's rewritten in full on every save).
export const QR_IMAGE_MAX_PX = 800;

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

/**
 * [{ id, bank, image, enabled }] from the stored setting, in the admin's
 * order; anything malformed, or a repeated name, is dropped.
 */
export function parseStaticQrCodes(value) {
  try {
    const list = JSON.parse(value || '[]');
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    return list
      .filter((c) => {
        const ok = c && typeof c.bank === 'string' && c.bank.trim() && typeof c.image === 'string' &&
          c.image.startsWith('data:image/') && !seen.has(bankKey(c.bank));
        if (ok) seen.add(bankKey(c.bank));
        return ok;
      })
      .map((c) => ({ id: c.id || c.bank, bank: c.bank.trim(), image: c.image, enabled: c.enabled !== false }));
  } catch {
    return [];
  }
}

export const serializeStaticQrCodes = (codes) =>
  JSON.stringify(codes.map(({ id, bank, image, enabled = true }) => ({ id, bank, image, enabled })));

export const newStaticQrCode = (bank, image) => ({ id: newId(), bank: bank.trim(), image, enabled: true });

/** Names compare without case or surrounding spaces: "aba " is the same bank as "ABA". */
export const bankKey = (name) => String(name).trim().toLowerCase();

/** Why a bank name can't be used, or '' if it can. `exceptId`: the bank being renamed. */
export function bankNameProblem(name, codes, exceptId, q = {}) {
  const trimmed = String(name).trim();
  if (!trimmed) return q.nameRequired || 'Enter the bank name.';
  if (trimmed.length > MAX_BANK_NAME) return (q.nameTooLong || 'Keep the name under {max} characters.').replace('{max}', MAX_BANK_NAME);
  if (codes.some((c) => c.id !== exceptId && bankKey(c.bank) === bankKey(trimmed))) return q.nameTaken || 'That bank is already in the list.';
  return '';
}
