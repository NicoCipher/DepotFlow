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
  return (
    <>
      {message && <p role="alert" className="text-red-800">{message}</p>}
      <SessionRecoveryLink message={message} />
      <button className="primary w-full" disabled={pending}>
        {pending ? "Saving…" : retryable ? retryLabel : saveLabel}
      </button>
      <button type="button" className="quiet-link w-full text-center"
        disabled={pending || retryable} onClick={onBack}>
        {changeLabel}
      </button>
    </>
  );
}
