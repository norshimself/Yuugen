// src/hooks/use-dashboard.ts
"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { authenticatedFetch, getAccessToken, logoutSession, refreshAccessToken } from "@/services/apiClient";

export type DashboardTab = "music" | "economy" | "games" | "settings";

export interface TriviaQuestion {
  question: string;
  options: string[];
  reward: number;
}

export interface Guild {
  id: string;
  name: string;
  memberCount: number;
  isActive: boolean;
}

export function useDashboard() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<DashboardTab>("music");
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Guild selection
  const [guilds, setGuilds] = useState<Guild[]>([]);
  const [selectedGuild, setSelectedGuild] = useState<Guild | null>(null);

  const selectGuild = useCallback((guild: Guild) => {
    setSelectedGuild(guild);
    if (typeof window !== "undefined") {
      localStorage.setItem("selected_guild", JSON.stringify(guild));
    }
  }, []);

  const fetchGuilds = useCallback(async () => {
    try {
      const res = await authenticatedFetch("/player/guilds");
      if (!res.ok) throw new Error("Unable to load mutual Discord servers");

      const data: Guild[] = await res.json();
      setGuilds(data);

      let selected: Guild | null = null;
      const saved = localStorage.getItem("selected_guild");
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          selected = data.find((guild) => guild.id === parsed.id) || null;
        } catch {
          // An invalid saved preference must not invent a guild.
        }
      }
      setSelectedGuild(selected || data[0] || null);
    } catch (error) {
      console.warn("Failed to fetch guilds:", error);
      setGuilds([]);
      setSelectedGuild(null);
    }
  }, []);

  // Trivia state
  const [trivia, setTrivia] = useState<TriviaQuestion | null>(null);
  const [triviaMessage, setTriviaMessage] = useState<{ text: string; success: boolean } | null>(null);
  const [isTriviaAnswered, setIsTriviaAnswered] = useState(false);

  // Restore a short-lived JWT from the first-party HttpOnly session cookie.
  useEffect(() => {
    let active = true;
    const initialize = async () => {
      const currentToken = getAccessToken() || await refreshAccessToken();
      if (!active) return;
      setIsLoading(false);

      if (!currentToken) {
        router.replace("/login");
        return;
      }

      setToken(currentToken);
      await fetchGuilds();
    };
    void initialize();
    return () => { active = false; };
  }, [router, fetchGuilds]);

  const logout = useCallback(() => {
    setToken(null);
    setGuilds([]);
    setSelectedGuild(null);
    void logoutSession().finally(() => router.replace("/login"));
  }, [router]);

  // Same-origin browser requests use the access token in memory only.
  const authFetch = useCallback(
    async (endpoint: string, options: RequestInit = {}) => {
      try {
        return await authenticatedFetch(endpoint, options);
      } catch (error) {
        console.warn("Authenticated request failed:", error);
        if (
          error instanceof Error &&
          /sign in required|session expired/i.test(error.message)
        ) {
          logout();
        }
        return null;
      }
    },
    [logout],
  );

  // Game Arena Actions
  const loadTriviaQuestion = useCallback(async () => {
    setTriviaMessage(null);
    setIsTriviaAnswered(false);
    setTrivia(null);
    const res = await authFetch("/games/trivia/question");
    if (res && res.ok) {
      const data = await res.json();
      if (data.success) {
        setTrivia({
          question: data.question,
          options: data.options,
          reward: data.reward,
        });
      } else {
        setTriviaMessage({ text: data.message || "Finish your active trivia session first!", success: false });
      }
    }
  }, [authFetch]);

  const submitTriviaAnswer = async (answerIndex: number) => {
    const res = await authFetch("/games/trivia/answer", {
      method: "POST",
      body: JSON.stringify({ answerIndex }),
    });
    if (res) {
      const data = await res.json();
      setIsTriviaAnswered(true);
      if (data.success) {
        if (data.correct) {
          setTriviaMessage({ text: `Correct! You answered wisely and earned +${data.reward} coins!`, success: true });
        } else {
          setTriviaMessage({ text: `Incorrect! The correct option was option #${data.correctIndex + 1}.`, success: false });
        }
      } else {
        setTriviaMessage({ text: data.message, success: false });
      }
    }
  };

  const playRPS = async (choice: "rock" | "paper" | "scissors") => {
    const res = await authFetch("/games/rps", {
      method: "POST",
      body: JSON.stringify({ choice }),
    });
    if (res) {
      const data = await res.json();
      return data;
    }
    return null;
  };

  // Automatically fetch trivia details when games tab is selected
  useEffect(() => {
    if (token && activeTab === "games") {
      loadTriviaQuestion();
    }
  }, [activeTab, token, loadTriviaQuestion]);

  return {
    activeTab,
    setActiveTab,
    isLoading,
    token,
    logout,
    authFetch,
    // Games
    trivia,
    triviaMessage,
    setTriviaMessage,
    isTriviaAnswered,
    loadTriviaQuestion,
    submitTriviaAnswer,
    playRPS,
    // Guild Selection
    guilds,
    selectedGuild,
    selectGuild,
  };
}
