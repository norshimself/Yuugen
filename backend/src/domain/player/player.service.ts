import { Injectable } from '@nestjs/common';
import { LavalinkManager } from 'lavalink-client';

@Injectable()
export class PlayerService {
  constructor(private readonly lavalinkManager: LavalinkManager) {}

  async play(guildId: string, query: string, channelId?: string) {
    let player = this.lavalinkManager.players.get(guildId);

    if (!player) {
      if (!channelId) {
        return { success: false, message: 'Voice channel ID is required to create a player.' };
      }
      player = this.lavalinkManager.createPlayer({
        guildId,
        voiceChannelId: channelId,
        textChannelId: '', // Optional for API
        selfDeaf: true,
      });
    }

    if (!player.connected) {
      await player.connect();
    }

    const result = await player.search({ query }, { id: 'api', username: 'API' } as any);

    if (!result.tracks.length) {
      return { success: false, message: 'No tracks found!' };
    }

    const track = result.tracks[0];
    player.queue.add(track);

    if (!player.playing) {
      await player.play();
    }

    return { 
      success: true, 
      message: `Added to queue: ${track.info.title}`,
      track: {
        title: track.info.title,
        uri: track.info.uri,
        duration: track.info.duration
      }
    };
  }

  async pause(guildId: string) {
    const player = this.lavalinkManager.players.get(guildId);
    if (!player) return { success: false, message: 'No player found.' };
    
    await player.pause();
    return { success: true, message: 'Playback paused.' };
  }

  async resume(guildId: string) {
    const player = this.lavalinkManager.players.get(guildId);
    if (!player) return { success: false, message: 'No player found.' };
    
    await player.resume();
    return { success: true, message: 'Playback resumed.' };
  }

  async skip(guildId: string) {
    const player = this.lavalinkManager.players.get(guildId);
    if (!player) return { success: false, message: 'No player found.' };
    
    await player.skip();
    return { success: true, message: 'Track skipped.' };
  }

  async stop(guildId: string) {
    const player = this.lavalinkManager.players.get(guildId);
    if (!player) return { success: false, message: 'No player found.' };
    
    await player.destroy();
    return { success: true, message: 'Playback stopped and player destroyed.' };
  }

  async setVolume(guildId: string, level: number) {
    const player = this.lavalinkManager.players.get(guildId);
    if (!player) return { success: false, message: 'No player found.' };
    
    await player.setVolume(level);
    return { success: true, message: `Volume set to ${level}%.` };
  }

  async getQueue(guildId: string) {
    const player = this.lavalinkManager.players.get(guildId);
    if (!player) return { success: false, message: 'No player found.' };
    
    return {
      success: true,
      current: player.queue.current ? {
        title: player.queue.current.info.title,
        uri: player.queue.current.info.uri,
        duration: player.queue.current.info.duration
      } : null,
      tracks: player.queue.tracks.map(t => ({
        title: t.info.title,
        uri: t.info.uri,
        duration: t.info.duration
      }))
    };
  }

  async shuffle(guildId: string) {
    const player = this.lavalinkManager.players.get(guildId);
    if (!player) return { success: false, message: 'No player found.' };
    
    await player.queue.shuffle();
    return { success: true, message: 'Queue shuffled.' };
  }

  async clear(guildId: string) {
    const player = this.lavalinkManager.players.get(guildId);
    if (!player) return { success: false, message: 'No player found.' };
    
    await player.queue.splice(0, player.queue.tracks.length);
    return { success: true, message: 'Queue cleared.' };
  }

  async remove(guildId: string, index: number) {
    const player = this.lavalinkManager.players.get(guildId);
    if (!player) return { success: false, message: 'No player found.' };
    
    const tracks = player.queue.tracks;
    if (index < 1 || index > tracks.length) {
      return { success: false, message: 'Invalid index.' };
    }
    
    const removedTrack = tracks[index - 1];
    await player.queue.splice(index - 1, 1);
    
    return { success: true, message: `Removed track: ${removedTrack.info.title}` };
  }

  async seek(guildId: string, seconds: number) {
    const player = this.lavalinkManager.players.get(guildId);
    if (!player) return { success: false, message: 'No player found.' };
    
    const currentTrack = player.queue.current;
    if (!currentTrack) return { success: false, message: 'No track playing.' };
    
    if (seconds < 0 || seconds * 1000 > (currentTrack.info.duration || 0)) {
      return { success: false, message: 'Invalid seek position.' };
    }
    
    await player.seek(seconds * 1000);
    return { success: true, message: `Seeked to ${seconds}s.` };
  }

  async setLoopMode(guildId: string, mode: string) {
    const player = this.lavalinkManager.players.get(guildId);
    if (!player) return { success: false, message: 'No player found.' };
    
    await player.setRepeatMode(mode.toLowerCase() as any);
    return { success: true, message: `Loop mode set to ${mode}.` };
  }

  async applyFilter(guildId: string, type: string) {
    const player = this.lavalinkManager.players.get(guildId);
    if (!player) return { success: false, message: 'No player found.' };
    
    switch (type) {
      case 'nightcore': await player.filterManager.toggleNightcore(); break;
      case 'vaporwave': await player.filterManager.toggleVaporwave(); break;
      case '8d': await player.filterManager.toggleRotation(); break;
      case 'karaoke': await player.filterManager.toggleKaraoke(); break;
      case 'tremolo': await player.filterManager.toggleTremolo(); break;
      case 'vibrato': await player.filterManager.toggleVibrato(); break;
      case 'lowpass': await player.filterManager.toggleLowPass(); break;
      case 'clear': await player.filterManager.resetFilters(); break;
      default: return { success: false, message: 'Invalid filter type.' };
    }
    
    return { success: true, message: `Filter ${type} toggled/applied.` };
  }

  async getNowPlaying(guildId: string) {
    const player = this.lavalinkManager.players.get(guildId);
    if (!player) return { success: false, message: 'No player found.' };
    
    const current = player.queue.current;
    if (!current) return { success: true, playing: false };
    
    return {
      success: true,
      playing: true,
      track: {
        title: current.info.title,
        uri: current.info.uri,
        duration: current.info.duration,
        position: player.position,
        artworkUrl: current.info.artworkUrl
      }
    };
  }
}
