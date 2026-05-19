// src/features/settings/hooks/useSettings.ts
import { useState, useEffect, useCallback } from "react";
import { GuildSettings, SettingsStatusMessage, DiscordChannel } from "../types/settings.types";
import { settingsService } from "../services/settingsService";

export function useSettings(guildId: string | undefined) {
  const [settings, setSettings] = useState<GuildSettings | null>(null);
  const [channels, setChannels] = useState<DiscordChannel[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<SettingsStatusMessage | null>(null);

  const fetchSettingsAndChannels = useCallback(async () => {
    if (!guildId) return;
    setIsLoading(true);
    setError(null);
    setFeedbackMessage(null);
    try {
      const [settingsData, channelsData] = await Promise.all([
        settingsService.getSettings(guildId),
        settingsService.getChannels(guildId)
      ]);
      setSettings(settingsData);
      setChannels(channelsData);
    } catch (err: any) {
      setError(err.message || "Failed to load guild configuration parameters.");
    } finally {
      setIsLoading(false);
    }
  }, [guildId]);

  const saveSettings = async (updatedFields: GuildSettings) => {
    if (!guildId) return;
    setIsSaving(true);
    setFeedbackMessage(null);
    try {
      const updatedData = await settingsService.updateSettings(guildId, updatedFields);
      setSettings(updatedData);
      setFeedbackMessage({ text: "Guild configurations saved successfully!", success: true });
    } catch (err: any) {
      setFeedbackMessage({ 
        text: err.message || "Failed to save guild configurations.", 
        success: false 
      });
      throw err; // Propose up to parent catcher if needed
    } finally {
      setIsSaving(false);
    }
  };

  useEffect(() => {
    fetchSettingsAndChannels();
  }, [guildId, fetchSettingsAndChannels]);

  return {
    settings,
    channels,
    isLoading,
    isSaving,
    error,
    feedbackMessage,
    setFeedbackMessage,
    refetch: fetchSettingsAndChannels,
    saveSettings,
  };
}
