"use client";

import { useState } from "react";

type ReceiptShareItem = {
  name: string;
  quantity: string;
  amount: string;
};

type ReceiptImageData = {
  businessName: string;
  businessAddress: string;
  businessPhone: string;
  title: string;
  customer: string;
  date: string;
  method: string;
  amount: string;
  total?: string;
  balanceLabel: string;
  balance: string;
  status: "paid" | "partial" | "voided";
  note?: string;
  items: ReceiptShareItem[];
};

const receiptWidth = 1080;
const sidePadding = 76;
const contentWidth = receiptWidth - sidePadding * 2;

function wrapLines(
  context: CanvasRenderingContext2D,
  value: string,
  maxWidth: number,
) {
  const paragraphs = value.split(/\r?\n/);
  const lines: string[] = [];

  for (const paragraph of paragraphs) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }

    let line = words[0];
    for (const word of words.slice(1)) {
      const candidate = line + " " + word;
      if (context.measureText(candidate).width <= maxWidth) {
        line = candidate;
      } else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }

  return lines;
}

function drawCenteredText(
  context: CanvasRenderingContext2D,
  value: string,
  y: number,
  maxWidth: number,
  lineHeight: number,
) {
  const lines = wrapLines(context, value, maxWidth);
  context.textAlign = "center";
  for (const line of lines) {
    context.fillText(line, receiptWidth / 2, y);
    y += lineHeight;
  }
  return y;
}

function drawDivider(context: CanvasRenderingContext2D, y: number) {
  context.strokeStyle = "#d6d3d1";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(sidePadding, y);
  context.lineTo(receiptWidth - sidePadding, y);
  context.stroke();
}

function drawSummaryRow(
  context: CanvasRenderingContext2D,
  label: string,
  value: string,
  y: number,
  emphasized = false,
) {
  context.textAlign = "left";
  context.fillStyle = emphasized ? "#052e16" : "#44403c";
  context.font = (emphasized ? "700 34px " : "500 29px ") + "Arial, sans-serif";
  context.fillText(label, sidePadding, y);

  context.textAlign = "right";
  context.fillStyle = emphasized ? "#052e16" : "#1c1917";
  context.font = (emphasized ? "700 38px " : "700 30px ") + "Arial, sans-serif";
  context.fillText(value, receiptWidth - sidePadding, y);
  return y + (emphasized ? 62 : 52);
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not load the receipt QR code."));
    image.src = src;
  });
}

function canvasToPng(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Could not create the receipt image."));
    }, "image/png");
  });
}

