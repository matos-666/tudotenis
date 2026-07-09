import { defineCloudflareConfig } from '@opennextjs/cloudflare';

// Config mínima para o primeiro deploy. ISR/cache incremental persistente
// (R2/KV) fica como follow-up — sem ele, o revalidate funciona por
// instância (aceitável ao tráfego actual; as páginas live já usam
// revalidate curto + AutoRefresh).
export default defineCloudflareConfig({});
