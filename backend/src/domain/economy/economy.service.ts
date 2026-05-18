import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserProfile } from './user-profile.entity';
import { ShopItem } from './shop-item.entity';
import { TriviaQuestion } from './trivia-question.entity';
import { TriviaSession } from './trivia-session.entity';

@Injectable()
export class EconomyService implements OnModuleInit {
  constructor(
    @InjectRepository(UserProfile)
    private userProfileRepository: Repository<UserProfile>,
    @InjectRepository(ShopItem)
    private shopItemRepository: Repository<ShopItem>,
    @InjectRepository(TriviaQuestion)
    private triviaQuestionRepository: Repository<TriviaQuestion>,
    @InjectRepository(TriviaSession)
    private triviaSessionRepository: Repository<TriviaSession>,
  ) {}

  async onModuleInit() {
    // Seed shop items if empty
    const count = await this.shopItemRepository.count();
    if (count === 0) {
      const defaultItems = [
        { id: 'vip_role', name: 'VIP Role', price: 1000, description: 'Get the shiny VIP role in the server!' },
        { id: 'custom_color', name: 'Custom Color', price: 500, description: 'Change your name color!' },
        { id: 'profile_badge', name: 'Profile Badge', price: 250, description: 'A cool badge on your profile!' },
      ];
      await this.shopItemRepository.save(defaultItems);
      console.log('Seeded default shop items.');
    }

    // Seed trivia questions if empty
    const triviaCount = await this.triviaQuestionRepository.count();
    if (triviaCount === 0) {
      const defaultQuestions = [
        { question: 'What is the capital of France?', options: ['Paris', 'London', 'Berlin', 'Madrid'], correctIndex: 0 },
        { question: 'What is 2 + 2?', options: ['3', '4', '5', '6'], correctIndex: 1 },
        { question: 'What is the largest ocean?', options: ['Atlantic', 'Indian', 'Arctic', 'Pacific'], correctIndex: 3 },
        { question: 'Who wrote "Romeo and Juliet"?', options: ['Charles Dickens', 'William Shakespeare', 'Mark Twain', 'Jane Austen'], correctIndex: 1 },
        { question: 'What is the chemical symbol for gold?', options: ['Gd', 'Go', 'Ag', 'Au'], correctIndex: 3 },
      ];
      await this.triviaQuestionRepository.save(defaultQuestions);
      console.log('Seeded default trivia questions.');
    }
  }

  async getRandomTriviaQuestion(): Promise<TriviaQuestion> {
    const questions = await this.triviaQuestionRepository.find();
    const randomIdx = Math.floor(Math.random() * questions.length);
    return questions[randomIdx];
  }

  async startTriviaSession(userId: string, correctIndex: number, reward: number): Promise<TriviaSession> {
    const session = this.triviaSessionRepository.create({ userId, correctIndex, reward });
    return this.triviaSessionRepository.save(session);
  }

  async getTriviaSession(userId: string): Promise<TriviaSession | null> {
    return this.triviaSessionRepository.findOne({ where: { userId } });
  }

  async deleteTriviaSession(userId: string): Promise<void> {
    await this.triviaSessionRepository.delete(userId);
  }

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

  async work(userId: string): Promise<{ success: boolean; amount: number; nextClaim?: Date; job?: string }> {
    const profile = await this.getProfile(userId);
    const now = new Date();
    
    if (profile.lastWork) {
      const oneHour = 60 * 60 * 1000;
      const timePassed = now.getTime() - profile.lastWork.getTime();
      
      if (timePassed < oneHour) {
        const nextClaim = new Date(profile.lastWork.getTime() + oneHour);
        return { success: false, amount: 0, nextClaim };
      }
    }
    
    const amount = Math.floor(Math.random() * (100 - 50 + 1)) + 50; // 50-100
    const jobs = [
      'Developer', 'Designer', 'Chef', 'Streamer', 'Gamer',
      'Doctor', 'Lawyer', 'Astronaut', 'Musician', 'Artist'
    ];
    const job = jobs[Math.floor(Math.random() * jobs.length)];
    
    profile.coins += amount;
    profile.lastWork = now;
    await this.userProfileRepository.save(profile);
    
    return { success: true, amount, job };
  }

