// src/features/music/components/MusicDeck.tsx
"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Play, Pause, SkipForward, Volume2,
  ListMusic, Radio, Sliders, Heart, Shuffle, Repeat, ChevronRight, ChevronDown, AlertCircle, Trash2, Search, Square, Settings2, X, Activity, Link2Off, Sparkles
} from "lucide-react";
import { usePlayer } from "../hooks/usePlayer";
import { musicService } from "../services/musicService";

const getTrackThumbnail = (track: any): string | null => {
  if (!track) return null;
  if (track.artworkUrl) return track.artworkUrl;
  if (track.uri) {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    const match = track.uri.match(regExp);
    if (match && match[2].length === 11) {
      const videoId = match[2];
      return `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
    }
  }
  return null;
};

interface MarqueeTextProps {
  text: string;
  className?: string;
}

function MarqueeText({ text, className }: MarqueeTextProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [shouldMarquee, setShouldMarquee] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    const textEl = textRef.current;
    if (container && textEl) {
      setShouldMarquee(textEl.scrollWidth > container.clientWidth);
    }
  }, [text]);

  return (
    <div ref={containerRef} className="overflow-hidden w-full relative whitespace-nowrap">
      {shouldMarquee ? (
        <div className="flex gap-8 animate-marquee w-max hover:[animation-play-state:paused] cursor-default">
          <span ref={textRef} className={className}>{text}</span>
          <span className={className}>{text}</span>
        </div>
      ) : (
        <span ref={textRef} className={`${className} block truncate`}>{text}</span>
      )}
    </div>
  );
}


const RADIO_STATIONS = [
  { title: "Lofi Girl 24/7 Chill Beats", query: "https://www.youtube.com/watch?v=jfKfPfyJRdk", genre: "Lofi / Study", desc: "The legendary Study Beats live radio." },
  { title: "Anime J-Pop Hits Radio", query: "J-Pop Anime Hits Radio Live", genre: "J-Pop / Vocaloid", desc: "Energy packed Anime themes & J-Pop." },
  { title: "Synthwave Retro Outrun FM", query: "Synthwave Retro Radio Live", genre: "Synthwave / Synth", desc: "Neon grids & retro futuristic melodies." },
  { title: "Chillstep Dreamy Liquid Bass", query: "Chillstep Radio Live", genre: "Chillstep / Ambient", desc: "Atmospheric basslines and liquid step." },
  { title: "Classic Rock Radio Stream", query: "Classic Rock Live Stream", genre: "Rock / Nostalgia", desc: "Greatest hits of classic rock history." },
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
    bassBoost,
    reverb,
    activeFilter,
    serverQueue,
    currentTrack,
    visualizerBars,
    activeRecTag,
    setActiveRecTag,
    recommendations,
    isRecLoading,
    isPlaybackLoading,
    isActionPending,
    positionMs,
    isFavorited,
    seekTrack,
    toggleFavoriteTrack,
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
  const [radioSearchResults, setRadioSearchResults] = useState<{ name: string; url: string; homepage?: string; country?: string; tags?: string; favicon?: string }[]>([]);
  const [recommendedRadioStations, setRecommendedRadioStations] = useState<{ name: string; url: string; homepage?: string; country?: string; tags?: string; favicon?: string }[]>([]);
  const [isRecommendedRadioLoading, setIsRecommendedRadioLoading] = useState(false);
  const [liveSearchResults, setLiveSearchResults] = useState<{ title: string; uri: string; duration: number; author: string }[]>([]);
  const [recommendedLiveAtmospheres, setRecommendedLiveAtmospheres] = useState<{ title: string; uri: string; duration: number; author: string; type?: string; desc?: string }[]>([]);
  const [isRecommendedLiveLoading, setIsRecommendedLiveLoading] = useState(false);
  
  // Voice Channels Dropdown State
  const [channels, setChannels] = useState<{ id: string; name: string }[]>([]);
  const [isChannelDropdownOpen, setIsChannelDropdownOpen] = useState(false);
  const [channelSearchQuery, setChannelSearchQuery] = useState("");
  const [isChannelsLoading, setIsChannelsLoading] = useState(false);

  // Radio Countries States
  const [countries, setCountries] = useState<{ name: string; code: string; stationCount: number }[]>([]);
  const [selectedCountry, setSelectedCountry] = useState<string>("");
  const [isCountryDropdownOpen, setIsCountryDropdownOpen] = useState(false);
  const [countrySearchQuery, setCountrySearchQuery] = useState("");
  const [isCountriesLoading, setIsCountriesLoading] = useState(false);

  // Audio Engine State
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

  // 1. Radio Station: Exclusive to actual Web FM/AM/Internet Radio audio streams
  const isIcecastRadio = !!currentTrack && (
    // Must be an active live stream
    currentTrack.isStream === true &&
    // Must NOT be a YouTube video or stream (YouTube streams are live video feeds, not FM/web radio stations)
    !currentTrack.uri?.toLowerCase().includes("youtube") &&
    !currentTrack.uri?.toLowerCase().includes("youtu.be")
  );

  // 2. Live Stream / Atmosphere: Exclusive to YouTube live streams or ambient video broadcasts
  const isLiveStream = !!currentTrack && !isIcecastRadio && (
    // Explicitly played as a YouTube live stream
    (currentTrack.isStream === true && (
      currentTrack.uri?.toLowerCase().includes("youtube") || 
      currentTrack.uri?.toLowerCase().includes("youtu.be")
    )) ||
    // Played from the live/atmosphere tab (recognized by specific author tags/types)
    currentTrack.artist === "Live Atmosphere" ||
    ["Rainy Cafe", "Orchestra / Ghibli", "Nature Ambience", "Cyberpunk / Sci-Fi", "Relax / Sleep"].includes(currentTrack.artist || "") ||
    // Explicitly labeled live streams
    currentTrack.title?.toLowerCase().includes("24/7 live") ||
    currentTrack.title?.toLowerCase().includes("live stream") ||
    (currentTrack.title?.toLowerCase().includes("live") && 
     (currentTrack.title?.toLowerCase().includes("ambience") || 
      currentTrack.title?.toLowerCase().includes("atmosphere") || 
      currentTrack.title?.toLowerCase().includes("24/7")))
  );

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

  const fetchCountries = useCallback(async () => {
    setIsCountriesLoading(true);
    try {
      const res = await musicService.getRadioCountries();
      if (res.success && res.countries) {
        setCountries(res.countries);
      }
    } catch (err) {
      console.warn("Failed to fetch countries:", err);
    } finally {
      setIsCountriesLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCountries();
  }, [fetchCountries]);

  const fetchRecommendedRadio = useCallback(async () => {
    setIsRecommendedRadioLoading(true);
    try {
      const res = await musicService.searchRadio("");
      if (res.success && res.stations) {
        setRecommendedRadioStations(res.stations);
      }
    } catch (err) {
      console.warn("Failed to fetch recommended radio stations:", err);
    } finally {
      setIsRecommendedRadioLoading(false);
    }
  }, []);

  useEffect(() => {
    if (discoverTab === "radio" && recommendedRadioStations.length === 0) {
      fetchRecommendedRadio();
    }
  }, [discoverTab, recommendedRadioStations.length, fetchRecommendedRadio]);

  const fetchRecommendedLive = useCallback(async () => {
    setIsRecommendedLiveLoading(true);
    try {
      const res = await musicService.getLiveAtmospheres();
      if (res.success && res.tracks) {
        setRecommendedLiveAtmospheres(res.tracks);
      }
    } catch (err) {
      console.warn("Failed to fetch recommended live atmospheres:", err);
    } finally {
      setIsRecommendedLiveLoading(false);
    }
  }, []);

  useEffect(() => {
    if (discoverTab === "live" && recommendedLiveAtmospheres.length === 0) {
      fetchRecommendedLive();
    }
  }, [discoverTab, recommendedLiveAtmospheres.length, fetchRecommendedLive]);

  const selectedChannelName = channels.find(c => c.id === voiceChannelId)?.name || "Select Channel...";
  const filteredChannels = channels.filter(c => c.name.toLowerCase().includes(channelSearchQuery.toLowerCase()));

  return (
    <div className="w-full flex-grow relative overflow-hidden flex flex-col bg-[#04080c] h-full max-h-full min-h-0">
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
        <div className={`w-[240px] xl:w-[260px] min-w-[240px] flex-shrink-0 border-r border-brand-secondary/10 flex-col bg-[#080d14]/90 backdrop-blur-xl transition-all duration-300 xl:flex h-full max-h-full min-h-0 min-w-0 ${
          isLeftPaneOpen 
            ? "flex absolute inset-y-0 left-0 z-40 w-[260px] shadow-2xl" 
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
                  <div className="max-h-[150px] overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent custom-scrollbar">
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

          {/* Search Bar & Tabs */}
          <div className="p-5 pb-3 flex flex-col flex-shrink-0">
            <span className="text-[8px] font-bold text-brand-secondary/60 tracking-widest uppercase mb-3 flex items-center gap-1.5"><Search className="w-3 h-3"/> Discover</span>
            
            {/* Discover Tab Switcher */}
            <div className="flex bg-white/5 border border-brand-secondary/10 rounded-xl p-1 gap-1 mb-3">
              <button
                type="button"
                onClick={() => {
                  setDiscoverTab("recommendations");
                  setSearchQuery("");
                  setSearchResults([]);
                  setRadioSearchResults([]);
                  setLiveSearchResults([]);
                }}
                className={`flex-1 py-1.5 rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-1 cursor-pointer ${
                  discoverTab === "recommendations" ? "bg-brand-secondary text-[#04080c]" : "text-brand-secondary/50 hover:text-white"
                }`}
              >
                <Sparkles className="w-3 h-3" />
                <span>Explore</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setDiscoverTab("radio");
                  setSearchQuery("");
                  setSearchResults([]);
                  setRadioSearchResults([]);
                  setLiveSearchResults([]);
                }}
                className={`flex-1 py-1.5 rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-1 cursor-pointer ${
                  discoverTab === "radio" ? "bg-brand-secondary text-[#04080c]" : "text-brand-secondary/50 hover:text-white"
                }`}
              >
                <Radio className="w-3 h-3" />
                <span>Radio</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setDiscoverTab("live");
                  setSearchQuery("");
                  setSearchResults([]);
                  setRadioSearchResults([]);
                  setLiveSearchResults([]);
                }}
                className={`flex-1 py-1.5 rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-1 cursor-pointer ${
                  discoverTab === "live" ? "bg-brand-secondary text-[#04080c]" : "text-brand-secondary/50 hover:text-white"
                }`}
              >
                <Activity className="w-3 h-3" />
                <span>Live</span>
              </button>
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!searchQuery.trim() && !selectedCountry && discoverTab !== "radio") return;

                setIsSearching(true);
                try {
                  if (discoverTab === "recommendations") {
                    const res = await musicService.searchTracks(searchQuery);
                    if (res.success && res.tracks) setSearchResults(res.tracks);
                  } else if (discoverTab === "radio") {
                    const res = await musicService.searchRadio(searchQuery, selectedCountry || undefined);
                    if (res.success && res.stations) setRadioSearchResults(res.stations);
                  } else if (discoverTab === "live") {
                    const res = await musicService.searchTracks(`${searchQuery} live stream`);
                    if (res.success && res.tracks) setLiveSearchResults(res.tracks);
                  }
                } catch (_) {
                } finally { setIsSearching(false); }
              }}
              className="relative"
            >
              <input
                type="text"
                placeholder={
                  discoverTab === "recommendations" 
                    ? "Search YouTube..." 
                    : discoverTab === "radio" 
                      ? "Search global live radio (e.g. Lofi, Jazz)..." 
                      : "Search live atmospheres (e.g. Rain, Cafe)..."
                }
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-[#04080c]/50 border border-brand-secondary/15 hover:border-brand-secondary/35 rounded-xl pl-3 pr-10 py-2.5 text-[10px] text-white focus:outline-none focus:border-brand-secondary/45 transition"
              />
              <button type="submit" className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-brand-secondary hover:text-white transition cursor-pointer">
                {isSearching ? <div className="w-3.5 h-3.5 rounded-full border-2 border-brand-secondary/30 border-t-brand-secondary animate-spin" /> : <ChevronRight className="w-3.5 h-3.5" />}
              </button>
            </form>

            {discoverTab === "radio" && (
              <div className="mt-2.5 relative">
                <button
                  type="button"
                  onClick={() => setIsCountryDropdownOpen(!isCountryDropdownOpen)}
                  className="w-full bg-[#04080c]/40 border border-brand-secondary/10 hover:border-brand-secondary/30 rounded-xl px-3 py-2 text-[9px] text-white/80 focus:outline-none transition flex justify-between items-center cursor-pointer group animate-fade-in"
                >
                  <div className="flex items-center gap-1.5 truncate">
                    <span className="text-brand-secondary/50 font-bold uppercase tracking-wider">Country:</span>
                    <span className="truncate text-white font-medium">
                      {selectedCountry || "All Countries (Global)"}
                    </span>
                  </div>
                  <ChevronDown className={`w-3 h-3 text-brand-secondary/50 transition-transform duration-200 group-hover:text-white ${isCountryDropdownOpen ? "rotate-180" : ""}`} />
                </button>

                <AnimatePresence>
                  {isCountryDropdownOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: -5 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -5 }}
                      className="absolute left-0 right-0 mt-1.5 bg-[#0b141d] border border-brand-secondary/20 rounded-xl shadow-2xl z-50 overflow-hidden flex flex-col"
                    >
                      <div className="p-2 border-b border-brand-secondary/10">
                        <div className="relative">
                          <input
                            type="text"
                            placeholder="Filter countries..."
                            value={countrySearchQuery}
                            onChange={(e) => setCountrySearchQuery(e.target.value)}
                            className="w-full bg-[#04080c] border border-brand-secondary/10 rounded-lg px-2.5 py-1.5 text-[9px] text-white placeholder-white/30 focus:outline-none focus:border-brand-secondary/35 transition pl-7"
                          />
                          <Search className="w-3 h-3 text-brand-secondary/40 absolute left-2.5 top-1/2 -translate-y-1/2" />
                        </div>
                      </div>
                      <div className="max-h-[140px] overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent custom-scrollbar">
                        <div
                          onClick={async () => {
                            setSelectedCountry("");
                            setIsCountryDropdownOpen(false);
                            setCountrySearchQuery("");
                            setIsSearching(true);
                            try {
                              const res = await musicService.searchRadio(searchQuery, undefined);
                              if (res.success && res.stations) setRadioSearchResults(res.stations);
                            } catch (_) {} finally { setIsSearching(false); }
                          }}
                          className={`px-3 py-1.5 text-[9px] cursor-pointer hover:bg-brand-secondary/10 transition flex items-center justify-between font-bold ${
                            selectedCountry === "" ? "text-brand-secondary bg-brand-secondary/5" : "text-white/70 hover:text-white"
                          }`}
                        >
                          <span>All Countries (Global)</span>
                        </div>
                        {isCountriesLoading ? (
                          <div className="p-4 text-center text-[9px] text-brand-secondary/40">Loading countries...</div>
                        ) : countries.filter(c => c.name.toLowerCase().includes(countrySearchQuery.toLowerCase())).length > 0 ? (
                          countries
                            .filter(c => c.name.toLowerCase().includes(countrySearchQuery.toLowerCase()))
                            .map((country) => (
                              <div
                                key={country.name}
                                onClick={async () => {
                                  setSelectedCountry(country.name);
                                  setIsCountryDropdownOpen(false);
                                  setCountrySearchQuery("");
                                  setIsSearching(true);
                                  try {
                                    const res = await musicService.searchRadio(searchQuery, country.name);
                                    if (res.success && res.stations) setRadioSearchResults(res.stations);
                                  } catch (_) {} finally { setIsSearching(false); }
                                }}
                                className={`px-3 py-1.5 text-[9px] cursor-pointer hover:bg-brand-secondary/10 transition flex items-center justify-between ${
                                  selectedCountry === country.name ? "text-brand-secondary font-bold bg-brand-secondary/5" : "text-white/80 hover:text-white"
                                }`}
                              >
                                <span className="truncate">{country.name}</span>
                                <span className="text-[7px] font-mono text-brand-secondary/40 font-normal">{country.stationCount} st.</span>
                              </div>
                            ))
                        ) : (
                          <div className="p-4 text-center text-[9px] text-brand-secondary/30">No countries found.</div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
          </div>

          {/* Results & Recommendations List */}
          <div className="flex-grow min-h-0 min-w-0 overflow-hidden flex flex-col px-3 pb-4">
            

            {discoverTab === "recommendations" ? (
              searchResults.length > 0 ? (
                <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
                  <div className="flex justify-between items-center mb-2 px-2">
                    <span className="text-[8px] font-bold text-brand-secondary/60 tracking-widest uppercase">YouTube Results</span>
                    <button onClick={() => setSearchResults([])} className="text-[8px] hover:text-white transition uppercase tracking-widest text-brand-secondary/40 cursor-pointer">Clear</button>
                  </div>
                  <div className="flex-1 min-h-0 overflow-y-auto space-y-1 pr-1 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent custom-scrollbar">
                    {searchResults.map((track, i) => {
                      const trackGradient = getGhibliGradient(track.title);
                      return (
                        <div
                          key={i}
                          onClick={() => { playTrack(track.uri, track.title); setSearchResults([]); setSearchQuery(""); }}
                          className="p-2.5 rounded-xl border border-transparent hover:border-brand-secondary/20 hover:bg-white/5 cursor-pointer transition flex items-center justify-between group/s"
                        >
                          <div className="flex items-center gap-3 overflow-hidden pr-2">
                            <div className="w-7 h-7 rounded-lg overflow-hidden flex-shrink-0 shadow-md border border-white/5 relative bg-[#04080c] flex items-center justify-center">
                              {getTrackThumbnail(track) ? (
                                <img
                                  src={getTrackThumbnail(track)!}
                                  alt=""
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <div className={`w-full h-full bg-gradient-to-tr ${trackGradient} flex items-center justify-center`}>
                                  <Radio className="w-3 h-3 text-white/80" />
                                </div>
                              )}
                            </div>
                            <div className="truncate">
                              <h4 className="text-[10px] font-bold truncate text-white leading-tight group-hover/s:text-brand-secondary transition">{track.title}</h4>
                              <span className="text-[8px] text-brand-secondary/40 block mt-0.5 truncate">{track.author}</span>
                            </div>
                          </div>
                          <Play className="w-3.5 h-3.5 text-brand-secondary opacity-0 group-hover/s:opacity-100 transition-opacity flex-shrink-0" />
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
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
                  <div className="flex-1 min-h-0 overflow-y-auto space-y-1 pr-1 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent custom-scrollbar">
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
                            onClick={() => playTrack(track.uri, track.title)}
                            className="p-2.5 rounded-xl border border-transparent hover:border-brand-secondary/20 hover:bg-white/5 cursor-pointer transition flex items-center justify-between group/rec"
                          >
                            <div className="flex items-center gap-3 overflow-hidden pr-2">
                              <div className="w-7 h-7 rounded-lg overflow-hidden flex-shrink-0 shadow-md border border-white/5 relative bg-[#04080c] flex items-center justify-center">
                                {getTrackThumbnail(track) ? (
                                  <img
                                    src={getTrackThumbnail(track)!}
                                    alt=""
                                    className="w-full h-full object-cover"
                                  />
                                ) : (
                                  <div className={`w-full h-full bg-gradient-to-tr ${trackGradient} flex items-center justify-center`}>
                                    <Radio className="w-3 h-3 text-white/80" />
                                  </div>
                                )}
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
              )
            ) : discoverTab === "radio" ? (
              radioSearchResults.length > 0 ? (
                <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
                  <div className="flex justify-between items-center mb-2 px-2">
                    <span className="text-[8px] font-bold text-brand-secondary/60 tracking-widest uppercase">Radio Results</span>
                    <button onClick={() => setRadioSearchResults([])} className="text-[8px] hover:text-white transition uppercase tracking-widest text-brand-secondary/40 cursor-pointer">Clear</button>
                  </div>
                  <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5 pr-1 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent custom-scrollbar">
                    {radioSearchResults.map((station, i) => {
                      const trackGradient = getGhibliGradient(station.name);
                      return (
                        <div
                          key={i}
                          onClick={() => { playRadio(station.url, station.name, station.tags || 'Global Radio', station.favicon); setRadioSearchResults([]); setSearchQuery(""); }}
                          className="p-2.5 rounded-xl border border-transparent hover:border-brand-secondary/20 hover:bg-white/5 cursor-pointer transition flex items-center justify-between group/rs"
                        >
                          <div className="flex items-center gap-3 overflow-hidden pr-2">
                            {station.favicon ? (
                              <img 
                                src={station.favicon} 
                                alt="" 
                                onError={(e) => { e.currentTarget.style.display = 'none'; }}
                                className="w-8 h-8 rounded-lg object-cover bg-white/5 flex-shrink-0"
                              />
                            ) : (
                              <div className={`w-8 h-8 rounded-lg bg-gradient-to-tr ${trackGradient} flex-shrink-0 flex items-center justify-center shadow-md relative group-hover/rs:scale-105 transition-transform duration-300`}>
                                <Radio className="w-3.5 h-3.5 text-white/80" />
                              </div>
                            )}
                            <div className="truncate">
                              <div className="flex items-center gap-1.5">
                                <span className="text-[10px] font-bold text-white block truncate leading-tight group-hover/rs:text-brand-secondary transition">{station.name}</span>
                                <span className="text-[6px] font-bold px-1 py-0.5 rounded bg-brand-secondary/15 text-brand-secondary uppercase flex-shrink-0">{station.country || 'Global'}</span>
                              </div>
                              <span className="text-[8px] text-brand-secondary/40 block mt-1 truncate">{station.tags || 'Live Stream'}</span>
                            </div>
                          </div>
                          <Play className="w-3.5 h-3.5 text-brand-secondary opacity-0 group-hover/rs:opacity-100 transition-opacity flex-shrink-0" />
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
                  <div className="flex justify-between items-center mb-2 px-2 flex-shrink-0">
                    <span className="text-[8px] font-bold text-brand-secondary/60 tracking-widest uppercase">Popular Stations</span>
                    <button 
                      onClick={fetchRecommendedRadio} 
                      disabled={isRecommendedRadioLoading}
                      className="text-[8px] hover:text-white transition uppercase tracking-widest text-brand-secondary/40 disabled:opacity-50 cursor-pointer"
                    >
                      {isRecommendedRadioLoading ? "Refreshing..." : "↻ Refresh"}
                    </button>
                  </div>
                  <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5 pr-1 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent custom-scrollbar">
                    {isRecommendedRadioLoading ? (
                      /* Shimmer Loading Skeleton */
                      Array.from({ length: 5 }).map((_, idx) => (
                        <div key={idx} className="p-2.5 rounded-xl border border-white/5 bg-[#0b141d]/10 animate-pulse flex items-center justify-between">
                          <div className="flex items-center gap-3 w-full pr-2">
                            <div className="w-8 h-8 rounded-lg bg-zinc-800/40 flex-shrink-0 animate-pulse" />
                            <div className="space-y-1.5 flex-grow">
                              <div className="h-2.5 bg-zinc-800/60 rounded w-1/3 animate-pulse" />
                              <div className="h-2 bg-zinc-800/30 rounded w-2/3 animate-pulse" />
                            </div>
                          </div>
                        </div>
                      ))
                    ) : recommendedRadioStations.length > 0 ? (
                      recommendedRadioStations.map((station, i) => {
                        const trackGradient = getGhibliGradient(station.name);
                        return (
                          <div
                            key={i}
                            onClick={() => playRadio(station.url, station.name, station.tags || 'Recommended FM', station.favicon)}
                            className="p-2.5 rounded-xl border border-white/5 hover:border-brand-secondary/20 bg-[#0b141d]/30 hover:bg-white/5 cursor-pointer transition flex items-center justify-between group/radio"
                          >
                            <div className="flex items-center gap-3 overflow-hidden pr-2">
                              {station.favicon ? (
                                <img 
                                  src={station.favicon} 
                                  alt="" 
                                  onError={(e) => { e.currentTarget.style.display = 'none'; }}
                                  className="w-8 h-8 rounded-lg object-cover bg-white/5 flex-shrink-0"
                                />
                              ) : (
                                <div className={`w-8 h-8 rounded-lg bg-gradient-to-tr ${trackGradient} flex-shrink-0 flex items-center justify-center shadow-md relative group-hover/radio:scale-105 transition-transform duration-300`}>
                                  <Radio className="w-3.5 h-3.5 text-white/80" />
                                </div>
                              )}
                              <div className="truncate">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[10px] font-bold text-white block truncate leading-tight group-hover/radio:text-brand-secondary transition">{station.name}</span>
                                  <span className="text-[6px] font-bold px-1 py-0.5 rounded bg-brand-secondary/15 text-brand-secondary uppercase flex-shrink-0">{station.country || 'Global'}</span>
                                </div>
                                <span className="text-[8px] text-brand-secondary/40 block mt-1 truncate">{station.tags || 'Live Stream'}</span>
                              </div>
                            </div>
                            <Play className="w-3.5 h-3.5 text-brand-secondary opacity-0 group-hover/radio:opacity-100 transition-opacity flex-shrink-0" />
                          </div>
                        );
                      })
                    ) : (
                      <div className="p-6 text-center text-[10px] font-mono text-brand-secondary/45 uppercase tracking-widest">
                        No popular radio streams found.
                      </div>
                    )}
                  </div>
                </div>
              )
            ) : (
              liveSearchResults.length > 0 ? (
                <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
                  <div className="flex justify-between items-center mb-2 px-2">
                    <span className="text-[8px] font-bold text-brand-secondary/60 tracking-widest uppercase">Live Results</span>
                    <button onClick={() => setLiveSearchResults([])} className="text-[8px] hover:text-white transition uppercase tracking-widest text-brand-secondary/40 cursor-pointer">Clear</button>
                  </div>
                  <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5 pr-1 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent custom-scrollbar">
                    {liveSearchResults.map((track, i) => {
                      const trackGradient = getGhibliGradient(track.title);
                      return (
                        <div
                          key={i}
                          onClick={() => { playRadio(track.uri, track.title, 'Live Atmosphere', getTrackThumbnail(track) || undefined); setLiveSearchResults([]); setSearchQuery(""); }}
                          className="p-2.5 rounded-xl border border-transparent hover:border-brand-secondary/20 hover:bg-white/5 cursor-pointer transition flex items-center justify-between group/ls"
                        >
                          <div className="flex items-center gap-3 overflow-hidden pr-2">
                            <div className={`w-8 h-8 rounded-lg bg-gradient-to-tr ${trackGradient} flex-shrink-0 flex items-center justify-center shadow-md relative group-hover/ls:scale-105 transition-transform duration-300`}>
                              <Activity className="w-3.5 h-3.5 text-white/80" />
                            </div>
                            <div className="truncate">
                              <span className="text-[10px] font-bold text-white block truncate leading-tight group-hover/ls:text-brand-secondary transition">{track.title}</span>
                              <span className="text-[8px] text-brand-secondary/40 block mt-1 truncate">{track.author}</span>
                            </div>
                          </div>
                          <Play className="w-3.5 h-3.5 text-brand-secondary opacity-0 group-hover/ls:opacity-100 transition-opacity flex-shrink-0" />
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
                  <div className="flex justify-between items-center mb-2 px-2 flex-shrink-0">
                    <span className="text-[8px] font-bold text-brand-secondary/60 tracking-widest uppercase">Popular Atmospheres</span>
                    <button 
                      onClick={fetchRecommendedLive} 
                      disabled={isRecommendedLiveLoading}
                      className="text-[8px] hover:text-white transition uppercase tracking-widest text-brand-secondary/40 disabled:opacity-50 cursor-pointer"
                    >
                      {isRecommendedLiveLoading ? "Refreshing..." : "↻ Refresh"}
                    </button>
                  </div>
                  <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5 pr-1 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent custom-scrollbar">
                    {isRecommendedLiveLoading ? (
                      /* Shimmer Loading Skeleton */
                      Array.from({ length: 5 }).map((_, idx) => (
                        <div key={idx} className="p-2.5 rounded-xl border border-white/5 bg-[#0b141d]/10 animate-pulse flex items-center justify-between">
                          <div className="flex items-center gap-3 w-full pr-2">
                            <div className="w-8 h-8 rounded-lg bg-zinc-800/40 flex-shrink-0 animate-pulse" />
                            <div className="space-y-1.5 flex-grow">
                              <div className="h-2.5 bg-zinc-800/60 rounded w-1/3 animate-pulse" />
                              <div className="h-2 bg-zinc-800/30 rounded w-2/3 animate-pulse" />
                            </div>
                          </div>
                        </div>
                      ))
                    ) : recommendedLiveAtmospheres.length > 0 ? (
                      recommendedLiveAtmospheres.map((live, i) => {
                        const trackGradient = getGhibliGradient(live.title);
                        const thumbnail = getTrackThumbnail({ uri: live.uri });
                        return (
                          <div
                            key={i}
                            onClick={() => playRadio(live.uri, live.title, live.type || 'Live Atmosphere', thumbnail || undefined)}
                            className="p-2.5 rounded-xl border border-white/5 hover:border-brand-secondary/20 bg-[#0b141d]/30 hover:bg-white/5 cursor-pointer transition flex items-center justify-between group/live"
                          >
                            <div className="flex items-center gap-3 overflow-hidden pr-2">
                              {thumbnail ? (
                                <img 
                                  src={thumbnail} 
                                  alt="" 
                                  onError={(e) => { e.currentTarget.style.display = 'none'; }}
                                  className="w-8 h-8 rounded-lg object-cover bg-white/5 flex-shrink-0 shadow-md relative group-hover/live:scale-105 transition-transform duration-300"
                                />
                              ) : (
                                <div className={`w-8 h-8 rounded-lg bg-gradient-to-tr ${trackGradient} flex-shrink-0 flex items-center justify-center shadow-md relative group-hover/live:scale-105 transition-transform duration-300`}>
                                  <Activity className="w-3.5 h-3.5 text-white/80" />
                                </div>
                              )}
                              <div className="truncate">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[10px] font-bold text-white block truncate leading-tight group-hover/live:text-brand-secondary transition">{live.title}</span>
                                  <span className="text-[6px] font-bold px-1 py-0.5 rounded bg-emerald-500/10 text-emerald-400 uppercase flex-shrink-0">{live.type || 'Live'}</span>
                                </div>
                                <span className="text-[8px] text-brand-secondary/40 block mt-1 truncate">{live.desc || live.author}</span>
                              </div>
                            </div>
                            <Play className="w-3.5 h-3.5 text-brand-secondary opacity-0 group-hover/live:opacity-100 transition-opacity flex-shrink-0" />
                          </div>
                        );
                      })
                    ) : (
                      <div className="p-6 text-center text-[10px] font-mono text-brand-secondary/45 uppercase tracking-widest">
                        No popular atmosphere streams found.
                      </div>
                    )}
                  </div>
                </div>
              )
            )}
          </div>
        </div>

        {/* CENTER PANE: Hero Stage */}
        <div className="flex-grow flex flex-col relative overflow-hidden min-h-0">
          <div className="w-full h-full bg-[#091118]/25 backdrop-blur-xl p-6 md:p-8 flex flex-col gap-6 relative overflow-y-auto scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent custom-scrollbar min-h-0">
            {/* Ambient Background Grid lines to look like mechanical casing */}
            <div className="absolute inset-0 bg-grid-white/[0.01] pointer-events-none" />
            <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-brand-secondary/20 to-transparent" />

            {/* Top row: VU Decibel Towers & OLED Backlit Spec Panel */}
            <div className="flex items-stretch justify-between gap-4 md:gap-6 select-none">
              
              {/* LEFT VU METER */}
              <div className="flex flex-col justify-between items-center w-5 bg-black/40 border border-white/5 rounded-md py-2 px-1 relative">
                <span className="text-[6px] font-mono text-brand-secondary/40 font-bold uppercase mb-1">L</span>
                <div className="flex-grow flex flex-col-reverse gap-0.5 justify-between w-full px-0.5 h-28">
                  {Array.from({ length: 12 }).map((_, idx) => {
                    const activeCount = isPlaying ? Math.min(12, Math.floor((volume / 100) * 12) + (Math.floor(Math.random() * 4) - 2)) : 0;
                    const isActive = idx < activeCount;
                    let colorClass = "bg-emerald-500/10 border-emerald-500/5";
                    if (isActive) {
                      if (idx >= 10) colorClass = "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)]";
                      else if (idx >= 7) colorClass = "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]";
                      else colorClass = "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]";
                    }
                    return (
                      <div
                        key={idx}
                        className={`w-full h-1.5 rounded-sm border transition-all duration-75 ${colorClass}`}
                      />
                    );
                  })}
                </div>
                <span className="text-[5px] font-mono text-brand-secondary/30 mt-1">dB</span>
              </div>

              {/* CENTRAL OLED DISPLAY */}
              <div className="flex-grow bg-[#03070b] border border-brand-secondary/15 rounded-2xl p-4 font-mono text-[9px] relative overflow-hidden flex flex-col justify-between min-h-[140px] shadow-inner">
                {/* CRT simulation */}
                <div className="absolute inset-0 bg-scanlines pointer-events-none opacity-[0.03]" />
                <div className="absolute inset-0 bg-gradient-to-b from-[#0c2528]/10 via-transparent to-[#0c2528]/10 pointer-events-none" />

                {/* Display Header */}
                <div className="flex items-center justify-between border-b border-brand-secondary/10 pb-1.5 z-10">
                  <div className="flex items-center gap-1.5">
                    <span className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-emerald-400 animate-pulse shadow-[0_0_6px_rgba(52,211,153,0.8)]' : 'bg-red-500'}`} />
                    <span className="text-brand-secondary/60 uppercase tracking-widest text-[7px] font-bold">SYSTEM ACTIVE</span>
                  </div>
                  <span className="text-brand-secondary/40 text-[7px] tracking-wider">LAVALINK v4.0.0</span>
                </div>

                {/* Main Content Area */}
                <div className="flex items-center justify-between py-2 gap-4 z-10">
                  {/* Left part: track title & specs */}
                  <div className="flex-grow overflow-hidden flex flex-col justify-center min-w-0">
                    <div className="text-[10px] text-white font-bold tracking-wider truncate mb-1">
                      {currentTrack ? currentTrack.title : "CONSOLE STANDBY"}
                    </div>
                    <div className="text-brand-secondary/60 text-[8px] truncate uppercase tracking-widest font-semibold">
                      {currentTrack ? (currentTrack.artist || "Unknown Artist") : "NO MEDIA LOADED"}
                    </div>
                    
                    {/* Live Waveform graphic */}
                    <div className="h-6 flex items-end gap-0.5 mt-3 overflow-hidden opacity-60">
                      {visualizerBars.map((bar, i) => {
                        const h = isPlaying ? bar.baseHeight : 3;
                        return (
                          <motion.div
                            key={i}
                            animate={{
                              height: isPlaying ? [h, h * (0.3 + Math.random() * 0.7), h] : 3
                            }}
                            transition={{
                              duration: 0.8 + Math.random() * 0.5,
                              repeat: Infinity,
                              ease: "easeInOut",
                              delay: bar.delay
                            }}
                            className="bg-brand-secondary/70 w-[2px] rounded-t-sm"
                            style={{ height: 3 }}
                          />
                        );
                      })}
                    </div>
                  </div>

                  {/* Right part: Vinyl Turntable Graphic */}
                  <div className="flex-shrink-0 flex items-center justify-center relative">
                    <motion.div
                      animate={isPlaying ? { rotate: 360 } : { rotate: 0 }}
                      transition={{ duration: 6, repeat: Infinity, ease: "linear" }}
                      className="w-16 h-16 rounded-full bg-gradient-to-r from-zinc-800 via-zinc-900 to-zinc-800 border-2 border-zinc-700/60 shadow-lg flex items-center justify-center relative"
                    >
                      {/* Vinyl Groove Rings */}
                      <div className="absolute inset-1 rounded-full border border-black/40" />
                      <div className="absolute inset-2.5 rounded-full border border-black/30" />
                      <div className="absolute inset-4 rounded-full border border-black/25" />
                      
                      {/* Album art thumbnail fallback / center label */}
                      <div className="w-5 h-5 rounded-full bg-brand-secondary flex items-center justify-center border border-black/40 z-10 overflow-hidden shadow-inner">
                        {currentTrack && getTrackThumbnail(currentTrack) ? (
                          <img
                            src={getTrackThumbnail(currentTrack)!}
                            alt=""
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-1.5 h-1.5 rounded-full bg-black" />
                        )}
                      </div>
                      
                      {/* Vinyl reflection overlay */}
                      <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-white/5 via-transparent to-white/5 pointer-events-none" />
                    </motion.div>
                  </div>
                </div>

                {/* Footer metrics strip */}
                <div className="flex justify-between items-center border-t border-brand-secondary/10 pt-1.5 text-[7px] text-brand-secondary/40 font-bold z-10">
                  <div className="flex gap-3">
                    <span>BITRATE: <span className="text-white">128 KBPS</span></span>
                    <span>SIGNAL: <span className="text-emerald-400">99.8%</span></span>
                  </div>
                  <span>LATENCY: <span className="text-brand-secondary">16ms</span></span>
                </div>
              </div>

              {/* RIGHT VU METER */}
              <div className="flex flex-col justify-between items-center w-5 bg-black/40 border border-white/5 rounded-md py-2 px-1 relative">
                <span className="text-[6px] font-mono text-brand-secondary/40 font-bold uppercase mb-1">R</span>
                <div className="flex-grow flex flex-col-reverse gap-0.5 justify-between w-full px-0.5 h-28">
                  {Array.from({ length: 12 }).map((_, idx) => {
                    const activeCount = isPlaying ? Math.min(12, Math.floor((volume / 100) * 12) + (Math.floor(Math.random() * 4) - 2)) : 0;
                    const isActive = idx < activeCount;
                    let colorClass = "bg-emerald-500/10 border-emerald-500/5";
                    if (isActive) {
                      if (idx >= 10) colorClass = "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)]";
                      else if (idx >= 7) colorClass = "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]";
                      else colorClass = "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]";
                    }
                    return (
                      <div
                        key={idx}
                        className={`w-full h-1.5 rounded-sm border transition-all duration-75 ${colorClass}`}
                      />
                    );
                  })}
                </div>
                <span className="text-[5px] font-mono text-brand-secondary/30 mt-1">dB</span>
              </div>

            </div>

            {/* Row 2: Tactical Analog EQ Rotary Knobs & Sliding Master Volume */}
            <div className="flex flex-col gap-5 bg-black/20 border border-white/5 rounded-2xl p-4 md:p-5 select-none">
              
              {/* Row 2A: Analog EQ Potentiometers */}
              <div className="grid grid-cols-2 gap-4 items-center justify-items-center">
                
                {/* BASS BOOST POTENTIOMETER */}
                <div className="flex flex-col items-center justify-center text-center">
                  <span className="text-[8px] font-bold text-brand-secondary/50 tracking-wider uppercase mb-2">BASS BOOST</span>
                  <button
                    onClick={() => applyFilter(bassBoost ? "clear" : "bassboost")}
                    disabled={!isPlaying}
                    className="relative cursor-pointer transition-transform duration-250 hover:scale-105 active:scale-95 group focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none"
                    title="Toggle High Impact Bass Boost"
                  >
                    <svg className="w-14 h-14 md:w-16 md:h-16 transform -rotate-90" viewBox="0 0 100 100">
                      <circle cx="50" cy="50" r="40" fill="transparent" stroke="#182836" strokeWidth="8" />
                      <circle
                        cx="50"
                        cy="50"
                        r="40"
                        fill="transparent"
                        stroke={bassBoost ? "#f59e0b" : "#c9b09a"}
                        strokeWidth="8"
                        strokeDasharray="251.2"
                        strokeDashoffset={bassBoost ? "62.8" : "188.4"}
                        strokeLinecap="round"
                        className="transition-all duration-500 ease-out"
                      />
                      <circle cx="50" cy="50" r="28" fill="#101c26" stroke="rgba(199,176,154,0.15)" strokeWidth="2" />
                      <line
                        x1="50" y1="22" x2="50" y2="34"
                        stroke={bassBoost ? "#f59e0b" : "#c9b09a"}
                        strokeWidth="4"
                        strokeLinecap="round"
                        transform={`rotate(${bassBoost ? 135 : -135} 50 50)`}
                        className="transition-transform duration-500 ease-out origin-[50px_50px]"
                      />
                    </svg>
                    <span className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2 h-2 rounded-full transition-all duration-300 ${
                      bassBoost ? "bg-amber-400 shadow-[0_0_10px_rgba(245,158,11,0.85)] scale-110" : "bg-transparent scale-0"
                    }`} />
                  </button>
                  <span className={`text-[7px] font-mono mt-2 tracking-widest uppercase transition-colors font-bold ${bassBoost ? 'text-amber-400' : 'text-brand-secondary/40'}`}>
                    {bassBoost ? "ACTIVE +12dB" : "BYPASS"}
                  </span>
                </div>

                {/* SPACE REVERB POTENTIOMETER */}
                <div className="flex flex-col items-center justify-center text-center">
                  <span className="text-[8px] font-bold text-brand-secondary/50 tracking-wider uppercase mb-2">SPACE REVERB</span>
                  <button
                    onClick={() => applyFilter(reverb ? "clear" : "reverb")}
                    disabled={!isPlaying}
                    className="relative cursor-pointer transition-transform duration-250 hover:scale-105 active:scale-95 group focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none"
                    title="Toggle Reverb Space Modulator"
                  >
                    <svg className="w-14 h-14 md:w-16 md:h-16 transform -rotate-90" viewBox="0 0 100 100">
                      <circle cx="50" cy="50" r="40" fill="transparent" stroke="#182836" strokeWidth="8" />
                      <circle
                        cx="50"
                        cy="50"
                        r="40"
                        fill="transparent"
                        stroke={reverb ? "#14b8a6" : "#c9b09a"}
                        strokeWidth="8"
                        strokeDasharray="251.2"
                        strokeDashoffset={reverb ? "62.8" : "188.4"}
                        strokeLinecap="round"
                        className="transition-all duration-500 ease-out"
                      />
                      <circle cx="50" cy="50" r="28" fill="#101c26" stroke="rgba(199,176,154,0.15)" strokeWidth="2" />
                      <line
                        x1="50" y1="22" x2="50" y2="34"
                        stroke={reverb ? "#14b8a6" : "#c9b09a"}
                        strokeWidth="4"
                        strokeLinecap="round"
                        transform={`rotate(${reverb ? 135 : -135} 50 50)`}
                        className="transition-transform duration-500 ease-out origin-[50px_50px]"
                      />
                    </svg>
                    <span className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2 h-2 rounded-full transition-all duration-300 ${
                      reverb ? "bg-teal-400 shadow-[0_0_10px_rgba(20,184,166,0.85)] scale-110" : "bg-transparent scale-0"
                    }`} />
                  </button>
                  <span className={`text-[7px] font-mono mt-2 tracking-widest uppercase transition-colors font-bold ${reverb ? 'text-teal-400' : 'text-brand-secondary/40'}`}>
                    {reverb ? "WET ROOM ON" : "BYPASS"}
                  </span>
                </div>

              </div>

              {/* Silk-screen console segment boundary line */}
              <div className="h-[1px] bg-gradient-to-r from-transparent via-brand-secondary/15 to-transparent" />

              {/* Row 2B: Master Volume Linear Fader */}
              <div className="flex flex-col items-center justify-center w-full px-2">
                <span className="text-[8px] font-bold text-brand-secondary/50 tracking-wider uppercase mb-3 flex items-center gap-1"><Volume2 className="w-3 h-3"/> VOLUME FADER</span>
                <div className="w-full flex items-center gap-2">
                  <span className="text-[7px] font-mono text-brand-secondary/45">MIN</span>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    disabled={!isPlaying}
                    value={isMuted ? 0 : volume}
                    onChange={(e) => setVolume(Number(e.target.value))}
                    className="flex-grow h-1.5 accent-brand-secondary bg-white/10 rounded-full cursor-pointer appearance-none outline-none transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                    style={{
                      background: `linear-gradient(to right, #c9b09a 0%, #c9b09a ${isMuted ? 0 : volume}%, rgba(255,255,255,0.1) ${isMuted ? 0 : volume}%, rgba(255,255,255,0.1) 100%)`
                    }}
                  />
                  <span className="text-[8px] font-mono text-brand-secondary/90 font-bold min-w-8 text-right">{isMuted ? "0" : volume}%</span>
                </div>
                <div className="flex justify-between w-full px-7 mt-1.5 text-[5px] font-mono text-brand-secondary/30">
                  <span>|</span><span>|</span><span>|</span><span>|</span><span>|</span>
                </div>
              </div>

            </div>

            {/* Row 3: 1U Rack DSP Presets Selectors */}
            <div className="flex flex-col gap-2 relative">
              {/* Monospace Spec Silk-Screen Header */}
              <div className="flex items-center justify-between px-1">
                <span className="text-[8px] font-bold text-brand-secondary/50 tracking-widest uppercase font-mono">
                  1U RACK-MOUNT ACTIVE DSP DECK // MODEL DSP-400X
                </span>
                <span className="text-[7px] font-mono text-brand-secondary/30 tracking-widest uppercase hidden sm:inline">
                  DYNAMIC AUDIO ROUTER
                </span>
              </div>

              {/* Physical Rack Chassis Mount Frame */}
              <div className="relative pl-6 pr-6 py-4 bg-gradient-to-b from-[#141d26] to-[#0c131a] border border-[#22313d]/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_10px_25px_rgba(0,0,0,0.65)] rounded-2xl overflow-hidden select-none">
                {/* Brushed metal/casing line overlay */}
                <div className="absolute inset-0 bg-grid-white/[0.01] pointer-events-none" />
                <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-white/5 to-transparent" />
                
                {/* Silk-screen dashed grid margin line */}
                <div className="absolute inset-y-1.5 left-5 right-5 border border-dashed border-[#22313d]/30 pointer-events-none rounded-lg" />

                {/* Left Bracket Ear with Mount Screws */}
                <div className="absolute left-0 top-0 bottom-0 w-[18px] bg-gradient-to-r from-[#18232e] to-[#0f171e] border-r border-[#22313d]/60 flex flex-col justify-between py-3 items-center">
                  <div className="w-2.5 h-2.5 rounded-full bg-gradient-to-tr from-zinc-600 via-zinc-400 to-zinc-700 border border-zinc-800 shadow-[0_1px_1px_rgba(255,255,255,0.1)] flex items-center justify-center relative" title="Chassis Mount Bolt">
                    <div className="w-1.5 h-[1px] bg-zinc-800 transform rotate-[45deg]" />
                  </div>
                  <div className="w-2.5 h-2.5 rounded-full bg-gradient-to-tr from-zinc-600 via-zinc-400 to-zinc-700 border border-zinc-800 shadow-[0_1px_1px_rgba(255,255,255,0.1)] flex items-center justify-center relative" title="Chassis Mount Bolt">
                    <div className="w-1.5 h-[1px] bg-zinc-800 transform rotate-[135deg]" />
                  </div>
                </div>

                {/* Right Bracket Ear with Mount Screws */}
                <div className="absolute right-0 top-0 bottom-0 w-[18px] bg-gradient-to-l from-[#18232e] to-[#0f171e] border-l border-[#22313d]/60 flex flex-col justify-between py-3 items-center">
                  <div className="w-2.5 h-2.5 rounded-full bg-gradient-to-tr from-zinc-600 via-zinc-400 to-zinc-700 border border-zinc-800 shadow-[0_1px_1px_rgba(255,255,255,0.1)] flex items-center justify-center relative" title="Chassis Mount Bolt">
                    <div className="w-1.5 h-[1px] bg-zinc-800 transform rotate-[30deg]" />
                  </div>
                  <div className="w-2.5 h-2.5 rounded-full bg-gradient-to-tr from-zinc-600 via-zinc-400 to-zinc-700 border border-zinc-800 shadow-[0_1px_1px_rgba(255,255,255,0.1)] flex items-center justify-center relative" title="Chassis Mount Bolt">
                    <div className="w-1.5 h-[1px] bg-zinc-800 transform rotate-[110deg]" />
                  </div>
                </div>

                {/* Main Selector Grid */}
                <div className="grid grid-cols-5 gap-3.5 px-1">
                  {[
                    { id: "nightcore", name: "Nightcore", chan: "CH-A", color: "purple", ledColor: "bg-purple-500 shadow-[0_0_12px_rgba(168,85,247,0.95)]" },
                    { id: "vaporwave", name: "Vaporwave", chan: "CH-B", color: "cyan", ledColor: "bg-cyan-500 shadow-[0_0_12px_rgba(6,182,212,0.95)]" },
                    { id: "8d", name: "8D Spatial", chan: "CH-C", color: "pink", ledColor: "bg-pink-500 shadow-[0_0_12px_rgba(236,72,153,0.95)]" },
                    { id: "lowpass", name: "Low Pass", chan: "CH-D", color: "yellow", ledColor: "bg-yellow-500 shadow-[0_0_12px_rgba(234,179,8,0.95)]" },
                    { id: "karaoke", name: "Karaoke", chan: "CH-E", color: "red", ledColor: "bg-red-500 shadow-[0_0_12px_rgba(239,68,68,0.95)]" },
                    { id: "tremolo", name: "Tremolo", chan: "CH-F", color: "orange", ledColor: "bg-orange-500 shadow-[0_0_12px_rgba(249,115,22,0.95)]" },
                    { id: "vibrato", name: "Vibrato", chan: "CH-G", color: "emerald", ledColor: "bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.95)]" },
                    { id: "bassboost", name: "Bass Boost", chan: "CH-H", color: "amber", ledColor: "bg-amber-500 shadow-[0_0_12px_rgba(245,158,11,0.95)]" },
                    { id: "reverb", name: "Reverb", chan: "CH-I", color: "teal", ledColor: "bg-teal-500 shadow-[0_0_12px_rgba(20,184,166,0.95)]" },
                    { id: "clear", name: "Bypass All", chan: "BYP", color: "slate", ledColor: "bg-red-500 shadow-[0_0_12px_rgba(239,68,68,0.95)]" }
                  ].map(dsp => {
                    const isActive = dsp.id === "clear"
                      ? (activeFilter === "clear" && !bassBoost && !reverb)
                      : (activeFilter === dsp.id || 
                         (dsp.id === "bassboost" && bassBoost) || 
                         (dsp.id === "reverb" && reverb));
                    return (
                      <div
                        key={dsp.id}
                        className="bg-[#05080c] border border-black p-1.5 rounded-xl shadow-[inset_0_2px_4px_rgba(0,0,0,0.85)] flex flex-col items-center justify-between min-h-[64px]"
                      >
                        {/* Tactile LED Light */}
                        <div className="flex items-center gap-1 mt-0.5">
                          <span className="text-[5px] font-mono font-bold text-brand-secondary/30 uppercase tracking-[0.1em]">{dsp.chan}</span>
                          <span className={`w-1.5 h-1.5 rounded-full border border-black/85 transition-all duration-300 ${
                            isActive ? `${dsp.ledColor} scale-110` : "bg-[#181d24] border-[#222933]/50 shadow-[inset_0_1px_1px_rgba(0,0,0,0.8)] scale-90"
                          }`} />
                        </div>

                        {/* Push Button Keycap */}
                        <button
                          onClick={() => {
                            if (dsp.id === "clear") {
                              applyFilter("clear");
                            } else {
                              const nextId = isActive ? "clear" : dsp.id;
                              applyFilter(nextId);
                            }
                          }}
                          disabled={!isPlaying}
                          className={`w-full py-1.5 px-0.5 rounded-lg text-center border font-bold text-[8.5px] font-mono tracking-wider uppercase select-none transition-all duration-150 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none ${
                            isActive
                              ? `bg-gradient-to-b from-[#223141] to-[#17222c] border-brand-secondary/50 text-white translate-y-[3px] shadow-[0_1px_0_#060a0f,inset_0_1px_2px_rgba(0,0,0,0.4),0_0_8px_rgba(199,176,154,0.15)]`
                              : `bg-gradient-to-b from-[#1b2631] to-[#121c25] border-[#293d50]/70 text-brand-secondary/65 hover:text-white shadow-[0_3.5px_0_#060a0f,0_4px_8px_rgba(0,0,0,0.5)] active:translate-y-[2px] active:shadow-[0_1.5px_0_#060a0f]`
                          }`}
                          style={{ WebkitTapHighlightColor: "transparent" }}
                        >
                          {dsp.name}
                        </button>
                      </div>
                    );
                  })}
                </div>

              </div>
            </div>



          </div>
        </div>

        {/* RIGHT PANE: Queue */}
        <div className={`w-[240px] xl:w-[260px] min-w-[240px] flex-shrink-0 border-l border-brand-secondary/10 flex-col bg-[#080d14]/90 backdrop-blur-xl transition-all duration-300 xl:flex h-full max-h-full min-h-0 min-w-0 ${
          isRightPaneOpen 
            ? "flex absolute inset-y-0 right-0 z-40 w-[260px] shadow-2xl" 
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
          
          <div className="flex-grow overflow-y-auto px-3 py-4 space-y-1.5 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent custom-scrollbar">
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
                    <div className="w-8 h-8 rounded-lg overflow-hidden flex-shrink-0 opacity-80 group-hover/item:opacity-100 transition border border-white/5 relative bg-[#04080c]">
                      {getTrackThumbnail(track) ? (
                        <img
                          src={getTrackThumbnail(track)!}
                          alt=""
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className={`w-full h-full bg-gradient-to-tr ${grad}`} />
                      )}
                    </div>
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
      <div className="h-24 flex-shrink-0 bg-[#080d14]/90 border-t border-brand-secondary/15 relative z-30 flex items-center px-4 md:px-8 gap-4 md:gap-8 backdrop-blur-xl">
        
        {/* Left: Quick Track Info */}
        <div className="flex w-[120px] xs:w-[150px] sm:w-[180px] md:w-[200px] xl:w-[280px] items-center gap-2 md:gap-3 overflow-hidden flex-shrink-0">
          {currentTrack ? (
             <>
               <div className="w-9 h-9 md:w-11 md:h-11 rounded-lg overflow-hidden flex-shrink-0 shadow-md border border-white/10 relative bg-[#04080c]">
                 {getTrackThumbnail(currentTrack) ? (
                   <img
                     src={getTrackThumbnail(currentTrack)!}
                     alt=""
                     className="w-full h-full object-cover"
                   />
                 ) : (
                   <div className={`w-full h-full bg-gradient-to-tr ${currentGradient}`} />
                 )}
               </div>
               <div className="overflow-hidden flex-grow min-w-0">
                  <MarqueeText text={currentTrack.title} className="text-[10px] md:text-xs font-bold text-white" />
                  <MarqueeText text={currentTrack.artist || "Discord Voice Stream"} className="text-[8px] md:text-[9px] text-brand-secondary/60 mt-0.5 uppercase tracking-wider block" />
               </div>
             </>
          ) : (
            <div className="text-[9px] md:text-[10px] text-brand-secondary/40 font-mono uppercase tracking-wider">Idle Console</div>
          )}
        </div>

        {/* Center: Playback Controls & Scrubber */}
        <div className="flex-grow flex flex-col items-center justify-center max-w-2xl mx-auto w-full">
          <div className={`flex items-center gap-4 sm:gap-6 ${isIcecastRadio || isLiveStream ? "" : "mb-2"}`}>
            <motion.button 
              onClick={() => {
                const nextMode = loopModeState === "off" ? "track" : loopModeState === "track" ? "queue" : "off";
                setLoopModeState(nextMode); setLoopMode(nextMode);
              }} 
              whileHover={{ scale: 1.15 }}
              whileTap={{ scale: 0.95 }}
              className={`relative p-2 cursor-pointer transition-colors ${loopModeState !== "off" ? "text-brand-secondary" : "text-brand-secondary/40 hover:text-white"}`}
            >
              <Repeat className="w-4 h-4" />
              {loopModeState !== "off" && <span className="absolute text-[7px] font-bold -top-0.5 -right-0.5 bg-brand-primary text-white w-3 h-3 rounded-full flex items-center justify-center scale-90">{loopModeState === "track" ? "1" : "Q"}</span>}
            </motion.button>
            <motion.button 
              onClick={stopTrack} 
              whileHover={{ scale: 1.15 }}
              whileTap={{ scale: 0.95 }}
              className="p-2 text-brand-secondary/70 hover:text-white transition-colors cursor-pointer"
            >
              <Square className="w-4 h-4 fill-current" />
            </motion.button>
            
            <motion.button 
              onClick={togglePlay} 
              disabled={isActionPending || isPlaybackLoading}
              whileHover={{ scale: 1.15 }}
              whileTap={{ scale: 0.95 }}
              className="w-10 h-10 rounded-full bg-white text-black flex items-center justify-center shadow-[0_0_15px_rgba(255,255,255,0.25)] cursor-pointer relative overflow-hidden disabled:opacity-85"
            >
              {(isActionPending || isPlaybackLoading) ? (
                <div className="w-4.5 h-4.5 rounded-full border-2 border-black/30 border-t-black animate-spin" />
              ) : (
                <AnimatePresence mode="wait" initial={false}>
                  {isPlaying ? (
                    <motion.div
                      key="pause"
                      initial={{ opacity: 0, rotate: -90, scale: 0.8 }}
                      animate={{ opacity: 1, rotate: 0, scale: 1 }}
                      exit={{ opacity: 0, rotate: 90, scale: 0.8 }}
                      transition={{ duration: 0.2 }}
                    >
                      <Pause className="w-4.5 h-4.5 fill-current text-black" />
                    </motion.div>
                  ) : (
                    <motion.div
                      key="play"
                      initial={{ opacity: 0, rotate: 90, scale: 0.8 }}
                      animate={{ opacity: 1, rotate: 0, scale: 1 }}
                      exit={{ opacity: 0, rotate: -90, scale: 0.8 }}
                      transition={{ duration: 0.2 }}
                      className="translate-x-0.5"
                    >
                      <Play className="w-4.5 h-4.5 fill-current text-black" />
                    </motion.div>
                  )}
                </AnimatePresence>
              )}
            </motion.button>
            
            <motion.button 
              onClick={skipTrack} 
              disabled={isActionPending}
              whileHover={{ scale: 1.15 }}
              whileTap={{ scale: 0.95 }}
              className="p-2 text-brand-secondary/70 hover:text-white transition-colors cursor-pointer relative disabled:opacity-50"
            >
              {isActionPending ? (
                <div className="w-4 h-4 rounded-full border border-brand-secondary/30 border-t-brand-secondary animate-spin" />
              ) : (
                <SkipForward className="w-4 h-4 fill-current" />
              )}
            </motion.button>
            <motion.button 
              onClick={toggleFavoriteTrack}
              whileHover={{ scale: 1.15 }}
              whileTap={{ scale: 0.95 }}
              className={`p-2 transition-colors cursor-pointer ${isFavorited ? "text-red-400" : "text-brand-secondary/40 hover:text-white"}`}
            >
              <Heart className={`w-4 h-4 ${isFavorited ? "fill-current" : ""}`} />
            </motion.button>

            {(isIcecastRadio || isLiveStream) && (
              <div className="flex items-center gap-2 select-none ml-2 flex-shrink-0">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500/70 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                </span>
                <span className="text-[9px] font-bold text-red-500 tracking-[0.25em] uppercase font-mono animate-pulse">LIVE</span>
              </div>
            )}
          </div>
          
          {!(isIcecastRadio || isLiveStream) && (
            <div className="w-full flex items-center gap-3">
              <span className="text-[9px] font-mono text-brand-secondary/60 w-8 text-right">{formatDuration(positionMs)}</span>
              <input 
                type="range" 
                min="0" 
                max={currentTrack?.duration || 1} 
                value={positionMs} 
                onChange={(e) => seekTrack(Number(e.target.value))} 
                className="flex-grow h-1 accent-brand-secondary bg-white/10 rounded-full cursor-pointer appearance-none outline-none focus:outline-none transition-all" 
                style={{
                  background: `linear-gradient(to right, #c9b09a 0%, #c9b09a ${(positionMs / (currentTrack?.duration || 1)) * 100}%, rgba(255,255,255,0.1) ${(positionMs / (currentTrack?.duration || 1)) * 100}%, rgba(255,255,255,0.1) 100%)`
                }}
              />
              <span className="text-[9px] font-mono text-brand-secondary/60 w-8">{currentTrack ? formatDuration(currentTrack.duration || 0) : "00:00"}</span>
            </div>
          )}
        </div>

        {/* Right: Volume & Audio Engine Toggle */}
        <div className="hidden md:flex w-[200px] xl:w-[280px] items-center justify-end gap-3.5 relative">
          <motion.button 
            onClick={toggleMute} 
            whileHover={{ scale: 1.15 }}
            whileTap={{ scale: 0.95 }}
            className="text-brand-secondary/60 hover:text-white transition-colors cursor-pointer"
          >
            <Volume2 className="w-4 h-4"/>
          </motion.button>
          <motion.input 
            type="range" 
            min="0" 
            max="100" 
            value={isMuted ? 0 : volume} 
            onChange={(e) => setVolume(Number(e.target.value))} 
            animate={{
              width: isMuted ? 0 : 96,
              opacity: isMuted ? 0.3 : 1
            }}
            transition={{ duration: 0.3, ease: "easeInOut" }}
            className="h-1 accent-white bg-white/20 rounded-full cursor-pointer origin-right overflow-hidden" 
          />
          <motion.button 
            onClick={() => setIsAudioEngineOpen(!isAudioEngineOpen)}
            whileHover={{ scale: 1.15 }}
            whileTap={{ scale: 0.95 }}
            className={`p-2 rounded-full transition-all border cursor-pointer ${
              isAudioEngineOpen || activeFilter !== "clear" 
                ? "bg-brand-secondary/20 border-brand-secondary/50 text-brand-secondary shadow-[0_0_12px_rgba(var(--brand-secondary-rgb),0.35)] scale-105" 
                : "bg-transparent border-transparent text-brand-secondary/60 hover:text-white hover:bg-white/10"
            }`}
          >
            <Settings2 className="w-4 h-4" />
          </motion.button>

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
                    { id: "clear", name: "Clear", desc: "No filters" }, 
                    { id: "nightcore", name: "Nightcore", desc: "Pitch & Fast" },
                    { id: "vaporwave", name: "Vaporwave", desc: "Slow Reverb" }, 
                    { id: "8d", name: "8D Audio", desc: "Rotational" },
                    { id: "karaoke", name: "Karaoke", desc: "No Vocals" }, 
                    { id: "tremolo", name: "Tremolo", desc: "Vol Osc" },
                    { id: "vibrato", name: "Vibrato", desc: "Pitch Osc" }, 
                    { id: "lowpass", name: "Low Pass", desc: "Muffled" },
                    { id: "bassboost", name: "Bass Boost", desc: "High EQ" },
                    { id: "reverb", name: "Space Reverb", desc: "Reverb Space" }
                  ].map(filter => {
                    const isActive = activeFilter === filter.id || 
                      (filter.id === "bassboost" && bassBoost) || 
                      (filter.id === "reverb" && reverb);
                    return (
                      <motion.button
                        key={filter.id}
                        onClick={() => {
                          const nextId = isActive ? "clear" : filter.id;
                          applyFilter(nextId);
                        }}
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        className={`p-2.5 rounded-xl border transition-all text-left flex flex-col justify-center cursor-pointer ${
                          isActive ? "bg-brand-secondary/15 border-brand-secondary/50 shadow-inner" : "bg-black/30 border-white/5 hover:border-brand-secondary/30 hover:bg-white/5"
                        }`}
                      >
                        <span className={`text-[10px] font-bold uppercase tracking-wider ${isActive ? "text-brand-secondary" : "text-white"}`}>{filter.name}</span>
                        <span className={`text-[8px] font-mono uppercase tracking-widest ${isActive ? "text-brand-secondary/80" : "text-brand-secondary/40"}`}>{filter.desc}</span>
                      </motion.button>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>


        </div>

      </div>
    </div>
  );
}
