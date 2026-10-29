import { createCommandGroupDecorator } from 'necord';

export const VerificationGroup = createCommandGroupDecorator({
  name: 'verify',
  description: 'Opt-in member verification and quarantine management',
});
