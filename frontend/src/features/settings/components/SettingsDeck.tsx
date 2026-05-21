// src/features/settings/components/SettingsDeck.tsx
'use client';

import React, { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Settings2, 
  MessageSquare, 
  ShieldAlert, 
  Save, 
  Plus, 
  X, 
  Hash, 
  Info, 
  ToggleLeft, 
  ToggleRight, 
  HelpCircle,
  CheckCircle,
  AlertCircle,
  Loader2
} from 'lucide-react';
import { GuildSettingsSchema, GuildSettings } from '../types/settings.types';
import { useSettings } from '../hooks/useSettings';

interface SettingsDeckProps {
  selectedGuild: {
    id: string;
    name: string;
  } | null;
}

export function SettingsDeck({ selectedGuild }: SettingsDeckProps) {
  const selectedGuildId = selectedGuild?.id;

  const {
    settings,
    channels,
    isLoading,
    isSaving,
    error,
    feedbackMessage,
    setFeedbackMessage,
    saveSettings,
  } = useSettings(selectedGuildId);

  // Custom forbidden word state
  const [newWord, setNewWord] = useState('');

  // Initialize react-hook-form
  const { 
    register, 
    handleSubmit, 
    watch, 
    setValue, 
    reset, 
    formState: { errors } 
  } = useForm<GuildSettings>({
    resolver: zodResolver(GuildSettingsSchema),
    defaultValues: settings || {
      guildId: selectedGuildId || '',
      prefix: 'y!',
      welcomeChannelId: '',
      welcomeMessage: 'Welcome {user} to the server!',
      antiSpamEnabled: false,
      profanityFilterEnabled: false,
      blacklistedWords: [],
    }
  });

  // Watch inputs for interactive live previews and toggle visual updates
  const watchedPrefix = watch('prefix');
  const watchedWelcomeChannelId = watch('welcomeChannelId');
  const watchedWelcomeMessage = watch('welcomeMessage');
  const watchedAntiSpamEnabled = watch('antiSpamEnabled');
  const watchedProfanityFilterEnabled = watch('profanityFilterEnabled');
  const watchedBlacklistedWords = watch('blacklistedWords') || [];

  // Reset form values whenever server loaded settings shift
  useEffect(() => {
    if (settings) {
      reset(settings);
    }
  }, [settings, reset]);

  // Handle form submission and update backend configurations
  const handleSave = async (formData: GuildSettings) => {
    try {
      await saveSettings(formData);
    } catch (err) {
      console.error('Failed to save settings:', err);
    }
  };

  // Add forbidden word to the field array
  const handleAddWord = (e: React.FormEvent) => {
    e.preventDefault();
    const word = newWord.trim().toLowerCase();
    if (word && !watchedBlacklistedWords.includes(word)) {
      const updatedWords = [...watchedBlacklistedWords, word];
      setValue('blacklistedWords', updatedWords, { shouldDirty: true, shouldValidate: true });
      setNewWord('');
    }
  };

  // Remove forbidden word from the field array
  const handleRemoveWord = (wordToRemove: string) => {
    const updatedWords = watchedBlacklistedWords.filter((w) => w !== wordToRemove);
    setValue('blacklistedWords', updatedWords, { shouldDirty: true, shouldValidate: true });
  };

  // Compile a live preview of the welcome message
  const getCompiledWelcomeMessage = () => {
    const userName = 'Kaguya#9999';
    const serverName = selectedGuild ? selectedGuild.name : 'Yuugen Sanctuary';
    return (watchedWelcomeMessage || 'Welcome {user} to the server!')
      .replace(/{user}/g, userName)
      .replace(/{guild}/g, serverName);
  };

  const cardVariants = {
    hidden: { opacity: 0, y: 15 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.4 } }
  };

  if (!selectedGuild) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center py-20">
        <Info className="w-8 h-8 text-brand-secondary/40 mb-4 animate-pulse" />
        <span className="text-white/40 text-xs font-mono tracking-widest uppercase">No Server Selected</span>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center py-20">
        <Loader2 className="w-8 h-8 text-brand-secondary animate-spin mb-4" />
        <span className="text-white/40 text-xs font-mono tracking-widest uppercase">Fetching server rules...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center py-20 text-red-400">
        <AlertCircle className="w-8 h-8 mb-4 text-red-500" />
        <span className="text-xs font-mono uppercase tracking-wider mb-2">{error}</span>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(handleSave)} className="grid grid-cols-1 lg:grid-cols-12 gap-8 text-white relative z-10">
      <input type="hidden" {...register('guildId')} value={selectedGuildId || ''} />

      {/* LEFT COLUMN - Settings Forms (8 Columns) */}
      <div className="lg:col-span-8 space-y-8">
        
        {/* 1. Core Config Card */}
        <motion.div
          variants={cardVariants}
          initial="hidden"
          animate="visible"
          className="p-8 rounded-[2rem] bg-[#080d14]/90 border border-brand-secondary/15 backdrop-blur-xl relative overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center gap-3.5 mb-6 border-b border-brand-secondary/10 pb-4">
            <div className="w-10 h-10 rounded-xl bg-brand-primary/10 flex items-center justify-center text-brand-primary border border-brand-primary/20">
              <Settings2 className="w-5 h-5 text-brand-secondary" />
            </div>
            <div>
              <h3 className="font-serif text-lg tracking-wide">Core Configurations</h3>
              <p className="text-xs text-brand-secondary/60">Define the global commands prefix and operational behaviors.</p>
            </div>
          </div>

          {/* Form */}
          <div className="space-y-6">
            <div className="flex flex-col gap-2">
              <label className="text-xs tracking-widest font-semibold uppercase text-brand-secondary/80 flex items-center gap-1.5">
                <span>Command Prefix</span>
                <span title="The symbol typed before a command to trigger Yuugen.">
                  <HelpCircle className="w-3.5 h-3.5 text-brand-secondary/40 cursor-help" />
                </span>
              </label>
              <div className="relative max-w-[200px]">
                <input
                  type="text"
                  maxLength={5}
                  {...register('prefix')}
                  className="w-full px-4 py-3 bg-[#04080c]/50 border border-brand-secondary/15 rounded-xl text-white font-sans text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/50 transition-all font-semibold tracking-widest"
                  placeholder="y!"
                />
              </div>
              {errors.prefix && <p className="text-red-400 text-xs mt-1 font-light">{errors.prefix.message}</p>}
              <p className="text-[10px] text-brand-secondary/50">Example: <code className="text-brand-secondary font-mono bg-[#04080c]/30 px-1.5 py-0.5 rounded">{(watchedPrefix || 'y!')}play lofi</code></p>
            </div>
          </div>
        </motion.div>

        {/* 2. Greeting System Card */}
        <motion.div
          variants={cardVariants}
          initial="hidden"
          animate="visible"
          className="p-8 rounded-[2rem] bg-[#080d14]/90 border border-brand-secondary/15 backdrop-blur-xl relative overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center gap-3.5 mb-6 border-b border-brand-secondary/10 pb-4">
            <div className="w-10 h-10 rounded-xl bg-brand-primary/10 flex items-center justify-center text-brand-primary border border-brand-primary/20">
              <MessageSquare className="w-5 h-5 text-brand-secondary" />
            </div>
            <div>
              <h3 className="font-serif text-lg tracking-wide">Greeting System</h3>
              <p className="text-xs text-brand-secondary/60">Announce arrivals with custom, immersive welcome cards.</p>
            </div>
          </div>

          {/* Form */}
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              
              {/* Channel Selector */}
              <div className="flex flex-col gap-2">
                <label className="text-xs tracking-widest font-semibold uppercase text-brand-secondary/80">
                  <span>Welcome Announcement Channel</span>
                </label>
                <select
                  {...register('welcomeChannelId')}
                  className="w-full px-4 py-3 bg-[#04080c]/50 border border-brand-secondary/15 rounded-xl text-white font-sans text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/50 transition-all cursor-pointer"
                >
                  <option value="" className="bg-[#080d14]">Disabled / Secret Garden Only</option>
                  {channels.map((chan) => (
                    <option key={chan.id} value={chan.id} className="bg-[#080d14]">
                      #{chan.name}
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-brand-secondary/50">Select where the bot will post arrival greeting panels.</p>
              </div>
            </div>

            {/* Welcome Template Message */}
            <div className="flex flex-col gap-2">
              <label className="text-xs tracking-widest font-semibold uppercase text-brand-secondary/80">
                <span>Welcome Message Template</span>
              </label>
              <textarea
                rows={3}
                {...register('welcomeMessage')}
                className="w-full px-4 py-3 bg-[#04080c]/50 border border-brand-secondary/15 rounded-xl text-white font-sans text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/50 transition-all resize-none"
                placeholder="Welcome {user} to the server!"
              />
              {errors.welcomeMessage && <p className="text-red-400 text-xs mt-1 font-light">{errors.welcomeMessage.message}</p>}
              
              {/* Tokens info */}
              <div className="flex flex-wrap gap-2 mt-1">
                <span className="text-[10px] text-brand-secondary/60 bg-[#04080c]/40 px-2.5 py-1 rounded border border-brand-secondary/10 flex items-center gap-1 font-sans">
                  <code className="text-brand-primary font-mono font-bold">{`{user}`}</code> matches User Mention
                </span>
                <span className="text-[10px] text-brand-secondary/60 bg-[#04080c]/40 px-2.5 py-1 rounded border border-brand-secondary/10 flex items-center gap-1 font-sans">
                  <code className="text-brand-primary font-mono font-bold">{`{guild}`}</code> matches Server Name
                </span>
              </div>
            </div>
          </div>
        </motion.div>

        {/* 3. Advanced Moderation Filters */}
        <motion.div
          variants={cardVariants}
          initial="hidden"
          animate="visible"
          className="p-8 rounded-[2rem] bg-[#080d14]/90 border border-brand-secondary/15 backdrop-blur-xl relative overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center gap-3.5 mb-6 border-b border-brand-secondary/10 pb-4">
            <div className="w-10 h-10 rounded-xl bg-brand-primary/10 flex items-center justify-center text-brand-primary border border-brand-primary/20">
              <ShieldAlert className="w-5 h-5 text-brand-secondary" />
            </div>
            <div>
              <h3 className="font-serif text-lg tracking-wide">Automated Shield</h3>
              <p className="text-xs text-brand-secondary/60">Configure automatic message audits to shield channels from disruption.</p>
            </div>
          </div>

          {/* Form */}
          <div className="space-y-6">
            
            {/* Toggle Rows */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              
              {/* Anti Spam Toggle */}
              <div className="flex items-center justify-between p-4.5 rounded-2xl bg-[#04080c]/30 border border-brand-secondary/10">
                <div className="flex flex-col gap-0.5 pr-2">
                  <span className="text-xs font-semibold text-white tracking-wide">Anti-Spam Filter</span>
                  <span className="text-[10px] text-brand-secondary/50">Mute users sending rapid bursts of messages.</span>
                </div>
                <button
                  type="button"
                  onClick={() => setValue('antiSpamEnabled', !watchedAntiSpamEnabled, { shouldDirty: true })}
                  className="focus:outline-none transition-colors"
                >
                  {watchedAntiSpamEnabled ? (
                    <ToggleRight className="w-10 h-10 text-brand-primary cursor-pointer" />
                  ) : (
                    <ToggleLeft className="w-10 h-10 text-brand-secondary/35 cursor-pointer" />
                  )}
                </button>
              </div>

              {/* Profanity Filter Toggle */}
              <div className="flex items-center justify-between p-4.5 rounded-2xl bg-[#04080c]/30 border border-brand-secondary/10">
                <div className="flex flex-col gap-0.5 pr-2">
                  <span className="text-xs font-semibold text-white tracking-wide">Profanity Sanitizer</span>
                  <span className="text-[10px] text-brand-secondary/50">Instantly delete forbidden/explicit vocabulary.</span>
                </div>
                <button
                  type="button"
                  onClick={() => setValue('profanityFilterEnabled', !watchedProfanityFilterEnabled, { shouldDirty: true })}
                  className="focus:outline-none transition-colors"
                >
                  {watchedProfanityFilterEnabled ? (
                    <ToggleRight className="w-10 h-10 text-brand-primary cursor-pointer" />
                  ) : (
                    <ToggleLeft className="w-10 h-10 text-brand-secondary/35 cursor-pointer" />
                  )}
                </button>
              </div>
            </div>

            {/* Custom Blacklist Words */}
            <div className="flex flex-col gap-3">
              <label className="text-xs tracking-widest font-semibold uppercase text-brand-secondary/80 flex items-center gap-1.5">
                <span>Forbidden Words Blacklist</span>
              </label>

              {/* Tag Input */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newWord}
                  onChange={(e) => setNewWord(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddWord(e);
                    }
                  }}
                  placeholder="Type a word and click Add or press Enter..."
                  className="flex-1 px-4 py-3 bg-[#04080c]/50 border border-brand-secondary/15 rounded-xl text-white font-sans text-sm focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/50 transition-all"
                />
                <button
                  type="button"
                  onClick={handleAddWord}
                  className="px-4.5 bg-brand-primary/15 border border-brand-primary/30 hover:bg-brand-primary/35 text-brand-primary font-serif font-bold text-xs uppercase tracking-widest rounded-xl transition cursor-pointer flex items-center gap-1.5"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add</span>
                </button>
              </div>

              {/* Tag Containers */}
              <div className="flex flex-wrap gap-2 p-4 bg-[#04080c]/30 rounded-2xl border border-brand-secondary/10 min-h-[70px]">
                <AnimatePresence>
                  {watchedBlacklistedWords.length === 0 ? (
                    <motion.span 
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 0.4 }}
                      exit={{ opacity: 0 }}
                      className="text-xs text-brand-secondary italic m-auto font-light"
                    >
                      No forbidden terms defined. All vocabulary is permitted.
                    </motion.span>
                  ) : (
                    watchedBlacklistedWords.map((word) => (
                      <motion.span
                        key={word}
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.8 }}
                        transition={{ duration: 0.2 }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-secondary/10 border border-brand-secondary/20 text-brand-secondary font-sans text-xs font-semibold hover:border-brand-secondary/40 transition"
                      >
                        <span>{word}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveWord(word)}
                          className="hover:text-white focus:outline-none transition cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </motion.span>
                    ))
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>
        </motion.div>
      </div>

      {/* RIGHT COLUMN - Card Preview & Action Console (4 Columns) */}
      <div className="lg:col-span-4 space-y-8">
        
        {/* A. Live Preview Panel */}
        <motion.div
          variants={cardVariants}
          initial="hidden"
          animate="visible"
          className="p-6 rounded-[2rem] bg-[#080d14]/90 border border-brand-secondary/20 shadow-2xl backdrop-blur-xl relative overflow-hidden flex flex-col gap-6"
        >
          <div className="flex items-center gap-2 text-brand-primary">
            <Info className="w-4 h-4 text-brand-primary" />
            <span className="text-xs tracking-widest font-semibold uppercase text-brand-secondary/80">Welcome Card Live Preview</span>
          </div>

          {/* Ghibli Themed Simulated Welcome Card */}
          <div className="w-full rounded-[1.75rem] border border-brand-secondary/15 overflow-hidden shadow-2xl bg-[#04080c]/80 relative flex flex-col items-center justify-center p-6 text-center group min-h-[260px]">
            
            {/* Ambient Background Overlay */}
            <div className="absolute inset-0 bg-[url('/ghibli_lake_landscape.png')] bg-cover bg-center brightness-[0.25] group-hover:scale-105 transition-transform duration-[8s]" />
            
            {/* Content Wrapper */}
            <div className="relative z-10 flex flex-col items-center gap-4">
              
              {/* Simulated Discord User Avatar */}
              <div className="relative">
                <div className="absolute inset-0 rounded-full bg-brand-secondary/20 blur-[10px]" />
                <div className="w-16 h-16 rounded-full border-2 border-brand-secondary/40 overflow-hidden relative shadow-lg bg-[#080d14]">
                  <div className="absolute inset-0 bg-[#c9b09a]/25 flex items-center justify-center font-serif text-brand-secondary font-bold text-lg select-none">
                    K
                  </div>
                </div>
                {/* Active server badge */}
                <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-brand-primary border border-brand-secondary/30 flex items-center justify-center font-serif text-[10px] text-white">
                  ✦
                </div>
              </div>

              {/* Greeting text container */}
              <div className="space-y-1">
                <div className="inline-flex items-center gap-1.5 text-[10px] tracking-widest uppercase font-semibold text-brand-secondary/80 px-2.5 py-0.5 rounded-full bg-brand-primary/20 border border-brand-primary/30">
                  <Hash className="w-3 h-3 text-brand-primary" />
                  <span>{channels.find(c => c.id === watchedWelcomeChannelId)?.name || 'secret-garden'}</span>
                </div>
                
                {/* Dynamically compiled preview */}
                <h4 className="font-serif text-sm leading-relaxed text-white max-w-[220px] font-normal pt-2">
                  {getCompiledWelcomeMessage()}
                </h4>
              </div>
            </div>
          </div>
          
          <div className="text-[10px] text-brand-secondary/50 leading-relaxed italic bg-[#04080c]/30 p-4 rounded-xl border border-brand-secondary/5 font-sans">
            This card represents the high-fidelity graphical card the bot will automatically generate and upload to Discord whenever a new seeker joins your guild.
          </div>
        </motion.div>

        {/* B. Action Controller Panel */}
        <motion.div
          variants={cardVariants}
          initial="hidden"
          animate="visible"
          className="p-6 rounded-[2rem] bg-[#080d14]/90 border border-brand-secondary/20 shadow-2xl backdrop-blur-xl flex flex-col gap-6"
        >
          {/* Status Messages */}
          <AnimatePresence>
            {feedbackMessage && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className={`p-4 rounded-xl flex items-start gap-2.5 border ${
                  feedbackMessage.success
                    ? 'bg-brand-primary/10 border-brand-primary/20 text-brand-primary text-xs'
                    : 'bg-red-500/10 border-red-500/20 text-red-400 text-xs'
                }`}
              >
                {feedbackMessage.success ? (
                  <CheckCircle className="w-4.5 h-4.5 text-brand-primary shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-4.5 h-4.5 text-red-400 shrink-0 mt-0.5" />
                )}
                <div className="space-y-1">
                  <span className="font-semibold block font-serif">
                    {feedbackMessage.success ? 'Harmony Restored' : 'Sync Failed'}
                  </span>
                  <p className="text-[11px] leading-relaxed text-brand-secondary/80 font-sans">{feedbackMessage.text}</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Action Trigger */}
          <button
            type="submit"
            disabled={isSaving}
            className="w-full py-4 px-6 rounded-2xl bg-gradient-to-r from-brand-primary/80 to-brand-primary hover:from-brand-primary hover:to-brand-primary/95 text-white font-serif tracking-wider font-semibold uppercase text-xs shadow-lg hover:shadow-brand-primary/20 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed group border border-brand-secondary/15"
          >
            <Save className={`w-4 h-4 group-hover:scale-110 transition-transform ${isSaving ? 'animate-spin' : ''}`} />
            <span>{isSaving ? 'Syncing Harmony...' : 'Save Settings'}</span>
          </button>
        </motion.div>
      </div>

    </form>
  );
}
