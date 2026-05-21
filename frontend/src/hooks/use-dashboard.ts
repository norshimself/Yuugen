// src/hooks/use-dashboard.ts
"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { refreshAccessToken } from "@/services/apiClient";

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

  const fetchGuilds = useCallback(async (customToken?: string) => {
    const apiKey = process.env.NEXT_PUBLIC_API_KEY || "4029c9b9b5ad007d8c24a2a51b458dce46674bbbc2ce1acfed1cfcd3cad2623f";
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";
    const storedToken = customToken || (typeof window !== "undefined" ? localStorage.getItem("access_token") : null) || token;
    try {
      const headers: Record<string, string> = {
        "x-api-key": apiKey
      };
      if (storedToken) {
        headers["Authorization"] = `Bearer ${storedToken}`;
      }
      const res = await fetch(`${apiUrl}/player/guilds`, {
        headers
      });
      if (res.ok) {
        const data = await res.json();
        setGuilds(data);
        
        let initialized = false;
        if (typeof window !== "undefined") {
          const saved = localStorage.getItem("selected_guild");
          if (saved) {
            try {
              const parsed = JSON.parse(saved);
              const exists = data.find((g: Guild) => g.id === parsed.id);
              if (exists) {
                setSelectedGuild(exists);
                initialized = true;
              }
            } catch (_) {}
          }
        }
        if (!initialized && data.length > 0) {
          setSelectedGuild(data[0]);
        }
      }
    } catch (err) {
      console.error("Error fetching guilds:", err);
    }
  }, [token]);

  // Trivia state
  const [trivia, setTrivia] = useState<TriviaQuestion | null>(null);
  const [triviaMessage, setTriviaMessage] = useState<{ text: string; success: boolean } | null>(null);
  const [isTriviaAnswered, setIsTriviaAnswered] = useState(false);

  // Initialize session and fetch data
  useEffect(() => {
    const storedToken = localStorage.getItem("access_token");
    if (!storedToken) {
      router.push("/login");
    } else {
      setToken(storedToken);
      setIsLoading(false);
      fetchGuilds(storedToken);
    }
  }, [router, fetchGuilds]);

  const logout = useCallback(() => {
    localStorage.removeItem("access_token");
    router.push("/login");
  }, [router]);

  // Generic authenticated fetch wrapper
  const authFetch = useCallback(
    async (endpoint: string, options: RequestInit = {}) => {
      const storedToken = localStorage.getItem("access_token") || token;
      if (!storedToken) return null;
      
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";
      const apiKey = process.env.NEXT_PUBLIC_API_KEY || "4029c9b9b5ad007d8c24a2a51b458dce46674bbbc2ce1acfed1cfcd3cad2623f";
      try {
        let res = await fetch(`${apiUrl}${endpoint}`, {
          ...options,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${storedToken}`,
            "x-api-key": apiKey,
            ...(options.headers || {}),
          },
          credentials: "include",
        });

        if (res.status === 401 && endpoint !== "/auth/refresh") {
          const newToken = await refreshAccessToken();
          if (newToken) {
            // Update token state
            setToken(newToken);
            
            // Retry
            res = await fetch(`${apiUrl}${endpoint}`, {
              ...options,
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${newToken}`,
                "x-api-key": apiKey,
                ...(options.headers || {}),
              },
              credentials: "include",
            });
          } else {
            logout();
            return null;
          }
        }

        return res;
      } catch (err) {
        console.error("Fetch error:", err);
        return null;
      }
    },
    [token, logout]
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
