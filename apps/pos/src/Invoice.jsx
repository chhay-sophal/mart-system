import { useEffect, useRef, useState } from 'react';
import { useReactToPrint } from 'react-to-print';
import { translations as t } from './locales';
import { useToast } from './Toast';
import { PRINT_WIDTH_MM } from './receipt/raster';
import { printReceiptDirect, printerConfig, receiptImageUrl, receiptLocale } from './receipt/thermalPrinter';

const errorText = (err) => (typeof err === 'string' ? err : err?.message) || String(err);

/**
 * Prints one receipt as soon as it mounts, then calls onClose. There's one
 * receipt layout (receipt/raster.js), shaped by Settings > Printer:
 *  - thermal printer set up (`printer.direct`): sent straight to it as ESC/POS;
 *  - otherwise: the same receipt image through the system print dialog.
 * `printer` is thermalPrinter.printerConfig(settings).
 */
export default function Invoice({ invoiceData, locale, onClose, printer: printerProp }) {
  const [printer] = useState(() => printerProp ?? printerConfig());
  const inv = t[receiptLocale(printer, locale)].invoice;
  const notify = useToast();
  const contentRef = useRef(null);
  const started = useRef(false);
  const [imageUrl, setImageUrl] = useState(null);

  const fail = (err) => {
    notify(err ? (inv.printFailedReason || "Couldn't print the receipt: {error}").replace('{error}', errorText(err)) : inv.printFailed);
    onClose();
  };

  const handlePrint = useReactToPrint({
    contentRef,
    documentTitle: `receipt-${String(invoiceData.order_id).padStart(5, '0')}`,
    pageStyle: `
      @page { size: ${printer.paper}mm auto; margin: 0; }
      html, body { margin: 0; padding: 0; background: #fff; }
      img { display: block; width: ${PRINT_WIDTH_MM[printer.paper]}mm; margin: 0 auto; }
      .copy { padding-bottom: ${printer.receipt.feedLines * 4}mm; break-after: page; }
      .copy:last-child { break-after: auto; }
    `,
    onAfterPrint: onClose,
    // Inside the Tauri window there's nothing better to fall back to (a
    // popup replaces the app, issue #9): report it.
    onPrintError: () => fail(),
  });

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (printer.direct) {
      printReceiptDirect(invoiceData, locale, printer).then(onClose, fail);
    } else {
      receiptImageUrl(invoiceData, locale, printer).then(setImageUrl, fail);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Off-screen: only there for the print dialog to copy.
  return (
    <div style={{ position: 'fixed', top: '-10000px', left: '-10000px', pointerEvents: 'none' }} aria-hidden="true">
      {imageUrl && (
        <div ref={contentRef}>
          {Array.from({ length: printer.receipt.copies }, (_, i) => (
            <div key={i} className="copy">
              {/* Print once the image has loaded, so the dialog never gets a blank receipt. */}
              <img src={imageUrl} alt="" onLoad={i === 0 ? () => handlePrint() : undefined} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
