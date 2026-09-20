// This document runs unchanged in the web iframe and the native WebView.
// Administrative polygons and capture flags arrive through the React bridge.
export const mapDocument = `<!DOCTYPE html><html lang="ko"><head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<link rel="stylesheet" href="https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.css">
<style>
html,body,#map{margin:0;width:100%;height:100%;overflow:hidden;background:#101a28;font-family:system-ui,sans-serif;color:#dce7ef}
#status{position:absolute;top:48%;left:10%;right:10%;text-align:center;font-size:13px;padding:16px;background:#172639;border-radius:12px;z-index:5}
#status button{display:block;margin:12px auto 0;min-height:48px;padding:0 20px;background:#72aaa6;border:0;border-radius:8px;color:#101a28}
.maplibregl-ctrl-bottom-left{bottom:110px;max-width:calc(100% - 85px)}
.maplibregl-ctrl-attrib{font-size:9px!important;background:#101a28cf!important;color:#a6b9c7!important;line-height:14px!important;padding:3px 7px!important;border-radius:5px!important}
.maplibregl-ctrl-attrib a{color:#a6b9c7!important}
.player{width:40px;height:40px;position:relative;display:grid;place-items:center;border-radius:50%;border:1px solid #72aaa66b;background:#72aaa620;box-sizing:border-box;pointer-events:none}
.player:before{content:'나';position:absolute;bottom:calc(100% + 5px);font-size:10px;color:#10272b;background:var(--nameplate,#72aaa6);border-radius:7px;padding:2px 7px;white-space:nowrap}
.player>svg{width:55%;height:55%;fill:#a6cecb}
.player.equipped{border:3px solid var(--frame,#72aaa6);background:#72aaa615}
.player.equipped:after{content:'';position:absolute;inset:3px;border:1.5px solid var(--frame,#72aaa6);border-radius:50%}
.spark{display:none;position:absolute;width:4px;height:4px;border-radius:1px;transform:rotate(45deg);background:var(--badge,#a6cecb);right:12%;top:12%}.spark.second{right:auto;top:auto;left:12%;bottom:12%}.equipped .spark{display:block}
.badge-ornament{display:none;position:absolute;right:-5px;top:-5px;width:18px;height:18px;border-radius:50%;background:var(--badge,#7fb5f4);place-items:center;box-shadow:0 1px 4px #08111acc}.badged .badge-ornament{display:grid}.badge-ornament svg{width:12px;height:12px;fill:#101a28}.badged .spark:not(.second){right:auto;left:12%}
.region-button{min-width:48px;min-height:48px;max-width:104px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;padding:2px 5px;box-sizing:border-box;background:#172639e8;color:#dce7ef;border:1px solid #72aaa699;border-radius:10px;font:inherit;cursor:pointer;pointer-events:auto;touch-action:manipulation;box-shadow:0 2px 10px #08111ac9}
.region-button:focus-visible{outline:2px solid #d7eeea;outline-offset:2px}
.region-button .flags{font-size:17px;line-height:20px;max-width:94px;text-align:center;overflow-wrap:anywhere}
.region-button .name{font-size:10px;line-height:11px;max-width:94px;text-align:center;overflow-wrap:anywhere}
</style></head><body><div id="map" role="application" aria-label="대한민국 지도"></div><div id="status" role="status">대한민국 지도를 불러오는 중</div>
<script src="https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.js"></script>
<script>
let map, marker, state, pendingAreas=null, cameraId=-1, loaded=false, regionMarkers=new Map(), geometryKey='';
const status=document.getElementById('status');
const empty={type:'FeatureCollection',features:[]};
function emit(message){const data=JSON.stringify({channel:'walkwar-map',...message});if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(data);else parent.postMessage(data,'*');}
function fail(){status.style.display='block';status.textContent='지도를 불러오지 못했어요';const b=document.createElement('button');b.textContent='다시 시도';b.onclick=()=>location.reload();status.appendChild(b);}
const timeout=setTimeout(()=>{if(!loaded)fail()},20000);
function color(value,fallback){return typeof value==='string'&&/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value)?value:fallback;}
function playerElement(){
 const el=document.createElement('div');el.className='player';el.setAttribute('aria-label','내 위치');el.setAttribute('data-testid','player');
 el.innerHTML='<svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20m-1 15-1-5-5-1 13-5z"/></svg><i class="spark"></i><i class="spark second"></i><i class="badge-ornament"><svg viewBox="0 0 24 24"><path d="M12 2C9.8 5.7 5 11.2 5 15a7 7 0 0 0 14 0c0-3.8-4.8-9.3-7-13Z"/></svg></i>';
 return el;
}
window.receiveMapState=function(next){
 state=next;if(!loaded)return;
 const c=next.coordinate;
 if(c&&Number.isFinite(c.lng)&&Number.isFinite(c.lat)){
  if(!marker)marker=new maplibregl.Marker({element:playerElement()}).setLngLat([c.lng,c.lat]).addTo(map);
  else marker.setLngLat([c.lng,c.lat]);
  const el=marker.getElement();el.classList.toggle('equipped',!!next.equipped);
  const size=44*Math.max(0.7,Math.min(2.5,Number(next.factor)||1));el.style.width=el.style.height=size+'px';
  el.style.setProperty('--frame',color(next.frameColor,'#72aaa6'));
  const badgeColor=color(next.badgeColor,'');el.classList.toggle('badged',!!badgeColor);
  el.style.setProperty('--badge',badgeColor||'#a6cecb');
  el.style.setProperty('--nameplate',color(next.nameplateColor,'#72aaa6'));
 }else if(marker){marker.remove();marker=null;}
 const attribution=document.querySelector('.maplibregl-ctrl-bottom-left');
 if(attribution)attribution.style.bottom=Math.max(0,Number(next.bottom)||0)+'px';
 if(next.camera&&next.camera.id!==cameraId&&[next.camera.lng,next.camera.lat,next.camera.zoom].every(Number.isFinite)){
  cameraId=next.camera.id;map.easeTo({center:[next.camera.lng,next.camera.lat],zoom:next.camera.zoom,duration:window.matchMedia('(prefers-reduced-motion: reduce)').matches?0:700});
 }
};
function shortName(region){
 const names={'서울특별시':'서울','전남광주통합특별시':'전남광주','부산광역시':'부산','대구광역시':'대구','인천광역시':'인천','대전광역시':'대전','울산광역시':'울산','세종특별자치시':'세종','경기도':'경기','강원특별자치도':'강원','충청북도':'충북','충청남도':'충남','전북특별자치도':'전북','경상북도':'경북','경상남도':'경남','제주특별자치도':'제주'};
 return names[region.name]||region.name;
}
function flagText(region){
 const teams=region.capture&&Array.isArray(region.capture.teams)?region.capture.teams:[];
 return teams.length?teams.map(team=>team.flag||'🏳️').join(''):'🏳️';
}
function geometryCenter(geometry){
 const points=[];
 function visit(value){if(Array.isArray(value)&&typeof value[0]==='number')points.push(value);else if(Array.isArray(value))value.forEach(visit);}
 visit(geometry&&geometry.coordinates);
 if(!points.length)return null;
 const bounds=points.reduce((b,p)=>[Math.min(b[0],p[0]),Math.min(b[1],p[1]),Math.max(b[2],p[0]),Math.max(b[3],p[1])],[Infinity,Infinity,-Infinity,-Infinity]);
 return [(bounds[0]+bounds[2])/2,(bounds[1]+bounds[3])/2];
}
function layoutFlags(){
 if(!map)return;
 const items=Array.from(regionMarkers.values());
 const toMeasure=[];
 for(const item of items)if(item.dirty){item.button.style.display='flex';item.visible=true;toMeasure.push(item);}
 for(const item of toMeasure){const rect=item.button.getBoundingClientRect();item.width=Math.max(48,rect.width);item.height=Math.max(48,rect.height);item.dirty=false;}
 const occupied=new Map(),cellSize=64,canvas=map.getCanvas(),viewWidth=canvas.clientWidth,viewHeight=canvas.clientHeight;
 function cells(box){const result=[];for(let x=Math.floor((box.left-3)/cellSize);x<=Math.floor((box.right+3)/cellSize);x++)for(let y=Math.floor((box.top-3)/cellSize);y<=Math.floor((box.bottom+3)/cellSize);y++)result.push(x+','+y);return result;}
 function overlaps(box){for(const key of cells(box))for(const other of occupied.get(key)||[])if(!(box.right+3<other.left||box.left-3>other.right||box.bottom+3<other.top||box.top-3>other.bottom))return true;return false;}
 function reserve(box){for(const key of cells(box)){if(!occupied.has(key))occupied.set(key,[]);occupied.get(key).push(box);}}
 const offsets=[[0,0],[0,-52],[0,52],[-54,0],[54,0]];
 for(const item of items){
  const point=map.project(item.coordinate),width=item.width,height=item.height;
  let chosen=null;
  for(const [dx,dy] of offsets){
   const box={left:point.x+dx-width/2,right:point.x+dx+width/2,top:point.y+dy-height/2,bottom:point.y+dy+height/2};
   if(box.right<0||box.left>viewWidth||box.bottom<0||box.top>viewHeight)continue;
   if(!overlaps(box)){chosen={dx,dy,box};break;}
  }
  const visible=!!chosen;
  if(item.visible!==visible){item.button.style.display=visible?'flex':'none';item.visible=visible;}
  if(chosen){if(item.dx!==chosen.dx||item.dy!==chosen.dy){item.marker.setOffset([chosen.dx,chosen.dy]);item.dx=chosen.dx;item.dy=chosen.dy;}reserve(chosen.box);}
 }
}
function makeRegionMarker(region,coordinate,name,flagsText){
 const button=document.createElement('button');button.className='region-button';button.type='button';
 const flags=document.createElement('span');flags.className='flags';flags.textContent=flagsText;
 const label=document.createElement('span');label.className='name';label.textContent=name;
 button.setAttribute('aria-label',region.fullName+' '+flagsText);button.append(flags,label);
 const item={region,coordinate,name,flagsText,button,flags,label,width:48,height:48,dirty:true,visible:true,dx:0,dy:0,marker:null};
 const activate=()=>emit({type:'region',region:item.region});
 let touchStart=null,lastTouchAt=0;
 button.addEventListener('touchstart',event=>{const touch=event.touches.length===1?event.touches[0]:null;touchStart=touch?{x:touch.clientX,y:touch.clientY,time:Date.now()}:null;},{passive:true});
 button.addEventListener('touchend',event=>{const touch=event.changedTouches[0],start=touchStart;touchStart=null;if(!touch||!start||Math.hypot(touch.clientX-start.x,touch.clientY-start.y)>14||Date.now()-start.time>700)return;lastTouchAt=Date.now();event.preventDefault();event.stopPropagation();activate();},{passive:false});
 button.addEventListener('touchcancel',()=>{touchStart=null;});
 button.addEventListener('click',event=>{event.stopPropagation();if(Date.now()-lastTouchAt>700)activate();});
 item.marker=new maplibregl.Marker({element:button,anchor:'center'}).setLngLat(coordinate).addTo(map);
 return item;
}
function applyPendingAreas(){
 if(!loaded||!pendingAreas||map.isMoving())return false;
 const next=pendingAreas;pendingAreas=null;
 const source=map.getSource('walkwar-regions');if(!source)return;
 const features=next.level&&Array.isArray(next.features)?next.features:[];
 const rows=features.filter(f=>f&&f.region&&f.region.id&&f.geometry);
 // Boundaries are fixed for this map session; capture updates only change marker labels.
 const nextGeometryKey=next.level?next.level+'|'+rows.map(f=>f.region.id).sort().join(','):'';
 if(nextGeometryKey!==geometryKey){source.setData(nextGeometryKey?{type:'FeatureCollection',features:rows.map(f=>({type:'Feature',geometry:f.geometry,properties:{id:f.region.id}}))}:empty);geometryKey=nextGeometryKey;}
 const seen=new Set();
 for(const feature of rows){
  const region=feature.region;if(!region||(region.mapSelectable===false&&!(next.level==='city'&&region.isAggregateCity)))continue;
  let item=regionMarkers.get(region.id);
  const coordinate=region.center&&Number.isFinite(region.center.lon)&&Number.isFinite(region.center.lat)?[region.center.lon,region.center.lat]:item?item.coordinate:geometryCenter(feature.geometry);
  if(!coordinate)continue;
  seen.add(region.id);
  const name=shortName(region),flagsText=flagText(region);
  if(!item){item=makeRegionMarker(region,coordinate,name,flagsText);regionMarkers.set(region.id,item);continue;}
  item.region=region;
  if(item.coordinate[0]!==coordinate[0]||item.coordinate[1]!==coordinate[1]){item.coordinate=coordinate;item.marker.setLngLat(coordinate);}
  if(item.name!==name||item.flagsText!==flagsText){item.name=name;item.flagsText=flagsText;item.label.textContent=name;item.flags.textContent=flagsText;item.dirty=true;}
  item.button.setAttribute('aria-label',region.fullName+' '+flagsText);
 }
 for(const [id,item] of regionMarkers)if(!seen.has(id)){item.marker.remove();regionMarkers.delete(id);}
 layoutFlags();
 return true;
}
window.receiveMapAreas=function(next){pendingAreas=next;if(loaded)applyPendingAreas();};
window.addEventListener('message',e=>{if(e.source!==parent)return;try{const v=typeof e.data==='string'?JSON.parse(e.data):e.data;if(v.channel==='walkwar-map-state')window.receiveMapState(v);if(v.channel==='walkwar-map-areas')window.receiveMapAreas(v)}catch{}});
function emitViewport(){
 const c=map.getCenter(),b=map.getBounds(),zoom=map.getZoom();
 document.getElementById('map').setAttribute('aria-label','대한민국 지도 · 확대 '+zoom.toFixed(1));
 emit({type:'viewport',lng:c.lng,lat:c.lat,zoom,west:b.getWest(),south:b.getSouth(),east:b.getEast(),north:b.getNorth()});
}
(async()=>{try{
 const response=await fetch('https://tiles.openfreemap.org/styles/dark');if(!response.ok)throw new Error('style');const style=await response.json();
 // Preserve attribution and real OpenFreeMap geometry with the app's dark palette.
 for(const l of style.layers){
  if(l.type==='background')l.paint={...l.paint,'background-color':'#172536'};
  if(l.type==='fill'&&/water/.test(l.id))l.paint={...l.paint,'fill-color':'#0c1a29'};
  if(l.type==='fill'&&/park|wood|forest|landcover/.test(l.id)){l.paint={...l.paint,'fill-color':'#203e3d','fill-opacity':0.65};delete l.paint['fill-pattern'];}
  if(l.type==='fill'&&l.id==='landuse_residential')l.paint={...l.paint,'fill-color':'#24374b','fill-opacity':0.45};
  if(l.type==='fill'&&l.id==='building')l.paint={...l.paint,'fill-color':'#243b50','fill-outline-color':'#30495e'};
  if(l.type==='line'&&l['source-layer']==='transportation')l.paint={...l.paint,'line-color':l.id.includes('casing')?'#23394b':l.id.includes('railway')?'#42605e':'#526d84'};
  if(l.type==='symbol'&&l.layout&&l.layout['text-field']){l.layout['text-field']=['coalesce',['get','name:ko'],['get','name'],['get','name:latin']];l.paint={...l.paint,'text-color':'#a8bcc8','text-halo-color':'#172536','text-halo-width':1};}
 }
 map=new maplibregl.Map({container:'map',style,center:[127.55,36.05],zoom:6,minZoom:2,maxZoom:18,pixelRatio:Math.max(1,Math.min(1.5,Number(window.devicePixelRatio)||1)),maxTileCacheSize:48,attributionControl:false,renderWorldCopies:false,keyboard:false,dragRotate:false,pitchWithRotate:false});
 map.touchZoomRotate.disableRotation();
 map.on('webglcontextlost',()=>emit({type:'context-lost'}));
 map.on('webglcontextrestored',()=>emit({type:'context-restored'}));
 map.addControl(new maplibregl.AttributionControl({compact:false}),'bottom-left');
 map.on('load',()=>{loaded=true;clearTimeout(timeout);status.style.display='none';
  map.addSource('walkwar-regions',{type:'geojson',data:empty});
  map.addLayer({id:'walkwar-region-fill',type:'fill',source:'walkwar-regions',paint:{'fill-color':'#3a8c85','fill-opacity':0.11}});
  map.addLayer({id:'walkwar-region-outline',type:'line',source:'walkwar-regions',paint:{'line-color':'#72aaa6','line-width':1,'line-opacity':0.55}});
  if(state)window.receiveMapState(state);
  if(pendingAreas)window.receiveMapAreas(pendingAreas);
  emit({type:'ready'});emitViewport();
 });
 map.on('moveend',()=>{if(!applyPendingAreas())layoutFlags();emitViewport()});
 map.on('resize',layoutFlags);
}catch(error){console.error('WalkWar map initialization',String(error));clearTimeout(timeout);fail()}})();
</script></body></html>`;

