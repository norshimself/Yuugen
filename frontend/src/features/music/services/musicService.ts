// src/features/music/services/musicService.ts
import { apiClient } from "@/services/apiClient";
import { QueueTrack, RecommendationTrack, VoiceChannel } from "../types/music.types";

export const musicService = {
  /**
   * Fetch active voice text channels of the Discord guild
   */
  async getVoiceChannels(guildId: string): Promise<{ success: boolean; channels: VoiceChannel[] }> {
    return apiClient<{ success: boolean; channels: VoiceChannel[] }>(
      `/player/channels?guildId=${guildId}`,
      { method: "GET" }
    );
  },

  /**
   * Search for songs/tracks via YouTube query
   */
  async searchTracks(query: string): Promise<{ success: boolean; tracks: { title: string; uri: string; duration: number; author: string }[] }> {
    return apiClient<{ success: boolean; tracks: { title: string; uri: string; duration: number; author: string }[] }>(
      `/player/search?query=${encodeURIComponent(query)}`,
      { method: "GET" }
    );
  },

  /**
   * Fetch recommendations by a specific genre/tag
   */
  async getRecommendations(tag: string): Promise<{ success: boolean; tracks: RecommendationTrack[] }> {
    return apiClient<{ success: boolean; tracks: RecommendationTrack[] }>(
      `/player/recommendations?tag=${tag}`,
      { method: "GET" }
    );
  },

  /**
   * Fetch current playing track detail
   */
  async getNowPlaying(guildId: string): Promise<{ success: boolean; playing: boolean; connected?: boolean; voiceChannelId?: string | null; track?: any }> {
    return apiClient<{ success: boolean; playing: boolean; connected?: boolean; voiceChannelId?: string | null; track?: any }>(
      `/player/nowplaying?guildId=${guildId}`,
      { method: "GET" }
    );
  },

  /**
   * Fetch upcoming tracks queue list
   */
  async getQueue(guildId: string): Promise<{ success: boolean; tracks: QueueTrack[] }> {
    return apiClient<{ success: boolean; tracks: QueueTrack[] }>(
      `/player/queue?guildId=${guildId}`,
      { method: "GET" }
    );
  },

  /**
   * Generic trigger player action helper
   */
  async sendAction(guildId: string, actionEndpoint: string, bodyData: Record<string, any> = {}): Promise<any> {
    return apiClient<any>(`/player${actionEndpoint}`, {
      method: "POST",
      bodyData: {
        guildId,
        ...bodyData,
      },
    });
  },

  /**
   * Search for radio stations via query
   */
  async searchRadio(query: string, country?: string): Promise<{ success: boolean; stations: any[] }> {
    let url = `/player/radio/search?query=${encodeURIComponent(query)}`;
    if (country) {
      url += `&country=${encodeURIComponent(country)}`;
    }
    return apiClient<{ success: boolean; stations: any[] }>(
      url,
      { method: "GET" }
    );
  },

  /**
   * Fetch list of countries from the radio directory API
   */
  async getRadioCountries(): Promise<{ success: boolean; countries: { name: string; code: string; stationCount: number }[] }> {
    return apiClient<{ success: boolean; countries: { name: string; code: string; stationCount: number }[] }>(
      "/player/radio/countries",
      { method: "GET" }
    );
  },

  /**
   * Play a specific radio station
   */
  async playRadio(guildId: string, streamUrl: string, name: string, tags?: string, channelId?: string): Promise<any> {
    return apiClient<any>("/player/radio/play", {
      method: "POST",
      bodyData: {
        guildId,
        streamUrl,
        name,
        tags,
        channelId
      }
    });
  },
};
