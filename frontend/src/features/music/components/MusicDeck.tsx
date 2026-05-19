// src/features/music/components/MusicDeck.tsx
"use client";

import { useState, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Play, Pause, SkipForward, Volume2,
  ListMusic, Radio, Sliders, Heart, Shuffle, Repeat, ChevronRight, AlertCircle, Trash2, Search, Square, Settings2, X, Activity, Link2Off, Sparkles
} from "lucide-react";
import { usePlayer } from "../hooks/usePlayer";
import { musicService } from "../services/musicService";

const RADIO_STATIONS = [
  { title: "Lofi Girl 24/7 Chill Beats", query: "https://www.youtube.com/watch?v=jfKfPfyJRdk", genre: "Lofi / Study", desc: "The legendary Study Beats live radio." },
  { title: "Anime J-Pop Hits Radio", query: "J-Pop Anime Hits Radio Live", genre: "J-Pop / Vocaloid", desc: "Energy packed Anime themes & J-Pop." },
  { title: "Synthwave Retro Outrun FM", query: "Synthwave Retro Radio Live", genre: "Synthwave / Synth", desc: "Neon grids & retro futuristic melodies." },
  { title: "Chillstep Dreamy Liquid Bass", query: "Chillstep Radio Live", genre: "Chillstep / Ambient", desc: "Atmospheric basslines and liquid step." },
  { title: "Classic Rock Radio Stream", query: "Classic Rock Live Stream", genre: "Rock / Nostalgia", desc: "Greatest hits of classic rock history." },
];

const LIVE_ATMOSPHERES = [
  { title: "Tokyo Rain Cafe Lounge", query: "Tokyo Rain Cafe Live", type: "Rainy Cafe", desc: "Gentle rain tap against a Tokyo coffee shop." },
  { title: "Ghibli Orchestral Orchestra", query: "Ghibli Orchestral Live", type: "Orchestra / Ghibli", desc: "Warm orchestral symphonies of Ghibli films." },
  { title: "Deep Forest Night rain", query: "Deep Forest Rain Live", type: "Nature Ambience", desc: "Quiet night sounds of nature and light breeze." },
  { title: "Cyberpunk Ambient 24/7", query: "Cyberpunk Synth Ambient 24/7", type: "Cyberpunk / Sci-Fi", desc: "Gritty synthesizers and holographic whispers." },
  { title: "Relaxing Ocean Waves Live", query: "Relaxing Ocean Waves Live", type: "Relax / Sleep", desc: "Crashing waves of pristine shorelines." }
];

interface MusicDeckProps {
  selectedGuild?: {
    id: string;
    name: string;
    memberCount: number;
    isActive: boolean;
  } | null;
}

