// src/features/games/services/gamesService.ts
import { apiClient } from "@/services/apiClient";
import { RPSResponse } from "../types/games.types";

export const gamesService = {
  /**
   * Fetch current or new trivia question riddle
   */
  async getTriviaQuestion(): Promise<{ success: boolean; question?: string; options?: string[]; reward?: number; message?: string }> {
    return apiClient<{ success: boolean; question?: string; options?: string[]; reward?: number; message?: string }>(
      "/games/trivia/question",
      { method: "GET" }
    );
  },

  /**
   * Submit select answer index to verify correctness
   */
  async submitTriviaAnswer(answerIndex: number): Promise<{ success: boolean; correct?: boolean; reward?: number; correctIndex?: number; message?: string }> {
    return apiClient<{ success: boolean; correct?: boolean; reward?: number; correctIndex?: number; message?: string }>(
      "/games/trivia/answer",
      {
        method: "POST",
        bodyData: { answerIndex },
      }
    );
  },

  /**
   * Challenge the bot in rock paper scissors
   */
  async playRPS(choice: "rock" | "paper" | "scissors"): Promise<RPSResponse> {
    return apiClient<RPSResponse>("/games/rps", {
      method: "POST",
      bodyData: { choice },
    });
  },
};
