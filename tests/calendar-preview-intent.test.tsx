// @vitest-environment jsdom
import { act, lazy, Suspense, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Outlet, Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CalendarPage } from '../src/features/calendar/CalendarPage';
import { OperationalPreviewProvider, useOperationalPreview } from '../src/features/operational-preview/OperationalPreviewProvider';
import { calendarInitialWindow, calendarViewportAt } from '../src/features/calendar/calendarWindow';
import type { ManualBlock, ReservationListItem } from '../src/api/types';

// Actual React, router, Page, WeekView, timer and preview provider are unmocked.
// Only data/authority IO is replaced. No URL mutation represents the bug.
const state=vi.hoisted(()=>({events:[] as Record<string,unknown>[],hold:false,holdExternal:false,heldRoute:null as string|null,promise:null as Promise<void>|null,release:null as (()=>void)|null}));
vi.mock('../src/app/session',async load=>({...await load<typeof import('../src/app/session')>(),useSession:()=>({request:vi.fn(()=>{throw new Error('No network allowed');}),session:{tenantId:'tenant',subjectId:'actor',sessionId:'session',generation:1,username:'synthetic-manager'}})}));
vi.mock('../src/app/resourceFocus',async load=>({...await load<typeof import('../src/app/resourceFocus')>(),useTargetProperty:vi.fn()}));
vi.mock('../src/app/workspace',async load=>({...await load<typeof import('../src/app/workspace')>(),useWorkspace:()=>workspace}));
vi.mock('../src/app/permissions',async load=>({...await load<typeof import('../src/app/permissions')>(),usePermissions:()=>({hasData:true,isLoading:false,isFetching:false,error:null,refetch:vi.fn(),allows:()=>true})}));
vi.mock('@tanstack/react-query',async load=>({...await load<typeof import('@tanstack/react-query')>(),useQuery:()=>({data:inventory,isLoading:false,isFetching:false,error:null,refetch:vi.fn()})}));
vi.mock('../src/features/calendar/useCalendarSegments',async load=>({...await load<typeof import('../src/features/calendar/useCalendarSegments')>(),useCalendarSegments:()=>schedule}));

