// src/features/settings/services/settingsService.ts
import { apiClient } from "@/services/apiClient";
import { GuildSettings, DiscordChannel } from "../types/settings.types";

export const settingsService = {
  /**
   * Fetch current configuration rules for a guild
   */
  async getSettings(guildId: string): Promise<GuildSettings> {
    return apiClient<GuildSettings>(`/settings?guildId=${guildId}`, {
      method: "GET",
    });
  },

  /**
   * Update configuration rules for a guild
   */
  async updateSettings(guildId: string, settings: Partial<GuildSettings>): Promise<GuildSettings> {
    return apiClient<GuildSettings>("/settings", {
      method: "POST",
      bodyData: {
        guildId,
        settings,
      },
    });
  },

  /**
   * Fetch active text channels list for guild configuration dropdown selection
   */
  async getChannels(guildId: string): Promise<DiscordChannel[]> {
    const res = await apiClient<{ success: boolean; channels: DiscordChannel[] }>(
      `/player/channels?guildId=${guildId}`,
      { method: "GET" }
    );
    return res.success && res.channels ? res.channels : [];
  },
};
