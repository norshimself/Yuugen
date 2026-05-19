// src/features/games/hooks/useGames.ts
import { useState, useEffect, useCallback } from "react";
import { TriviaQuestion, GamesStatusMessage, RPSResponse } from "../types/games.types";
import { gamesService } from "../services/gamesService";
import { economyService } from "@/features/economy";

export function useGames(guildId: string | undefined) {
  const [trivia, setTrivia] = useState<TriviaQuestion | null>(null);
  const [triviaMessage, setTriviaMessage] = useState<GamesStatusMessage | null>(null);
  const [isTriviaAnswered, setIsTriviaAnswered] = useState<boolean>(false);
  const [coinsBalance, setCoinsBalance] = useState<number | null>(null);
  const [isLoadingTrivia, setIsLoadingTrivia] = useState<boolean>(false);
  const [rpsLoading, setRpsLoading] = useState<boolean>(false);

  const fetchBalance = useCallback(async () => {
    try {
      const profile = await economyService.getProfile();
      setCoinsBalance(profile.coins);
    } catch (_) {}
  }, []);

  const loadTriviaQuestion = useCallback(async () => {
    setIsLoadingTrivia(true);
    setTriviaMessage(null);
    setIsTriviaAnswered(false);
    setTrivia(null);
    try {
      const res = await gamesService.getTriviaQuestion();
      if (res.success && res.question && res.options && res.reward !== undefined) {
        setTrivia({
          question: res.question,
          options: res.options,
          reward: res.reward,
        });
      } else {
        setTriviaMessage({ 
          text: res.message || "Finish your active trivia session first!", 
          success: false 
        });
      }
    } catch (err: any) {
      setTriviaMessage({ 
        text: err.message || "Failed to load trivia question.", 
        success: false 
      });
    } finally {
      setIsLoadingTrivia(false);
    }
  }, []);

  const submitTriviaAnswer = async (answerIndex: number) => {
    setTriviaMessage(null);
    try {
      const res = await gamesService.submitTriviaAnswer(answerIndex);
      setIsTriviaAnswered(true);
      if (res.success) {
        if (res.correct) {
          setTriviaMessage({ 
            text: `Correct! You answered wisely and earned +${res.reward} coins!`, 
            success: true 
          });
        } else {
          setTriviaMessage({ 
            text: `Incorrect! The correct option was option #${(res.correctIndex ?? 0) + 1}.`, 
            success: false 
          });
        }
        await fetchBalance();
      } else {
        setTriviaMessage({ text: res.message || "Action failed.", success: false });
      }
    } catch (err: any) {
      setTriviaMessage({ text: err.message || "Failed to submit answer.", success: false });
    }
  };

  const playRockPaperScissors = async (choice: "rock" | "paper" | "scissors"): Promise<RPSResponse | null> => {
    setRpsLoading(true);
    try {
      const res = await gamesService.playRPS(choice);
      if (res.success) {
        await fetchBalance();
        return res;
      }
      return null;
    } catch (err) {
      console.error("RPS error:", err);
      return null;
    } finally {
      setRpsLoading(false);
    }
  };

  useEffect(() => {
    if (guildId) {
      loadTriviaQuestion();
      fetchBalance();
    }
  }, [guildId, loadTriviaQuestion, fetchBalance]);

  return {
    trivia,
    triviaMessage,
    isTriviaAnswered,
    coinsBalance,
    isLoadingTrivia,
    rpsLoading,
    setTriviaMessage,
    loadTriviaQuestion,
    submitTriviaAnswer,
    playRockPaperScissors,
  };
}
