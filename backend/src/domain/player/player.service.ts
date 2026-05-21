import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { LavalinkManager } from 'lavalink-client';
import { Client } from 'discord.js';
import { PlayerGateway } from '../../api/player/player.gateway';
import * as http from 'http';
import * as https from 'https';
import { parse as parseUrl } from 'url';

export async function getIcyMetadata(
  streamUrl: string,
): Promise<{ title?: string; artist?: string } | null> {
  return new Promise((resolve) => {
    try {
      const parsed = parseUrl(streamUrl);
      const isHttps = parsed.protocol === 'https:';
      const lib = isHttps ? https : http;

      const req = lib.get(
        streamUrl,
        {
          headers: {
            'Icy-MetaData': '1',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          },
          timeout: 4000,
        },
        (res) => {
          const metaintStr = res.headers['icy-metaint'];
          const icyName = res.headers['icy-name'] as string;

          if (!metaintStr) {
            req.destroy();
            resolve(icyName ? { title: icyName } : null);
            return;
          }

          const metaint = parseInt(metaintStr as string, 10);
          if (isNaN(metaint) || metaint <= 0) {
            req.destroy();
            resolve(icyName ? { title: icyName } : null);
            return;
          }

          let bytesRead = 0;
          let metaBuffer = Buffer.alloc(0);
          let metaLength = -1;

          res.on('data', (chunk: Buffer) => {
            try {
              let offset = 0;
              while (offset < chunk.length) {
                if (metaLength === -1) {
                  const needed = metaint - bytesRead;
                  const available = chunk.length - offset;

                  if (available < needed) {
                    bytesRead += available;
                    break;
                  } else {
                    offset += needed;
                    bytesRead = 0;
                    metaLength = chunk[offset] * 16;
                    offset += 1;
                  }
                } else {
                  const available = chunk.length - offset;
                  const needed = metaLength - metaBuffer.length;

                  if (available < needed) {
                    metaBuffer = Buffer.concat([
                      metaBuffer,
                      chunk.subarray(offset),
                    ]);
                    break;
                  } else {
                    metaBuffer = Buffer.concat([
                      metaBuffer,
                      chunk.subarray(offset, offset + needed),
                    ]);
                    offset += needed;

                    const metaString = metaBuffer.toString('utf8');
                    req.destroy();

                    const match = metaString.match(/StreamTitle='([^']*)'/);
                    if (match && match[1]) {
                      const fullTitle = match[1];
                      const parts = fullTitle.split(' - ');
                      if (parts.length >= 2) {
                        resolve({
                          title: parts.slice(1).join(' - ').trim(),
                          artist: parts[0].trim(),
                        });
                      } else {
                        resolve({
                          title: fullTitle.trim(),
                        });
                      }
                    } else {
                      resolve(icyName ? { title: icyName } : null);
                    }
                    return;
                  }
                }
              }
            } catch (e) {
              req.destroy();
              resolve(null);
            }
          });
        },
      );

      req.on('error', () => {
        resolve(null);
      });

      req.on('timeout', () => {
        req.destroy();
        resolve(null);
      });
    } catch (e) {
      resolve(null);
    }
  });
}

@Injectable()
export class PlayerService {
  private radioPollInterval: NodeJS.Timeout | null = null;
  private radioMetadataMap = new Map<
    string,
    { title: string; artist: string; streamUrl: string }
  >();

  constructor(
    private readonly lavalinkManager: LavalinkManager,
    private readonly client: Client,
    @Inject(forwardRef(() => PlayerGateway))
    private readonly playerGateway: PlayerGateway,
    private readonly jwtService: JwtService,
  ) {
    this.setupLavalinkListeners();
  }