async function createReceiptPng(
  number: string,
  qrDataUrl: string,
  data: ReceiptImageData,
) {
  const staging = document.createElement("canvas");
  staging.width = receiptWidth;
  staging.height = 1900 + data.items.length * 190;
  const context = staging.getContext("2d");
  if (!context) throw new Error("Receipt image generation is unavailable.");

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, staging.width, staging.height);
  context.fillStyle = "#065f46";
  context.fillRect(0, 0, staging.width, 20);

  let y = 96;
  context.fillStyle = "#1c1917";
  context.font = "700 50px Arial, sans-serif";
  y = drawCenteredText(context, data.businessName, y, contentWidth, 60);

  if (data.businessAddress.trim()) {
    context.fillStyle = "#57534e";
    context.font = "400 27px Arial, sans-serif";
    y = drawCenteredText(
      context,
      data.businessAddress.trim(),
      y + 4,
      contentWidth - 80,
      38,
    );
  }

  if (data.businessPhone.trim()) {
    context.fillStyle = "#57534e";
    context.font = "500 27px Arial, sans-serif";
    y = drawCenteredText(
      context,
      data.businessPhone.trim(),
      y + 2,
      contentWidth,
      38,
    );
  }

  y += 28;
  drawDivider(context, y);
  y += 58;

  context.fillStyle = "#065f46";
  context.font = "700 30px Arial, sans-serif";
  context.textAlign = "center";
  context.fillText(data.title.toUpperCase(), receiptWidth / 2, y);
  y += 52;

  context.fillStyle = "#1c1917";
  context.font = "700 38px Arial, sans-serif";
  context.fillText(number, receiptWidth / 2, y);
  y += 52;

  const statusLabel =
    data.status === "voided"
      ? "VOIDED RECEIPT"
      : data.status === "partial"
        ? "PARTIAL PAYMENT"
        : "PAID IN FULL";
  context.fillStyle =
    data.status === "voided"
      ? "#991b1b"
      : data.status === "partial"
        ? "#92400e"
        : "#065f46";
  context.font = "700 27px Arial, sans-serif";
  context.fillText(statusLabel, receiptWidth / 2, y);
  y += 58;

  drawDivider(context, y);
  y += 54;

  context.textAlign = "left";
  context.fillStyle = "#78716c";
  context.font = "600 24px Arial, sans-serif";
  context.fillText("CUSTOMER", sidePadding, y);
  context.fillStyle = "#1c1917";
  context.font = "700 34px Arial, sans-serif";
  const customerLines = wrapLines(context, data.customer, contentWidth);
  y += 43;
  for (const line of customerLines) {
    context.fillText(line, sidePadding, y);
    y += 43;
  }

  y += 14;
  context.fillStyle = "#78716c";
  context.font = "600 24px Arial, sans-serif";
  context.fillText("DATE", sidePadding, y);
  context.textAlign = "right";
  context.fillStyle = "#1c1917";
  context.font = "700 28px Arial, sans-serif";
  context.fillText(data.date, receiptWidth - sidePadding, y);
  y += 54;

  context.textAlign = "left";
  context.fillStyle = "#78716c";
  context.font = "600 24px Arial, sans-serif";
  context.fillText("PAYMENT METHOD", sidePadding, y);
  context.textAlign = "right";
  context.fillStyle = "#1c1917";
  context.font = "700 28px Arial, sans-serif";
  context.fillText(data.method, receiptWidth - sidePadding, y);
  y += 64;

  if (data.note) {
    context.textAlign = "left";
    context.fillStyle = "#57534e";
    context.font = "400 27px Arial, sans-serif";
    const noteLines = wrapLines(context, data.note, contentWidth);
    for (const line of noteLines) {
      context.fillText(line, sidePadding, y);
      y += 38;
    }
    y += 18;
  }

  if (data.items.length > 0) {
    drawDivider(context, y);
    y += 54;
    context.textAlign = "left";
    context.fillStyle = "#065f46";
    context.font = "700 25px Arial, sans-serif";
    context.fillText("ITEMS", sidePadding, y);
    y += 48;

    for (const item of data.items) {
      const itemStart = y;
      context.textAlign = "left";
      context.fillStyle = "#1c1917";
      context.font = "700 31px Arial, sans-serif";
      const nameLines = wrapLines(context, item.name, 620);
      for (const line of nameLines) {
        context.fillText(line, sidePadding, y);
        y += 40;
      }

      context.textAlign = "right";
      context.font = "700 31px Arial, sans-serif";
      context.fillText(item.amount, receiptWidth - sidePadding, itemStart);

      context.textAlign = "left";
      context.fillStyle = "#57534e";
      context.font = "400 26px Arial, sans-serif";
      context.fillText(item.quantity, sidePadding, y + 2);
      y += 52;

      context.strokeStyle = "#e7e5e4";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(sidePadding, y);
      context.lineTo(receiptWidth - sidePadding, y);
      context.stroke();
      y += 34;
    }
  }

  drawDivider(context, y);
  y += 62;

  if (data.total) {
    y = drawSummaryRow(context, "Sale total", data.total, y);
  }
  y = drawSummaryRow(context, "Amount received", data.amount, y, true);
  y = drawSummaryRow(context, data.balanceLabel, data.balance, y);
  y += 14;

  drawDivider(context, y);
  y += 56;

  try {
    const qr = await loadImage(qrDataUrl);
    const qrSize = 270;
    context.drawImage(qr, (receiptWidth - qrSize) / 2, y, qrSize, qrSize);
    y += qrSize + 38;
    context.fillStyle = "#1c1917";
    context.font = "700 27px Arial, sans-serif";
    context.textAlign = "center";
    context.fillText("Scan to verify this receipt", receiptWidth / 2, y);
    y += 40;
  } catch {
    context.fillStyle = "#57534e";
    context.font = "500 26px Arial, sans-serif";
    context.textAlign = "center";
    context.fillText(
      "Use the verification link shared with this image.",
      receiptWidth / 2,
      y,
    );
    y += 44;
  }

  context.fillStyle = "#78716c";
  context.font = "400 22px Arial, sans-serif";
  context.textAlign = "center";
  context.fillText("Receipt generated by DepotFlow", receiptWidth / 2, y);
  y += 64;

  const output = document.createElement("canvas");
  output.width = receiptWidth;
  output.height = Math.ceil(y);
  const outputContext = output.getContext("2d");
  if (!outputContext)
    throw new Error("Receipt image generation is unavailable.");
  outputContext.fillStyle = "#ffffff";
  outputContext.fillRect(0, 0, output.width, output.height);
  outputContext.drawImage(staging, 0, 0);

  return canvasToPng(output);
}

