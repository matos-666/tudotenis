# Variáveis de ambiente — Vercel

Adicionar via Vercel Dashboard → Settings → Environment Variables
(ou via CLI durante o deploy)

## Production + Preview + Development

```
NEXT_PUBLIC_SUPABASE_URL=https://imcwzhvblvgjvkaljzdn.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key do Supabase>
SUPABASE_SERVICE_ROLE_KEY=<service role key do Supabase>
NEXT_PUBLIC_SITE_URL=https://tudotenis.com
```

⚠️ **SUPABASE_SERVICE_ROLE_KEY** deve estar marcada como **Sensitive**
(Vercel encripta e nunca expõe em logs)