  private startRadioPoller() {
    if (this.radioPollInterval) return;

    this.radioPollInterval = setInterval(async () => {
      if (this.radioMetadataMap.size === 0) {
        this.stopRadioPoller();
        return;
      }

      for (const [guildId, info] of this.radioMetadataMap.entries()) {
        const player = this.lavalinkManager.players.get(guildId);
        if (!player || !player.playing) {
          this.radioMetadataMap.delete(guildId);
          continue;
        }

        try {
          const meta = await getIcyMetadata(info.streamUrl);
          if (meta && (meta.title || meta.artist)) {
            const currentMeta = this.radioMetadataMap.get(guildId);
            if (currentMeta) {
              const newTitle = meta.title || currentMeta.title;
              const newArtist = meta.artist || currentMeta.artist;

              if (
                currentMeta.title !== newTitle ||
                currentMeta.artist !== newArtist
              ) {
                this.radioMetadataMap.set(guildId, {
                  title: newTitle,
                  artist: newArtist,
                  streamUrl: info.streamUrl,
                });

                this.broadcastUpdate(guildId);
              }
            }
          }
        } catch (err) {
          console.warn(
            `Failed to poll radio metadata for guild ${guildId}:`,
            err,
          );
        }
      }
    }, 12000); // Check every 12 seconds
  }

  private stopRadioPoller() {
    if (this.radioPollInterval) {
      clearInterval(this.radioPollInterval);
      this.radioPollInterval = null;
    }
  }

  private setupLavalinkListeners() {
    this.lavalinkManager.on('trackStart', (player) =>
      this.broadcastUpdate(player.guildId),
    );
    this.lavalinkManager.on('trackEnd', (player) =>
      this.broadcastUpdate(player.guildId),
    );
    this.lavalinkManager.on('queueEnd', (player) =>
      this.broadcastUpdate(player.guildId),
    );
    this.lavalinkManager.on('playerDestroy', (player) =>
      this.broadcastUpdate(player.guildId),
    );
    this.lavalinkManager.on('playerCreate', (player) =>
      this.broadcastUpdate(player.guildId),
    );
  }

  async broadcastUpdate(guildId: string) {
    try {
      const current = await this.getNowPlaying(guildId);
      const queue = await this.getQueue(guildId);

      this.playerGateway.broadcastPlayerState(guildId, {
        isConnected: current.success && (current as any).connected,
        voiceChannelId: current.success
          ? (current as any).voiceChannelId
          : null,
        isPlaying: current.success && current.playing,
        activeFilter: current.success ? (current as any).activeFilter : 'clear',
        bassBoost: current.success ? (current as any).bassBoost : false,
        reverb: current.success ? (current as any).reverb : false,
        currentTrack:
          current.success && current.playing && current.track
            ? {
                title: current.track.title,
                uri: current.track.uri,
                duration: current.track.duration,
                position: current.track.position || 0,
                artist: current.track.author || 'Discord Voice Stream',
                isStream: current.track.isStream || false,
                artworkUrl: current.track.artworkUrl,
              }
            : null,
        serverQueue: queue.success && queue.tracks ? queue.tracks : [],
      });
    } catch (err) {
      console.warn(
        'Failed to broadcast real-time player state update via WebSocket:',
        err,
      );
    }
  }

  async play(guildId: string, query: string, channelId?: string) {
    this.radioMetadataMap.delete(guildId);
    if (this.radioMetadataMap.size === 0) {
      this.stopRadioPoller();
    }

    let player = this.lavalinkManager.players.get(guildId);

    if (!player) {
      if (!channelId) {
        return {
          success: false,
          message: 'Voice channel ID is required to create a player.',
        };
      }
      player = this.lavalinkManager.createPlayer({
        guildId,
        voiceChannelId: channelId,
        textChannelId: '', // Optional for API
        selfDeaf: true,
      });
    } else if (channelId) {
      const currentChannelId =
        player.voiceChannelId || player.options.voiceChannelId;
      if (currentChannelId !== channelId) {
        if (player.connected) {
          try {
            await player.changeVoiceState({ voiceChannelId: channelId });
          } catch (err) {
            console.warn(
              `Failed to change voice state, fallback to reconnect:`,
              err,
            );
            player.options.voiceChannelId = channelId;
            await player.connect();
          }
        } else {
          player.options.voiceChannelId = channelId;
          await player.connect();
        }
      }
    }

    if (!player.connected) {
      await player.connect();
    }

    const result = await player.search(
      { query },
      {
        id: 'api',
        username: 'API',
      },
    );

    if (!result.tracks.length) {
      return { success: false, message: 'No tracks found!' };
    }

    const track = result.tracks[0];
    player.queue.add(track);

    if (!player.playing) {
      await player.play();
    }

    // Trigger instant broadcast update
    this.broadcastUpdate(guildId);

    return {
      success: true,
      message: `Added to queue: ${track.info.title}`,
      track: {
        title: track.info.title,
        uri: track.info.uri,
        duration: track.info.duration,
      },
    };
  }

