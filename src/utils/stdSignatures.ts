/** The standard function blocks' inputs and outputs (Tc2_Standard), for parameter hints and completion */
import type { PouVariable } from './pouVariables.ts';

const v = (name: string, type: string, scope: 'VAR_INPUT' | 'VAR_OUTPUT' | 'VAR_IN_OUT', comment?: string): PouVariable => ({ name, type, scope, comment });

const TIMER = [v('IN', 'BOOL', 'VAR_INPUT', 'starts the timer'), v('PT', 'TIME', 'VAR_INPUT', 'preset time'), v('Q', 'BOOL', 'VAR_OUTPUT'), v('ET', 'TIME', 'VAR_OUTPUT', 'elapsed time')];
const LTIMER = [v('IN', 'BOOL', 'VAR_INPUT'), v('PT', 'LTIME', 'VAR_INPUT'), v('Q', 'BOOL', 'VAR_OUTPUT'), v('ET', 'LTIME', 'VAR_OUTPUT')];

export const STANDARD_FBS: Record<string, PouVariable[]> = {
  TON: TIMER,
  TOF: TIMER,
  TP: TIMER,
  LTON: LTIMER,
  LTOF: LTIMER,
  LTP: LTIMER,
  R_TRIG: [v('CLK', 'BOOL', 'VAR_INPUT'), v('Q', 'BOOL', 'VAR_OUTPUT', 'TRUE for one cycle on a rising edge')],
  F_TRIG: [v('CLK', 'BOOL', 'VAR_INPUT'), v('Q', 'BOOL', 'VAR_OUTPUT', 'TRUE for one cycle on a falling edge')],
  CTU: [v('CU', 'BOOL', 'VAR_INPUT'), v('RESET', 'BOOL', 'VAR_INPUT'), v('PV', 'WORD', 'VAR_INPUT'), v('Q', 'BOOL', 'VAR_OUTPUT'), v('CV', 'WORD', 'VAR_OUTPUT')],
  CTD: [v('CD', 'BOOL', 'VAR_INPUT'), v('LOAD', 'BOOL', 'VAR_INPUT'), v('PV', 'WORD', 'VAR_INPUT'), v('Q', 'BOOL', 'VAR_OUTPUT'), v('CV', 'WORD', 'VAR_OUTPUT')],
  CTUD: [v('CU', 'BOOL', 'VAR_INPUT'), v('CD', 'BOOL', 'VAR_INPUT'), v('RESET', 'BOOL', 'VAR_INPUT'), v('LOAD', 'BOOL', 'VAR_INPUT'), v('PV', 'WORD', 'VAR_INPUT'), v('QU', 'BOOL', 'VAR_OUTPUT'), v('QD', 'BOOL', 'VAR_OUTPUT'), v('CV', 'WORD', 'VAR_OUTPUT')],
  RS: [v('SET', 'BOOL', 'VAR_INPUT'), v('RESET1', 'BOOL', 'VAR_INPUT', 'dominant'), v('Q1', 'BOOL', 'VAR_OUTPUT')],
  SR: [v('SET1', 'BOOL', 'VAR_INPUT', 'dominant'), v('RESET', 'BOOL', 'VAR_INPUT'), v('Q1', 'BOOL', 'VAR_OUTPUT')],
};

/** The timers and triggers: an instance that is never called never changes its outputs */
export const CALLED_FBS = new Set(Object.keys(STANDARD_FBS));