export function MusicDeck({ selectedGuild }: MusicDeckProps) {
  const {
    isPlaying,
    togglePlay,
    volume,
    setVolume,
    isMuted,
    toggleMute,
    applyFilter,
    setLoopMode,
    serverQueue,
    currentTrack,
    visualizerBars,
    activeRecTag,
    setActiveRecTag,
    recommendations,
    isRecLoading,
    playTrack,
    playRadio,
    skipTrack,
    stopTrack,
    shuffleQueue,
    clearQueue,
    removeTrack,
    voiceChannelId,
    setVoiceChannelId,
    joinVoiceChannel,
    playerStatusMessage,
    setPlayerStatusMessage,
    isConnected,
    disconnectBot,
  } = usePlayer(selectedGuild?.id);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<{ title: string; uri: string; duration: number; author: string }[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [discoverTab, setDiscoverTab] = useState<"recommendations" | "radio" | "live">("recommendations");
  
  // Voice Channels Dropdown State
  const [channels, setChannels] = useState<{ id: string; name: string }[]>([]);
  const [isChannelDropdownOpen, setIsChannelDropdownOpen] = useState(false);
  const [channelSearchQuery, setChannelSearchQuery] = useState("");
  const [isChannelsLoading, setIsChannelsLoading] = useState(false);

  // Audio Engine State
  const [activeFilter, setActiveFilter] = useState("clear");
  const [loopModeState, setLoopModeState] = useState<"off" | "track" | "queue">("off");
  const [isAudioEngineOpen, setIsAudioEngineOpen] = useState(false);

  // Mobile Sidebar Toggle States
  const [isLeftPaneOpen, setIsLeftPaneOpen] = useState(false);
  const [isRightPaneOpen, setIsRightPaneOpen] = useState(false);

  // Helper to format track durations in milliseconds to MM:SS
  const formatDuration = useCallback((ms: number) => {
    if (!ms || isNaN(ms)) return "00:00";
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }, []);

  // Helper to resolve an aesthetic Ghibli gradient based on the track title string
  const getGhibliGradient = useCallback((title: string = "") => {
    if (!title) return "from-slate-800 to-slate-950";
    const hash = title.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const gradients = [
      "from-[#1e3c72] via-[#2a5298] to-[#ff9a9e]", // Twilight Sky
      "from-[#0575e6] to-[#00f260]", // Forest Garden
      "from-[#3a1c1c] via-[#5d3232] to-[#c9b09a]", // Seaside Lofi
      "from-[#4ca1af] to-[#2c3e50]", // Silent Lake
      "from-[#ee0979] to-[#ff6a00]", // Sunset Glow
      "from-[#11998e] to-[#38ef7d]", // Emerald Meadow
      "from-[#fc466b] to-[#3f5efb]", // Dreamy Neon
    ];
    return gradients[hash % gradients.length];
  }, []);

  const currentGradient = getGhibliGradient(currentTrack?.title);

  const fetchChannels = useCallback(async () => {
    if (!selectedGuild) return;
    setIsChannelsLoading(true);
    
    try {
      const res = await musicService.getVoiceChannels(selectedGuild.id);
      if (res.success && res.channels) {
        setChannels(res.channels);
        if (res.channels.length > 0 && voiceChannelId === "1123389644764090544") {
          setVoiceChannelId(res.channels[0].id);
        }
      }
    } catch (err) {
      console.warn("Failed to fetch channels:", err);
    } finally {
      setIsChannelsLoading(false);
    }
  }, [voiceChannelId, setVoiceChannelId, selectedGuild]);

  useEffect(() => {
    fetchChannels();
  }, [fetchChannels]);

  const selectedChannelName = channels.find(c => c.id === voiceChannelId)?.name || "Select Channel...";
  const filteredChannels = channels.filter(c => c.name.toLowerCase().includes(channelSearchQuery.toLowerCase()));

  return (
    <div className="w-full flex-grow relative overflow-hidden flex flex-col bg-[#04080c] min-h-[calc(100vh-88px)]">
      {/* Background Gradient Layer */}
      <div className={`absolute inset-0 bg-gradient-to-br ${currentGradient} opacity-25 transition-all duration-[1.5s] ease-in-out`} />
      <div className="absolute inset-0 backdrop-blur-3xl bg-[#04080c]/75" />

      {/* Real-time Lavalink player connection status (Floating Toast) */}
      <AnimatePresence mode="wait">
        {playerStatusMessage && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.9 }}
            transition={{ type: "spring", stiffness: 300, damping: 25 }}
            className={`absolute bottom-28 right-6 z-50 p-4 rounded-2xl border flex items-start gap-3 overflow-hidden shadow-2xl backdrop-blur-md max-w-sm w-[calc(100vw-3rem)] ${
              playerStatusMessage.success 
                ? "bg-[#0b1d15]/90 border-emerald-500/25 text-emerald-400" 
                : "bg-[#1c2a38]/90 border-brand-secondary/15 text-brand-secondary/80"
            }`}
          >
            <AlertCircle className="w-4.5 h-4.5 flex-shrink-0 mt-0.5" />
            <div className="flex-grow text-[10px] font-light leading-relaxed uppercase tracking-wider">
              {playerStatusMessage.text}
            </div>
            <button 
              onClick={() => setPlayerStatusMessage(null)}
              className="text-[9px] font-mono hover:underline uppercase flex-shrink-0 tracking-wider font-semibold ml-4"
            >
              Clear
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* MAIN 3-PANE SPLIT */}
      <div className="flex flex-grow overflow-hidden relative z-10">
        
        {/* LEFT PANE: Channel & Discovery */}
        <div className={`w-[280px] xl:w-[320px] flex-shrink-0 border-r border-brand-secondary/10 flex-col bg-black/40 transition-all duration-300 xl:flex ${
          isLeftPaneOpen 
            ? "flex absolute inset-y-0 left-0 z-40 bg-[#0b141d]/95 backdrop-blur-3xl w-[290px] shadow-2xl" 
            : "hidden"
        }`}>
          
          {/* Target Channel Dropdown Header */}
          <div className="p-5 border-b border-brand-secondary/10 relative">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[8px] font-bold text-brand-secondary/60 tracking-widest uppercase">Target Connection</span>
              <button 
                onClick={() => setIsLeftPaneOpen(false)}
                className="xl:hidden p-1 text-brand-secondary/50 hover:text-white transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsChannelDropdownOpen(!isChannelDropdownOpen)}
                className={`flex-grow bg-white/5 border border-brand-secondary/10 hover:border-brand-secondary/35 rounded-xl px-3 py-2.5 text-[10px] font-light text-white focus:outline-none transition flex justify-between items-center group cursor-pointer truncate ${
                  isConnected ? "w-[calc(100%-46px)]" : "w-full"
                }`}
              >
                <div className="flex items-center gap-2 truncate">
                  <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isConnected ? "bg-emerald-400 animate-pulse" : "bg-red-400"}`} />
                  <span className={`truncate ${voiceChannelId ? "text-white font-medium" : "text-brand-secondary/50"}`}>
                    {selectedChannelName}
                  </span>
                </div>
                <ChevronRight className={`w-3.5 h-3.5 text-brand-secondary/50 transition-transform flex-shrink-0 ${isChannelDropdownOpen ? "rotate-90" : ""}`} />
              </button>

              {isConnected && (
                <button
                  type="button"
                  onClick={disconnectBot}
                  className="flex-shrink-0 w-[38px] h-[38px] rounded-xl bg-red-500/10 border border-red-500/25 hover:bg-red-500/20 text-red-400 flex items-center justify-center transition cursor-pointer hover:border-red-500/50"
                  title="Disconnect Bot"
                >
                  <Link2Off className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Dropdown Popover */}
            <AnimatePresence>
              {isChannelDropdownOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                  className="absolute top-full mt-2 left-4 right-4 bg-[#0b141d] border border-brand-secondary/20 rounded-xl shadow-2xl z-50 overflow-hidden"
                >
                  <div className="p-2 border-b border-brand-secondary/10">
                    <div className="relative">
                      <input
                        type="text"
                        placeholder="Search channels..."
                        value={channelSearchQuery}
                        onChange={(e) => setChannelSearchQuery(e.target.value)}
                        className="w-full bg-[#04080c] border border-brand-secondary/10 rounded-lg px-2.5 py-1.5 text-[9px] text-white focus:outline-none focus:border-brand-secondary/35 transition pl-7"
                      />
                      <Search className="w-3 h-3 text-brand-secondary/40 absolute left-2.5 top-1/2 -translate-y-1/2" />
                    </div>
                  </div>
                  <div className="max-h-[150px] overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
                    {filteredChannels.length > 0 ? (
                      filteredChannels.map((channel) => (
                        <div
                          key={channel.id}
                          onClick={() => { joinVoiceChannel(channel.id); setIsChannelDropdownOpen(false); setChannelSearchQuery(""); }}
                          className={`px-3 py-2 text-[9px] cursor-pointer hover:bg-brand-secondary/10 transition flex items-center justify-between ${
                            voiceChannelId === channel.id ? "text-brand-secondary font-bold bg-brand-secondary/5" : "text-white/80"
                          }`}
                        >
                          <span className="truncate">{channel.name}</span>
                          {voiceChannelId === channel.id && <Radio className="w-3 h-3" />}
                        </div>
                      ))
                    ) : (
                      <div className="p-4 text-center text-[9px] text-brand-secondary/30">No voice channels.</div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Search Bar */}
          <div className="p-5 pb-3">
            <span className="text-[8px] font-bold text-brand-secondary/60 tracking-widest uppercase mb-2 flex items-center gap-1.5"><Search className="w-3 h-3"/> Discover</span>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (searchQuery.trim()) {
                  setIsSearching(true);
                  try {
                    const res = await musicService.searchTracks(searchQuery);
                    if (res.success && res.tracks) setSearchResults(res.tracks);
                  } catch (_) {
                  } finally { setIsSearching(false); }
                }
              }}
              className="relative"
            >
              <input
                type="text"
                placeholder="Search YouTube..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-[#04080c]/50 border border-brand-secondary/15 hover:border-brand-secondary/35 rounded-xl pl-3 pr-10 py-2.5 text-[10px] text-white focus:outline-none focus:border-brand-secondary/45 transition"
              />
              <button type="submit" className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-brand-secondary hover:text-white transition cursor-pointer">
                {isSearching ? <div className="w-3.5 h-3.5 rounded-full border-2 border-brand-secondary/30 border-t-brand-secondary animate-spin" /> : <ChevronRight className="w-3.5 h-3.5" />}
              </button>
            </form>
          </div>

          {/* Results & Recommendations List */}
          <div className="flex-grow overflow-hidden flex flex-col px-3 pb-4">
            
            {/* Discover Tab Switcher */}
            {searchResults.length === 0 && (
              <div className="flex bg-white/5 border border-brand-secondary/10 rounded-xl p-1 gap-1 mb-4">
                <button
                  type="button"
                  onClick={() => setDiscoverTab("recommendations")}
                  className={`flex-1 py-1.5 rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-1 cursor-pointer ${
                    discoverTab === "recommendations" ? "bg-brand-secondary text-[#04080c]" : "text-brand-secondary/50 hover:text-white"
                  }`}
                >
                  <Sparkles className="w-3 h-3" />
                  <span>Explore</span>
                </button>
                <button
                  type="button"
                  onClick={() => setDiscoverTab("radio")}
                  className={`flex-1 py-1.5 rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-1 cursor-pointer ${
                    discoverTab === "radio" ? "bg-brand-secondary text-[#04080c]" : "text-brand-secondary/50 hover:text-white"
                  }`}
                >
                  <Radio className="w-3 h-3" />
                  <span>Radio</span>
                </button>
                <button
                  type="button"
                  onClick={() => setDiscoverTab("live")}
                  className={`flex-1 py-1.5 rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-1 cursor-pointer ${
                    discoverTab === "live" ? "bg-brand-secondary text-[#04080c]" : "text-brand-secondary/50 hover:text-white"
                  }`}
                >
                  <Activity className="w-3 h-3" />
                  <span>Live</span>
                </button>
              </div>
            )}

            {searchResults.length > 0 ? (
              <div className="flex flex-col h-full">
                <div className="flex justify-between items-center mb-2 px-2">
                  <span className="text-[8px] font-bold text-brand-secondary/60 tracking-widest uppercase">Search Results</span>
                  <button onClick={() => setSearchResults([])} className="text-[8px] hover:text-white transition uppercase tracking-widest text-brand-secondary/40 cursor-pointer">Clear</button>
                </div>
                <div className="overflow-y-auto space-y-1 pr-1 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
                  {searchResults.map((track, i) => (
                    <div
                      key={i}
                      onClick={() => { playTrack(track.title); setSearchResults([]); setSearchQuery(""); }}
                      className="p-2.5 rounded-xl border border-transparent hover:border-brand-secondary/20 hover:bg-white/5 cursor-pointer transition flex items-center justify-between group/s"
                    >
                      <div className="overflow-hidden pr-2">
                        <h4 className="text-[10px] font-bold truncate text-white leading-tight group-hover/s:text-brand-secondary transition">{track.title}</h4>
                        <span className="text-[8px] text-brand-secondary/40 block mt-0.5 truncate">{track.author}</span>
                      </div>
                      <Play className="w-3.5 h-3.5 text-brand-secondary opacity-0 group-hover/s:opacity-100 transition-opacity flex-shrink-0" />
                    </div>
                  ))}
                </div>
              </div>
            ) : discoverTab === "recommendations" ? (
              <div className="flex flex-col h-full overflow-hidden">
                <div className="flex flex-wrap gap-1 mb-3 px-2">
                  {(["jpop", "lofi", "edm", "rock"] as const).map((tag) => (
                    <button
                      key={tag}
                      onClick={() => setActiveRecTag(tag)}
                      className={`text-[8px] font-bold px-2 py-1 rounded-md transition-all uppercase tracking-wider cursor-pointer ${
                        activeRecTag === tag ? "bg-brand-secondary text-[#04080c]" : "bg-white/5 text-brand-secondary/50 hover:text-brand-secondary hover:bg-white/10"
                      }`}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
                <div className="overflow-y-auto space-y-1 pr-1 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
                  {isRecLoading ? (
                    <div className="py-8 text-center flex flex-col items-center gap-2">
                      <div className="w-4 h-4 rounded-full border-2 border-brand-secondary/30 border-t-brand-secondary animate-spin" />
                    </div>
                  ) : (
                    recommendations.map((track, i) => {
                      const trackGradient = getGhibliGradient(track.title);
                      return (
                        <div
                          key={i}
                          onClick={() => playTrack(track.title)}
                          className="p-2.5 rounded-xl border border-transparent hover:border-brand-secondary/20 hover:bg-white/5 cursor-pointer transition flex items-center justify-between group/rec"
                        >
                          <div className="flex items-center gap-3 overflow-hidden pr-2">
                            <div className={`w-7 h-7 rounded-lg bg-gradient-to-tr ${trackGradient} flex-shrink-0 flex items-center justify-center shadow-md`}>
                              <Radio className="w-3 h-3 text-white/80" />
                            </div>
                            <div className="truncate">
                              <span className="text-[10px] font-bold text-white block truncate leading-tight group-hover/rec:text-brand-secondary transition">{track.title}</span>
                              <span className="text-[8px] text-brand-secondary/40 block mt-0.5 truncate">{track.author}</span>
                            </div>
                          </div>
                          <Play className="w-3.5 h-3.5 text-brand-secondary opacity-0 group-hover/rec:opacity-100 transition-opacity flex-shrink-0" />
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            ) : discoverTab === "radio" ? (
              <div className="flex flex-col h-full overflow-hidden">
                <div className="overflow-y-auto space-y-1.5 pr-1 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
                  {RADIO_STATIONS.map((station, i) => {
                    const trackGradient = getGhibliGradient(station.title);
                    return (
                      <div
                        key={i}
                        onClick={() => playRadio(station.query, station.title, station.genre)}
                        className="p-2.5 rounded-xl border border-white/5 hover:border-brand-secondary/20 bg-[#0b141d]/30 hover:bg-white/5 cursor-pointer transition flex items-center justify-between group/radio"
                      >
                        <div className="flex items-center gap-3 overflow-hidden pr-2">
                          <div className={`w-8 h-8 rounded-lg bg-gradient-to-tr ${trackGradient} flex-shrink-0 flex items-center justify-center shadow-md relative group-hover/radio:scale-105 transition-transform duration-300`}>
                            <Radio className="w-3.5 h-3.5 text-white/80" />
                          </div>
                          <div className="truncate">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px] font-bold text-white block truncate leading-tight group-hover/radio:text-brand-secondary transition">{station.title}</span>
                              <span className="text-[6px] font-bold px-1 py-0.5 rounded bg-brand-secondary/15 text-brand-secondary uppercase flex-shrink-0">{station.genre}</span>
                            </div>
                            <span className="text-[8px] text-brand-secondary/40 block mt-1 truncate">{station.desc}</span>
                          </div>
                        </div>
                        <Play className="w-3.5 h-3.5 text-brand-secondary opacity-0 group-hover/radio:opacity-100 transition-opacity flex-shrink-0" />
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="flex flex-col h-full overflow-hidden">
                <div className="overflow-y-auto space-y-1.5 pr-1 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
                  {LIVE_ATMOSPHERES.map((live, i) => {
                    const trackGradient = getGhibliGradient(live.title);
                    return (
                      <div
                        key={i}
                        onClick={() => playRadio(live.query, live.title, live.type)}
                        className="p-2.5 rounded-xl border border-white/5 hover:border-brand-secondary/20 bg-[#0b141d]/30 hover:bg-white/5 cursor-pointer transition flex items-center justify-between group/live"
                      >
                        <div className="flex items-center gap-3 overflow-hidden pr-2">
                          <div className={`w-8 h-8 rounded-lg bg-gradient-to-tr ${trackGradient} flex-shrink-0 flex items-center justify-center shadow-md relative group-hover/live:scale-105 transition-transform duration-300`}>
                            <Activity className="w-3.5 h-3.5 text-white/80" />
                          </div>
                          <div className="truncate">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px] font-bold text-white block truncate leading-tight group-hover/live:text-brand-secondary transition">{live.title}</span>
                              <span className="text-[6px] font-bold px-1 py-0.5 rounded bg-emerald-500/10 text-emerald-400 uppercase flex-shrink-0">{live.type}</span>
                            </div>
                            <span className="text-[8px] text-brand-secondary/40 block mt-1 truncate">{live.desc}</span>
                          </div>
                        </div>
                        <Play className="w-3.5 h-3.5 text-brand-secondary opacity-0 group-hover/live:opacity-100 transition-opacity flex-shrink-0" />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* CENTER PANE: Hero Stage */}
        <div className="flex-grow flex flex-col items-center justify-center p-6 md:p-8 relative overflow-hidden">
          
          {/* Mobile Overlay Toggle Sub-Header */}
          <div className="xl:hidden flex items-center justify-between w-full border-b border-white/5 pb-4 mb-4 relative z-20">
            <button
              onClick={() => { setIsLeftPaneOpen(!isLeftPaneOpen); setIsRightPaneOpen(false); }}
              className="px-4 py-2 bg-[#101c26]/60 border border-brand-secondary/15 rounded-xl text-[9px] font-bold uppercase tracking-wider text-brand-secondary hover:text-white transition flex items-center gap-1.5 cursor-pointer hover:border-brand-secondary/40"
            >
              <Search className="w-3.5 h-3.5" />
              <span>Search & Channel</span>
            </button>
            
            <button
              onClick={() => { setIsRightPaneOpen(!isRightPaneOpen); setIsLeftPaneOpen(false); }}
              className="px-4 py-2 bg-[#101c26]/60 border border-brand-secondary/15 rounded-xl text-[9px] font-bold uppercase tracking-wider text-brand-secondary hover:text-white transition flex items-center gap-1.5 cursor-pointer hover:border-brand-secondary/40"
            >
              <ListMusic className="w-3.5 h-3.5" />
              <span>Up Next ({serverQueue.length})</span>
            </button>
          </div>

          {/* Backdrop click-away dims center panel when overlay is active */}
          <AnimatePresence>
            {(isLeftPaneOpen || isRightPaneOpen) && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 0.6 }}
                exit={{ opacity: 0 }}
                onClick={() => { setIsLeftPaneOpen(false); setIsRightPaneOpen(false); }}
                className="xl:hidden absolute inset-0 bg-[#04080c] z-30 backdrop-blur-sm cursor-pointer"
              />
            )}
          </AnimatePresence>

          {/* Visualizer Backdrop */}
          <div className="absolute bottom-10 left-1/2 -translate-x-1/2 w-3/4 max-w-[500px] h-32 flex items-end justify-center gap-1.5 opacity-20 pointer-events-none">
            {visualizerBars.slice(0, 20).map((bar, i) => (
              <motion.div
                key={i}
                className="w-full max-w-[8px] rounded-t-md bg-brand-secondary shadow-[0_0_10px_rgba(var(--brand-secondary-rgb),0.5)]"
                animate={{ height: isPlaying ? [bar.baseHeight * 0.5, bar.baseHeight * 2, bar.baseHeight * 0.5] : bar.baseHeight * 0.2 }}
                transition={{ repeat: Infinity, duration: 1.2 + Math.sin(i) * 0.3, delay: bar.delay, ease: "easeInOut" }}
                style={{ minHeight: "4px" }}
              />
            ))}
          </div>

          {/* Vinyl player stage */}
          <motion.div
            animate={{ scale: isPlaying ? 1.02 : 1 }}
            whileHover={{ scale: 1.04, rotate: isPlaying ? 0 : 2 }}
            transition={{ duration: 1.5, ease: "easeInOut" }}
            className="relative w-56 h-56 md:w-80 md:h-80 rounded-full flex items-center justify-center mb-10 shadow-[0_0_85px_rgba(var(--brand-secondary-rgb),0.18)] group cursor-pointer"
          >
            {/* Spinning Vinyl */}
            <div className="absolute inset-0 rounded-full border-[6px] border-[#04080c]/50 bg-[#0b141d] shadow-2xl transition duration-500 group-hover:border-brand-secondary/15" />
            <div className="absolute inset-2 rounded-full border border-dashed border-white/10" />
            <div className="absolute inset-12 rounded-full border border-dashed border-white/5" />
            
            <motion.div
              animate={{ rotate: isPlaying ? 360 : 0 }}
              transition={{ repeat: Infinity, duration: isPlaying ? 24 : 0, ease: "linear" }}
              className={`w-40 h-40 md:w-56 md:h-56 rounded-full bg-gradient-to-tr ${currentGradient} flex items-center justify-center p-2 relative shadow-inner`}
            >
              <div className="w-10 h-10 md:w-12 md:h-12 rounded-full bg-[#04080c] border-2 border-brand-secondary/30 flex items-center justify-center relative z-10 shadow-xl group-hover:scale-105 transition-transform duration-300">
                <div className="w-2.5 h-2.5 md:w-3 md:h-3 rounded-full bg-brand-secondary animate-pulse" />
              </div>
            </motion.div>
          </motion.div>

          <div className="text-center z-10 max-w-lg px-4">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-brand-primary/20 border border-brand-primary/30 text-brand-secondary text-[8px] font-bold tracking-[0.2em] uppercase mb-4">
              <Activity className="w-3 h-3" /> {currentTrack ? "LIVE STREAM" : "IDLE"}
            </div>
            <h2 className="text-2xl md:text-5xl font-bold tracking-tight text-white font-serif leading-tight mb-3 drop-shadow-lg truncate max-w-[280px] md:max-w-md">
              {currentTrack ? currentTrack.title : "Awaiting Melody"}
            </h2>
            <p className="text-xs md:text-base text-brand-secondary/80 font-sans font-light tracking-wide truncate drop-shadow max-w-[280px] md:max-w-md">
              {currentTrack ? currentTrack.artist : "Select a track to begin playback"}
            </p>
          </div>
        </div>

        {/* RIGHT PANE: Queue */}
        <div className={`w-[280px] xl:w-[320px] flex-shrink-0 border-l border-brand-secondary/10 flex-col bg-black/40 transition-all duration-300 xl:flex ${
          isRightPaneOpen 
            ? "flex absolute inset-y-0 right-0 z-40 bg-[#0b141d]/95 backdrop-blur-3xl w-[290px] shadow-2xl" 
            : "hidden"
        }`}>
          <div className="p-5 border-b border-brand-secondary/10 flex items-center justify-between">
            <span className="text-[9px] font-bold text-brand-secondary/80 tracking-[0.15em] uppercase flex items-center gap-2">
              <ListMusic className="w-3.5 h-3.5" /> Up Next
            </span>
            <div className="flex items-center gap-1">
              <button onClick={shuffleQueue} className="p-1.5 text-brand-secondary/50 hover:text-white transition rounded-md hover:bg-white/10 cursor-pointer" title="Shuffle"><Shuffle className="w-3.5 h-3.5"/></button>
              <button onClick={clearQueue} className="p-1.5 text-brand-secondary/50 hover:text-white transition rounded-md hover:bg-white/10 cursor-pointer" title="Clear"><Trash2 className="w-3.5 h-3.5"/></button>
              <button 
                onClick={() => setIsRightPaneOpen(false)}
                className="xl:hidden p-1.5 text-brand-secondary/50 hover:text-white transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
          
          <div className="flex-grow overflow-y-auto px-3 py-4 space-y-1.5 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
            {serverQueue.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center text-brand-secondary/30 text-[9px] uppercase tracking-widest px-4 gap-3">
                <ListMusic className="w-6 h-6 opacity-20" />
                No tracks in queue
              </div>
            ) : (
              serverQueue.map((track, i) => {
                const grad = getGhibliGradient(track.title);
                return (
                  <div key={i} className="p-2.5 rounded-xl border border-transparent hover:border-brand-secondary/20 hover:bg-white/5 transition flex items-center gap-3 relative group/item cursor-pointer">
                    <span className="text-[8px] font-mono text-brand-secondary/40 w-3 text-right flex-shrink-0">{i + 1}</span>
                    <div className={`w-8 h-8 rounded-lg bg-gradient-to-tr ${grad} flex-shrink-0 opacity-80 group-hover/item:opacity-100 transition`} />
                    <div className="flex-grow overflow-hidden pr-6">
                      <h4 className="text-[10px] font-bold truncate text-white leading-tight group-hover/item:text-brand-secondary transition">{track.title}</h4>
                      <span className="text-[8px] font-mono text-brand-secondary/50 mt-1 block">{formatDuration(track.duration || 0)}</span>
                    </div>
                    <button onClick={() => removeTrack(i)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-brand-secondary/30 hover:text-red-400 hover:bg-white/10 rounded-lg opacity-0 group-hover/item:opacity-100 transition cursor-pointer">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>

      </div>

      {/* BOTTOM CONTROL BAR */}
      <div className="h-24 flex-shrink-0 bg-black/60 border-t border-brand-secondary/15 relative z-30 flex items-center px-4 md:px-8 gap-4 md:gap-8 backdrop-blur-2xl">
        
        {/* Left: Quick Track Info */}
        <div className="hidden md:flex w-[200px] xl:w-[280px] items-center gap-3 overflow-hidden">
          {currentTrack ? (
             <>
               <div className={`w-11 h-11 rounded-lg bg-gradient-to-tr ${currentGradient} shadow-md flex-shrink-0`} />
               <div className="overflow-hidden">
                  <h4 className="text-xs font-bold text-white truncate">{currentTrack.title}</h4>
                  <p className="text-[9px] text-brand-secondary/60 truncate mt-0.5 uppercase tracking-wider">{currentTrack.artist || "Discord Voice Stream"}</p>
               </div>
             </>
          ) : (
            <div className="text-[10px] text-brand-secondary/40 font-mono uppercase">Idle Console</div>
          )}
        </div>

        {/* Center: Playback Controls & Scrubber */}
        <div className="flex-grow flex flex-col items-center justify-center max-w-2xl mx-auto w-full">
          <div className="flex items-center gap-4 sm:gap-6 mb-2">
            <button onClick={() => {
              const nextMode = loopModeState === "off" ? "track" : loopModeState === "track" ? "queue" : "off";
              setLoopModeState(nextMode); setLoopMode(nextMode);
            }} className={`relative p-2 transition hover:scale-115 active:scale-95 cursor-pointer ${loopModeState !== "off" ? "text-brand-secondary" : "text-brand-secondary/40 hover:text-white"}`}>
              <Repeat className="w-4 h-4" />
              {loopModeState !== "off" && <span className="absolute text-[7px] font-bold -top-0.5 -right-0.5 bg-brand-primary text-white w-3 h-3 rounded-full flex items-center justify-center scale-90">{loopModeState === "track" ? "1" : "Q"}</span>}
            </button>
            <button onClick={stopTrack} className="p-2 text-brand-secondary/70 hover:text-white hover:scale-115 active:scale-95 transition cursor-pointer"><Square className="w-4 h-4 fill-current" /></button>
            
            <button 
              onClick={togglePlay} 
              className="w-10 h-10 rounded-full bg-white text-black flex items-center justify-center hover:scale-110 active:scale-90 transition-all shadow-[0_0_15px_rgba(255,255,255,0.25)] cursor-pointer"
            >
              {isPlaying ? <Pause className="w-4.5 h-4.5 fill-current" /> : <Play className="w-4.5 h-4.5 fill-current translate-x-0.5" />}
            </button>
            
            <button onClick={skipTrack} className="p-2 text-brand-secondary/70 hover:text-white hover:scale-115 active:scale-95 transition cursor-pointer"><SkipForward className="w-4 h-4 fill-current" /></button>
            <button className="p-2 text-brand-secondary/40 hover:text-white hover:scale-115 active:scale-95 transition cursor-pointer"><Heart className="w-4 h-4" /></button>
          </div>
          
          <div className="w-full flex items-center gap-3">
            <span className="text-[9px] font-mono text-brand-secondary/60 w-8 text-right">00:00</span>
            <div className="flex-grow h-1 bg-white/10 rounded-full overflow-hidden cursor-pointer group relative">
              <div className="absolute inset-y-0 left-0 w-1/3 bg-brand-secondary rounded-full group-hover:bg-emerald-400 transition-colors" />
            </div>
            <span className="text-[9px] font-mono text-brand-secondary/60 w-8">{currentTrack ? formatDuration(currentTrack.duration || 0) : "00:00"}</span>
          </div>
        </div>

        {/* Right: Volume & Audio Engine Toggle */}
        <div className="hidden md:flex w-[200px] xl:w-[280px] items-center justify-end gap-3.5 relative">
          <button onClick={toggleMute} className="text-brand-secondary/60 hover:text-white transition cursor-pointer">
            <Volume2 className="w-4 h-4"/>
          </button>
          <input 
            type="range" 
            min="0" 
            max="100" 
            value={isMuted ? 0 : volume} 
            onChange={(e) => setVolume(Number(e.target.value))} 
            className="w-20 lg:w-24 h-1 accent-white bg-white/20 rounded-full cursor-pointer" 
          />
          <button 
            onClick={() => setIsAudioEngineOpen(!isAudioEngineOpen)}
            className={`p-2 rounded-full transition-all border cursor-pointer ${
              isAudioEngineOpen || activeFilter !== "clear" 
                ? "bg-brand-secondary/20 border-brand-secondary/50 text-brand-secondary shadow-[0_0_12px_rgba(var(--brand-secondary-rgb),0.35)] scale-105" 
                : "bg-transparent border-transparent text-brand-secondary/60 hover:text-white hover:bg-white/10"
            }`}
          >
            <Settings2 className="w-4 h-4" />
          </button>

          {/* Audio Engine Popover */}
          <AnimatePresence>
            {isAudioEngineOpen && (
              <motion.div
                initial={{ opacity: 0, y: 20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 20, scale: 0.95 }}
                className="absolute bottom-full mb-6 right-0 w-[340px] bg-[#0b141d]/95 backdrop-blur-2xl border border-brand-secondary/20 rounded-2xl shadow-[0_10px_45px_rgba(0,0,0,0.85)] p-5 z-50 origin-bottom-right"
              >
                <div className="flex items-center justify-between mb-4 border-b border-white/5 pb-3">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-brand-secondary flex items-center gap-2"><Sliders className="w-3.5 h-3.5"/> Audio Engine</span>
                  <button onClick={() => setIsAudioEngineOpen(false)} className="text-brand-secondary/50 hover:text-white cursor-pointer"><X className="w-4 h-4"/></button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: "clear", name: "Clear", desc: "No filters" }, { id: "nightcore", name: "Nightcore", desc: "Pitch & Fast" },
                    { id: "vaporwave", name: "Vaporwave", desc: "Slow Reverb" }, { id: "8d", name: "8D Audio", desc: "Rotational" },
                    { id: "karaoke", name: "Karaoke", desc: "No Vocals" }, { id: "tremolo", name: "Tremolo", desc: "Vol Osc" },
                    { id: "vibrato", name: "Vibrato", desc: "Pitch Osc" }, { id: "lowpass", name: "Low Pass", desc: "Muffled" },
                  ].map(filter => (
                    <button
                      key={filter.id}
                      onClick={() => { setActiveFilter(filter.id); applyFilter(filter.id); }}
                      className={`p-2.5 rounded-xl border transition-all text-left flex flex-col justify-center cursor-pointer ${
                        activeFilter === filter.id ? "bg-brand-secondary/15 border-brand-secondary/50 shadow-inner" : "bg-black/30 border-white/5 hover:border-brand-secondary/30 hover:bg-white/5"
                      }`}
                    >
                      <span className={`text-[10px] font-bold uppercase tracking-wider ${activeFilter === filter.id ? "text-brand-secondary" : "text-white"}`}>{filter.name}</span>
                      <span className={`text-[8px] font-mono uppercase tracking-widest ${activeFilter === filter.id ? "text-brand-secondary/80" : "text-brand-secondary/40"}`}>{filter.desc}</span>
                    </button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

      </div>
    </div>
  );
}
