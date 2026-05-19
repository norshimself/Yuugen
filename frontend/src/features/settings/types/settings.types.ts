// src/features/settings/types/settings.types.ts
import { z } from 'zod';

export const GuildSettingsSchema = z.object({
  guildId: z.string().min(1, "Guild ID is required"),
  prefix: z.string().min(1, "Prefix is required").max(5, "Prefix cannot exceed 5 characters"),
  welcomeChannelId: z.string().nullable().or(z.literal('')),
  welcomeMessage: z.string().min(1, "Welcome message is required"),
  antiSpamEnabled: z.boolean(),
  profanityFilterEnabled: z.boolean(),
  blacklistedWords: z.array(z.string()),
});

export type GuildSettings = z.infer<typeof GuildSettingsSchema>;

export interface SettingsStatusMessage {
  text: string;
  success: boolean;
}

export interface DiscordChannel {
  id: string;
  name: string;
}