const propertyId='11111111-1111-4111-8111-111111111111',roomId='22222222-2222-4222-8222-222222222222',unitId='33333333-3333-4333-8333-333333333333',reservationId='44444444-4444-4444-8444-444444444444';
const property={propertyId,name:'Synthetic property',timeZoneId:'Europe/London'};
const room={propertyId,roomId,roomName:'Synthetic dorm',salesMode:'bedLevel',units:[{propertyId,roomId,inventoryUnitId:unitId,bedId:unitId,label:'101-A',kind:'bed',isSellable:true,isTopologyActive:true}]};
const inventory={rooms:[room]};
const workspace={selectedPropertyId:propertyId,selectedWorkspaceId:'tenant',properties:[property],selectedProperty:property,propertiesLoaded:true,propertiesLoading:false,propertiesFetching:false,propertiesError:null,refetchProperties:vi.fn(),workspacesLoaded:true,workspacesFetching:false,workspacesError:null};
const reservation={reservationId,propertyId,primaryGuestName:'Synthetic arrival',guestCount:1,arrival:'2026-09-06',departure:'2026-09-08',inventoryUnitIds:[unitId],inventoryUnitCount:1,holdsInventory:true,status:2,sourceKind:'direct'} as ReservationListItem;
const segments=calendarInitialWindow('2026-09-06');
const schedule={segments,coverage:segments.map(segment=>({...segment,current:true,reservationsCurrent:true,blocksCurrent:true,conflict:false,label:'Loaded',retry:vi.fn()})),reservations:[reservation],blocks:[{blockId:'55555555-5555-4555-8555-555555555555',blockGroupId:'66666666-6666-4666-8666-666666666666',propertyId,inventoryUnitId:unitId,arrival:'2026-09-09',departure:'2026-09-11',reason:'Synthetic block'} as ManualBlock],conflictIds:[],attentionReservationIds:new Set([reservationId]),extend:vi.fn()};
function record(kind:string,extra:Record<string,unknown>={}){state.events.push({kind,ms:Date.now(),url:location.pathname+location.search,...extra});}
function HoldRouteCommit({children}:{children:ReactNode}){
  const route=useLocation();
  if((state.hold&&new URLSearchParams(route.search).has('op'))||state.heldRoute===`${route.pathname}${route.search}${route.hash}`){record('held-real-route-render',{renderSearch:route.search});throw state.promise;}
  return children;
}
function ProviderProbe(){const preview=useOperationalPreview();return <><output data-preview-committed={String(Boolean(preview.activeRoute))}/><button data-close-preview onClick={preview.closePreview}>Close preview</button><Link data-external to="/reservations">Reservations</Link><Link data-guests to="/guests">Guest records</Link><Link data-change-date to="/calendar?date=2026-09-15&day=2026-09-15">Another date</Link><Link data-change-property to="/calendar?date=2026-09-13&day=2026-09-06&property=77777777-7777-4777-8777-777777777777">Another property</Link><Link data-change-hash to="/calendar?date=2026-09-13&day=2026-09-06#changed">Another fragment</Link></>;}
function TestLayout(){return <OperationalPreviewProvider><ProviderProbe/><Suspense fallback={<p>Opening destination</p>}><Outlet/></Suspense></OperationalPreviewProvider>;}
function ExternalPage(){return <h1>External route</h1>;}
const originalScroll=Object.getOwnPropertyDescriptor(HTMLElement.prototype,'scrollLeft');
const originalIntoView=Object.getOwnPropertyDescriptor(HTMLElement.prototype,'scrollIntoView');
const originalScrollBy=Object.getOwnPropertyDescriptor(HTMLElement.prototype,'scrollBy');
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();if(originalScroll)Object.defineProperty(HTMLElement.prototype,'scrollLeft',originalScroll);else Reflect.deleteProperty(HTMLElement.prototype,'scrollLeft');if(originalIntoView)Object.defineProperty(HTMLElement.prototype,'scrollIntoView',originalIntoView);else Reflect.deleteProperty(HTMLElement.prototype,'scrollIntoView');if(originalScrollBy)Object.defineProperty(HTMLElement.prototype,'scrollBy',originalScrollBy);else Reflect.deleteProperty(HTMLElement.prototype,'scrollBy');document.body.replaceChildren();});