  async crime(userId: string): Promise<{ success: boolean; won: boolean; amount: number; nextClaim?: Date; crime?: string }> {
    const profile = await this.getProfile(userId);
    const now = new Date();
    
    if (profile.lastCrime) {
      const twoHours = 2 * 60 * 60 * 1000;
      const timePassed = now.getTime() - profile.lastCrime.getTime();
      
      if (timePassed < twoHours) {
        const nextClaim = new Date(profile.lastCrime.getTime() + twoHours);
        return { success: false, won: false, amount: 0, nextClaim };
      }
    }
    
    const won = Math.random() < 0.5;
    const amount = won 
      ? Math.floor(Math.random() * (500 - 200 + 1)) + 200 // 200-500
      : Math.floor(Math.random() * (200 - 100 + 1)) + 100; // 100-200 fine
      
    const crimes = [
      'robbed a bank', 'stole a candy', 'hacked the Pentagon',
      'jaywalked', 'stole a car', 'pirated a movie'
    ];
    const crime = crimes[Math.floor(Math.random() * crimes.length)];
    
    if (won) {
      profile.coins += amount;
    } else {
      profile.coins = Math.max(0, profile.coins - amount); // Don't go below 0
    }
    
    profile.lastCrime = now;
    await this.userProfileRepository.save(profile);
    
    return { success: true, won, amount, crime };
  }

  async rob(userId: string, targetId: string): Promise<{ success: boolean; won: boolean; amount: number; nextClaim?: Date; isTooPoor?: boolean }> {
    const profile = await this.getProfile(userId);
    const targetProfile = await this.getProfile(targetId);
    const now = new Date();
    
    if (profile.lastRob) {
      const fourHours = 4 * 60 * 60 * 1000;
      const timePassed = now.getTime() - profile.lastRob.getTime();
      
      if (timePassed < fourHours) {
        const nextClaim = new Date(profile.lastRob.getTime() + fourHours);
        return { success: false, won: false, amount: 0, nextClaim };
      }
    }
    
    if (targetProfile.coins < 50) {
      return { success: false, won: false, amount: 0, isTooPoor: true };
    }
    
    const won = Math.random() < 0.4; // 40% success rate
    
    // Rob up to 30% of target's coins
    const maxRob = Math.floor(targetProfile.coins * 0.3);
    const amount = Math.floor(Math.random() * (maxRob - 10 + 1)) + 10;
    
    if (won) {
      profile.coins += amount;
      targetProfile.coins -= amount;
    } else {
      // Pay fine to victim
      const fine = Math.floor(amount * 0.5); // Fine is 50% of intended rob amount
      profile.coins = Math.max(0, profile.coins - fine);
      targetProfile.coins += fine;
    }
    
    profile.lastRob = now;
    await this.userProfileRepository.save(profile);
    await this.userProfileRepository.save(targetProfile);
    
    return { success: true, won, amount };
  }

  async getShopItems(): Promise<ShopItem[]> {
    return this.shopItemRepository.find();
  }

  async buyItem(userId: string, itemId: string): Promise<{ success: boolean; message: string; newBalance?: number }> {
    const profile = await this.getProfile(userId);
    const item = await this.shopItemRepository.findOne({ where: { id: itemId } });
    
    if (!item) {
      return { success: false, message: 'Item not found in shop!' };
    }
    
    if (profile.coins < item.price) {
      return { success: false, message: `You don't have enough coins! You need **${item.price}** coins.` };
    }
    
    // Check if already owned
    const inventory = profile.inventory || [];
    if (inventory.includes(itemId)) {
      return { success: false, message: 'You already own this item!' };
    }
    
    profile.coins -= item.price;
    profile.inventory = [...inventory, itemId];
    
    await this.userProfileRepository.save(profile);
    
    return { success: true, message: `Successfully purchased **${item.name}**!`, newBalance: profile.coins };
  }
}
