import { useState } from 'react';
import { ImagePlus, Plus, QrCode, Trash2, X } from 'lucide-react';
import { imageFileToDataUrl } from './standbyImage';
import { BANKS, QR_IMAGE_MAX_PX, STATIC_QR_KEY, parseStaticQrCodes, serializeStaticQrCodes, sortByBank } from './staticQr';

// PNG keeps the QR's edges sharp; lossy formats can blur small modules.
const readQrImage = (file) => imageFileToDataUrl(file, QR_IMAGE_MAX_PX, 'image/png');

function Switch({ checked, onChange, label }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} title={label} onClick={() => onChange(!checked)}
      className={`relative flex-shrink-0 w-10 h-6 rounded-full transition-colors cursor-pointer ${checked ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-slate-600'}`}>
      <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-4' : ''}`} />
    </button>
  );
}

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 bg-slate-900/40 dark:bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xl max-w-sm w-full p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-base font-bold text-slate-900 dark:text-white">{title}</h3>
          <button type="button" onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

const QrImage = ({ src, alt }) => (
  <div className="w-full aspect-square bg-white rounded-xl border border-slate-200 dark:border-slate-700 flex items-center justify-center overflow-hidden">
    {src ? <img src={src} alt={alt} className="max-w-full max-h-full object-contain" /> : <QrCode size={48} className="text-slate-200" />}
  </div>
);

function UploadButton({ label, onFile, primary = false }) {
  return (
    <label className={`px-3 py-2 rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer ${primary ? 'bg-indigo-600 hover:bg-indigo-700 text-white' : 'bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-200'}`}>
      <ImagePlus size={13} />
      {label}
      <input type="file" accept="image/*" className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) onFile(file);
        }} />
    </label>
  );
}

/**
 * Settings > KHQR > Bank QR codes (issue #12): one fixed KHQR image per bank.
 * Each row can show its QR and be switched on or off for checkout's Bank QR
 * payment. Edits the parent form, so changes apply on Save. The open modal
 * ({ type: 'show', bank } | { type: 'add' } | null) lives in the parent, so
 * Settings' Esc handling closes it before leaving.
 */
export default function BankQrSettings({ settings, setSettings, q, inputClass, modal, setModal }) {
  const codes = sortByBank(parseStaticQrCodes(settings[STATIC_QR_KEY]));
  const available = BANKS.filter((bank) => !codes.some((c) => c.bank === bank));
  const save = (next) => setSettings((prev) => ({ ...prev, [STATIC_QR_KEY]: serializeStaticQrCodes(next) }));
  const update = (bank, change) => save(codes.map((c) => (c.bank === bank ? { ...c, ...change } : c)));

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500 dark:text-slate-400">{q.help}</p>

      {codes.length === 0 ? (
        <p className="text-xs text-slate-400 dark:text-slate-500">{q.none || 'No bank QR codes yet.'}</p>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-700 border border-slate-200 dark:border-slate-700 rounded-xl">
          {codes.map((c) => (
            <li key={c.bank} className="flex items-center gap-3 px-4 py-3">
              <span className={`flex-1 min-w-0 truncate text-sm font-bold ${c.enabled ? 'text-slate-700 dark:text-slate-200' : 'text-slate-400 dark:text-slate-500'}`}>{c.bank}</span>
              <button type="button" onClick={() => setModal({ type: 'show', bank: c.bank })}
                className="px-3 py-1.5 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-200 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer">
                <QrCode size={12} /> {q.show || 'Show KHQR'}
              </button>
              <Switch checked={c.enabled} onChange={(enabled) => update(c.bank, { enabled })}
                label={`${c.bank}: ${c.enabled ? q.enabled || 'Shown at checkout' : q.disabled || 'Hidden at checkout'}`} />
            </li>
          ))}
        </ul>
      )}

      {available.length > 0 ? (
        <button type="button" onClick={() => setModal({ type: 'add' })}
          className="w-full py-2.5 border-2 border-dashed border-slate-200 dark:border-slate-700 hover:border-indigo-300 dark:hover:border-indigo-700 text-slate-500 dark:text-slate-400 hover:text-indigo-600 rounded-xl text-xs font-bold transition-colors flex items-center justify-center gap-1.5 cursor-pointer">
          <Plus size={14} /> {q.addBank || 'Add bank'}
        </button>
      ) : (
        <p className="text-xs text-slate-400 dark:text-slate-500">{q.allAdded || 'Every bank has a QR code.'}</p>
      )}
      <p className="text-[11px] text-slate-400 dark:text-slate-500">{q.toggleHelp || 'The switch decides whether the bank is offered under Bank QR at checkout.'}</p>

      {modal?.type === 'show' && (
        <ShowModal code={codes.find((c) => c.bank === modal.bank)} q={q} onClose={() => setModal(null)}
          onReplace={(image) => update(modal.bank, { image })}
          onRemove={() => { save(codes.filter((c) => c.bank !== modal.bank)); setModal(null); }} />
      )}
      {modal?.type === 'add' && (
        <AddModal available={available} q={q} inputClass={inputClass} onClose={() => setModal(null)}
          onAdd={(code) => { save([...codes, { ...code, enabled: true }]); setModal(null); }} />
      )}
    </div>
  );
}

function ShowModal({ code, q, onClose, onReplace, onRemove }) {
  const [error, setError] = useState('');
  if (!code) return null;
  const replace = async (file) => {
    setError('');
    try {
      onReplace(await readQrImage(file));
    } catch (err) {
      setError(err.message);
    }
  };
  return (
    <Modal title={code.bank} onClose={onClose}>
      <QrImage src={code.image} alt={code.bank} />
      {error && <p className="text-xs font-semibold text-rose-600 dark:text-rose-400">{error}</p>}
      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={onRemove}
          className="px-3 py-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer">
          <Trash2 size={13} /> {q.removeBank || 'Remove bank'}
        </button>
        <UploadButton label={q.replace || 'Replace image'} onFile={replace} />
      </div>
    </Modal>
  );
}

function AddModal({ available, q, inputClass, onClose, onAdd }) {
  const [bank, setBank] = useState(available[0]);
  const [image, setImage] = useState('');
  const [error, setError] = useState('');
  const pick = async (file) => {
    setError('');
    try {
      setImage(await readQrImage(file));
    } catch (err) {
      setError(err.message);
    }
  };
  return (
    <Modal title={q.addBank || 'Add bank'} onClose={onClose}>
      <label className="block">
        <span className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">{q.bank || 'Bank'}</span>
        <select value={bank} onChange={(e) => setBank(e.target.value)} className={inputClass}>
          {available.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
      </label>
      <QrImage src={image} alt={bank} />
      {error && <p className="text-xs font-semibold text-rose-600 dark:text-rose-400">{error}</p>}
      <div className="flex items-center justify-between gap-2">
        <UploadButton label={image ? q.replace || 'Replace image' : q.chooseImage || 'Choose QR image'} onFile={pick} />
        <button type="button" disabled={!image} onClick={() => onAdd({ bank, image })}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
          {q.add || 'Add'}
        </button>
      </div>
    </Modal>
  );
}
