import { settingsService } from '@/features/settings/services/settingsService';
import { UpdateGuildSettingsForm } from '@/components/guild-settings/UpdateGuildSettingsForm';

interface GuildSettingsPageProps {
  searchParams: Promise<{ guildId?: string }>;
}

export default async function GuildSettingsPage({ searchParams }: GuildSettingsPageProps) {
  const { guildId } = await searchParams;

  if (!guildId) {
    return (
      <main className="p-6 max-w-4xl mx-auto space-y-6 text-white bg-[#04080c] min-h-screen flex flex-col justify-center items-center font-sans">
        <h1 className="text-2xl font-serif font-bold text-brand-secondary uppercase tracking-wider">No Guild Selected</h1>
        <p className="text-sm text-brand-secondary/60 font-light">Please select an active server from the dashboard or provide a guildId query parameter.</p>
      </main>
    );
  }

  // Direct, server-side secure fetch for this guild using domain service
  const settings = await settingsService.getSettings(guildId).catch(() => null);

  return (
    <main className="p-6 max-w-4xl mx-auto space-y-6 text-white bg-[#04080c] min-h-screen font-sans">
      <div className="flex flex-col gap-1.5 border-b border-white/5 pb-4">
        <h1 className="text-3xl font-serif font-bold tracking-tight text-brand-secondary uppercase">Manage Guild Settings</h1>
        <p className="text-xs text-brand-secondary/50 font-light font-mono">Guild Context: {guildId}</p>
      </div>
      
      {settings ? (
        <UpdateGuildSettingsForm initialSettings={settings} guildId={guildId} />
      ) : (
        <div className="p-8 text-brand-secondary/50 text-sm font-light italic text-center border border-brand-secondary/15 rounded-[1.5rem] bg-[#101c26]/40 backdrop-blur-xl">
          No configurations active. Generating default settings for Guild ID: {guildId}...
          <div className="mt-4">
            <UpdateGuildSettingsForm 
              initialSettings={{
                guildId,
                prefix: 'y!',
                welcomeChannelId: '',
                welcomeMessage: 'Welcome {user} to the server!',
                antiSpamEnabled: false,
                profanityFilterEnabled: false,
                blacklistedWords: []
              }} 
              guildId={guildId} 
            />
          </div>
        </div>
      )}
    </main>
  );
}
