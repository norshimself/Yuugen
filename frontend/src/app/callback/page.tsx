"use client";

import { useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";

function CallbackHandler() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const accessToken = searchParams.get("access_token");
    const refreshToken = searchParams.get("refresh_token");

    if (accessToken) {
      // Store token securely in localStorage for authentication validation
      localStorage.setItem("access_token", accessToken);
      if (refreshToken) {
        localStorage.setItem("refresh_token", refreshToken);
      }
      
      // Delay briefly for a premium, smooth transition effect
      const timer = setTimeout(() => {
        router.push("/player");
      }, 1500);

      return () => clearTimeout(timer);
    } else {
      // No token found, bounce back to login
      router.push("/login");
    }
  }, [searchParams, router]);

  return (
    <div className="min-h-screen w-full bg-[#04080c] flex flex-col items-center justify-center relative overflow-hidden font-serif">
      {/* 1. Decorative Glows */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[450px] h-[450px] bg-brand-primary/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[350px] h-[350px] bg-brand-secondary/8 rounded-full blur-[100px] pointer-events-none" />

      {/* 2. Frosted Core Container */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.6 }}
        className="w-full max-w-md p-10 rounded-[2.5rem] bg-[#101c26]/40 border border-brand-secondary/15 shadow-2xl backdrop-blur-xl flex flex-col items-center text-center relative z-10"
      >
        {/* Brand Logo with spin animation */}
        <div className="relative mb-8">
          <Image
            src="/logo.svg"
            alt="Yuugen Logo"
            width={72}
            height={72}
            className="animate-[spin_10s_linear_infinite]"
          />
        </div>

        {/* Title */}
        <h2 className="text-2xl text-white font-serif font-normal tracking-wide bg-gradient-to-r from-white via-white to-brand-secondary bg-clip-text text-transparent mb-3">
          Synchronizing Harmony
        </h2>

        {/* Poetic description */}
        <p className="text-xs text-brand-secondary/70 leading-relaxed font-light mb-8 max-w-xs">
          Gathering your guilds, aligning your player deck, and weaving ambient melodies...
        </p>

        {/* Custom animated loader */}
        <div className="flex items-center gap-2.5 text-brand-secondary font-sans text-xs tracking-widest font-semibold uppercase">
          <Loader2 className="w-4 h-4 animate-spin text-brand-secondary" />
          <span>Entering the Garden</span>
        </div>
      </motion.div>
    </div>
  );
}

export default function CallbackPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen w-full bg-[#04080c] flex items-center justify-center text-brand-secondary">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    }>
      <CallbackHandler />
    </Suspense>
  );
}
