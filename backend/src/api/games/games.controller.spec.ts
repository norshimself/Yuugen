import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA } from '@nestjs/common/constants';
import { EconomyService } from '../../domain/economy/economy.service';
import { GamesController } from './games.controller';

describe('GamesController API contracts', () => {
  const userId = '123456789012345678';

  it('requires POST to create or resume trivia because it mutates session state', () => {
    expect(
      Reflect.getMetadata(METHOD_METADATA, GamesController.prototype.getTriviaQuestion),
    ).toBe(RequestMethod.POST);
  });

  it('uses the authenticated JWT user ID, not a client-submitted identity', async () => {
    const economy = {
      getOrStartTrivia: jest.fn().mockResolvedValue({
        success: true, question: 'Test question', options: ['A', 'B', 'C', 'D'],
      }),
      answerTrivia: jest.fn().mockResolvedValue({ success: true, correct: false }),
      playRps: jest.fn().mockResolvedValue({ success: true, result: 'tie' }),
    } as unknown as EconomyService;
    const controller = new GamesController(economy);
    const request = { user: { id: userId } };

    await controller.getTriviaQuestion(request);
    expect(economy.getOrStartTrivia).toHaveBeenCalledWith(userId);

    await controller.answerTrivia(request, { answerIndex: 2 });
    expect(economy.answerTrivia).toHaveBeenCalledWith(userId, 2);

    await controller.playRps(request, { choice: 'rock' });
    expect(economy.playRps).toHaveBeenCalledWith(userId, 'rock');
  });
});
