import { useState } from 'react';
import { createPortal } from 'react-dom';
import { ImagePlus, Plus, QrCode, Trash2, X } from 'lucide-react';
import { imageFileToDataUrl } from './standbyImage';
import {
  COMMON_BANKS, MAX_BANK_NAME, QR_IMAGE_MAX_PX, STATIC_QR_KEY,
  bankKey, bankNameProblem, newStaticQrCode, parseStaticQrCodes, serializeStaticQrCodes,
} from './staticQr';

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

// Portaled to <body>: Settings is one big <form>, and a form can't sit inside another.
function Modal({ title, onClose, children }) {
  return createPortal(
    <div className="fixed inset-0 bg-slate-900/40 dark:bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xl max-w-sm w-full p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-base font-bold text-slate-900 dark:text-white truncate">{title}</h3>
          <button type="button" onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

const QrImage = ({ src, alt }) => (
  <div className="w-full aspect-square bg-white rounded-xl border border-slate-200 dark:border-slate-700 flex items-center justify-center overflow-hidden">
    {src ? <img src={src} alt={alt} className="max-w-full max-h-full object-contain" /> : <QrCode size={48} className="text-slate-200" />}
  </div>
);

function UploadButton({ label, onFile }) {
  return (
    <label className="px-3 py-2 rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-200">
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

const primaryBtn = 'px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed';

/**
 * Settings > KHQR > Bank QR codes (issue #12): the register's own list of
 * banks, each with a name, its fixed KHQR image and an on/off switch for
 * checkout's Bank QR payment. Banks are added, renamed, re-imaged and
 * removed here; changes apply to the parent form, so they save with Save.
 * The open modal ({ type: 'edit', id } | { type: 'add' } | null) lives in the
 * parent, so Settings' Esc handling closes it before leaving.
 */
export default function BankQrSettings({ settings, setSettings, q, inputClass, modal, setModal }) {
  const codes = parseStaticQrCodes(settings[STATIC_QR_KEY]);
  const save = (next) => setSettings((prev) => ({ ...prev, [STATIC_QR_KEY]: serializeStaticQrCodes(next) }));
  const update = (id, change) => save(codes.map((c) => (c.id === id ? { ...c, ...change } : c)));
  const editing = modal?.type === 'edit' ? codes.find((c) => c.id === modal.id) : null;

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500 dark:text-slate-400">{q.help}</p>

      {codes.length === 0 ? (
        <p className="text-xs text-slate-400 dark:text-slate-500">{q.none || 'No banks yet.'}</p>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-700 border border-slate-200 dark:border-slate-700 rounded-xl">
          {codes.map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-4 py-3">
              <span className={`flex-1 min-w-0 truncate text-sm font-bold ${c.enabled ? 'text-slate-700 dark:text-slate-200' : 'text-slate-400 dark:text-slate-500'}`}>{c.bank}</span>
              <button type="button" onClick={() => setModal({ type: 'edit', id: c.id })}
                className="px-3 py-1.5 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-200 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer">
                <QrCode size={12} /> {q.show || 'Show KHQR'}
              </button>
              <Switch checked={c.enabled} onChange={(enabled) => update(c.id, { enabled })}
                label={`${c.bank}: ${c.enabled ? q.enabled || 'Shown at checkout' : q.disabled || 'Hidden at checkout'}`} />
            </li>
          ))}
        </ul>
      )}

      <button type="button" onClick={() => setModal({ type: 'add' })}
        className="w-full py-2.5 border-2 border-dashed border-slate-200 dark:border-slate-700 hover:border-indigo-300 dark:hover:border-indigo-700 text-slate-500 dark:text-slate-400 hover:text-indigo-600 rounded-xl text-xs font-bold transition-colors flex items-center justify-center gap-1.5 cursor-pointer">
        <Plus size={14} /> {q.addBank || 'Add bank'}
      </button>
      <p className="text-[11px] text-slate-400 dark:text-slate-500">{q.toggleHelp || 'The switch decides whether the bank is offered under Bank QR at checkout.'}</p>

      {/* Suggestions for the name field; any name can be typed. */}
      <datalist id="bank-name-suggestions">
        {COMMON_BANKS.filter((b) => !codes.some((c) => bankKey(c.bank) === bankKey(b))).map((b) => <option key={b} value={b} />)}
      </datalist>

      {editing && (
        <BankModal key={editing.id} title={editing.bank} initial={editing} codes={codes} q={q} inputClass={inputClass}
          submitLabel={q.done || 'Done'} onClose={() => setModal(null)}
          onSubmit={({ bank, image }) => { update(editing.id, { bank: bank.trim(), image }); setModal(null); }}
          onRemove={() => { save(codes.filter((c) => c.id !== editing.id)); setModal(null); }} />
      )}
      {modal?.type === 'add' && (
        <BankModal title={q.addBank || 'Add bank'} initial={{ bank: '', image: '' }} codes={codes} q={q} inputClass={inputClass}
          submitLabel={q.add || 'Add'} onClose={() => setModal(null)}
          onSubmit={({ bank, image }) => { save([...codes, newStaticQrCode(bank, image)]); setModal(null); }} />
      )}
    </div>
  );
}

/**
 * Add or edit one bank. Edits are a draft until Add / Done; closing the modal
 * (X, Esc, outside click) discards them. Remove applies straight away.
 */
function BankModal({ title, initial, codes, q, inputClass, submitLabel, onClose, onSubmit, onRemove }) {
  const [bank, setBank] = useState(initial.bank);
  const [image, setImage] = useState(initial.image);
  const [touched, setTouched] = useState(false);
  const [imageError, setImageError] = useState('');
  const nameProblem = bankNameProblem(bank, codes, initial.id, q);

  const pick = async (file) => {
    setImageError('');
    try {
      setImage(await readQrImage(file));
    } catch (err) {
      setImageError(err.message);
    }
  };
  const submit = (e) => {
    e.preventDefault();
    e.stopPropagation(); // React bubbles it through the portal to Settings' own form
    setTouched(true);
    if (!nameProblem && image) onSubmit({ bank, image });
  };

  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <label className="block">
          <span className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">{q.bankName || 'Bank name'}</span>
          <input type="text" value={bank} list="bank-name-suggestions" maxLength={MAX_BANK_NAME} autoFocus={!initial.id}
            onChange={(e) => setBank(e.target.value)} onBlur={() => setTouched(true)}
            className={inputClass} placeholder={q.bankNamePlaceholder || 'e.g. ABA'} />
          {/* "Required" waits until the field is left; a clash shows as soon as it's typed. */}
          {nameProblem && (touched || bank.trim()) && <span className="block text-xs font-semibold text-rose-600 dark:text-rose-400 mt-1">{nameProblem}</span>}
        </label>
        <QrImage src={image} alt={bank} />
        {imageError && <p className="text-xs font-semibold text-rose-600 dark:text-rose-400">{imageError}</p>}
        <div className="flex items-center justify-between gap-2">
          {onRemove ? (
            <button type="button" onClick={onRemove}
              className="px-3 py-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer">
              <Trash2 size={13} /> {q.removeBank || 'Remove bank'}
            </button>
          ) : <span />}
          <div className="flex items-center gap-2">
            <UploadButton label={image ? q.replace || 'Replace image' : q.chooseImage || 'Choose QR image'} onFile={pick} />
            <button type="submit" disabled={!image || Boolean(nameProblem)} className={primaryBtn}>{submitLabel}</button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
