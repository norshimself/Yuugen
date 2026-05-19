// src/features/music/hooks/usePlayer.ts
import { useState, useMemo, useCallback, useEffect } from "react";
import { QueueTrack, RecommendationTrack, PlayerStatusMessage } from "../types/music.types";
import { musicService } from "../services/musicService";

export function usePlayer(guildId: string | undefined) {
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [volume, setVolumeState] = useState<number>(70);
  const [bassBoost, setBassBoost] = useState<boolean>(false);
  const [reverb, setReverb] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  
  // Bridge inputs
  const [voiceChannelId, setVoiceChannelId] = useState<string>("1123389644764090544"); // Default sample channel ID
  const [playerStatusMessage, setPlayerStatusMessage] = useState<PlayerStatusMessage | null>(null);

  // Dynamic server queue and currently playing track
  const [serverQueue, setServerQueue] = useState<QueueTrack[]>([]);
  const [currentTrack, setCurrentTrack] = useState<QueueTrack | null>(null);

  // Dynamic YouTube Recommendations state by tags (jpop, lofi, edm, rock)
  const [activeRecTag, setActiveRecTag] = useState<"jpop" | "lofi" | "edm" | "rock">("jpop");
  const [recommendations, setRecommendations] = useState<RecommendationTrack[]>([]);
  const [isRecLoading, setIsRecLoading] = useState<boolean>(false);

  const fetchRecommendations = useCallback(async (tag: string) => {
    setIsRecLoading(true);
    try {
      const res = await musicService.getRecommendations(tag);
      if (res.success && res.tracks) {
        setRecommendations(res.tracks);
      }
    } catch (err) {
      console.warn("Failed to fetch recommendations from backend:", err);
    } finally {
      setIsRecLoading(false);
    }
  }, []);

  // Sync recommendations on tag selection changes
  useEffect(() => {
    fetchRecommendations(activeRecTag);
  }, [activeRecTag, fetchRecommendations]);

  // Bridge request sender
  const sendPlayerRequest = useCallback(async (endpoint: string, body: any = {}) => {
    if (!guildId) return null;
    try {
      return await musicService.sendAction(guildId, endpoint, body);
    } catch (err) {
      console.warn("Backend Lavalink player offline fallback:", err);
      return null;
    }
  }, [guildId]);

  // Synchronize Player Queue & Status from backend
  const fetchQueue = useCallback(async () => {
    if (!guildId) return;
    
    try {
      // 1. Fetch currently playing track
      const npRes = await musicService.getNowPlaying(guildId);
      if (npRes.success) {
        setIsConnected(!!npRes.connected);
        if (npRes.voiceChannelId) {
          setVoiceChannelId(npRes.voiceChannelId);
        }
        
        if (npRes.playing && npRes.track) {
          setCurrentTrack({
            title: npRes.track.title,
            uri: npRes.track.uri,
            duration: npRes.track.duration,
            artist: "Discord Voice Stream"
          });
          setIsPlaying(true);
        } else {
          setCurrentTrack(null);
          setIsPlaying(false);
        }
      } else {
        setIsConnected(false);
        setCurrentTrack(null);
        setIsPlaying(false);
      }

      // 2. Fetch full upcoming track queue
      const qRes = await musicService.getQueue(guildId);
      if (qRes.success && qRes.tracks) {
        setServerQueue(qRes.tracks);
      } else {
        setServerQueue([]);
      }
    } catch (err) {
      console.warn("Failed to sync queue with backend:", err);
    }
  }, [guildId]);

  // Native WebSocket real-time updates with automatic reconnect
  useEffect(() => {
    if (!guildId) return;

    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";
    const wsUrl = apiUrl.replace(/^http/, "ws") + "/player/ws";

    let socket: WebSocket | null = null;
    let reconnectTimeout: NodeJS.Timeout;

    const connect = () => {
      try {
        socket = new WebSocket(wsUrl);

        socket.onopen = () => {
          // Subscribe to real-time events for the active guild
          socket?.send(JSON.stringify({ event: "subscribeGuild", data: { guildId } }));
        };

        socket.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.event === "playerUpdate" && msg.guildId === guildId) {
              const payload = msg.data;
              if (payload.isConnected !== undefined) setIsConnected(payload.isConnected);
              if (payload.voiceChannelId !== undefined) setVoiceChannelId(payload.voiceChannelId);
              if (payload.isPlaying !== undefined) setIsPlaying(payload.isPlaying);
              if (payload.currentTrack !== undefined) setCurrentTrack(payload.currentTrack);
              if (payload.serverQueue !== undefined) setServerQueue(payload.serverQueue);
            }
          } catch (err) {
            console.error("Failed to parse WebSocket message:", err);
          }
        };

        socket.onclose = () => {
          reconnectTimeout = setTimeout(connect, 4000);
        };

        socket.onerror = () => {
          socket?.close();
        };
      } catch (err) {
        reconnectTimeout = setTimeout(connect, 4000);
      }
    };

    connect();

    return () => {
      if (socket) {
        socket.onclose = null;
        socket.close();
      }
      clearTimeout(reconnectTimeout);
    };
  }, [guildId]);

  // Resilient fallback sync loop (longer interval to conserve bandwidth)
  useEffect(() => {
    if (!guildId) return;
    let isMounted = true;

    const checkStatus = async () => {
      if (isMounted) {
        await fetchQueue();
      }
    };

    checkStatus();
    const interval = setInterval(checkStatus, 15000); // 15s fallback poll rate
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [guildId, fetchQueue]);

  // Player Actions
  const playTrack = useCallback(async (query: string) => {
    setPlayerStatusMessage({ text: `Queueing query: "${query}"...`, success: true });
    const data = await sendPlayerRequest("/play", { query, channelId: voiceChannelId });
    
    if (data && data.success) {
      setPlayerStatusMessage({ text: `Synced: ${data.message || 'Track queued successfully!'}`, success: true });
      setIsPlaying(true);
      setIsConnected(true);
      await fetchQueue();
    } else {
      setPlayerStatusMessage({ 
        text: `Playback failed. (Discord: ${data?.message || 'Lavalink nodes starting up or channel offline'})`, 
        success: false 
      });
    }
  }, [sendPlayerRequest, voiceChannelId, fetchQueue]);

  const playRadio = useCallback(async (streamUrl: string, name: string, tags?: string) => {
    if (!guildId) return;
    setPlayerStatusMessage({ text: `Connecting to radio stream: "${name}"...`, success: true });
    
    try {
      const data = await musicService.playRadio(guildId, streamUrl, name, tags, voiceChannelId);
      if (data && data.success) {
        setPlayerStatusMessage({ text: `Synced: ${data.message || 'Radio streaming successfully!'}`, success: true });
        setIsPlaying(true);
        setIsConnected(true);
        await fetchQueue();
      } else {
        setPlayerStatusMessage({ 
          text: `Radio failed. (Discord: ${data?.message || 'Lavalink nodes starting up or channel offline'})`, 
          success: false 
        });
      }
    } catch (err) {
      setPlayerStatusMessage({ text: `Failed to stream radio.`, success: false });
    }
  }, [guildId, voiceChannelId, fetchQueue]);

  const joinVoiceChannel = useCallback(async (channelId: string) => {
    setPlayerStatusMessage({ text: `Joining voice channel...`, success: true });
    const data = await sendPlayerRequest("/join", { channelId });
    
    if (data && data.success) {
      setPlayerStatusMessage({ text: `Joined voice channel successfully!`, success: true });
      setVoiceChannelId(channelId);
      setIsConnected(true);
    } else {
      setPlayerStatusMessage({ 
        text: `Failed to join channel: ${data?.message || 'Unknown error'}`, 
        success: false 
      });
    }
  }, [sendPlayerRequest, setVoiceChannelId]);

  const skipTrack = useCallback(async () => {
    const data = await sendPlayerRequest("/skip");
    if (data && data.success) {
      setPlayerStatusMessage({ text: "Skipped current track.", success: true });
      await fetchQueue();
    } else {
      setPlayerStatusMessage({ text: `Failed to skip: ${data?.message || 'Offline'}`, success: false });
    }
  }, [sendPlayerRequest, fetchQueue]);

  const stopTrack = useCallback(async () => {
    const data = await sendPlayerRequest("/stop");
    if (data && data.success) {
      setPlayerStatusMessage({ text: "Stopped music player and disconnected.", success: true });
      setIsPlaying(false);
      setIsConnected(false);
      setCurrentTrack(null);
      setServerQueue([]);
    } else {
      setPlayerStatusMessage({ text: `Failed to stop: ${data?.message || 'Offline'}`, success: false });
    }
  }, [sendPlayerRequest]);

  const togglePlay = useCallback(async () => {
    const nextPlayState = !isPlaying;
    const endpoint = nextPlayState ? "/resume" : "/pause";
    const data = await sendPlayerRequest(endpoint);
    
    if (data && data.success) {
      setIsPlaying(nextPlayState);
      setPlayerStatusMessage({ text: data.message, success: true });
    } else {
      setIsPlaying(nextPlayState);
      setPlayerStatusMessage({ 
        text: `Toggled local ambient audio. (Discord: ${data?.message || 'Offline'})`, 
        success: false 
      });
    }
  }, [isPlaying, sendPlayerRequest]);

  const setVolume = useCallback(async (level: number) => {
    setVolumeState(level);
    const data = await sendPlayerRequest("/volume", { level });
    if (data && data.success) {
      setPlayerStatusMessage({ text: data.message, success: true });
    }
  }, [sendPlayerRequest]);

  const toggleMute = useCallback(() => {
    setIsMuted(prev => !prev);
  }, []);

  const applyFilter = useCallback(async (type: string) => {
    const data = await sendPlayerRequest("/filter", { type });
    if (data && data.success) {
      setPlayerStatusMessage({ text: `Filter ${type} applied on server.`, success: true });
      // Update local states for UI sync
      if (type === "nightcore") { setBassBoost(true); setReverb(false); }
      else if (type === "vaporwave") { setReverb(true); setBassBoost(false); }
      else if (type === "clear") { setBassBoost(false); setReverb(false); }
    }
  }, [sendPlayerRequest]);

  const setLoopMode = useCallback(async (mode: "off" | "track" | "queue") => {
    const data = await sendPlayerRequest("/loop", { mode });
    if (data && data.success) {
      setPlayerStatusMessage({ text: `Loop mode set to ${mode}.`, success: true });
    }
  }, [sendPlayerRequest]);

  const shuffleQueue = useCallback(async () => {
    const data = await sendPlayerRequest("/shuffle");
    if (data && data.success) {
      setPlayerStatusMessage({ text: "Queue shuffled.", success: true });
      await fetchQueue();
    }
  }, [sendPlayerRequest, fetchQueue]);

  const clearQueue = useCallback(async () => {
    const data = await sendPlayerRequest("/clear");
    if (data && data.success) {
      setPlayerStatusMessage({ text: "Queue cleared.", success: true });
      await fetchQueue();
    }
  }, [sendPlayerRequest, fetchQueue]);

  const removeTrack = useCallback(async (index: number) => {
    // 1-indexed count on NestJS endpoint
    const data = await sendPlayerRequest("/remove", { index: index + 1 });
    if (data && data.success) {
      setPlayerStatusMessage({ text: "Track removed from queue.", success: true });
      await fetchQueue();
    }
  }, [sendPlayerRequest, fetchQueue]);

  // Soundwave visualizer bars
  const visualizerBars = useMemo(() => {
    return Array.from({ length: 28 }, (_, i) => ({
      baseHeight: 12 + Math.sin(i * 0.4) * 22 + Math.cos(i * 0.2) * 10,
      delay: i * 0.05
    }));
  }, []);

  return {
    isPlaying,
    setIsPlaying,
    togglePlay,
    volume,
    setVolume,
    isMuted,
    toggleMute,
    applyFilter,
    setLoopMode,
    // Connection status
    isConnected,
    disconnectBot: stopTrack,
    // Dynamic Server Queue states
    serverQueue,
    currentTrack,
    visualizerBars,
    // Curated recommendations
    activeRecTag,
    setActiveRecTag,
    recommendations,
    isRecLoading,
    fetchRecommendations,
    // Actions
    playTrack,
    playRadio,
    joinVoiceChannel,
    skipTrack,
    stopTrack,
    shuffleQueue,
    clearQueue,
    removeTrack,
    // Bridge settings
    voiceChannelId,
    setVoiceChannelId,
    playerStatusMessage,
    setPlayerStatusMessage,
  };
}
