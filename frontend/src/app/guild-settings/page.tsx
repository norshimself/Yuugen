import { GuildSettingsLoader } from '@/components/guild-settings/GuildSettingsLoader';

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

  return (
    <main className="p-6 max-w-4xl mx-auto space-y-6 text-white bg-[#04080c] min-h-screen font-sans">
      <div className="flex flex-col gap-1.5 border-b border-white/5 pb-4">
        <h1 className="text-3xl font-serif font-bold tracking-tight text-brand-secondary uppercase">Manage Guild Settings</h1>
        <p className="text-xs text-brand-secondary/50 font-light font-mono">Guild Context: {guildId}</p>
      </div>
      
      <GuildSettingsLoader guildId={guildId} />
    </main>
  );
}
