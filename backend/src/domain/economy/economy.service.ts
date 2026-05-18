import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserProfile } from './user-profile.entity';

@Injectable()
export class EconomyService {
  constructor(
    @InjectRepository(UserProfile)
    private userProfileRepository: Repository<UserProfile>,
  ) {}

  async getProfile(userId: string): Promise<UserProfile> {
    let profile = await this.userProfileRepository.findOne({ where: { userId } });
    if (!profile) {
      profile = this.userProfileRepository.create({ userId });
      await this.userProfileRepository.save(profile);
    }
    return profile;
  }

  async addXp(userId: string, amount: number): Promise<{ leveledUp: boolean; level: number }> {
    const profile = await this.getProfile(userId);
    profile.xp += amount;
    
    // Simple leveling formula: level * 100 XP needed for next level
    const xpNeeded = profile.level * 100;
    let leveledUp = false;
    
    if (profile.xp >= xpNeeded) {
      profile.level += 1;
      profile.xp -= xpNeeded; 
      leveledUp = true;
    }
    
    await this.userProfileRepository.save(profile);
    return { leveledUp, level: profile.level };
  }

  async addCoins(userId: string, amount: number): Promise<number> {
    const profile = await this.getProfile(userId);
    profile.coins += amount;
    await this.userProfileRepository.save(profile);
    return profile.coins;
  }

  async claimDaily(userId: string): Promise<{ success: boolean; amount: number; nextClaim?: Date }> {
    const profile = await this.getProfile(userId);
    const now = new Date();
    
    if (profile.lastDaily) {
      const oneDay = 24 * 60 * 60 * 1000;
      const timePassed = now.getTime() - profile.lastDaily.getTime();
      
      if (timePassed < oneDay) {
        const nextClaim = new Date(profile.lastDaily.getTime() + oneDay);
        return { success: false, amount: 0, nextClaim };
      }
    }
    
    const dailyAmount = 100; 
    profile.coins += dailyAmount;
    profile.lastDaily = now;
    await this.userProfileRepository.save(profile);
    
    return { success: true, amount: dailyAmount };
  }

  async getLeaderboard(limit: number = 10): Promise<UserProfile[]> {
    return this.userProfileRepository.find({
      order: { level: 'DESC', xp: 'DESC' },
      take: limit,
    });
  }

  async gamble(userId: string, amount: number): Promise<{ success: boolean; won: boolean; newBalance: number; amount: number }> {
    const profile = await this.getProfile(userId);
    
    if (profile.coins < amount) {
      return { success: false, won: false, newBalance: profile.coins, amount: 0 };
    }
    
    const won = Math.random() < 0.5;
    
    if (won) {
      profile.coins += amount;
    } else {
      profile.coins -= amount;
    }
    
    await this.userProfileRepository.save(profile);
    
    return { success: true, won, newBalance: profile.coins, amount };
  }
}
