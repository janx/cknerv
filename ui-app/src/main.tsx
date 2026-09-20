import { completeBootPhase, getBootSequence, markBootModuleStarted } from '@cknerv/ui/boot';
import { installBootShellReadout, chargeBootFault, showBootShellFault } from './boot-shell';
import { bootstrap } from './startup';

completeBootPhase('instrument');
markBootModuleStarted(performance.now());
installBootShellReadout();

void bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  if (!(getBootSequence().modules ?? []).some((module) => module.state === 'failed')) {
    chargeBootFault(message);
  }
  showBootShellFault(message);
});
