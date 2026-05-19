// src/features/games/index.ts

// Export Presentation Components
export { GamesDeck } from "./components/GamesDeck";

// Export Custom State Hooks
export { useGames } from "./hooks/useGames";

// Export Domain Services
export { gamesService } from "./services/gamesService";

// Export Type Contracts
export type { TriviaQuestion, GamesStatusMessage, RPSResponse } from "./types/games.types";
