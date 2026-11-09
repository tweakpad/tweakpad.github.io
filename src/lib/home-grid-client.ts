import type {GridJob} from './home-grid-worker';
/** One serial worker per canvas. Geometry never blocks an input/frame callback. */
export function createHomeGridWorker(){
  const worker=new Worker(new URL('./home-grid-worker.ts',import.meta.url),{type:'module'});
  let id=0;
  const pending=new Map<number,{resolve:(result:unknown)=>void;reject:(reason:unknown)=>void}>();
  worker.onmessage=({data})=>{
    const request=pending.get(data.id);if(!request)return;
    pending.delete(data.id);
    if(data.error)request.reject(new Error(data.error));else request.resolve(data.result);
  };
  worker.onerror=event=>{for(const request of pending.values())request.reject(new Error(event.message));pending.clear();};
  return {
    request<T>(job:GridJob):Promise<T>{return new Promise((resolve,reject)=>{const next=++id;pending.set(next,{resolve:result=>resolve(result as T),reject});worker.postMessage({id:next,job});});},
    dispose(){worker.terminate();for(const request of pending.values())request.reject(new Error('Canvas disposed'));pending.clear();},
  };
}
