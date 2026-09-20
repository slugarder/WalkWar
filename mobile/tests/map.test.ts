import test from "node:test";
import assert from "node:assert/strict";
import { createContext, runInContext } from "node:vm";
import { levelForZoom, nationalCamera, regionCamera } from "../src/map/regions.ts";
import { mapDocument } from "../src/map/document.ts";
import type { Region } from "../src/game/types.ts";

test("national camera and zoom ladder select the requested administrative level", () => {
  assert.ok(nationalCamera.lng > 125 && nationalCamera.lng < 130);
  assert.ok(nationalCamera.lat > 33 && nationalCamera.lat < 39);
  assert.equal(nationalCamera.zoom, 6);
  assert.equal(levelForZoom(4.74), null);
  assert.equal(levelForZoom(nationalCamera.zoom), "sido");
  assert.equal(levelForZoom(7.3), "city");
  assert.equal(levelForZoom(9.4), "sigungu");
  assert.equal(levelForZoom(12.2), "emd");
  assert.equal(levelForZoom(Number.NaN), null);
});
test("region camera uses the selected real center and level", () => {
  const region = { level: "emd", center: { lat: 37.51, lon: 127.02 } } as Region;
  assert.deepEqual(regionCamera(region, 9), { id: 9, lng: 127.02, lat: 37.51, zoom: 14 });
});
test("shared map document has executable JavaScript, attribution, and flag selection", () => {
  const script = mapDocument.slice(mapDocument.lastIndexOf("<script>")+8,mapDocument.lastIndexOf("</script>"));
  assert.doesNotThrow(()=>new Function(script));
  assert.match(mapDocument,/AttributionControl/);
  assert.match(mapDocument,/receiveMapAreas/);
  assert.match(mapDocument,/type:'region',region/);
  assert.match(mapDocument,/min-width:48px;min-height:48px/);
  assert.match(mapDocument,/new maplibregl\.Marker\(\{element:button,anchor:'center'\}\)/);
  assert.match(mapDocument,/item\.marker\.setOffset\(\[chosen\.dx,chosen\.dy\]\)/);
  assert.match(mapDocument,/addEventListener\('touchend'/);
  assert.doesNotMatch(mapDocument,/button\.style\.transform/);
  assert.match(mapDocument,/minZoom:2,maxZoom:18/);
  const initial=mapDocument.match(/center:\[([\d.]+),([\d.]+)\],zoom:([\d.]+),/);
  assert.ok(initial);
  assert.deepEqual(initial.slice(1).map(Number),[nationalCamera.lng,nationalCamera.lat,nationalCamera.zoom]);
  const offsetList=mapDocument.match(/const offsets=(\[[^;]+\]);/);
  assert.ok(offsetList);
  const offsets=JSON.parse(offsetList[1]) as number[][];
  assert.ok(offsets.every(([x,y])=>Math.hypot(x,y)<=60));
  assert.doesNotMatch(mapDocument,/maxBounds:/);
  assert.match(mapDocument,/classList\.toggle\('badged',!!badgeColor\)/);
  assert.match(mapDocument,/badge-ornament/);
  assert.doesNotMatch(mapDocument,/busan-districts|placeMarkers|cluster/);
});

test("area refresh reuses markers and geometry, deferring changes during movement", () => {
  const counts={created:0,removed:0,setData:0,measured:0};
  const messages:string[]=[];
  class Element {
    className="";type="";textContent="";style={display:"flex",setProperty:(_key:string,_value:string)=>{}};
    children:Element[]=[];listeners:Record<string,(event:any)=>void>={};attributes:Record<string,string>={};
    append(...items:Element[]){this.children.push(...items);}
    setAttribute(key:string,value:string){this.attributes[key]=value;}
    addEventListener(key:string,listener:(event:any)=>void){this.listeners[key]=listener;}
    getBoundingClientRect(){counts.measured++;return {width:48,height:48};}
  }
  class Marker {
    element:Element;coordinate:number[]=[];
    constructor({element}:{element:Element}){this.element=element;}
    setLngLat(coordinate:number[]){this.coordinate=coordinate;return this;}
    addTo(){counts.created++;return this;}
    remove(){counts.removed++;}
    setOffset(_offset:number[]){return this;}
  }
  let moving=false,shift=0;
  const source={setData:(_data:unknown)=>{counts.setData++;}};
  const hostMap={isMoving:()=>moving,getSource:()=>source,getCanvas:()=>({clientWidth:400,clientHeight:400}),project:(p:number[])=>({x:p[0]*10+shift,y:p[1]*10})};
  const context=createContext({
    hostMap,maplibregl:{Marker},window:{ReactNativeWebView:{postMessage:(message:string)=>messages.push(message)},addEventListener:()=>{}},
    document:{getElementById:()=>new Element(),createElement:()=>new Element()},parent:{},
    fetch:()=>new Promise(()=>{}),setTimeout:()=>1,clearTimeout:()=>{},console,
  });
  const script=mapDocument.slice(mapDocument.lastIndexOf("<script>")+8,mapDocument.lastIndexOf("</script>"));
  runInContext(script,context);
  runInContext("map=hostMap;loaded=true",context);
  const feature=(id:string,flag:string,lng:number)=>({region:{id,name:id,fullName:id,center:{lon:lng,lat:10},mapSelectable:true,capture:{teams:[{flag}]}},geometry:{type:"Polygon",coordinates:[[[lng,10],[lng+0.1,10],[lng,10.1],[lng,10]]]}});
  const first={level:"sido",features:[feature("a","🏳️",10),feature("b","🏳️",20)]};
  (context.window as any).receiveMapAreas(first);
  assert.deepEqual(counts,{created:2,removed:0,setData:1,measured:2});
  (context.window as any).receiveMapAreas({level:"sido",features:[feature("a","🇰🇷",10),feature("b","🏳️",20)]});
  assert.deepEqual(counts,{created:2,removed:0,setData:1,measured:3});
  runInContext("regionMarkers.get('a').button.listeners.click({stopPropagation(){}})",context);
  assert.equal(JSON.parse(messages.at(-1)!).region.capture.teams[0].flag,"🇰🇷");
  moving=true;
  (context.window as any).receiveMapAreas({level:"sido",features:[feature("a","🇰🇷",10)]});
  assert.deepEqual(counts,{created:2,removed:0,setData:1,measured:3});
  moving=false;
  runInContext("applyPendingAreas()",context);
  assert.deepEqual(counts,{created:2,removed:1,setData:2,measured:3});
  shift=500;
  runInContext("layoutFlags()",context);
  assert.equal(runInContext("regionMarkers.get('a').button.style.display",context),"none");
  (context.window as any).receiveMapAreas({level:"sido",features:[feature("a","🇯🇵",10)]});
  assert.equal(runInContext("regionMarkers.get('a').button.style.display",context),"none");
  shift=0;
  runInContext("layoutFlags()",context);
  assert.equal(runInContext("regionMarkers.get('a').button.style.display",context),"flex");
});
