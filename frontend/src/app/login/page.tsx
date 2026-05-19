"use client";

import Link from "next/link";
import Image from "next/image";
import { ArrowRight } from "lucide-react";
import { motion } from "framer-motion";
import { useLogin } from "@/hooks/use-login";

export default function LoginPage() {
  const { handleLogin, handleDemoLogin } = useLogin();

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1,
        delayChildren: 0.05,
      },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 15 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { type: "spring" as const, stiffness: 100, damping: 20 },
    },
  };

  const bgBlobVariants = {
    animate1: {
      scale: [1, 1.15, 0.9, 1],
      x: [0, 30, -20, 0],
      y: [0, -40, 20, 0],
      transition: {
        duration: 12,
        repeat: Infinity,
        ease: "easeInOut" as const,
      },
    },
    animate2: {
      scale: [1, 0.85, 1.1, 1],
      x: [0, -30, 40, 0],
      y: [0, 50, -30, 0],
      transition: {
        duration: 14,
        repeat: Infinity,
        ease: "easeInOut" as const,
      },
    },
  };

  return (
    <div className="min-h-screen w-full bg-brand-bg-darker text-white font-sans overflow-hidden relative selection:bg-brand-primary selection:text-white">
      
      {/* 1. FULL-BLEED BACKGROUND CANVAS */}
      <div className="absolute inset-0 z-0 bg-[#04080c]">
        <Image
          src="/blossom_landscape.png"
          alt="Traditional Japanese Pagoda Cherry Blossom Watercolor Painting"
          fill
          className="object-cover object-center pointer-events-none select-none filter brightness-[0.98] contrast-[1.02]"
          priority
          sizes="100vw"
        />
        
        {/* Soft slate-teal brand multiply wash (lightened to let pagoda details pop) */}
        <div className="absolute inset-0 bg-brand-primary/12 mix-blend-multiply pointer-events-none" />
        
        {/* Tint painting highlights - Shifting blossoms to brand-sand gold, and mountains to brand-teal */}
        <div className="absolute inset-0 bg-gradient-to-tr from-brand-primary/30 via-transparent to-brand-secondary/25 mix-blend-color pointer-events-none" />
      </div>

      {/* 2. MATHEMATICALLY SEAMLESS SMOOTH GRADIENT OVERLAYS */}
      {/* Desktop Horizontal Gradient: Transitions from deep navy (form background) to fully transparent */}
      <div className="absolute inset-0 bg-gradient-to-r from-brand-bg-darker via-brand-bg-darker/95 via-brand-bg-darker/80 via-brand-bg-darker/35 to-transparent pointer-events-none hidden md:block z-10" />
      
      {/* Mobile Dark Semi-Transparent Blur Backdrop */}
      <div className="absolute inset-0 bg-brand-bg-darker/85 backdrop-blur-md pointer-events-none md:hidden z-10" />

      {/* Ambient background brand blobs (overlaying Ghibli slightly in the dark section) */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none z-10">
        <motion.div
          variants={bgBlobVariants}
          animate="animate1"
          className="absolute top-1/4 left-1/4 -translate-x-1/2 -translate-y-1/2 w-[550px] h-[550px] bg-brand-primary/10 rounded-full blur-[130px]"
        />
        <motion.div
          variants={bgBlobVariants}
          animate="animate2"
          className="absolute bottom-1/4 right-1/4 w-[450px] h-[450px] bg-brand-secondary/8 rounded-full blur-[120px]"
        />
      </div>

      {/* 3. FLOATING FOREGROUND GRID */}
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="w-full min-h-screen grid grid-cols-1 md:grid-cols-12 relative z-20"
      >
        
        {/* Left Column: Authentic Brand Login Panel (Completely Transparent, Floating) */}
        <div className="col-span-12 md:col-span-6 lg:col-span-5 xl:col-span-5 p-10 sm:p-16 md:p-20 lg:p-24 flex flex-col justify-between min-h-screen relative z-30">
          
          {/* Logo Section */}
          <motion.div variants={itemVariants} className="flex items-center gap-3">
            <Image
              src="/logo.svg"
              alt="Yuugen Logo"
              width={38}
              height={38}
              className="flex-shrink-0"
            />
            <span className="text-2xl font-serif font-normal tracking-wide bg-gradient-to-r from-white via-white to-brand-secondary bg-clip-text text-transparent select-none">
              Yuugen
            </span>
          </motion.div>

          {/* Heading and Subtitle */}
          <div className="my-16 md:my-24 flex-grow flex flex-col justify-center">
            <motion.div variants={itemVariants} className="mb-12">
              <h1 className="text-3.5xl md:text-4xl lg:text-4.5xl font-serif font-normal text-white tracking-tight leading-tight">
                Welcome back!
              </h1>
              <p className="text-sm font-serif italic text-brand-secondary/80 mt-3">
                Where the blossoms greet your return.
              </p>
            </motion.div>

            {/* Discord OAuth Action Panel */}
            <motion.div
              variants={itemVariants}
              className="space-y-8"
            >
              <p className="text-sm text-brand-secondary/75 leading-relaxed font-light font-serif italic">
                Connect your Discord account to step back onto the balcony. Let Yuugen weave ambient melodies, manage your server's cozy tea houses, and synchronize with your community's heartbeat.
              </p>

              {/* Login Button */}
              <button
                onClick={handleLogin}
                className="w-full py-4.5 bg-brand-secondary hover:bg-white text-brand-bg-darker font-serif font-bold text-sm tracking-wide rounded-xl transition-all duration-300 shadow-lg shadow-brand-secondary/10 hover:shadow-white/5 active:scale-[0.99] cursor-pointer flex items-center justify-center gap-3"
              >
                <svg className="w-5 h-5 fill-current flex-shrink-0" viewBox="0 0 127.14 96.36">
                  <path d="M107.7,8.07A105.15,105.15,0,0,0,77.26,0a77.19,77.19,0,0,0-3.3,6.83A96.67,96.67,0,0,0,53.18,6.83,77.19,77.19,0,0,0,49.88,0,105.15,105.15,0,0,0,19.44,8.07C3.66,31.58-1.86,54.65,1,77.53A105.73,105.73,0,0,0,32,96.36a77.7,77.7,0,0,0,6.63-10.85,68.43,68.43,0,0,1-10.4-5c.9-.66,1.76-1.37,2.58-2.1a75.52,75.52,0,0,0,72.48,0c.83.73,1.69,1.44,2.58,2.1a68.21,68.21,0,0,1-10.4,5,77.7,77.7,0,0,0,6.63,10.85,105.73,105.73,0,0,0,31-18.83C129.87,50.77,123.78,28,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53S36.18,40.36,42.45,40.36,53.83,46,53.83,53,48.72,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.24,60,73.24,53S78.41,40.36,84.69,40.36,96.07,46,96.07,53,91,65.69,84.69,65.69Z" />
                </svg>
                <span>Login with Discord</span>
                <ArrowRight className="w-4 h-4 flex-shrink-0" />
              </button>

              {/* Safety & Sync Matrix */}
              <ul className="space-y-4 pt-8 border-t border-brand-secondary/10">
                <li className="flex items-start gap-3.5">
                  <div className="w-5 h-5 rounded-full bg-brand-primary/20 border border-brand-secondary/15 flex items-center justify-center text-brand-secondary flex-shrink-0 mt-0.5">
                    <svg className="w-2.5 h-2.5 fill-current" viewBox="0 0 20 20"><path d="M0 11l2-2 5 5L18 3l2 2L7 18z"/></svg>
                  </div>
                  <span className="text-xs text-brand-secondary/90 leading-relaxed font-light font-serif">Secure connection directly through Discord, keeping your keys safe</span>
                </li>
                <li className="flex items-start gap-3.5">
                  <div className="w-5 h-5 rounded-full bg-brand-primary/20 border border-brand-secondary/15 flex items-center justify-center text-brand-secondary flex-shrink-0 mt-0.5">
                    <svg className="w-2.5 h-2.5 fill-current" viewBox="0 0 20 20"><path d="M0 11l2-2 5 5L18 3l2 2L7 18z"/></svg>
                  </div>
                  <span className="text-xs text-brand-secondary/90 leading-relaxed font-light font-serif">A sanctuary of privacy—we never store or see your passwords</span>
                </li>
                <li className="flex items-start gap-3.5">
                  <div className="w-5 h-5 rounded-full bg-brand-primary/20 border border-brand-secondary/15 flex items-center justify-center text-brand-secondary flex-shrink-0 mt-0.5">
                    <svg className="w-2.5 h-2.5 fill-current" viewBox="0 0 20 20"><path d="M0 11l2-2 5 5L18 3l2 2L7 18z"/></svg>
                  </div>
                  <span className="text-xs text-brand-secondary/90 leading-relaxed font-light font-serif">Instant harmony—your guilds, players, and custom settings load in a single breath</span>
                </li>
              </ul>
            </motion.div>
          </div>

          {/* Bottom Footer Section */}
          <motion.div variants={itemVariants} className="mt-16 pt-8 border-t border-brand-secondary/10">
            <div className="flex items-center justify-between text-xs text-brand-secondary/70 font-serif">
              <span>Yuugen Platform Client v1.0</span>
              <button
                onClick={handleDemoLogin}
                className="font-medium text-brand-secondary hover:text-white hover:underline flex items-center gap-1 transition cursor-pointer"
              >
                <span>Demo Music Deck</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </motion.div>

        </div>

        {/* Right Column: Empty spacer column to let the full-bleed Ghibli canvas shine through */}
        <div className="hidden md:block md:col-span-6 lg:col-span-7 xl:col-span-7 pointer-events-none" />

      </motion.div>

    </div>
  );
}
