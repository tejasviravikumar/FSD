import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import { parseYouTubeUrl } from '../utils/youtube.js';

const cache=new Map(), TTL=15*60_000;
function durationSeconds(value='') { if(!value.startsWith('PT'))return undefined;const h=value.match(/(\d+)H/)?.[1],m=value.match(/(\d+)M/)?.[1],s=value.match(/(\d+)S/)?.[1];return Number(h||0)*3600+Number(m||0)*60+Number(s||0); }
export async function validateYouTube({url,title,durationSeconds:manualDuration}) {
  const parsed=parseYouTubeUrl(url);
  if(!env.YOUTUBE_API_KEY)return{...parsed,...(title?{title}:{}),...(manualDuration!==undefined?{durationSeconds:manualDuration}:{})};
  let metadata=cache.get(parsed.videoId);
  if(metadata&&metadata.expires>Date.now())return{...parsed,...metadata.value};
  const endpoint=new URL('https://www.googleapis.com/youtube/v3/videos');
  endpoint.search=new URLSearchParams({part:'snippet,contentDetails,status',id:parsed.videoId,key:env.YOUTUBE_API_KEY}).toString();
  let response;try{response=await fetch(endpoint,{signal:AbortSignal.timeout(5000)});}catch{throw new AppError(502,'YouTube metadata unavailable','UPSTREAM_UNAVAILABLE');}
  if(!response.ok)throw new AppError(502,'YouTube metadata unavailable','UPSTREAM_UNAVAILABLE');
  const payload=await response.json(),item=payload.items?.[0];
  if(!item)throw new AppError(422,'YouTube video was not found','INVALID_VIDEO');
  const value={title:item.snippet?.title,durationSeconds:durationSeconds(item.contentDetails?.duration),embeddable:item.status?.embeddable};
  cache.set(parsed.videoId,{expires:Date.now()+TTL,value});
  return{...parsed,...value};
}
export function clearYouTubeCache(){cache.clear();}