  async join(guildId: string, channelId: string) {
    let player = this.lavalinkManager.players.get(guildId);

    if (!player) {
      player = this.lavalinkManager.createPlayer({
        guildId,
        voiceChannelId: channelId,
        textChannelId: '',
        selfDeaf: true,
      });
    } else {
      const currentChannelId =
        player.voiceChannelId || player.options.voiceChannelId;
      if (currentChannelId !== channelId) {
        if (player.connected) {
          try {
            await player.changeVoiceState({ voiceChannelId: channelId });
          } catch (err) {
            console.warn(
              `Failed to change voice state, fallback to reconnect:`,
              err,
            );
            player.options.voiceChannelId = channelId;
            await player.connect();
          }
        } else {
          player.options.voiceChannelId = channelId;
          await player.connect();
        }
      }
    }

    if (!player.connected) {
      await player.connect();
    }

    this.broadcastUpdate(guildId);

    return { success: true, message: 'Joined voice channel.' };
  }

  async pause(guildId: string) {
    const player = this.lavalinkManager.players.get(guildId);
    if (!player) return { success: false, message: 'No player found.' };

    await player.pause();
    this.broadcastUpdate(guildId);
    return { success: true, message: 'Playback paused.' };
  }

  async resume(guildId: string) {
    const player = this.lavalinkManager.players.get(guildId);
    if (!player) return { success: false, message: 'No player found.' };

    await player.resume();
    this.broadcastUpdate(guildId);
    return { success: true, message: 'Playback resumed.' };
  }

  async skip(guildId: string) {
    this.radioMetadataMap.delete(guildId);
    if (this.radioMetadataMap.size === 0) {
      this.stopRadioPoller();
    }

    const player = this.lavalinkManager.players.get(guildId);
    if (!player) return { success: false, message: 'No player found.' };

    await player.skip();
    this.broadcastUpdate(guildId);
    return { success: true, message: 'Track skipped.' };
  }

  async stop(guildId: string) {
    this.radioMetadataMap.delete(guildId);
    if (this.radioMetadataMap.size === 0) {
      this.stopRadioPoller();
    }

    const player = this.lavalinkManager.players.get(guildId);
    if (!player) return { success: false, message: 'No player found.' };

    await player.destroy();
    this.broadcastUpdate(guildId);
    return { success: true, message: 'Playback stopped and player destroyed.' };
  }

  async setVolume(guildId: string, level: number) {
    const player = this.lavalinkManager.players.get(guildId);
    if (!player) return { success: false, message: 'No player found.' };

    await player.setVolume(level);
    this.broadcastUpdate(guildId);
    return { success: true, message: `Volume set to ${level}%.` };
  }

  async getQueue(guildId: string) {
    const player = this.lavalinkManager.players.get(guildId);
    if (!player) return { success: false, message: 'No player found.' };

    return {
      success: true,
      current: player.queue.current
        ? {
            title: player.queue.current.info.title,
            uri: player.queue.current.info.uri,
            duration: player.queue.current.info.duration,
            artworkUrl: player.queue.current.info.artworkUrl,
            artist: player.queue.current.info.author,
            isStream: player.queue.current.info.isStream,
          }
        : null,
      tracks: player.queue.tracks.map((t) => ({
        title: t.info.title,
        uri: t.info.uri,
        duration: t.info.duration,
        artworkUrl: t.info.artworkUrl,
        artist: t.info.author,
        isStream: t.info.isStream,
      })),
    };
  }

