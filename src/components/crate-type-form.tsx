"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { saveCrateType } from "@/app/(shop)/crate-types/actions";
import { validateCrateType } from "@/domain/crate-types";
export function CrateTypeForm({
  id,
  editing = false,
  initial,
}: {
  id: string;
  editing?: boolean;
  initial: Parameters<typeof validateCrateType>[0];
}) {
  const [submissionId] = useState(id);
  const [values, setValues] = useState(initial);
  const [pocket, setPocket] = useState(
    ["12", "20", "24"].includes(initial.pocket_count)
      ? initial.pocket_count
      : initial.pocket_count
        ? "other"
        : "",
  );
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  function field(
    key: "name" | "empty_family" | "variant",
    label: string,
    limit: number,
  ) {
    return (
      <div>
        <label htmlFor={key}>{label}</label>
        <input
          id={key}
          value={values[key]}
          maxLength={limit}
          required={key !== "variant"}
          onChange={(event) =>
            setValues({ ...values, [key]: event.target.value })
          }
        />
      </div>
    );
  }
  return (
    <form
      className="mt-6 space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (pending) return;
        try {
          validateCrateType(values);
        } catch {
          setMessage("Enter a name, family and positive whole pocket count.");
          return;
        }
        startTransition(async () => {
          try {
            const result = await saveCrateType(submissionId, editing, values);
            if (result.saved) {
              router.push("/crate-types?saved=1");
              router.refresh();
            } else setMessage(result.message ?? "Could not save.");
          } catch {
            setMessage(
              "Could not connect. Your details are still here. Please try again.",
            );
          }
        });
      }}
    >
      <section className="rounded-lg border border-stone-300 bg-white p-4">
        <h2 className="font-semibold">What to record for a physical crate</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-stone-700">
          <li>A name people in the depot recognize</li>
          <li>Its crate family or group</li>
          <li>How many bottle spaces it has</li>
          <li>Its shape/version only when needed to tell similar crates apart</li>
        </ul>
        <p className="mt-2 text-sm text-stone-600">
          Being in the same family does not automatically mean two crates can replace each other.
        </p>
      </section>
      <fieldset disabled={pending} className="space-y-5">
        {field("name", "Crate name", 120)}
        {field("empty_family", "Crate family / group", 80)}
        <div>
          <label htmlFor="pockets">Bottle spaces in the crate</label>
          <p className="mb-2 text-sm text-stone-600">
            Example: 12 means the crate holds 12 bottles.
          </p>
          <select
            id="pockets"
            required
            className="min-h-12 w-full rounded-md border border-stone-400 bg-white p-3"
            value={pocket}
            onChange={(event) => {
              setPocket(event.target.value);
              setValues({
                ...values,
                pocket_count:
                  event.target.value === "other" ? "" : event.target.value,
              });
            }}
          >
            <option value="">Choose bottle spaces</option>
            {[12, 20, 24].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
            <option value="other">Other</option>
          </select>
        </div>
        {pocket === "other" && (
          <div>
            <label htmlFor="other-pockets">Other number of bottle spaces</label>
            <input
              id="other-pockets"
              inputMode="numeric"
              pattern="[0-9]+"
              required
              maxLength={10}
              value={values.pocket_count}
              onChange={(event) =>
                setValues({ ...values, pocket_count: event.target.value })
              }
            />
          </div>
        )}
        {field("variant", "Shape / version (optional)", 120)}
      </fieldset>
      {message && (
        <p role="alert" className="text-red-800">
          {message}
        </p>
      )}
      <button className="primary w-full" disabled={pending}>
        {pending ? "Saving…" : editing ? "Save changes" : "Add physical crate"}
      </button>
      <Link className="quiet-link block text-center" href="/crate-types">
        Cancel
      </Link>
    </form>
  );
}
