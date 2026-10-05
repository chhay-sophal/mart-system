import { useState } from 'react';
import { ImagePlus, Trash2, QrCode } from 'lucide-react';
import { imageFileToDataUrl } from './standbyImage';
import { BANKS, QR_IMAGE_MAX_PX, STATIC_QR_KEY, parseStaticQrCodes, serializeStaticQrCodes, sortByBank } from './staticQr';

/**
 * Settings > KHQR > Bank QR codes (issue #12): one fixed KHQR image per bank,
 * shown on the customer display when the cashier takes a Bank QR payment
 * with that bank. Edits the parent form, so changes apply on Save.
 */
export default function BankQrSettings({ settings, setSettings, q, inputClass }) {
  const codes = sortByBank(parseStaticQrCodes(settings[STATIC_QR_KEY]));
  const available = BANKS.filter((bank) => !codes.some((c) => c.bank === bank));
  const [bank, setBank] = useState('');
  const [error, setError] = useState('');
  const chosen = available.includes(bank) ? bank : available[0] || '';

  const save = (next) => setSettings((prev) => ({ ...prev, [STATIC_QR_KEY]: serializeStaticQrCodes(next) }));

  const add = async (file) => {
    setError('');
    if (!file || !chosen) return;
    try {
      // PNG keeps the QR's edges sharp; lossy formats can blur small modules.
      const image = await imageFileToDataUrl(file, QR_IMAGE_MAX_PX, 'image/png');
      save([...codes, { bank: chosen, image }]);
      setBank('');
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500 dark:text-slate-400">
        {q.help || 'Add the fixed KHQR code of each bank account this register accepts. When the cashier takes a Bank QR payment and picks the bank, its QR shows on the customer display.'}
      </p>

      {codes.length === 0 ? (
        <p className="text-xs text-slate-400 dark:text-slate-500">{q.none || 'No bank QR codes yet.'}</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3">
          {codes.map((c) => (
            <li key={c.bank} className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 flex flex-col items-center gap-2">
              <div className="w-full aspect-square bg-white rounded-lg flex items-center justify-center overflow-hidden">
                <img src={c.image} alt={c.bank} className="max-w-full max-h-full object-contain" />
              </div>
              <div className="w-full flex items-center justify-between gap-2">
                <span className="text-sm font-bold text-slate-700 dark:text-slate-200 truncate">{c.bank}</span>
                <button type="button" onClick={() => save(codes.filter((x) => x.bank !== c.bank))}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors cursor-pointer"
                  title={q.remove || 'Remove'} aria-label={`${q.remove || 'Remove'} ${c.bank}`}>
                  <Trash2 size={14} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {available.length > 0 ? (
        <div className="flex items-end gap-2">
          <label className="flex-1 min-w-0">
            <span className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">{q.bank || 'Bank'}</span>
            <select value={chosen} onChange={(e) => setBank(e.target.value)} className={inputClass}>
              {available.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </label>
          <label className="px-3 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer flex-shrink-0">
            <ImagePlus size={13} />
            {q.add || 'Add QR image'}
            <input type="file" accept="image/*" className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                add(file);
              }} />
          </label>
        </div>
      ) : (
        <p className="text-xs text-slate-400 dark:text-slate-500 flex items-center gap-1.5"><QrCode size={12} />{q.allAdded || 'Every bank has a QR code.'}</p>
      )}
      <p className="text-[11px] text-slate-400 dark:text-slate-500">{q.onePerBank || 'One QR code per bank: remove a bank\'s QR to replace it.'}</p>
      {error && <p className="text-xs font-semibold text-rose-600 dark:text-rose-400">{error}</p>}
    </div>
  );
}
