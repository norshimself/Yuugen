// src/features/music/index.ts

// Export Presentation Components
export { MusicDeck } from "./components/MusicDeck";

// Export Custom State Hooks
export { usePlayer } from "./hooks/usePlayer";

// Export Domain Services
export { musicService } from "./services/musicService";

// Export Type Contracts
export type { QueueTrack, RecommendationTrack, VoiceChannel, PlayerStatusMessage } from "./types/music.types";
