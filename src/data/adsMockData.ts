export interface AdCampaign {
  id: string;
  platform: "meta" | "google";
  name: string;
  status: "ativa" | "pausada" | "finalizada";
  investment: number;
  leads: number;
  cpl: number;
  conversions: number;
  revenue: number;
  roi: number;
  cpa: number;
  period: string;
}

export interface AdAccount {
  platform: "meta" | "google";
  accountName: string;
  accountId: string;
  connected: boolean;
  lastSync: string;
}

export const mockAdAccounts: AdAccount[] = [
  { platform: "google", accountName: "Clínica Odonto — Google Ads", accountId: "xxx-xxx-4521", connected: true, lastSync: "08/04/2026 09:32" },
  { platform: "meta", accountName: "Clínica Odonto — Meta Business", accountId: "act_98732145", connected: true, lastSync: "08/04/2026 09:30" },
];

export const mockAdCampaigns: AdCampaign[] = [
  { id: "ga1", platform: "google", name: "Implantes Dentários SP", status: "ativa", investment: 4200, leads: 129, cpl: 32.56, conversions: 17, revenue: 82400, roi: 19.6, cpa: 247, period: "Mar 2026" },
  { id: "ga2", platform: "google", name: "Ortodontia Invisalign", status: "ativa", investment: 2000, leads: 68, cpl: 29.41, conversions: 10, revenue: 51100, roi: 25.6, cpa: 200, period: "Mar 2026" },
  { id: "ga3", platform: "google", name: "Clareamento Zona Sul", status: "pausada", investment: 1500, leads: 42, cpl: 35.71, conversions: 6, revenue: 12600, roi: 8.4, cpa: 250, period: "Mar 2026" },
  { id: "ma1", platform: "meta", name: "Clareamento Dental Promo", status: "ativa", investment: 3800, leads: 95, cpl: 40.0, conversions: 12, revenue: 38200, roi: 10.1, cpa: 316, period: "Mar 2026" },
  { id: "ma2", platform: "meta", name: "Branding Instagram Feed", status: "ativa", investment: 2400, leads: 54, cpl: 44.44, conversions: 5, revenue: 15800, roi: 6.6, cpa: 480, period: "Mar 2026" },
  { id: "ma3", platform: "meta", name: "Reels — Depoimentos", status: "finalizada", investment: 1200, leads: 38, cpl: 31.58, conversions: 8, revenue: 19200, roi: 16.0, cpa: 150, period: "Fev 2026" },
];

export interface CrmCrossData {
  campaignId: string;
  campaignName: string;
  platform: "meta" | "google";
  leadsGenerated: number;
  leadsInCrm: number;
  contacted: number;
  scheduled: number;
  converted: number;
  conversionRate: number;
  avgTicket: number;
  totalRevenue: number;
}

export const mockCrmCrossData: CrmCrossData[] = [
  { campaignId: "ga1", campaignName: "Implantes Dentários SP", platform: "google", leadsGenerated: 129, leadsInCrm: 124, contacted: 98, scheduled: 34, converted: 17, conversionRate: 13.2, avgTicket: 4847, totalRevenue: 82400 },
  { campaignId: "ga2", campaignName: "Ortodontia Invisalign", platform: "google", leadsGenerated: 68, leadsInCrm: 65, contacted: 52, scheduled: 18, converted: 10, conversionRate: 14.7, avgTicket: 5110, totalRevenue: 51100 },
  { campaignId: "ma1", campaignName: "Clareamento Dental Promo", platform: "meta", leadsGenerated: 95, leadsInCrm: 88, contacted: 71, scheduled: 22, converted: 12, conversionRate: 12.6, avgTicket: 3183, totalRevenue: 38200 },
  { campaignId: "ma2", campaignName: "Branding Instagram Feed", platform: "meta", leadsGenerated: 54, leadsInCrm: 48, contacted: 30, scheduled: 10, converted: 5, conversionRate: 9.3, avgTicket: 3160, totalRevenue: 15800 },
  { campaignId: "ma3", campaignName: "Reels — Depoimentos", platform: "meta", leadsGenerated: 38, leadsInCrm: 36, contacted: 28, scheduled: 14, converted: 8, conversionRate: 21.1, avgTicket: 2400, totalRevenue: 19200 },
];
