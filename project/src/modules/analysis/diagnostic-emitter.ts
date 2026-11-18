import type {AnalysisDiagnosticPhase} from '../../contracts/analysis.ts';

/** Coalesce text activity while delivering boundary events immediately. */
export function createDiagnosticEmitter(send?: (phase:Exclude<AnalysisDiagnosticPhase,'validating'>,ageMs?:number)=>void, clock:()=>number = ()=>performance.now(), intervalMs=250) {
  let lastSent = -Infinity;
  let pending = false;
  let pendingAt = 0;
  let timer:ReturnType<typeof setTimeout>|undefined;
  const flush = () => {
    if (timer) { clearTimeout(timer); timer=undefined; }
    if (!pending) return;
    pending = false;
    lastSent = clock();
    send?.('last_text',Math.max(0,clock()-pendingAt));
  };
  const emit = (phase:Exclude<AnalysisDiagnosticPhase,'validating'>) => {
    if (phase !== 'last_text') {
      flush();
      send?.(phase,0);
      return;
    }
    if (clock() - lastSent >= intervalMs) {
      if (timer) { clearTimeout(timer); timer=undefined; }
      lastSent = clock();
      pending = false;
      send?.(phase,0);
    } else {
      pending = true;
      pendingAt = clock();
      if (!timer) timer=setTimeout(flush,Math.max(0,intervalMs-(clock()-lastSent)));
    }
  };
  return Object.assign(emit,{flush});
}