  async shuffle(guildId: string) {
    const player = this.lavalinkManager.players.get(guildId);
    if (!player) return { success: false, message: 'No player found.' };

    await player.queue.shuffle();
    this.broadcastUpdate(guildId);
    return { success: true, message: 'Queue shuffled.' };
  }

  async clear(guildId: string) {
    const player = this.lavalinkManager.players.get(guildId);
    if (!player) return { success: false, message: 'No player found.' };

    await player.queue.splice(0, player.queue.tracks.length);
    this.broadcastUpdate(guildId);
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
    this.broadcastUpdate(guildId);

    return {
      success: true,
      message: `Removed track: ${removedTrack.info.title}`,
    };
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
    this.broadcastUpdate(guildId);
    return { success: true, message: `Seeked to ${seconds}s.` };
  }

  async setLoopMode(guildId: string, mode: string) {
    const player = this.lavalinkManager.players.get(guildId);
    if (!player) return { success: false, message: 'No player found.' };

    await player.setRepeatMode(mode.toLowerCase() as any);
    this.broadcastUpdate(guildId);
    return { success: true, message: `Loop mode set to ${mode}.` };
  }

  async applyFilter(guildId: string, type: string) {
    const player = this.lavalinkManager.players.get(guildId);
    if (!player) return { success: false, message: 'No player found.' };

    switch (type) {
      case 'nightcore':
        await player.filterManager.toggleNightcore();
        break;
      case 'vaporwave':
        await player.filterManager.toggleVaporwave();
        break;
      case '8d':
        await player.filterManager.toggleRotation();
        break;
      case 'karaoke':
        await player.filterManager.toggleKaraoke();
        break;
      case 'tremolo':
        await player.filterManager.toggleTremolo();
        break;
      case 'vibrato':
        await player.filterManager.toggleVibrato();
        break;
      case 'lowpass':
        await player.filterManager.toggleLowPass();
        break;
      case 'bassboost': {
        const isEqActive =
          player.filterManager.equalizerBands &&
          player.filterManager.equalizerBands.length > 0 &&
          player.filterManager.equalizerBands.some((band) => band.gain !== 0);
        if (isEqActive) {
          await player.filterManager.clearEQ();
        } else {
          await player.filterManager.setEQPreset('BassboostHigh');
        }
        break;
      }
      case 'reverb': {
        await player.filterManager.lavalinkFilterPlugin.toggleReverb();
        break;
      }
      case 'clear': {
        await player.filterManager.resetFilters();
        await player.filterManager.clearEQ();
        if (player.filterManager.filters.lavalinkFilterPlugin?.reverb) {
          await player.filterManager.lavalinkFilterPlugin.toggleReverb();
        }
        break;
      }
      default:
        return { success: false, message: 'Invalid filter type.' };
    }

    this.broadcastUpdate(guildId);
    return { success: true, message: `Filter ${type} toggled/applied.` };
  }

  async getNowPlaying(guildId: string) {
    const player = this.lavalinkManager.players.get(guildId);
    if (!player)
      return { success: false, message: 'No player found.', connected: false };

    const filters = player.filterManager?.filters;
    const activeFilter = filters?.nightcore
      ? 'nightcore'
      : filters?.vaporwave
        ? 'vaporwave'
        : filters?.rotation
          ? '8d'
          : filters?.karaoke
            ? 'karaoke'
            : filters?.tremolo
              ? 'tremolo'
              : filters?.vibrato
                ? 'vibrato'
                : filters?.lowPass
                  ? 'lowpass'
                  : 'clear';
    const bassBoost = !!(
      player.filterManager?.equalizerBands &&
      player.filterManager.equalizerBands.length > 0 &&
      player.filterManager.equalizerBands.some((band) => band.gain !== 0)
    );
    const reverb =
      !!player.filterManager?.filters?.lavalinkFilterPlugin?.reverb;

    const current = player.queue.current;
    if (!current)
      return {
        success: true,
        playing: false,
        connected: player.connected,
        voiceChannelId: player.voiceChannelId,
        activeFilter,
        bassBoost,
        reverb,
      };

    const radioMeta = this.radioMetadataMap.get(guildId);

    return {
      success: true,
      playing: true,
      connected: player.connected,
      voiceChannelId: player.voiceChannelId,
      activeFilter,
      bassBoost,
      reverb,
      track: {
        title: radioMeta ? radioMeta.title : current.info.title,
        uri: current.info.uri,
        duration: current.info.duration,
        position: player.position,
        artworkUrl: current.info.artworkUrl,
        author: radioMeta ? radioMeta.artist : current.info.author,
        isStream: current.info.isStream,
      },
    };
  }

