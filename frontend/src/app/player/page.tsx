"use client";

import Image from "next/image";
import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Music, Coins, Gamepad2, LogOut, Loader2, ChevronDown, Search, Server, ShieldCheck, Settings2 } from "lucide-react";
import { useDashboard, Guild } from "../../hooks/use-dashboard";
import { MusicDeck } from "@/features/music";
import { EconomyDeck } from "@/features/economy";
import { GamesDeck } from "@/features/games";
import { SettingsDeck } from "@/features/settings";

export default function DashboardPage() {
  const { 
    activeTab, 
    setActiveTab, 
    isLoading, 
    logout, 
    guilds, 
    selectedGuild, 
    selectGuild
  } = useDashboard();

  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#04080c] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-brand-secondary animate-spin" />
      </div>
    );
  }

  const navItems = [
    { id: "music", label: "Music Deck", icon: Music },
    { id: "economy", label: "Server Economy", icon: Coins },
    { id: "games", label: "Guild Games", icon: Gamepad2 },
    { id: "settings", label: "Server Settings", icon: Settings2 },
  ] as const;

  // Filter guilds based on search query
  const filteredGuilds = (guilds || []).filter((guild) =>
    guild.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="min-h-screen w-full bg-[#04080c] text-white font-sans flex flex-col relative overflow-x-hidden selection:bg-brand-primary selection:text-white">
      {/* Background Decor (Minimalist flat aesthetic) */}
      <div className="absolute top-0 right-0 w-[800px] h-[800px] bg-brand-primary/5 rounded-full blur-[150px] pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-[600px] h-[600px] bg-brand-secondary/5 rounded-full blur-[120px] pointer-events-none" />

      {/* Top Navbar */}
      <header className="w-full border-b border-white/5 bg-[#0b141d]/80 backdrop-blur-xl relative z-50">
        <div className="max-w-[1600px] mx-auto px-6 h-20 flex items-center justify-between">
          
          {/* Logo Section */}
          <div className="flex items-center gap-4">
            <Image
              src="/logo.svg"
              alt="Yuugen Logo"
              width={32}
              height={32}
              className="flex-shrink-0 animate-[spin_10s_linear_infinite]"
            />
            <div className="flex items-baseline gap-1.5 select-none">
              <span className="text-xl font-bold tracking-widest text-brand-secondary font-serif uppercase">Yuugen</span>
              <span className="text-xs font-light tracking-widest text-white/40 uppercase hidden lg:block">Console</span>
            </div>
          </div>

          {/* Centered Navigation */}
          <nav className="hidden md:flex items-center gap-2">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id as any)}
                  className={`
                    relative px-5 py-2.5 flex items-center gap-2.5 rounded-lg transition-all duration-300
                    ${isActive ? "text-brand-secondary bg-brand-secondary/10" : "text-white/50 hover:text-white hover:bg-white/5"}
                  `}
                >
                  <Icon className="w-4 h-4" />
                  <span className="text-xs font-semibold tracking-widest uppercase">{item.label}</span>
                  {isActive && (
                    <motion.div
                      layoutId="active-tab-indicator"
                      className="absolute bottom-0 left-3 right-3 h-[2px] bg-brand-secondary rounded-t-full"
                      initial={false}
                      transition={{ type: "spring", stiffness: 400, damping: 30 }}
                    />
                  )}
                </button>
              );
            })}
          </nav>

          {/* Right Section: Searchable Guild Select + Logout */}
          <div className="flex items-center gap-4">
            
            {/* Searchable Guild Selector */}
            {selectedGuild && (
              <div className="relative" ref={dropdownRef}>
                <button
                  onClick={() => {
                    setIsDropdownOpen(!isDropdownOpen);
                    setSearchQuery("");
                  }}
                  className="flex items-center gap-3 px-4 py-2 bg-[#101c26]/60 border border-brand-secondary/10 hover:border-brand-secondary/35 rounded-xl transition duration-250 select-none text-left"
                >
                  {/* Server Avatar Custom Circle */}
                  <div className="w-6 h-6 rounded-lg bg-brand-primary/10 border border-brand-primary/30 flex items-center justify-center text-brand-secondary text-[10px] font-bold uppercase overflow-hidden">
                    {(selectedGuild as any).iconURL ? (
                      <img src={(selectedGuild as any).iconURL} alt="" className="w-full h-full object-cover" />
                    ) : (
                      selectedGuild.name.charAt(0)
                    )}
                  </div>
                  
                  {/* Server Name / Status details */}
                  <div className="hidden sm:flex flex-col">
                    <span className="text-[10px] font-bold text-white uppercase tracking-wider truncate max-w-[100px]">
                      {selectedGuild.name}
                    </span>
                    <span className="text-[8px] text-brand-secondary/50 font-light flex items-center gap-1">
                      <span className={`w-1 h-1 rounded-full ${selectedGuild.isActive ? "bg-emerald-500" : "bg-neutral-600"}`} />
                      <span>{selectedGuild.isActive ? "Link Active" : "Disconnected"}</span>
                    </span>
                  </div>

                  <ChevronDown className={`w-3.5 h-3.5 text-brand-secondary/60 transition-transform duration-200 ${isDropdownOpen ? "rotate-180" : ""}`} />
                </button>

                {/* Dropdown Menu Box */}
                <AnimatePresence>
                  {isDropdownOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: 10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 10, scale: 0.95 }}
                      transition={{ duration: 0.15 }}
                      className="absolute right-0 top-full mt-2 w-72 bg-[#0b141d] border border-brand-secondary/15 rounded-2xl p-4 shadow-xl z-50"
                    >
                      {/* Search input field */}
                      <div className="relative mb-3">
                        <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-brand-secondary/40" />
                        <input
                          type="text"
                          placeholder="Search servers..."
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          className="w-full bg-[#04080c] border border-brand-secondary/10 rounded-xl pl-9 pr-3 py-2 text-[10px] font-light text-white placeholder-brand-secondary/30 focus:outline-none focus:border-brand-secondary/45 transition"
                        />
                      </div>

                      {/* Guilds Selection List */}
                      <div className="max-h-60 overflow-y-auto space-y-1.5 pr-1 custom-scrollbar">
                        {filteredGuilds.length > 0 ? (
                          filteredGuilds.map((guild) => {
                            const isSelected = guild.id === selectedGuild.id;
                            return (
                              <button
                                key={guild.id}
                                onClick={() => {
                                  selectGuild(guild);
                                  setIsDropdownOpen(false);
                                }}
                                className={`w-full flex items-center justify-between p-2.5 rounded-xl border text-left transition duration-200 ${
                                  isSelected 
                                    ? "bg-brand-secondary/10 border-brand-secondary/25" 
                                    : "bg-transparent border-transparent hover:bg-white/5 hover:border-white/5"
                                }`}
                              >
                                <div className="flex items-center gap-3">
                                  <div className="w-7 h-7 rounded-lg bg-brand-primary/15 border border-brand-primary/25 flex items-center justify-center text-brand-secondary text-xs font-bold uppercase overflow-hidden">
                                    {(guild as any).iconURL ? (
                                      <img src={(guild as any).iconURL} alt="" className="w-full h-full object-cover" />
                                    ) : (
                                      guild.name.charAt(0)
                                    )}
                                  </div>
                                  <div className="flex flex-col">
                                    <span className="text-[10px] font-bold text-white uppercase tracking-wider">
                                      {guild.name}
                                    </span>
                                    <span className="text-[8px] text-brand-secondary/40 font-mono mt-0.5 uppercase">
                                      {guild.memberCount} Members
                                    </span>
                                  </div>
                                </div>

                                {/* Active Bot Status Check indicator */}
                                {guild.isActive && (
                                  <ShieldCheck className="w-3.5 h-3.5 text-brand-secondary/80" />
                                )}
                              </button>
                            );
                          })
                        ) : (
                          <div className="py-6 text-center text-[10px] text-brand-secondary/40 font-light select-none">
                            No active servers found.
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}

            {/* Logout button */}
            <button 
              onClick={logout}
              className="px-4 py-2 flex items-center gap-2 text-xs font-semibold tracking-widest text-white/50 hover:text-red-400 transition-colors uppercase group"
            >
              <LogOut className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
              <span className="hidden sm:block">Disconnect</span>
            </button>

          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className={`flex-1 w-full relative z-30 flex flex-col ${activeTab === 'music' ? '' : 'max-w-[1600px] mx-auto px-6 py-8 md:py-10'}`}>
        {/* Mobile Navigation (Shown only on small screens) */}
        <nav className={`md:hidden flex items-center justify-between mb-8 pb-4 border-b border-white/5 ${activeTab === 'music' ? 'px-6 pt-4' : ''}`}>
           {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id as any)}
                  className={`flex flex-col items-center gap-1.5 p-2 ${isActive ? "text-brand-secondary" : "text-white/50"}`}
                >
                  <Icon className="w-5 h-5" />
                  <span className="text-[9px] font-bold tracking-widest uppercase">{item.label.split(' ')[1]}</span>
                </button>
              );
            })}
        </nav>

        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="flex-1 w-full flex flex-col"
          >
            {activeTab === "music" && <MusicDeck selectedGuild={selectedGuild} />}
            {activeTab === "economy" && <EconomyDeck selectedGuildId={selectedGuild?.id} />}
            {activeTab === "games" && <GamesDeck selectedGuildId={selectedGuild?.id} />}
            {activeTab === "settings" && (
              <SettingsDeck selectedGuild={selectedGuild} />
            )}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}
