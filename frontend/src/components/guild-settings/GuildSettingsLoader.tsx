'use client';

import { useEffect, useState } from 'react';
import { settingsService } from '@/features/settings/services/settingsService';
import { GuildSettings } from '@/features/settings/types/settings.types';
import { UpdateGuildSettingsForm } from './UpdateGuildSettingsForm';

export function GuildSettingsLoader({ guildId }: { guildId: string }) {
  const [settings, setSettings] = useState<GuildSettings | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let active = true;
    setSettings(null);
    setStatus('loading');

    settingsService.getSettings(guildId)
      .then((data) => {
        if (!active) return;
        setSettings(data);
        setStatus('ready');
      })
      .catch((error) => {
        console.warn('Unable to load authorized guild settings:', error);
        if (active) setStatus('error');
      });

    return () => { active = false; };
  }, [guildId]);

  if (status === 'loading') {
    return <p className="text-brand-secondary/60">Loading server settings...</p>;
  }
  if (status === 'error' || !settings) {
    return (
      <p className="text-red-300" role="alert">
        Could not load this server's settings. Sign in with Discord and ensure
        you have Manage Server permission.
      </p>
    );
  }

  return <UpdateGuildSettingsForm initialSettings={settings} guildId={guildId} />;
}
