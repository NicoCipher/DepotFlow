import Link from "next/link";

export function SessionRecoveryLink({ message }: { message?: string }) {
  if (!message?.startsWith("Your session has expired")) return null;
  return <Link href="/sign-in" target="_blank" rel="noopener noreferrer" className="quiet-link">Sign in in a new tab</Link>;
}
