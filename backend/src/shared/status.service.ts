import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from 'discord.js';
import { DataSource } from 'typeorm';

export interface ReadinessReport {
  status: 'ready' | 'unavailable';
  dependencies: {
    database: 'up' | 'down';
    discord: 'up' | 'down';
    lavalink: 'up' | 'down';
  };
}

@Injectable()
export class StatusService {
  constructor(
    private readonly database: DataSource,
    private readonly discord: Client,
    private readonly config: ConfigService,
  ) {}

  // Liveness: the Nest HTTP process can respond.
  getStatus(): string {
    return 'Yuugen API is responding.';
  }

  // Readiness: essential external services are usable. No credentials,
  // versions, hostnames, or internal exception details are exposed.
  async checkReadiness(): Promise<ReadinessReport> {
    const [databaseUp, lavalinkUp] = await Promise.all([
      this.checkDatabase(),
      this.checkLavalink(),
    ]);
    const discordUp = this.discord.isReady();
    const dependencies: ReadinessReport['dependencies'] = {
      database: databaseUp ? 'up' : 'down',
      discord: discordUp ? 'up' : 'down',
      lavalink: lavalinkUp ? 'up' : 'down',
    };

    return {
      status: Object.values(dependencies).every((value) => value === 'up')
        ? 'ready'
        : 'unavailable',
      dependencies,
    };
  }

  private async checkDatabase(): Promise<boolean> {
    if (!this.database.isInitialized) return false;

    // Prevent a stuck query from holding the HTTP readiness route forever.
    const query = this.database.query('SELECT 1')
      .then(() => true)
      .catch(() => false);
    return new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => resolve(false), 2500);
      void query.then((result) => {
        clearTimeout(timeout);
        resolve(result);
      });
    });
  }

  private async checkLavalink(): Promise<boolean> {
    const password = this.config.get<string>('LAVALINK_PASSWORD');
    const host = this.config.get<string>('LAVALINK_HOST') || 'lavalink';
    const port = Number(this.config.get<string>('LAVALINK_PORT') || '2333');

    if (!password || !Number.isInteger(port) || port < 1 || port > 65535) {
      return false;
    }
    try {
      // Lavalink 4's authenticated REST info route verifies that the node
      // accepts the configured password, not just that its port is open.
      const response = await fetch(`http://${host}:${port}/v4/info`, {
        method: 'GET',
        headers: { Authorization: password },
        signal: AbortSignal.timeout(2500),
        cache: 'no-store',
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