function downloadBlob(blob: Blob, filename: string) {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

function receiptFilename(number: string) {
  const safeNumber = number.replace(/[^a-z0-9_-]+/gi, "-");
  return "receipt-" + safeNumber + ".png";
}

function shortReceiptText(
  businessName: string,
  number: string,
  url: string,
) {
  return businessName + " receipt " + number + "\nVerify: " + url;
}

export function ShareReceipt({
  url,
  number,
  qrDataUrl,
  receipt,
}: {
  url: string;
  number: string;
  qrDataUrl: string;
  receipt: ReceiptImageData;
}) {
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);

  async function fallbackToText() {
    const text = shortReceiptText(receipt.businessName, number, url);
    if (navigator.share) {
      await navigator.share({
        title: "Receipt " + number,
        text,
      });
      setFeedback("Receipt verification details shared.");
      return;
    }

    await navigator.clipboard.writeText(text);
    setFeedback("Receipt verification details copied.");
  }

  async function share() {
    setFeedback("");
    setBusy(true);
    try {
      const blob = await createReceiptPng(number, qrDataUrl, receipt);
      const file = new File([blob], receiptFilename(number), {
        type: "image/png",
      });
      const canShareFile =
        Boolean(navigator.share) &&
        (!navigator.canShare || navigator.canShare({ files: [file] }));

      if (canShareFile && navigator.share) {
        try {
          await navigator.share({
            title: "Receipt " + number,
            text: shortReceiptText(receipt.businessName, number, url),
            files: [file],
          });
          setFeedback("Receipt image shared.");
          return;
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError")
            return;
        }
      }

      downloadBlob(blob, receiptFilename(number));
      try {
        await navigator.clipboard.writeText(
          shortReceiptText(receipt.businessName, number, url),
        );
        setFeedback(
          "Your phone could not attach the image automatically. The PNG was saved and the verification link was copied.",
        );
      } catch {
        setFeedback(
          "Your phone could not attach the image automatically. The receipt PNG was saved so you can share it from Photos or Files.",
        );
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      try {
        await fallbackToText();
      } catch (fallbackError) {
        if (
          fallbackError instanceof DOMException &&
          fallbackError.name === "AbortError"
        )
          return;
        setFeedback(
          "Could not create the receipt image. Open the verification link and share it instead.",
        );
      }
    } finally {
      setBusy(false);
    }
  }

  async function savePng() {
    setFeedback("");
    setBusy(true);
    try {
      const blob = await createReceiptPng(number, qrDataUrl, receipt);
      downloadBlob(blob, receiptFilename(number));
      setFeedback("Receipt PNG saved.");
    } catch {
      setFeedback("Could not create the receipt image.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        className="primary w-full"
        type="button"
        onClick={share}
        disabled={busy}
      >
        {busy ? "Preparing receipt…" : "Share Receipt"}
      </button>
      <button
        className="secondary w-full"
        type="button"
        onClick={savePng}
        disabled={busy}
      >
        Save PNG
      </button>
      {feedback && (
        <p role="status" aria-live="polite" className="text-sm text-emerald-900">
          {feedback}
        </p>
      )}
    </div>
  );
}
