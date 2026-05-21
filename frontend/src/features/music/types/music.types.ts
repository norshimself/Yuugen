// src/features/music/types/music.types.ts

export interface QueueTrack {
  title: string;
  uri?: string;
  duration?: number;
  artist?: string;
  isStream?: boolean;
  artworkUrl?: string;
  position?: number;
}

export interface RecommendationTrack {
  title: string;
  uri: string;
  duration: number;
  author: string;
}

export interface VoiceChannel {
  id: string;
  name: string;
}

export interface PlayerStatusMessage {
  text: string;
  success: boolean;
}
