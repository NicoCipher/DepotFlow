"use client";
import { useEffect, useState } from "react";
export function SuccessToast({ message }: { message: string }) {
  const [visible, setVisible] = useState(true);
  useEffect(() => { const timer = window.setTimeout(() => setVisible(false), 4500); return () => window.clearTimeout(timer); }, []);
  return visible ? <p role="status" className="fixed left-4 right-4 top-4 z-50 mx-auto max-w-xl rounded-xl bg-emerald-950 px-4 py-3 text-sm font-semibold text-white shadow-xl sm:top-6">✓ {message}</p> : null;
}
