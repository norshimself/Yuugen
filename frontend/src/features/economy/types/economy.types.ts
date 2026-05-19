// src/features/economy/types/economy.types.ts

export interface UserProfile {
  userId: string;
  xp: number;
  level: number;
  coins: number;
  bank: number;
  inventory: string[];
}

export interface ShopItem {
  id: string;
  name: string;
  price: number;
  description: string;
}

export interface EconomyStatusMessage {
  text: string;
  success: boolean;
}

export interface DailyClaimResponse {
  success: boolean;
  amount?: number;
  nextClaim?: string;
}

export interface WorkResponse {
  success: boolean;
  amount?: number;
  job?: string;
  nextClaim?: string;
}

export interface CrimeResponse {
  success: boolean;
  won?: boolean;
  amount?: number;
  crime?: string;
  nextClaim?: string;
}

export interface GambleResponse {
  success: boolean;
  won?: boolean;
  amount?: number;
}

export interface BuyItemResponse {
  success: boolean;
  message: string;
}
