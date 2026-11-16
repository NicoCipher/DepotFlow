import Link from "next/link";
import { RecoveryForm } from "./recovery-form";

export default function ForgotPasswordPage() {
  return (
    <section className="mx-auto w-full max-w-xl">
      <h1>Reset your password</h1>
      <p className="mt-3 text-sm leading-6 text-stone-600">
        Enter the email address used for your DepotFlow account. We will send a secure link if an account matches.
      </p>
      <RecoveryForm />
      <p className="mt-5 text-sm text-stone-600"><Link className="quiet-link" href="/sign-in?next=%2Fbusinesses">Back to sign in</Link></p>
    </section>
  );
}
