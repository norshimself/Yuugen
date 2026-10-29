import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OnboardingReceipt } from './onboarding-receipt.entity';
import { OnboardingService } from './onboarding.service';

@Module({
  imports: [TypeOrmModule.forFeature([OnboardingReceipt])],
  providers: [OnboardingService],
  exports: [OnboardingService],
})
export class OnboardingModule {}
