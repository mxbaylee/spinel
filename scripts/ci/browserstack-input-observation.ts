/** Temporary, content-free observations for the existing native typing owner. */
export const inputEventTypes = [
  'keydown',
  'keyup',
  'beforeinput',
  'input',
  'compositionstart',
  'compositionend',
  'focusin',
  'focusout',
] as const;
export const inputEventLimit = 16;

export const inputCounterInstallScript = `
  const key='__spinelInputCount';window[key]?.stop();
  const types=${JSON.stringify(inputEventTypes)},limit=${inputEventLimit};
  const isEditor=(node)=>Boolean(node?.matches?.('[contenteditable="true"][data-u-comp="editor"]'));
  let count=0,sequence=0,index=null,start=0,dropped=0,stopped=false,entries=[];
  const finalize=()=>{for(const entry of entries){
    if(entry.event && entry.event.eventPhase===0){
      entry.row.preventedAfterDispatch=entry.event.defaultPrevented===true;
      entry.event=null;
    }
  }};
  const keep=(event)=>{
    if(stopped||window[key]!==counter)return;
    if(event.type==='input'&&typeof event.inputType==='string'&&event.inputType.startsWith('insert'))count++;
    const current=sequence++;
    if(entries.length>=limit){dropped++;return;}
    entries.push({event,row:{sequence:current,type:event.type,trusted:event.isTrusted===true,
      insertion:typeof event.inputType==='string'&&event.inputType.startsWith('insert'),
      composing:event.isComposing===true,editor:isEditor(event.target),
      targetIsActive:event.target===document.activeElement,
      preventedAtCapture:event.defaultPrevented===true,preventedAfterDispatch:null}});
  };
  const counter={
    mark:(next)=>{
      if(stopped||window[key]!==counter||!Number.isSafeInteger(next)||next<0)return false;
      finalize();if(entries.some(entry=>entry.event))return false;
      index=next;start=sequence;entries=[];return true;
    },
    read:()=>{
      finalize();const node=document.activeElement;
      const comp=node?.closest?.('[data-u-comp]')?.getAttribute('data-u-comp');
      return {installed:true,count,focus:typeof comp==='string'?comp.slice(0,40):null,editor:isEditor(node),
        trace:{current:!stopped&&window[key]===counter,index,start,end:sequence,dropped,
          pending:entries.filter(entry=>entry.event).length,events:entries.map(entry=>({...entry.row}))}};
    },
    stop:()=>{stopped=true;for(const type of types)document.removeEventListener(type,keep,true);
      entries=[];if(window[key]===counter)delete window[key];}
  };
  window[key]=counter;for(const type of types)document.addEventListener(type,keep,{capture:true,passive:true});
  return true;
`;

/** Uses the existing focus read to mark an observation range, never to focus. */
export const inputCounterFocusScript = `
  const node=document.activeElement;
  if(!node?.matches('[contenteditable="true"][data-u-comp="editor"]'))return null;
  if(!window.__spinelInputCount?.mark(arguments[0]))throw new Error('native-input-observation-unavailable');
  return node;
`;

/** Finalizes only events whose dispatch ended; no queued observer callbacks. */
export const inputCounterReadScript = `
  const counter=window.__spinelInputCount;
  try{return counter?.read() ?? null;}
  finally{if(arguments[0]===true)counter?.stop();}
`;

const integer = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

type InputTrace = {
  current: boolean;
  index: number | null;
  start: number;
  end: number;
  dropped: number;
  pending: number;
  events: {
    sequence: number;
    type: (typeof inputEventTypes)[number];
    trusted: boolean;
    insertion: boolean;
    composing: boolean;
    editor: boolean;
    targetIsActive: boolean;
    preventedAtCapture: boolean;
    preventedAfterDispatch: boolean | null;
  }[];
};

/** Copy only the finite observation schema; malformed traces stay unavailable. */
export function inputCounterDiagnostic(value: unknown) {
  const observed = object(value) ?? {};
  const raw = object(observed.trace);
  let trace: InputTrace | null = null;
  if (
    raw &&
    typeof raw.current === 'boolean' &&
    (raw.index === null || integer(raw.index)) &&
    integer(raw.start) &&
    integer(raw.end) &&
    raw.end >= raw.start &&
    integer(raw.dropped) &&
    integer(raw.pending) &&
    Array.isArray(raw.events) &&
    raw.events.length <= inputEventLimit &&
    raw.pending <= raw.events.length
  ) {
    const events: InputTrace['events'] = [];
    for (const value of raw.events) {
      const event = object(value);
      if (
        !event ||
        !integer(event.sequence) ||
        event.sequence !== raw.start + events.length ||
        event.sequence >= raw.end ||
        !inputEventTypes.includes(event.type as (typeof inputEventTypes)[number]) ||
        ![
          'trusted',
          'insertion',
          'composing',
          'editor',
          'targetIsActive',
          'preventedAtCapture',
        ].every((key) => typeof event[key] === 'boolean') ||
        (event.preventedAfterDispatch !== null && typeof event.preventedAfterDispatch !== 'boolean')
      )
        break;
      events.push({
        sequence: event.sequence,
        type: event.type as (typeof inputEventTypes)[number],
        trusted: event.trusted as boolean,
        insertion: event.insertion as boolean,
        composing: event.composing as boolean,
        editor: event.editor as boolean,
        targetIsActive: event.targetIsActive as boolean,
        preventedAtCapture: event.preventedAtCapture as boolean,
        preventedAfterDispatch: event.preventedAfterDispatch as boolean | null,
      });
    }
    if (
      events.length === raw.events.length &&
      raw.pending === events.filter((event) => event.preventedAfterDispatch === null).length &&
      events.length === Math.min(raw.end - raw.start, inputEventLimit) &&
      raw.dropped >= raw.end - raw.start - events.length
    )
      trace = {
        current: raw.current,
        index: raw.index as number | null,
        start: raw.start,
        end: raw.end,
        dropped: raw.dropped,
        pending: raw.pending,
        events,
      };
  }
  return {
    installed: observed.installed === true,
    count: integer(observed.count) ? observed.count : null,
    focus:
      typeof observed.focus === 'string' && /^[\w-]{1,40}$/.test(observed.focus)
        ? observed.focus
        : null,
    editor: observed.editor === true,
    trace,
  };
}
