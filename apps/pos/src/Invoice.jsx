import React, { useEffect, useRef, useState } from 'react';
import { jsPDF } from 'jspdf';
import { Printer } from 'lucide-react';
import { useReactToPrint } from 'react-to-print';
import { translations as t } from './locales';

export default function Invoice({ invoiceData, locale, onClose, autoPrint = false }) {
  const { order_id, items, subtotalBeforeDiscountUsd, transactionDiscountUsd, totalDiscountUsd, totalUsd, mainCurrency, dynamicRate, paymentMethod, bankName, amountPaidUsd, amountPaidKhr, changeDueKhr, timestamp, storeName, storeAddress, storePhone } = invoiceData;

  const inv = t[locale].invoice;
  const shopName = storeName || t[locale].shopName;
  const [printing, setPrinting] = useState(false);
  const componentRef = useRef(null);
  const hasAutoPrinted = useRef(false);

  const printPageStyle = `
    @page {
      size: 58mm auto;
      margin: 0;
    }
    html, body {
      width: 58mm;
      margin: 0;
      padding: 0;
      background: #fff;
    }
    body {
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
      font-size: 9pt;
    }
    * {
      box-sizing: border-box;
    }
  `;

  const printFallback = () => {
    const printWindow = window.open('', '_blank', 'width=400,height=600');
    if (!printWindow) {
      setPrinting(false);
      return;
    }

    printWindow.document.write(buildInvoiceHTML());
    printWindow.document.close();
    printWindow.focus();

    setTimeout(() => {
      printWindow.print();
      printWindow.close();
      setPrinting(false);
      if (autoPrint) onClose();
    }, 250);
  };

  const handlePrint = useReactToPrint({
    contentRef: componentRef,
    documentTitle: `invoice-${String(order_id).padStart(5, '0')}`,
    pageStyle: printPageStyle,
    onBeforePrint: () => {
      setPrinting(true);
      return Promise.resolve();
    },
    onAfterPrint: () => {
      setPrinting(false);
      if (autoPrint) onClose();
    },
    onPrintError: () => printFallback(),
  });

  // Auto-print flow (e.g. the register's "Print Receipt" button): skip the
  // preview modal entirely and send straight to the printer on mount.
  useEffect(() => {
    if (autoPrint && !hasAutoPrinted.current) {
      hasAutoPrinted.current = true;
      handlePrint();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const date = new Date(timestamp);
  const dateStr = `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
  const timeStr = date.toLocaleTimeString(locale === 'km' ? 'km-KH' : 'en-US', {
    hour: '2-digit', minute: '2-digit',
  });
  const dateTimeStr = `${dateStr} ${timeStr}`;

  const fmtUnit = (price, currency) => {
    const p = Number(price);
    return currency === 'KHR' ? `${Math.round(p).toLocaleString()} ៛` : `$${p.toFixed(2)}`;
  };
  const fmtSubtotal = (price, qty, currency) => {
    const p = Number(price);
    return currency === 'KHR' ? `${Math.round(p * qty).toLocaleString()} ៛` : `$${(p * qty).toFixed(2)}`;
  };
  const discountedUnitPrice = (item) => {
    const p = Number(item.price);
    if (!item.discount) return p;
    return item.discountType === 'fixed' ? Math.max(0, p - item.discount) : p * (1 - item.discount / 100);
  };
  const fmtDiscountedSubtotal = (item) => fmtUnit(discountedUnitPrice(item) * item.quantity, item.currency);
  const fmtItemDiscountLabel = (item) => item.discountType === 'fixed' ? `−${fmtUnit(item.discount, item.currency)}` : `−${item.discount}%`;

  // Summary amounts (subtotal/discount/total) follow the store's configured main currency.
  const fmtPrimary = (usd) => mainCurrency === 'KHR'
    ? `${Math.round(usd * dynamicRate).toLocaleString()} ៛`
    : `$${usd.toFixed(2)}`;
  const fmtSecondary = (usd) => mainCurrency === 'KHR'
    ? `$${usd.toFixed(2)}`
    : `${Math.round(usd * dynamicRate).toLocaleString()} ៛`;

  // Build a self-contained HTML invoice with only rgb() colors — no Tailwind, no oklch.
  const buildInvoiceHTML = () => {
    const itemRows = items.map(item => `
      <tr>
        <td class="name">${item.name}${item.discount > 0 ? `<span class="item-discount">${fmtItemDiscountLabel(item)}</span>` : ''}</td>
        <td class="center">${item.quantity}</td>
        <td class="right unit">${fmtUnit(item.price, item.currency)}</td>
        <td class="right">${item.discount > 0
          ? `<span class="strike">${fmtSubtotal(item.price, item.quantity, item.currency)}</span><br>${fmtDiscountedSubtotal(item)}`
          : fmtSubtotal(item.price, item.quantity, item.currency)}</td>
      </tr>`).join('');

    const cashRows = paymentMethod === 'CASH' ? `
      ${amountPaidUsd > 0 ? `<div class="row"><span class="muted">${inv.paidUsd}</span><span>$${Number(amountPaidUsd).toFixed(2)}</span></div>` : ''}
      ${amountPaidKhr > 0 ? `<div class="row"><span class="muted">${inv.paidKhr}</span><span>${Number(amountPaidKhr).toLocaleString()} ៛</span></div>` : ''}
      ${changeDueKhr > 0 ? `<div class="row change"><span>${inv.change}</span><span>${changeDueKhr.toLocaleString()} ៛</span></div>` : ''}
    ` : '';

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Invoice #${String(order_id).padStart(5, '0')}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Siemreap', 'Courier New', Courier, monospace;
      font-size: 12px;
      color: rgb(0,0,0);
      background: rgb(255,255,255);
      max-width: 480px;
      margin: 0 auto;
      padding: 24px 20px;
    }
    @page { size: A4; margin: 12mm; }
    @media print { body { padding: 0; } }
    h1 { font-size: 15px; text-align: center; margin-bottom: 3px; }
    .subtitle { text-align: center; font-size: 10px; color: rgb(100,100,100); margin-bottom: 12px; }
    .dash  { border: none; border-top: 1px dashed rgb(180,180,180); margin: 8px 0; }
    .dash2 { border: none; border-top: 2px dashed rgb(150,150,150); margin: 8px 0; }
    .row   { display: flex; justify-content: space-between; font-size: 11px; margin: 2px 0; }
    .muted { color: rgb(120,120,120); }
    table  { width: 100%; border-collapse: collapse; }
    thead th { font-size: 10px; color: rgb(120,120,120); text-transform: uppercase; padding-bottom: 5px; font-weight: bold; text-align: left; }
    td { font-size: 11px; padding: 2px 0; vertical-align: top; }
    .center { text-align: center; }
    .right  { text-align: right; }
    .name   { padding-right: 8px; }
    .unit   { color: rgb(100,100,100); }
    .item-discount { display: block; font-size: 9px; color: rgb(180,120,20); font-weight: bold; }
    .strike { color: rgb(150,150,150); text-decoration: line-through; font-weight: normal; }
    thead th.center { text-align: center; }
    thead th.right  { text-align: right; }
    .total  { font-size: 13px; font-weight: bold; }
    .change { font-weight: bold; color: rgb(21,128,61); }
    .footer { text-align: center; font-size: 10px; color: rgb(120,120,120); margin-top: 4px; }
  </style>
</head>
<body>
  <h1>${shopName}</h1>
  <p class="subtitle">${inv.receiptTitle}</p>
  ${storeAddress ? `<p class="subtitle">${storeAddress}</p>` : ''}
  ${storePhone ? `<p class="subtitle">${storePhone}</p>` : ''}
  <hr class="dash2">

  <div class="row"><span class="muted">${inv.orderId}</span><span><strong>#${String(order_id).padStart(5, '0')}</strong></span></div>
  <div class="row"><span class="muted">${inv.date}</span><span>${dateTimeStr}</span></div>

  <hr class="dash">

  <table>
    <thead>
      <tr>
        <th>${inv.item}</th>
        <th class="center">${inv.qty}</th>
        <th class="right unit">${inv.unitPrice || 'Unit'}</th>
        <th class="right">${inv.amount}</th>
      </tr>
    </thead>
    <tbody>${itemRows}</tbody>
  </table>

  <hr class="dash2">

  ${transactionDiscountUsd > 0 ? `<div class="row"><span class="muted">${inv.txDiscount}</span><span>−${fmtPrimary(transactionDiscountUsd)}</span></div>` : ''}
  <div class="row"><span class="muted">${inv.subtotal}</span><span>${fmtPrimary(subtotalBeforeDiscountUsd)}</span></div>
  ${totalDiscountUsd > 0 ? `<div class="row"><span class="muted">${inv.discount}</span><span>−${fmtPrimary(totalDiscountUsd)}</span></div>` : ''}
  <div class="row total"><span>${inv.total}</span><span>${fmtPrimary(totalUsd)}</span></div>
  <div class="row muted"><span></span><span>${fmtSecondary(totalUsd)}</span></div>

  <hr class="dash">

  <div class="row"><span class="muted">${inv.payment}</span><span><strong>${paymentMethod === 'CASH' ? inv.cash : paymentMethod === 'KHQR' ? inv.khqr : bankName ? `${inv.staticQr} — ${bankName}` : inv.staticQr}</strong></span></div>
  ${cashRows}

  <hr class="dash2">

  <p class="footer">${inv.thankYou}</p>

</body>
</html>`;
  };

  // jsPDF text fallback (used only when the popup is blocked).
  const downloadPDF = () => {
    const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
    const W = pdf.internal.pageSize.getWidth();
    const m = 20;
    let y = m;

    const row = (left, right, bold = false) => {
      pdf.setFont('helvetica', bold ? 'bold' : 'normal');
      pdf.text(left, m, y);
      if (right !== undefined) pdf.text(right, W - m, y, { align: 'right' });
      y += 5;
    };
    const dash = (thick = false) => {
      pdf.setLineWidth(thick ? 0.4 : 0.2);
      pdf.setDrawColor(150);
      pdf.setLineDash([1, 1]);
      pdf.line(m, y, W - m, y);
      y += 4;
    };

    pdf.setFontSize(14); row(shopName, undefined, true);
    pdf.setFontSize(9);  row(inv.receiptTitle);
    if (storeAddress) row(storeAddress);
    if (storePhone) row(storePhone);
    dash(true);

    pdf.setFontSize(10);
    row(inv.orderId, `#${String(order_id).padStart(5, '0')}`);
    row(inv.date, dateTimeStr);
    dash();

    const qtyX  = m + (W - 2 * m) * 0.50;
    const unitX = m + (W - 2 * m) * 0.72;

    pdf.setFontSize(8);
    pdf.setFont('helvetica', 'bold');
    pdf.text(inv.item.toUpperCase(), m, y);
    pdf.text(inv.qty.toUpperCase(), qtyX, y, { align: 'center' });
    pdf.text((inv.unitPrice || 'UNIT').toUpperCase(), unitX, y, { align: 'right' });
    pdf.text(inv.amount.toUpperCase(), W - m, y, { align: 'right' });
    y += 4;

    pdf.setFontSize(10);
    items.forEach(item => {
      const nameLines = pdf.splitTextToSize(item.name, (W - 2 * m) * 0.46);
      pdf.setFont('helvetica', 'normal');
      pdf.setTextColor(0);

      if (item.discount > 0) {
        pdf.setFontSize(7);
        pdf.setTextColor(150);
        pdf.text(fmtSubtotal(item.price, item.quantity, item.currency), W - m, y, { align: 'right' });
        y += 3;
        pdf.setFontSize(10);
        pdf.setTextColor(0);
      }

      pdf.text(nameLines, m, y);
      pdf.text(String(item.quantity), qtyX, y, { align: 'center' });
      pdf.text(fmtUnit(item.price, item.currency), unitX, y, { align: 'right' });
      if (item.discount > 0) {
        pdf.setTextColor(180, 120, 20);
        pdf.text(fmtDiscountedSubtotal(item), W - m, y, { align: 'right' });
        pdf.setTextColor(0);
      } else {
        pdf.text(fmtSubtotal(item.price, item.quantity, item.currency), W - m, y, { align: 'right' });
      }
      y += nameLines.length * 4 + 1;

      if (item.discount > 0) {
        pdf.setFontSize(8);
        pdf.setTextColor(180, 120, 20);
        pdf.text(fmtItemDiscountLabel(item), m, y);
        pdf.setTextColor(0);
        pdf.setFontSize(10);
        y += 3.5;
      }
    });
    dash(true);

    pdf.setFontSize(10);
    if (transactionDiscountUsd > 0) row(inv.txDiscount, `−${fmtPrimary(transactionDiscountUsd)}`);
    row(inv.subtotal, fmtPrimary(subtotalBeforeDiscountUsd));
    if (totalDiscountUsd > 0) row(inv.discount, `−${fmtPrimary(totalDiscountUsd)}`);

    pdf.setFontSize(12); row(inv.total, fmtPrimary(totalUsd), true);
    pdf.setFontSize(9);
    pdf.setTextColor(100);
    pdf.text(fmtSecondary(totalUsd), W - m, y, { align: 'right' });
    pdf.setTextColor(0); y += 6;
    dash();

    pdf.setFontSize(10);
    row(inv.payment, paymentMethod === 'CASH' ? inv.cash : paymentMethod === 'KHQR' ? inv.khqr : bankName ? `${inv.staticQr} — ${bankName}` : inv.staticQr);
    if (paymentMethod === 'CASH') {
      if (amountPaidUsd > 0) row(inv.paidUsd, `$${Number(amountPaidUsd).toFixed(2)}`);
      if (amountPaidKhr > 0) row(inv.paidKhr, `${Number(amountPaidKhr).toLocaleString()} ៛`);
      if (changeDueKhr > 0) {
        pdf.setTextColor(21, 128, 61);
        row(inv.change, `${changeDueKhr.toLocaleString()} ៛`, true);
        pdf.setTextColor(0);
      }
    }
    dash(true);

    pdf.setFontSize(9);
    pdf.setTextColor(100);
    pdf.text(inv.thankYou, W / 2, y, { align: 'center' });
    pdf.setTextColor(0);

    pdf.save(`invoice-${String(order_id).padStart(5, '0')}.pdf`);
  };

  const receiptEl = (
          <div
            ref={componentRef}
            id="invoice-content"
            className="p-3 bg-white"
            style={{
              fontFamily: '"Siemreap", monospace',
              width: '58mm',
              maxWidth: '58mm',
              minWidth: '58mm',
              margin: '0 auto',
              padding: '1.5mm 1.5mm 2mm',
              color: '#000',
              lineHeight: 1.5,
              fontSize: '9pt',
              fontWeight: 'bold',
              WebkitPrintColorAdjust: 'exact',
              printColorAdjust: 'exact',
            }}
          >
            <div className="text-center mb-2 flex flex-col gap-1">
              <p className="text-[13px] leading-none">{shopName}</p>
              {storeAddress && <p className="text-[8px]">{storeAddress}</p>}
              {storePhone && <p className="text-[8px]">{inv.tel} {storePhone}</p>}
            </div>

            <div className="border-t mb-1.5" />

            <div className="text-center mb-1.5">
              <p className="text-[9px]">{inv.receiptTitle}</p>
            </div>

            <div className="text-[8px] space-y-0.5 mb-1.5">
              <div className="flex justify-between gap-2">
                <span className="">{inv.orderId}</span>
                <span className="font-bold">#{String(order_id).padStart(5, '0')}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="">{inv.date}</span>
                <span>{dateTimeStr}</span>
              </div>
            </div>

            <div className="border-t mb-1.5" />

            <div className="grid grid-cols-[10px_1fr_20px_30px_30px] gap-1 text-[7px] font-bold uppercase tracking-wide mb-1">
              <span>{inv.no}</span>
              <span>{inv.item}</span>
              <span className="text-center">{inv.qty}</span>
              <span className="text-center">{inv.unitPrice || 'Unit'}</span>
              {/* <span className="text-center">Disc</span> */}
              <span className="text-right">{inv.amount}</span>
            </div>

            <div className="space-y-1 mb-1.5">
              {items.map((item, index) => (
                <div key={item.id} className="grid grid-cols-[10px_1fr_20px_30px_30px] gap-1 items-start text-[7px] leading-[1.15]">
                  <div className="font-bold shrink-0">{index + 1}</div>
                  <div className="min-w-0">
                    <div className="break-words leading-[1.1]">{item.name}</div>
                    {item.discount > 0 && (
                      <div className="font-bold text-black">
                        {fmtItemDiscountLabel(item)}
                      </div>
                    )}
                  </div>
                  <div className="text-center font-bold shrink-0">{item.quantity}</div>
                  <div className="text-center whitespace-nowrap shrink-0">
                    {item.discount > 0 ? (
                      <div className="leading-[1.1]">
                        <div className="line-through">{fmtUnit(item.price, item.currency)}</div>
                        <div className="text-black">{fmtUnit(discountedUnitPrice(item), item.currency)}</div>
                      </div>
                    ) : (
                      fmtUnit(item.price, item.currency)
                    )}
                  </div>
                  {/* <div className="text-center whitespace-nowrap shrink-0">
                    {item.discount > 0 ? fmtItemDiscountLabel(item) : '-'}
                  </div> */}
                  <div className="text-right font-bold shrink-0">
                    {item.discount > 0 ? (
                      <div className="leading-[1.1]">
                        <div className="line-through">
                          {fmtSubtotal(item.price, item.quantity, item.currency)}
                        </div>
                        <div className="text-black">{fmtDiscountedSubtotal(item)}</div>
                      </div>
                    ) : (
                      fmtSubtotal(item.price, item.quantity, item.currency)
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="border-t mb-1.5" />

            <div className="space-y-0.5 text-[8px] mb-1.5">
              <div className="flex justify-between gap-2 ">
                <span>{inv.subtotal}</span>
                <span>{fmtPrimary(subtotalBeforeDiscountUsd)}</span>
              </div>
              {transactionDiscountUsd > 0 && (
                <div className="flex justify-between gap-2 ">
                  <span>{inv.txDiscount}</span>
                  <span>−{fmtPrimary(transactionDiscountUsd)}</span>
                </div>
              )}
              {totalDiscountUsd > 0 && (
                <div className="flex justify-between gap-2 ">
                  <span>{inv.discount}</span>
                  <span>−{fmtPrimary(totalDiscountUsd)}</span>
                </div>
              )}
              <div className="flex justify-between gap-2 font-black text-[9px]">
                <span>{inv.total}</span>
                <span>{fmtPrimary(totalUsd)}</span>
              </div>
              <div className="flex justify-between gap-2 ">
                <span />
                <span>{fmtSecondary(totalUsd)}</span>
              </div>
            </div>

            <div className="border-t mb-1.5" />

            <div className="space-y-0.5 text-[8px] mb-1.5">
              <div className="flex justify-between gap-2">
                <span className="">{inv.payment}</span>
                <span className="font-bold">{paymentMethod === 'CASH' ? inv.cash : paymentMethod === 'KHQR' ? inv.khqr : bankName ? `${inv.staticQr} — ${bankName}` : inv.staticQr}</span>
              </div>
              {paymentMethod === 'CASH' && (
                <>
                  {amountPaidUsd > 0 && (
                    <div className="flex justify-between gap-2">
                      <span className="">{inv.paidUsd}</span>
                      <span>${Number(amountPaidUsd).toFixed(2)}</span>
                    </div>
                  )}
                  {amountPaidKhr > 0 && (
                    <div className="flex justify-between gap-2">
                      <span className="">{inv.paidKhr}</span>
                      <span>{Number(amountPaidKhr).toLocaleString()} ៛</span>
                    </div>
                  )}
                  {changeDueKhr > 0 && (
                    <div className="flex justify-between gap-2 font-bold text-black">
                      <span>{inv.change}</span>
                      <span>{changeDueKhr.toLocaleString()} ៛</span>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="border-t mb-1.5" />

            <p className="text-center text-[7px]  font-semibold">{inv.thankYou}</p>
          </div>
  );

  // Auto-print flow (e.g. the register's "Print Receipt" button): skip the
  // preview modal entirely — mount the receipt off-screen just to print it.
  if (autoPrint) {
    return (
      <div style={{ position: 'fixed', top: '-10000px', left: '-10000px', pointerEvents: 'none' }} aria-hidden="true">
        {receiptEl}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div
        className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-xs mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Action bar */}
        <div className="flex gap-2 p-4 border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-900">
          <button
            onClick={() => handlePrint()}
            disabled={printing}
            className="flex-1 py-2.5 bg-indigo-600 text-white font-bold rounded-xl text-xs hover:bg-indigo-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
          >
            {printing ? '...' : <><Printer size={13} /> {inv.printBtn}</>}
          </button>
          <button
            onClick={onClose}
            disabled={printing}
            className="px-4 py-2.5 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold rounded-xl text-xs hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors disabled:opacity-60"
          >
            {inv.closeBtn}
          </button>
        </div>

        {/* Receipt preview */}
        <div className="max-h-[70vh] overflow-y-auto">
          {receiptEl}
        </div>
      </div>
    </div>
  );
}
