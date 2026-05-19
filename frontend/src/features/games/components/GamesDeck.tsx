// src/features/games/components/GamesDeck.tsx
"use client";

import { useState } from "react";
import { Gamepad2, AlertCircle, RefreshCw, Loader2, HelpCircle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useGames } from "../hooks/useGames";

interface GamesDeckProps {
  selectedGuildId?: string;
}

export function GamesDeck({ selectedGuildId }: GamesDeckProps) {
  const {
    trivia,
    triviaMessage,
    isTriviaAnswered,
    coinsBalance,
    isLoadingTrivia,
    rpsLoading,
    setTriviaMessage,
    loadTriviaQuestion,
    submitTriviaAnswer,
    playRockPaperScissors,
  } = useGames(selectedGuildId);

  // RPS State
  const [rpsResult, setRpsResult] = useState<{
    userChoice: string;
    botChoice: string;
    result: "win" | "lose" | "tie";
    reward: number;
  } | null>(null);

  const handleRPSPlay = async (choice: "rock" | "paper" | "scissors") => {
    setRpsResult(null);
    try {
      const data = await playRockPaperScissors(choice);
      if (data && data.success) {
        setRpsResult({
          userChoice: data.userChoice,
          botChoice: data.botChoice,
          result: data.result,
          reward: data.reward,
        });
      }
    } catch (err) {
      console.error(err);
    }
  };

  const getRPSHandIcon = (choice: string) => {
    switch (choice) {
      case "rock": return "✊";
      case "paper": return "✋";
      case "scissors": return "✌️";
      default: return "❓";
    }
  };

  if (coinsBalance === null) {
    return (
      <div className="w-full min-h-[400px] flex flex-col items-center justify-center border border-brand-secondary/10 bg-[#101c26]/60 rounded-3xl p-12 text-center">
        <Loader2 className="w-8 h-8 text-brand-secondary animate-spin mb-4" />
        <span className="text-xs text-brand-secondary/60 uppercase tracking-widest font-semibold">Aligning Games Console...</span>
      </div>
    );
  }

  return (
    <div className="w-full grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
      
      {/* LEFT PANEL: ROCK-PAPER-SCISSORS ARENA (7 Columns) */}
      <div className="lg:col-span-7 bg-[#101c26]/60 border border-brand-secondary/10 p-6 rounded-3xl flex flex-col justify-between min-h-[500px]">
        <div>
          <h3 className="text-xs font-bold tracking-widest text-brand-secondary uppercase border-b border-brand-secondary/10 pb-3 flex items-center gap-2 mb-6">
            <Gamepad2 className="w-4 h-4" />
            <span>Rock-Paper-Scissors Arena</span>
          </h3>

          <p className="text-[10px] text-brand-secondary/60 leading-relaxed font-light mb-8">
            Challenge the Yuugen bot core to a match! Winners are rewarded with 20 server gold coins.
          </p>

          {/* Interactive Choices Grid */}
          <div className="grid grid-cols-3 gap-4 max-w-md mx-auto">
            {(["rock", "paper", "scissors"] as const).map((choice) => (
              <button
                key={choice}
                onClick={() => handleRPSPlay(choice)}
                disabled={rpsLoading}
                className="group p-6 bg-[#0b141d] border border-brand-secondary/10 hover:border-brand-secondary/40 rounded-2xl flex flex-col items-center justify-center gap-3 transition duration-300 disabled:opacity-50"
              >
                <span className="text-4xl group-hover:scale-110 transition duration-300">
                  {getRPSHandIcon(choice)}
                </span>
                <span className="text-[10px] font-bold text-white tracking-wider uppercase">
                  {choice}
                </span>
              </button>
            ))}
          </div>

          {/* RPS Result Box */}
          <AnimatePresence mode="wait">
            {rpsResult && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                className="mt-8 p-5 bg-[#0b141d] border border-brand-secondary/10 rounded-2xl max-w-md mx-auto"
              >
                <div className="flex justify-around items-center mb-4">
                  <div className="text-center">
                    <span className="text-[9px] font-bold text-brand-secondary/40 tracking-wider uppercase block mb-1">You</span>
                    <span className="text-3xl block">{getRPSHandIcon(rpsResult.userChoice)}</span>
                    <span className="text-[9px] font-mono font-bold text-white uppercase block mt-1">{rpsResult.userChoice}</span>
                  </div>
                  <div className="text-xs font-mono text-brand-secondary/30">VS</div>
                  <div className="text-center">
                    <span className="text-[9px] font-bold text-brand-secondary/40 tracking-wider uppercase block mb-1">Yuugen</span>
                    <span className="text-3xl block">{getRPSHandIcon(rpsResult.botChoice)}</span>
                    <span className="text-[9px] font-mono font-bold text-white uppercase block mt-1">{rpsResult.botChoice}</span>
                  </div>
                </div>

                <div className="border-t border-white/5 pt-4 text-center">
                  {rpsResult.result === "win" ? (
                    <div>
                      <span className="px-3 py-1 bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 text-[10px] font-bold tracking-wider uppercase rounded-full">
                        Match Win
                      </span>
                      <span className="text-[10px] text-brand-secondary/70 font-light block mt-2">
                        Earned <strong className="text-white font-mono">+{rpsResult.reward}</strong> coins!
                      </span>
                    </div>
                  ) : rpsResult.result === "lose" ? (
                    <div>
                      <span className="px-3 py-1 bg-red-500/10 border border-red-500/25 text-red-400 text-[10px] font-bold tracking-wider uppercase rounded-full">
                        Match Defeat
                      </span>
                      <span className="text-[10px] text-brand-secondary/70 font-light block mt-2">
                        Better luck next time!
                      </span>
                    </div>
                  ) : (
                    <div>
                      <span className="px-3 py-1 bg-[#1c2a38] border border-brand-secondary/20 text-[#2563eb] text-[10px] font-bold tracking-wider uppercase rounded-full">
                        Match Draw
                      </span>
                      <span className="text-[10px] text-brand-secondary/70 font-light block mt-2">
                        Equal strength. Play again!
                      </span>
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="border-t border-brand-secondary/10 pt-4 flex items-center justify-between text-[9px] text-brand-secondary/40 font-light">
          <span>Active Balance: {coinsBalance} Coins</span>
          <span>Rewards credited directly to wallet</span>
        </div>
      </div>

      {/* RIGHT PANEL: ZEN TRIVIA SESSIONS (5 Columns) */}
      <div className="lg:col-span-5 bg-[#101c26]/60 border border-brand-secondary/10 p-6 rounded-3xl flex flex-col justify-between min-h-[500px]">
        <div>
          <h3 className="text-xs font-bold tracking-widest text-brand-secondary uppercase border-b border-brand-secondary/10 pb-3 flex items-center gap-2 mb-6">
            <HelpCircle className="w-4 h-4" />
            <span>Zen Trivia sessions</span>
          </h3>

          {/* Active Trivia Board */}
          {isLoadingTrivia ? (
            <div className="w-full flex flex-col items-center justify-center py-12 text-center">
              <Loader2 className="w-6 h-6 text-brand-secondary animate-spin mb-3 opacity-50" />
              <span className="text-[10px] text-brand-secondary/40 uppercase tracking-widest font-mono">Fetching new riddle...</span>
            </div>
          ) : trivia ? (
            <div className="space-y-6">
              <div>
                <span className="px-2 py-0.5 rounded bg-brand-primary/10 border border-brand-primary/20 text-brand-secondary text-[8px] font-bold tracking-widest uppercase inline-block mb-3">
                  Trivia Question (+{trivia.reward} Coins)
                </span>
                <h4 className="text-lg font-serif font-normal text-white leading-snug tracking-wide">
                  {trivia.question}
                </h4>
              </div>

              {/* Multiple choices */}
              <div className="space-y-2.5">
                {trivia.options.map((option, idx) => (
                  <button
                    key={idx}
                    disabled={isTriviaAnswered}
                    onClick={() => submitTriviaAnswer(idx)}
                    className="w-full text-left p-4 bg-[#0b141d] border border-brand-secondary/10 hover:border-brand-secondary/35 disabled:hover:border-brand-secondary/10 disabled:opacity-70 rounded-xl text-xs font-light text-white transition"
                  >
                    <span className="font-mono text-brand-secondary font-bold mr-3">{idx + 1}.</span>
                    <span>{option}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="w-full flex flex-col items-center justify-center py-12 text-center">
              <Loader2 className="w-6 h-6 text-brand-secondary animate-spin mb-3 opacity-50" />
              <span className="text-[10px] text-brand-secondary/40 uppercase tracking-widest font-mono">No active session...</span>
            </div>
          )}

          {/* Trivia Response Message Box */}
          <AnimatePresence>
            {triviaMessage && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className={`mt-6 p-4 rounded-xl border flex items-start gap-3 ${
                  triviaMessage.success 
                    ? "bg-[#0b1d15] border-emerald-500/25 text-emerald-400" 
                    : "bg-[#1d0b0b] border-red-500/25 text-red-400"
                }`}
              >
                <AlertCircle className="w-4.5 h-4.5 flex-shrink-0 mt-0.5" />
                <span className="text-xs font-light leading-relaxed flex-grow">{triviaMessage.text}</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Trivia Control Action */}
        <div className="border-t border-brand-secondary/10 pt-4 mt-6">
          <button
            onClick={loadTriviaQuestion}
            className="w-full py-3 bg-[#0b141d] hover:bg-white hover:text-[#04080c] border border-brand-secondary/20 hover:border-transparent text-brand-secondary font-bold rounded-xl text-xs tracking-wider uppercase transition flex items-center justify-center gap-2"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Next Question</span>
          </button>
        </div>
      </div>

    </div>
  );
}
