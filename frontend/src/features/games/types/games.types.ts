// src/features/games/types/games.types.ts

export interface TriviaQuestion {
  question: string;
  options: string[];
  reward: number;
}

export interface GamesStatusMessage {
  text: string;
  success: boolean;
}

export interface RPSResponse {
  success: boolean;
  userChoice: string;
  botChoice: string;
  result: "win" | "lose" | "tie";
  reward: number;
}
