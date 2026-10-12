import Link from "next/link";
import { SessionRecoveryLink } from "./session-recovery-link";

export function ReviewSaveActions({
  message,
  pending,
  retryable,
  saveLabel,
  retryLabel,
  changeLabel,
  onBack,
}: {
  message?: string;
  pending: boolean;
  retryable?: boolean;
  saveLabel: string;
  retryLabel: string;
  changeLabel: string;
  onBack: () => void;
}) {
  const blocked = Boolean(message && !retryable);
  const checkHistoryFirst = blocked && /check stock history/i.test(message ?? "");

  return (
    <>
      {message && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-900">{message}</p>}
      <SessionRecoveryLink message={message} />
      {checkHistoryFirst ? (
        <Link href="/activity?type=stock" className="primary w-full">
          Check stock history →
        </Link>
      ) : blocked ? (
        <button type="button" className="primary w-full" disabled={pending} onClick={onBack}>
          Review details again
        </button>
      ) : (
        <>
          <button className="primary w-full" disabled={pending}>
            {pending ? "Saving…" : retryable ? retryLabel : saveLabel}
          </button>
          <button
            type="button"
            className="quiet-link w-full text-center"
            disabled={pending || retryable}
            onClick={onBack}
          >
            {changeLabel}
          </button>
        </>
      )}
    </>
  );
}
