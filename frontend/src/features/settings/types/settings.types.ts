// src/features/settings/types/settings.types.ts
import { z } from 'zod';

export const GuildSettingsSchema = z.object({
  guildId: z.string().min(1, "Guild ID is required"),
  prefix: z.string().min(1, "Prefix is required").max(5, "Prefix cannot exceed 5 characters"),
  welcomeChannelId: z.string().nullable().or(z.literal('')),
  welcomeMessage: z.string().min(1, "Welcome message is required").max(2000),
  goodbyeChannelId: z.string().nullable().or(z.literal('')).optional(),
  goodbyeMessage: z.string().min(1).max(1500).optional(),
  welcomeDmEnabled: z.boolean().optional(),
  welcomeDmMessage: z.string().min(1).max(1500).optional(),
  rulesAcknowledgementEnabled: z.boolean().optional(),
  rulesChannelId: z.string().nullable().or(z.literal('')).optional(),
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
