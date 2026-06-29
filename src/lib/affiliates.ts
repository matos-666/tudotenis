/**
 * Casas de apostas parceiras (OneTwoAffiliates network).
 * Todos os links externos devem ter rel="sponsored noopener" e target="_blank".
 *
 * Tracking: campaign_id identifica a casa, ref_id=370 é o nosso publisher ID.
 */

export interface Affiliate {
  slug: 'twin' | 'leon';
  name: string;
  trackingUrl: string;
  badge?: string;
  primary?: boolean;
}

export const AFFILIATES: Affiliate[] = [
  {
    slug: 'twin',
    name: 'Twin',
    trackingUrl: 'https://dashboard.onetwoaffiliates.com/click?campaign_id=796&ref_id=370',
    badge: 'Principal',
    primary: true,
  },
  {
    slug: 'leon',
    name: 'Leon',
    trackingUrl: 'https://dashboard.onetwoaffiliates.com/click?campaign_id=797&ref_id=370',
    badge: 'Alternativa',
  },
];

export function getAffiliate(slug: 'twin' | 'leon'): Affiliate {
  return AFFILIATES.find(a => a.slug === slug) ?? AFFILIATES[0];
}
