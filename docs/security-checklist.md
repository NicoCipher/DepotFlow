# DepotFlow Security Checklist

Before release, verify:

- .env.local is gitignored
- no Supabase secret/service-role key exists in browser code
- no secrets are committed to git history
- RLS enabled on every exposed table
- RLS policies tested using multiple users
- no customer/user record accessible by changing an ID
- server/database validates stock before sale completion
- stock cannot become negative under concurrent requests
- inputs validated server-side
- production errors do not expose stack traces/secrets
- logs contain no secrets/session tokens
- auth checks use trusted Supabase claims
- protected mutations cannot rely only on UI checks
- uploaded product images restricted by type/size when implemented
- rate limits added where abuse is realistic
- dependencies audited before deployment