async function setup(){
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-09-13T06:00:00Z'));
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
    vi.stubGlobal('ResizeObserver',class{observe(){}unobserve(){}disconnect(){}});
    vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>setTimeout(()=>callback(0),16));
    vi.stubGlobal('cancelAnimationFrame',(id:ReturnType<typeof setTimeout>)=>clearTimeout(id));
    Object.defineProperty(HTMLElement.prototype,'scrollIntoView',{configurable:true,value:vi.fn()});
    const left=new WeakMap<HTMLElement,number>();
    vi.spyOn(HTMLElement.prototype,'clientWidth','get').mockImplementation(function(this:HTMLElement){return this.classList.contains('calendar-timeline')?1102:0;});
    vi.spyOn(HTMLElement.prototype,'scrollWidth','get').mockImplementation(function(this:HTMLElement){return this.classList.contains('calendar-timeline')?2592:0;});
    Object.defineProperty(HTMLElement.prototype,'scrollLeft',{configurable:true,get(){return left.get(this)??0;},set(value:number){left.set(this,Math.max(0,Math.min(1490,value)));}});
    // jsdom has no layout scrolling: model the focus-reveal displacement and
    // its resulting scroll event, without claiming native geometry coverage.
    Object.defineProperty(HTMLElement.prototype,'scrollBy',{configurable:true,value:function(this:HTMLElement,options:ScrollToOptions){this.scrollLeft+=options.left??0;this.scrollTop+=options.top??0;this.dispatchEvent(new Event('scroll',{bubbles:false}));}});
    history.replaceState(null,'','/calendar?date=2026-09-13&day=2026-09-06');
    state.events=[];state.hold=false;state.holdExternal=false;state.heldRoute=null;state.promise=new Promise(resolve=>{state.release=resolve;});
    let releaseExternal:()=>void=()=>{};
    const externalPromise=new Promise<{default:typeof ExternalPage}>(resolve=>{releaseExternal=()=>resolve({default:ExternalPage});});
    const LazyExternal=lazy(()=>state.holdExternal?externalPromise:Promise.resolve({default:ExternalPage}));
    const push=history.pushState.bind(history),replace=history.replaceState.bind(history);
    vi.spyOn(history,'pushState').mockImplementation((...args)=>{push(...args);record('pushState');});
    vi.spyOn(history,'replaceState').mockImplementation((...args)=>{replace(...args);record('replaceState');});
    const container=document.createElement('div');document.body.append(container);const root=createRoot(container);
    await act(async()=>root.render(<BrowserRouter><Suspense fallback={<p>Diagnostic commit pending</p>}><HoldRouteCommit><Routes><Route element={<TestLayout/>}><Route path="/calendar" element={<CalendarPage/>}/><Route path="/guests" element={<LazyExternal/>}/><Route path="/reservations" element={<LazyExternal/>}/></Route></Routes></HoldRouteCommit></Suspense></BrowserRouter>));
    const advance=async(ms:number)=>{await act(async()=>vi.advanceTimersByTime(ms));};
    await advance(20);
    const scroller=()=>container.querySelector<HTMLElement>('.calendar-timeline')!;
    const click=async(element:Element)=>{expect(element).not.toBeNull();await act(async()=>{element.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));});};
    const bar=(kind:'reservation'|'inventoryBlock')=>[...container.querySelectorAll<HTMLButtonElement>('table button[data-operational-preview-trigger]')].find(e=>e.textContent?.includes(kind==='reservation'?'Synthetic arrival':'Synthetic block'))!;
    const scroll=async(value:number)=>{await act(async()=>{scroller().scrollLeft=value;scroller().dispatchEvent(new Event('scroll',{bubbles:false}));record('scroll-input',{left:value});});};
    schedule.extend.mockClear();
    return {container,scroller,bar,click,scroll,advance,params:()=>new URLSearchParams(location.search),
      release:async()=>{state.hold=false;state.heldRoute=null;await act(async()=>{state.release?.();releaseExternal();await Promise.resolve();});await advance(20);},
      history:async(delta:number)=>{await act(async()=>{history.go(delta);vi.advanceTimersByTime(5);});},
      close:async()=>{await click(container.querySelector('[data-close-preview]')!);await advance(5);},
      unmount:async()=>{state.hold=false;state.heldRoute=null;state.release?.();releaseExternal();await act(async()=>root.unmount());},
    };
}

