// src/features/economy/components/EconomyDeck.tsx
"use client";

import { useState } from "react";
import { Coins, Shield, Award, Briefcase, Skull, Star, AlertCircle, ShoppingBag, Trophy, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useEconomy } from "../hooks/useEconomy";

interface EconomyDeckProps {
  selectedGuildId?: string;
}

export function EconomyDeck({ selectedGuildId }: EconomyDeckProps) {
  const {
    profile,
    shopItems,
    leaderboard,
    isLoading,
    isActionLoading,
    error,
    feedbackMessage,
    setFeedbackMessage,
    claimDailyReward,
    doWork,
    commitCrime,
    rollDice,
    purchaseItem,
  } = useEconomy(selectedGuildId);

  const [gambleAmount, setGambleAmount] = useState<number>(10);

  if (isLoading || !profile) {
    return (
      <div className="w-full min-h-[400px] flex flex-col items-center justify-center border border-brand-secondary/10 bg-[#080d14]/90 backdrop-blur-xl rounded-3xl p-12 text-center">
        <Loader2 className="w-8 h-8 text-brand-secondary animate-spin mb-4" />
        <span className="text-xs text-brand-secondary/60 uppercase tracking-widest font-semibold">Tuning Wallet Connection...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full min-h-[400px] flex flex-col items-center justify-center border border-red-500/10 bg-[#1d0b0b]/60 rounded-3xl p-12 text-center text-red-400">
        <AlertCircle className="w-8 h-8 mb-4 text-red-500" />
        <span className="text-xs font-mono uppercase tracking-wider">{error}</span>
      </div>
    );
  }

  // Safe Gamble bet limit
  const maxBet = Math.min(profile.coins, 1000);

  return (
    <div className="w-full flex flex-col gap-8">
      {/* 1. TYPOGRAPHIC LEDGER CARD (Top profile panel) */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        
        {/* Level and XP */}
        <div className="bg-[#080d14]/90 backdrop-blur-xl border border-brand-secondary/10 p-6 rounded-3xl flex flex-col justify-between">
          <div className="flex items-center justify-between text-brand-secondary">
            <span className="text-[10px] font-bold tracking-widest uppercase">Guild Level</span>
            <Shield className="w-4 h-4 text-brand-secondary" />
          </div>
          <div className="mt-4">
            <span className="text-4xl font-serif font-normal text-white">{profile.level}</span>
            <div className="w-full h-1 bg-[#04080c] border border-white/5 rounded-full mt-3 overflow-hidden">
              <div 
                className="h-full bg-brand-secondary rounded-full" 
                style={{ width: `${Math.min(100, (profile.xp / (profile.level * 100)) * 100)}%` }}
              />
            </div>
            <div className="flex justify-between text-[9px] text-brand-secondary/50 font-mono mt-1.5 uppercase">
              <span>XP: {profile.xp}</span>
              <span>Next: {profile.level * 100}</span>
            </div>
          </div>
        </div>

        {/* Wallet Balance */}
        <div className="bg-[#080d14]/90 backdrop-blur-xl border border-brand-secondary/10 p-6 rounded-3xl flex flex-col justify-between">
          <div className="flex items-center justify-between text-brand-secondary">
            <span className="text-[10px] font-bold tracking-widest uppercase">Wallet Cash</span>
            <Coins className="w-4 h-4 text-brand-secondary" />
          </div>
          <div className="mt-4">
            <div className="flex items-baseline gap-1">
              <span className="text-4xl font-serif font-normal text-white">{profile.coins}</span>
              <span className="text-xs text-brand-secondary/70 font-semibold tracking-wider uppercase">Coins</span>
            </div>
            <span className="text-[9px] text-brand-secondary/40 font-light mt-3 block tracking-wide">Ready for trades & purchases</span>
          </div>
        </div>

        {/* Bank Savings */}
        <div className="bg-[#080d14]/90 backdrop-blur-xl border border-brand-secondary/10 p-6 rounded-3xl flex flex-col justify-between">
          <div className="flex items-center justify-between text-brand-secondary">
            <span className="text-[10px] font-bold tracking-widest uppercase">Bank Deposits</span>
            <Coins className="w-4 h-4 opacity-50" />
          </div>
          <div className="mt-4">
            <div className="flex items-baseline gap-1">
              <span className="text-4xl font-serif font-normal text-white">{profile.bank}</span>
              <span className="text-xs text-white/30 font-semibold tracking-wider uppercase">Coins</span>
            </div>
            <span className="text-[9px] text-brand-secondary/40 font-light mt-3 block tracking-wide">Protected from active server rob operations</span>
          </div>
        </div>

        {/* Total Net Worth */}
        <div className="bg-[#080d14]/90 backdrop-blur-xl border border-brand-secondary/10 p-6 rounded-3xl flex flex-col justify-between">
          <div className="flex items-center justify-between text-brand-secondary">
            <span className="text-[10px] font-bold tracking-widest uppercase">Net Worth</span>
            <Award className="w-4 h-4 text-brand-secondary" />
          </div>
          <div className="mt-4">
            <div className="flex items-baseline gap-1">
              <span className="text-4xl font-serif font-normal text-white">{profile.coins + profile.bank}</span>
              <span className="text-xs text-brand-secondary/70 font-semibold tracking-wider uppercase">Coins</span>
            </div>
            <span className="text-[9px] text-brand-secondary/40 font-light mt-3 block tracking-wide">Rankings are evaluated on net assets</span>
          </div>
        </div>
      </div>

      {/* 2. REAL-TIME ACTIVITY MESSAGE STATUS */}
      <AnimatePresence mode="wait">
        {feedbackMessage && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className={`p-4 rounded-xl border flex items-start gap-3 relative overflow-hidden ${
              feedbackMessage.success 
                ? "bg-[#0b1d15] border-emerald-500/25 text-emerald-400" 
                : "bg-[#1d0b0b] border-red-500/25 text-red-400"
            }`}
          >
            <AlertCircle className="w-4.5 h-4.5 flex-shrink-0 mt-0.5" />
            <div className="flex-grow text-xs font-light leading-relaxed">
              {feedbackMessage.text}
            </div>
            <button 
              onClick={() => setFeedbackMessage(null)}
              className="text-[9px] font-mono hover:underline uppercase flex-shrink-0 tracking-wider font-semibold ml-4"
            >
              Clear
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 3. MIDDLE PANEL: ACTIVITIES BOARD & GAMBLE STATION */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
        
        {/* Core Actions Grid */}
        <div className="lg:col-span-7 bg-[#080d14]/90 backdrop-blur-xl border border-brand-secondary/10 p-6 rounded-3xl flex flex-col justify-between">
          <div>
            <h3 className="text-xs font-bold tracking-widest text-brand-secondary uppercase border-b border-brand-secondary/10 pb-3 flex items-center gap-2 mb-6">
              <Briefcase className="w-4 h-4" />
              <span>Guild Activities Panel</span>
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Work Button */}
              <button 
                onClick={doWork}
                disabled={isActionLoading}
                className="group flex flex-col justify-between items-start text-left p-5 bg-[#0b141d] border border-brand-secondary/10 hover:border-brand-secondary/35 rounded-2xl transition duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div className="p-2.5 rounded-lg bg-brand-primary/10 border border-brand-primary/20 text-brand-secondary group-hover:scale-105 transition">
                  <Briefcase className="w-4.5 h-4.5" />
                </div>
                <div className="mt-8">
                  <span className="text-xs font-bold text-white tracking-widest uppercase block mb-1">Apply for Work</span>
                  <span className="text-[10px] text-brand-secondary/60 font-light leading-relaxed block">
                    Earn 50 to 100 gold coins per hour in random administrative server roles.
                  </span>
                </div>
              </button>

              {/* Crime Button */}
              <button 
                onClick={commitCrime}
                disabled={isActionLoading}
                className="group flex flex-col justify-between items-start text-left p-5 bg-[#0b141d] border border-brand-secondary/10 hover:border-red-500/35 rounded-2xl transition duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div className="p-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 group-hover:scale-105 transition">
                  <Skull className="w-4.5 h-4.5" />
                </div>
                <div className="mt-8">
                  <span className="text-xs font-bold text-white tracking-widest uppercase block mb-1">Pull off a Crime</span>
                  <span className="text-[10px] text-brand-secondary/60 font-light leading-relaxed block">
                    High risk, high yield. Earn up to 500 coins or pay hefty fines to the server guard.
                  </span>
                </div>
              </button>
            </div>
          </div>

          {/* Daily reward claim block */}
          <div className="mt-6 pt-6 border-t border-brand-secondary/10 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div>
              <span className="text-xs font-bold text-white uppercase tracking-wider block">Daily Coin Distribution</span>
              <span className="text-[9px] text-brand-secondary/60 font-light mt-0.5 block">Claim 100 free server coins every 24 hours.</span>
            </div>
            <button
              onClick={claimDailyReward}
              disabled={isActionLoading}
              className="px-6 py-2.5 bg-brand-secondary hover:bg-white disabled:bg-brand-secondary/30 disabled:text-[#04080c]/50 text-[#04080c] font-bold rounded-xl text-xs tracking-wider uppercase transition active:scale-98 flex items-center gap-2 disabled:cursor-not-allowed"
            >
              <Star className="w-3.5 h-3.5" />
              <span>Claim Daily</span>
            </button>
          </div>
        </div>

        {/* Gamble Station */}
        <div className="lg:col-span-5 bg-[#080d14]/90 backdrop-blur-xl border border-brand-secondary/10 p-6 rounded-3xl flex flex-col justify-between">
          <div>
            <h3 className="text-xs font-bold tracking-widest text-brand-secondary uppercase border-b border-brand-secondary/10 pb-3 flex items-center gap-2 mb-6">
              <Star className="w-4 h-4" />
              <span>Dice Gamble Arena</span>
            </h3>

            <p className="text-[10px] text-brand-secondary/60 leading-relaxed font-light mb-6">
              Double or nothing bet. Roll a 50/50 probability against the console core. Maximum bet is limited to 1,000 coins.
            </p>

            <div className="bg-[#0b141d] p-5 rounded-2xl border border-brand-secondary/10 space-y-5">
              <div className="flex justify-between text-xs font-bold text-brand-secondary uppercase tracking-wider">
                <span>Wager Amount</span>
                <span className="text-white font-mono">{gambleAmount} Coins</span>
              </div>

              <div className="space-y-2">
                <input 
                  type="range"
                  min="10"
                  max={maxBet || 10}
                  value={gambleAmount}
                  disabled={profile.coins < 10 || isActionLoading}
                  onChange={(e) => setGambleAmount(Number(e.target.value))}
                  className="w-full accent-brand-secondary h-1 bg-[#04080c] border border-white/5 rounded-full cursor-pointer disabled:opacity-50"
                />
                <div className="flex justify-between text-[9px] text-brand-secondary/40 font-mono uppercase">
                  <span>Min: 10</span>
                  <span>Max: {maxBet}</span>
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => setGambleAmount(Math.max(10, Math.floor(profile.coins * 0.5)))}
                  disabled={profile.coins < 10 || isActionLoading}
                  className="flex-1 py-2 bg-white/5 hover:bg-white/10 text-white rounded-lg text-[9px] font-bold uppercase tracking-wider border border-white/5 transition disabled:opacity-50"
                >
                  Half Bet
                </button>
                <button
                  onClick={() => setGambleAmount(maxBet)}
                  disabled={profile.coins < 10 || isActionLoading}
                  className="flex-1 py-2 bg-white/5 hover:bg-white/10 text-white rounded-lg text-[9px] font-bold uppercase tracking-wider border border-white/5 transition disabled:opacity-50"
                >
                  Max Bet
                </button>
              </div>
            </div>
          </div>

          <button
            onClick={() => rollDice(gambleAmount)}
            disabled={profile.coins < 10 || gambleAmount > profile.coins || isActionLoading}
            className="w-full mt-6 py-3.5 bg-brand-secondary hover:bg-white disabled:bg-white/5 disabled:text-white/20 disabled:border-transparent text-[#04080c] font-bold rounded-xl text-xs tracking-wider uppercase transition active:scale-98 text-center disabled:cursor-not-allowed"
          >
            Roll Dice
          </button>
        </div>

      </div>

      {/* 4. BOTTOM PANEL: VIRTUAL SHOP & RANKING LEADERBOARD */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
        
        {/* Virtual Shop Grid */}
        <div className="lg:col-span-7 bg-[#080d14]/90 backdrop-blur-xl border border-brand-secondary/10 p-6 rounded-3xl">
          <h3 className="text-xs font-bold tracking-widest text-brand-secondary uppercase border-b border-brand-secondary/10 pb-3 flex items-center gap-2 mb-6">
            <ShoppingBag className="w-4 h-4" />
            <span>Virtual Server Shop</span>
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {shopItems.map((item) => {
              const isOwned = profile.inventory?.includes(item.id);
              return (
                <div 
                  key={item.id}
                  className="bg-[#0b141d] border border-brand-secondary/10 p-4 rounded-2xl flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-brand-primary/10 border border-brand-primary/20 text-brand-secondary text-[8px] font-bold tracking-widest uppercase w-max mb-3">
                      <span>{item.id.replace('_', ' ')}</span>
                    </div>
                    <span className="text-xs font-bold text-white tracking-wide uppercase block mb-1">{item.name}</span>
                    <p className="text-[9px] text-brand-secondary/60 font-light leading-relaxed mb-4 min-h-[30px]">
                      {item.description}
                    </p>
                  </div>
                  <div>
                    <div className="flex justify-between items-center text-[10px] font-mono text-brand-secondary/80 border-t border-white/5 pt-3 mb-3">
                      <span>PRICE:</span>
                      <span className="text-white font-bold">{item.price} Coins</span>
                    </div>
                    
                    {isOwned ? (
                      <div className="w-full py-2 bg-white/5 border border-white/10 text-white/40 text-[9px] font-bold tracking-widest uppercase rounded-lg text-center select-none">
                        Owned
                      </div>
                    ) : (
                      <button
                        onClick={() => purchaseItem(item.id)}
                        disabled={profile.coins < item.price || isActionLoading}
                        className="w-full py-2 bg-brand-secondary hover:bg-white disabled:bg-white/5 disabled:text-white/20 text-[#04080c] text-[9px] font-bold tracking-widest uppercase rounded-lg text-center transition disabled:cursor-not-allowed"
                      >
                        Buy Item
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Global wealth ranking leaderboard */}
        <div className="lg:col-span-5 bg-[#080d14]/90 backdrop-blur-xl border border-brand-secondary/10 p-6 rounded-3xl flex flex-col justify-between">
          <div>
            <h3 className="text-xs font-bold tracking-widest text-brand-secondary uppercase border-b border-brand-secondary/10 pb-3 flex items-center gap-2 mb-6">
              <Trophy className="w-4 h-4" />
              <span>Wealth Leaderboard</span>
            </h3>

            <div className="overflow-x-auto w-full">
              <table className="w-full text-left border-collapse text-[10px]">
                <thead>
                  <tr className="text-brand-secondary/40 font-bold border-b border-white/5 uppercase font-sans tracking-wider">
                    <th className="py-2.5 pr-2">Rank</th>
                    <th className="py-2.5 px-2">Member ID</th>
                    <th className="py-2.5 px-2 text-center">Level</th>
                    <th className="py-2.5 pl-2 text-right">Coins</th>
                  </tr>
                </thead>
                <tbody className="font-light divide-y divide-white/5">
                  {leaderboard.map((user, idx) => (
                    <tr 
                      key={user.userId} 
                      className={`hover:bg-white/5 transition duration-200 ${
                        user.userId === profile.userId ? "text-brand-secondary font-bold" : "text-white/80"
                      }`}
                    >
                      <td className="py-3 pr-2 font-bold font-mono">#{idx + 1}</td>
                      <td className="py-3 px-2 truncate max-w-[80px] font-mono" title={user.userId}>
                        {user.userId.substring(0, 10)}...
                      </td>
                      <td className="py-3 px-2 text-center font-mono">{user.level}</td>
                      <td className="py-3 pl-2 text-right font-mono text-white">{user.coins}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <span className="text-[8px] text-brand-secondary/40 font-light text-center block tracking-wide mt-6">
            Ranks are updated automatically on XP/Level updates
          </span>
        </div>

      </div>

    </div>
  );
}
