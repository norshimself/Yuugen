// src/features/economy/hooks/useEconomy.ts
import { useState, useEffect, useCallback } from "react";
import { UserProfile, ShopItem, EconomyStatusMessage } from "../types/economy.types";
import { economyService } from "../services/economyService";

export function useEconomy(guildId: string | undefined) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [shopItems, setShopItems] = useState<ShopItem[]>([]);
  const [leaderboard, setLeaderboard] = useState<UserProfile[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isActionLoading, setIsActionLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<EconomyStatusMessage | null>(null);

  const fetchEconomyDetails = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [profileData, shopData, leaderboardData] = await Promise.all([
        economyService.getProfile(),
        economyService.getShop(),
        economyService.getLeaderboard(5),
      ]);
      setProfile(profileData);
      setShopItems(shopData);
      setLeaderboard(leaderboardData);
    } catch (err: any) {
      setError(err.message || "Failed to load economy details.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const claimDailyReward = async () => {
    setIsActionLoading(true);
    setFeedbackMessage(null);
    try {
      const res = await economyService.claimDaily();
      if (res.success) {
        setFeedbackMessage({ text: `Claimed daily reward: +${res.amount} coins!`, success: true });
        const freshProfile = await economyService.getProfile();
        setProfile(freshProfile);
      } else {
        const nextClaimTime = res.nextClaim ? new Date(res.nextClaim).toLocaleTimeString() : "tomorrow";
        setFeedbackMessage({ text: `Already claimed! Try again at ${nextClaimTime}.`, success: false });
      }
    } catch (err: any) {
      setFeedbackMessage({ text: err.message || "Failed to claim daily distribution.", success: false });
    } finally {
      setIsActionLoading(false);
    }
  };

  const doWork = async () => {
    setIsActionLoading(true);
    setFeedbackMessage(null);
    try {
      const res = await economyService.work();
      if (res.success) {
        setFeedbackMessage({ text: `Worked as a ${res.job} and earned +${res.amount} coins!`, success: true });
        const freshProfile = await economyService.getProfile();
        setProfile(freshProfile);
      } else {
        const nextClaimTime = res.nextClaim ? new Date(res.nextClaim).toLocaleTimeString() : "later";
        setFeedbackMessage({ text: `Too tired! Try again at ${nextClaimTime}.`, success: false });
      }
    } catch (err: any) {
      setFeedbackMessage({ text: err.message || "Work shift failed.", success: false });
    } finally {
      setIsActionLoading(false);
    }
  };

  const commitCrime = async () => {
    setIsActionLoading(true);
    setFeedbackMessage(null);
    try {
      const res = await economyService.crime();
      if (res.success) {
        if (res.won) {
          setFeedbackMessage({ text: `Success! You ${res.crime} and made +${res.amount} coins!`, success: true });
        } else {
          setFeedbackMessage({ text: `Busted while trying to ${res.crime}! Fined ${res.amount} coins.`, success: false });
        }
        const freshProfile = await economyService.getProfile();
        setProfile(freshProfile);
      } else {
        const nextClaimTime = res.nextClaim ? new Date(res.nextClaim).toLocaleTimeString() : "later";
        setFeedbackMessage({ text: `The heat is still active! Wait until ${nextClaimTime} to pull off another job.`, success: false });
      }
    } catch (err: any) {
      setFeedbackMessage({ text: err.message || "Crime heist failed.", success: false });
    } finally {
      setIsActionLoading(false);
    }
  };

  const rollDice = async (amount: number) => {
    if (!profile || profile.coins < amount) {
      setFeedbackMessage({ text: "You don't have enough coins to gamble that amount!", success: false });
      return;
    }
    setIsActionLoading(true);
    setFeedbackMessage(null);
    try {
      const res = await economyService.gamble(amount);
      if (res.success) {
        if (res.won) {
          setFeedbackMessage({ text: `Double or nothing! You rolled the dice and doubled your bet: +${res.amount} coins!`, success: true });
        } else {
          setFeedbackMessage({ text: `House wins! You lost your bet of ${res.amount} coins.`, success: false });
        }
        const freshProfile = await economyService.getProfile();
        setProfile(freshProfile);
      }
    } catch (err: any) {
      setFeedbackMessage({ text: err.message || "Gamble roll failed.", success: false });
    } finally {
      setIsActionLoading(false);
    }
  };

  const purchaseItem = async (itemId: string) => {
    setIsActionLoading(true);
    setFeedbackMessage(null);
    try {
      const res = await economyService.buyItem(itemId);
      if (res.success) {
        setFeedbackMessage({ text: res.message, success: true });
        const freshProfile = await economyService.getProfile();
        setProfile(freshProfile);
      } else {
        setFeedbackMessage({ text: res.message, success: false });
      }
    } catch (err: any) {
      setFeedbackMessage({ text: err.message || "Purchase transaction failed.", success: false });
    } finally {
      setIsActionLoading(false);
    }
  };

  // Automatically fetch details when server context changes
  useEffect(() => {
    if (guildId) {
      fetchEconomyDetails();
    }
  }, [guildId, fetchEconomyDetails]);

  return {
    profile,
    shopItems,
    leaderboard,
    isLoading,
    isActionLoading,
    error,
    feedbackMessage,
    setFeedbackMessage,
    refetch: fetchEconomyDetails,
    claimDailyReward,
    doWork,
    commitCrime,
    rollDice,
    purchaseItem,
  };
}
