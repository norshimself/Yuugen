// src/features/economy/services/economyService.ts
import { apiClient } from "@/services/apiClient";
import { 
  UserProfile, 
  ShopItem, 
  DailyClaimResponse, 
  WorkResponse, 
  CrimeResponse, 
  GambleResponse, 
  BuyItemResponse 
} from "../types/economy.types";

export const economyService = {
  /**
   * Fetch details of user level, coins and bank savings
   */
  async getProfile(): Promise<UserProfile> {
    return apiClient<UserProfile>("/economy/profile", {
      method: "GET",
    });
  },

  /**
   * Fetch virtual items listed in the guild market shop
   */
  async getShop(): Promise<ShopItem[]> {
    return apiClient<ShopItem[]>("/economy/shop", {
      method: "GET",
    });
  },

  /**
   * Fetch top wealth leaders of the server
   */
  async getLeaderboard(limit = 5): Promise<UserProfile[]> {
    return apiClient<UserProfile[]>(`/economy/leaderboard?limit=${limit}`, {
      method: "GET",
    });
  },

  /**
   * Execute daily coins distribution claim
   */
  async claimDaily(): Promise<DailyClaimResponse> {
    return apiClient<DailyClaimResponse>("/economy/daily", {
      method: "POST",
    });
  },

  /**
   * Perform work duties to generate currency
   */
  async work(): Promise<WorkResponse> {
    return apiClient<WorkResponse>("/economy/work", {
      method: "POST",
    });
  },

  /**
   * Pull off a server crime with double-or-nothing potential
   */
  async crime(): Promise<CrimeResponse> {
    return apiClient<CrimeResponse>("/economy/crime", {
      method: "POST",
    });
  },

  /**
   * Gamble custom amount of coins against the core console
   */
  async gamble(amount: number): Promise<GambleResponse> {
    return apiClient<GambleResponse>("/economy/gamble", {
      method: "POST",
      bodyData: { amount },
    });
  },

  /**
   * Purchase a virtual item from the server market
   */
  async buyItem(itemId: string): Promise<BuyItemResponse> {
    return apiClient<BuyItemResponse>("/economy/buy", {
      method: "POST",
      bodyData: { itemId },
    });
  },
};