  async getGuilds(token?: string) {
    let userId: string | null = null;
    if (token) {
      try {
        const payload = await this.jwtService.verifyAsync(token);
        userId = payload.userId;
      } catch (err) {
        console.warn('Invalid JWT token supplied to getGuilds:', err);
      }
    }

    try {
      if (
        this.client &&
        this.client.guilds &&
        this.client.guilds.cache &&
        this.client.guilds.cache.size > 0
      ) {
        if (userId && !userId.startsWith('demo_user')) {
          const promises = this.client.guilds.cache.map(async (guild) => {
            if (guild.members.cache.has(userId)) {
              return { guild, isMember: true };
            }
            try {
              const member = await guild.members
                .fetch(userId)
                .catch(() => null);
              return { guild, isMember: !!member };
            } catch (err) {
              return { guild, isMember: false };
            }
          });

          const results = await Promise.all(promises);
          const clientGuilds = results
            .filter((r) => r.isMember)
            .map((r) => ({
              id: r.guild.id,
              name: r.guild.name,
              memberCount: r.guild.memberCount,
              isActive: true,
              iconURL: r.guild.iconURL() || null,
            }));

          return clientGuilds;
        } else {
          // Demo user or unauthenticated request: return all bot guilds
          const clientGuilds = this.client.guilds.cache.map((g) => ({
            id: g.id,
            name: g.name,
            memberCount: g.memberCount,
            isActive: true,
            iconURL: g.iconURL() || null,
          }));
          return clientGuilds;
        }
      }
    } catch (err) {
      console.warn(
        'Discord client guilds starting up, using default mock guilds:',
        err,
      );
    }

    // Aesthetic Fallback Mock Guilds
    return [
      {
        id: '584917332447592488',
        name: 'Yuugen Harmony',
        memberCount: 1542,
        isActive: true,
        iconURL: null,
      },
      {
        id: '2',
        name: 'Lofi & Cafe',
        memberCount: 843,
        isActive: true,
        iconURL: null,
      },
      {
        id: '3',
        name: 'Ghibli Garden',
        memberCount: 2311,
        isActive: true,
        iconURL: null,
      },
      {
        id: '4',
        name: 'The Anime Lounge',
        memberCount: 4298,
        isActive: false,
        iconURL: null,
      },
      {
        id: '5',
        name: 'Developer Hub',
        memberCount: 120,
        isActive: true,
        iconURL: null,
      },
    ];
  }

  async getRecommendations(tag: string) {
    let query = `${tag} music mix`;
    const lowerTag = tag.toLowerCase();
    if (lowerTag === 'jpop') query = 'jpop anime mix';
    else if (lowerTag === 'lofi') query = 'lofi hip hop radio';
    else if (lowerTag === 'edm') query = 'gaming edm mix';
    else if (lowerTag === 'rock') query = 'classic rock hits';

    try {
      const node = this.lavalinkManager.nodeManager.nodes.get('main_node');
      if (node) {
        const result = (await node.search(
          { query: `ytsearch:${query}` },
          {
            id: 'api',
            username: 'API',
          },
        )) as any;

        if (result && result.tracks && result.tracks.length > 0) {
          return {
            success: true,
            tracks: result.tracks.slice(0, 10).map((t: any) => ({
              title: t.info.title,
              uri: t.info.uri,
              duration: t.info.duration,
              author: t.info.author || 'YouTube',
            })),
          };
        }
      }
    } catch (err) {
      console.warn(`Failed to fetch live recommendations for tag ${tag}:`, err);
    }

    return {
      success: true,
      tracks: [],
    };
  }