describe('Calendar preview intent preserves real router commit ordering (jsdom, synthetic Suspense scheduling)',()=>{
  it.each([[false,'reservation',false],[true,'reservation',false],[false,'inventoryBlock',false],[true,'inventoryBlock',false],[true,'reservation',true],[true,'inventoryBlock',true]] as const)('preserves held=%s %s preview through180ms, later scroll=%s',async (held,kind,laterScroll)=>{
    const s=await setup();
    try{
      expect(s.scroller().scrollLeft).toBe(1490);
      // This is a deterministic DOM scroll input, not an implementation callback invocation.
      await s.scroll(1450);
      state.hold=held;
      await s.click(s.bar(kind));
      expect(s.params().get('op')).toBe(kind);record('after-real-preview-click');
      if(laterScroll){await s.scroll(100);expect(schedule.extend).not.toHaveBeenCalled();}
      await s.advance(179);expect(s.params().get('op')).toBe(kind);
      await s.advance(1);record('after-real180ms-timer');
      const afterTimer=s.params();
      if(held) expect(state.events.some(e=>e.kind==='held-real-route-render')).toBe(true);
      expect(afterTimer.get('op')).toBe(kind);
      expect(afterTimer.get('calViewDate')).toBe('2026-09-05');
      expect(afterTimer.get('calViewOffset')).toBe('946');
      await s.release();expect(s.container.querySelector('[data-preview-committed=true]')).not.toBeNull();
    }finally{await s.unmount();}
  });

  it('keeps ordinary180ms publication and coalesces rapid pan/focus input to the latest position',async()=>{
    const s=await setup();try{
      await s.scroll(1300);await s.advance(100);await s.scroll(1200);
      await act(async()=>s.bar('reservation').focus());
      const focusedPosition=s.scroller().scrollLeft;
      await s.advance(179);expect(s.params().has('calViewDate')).toBe(false);
      await s.advance(1);const expected=calendarViewportAt(segments[0].from,focusedPosition);
      expect(s.params().get('calViewDate')).toBe(expected.date);expect(s.params().get('calViewOffset')).toBe(String(expected.offset));expect(s.params().has('op')).toBe(false);
    }finally{await s.unmount();}
  });

  it.each(['reservation','inventoryBlock'] as const)('closes %s without resurrection, resumes scrolling, and reopens with latest owned viewport',async kind=>{
    const s=await setup();try{
      await s.scroll(1450);state.hold=true;await s.click(s.bar(kind));await s.release();await s.close();await s.advance(200);
      expect(s.params().has('op')).toBe(false);expect(s.container.querySelector('[data-preview-committed=false]')).not.toBeNull();
      await s.scroll(1200);await s.advance(180);expect(s.params().get('calViewOffset')).toBe(String(calendarViewportAt(segments[0].from,1200).offset));
      await s.scroll(1100);await act(async()=>s.bar(kind).focus());await s.click(s.bar(kind));await s.advance(200);
      expect(s.params().get('op')).toBe(kind);expect(s.params().get('opFromViewportOffset')).toBe(String(calendarViewportAt(segments[0].from,s.scroller().scrollLeft).offset));
    }finally{await s.unmount();}
  });

  it('Back/Forward follows actual router history without a stale timer reopening the closed preview',async()=>{
    const s=await setup();try{
      await s.scroll(1450);await s.click(s.bar('reservation'));const opened=location.search;
      await s.history(-1);await s.advance(200);expect(s.params().has('op')).toBe(false);
      await s.history(1);await s.advance(200);expect(location.search).toBe(opened);expect(s.container.querySelector('[data-preview-committed=true]')).not.toBeNull();
      await s.history(-1);await s.advance(200);expect(s.params().has('op')).toBe(false);
      await s.scroll(1000);await s.advance(180);expect(s.params().has('calViewDate')).toBe(true);
    }finally{await s.unmount();}
  });

  it.each([false,true])('external navigation unmounts Calendar and never resurrects it, pending preview=%s',async pending=>{
    const s=await setup();try{
      await s.scroll(1450);if(pending){state.hold=true;await s.click(s.bar('reservation'));await s.scroll(1200);}
      await s.click(s.container.querySelector('[data-external]')!);await s.advance(200);await s.release();
      expect(location.pathname).toBe('/reservations');expect(s.params().has('op')).toBe(false);expect(s.scroller()).toBeNull();
    }finally{await s.unmount();}
  });

  it.each([['data-guests','/guests'],['data-external','/reservations']])('retains held lazy destination %s while an old Calendar publication reaches180ms',async(attribute,destination)=>{
    const s=await setup();try{
      await s.scroll(1450);state.holdExternal=true;
      await s.click(s.container.querySelector(`[${attribute}]`)!);
      expect(location.pathname).toBe(destination);expect(s.scroller()).not.toBeNull();
      await s.advance(180);expect(location.pathname).toBe(destination);
      await s.release();await s.advance(750);
      expect(location.pathname).toBe(destination);expect(s.scroller()).toBeNull();expect(s.container.querySelector('h1')?.textContent).toBe('External route');
    }finally{await s.unmount();}
  });

  it.each(['date','property','hash'])('retains a changed Calendar %s URL before its route commit',async change=>{
    const s=await setup();try{
      await s.scroll(1450);const link=s.container.querySelector<HTMLAnchorElement>(`[data-change-${change}]`)!;
      const target=new URL(link.href);state.heldRoute=target.pathname+target.search+target.hash;
      await s.click(link);expect(location.href).toBe(target.href);
      await s.advance(180);expect(location.href).toBe(target.href);
      await s.release();await s.advance(200);expect(location.href).toBe(target.href);
    }finally{await s.unmount();}
  });

  it('unmount cancels pending ordinary publications',async()=>{
    const s=await setup();await s.scroll(1450);const before=location.href;await s.unmount();await s.advance(200);expect(location.href).toBe(before);
  });
});
