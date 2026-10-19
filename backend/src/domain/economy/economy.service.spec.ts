import { EconomyService } from './economy.service';
import { UserProfile } from './user-profile.entity';
import { TriviaSession } from './trivia-session.entity';
import { TriviaQuestion } from './trivia-question.entity';
import { ShopItem } from './shop-item.entity';

describe('EconomyService transactional invariants', () => {
  const user = '123456789012345678';
  const secondUser = '234567890123456789';
  const firstPrompt = '345678901234567890';
  const otherPrompt = '456789012345678901';

  function makeService() {
    const profiles = new Map<string, any>();
    const triviaSessions = new Map<string, any>();
    const questions = [
      {
        id: 1, question: '2 + 2?', options: ['4', '5', '6', '7'],
        correctIndex: 0,
      },
    ];
    const shops = [{ id: 'badge', name: 'Badge', price: 80 }];

    function profileRepo() {
      let incoming: { userId: string } = { userId: '' };
      return {
        createQueryBuilder: () => ({
          insert() { return this; },
          into() { return this; },
          values(values: { userId: string }) { incoming = values; return this; },
          orIgnore() { return this; },
          async execute() {
            if (!profiles.has(incoming.userId)) {
              profiles.set(incoming.userId, {
                userId: incoming.userId,
                coins: 100, bank: 0, xp: 0, level: 1, inventory: [],
                lastDaily: null, lastWork: null, lastCrime: null,
                lastRob: null, lastRps: null, lastTrivia: null,
              });
            }
          },
        }),
        async findOne({ where }: any) {
          const data = profiles.get(where.userId);
          return data ? { ...data, inventory: [...data.inventory] } : null;
        },
        async findOneByOrFail({ userId }: any) {
          const profile = profiles.get(userId);
          if (!profile) throw Error('Profile missing');
          return { ...profile };
        },
        async save(rows: any) {
          for (const item of Array.isArray(rows) ? rows : [rows]) {
            profiles.set(item.userId, { ...item, inventory: [...item.inventory] });
          }
          return rows;
        },
      };
    }

    const transactionRepo = profileRepo();
    const triviaRepo = {
      create(data: any) { return { ...data }; },
      async findOne({ where }: any) {
        const session = triviaSessions.get(where.userId);
        return session ? { ...session } : null;
      },
      async find() { return [...triviaSessions.values()]; },
      async save(session: any) {
        const saved = { createdAt: new Date(), ...session };
        triviaSessions.set(saved.userId, saved);
        return saved;
      },
      async delete({ userId }: any) {
        triviaSessions.delete(userId);
      },
    };
    const questionRepo = {
      async find() { return questions; },
      async findOne({ where }: any) {
        return questions.find((question) => question.id === where.id) || null;
      },
    };
    const shopRepo = {
      async findOne({ where }: any) {
        return shops.find((item) => item.id === where.id) || null;
      },
      async find() { return shops; },
    };

    const manager: any = {
      getRepository(entity: any) {
        if (entity === UserProfile) return transactionRepo;
        if (entity === TriviaSession) return triviaRepo;
        if (entity === TriviaQuestion) return questionRepo;
        if (entity === ShopItem) return shopRepo;
        throw Error('Unknown entity');
      },
    };

    // Mimics the serialization provided by PostgreSQL write-locking. These
    // tests verify application invariants; run real DB concurrency tests
    // separately before deploying.
    let previous = Promise.resolve();
    manager.transaction = async (callback: (tx: any) => Promise<any>) => {
      const ready = previous;
      let release!: () => void;
      previous = new Promise<void>((resolve) => { release = resolve; });
      await ready;
      try { return await callback(manager); }
      finally { release(); }
    };

    const rootProfileRepo = {
      ...profileRepo(), manager,
    };
    const service = new EconomyService(
      rootProfileRepo as any,
      shopRepo as any,
      questionRepo as any,
      triviaRepo as any,
    );
    return { service, profiles, triviaSessions, manager };
  }

  afterEach(() => jest.restoreAllMocks());

  it('never pays the same daily reward twice under concurrent requests', async () => {
    const { service, profiles } = makeService();
    const results = await Promise.all([
      service.claimDaily(user),
      service.claimDaily(user),
    ]);
    expect(results.filter((result) => result.success)).toHaveLength(1);
    expect(profiles.get(user).coins).toBe(200);
  });

  it('only charges once for two simultaneous purchases of the same item', async () => {
    const { service, profiles } = makeService();
    const results = await Promise.all([
      service.buyItem(user, 'badge'),
      service.buyItem(user, 'badge'),
    ]);
    expect(results.filter((result) => result.success)).toHaveLength(1);
    expect(profiles.get(user).coins).toBe(20);
    expect(profiles.get(user).inventory).toEqual(['badge']);
  });

  it('resumes the exact same trivia question after a reload', async () => {
    const { service } = makeService();
    const first = await service.getOrStartTrivia(user);
    const second = await service.getOrStartTrivia(user);
    expect(first.success).toBe(true);
    expect(first.resumed).toBe(false);
    expect(second.resumed).toBe(true);
    expect(second.question).toBe(first.question);
    expect(second.options).toEqual(first.options);
  });

  it('discards expired trivia sessions and pre-migration sessions', async () => {
    const { service, triviaSessions } = makeService();
    await service.getOrStartTrivia(user);
    triviaSessions.get(user).createdAt = new Date(Date.now() - 20 * 60 * 1000);
    const replacement = await service.getOrStartTrivia(user);
    expect(replacement.success).toBe(true);
    expect(replacement.resumed).toBe(false);
    triviaSessions.get(user).questionId = null;
    const legacyReplacement = await service.getOrStartTrivia(user);
    expect(legacyReplacement.success).toBe(true);
    expect(legacyReplacement.resumed).toBe(false);
  });

  it('deletes a trivia session and pays its reward only once', async () => {
    const { service, profiles } = makeService();
    await service.getOrStartTrivia(user);
    const answers = await Promise.all([
      service.answerTrivia(user, 0),
      service.answerTrivia(user, 0),
    ]);
    expect(answers.filter((answer) => answer.success && answer.correct)).toHaveLength(1);
    expect(profiles.get(user).coins).toBe(150);
  });

  it('rejects old Discord buttons and web answers against a Discord prompt', async () => {
    const { service, profiles } = makeService();
    await service.getOrStartTrivia(user);
    await service.bindTriviaMessage(user, firstPrompt);
    expect((await service.answerTrivia(user, 0)).success).toBe(false);
    expect((await service.answerTrivia(user, 0, otherPrompt)).success).toBe(false);
    const answer = await service.answerTrivia(user, 0, firstPrompt);
    expect(answer.success).toBe(true);
    expect(profiles.get(user).coins).toBe(150);
  });

  it('enforces one RPS play per minute from all interfaces', async () => {
    const { service, profiles } = makeService();
    // Bot selects rock. Paper defeats rock.
    jest.spyOn(Math, 'random').mockReturnValue(0.1);
    const results = await Promise.all([
      service.playRps(user, 'paper'),
      service.playRps(user, 'paper'),
    ]);
    expect(results.filter((result) => result.success)).toHaveLength(1);
    expect(results.find((result) => !result.success)?.nextPlay).toBeInstanceOf(Date);
    expect(profiles.get(user).coins).toBe(120);
  });

  it('keeps transferred coins constant across simultaneous reciprocal robberies', async () => {
    const { service, profiles } = makeService();
    jest.spyOn(Math, 'random').mockReturnValue(0.1);
    const results = await Promise.all([
      service.rob(user, secondUser),
      service.rob(secondUser, user),
    ]);
    expect(results).toHaveLength(2);
    expect(profiles.get(user).coins + profiles.get(secondUser).coins).toBe(200);
    expect((await service.rob(user, user)).isSelf).toBe(true);
  });

  it('rejects fractional, zero, and negative wager amounts', async () => {
    const { service } = makeService();
    await expect(service.gamble(user, 0)).rejects.toThrow();
    await expect(service.gamble(user, -1)).rejects.toThrow();
    await expect(service.gamble(user, 3.5)).rejects.toThrow();
  });
});