  async search(query: string) {
    try {
      const node = this.lavalinkManager.nodeManager.nodes.get('main_node');
      if (node) {
        const result = (await node.search(
          { query: `ytsearch:${query}` },
          {
            id: 'api',
            username: 'API',
          },
        )) as any;

        if (result && result.tracks && result.tracks.length > 0) {
          return {
            success: true,
            tracks: result.tracks.slice(0, 5).map((t: any) => ({
              title: t.info.title,
              uri: t.info.uri,
              duration: t.info.duration,
              author: t.info.author || 'YouTube',
            })),
          };
        }
      }
    } catch (err) {
      console.warn(`Failed to fetch live search for ${query}:`, err);
    }

    return { success: false, tracks: [] };
  }

  async getVoiceChannels(guildId: string) {
    try {
      if (this.client) {
        const guild = this.client.guilds.cache.get(guildId);
        if (guild) {
          // Filter for voice channels (Type 2 is GuildVoice in Discord.js v14)
          const channels = guild.channels.cache
            .filter((c: any) => c.type === 2 || c.isVoiceBased?.())
            .map((c: any) => ({
              id: c.id,
              name: c.name,
            }));

          if (channels.length > 0) {
            return { success: true, channels };
          }
        }
      }
    } catch (err) {
      console.warn(`Failed to fetch channels for guild ${guildId}:`, err);
    }

    // Fallback aesthetic mock channels if bot is not in the guild or starting up
    return {
      success: true,
      channels: [
        { id: '1123389644764090544', name: 'General Voice' },
        { id: '2', name: 'Music Lounge' },
        { id: '3', name: 'Gaming Room' },
        { id: '4', name: 'Chilled Cafe' },
      ],
    };
  }

  async getRadioCountries() {
    try {
      const response = await fetch(
        'https://de1.api.radio-browser.info/json/countries',
      );
      const countries = (await response.json()) as any[];
      return {
        success: true,
        countries: countries
          .filter((c) => c.stationcount > 5)
          .map((c) => ({
            name: c.name,
            code: c.code || '',
            stationCount: c.stationcount,
          }))
          .sort((a, b) => b.stationCount - a.stationCount),
      };
    } catch (err) {
      console.error('Failed to fetch radio countries:', err);
      return { success: false, countries: [] };
    }
  }

  async searchRadio(query?: string, country?: string) {
    try {
      let url = '';
      if (!query && !country) {
        url = 'https://de1.api.radio-browser.info/json/stations/topclick/15';
      } else {
        url = `https://de1.api.radio-browser.info/json/stations/search?limit=15&order=votes`;
        if (query) {
          url += `&name=${encodeURIComponent(query)}`;
        }
        if (country) {
          url += `&country=${encodeURIComponent(country)}`;
        }
      }
      const response = await fetch(url);
      const stations = (await response.json()) as any[];

      return {
        success: true,
        stations: (stations || []).map((s: any) => ({
          name: s.name,
          url: s.url_resolved || s.url,
          homepage: s.homepage,
          country: s.country,
          tags: s.tags,
          favicon: s.favicon,
        })),
      };
    } catch (err) {
      console.error('Failed to search radio stations:', err);
      return { success: false, stations: [] };
    }
  }

