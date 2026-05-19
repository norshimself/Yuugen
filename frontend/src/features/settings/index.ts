// src/features/settings/index.ts

// Export Presentation Components
export { SettingsDeck } from "./components/SettingsDeck";

// Export Custom State Hooks
export { useSettings } from "./hooks/useSettings";

// Export Domain Services
export { settingsService } from "./services/settingsService";

// Export Type Contracts
export { GuildSettingsSchema } from "./types/settings.types";
export type { GuildSettings, DiscordChannel, SettingsStatusMessage } from "./types/settings.types";
