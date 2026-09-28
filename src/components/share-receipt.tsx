"use client";
import { useState } from "react";
export function ShareReceipt({ url, number, summary }: { url: string; number: string; summary: string }) {
  const [feedback, setFeedback] = useState("");
  async function share() {
    try {
      if (navigator.share) {
        await navigator.share({ title: `DepotFlow receipt ${number}`, text: `${summary}\nVerify receipt ${number}`, url });
        setFeedback("Receipt shared.");
      } else {
        await navigator.clipboard.writeText(url);
        setFeedback("Verification link copied. Paste it into WhatsApp or another app.");
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setFeedback("Could not share. Open the verification link and copy its address.");
    }
  }
  return <><button className="secondary w-full" type="button" onClick={share}>Share Receipt</button>{feedback && <p role="status" className="text-sm text-emerald-900">{feedback}</p>}</>;
}