  async getLiveAtmospheres() {
    const categories = [
      {
        query: 'Tokyo Rain Cafe Live 24/7',
        type: 'Rainy Cafe',
        defaultDesc: 'Gentle rain tap against a Tokyo coffee shop.',
      },
      {
        query: 'Ghibli Orchestral Live 24/7',
        type: 'Orchestra / Ghibli',
        defaultDesc: 'Warm orchestral symphonies of Ghibli films.',
      },
      {
        query: 'Deep Forest Rain Live 24/7',
        type: 'Nature Ambience',
        defaultDesc: 'Quiet night sounds of nature and light breeze.',
      },
      {
        query: 'Cyberpunk Synth Ambient 24/7',
        type: 'Cyberpunk / Sci-Fi',
        defaultDesc: 'Gritty synthesizers and holographic whispers.',
      },
      {
        query: 'Relaxing Ocean Waves Live 24/7',
        type: 'Relax / Sleep',
        defaultDesc: 'Crashing waves of pristine shorelines.',
      },
    ];

    try {
      const node = this.lavalinkManager.nodeManager.nodes.get('main_node');
      if (node) {
        const promises = categories.map(async (cat) => {
          try {
            const result = (await node.search(
              { query: `ytsearch:${cat.query}` },
              { id: 'api', username: 'API' },
            )) as any;
            if (result && result.tracks && result.tracks.length > 0) {
              const t = result.tracks[0];
              return {
                title: t.info.title,
                uri: t.info.uri,
                duration: t.info.duration,
                author: t.info.author || 'YouTube Live',
                type: cat.type,
                desc: cat.defaultDesc,
              };
            }
          } catch (err) {
            console.warn(`Failed to search atmosphere for ${cat.query}:`, err);
          }
          return null;
        });

        const results = await Promise.all(promises);
        const tracks = results.filter((t) => t !== null);
        if (tracks.length > 0) {
          return { success: true, tracks };
        }
      }
    } catch (err) {
      console.warn('Failed to fetch live atmospheres:', err);
    }

    // Fallback to static info if main_node is offline/failing
    return {
      success: true,
      tracks: categories.map((cat) => ({
        title: cat.query.replace(' 24/7', ''),
        uri: cat.query,
        duration: 0,
        author: 'YouTube Atmosphere',
        type: cat.type,
        desc: cat.defaultDesc,
      })),
    };
  }

  async playRadio(
    guildId: string,
    streamUrl: string,
    name: string,
    tags?: string,
    channelId?: string,
    artworkUrl?: string,
  ) {
    let player = this.lavalinkManager.players.get(guildId);

    if (!player) {
      if (!channelId) {
        return {
          success: false,
          message: 'Voice channel ID is required to create a player.',
        };
      }
      player = this.lavalinkManager.createPlayer({
        guildId,
        voiceChannelId: channelId,
        textChannelId: '',
        selfDeaf: true,
      });
    } else if (channelId) {
      const currentChannelId =
        player.voiceChannelId || player.options.voiceChannelId;
      if (currentChannelId !== channelId) {
        if (player.connected) {
          try {
            await player.changeVoiceState({ voiceChannelId: channelId });
          } catch (err) {
            console.warn(
              `Failed to change voice state, fallback to reconnect:`,
              err,
            );
            player.options.voiceChannelId = channelId;
            await player.connect();
          }
        } else {
          player.options.voiceChannelId = channelId;
          await player.connect();
        }
      }
    }

    if (!player.connected) {
      await player.connect();
    }

    const result = await player.search(
      { query: streamUrl },
      {
        id: 'api',
        username: 'API',
      },
    );

    if (!result.tracks.length) {
      return { success: false, message: 'Could not resolve the radio stream!' };
    }

    const track = result.tracks[0];
    track.info.title = name;
    track.info.author = tags || 'Radio Stream';
    track.info.isStream = true;
    if (artworkUrl) {
      track.info.artworkUrl = artworkUrl;
    }

    this.radioMetadataMap.set(guildId, {
      title: name,
      artist: tags || 'Radio Stream',
      streamUrl,
    });
    this.startRadioPoller();

    player.queue.add(track);

    if (!player.playing) {
      await player.play();
    }

    this.broadcastUpdate(guildId);

    return {
      success: true,
      message: `Playing radio: ${name}`,
      track: {
        title: track.info.title,
        uri: track.info.uri,
        duration: track.info.duration,
      },
    };
  }
}
