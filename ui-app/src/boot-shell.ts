import { failBootPhase, getBootSequence, subscribeBootSequence, type BootPhaseId } from '@cknerv/ui';
import { bootPresentation } from './boot-presentation';

export const BOOT_SHELL_ID = 'cknerv-startup';
export const BOOT_SHELL_PHASE_ID = 'cknerv-startup-status';
export const BOOT_SHELL_DETAIL_ID = 'cknerv-startup-detail';
export const BOOT_SHELL_RELOAD_ID = 'cknerv-startup-reload';
const BOOT_SHELL_ERROR_ID = 'cknerv-startup-error';
const BOOT_SHELL_DIAGNOSTICS_ID = 'cknerv-startup-diagnostics';
const BOOT_SHELL_DIAGNOSTICS_WRAP_ID = 'cknerv-startup-diagnostics-wrap';
const BOOT_FADE_MS = 400;

declare global {
  interface Window {
    __cknervBootTakeover?: () => void;
    __cknervBootFault?: (text: string) => boolean;
    __cknervBootCleanup?: () => void;
  }
}

export function installBootShellReadout(now: () => number = () => performance.now()): () => void {
  if (typeof document === 'undefined') return () => {};
  window.__cknervBootTakeover?.();
  const shell = document.getElementById(BOOT_SHELL_ID);
  if (!shell) return () => {};
  let timer: ReturnType<typeof setInterval> | null = null;
  let fadeTimer: ReturnType<typeof setTimeout> | null = null;
  let unsubscribe: (() => void) | null = null;
  let destroyed = false;
  const onTransitionEnd = (event: Event): void => {
    if (event.target === shell) destroy();
  };
  const setText = (node: HTMLElement | null, value: string): void => {
    if (node && node.textContent !== value) node.textContent = value;
  };
  const diagnosticText = (): string => {
    const state = getBootSequence();
    const phases = state.phases.map((phase) => `${phase.id.toUpperCase()} ${phase.state.toUpperCase()}`);
    const requests = (state.requests ?? []).map((request) => (
      `${request.kind.toUpperCase()} #${request.attempt} ${request.transport.toUpperCase()} ${request.state.toUpperCase()}`
    ));
    return [...phases, ...requests].join(' · ');
  };
  const destroy = (): void => {
    if (destroyed) return;
    destroyed = true;
    unsubscribe?.();
    unsubscribe = null;
    if (timer !== null) clearInterval(timer);
    timer = null;
    if (fadeTimer !== null) clearTimeout(fadeTimer);
    fadeTimer = null;
    shell.removeEventListener('transitionend', onTransitionEnd);
    shell.remove();
    window.__cknervBootCleanup?.();
    const root = document.getElementById('root');
    if (root) {
      root.inert = false;
      root.removeAttribute('inert');
    }
  };
  const paint = (): void => {
    const state = getBootSequence();
    const presentation = bootPresentation(state, now());
    const paintMesh = (kind: 'cells' | 'chain'): void => {
      const mesh = document.querySelector<SVGGElement>(`[data-boot-mesh="${kind}"]`);
      if (!mesh) return;
      const value = presentation[kind];
      mesh.dataset.state = value.state;
      mesh.dataset.indeterminate = value.indeterminate ? 'true' : 'false';
      mesh.style.setProperty('--boot-progress', String(value.progress ?? 0));
    };
    paintMesh('cells');
    paintMesh('chain');
    shell.dataset.center = state.viewPresented ? 'lit' : 'open';
    const mark = shell.querySelector<SVGElement>('.cknerv-startup-mark');
    if (mark) {
      const describe = (kind: 'cells' | 'chain', label: string): string => {
        const value = presentation[kind];
        if (value.state === 'done') return `${label} snapshot received`;
        if (value.progress !== null) return `${label} snapshot ${Math.floor(value.progress * 100)} percent received`;
        if (value.state === 'active') return `${label} snapshot receiving, total size unknown`;
        return `${label} snapshot ${value.state}`;
      };
      mark.setAttribute('aria-label', `${describe('cells', 'Cell')}. ${describe('chain', 'Chain and Peer')}. ${
        state.viewPresented ? 'First frame displayed.' : 'Waiting for the first frame.'
      }`);
    }
    if (state.viewPresented) {
      const active = document.activeElement;
      const root = document.getElementById('root');
      if (active instanceof HTMLElement && (root?.contains(active) || shell.contains(active))) active.blur();
      if (root) root.inert = true;
      if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) destroy();
      else if (shell.dataset.state !== 'leaving') {
        shell.dataset.state = 'leaving';
        shell.setAttribute('aria-hidden', 'true');
        shell.addEventListener('transitionend', onTransitionEnd);
        fadeTimer = setTimeout(destroy, BOOT_FADE_MS + 150);
      }
      return;
    }
    shell.dataset.state = presentation.state;
    const heading = document.getElementById(BOOT_SHELL_PHASE_ID);
    const detail = document.getElementById(BOOT_SHELL_DETAIL_ID);
    const reload = document.getElementById(BOOT_SHELL_RELOAD_ID);
    const error = document.getElementById(BOOT_SHELL_ERROR_ID);
    const diagnostics = document.getElementById(BOOT_SHELL_DIAGNOSTICS_ID);
    const diagnosticsWrap = document.getElementById(BOOT_SHELL_DIAGNOSTICS_WRAP_ID);
    if (heading) heading.setAttribute('role', presentation.state === 'failed' ? 'alert' : 'status');
    setText(heading, presentation.heading);
    setText(detail, presentation.detail);
    setText(diagnostics, diagnosticText());
    if (reload) reload.hidden = !presentation.showReload;
    if (error) error.hidden = presentation.state !== 'failed';
    if (diagnosticsWrap) diagnosticsWrap.hidden = presentation.state !== 'failed' && presentation.state !== 'waiting';
  };
  unsubscribe = subscribeBootSequence(paint);
  timer = setInterval(paint, 500);
  paint();
  return destroy;
}

export function chargeBootFault(detail: string): BootPhaseId | null {
  const line = getBootSequence().phases.find((phase) => phase.state === 'active' || phase.state === 'pending');
  if (!line || line.id === 'seeding') return null;
  failBootPhase(line.id, detail);
  return line.id;
}

export function showBootShellFault(detail: string): boolean {
  if (typeof window === 'undefined') return false;
  return window.__cknervBootFault?.(detail) === true;
}
