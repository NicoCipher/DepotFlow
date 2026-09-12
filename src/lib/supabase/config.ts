export function supabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase URL and publishable key are required.");
  if (!key.startsWith("sb_publishable_")) throw new Error("Use a Supabase publishable key.");
  return { url, key };
}
