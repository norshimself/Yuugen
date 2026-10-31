import { ConfigService } from '@nestjs/config';
import { PrivacyRetentionWorker } from './privacy-retention.worker';
import { PrivacyService } from './privacy.service';

function setup(enabled=false){
  const privacy={
    pruneExpiredEphemeral:jest.fn().mockResolvedValue({
      sessions:0,triviaSessions:0,
    }),
  };
  const config={
    get:jest.fn().mockReturnValue(enabled?'true':'false'),
  };
  return {
    privacy,config,
    worker:new PrivacyRetentionWorker(
      privacy as unknown as PrivacyService,
      config as unknown as ConfigService,
    ),
  };
}

describe('Privacy retention worker is opt-in and nonoverlapping',()=>{
  it('does not access the database when the feature flag is disabled',async()=>{
    const {worker,privacy}=setup();
    worker.onModuleInit();
    await worker.onModuleDestroy();
    expect(privacy.pruneExpiredEphemeral).not.toHaveBeenCalled();
  });

  it('runs a bounded startup sweep only when explicitly enabled',async()=>{
    const {worker,privacy}=setup(true);
    worker.onModuleInit();
    await Promise.resolve();
    await worker.onModuleDestroy();
    expect(privacy.pruneExpiredEphemeral).toHaveBeenCalledTimes(1);
  });

  it('never emits user or session data via the public worker result',async()=>{
    const {worker,privacy}=setup(true);
    privacy.pruneExpiredEphemeral.mockResolvedValueOnce({
      sessions:250,triviaSessions:12,
    });
    worker.onModuleInit();
    await Promise.resolve();
    await worker.onModuleDestroy();
    expect(privacy.pruneExpiredEphemeral).toHaveBeenCalledTimes(1);
  });
});
