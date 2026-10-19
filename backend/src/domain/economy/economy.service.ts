import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
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
        {
          id: 'vip_role',
          name: 'VIP Role',
          price: 1000,
          description: 'Get the shiny VIP role in the server!',
        },
        {
          id: 'custom_color',
          name: 'Custom Color',
          price: 500,
          description: 'Change your name color!',
        },
        {
          id: 'profile_badge',
          name: 'Profile Badge',
          price: 250,
          description: 'A cool badge on your profile!',
        },
      ];
      await this.shopItemRepository.save(defaultItems);
      console.log('Seeded default shop items.');
    }

    // Seed trivia questions if empty
    const triviaCount = await this.triviaQuestionRepository.count();
    if (triviaCount === 0) {
      const defaultQuestions = [
        {
          question: 'What is the capital of France?',
          options: ['Paris', 'London', 'Berlin', 'Madrid'],
          correctIndex: 0,
        },
        {
          question: 'What is 2 + 2?',
          options: ['3', '4', '5', '6'],
          correctIndex: 1,
        },
        {
          question: 'What is the largest ocean?',
          options: ['Atlantic', 'Indian', 'Arctic', 'Pacific'],
          correctIndex: 3,
        },
        {
          question: 'Who wrote "Romeo and Juliet"?',
          options: [
            'Charles Dickens',
            'William Shakespeare',
            'Mark Twain',
            'Jane Austen',
          ],
          correctIndex: 1,
        },
        {
          question: 'What is the chemical symbol for gold?',
          options: ['Gd', 'Go', 'Ag', 'Au'],
          correctIndex: 3,
        },
      ];
      await this.triviaQuestionRepository.save(defaultQuestions);
      console.log('Seeded default trivia questions.');
    }
  }

  // User balances remain GLOBAL across guilds. Do not silently re-key
  // existing currency or inventory without a planned data migration.
  private readonly maxCoins = 2_147_483_647;
  private readonly triviaLifetimeMs = 15 * 60 * 1000;
  private readonly rpsCooldownMs = 60 * 1000;

  /** Insert-or-ignore makes first-time account creation safe under concurrency. */
  private async lockProfile(
    manager: EntityManager,
    userId: string,
  ): Promise<UserProfile> {
    const profiles = manager.getRepository(UserProfile);
    await profiles.createQueryBuilder()
      .insert()
      .into(UserProfile)
      .values({ userId })
      .orIgnore()
      .execute();

    const profile = await profiles.findOne({
      where: { userId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!profile) throw new Error('Unable to initialize economy profile');
    return profile;
  }

  private withProfileLock<T>(
    userId: string,
    run: (manager: EntityManager, profile: UserProfile) => Promise<T>,
  ): Promise<T> {
    return this.userProfileRepository.manager.transaction(async (manager) => {
      const profile = await this.lockProfile(manager, userId);
      return run(manager, profile);
    });
  }

  private credit(profile: UserProfile, amount: number): void {
    if (!Number.isSafeInteger(amount) || amount < 0 ||
        profile.coins > this.maxCoins - amount) {
      throw new BadRequestException('Invalid coin reward or balance limit reached');
    }
    profile.coins += amount;
  }

  async getProfile(userId: string): Promise<UserProfile> {
    // No read-then-insert race when two Discord/API events initialize a user.
    await this.userProfileRepository.createQueryBuilder()
      .insert()
      .into(UserProfile)
      .values({ userId })
      .orIgnore()
      .execute();
    return this.userProfileRepository.findOneByOrFail({ userId });
  }

  async addXp(
    userId: string,
    amount: number,
  ): Promise<{ leveledUp: boolean; level: number }> {
    if (!Number.isSafeInteger(amount) || amount < 0 || amount > 1000) {
      throw new BadRequestException('Invalid XP amount');
    }
    return this.withProfileLock(userId, async (manager, profile) => {
      profile.xp += amount;
      let leveledUp = false;
      while (profile.xp >= profile.level * 100) {
        profile.xp -= profile.level * 100;
        profile.level += 1;
        leveledUp = true;
      }
      await manager.getRepository(UserProfile).save(profile);
      return { leveledUp, level: profile.level };
    });
  }

  async addCoins(userId: string, amount: number): Promise<number> {
    if (!Number.isSafeInteger(amount) || amount < 0 || amount > 1_000_000) {
      throw new BadRequestException('Invalid coin amount');
    }
    return this.withProfileLock(userId, async (manager, profile) => {
      this.credit(profile, amount);
      await manager.getRepository(UserProfile).save(profile);
      return profile.coins;
    });
  }

  async claimDaily(
    userId: string,
  ): Promise<{ success: boolean; amount: number; nextClaim?: Date }> {
    return this.withProfileLock(userId, async (manager, profile) => {
      const now = new Date();
      const windowMs = 24 * 60 * 60 * 1000;
      if (profile.lastDaily && now.getTime() - profile.lastDaily.getTime() < windowMs) {
        return {
          success: false, amount: 0,
          nextClaim: new Date(profile.lastDaily.getTime() + windowMs),
        };
      }

      this.credit(profile, 100);
      profile.lastDaily = now;
      await manager.getRepository(UserProfile).save(profile);
      return { success: true, amount: 100 };
    });
  }

  async getLeaderboard(limit = 10): Promise<UserProfile[]> {
    const take = Number.isFinite(limit)
      ? Math.max(1, Math.min(100, Math.floor(limit)))
      : 10;
    return this.userProfileRepository.find({
      order: { level: 'DESC', xp: 'DESC' },
      take,
    });
  }

  async gamble(
    userId: string,
    amount: number,
  ): Promise<{ success: boolean; won: boolean; newBalance: number; amount: number }> {
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 100_000) {
      throw new BadRequestException('Bet must be between 1 and 100,000 coins');
    }

    return this.withProfileLock(userId, async (manager, profile) => {
      if (profile.coins < amount) {
        return { success: false, won: false, newBalance: profile.coins, amount: 0 };
      }
      const won = Math.random() < 0.5;
      if (won) this.credit(profile, amount);
      else profile.coins -= amount;

      await manager.getRepository(UserProfile).save(profile);
      return { success: true, won, newBalance: profile.coins, amount };
    });
  }

  async work(userId: string): Promise<{
    success: boolean;
    amount: number;
    nextClaim?: Date;
    job?: string;
  }> {
    return this.withProfileLock(userId, async (manager, profile) => {
      const now = new Date();
      const windowMs = 60 * 60 * 1000;
      if (profile.lastWork && now.getTime() - profile.lastWork.getTime() < windowMs) {
        return {
          success: false, amount: 0,
          nextClaim: new Date(profile.lastWork.getTime() + windowMs),
        };
      }
      const amount = Math.floor(Math.random() * 51) + 50;
      const jobs = [
        'Developer', 'Designer', 'Chef', 'Streamer', 'Gamer',
        'Doctor', 'Lawyer', 'Astronaut', 'Musician', 'Artist',
      ];
      const job = jobs[Math.floor(Math.random() * jobs.length)];
      this.credit(profile, amount);
      profile.lastWork = now;
      await manager.getRepository(UserProfile).save(profile);
      return { success: true, amount, job };
    });
  }

  async crime(userId: string): Promise<{
    success: boolean;
    won: boolean;
    amount: number;
    nextClaim?: Date;
    crime?: string;
  }> {
    return this.withProfileLock(userId, async (manager, profile) => {
      const now = new Date();
      const windowMs = 2 * 60 * 60 * 1000;
      if (profile.lastCrime && now.getTime() - profile.lastCrime.getTime() < windowMs) {
        return {
          success: false, won: false, amount: 0,
          nextClaim: new Date(profile.lastCrime.getTime() + windowMs),
        };
      }

      const won = Math.random() < 0.5;
      const amount = won
        ? Math.floor(Math.random() * 301) + 200
        : Math.floor(Math.random() * 101) + 100;
      const crimes = [
        'robbed a bank', 'stole a candy', 'hacked the Pentagon',
        'jaywalked', 'stole a car', 'pirated a movie',
      ];
      const crime = crimes[Math.floor(Math.random() * crimes.length)];
      const effectiveAmount = won ? amount : Math.min(profile.coins, amount);
      if (won) this.credit(profile, amount);
      else profile.coins -= effectiveAmount;
      profile.lastCrime = now;
      await manager.getRepository(UserProfile).save(profile);
      return { success: true, won, amount: effectiveAmount, crime };
    });
  }

  async rob(
    userId: string,
    targetId: string,
  ): Promise<{
    success: boolean;
    won: boolean;
    amount: number;
    nextClaim?: Date;
    isTooPoor?: boolean;
    isSelf?: boolean;
  }> {
    if (userId === targetId) {
      return { success: false, won: false, amount: 0, isSelf: true };
    }
    if (!/^\d{17,20}$/.test(targetId)) {
      throw new BadRequestException('Invalid target Discord user');
    }

    // Acquire both locks in a deterministic order to avoid reciprocal-rob
    // deadlocks. Either all money moves, or none of it does.
    return this.userProfileRepository.manager.transaction(async (manager) => {
      const sorted = [userId, targetId].sort();
      const locked = new Map<string, UserProfile>();
      for (const id of sorted) {
        locked.set(id, await this.lockProfile(manager, id));
      }
      const profile = locked.get(userId)!;
      const target = locked.get(targetId)!;
      const now = new Date();
      const windowMs = 4 * 60 * 60 * 1000;
      if (profile.lastRob && now.getTime() - profile.lastRob.getTime() < windowMs) {
        return {
          success: false, won: false, amount: 0,
          nextClaim: new Date(profile.lastRob.getTime() + windowMs),
        };
      }
      if (target.coins < 50) {
        return { success: false, won: false, amount: 0, isTooPoor: true };
      }

      const won = Math.random() < 0.4;
      const maxRob = Math.floor(target.coins * 0.3);
      const intended = Math.floor(Math.random() * (maxRob - 9)) + 10;
      let actual: number;
      if (won) {
        actual = intended;
        this.credit(profile, actual);
        target.coins -= actual;
      } else {
        actual = Math.min(profile.coins, Math.floor(intended * 0.5));
        profile.coins -= actual;
        this.credit(target, actual);
      }

      profile.lastRob = now;
      await manager.getRepository(UserProfile).save([profile, target]);
      return { success: true, won, amount: actual };
    });
  }

  async getShopItems(): Promise<ShopItem[]> {
    return this.shopItemRepository.find();
  }

  async buyItem(
    userId: string,
    itemId: string,
  ): Promise<{ success: boolean; message: string; newBalance?: number }> {
    const item = await this.shopItemRepository.findOne({ where: { id: itemId } });
    if (!item) return { success: false, message: 'Item not found in shop!' };
    if (!Number.isSafeInteger(item.price) || item.price < 0) {
      throw new BadRequestException('Shop item has an invalid price');
    }

    return this.withProfileLock(userId, async (manager, profile) => {
      const inventory = profile.inventory || [];
      if (inventory.includes(itemId)) {
        return { success: false, message: 'You already own this item!' };
      }
      if (profile.coins < item.price) {
        return {
          success: false,
          message: `You don't have enough coins! You need **${item.price}** coins.`,
        };
      }

      profile.coins -= item.price;
      profile.inventory = [...inventory, itemId];
      await manager.getRepository(UserProfile).save(profile);
      return {
        success: true,
        message: `Successfully purchased **${item.name}**!`,
        newBalance: profile.coins,
      };
    });
  }

  private sessionExpiry(session: TriviaSession): Date {
    return new Date(new Date(session.createdAt).getTime() + this.triviaLifetimeMs);
  }

  /**
   * Resumes any unexpired question after page reload or a second /trivia call.
   * Older sessions without a questionId are cleaned up automatically.
   */
  async getOrStartTrivia(userId: string): Promise<{
    success: boolean;
    question?: string;
    options?: string[];
    reward?: number;
    expiresAt?: Date;
    resumed?: boolean;
    message?: string;
  }> {
    return this.withProfileLock(userId, async (manager) => {
      const sessions = manager.getRepository(TriviaSession);
      const questions = manager.getRepository(TriviaQuestion);
      const existing = await sessions.findOne({ where: { userId } });
      if (existing) {
        const expiresAt = this.sessionExpiry(existing);
        if (expiresAt > new Date() && existing.questionId !== null &&
            existing.questionId !== undefined) {
          const question = await questions.findOne({
            where: { id: existing.questionId },
          });
          if (question) {
            return {
              success: true,
              question: question.question,
              options: question.options,
              reward: existing.reward,
              expiresAt,
              resumed: true,
            };
          }
        }
        await sessions.delete({ userId });
      }

      const available = await questions.find();
      if (available.length === 0) {
        return { success: false, message: 'No trivia questions are available.' };
      }

      const chosen = available[Math.floor(Math.random() * available.length)];
      const reward = 50;
      await sessions.save(sessions.create({
        userId,
        questionId: chosen.id,
        messageId: null,
        correctIndex: chosen.correctIndex,
        reward,
      }));
      return {
        success: true,
        question: chosen.question,
        options: chosen.options,
        reward,
        expiresAt: new Date(Date.now() + this.triviaLifetimeMs),
        resumed: false,
      };
    });
  }

  /**
   * Binds Discord's button message to the session. Buttons from older
   * messages cannot be replayed against newer questions.
   */
  async bindTriviaMessage(userId: string, messageId: string): Promise<void> {
    if (!/^\d{17,20}$/.test(messageId)) {
      throw new BadRequestException('Invalid Discord trivia prompt ID');
    }
    await this.withProfileLock(userId, async (manager) => {
      const sessions = manager.getRepository(TriviaSession);
      const session = await sessions.findOne({ where: { userId } });
      if (!session || this.sessionExpiry(session) <= new Date()) return;
      session.messageId = messageId;
      await sessions.save(session);
    });
  }

  async answerTrivia(
    userId: string,
    answerIndex: number,
    promptId?: string,
  ): Promise<{
    success: boolean;
    correct?: boolean;
    correctIndex?: number;
    reward?: number;
    newBalance?: number;
    message?: string;
  }> {
    if (!Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex > 3) {
      throw new BadRequestException('Invalid trivia answer index');
    }

    return this.withProfileLock(userId, async (manager, profile) => {
      const sessions = manager.getRepository(TriviaSession);
      const game = await sessions.findOne({ where: { userId } });
      if (!game) {
        return { success: false, message: 'No active trivia game.' };
      }
      if (this.sessionExpiry(game) <= new Date() ||
          game.questionId == null) {
        await sessions.delete({ userId });
        return { success: false, message: 'Trivia expired. Start a new game.' };
      }
      if (promptId ? game.messageId !== promptId : !!game.messageId) {
        return {
          success: false,
          message: 'This trivia question belongs to another active prompt.',
        };
      }

      // Delete and pay out in the SAME transaction. A repeated or concurrent
      // answer cannot credit the coins more than once.
      await sessions.delete({ userId });
      const correct = answerIndex === game.correctIndex;
      if (correct) {
        this.credit(profile, game.reward);
        await manager.getRepository(UserProfile).save(profile);
      }
      return {
        success: true,
        correct,
        correctIndex: game.correctIndex,
        reward: correct ? game.reward : 0,
        newBalance: profile.coins,
      };
    });
  }

  /** A server-side per-user RPS cooldown, shared by Discord and the website. */
  async playRps(
    userId: string,
    userChoice: 'rock' | 'paper' | 'scissors',
  ): Promise<{
    success: boolean;
    userChoice: string;
    botChoice: string;
    result: 'win' | 'lose' | 'tie';
    reward: number;
    newBalance?: number;
    nextPlay?: Date;
  }> {
    if (!['rock', 'paper', 'scissors'].includes(userChoice)) {
      throw new BadRequestException('Invalid rock-paper-scissors choice');
    }
    return this.withProfileLock(userId, async (manager, profile) => {
      const now = new Date();
      if (profile.lastRps &&
          now.getTime() - profile.lastRps.getTime() < this.rpsCooldownMs) {
        return {
          success: false,
          userChoice,
          botChoice: '',
          result: 'tie',
          reward: 0,
          newBalance: profile.coins,
          nextPlay: new Date(profile.lastRps.getTime() + this.rpsCooldownMs),
        };
      }
      const choices = ['rock', 'paper', 'scissors'] as const;
      const botChoice = choices[Math.floor(Math.random() * choices.length)];
      const result = userChoice === botChoice ? 'tie'
        : (userChoice === 'rock' && botChoice === 'scissors') ||
          (userChoice === 'paper' && botChoice === 'rock') ||
          (userChoice === 'scissors' && botChoice === 'paper')
          ? 'win' : 'lose';
      const reward = result === 'win' ? 20 : 0;
      this.credit(profile, reward);
      profile.lastRps = now;
      await manager.getRepository(UserProfile).save(profile);
      return {
        success: true,
        userChoice,
        botChoice,
        result,
        reward,
        newBalance: profile.coins,
      };
    });
  }
}
