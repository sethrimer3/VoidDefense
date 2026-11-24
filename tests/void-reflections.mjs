/** Live renderer regression and reflection gallery on desktop and mobile. Start Vite first. */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const baseUrl = process.env.TEST_URL ?? "http://127.0.0.1:5173/";
const output = "test-results/void-reflections";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_EXECUTABLE
    ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE }
    : process.env.PLAYWRIGHT_CHANNEL
      ? { channel: process.env.PLAYWRIGHT_CHANNEL }
      : process.platform === "win32"
        ? { channel: "chrome" }
        : { executablePath: "/usr/bin/chromium" }),
});
try {
  for (const mobile of [false,true]) {
    const page = await browser.newPage({ viewport: mobile ? {width:390,height:750} : {width:900,height:600},
      deviceScaleFactor:mobile?2:1, isMobile:mobile, hasTouch:mobile });
    const errors=[]; page.on("pageerror", err=>errors.push(err.message));
    await page.route("**/reflection-preview", route=>route.fulfill({contentType:"text/html",body:
      '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#060a15}canvas{display:block;width:100vw;height:100vh}</style><canvas></canvas>'}));
    await page.goto(new URL("reflection-preview", baseUrl).href);
    const info = await page.evaluate(async ()=>{
      const {VoidSim}=await import("/src/void/sim.ts");
      const {VoidRenderer}=await import("/src/void/render.ts");
      const {emptyTechWallet}=await import("/src/void/tech/wallet.ts");
      const {CellMaterial,LandCover}=await import("/src/void/model.ts");
      const {sampleWaterMirror}=await import("/src/void/reflections.ts");
      const sim=new VoidSim("organismEscalation","buildAndWatch",emptyTechWallet());
      const {world}=sim;
      const {w,h}=world.grid;
      const b=world.buildings.find(b=>b.height>=20&&b.archStyle==="glassTower"&&b.w>=8&&b.x>80&&b.x<w-90&&b.y>100&&b.y<h-130);
      assertBuilding(b);
      function assertBuilding(b) { if(!b) throw Error("Expected a glass tower"); }
      sim.supplies=500;
      sim.placeTower("matterCannon",b.x-14,b.y+b.h-5);
      sim.placeTower("shieldProjector",b.x+b.w+6,b.y+b.h-5);
      const shore=b.y+b.h;
      for(let y=shore;y<shore+21;y++) for(let x=b.x-26;x<b.x+b.w+38;x++) {
        const idx=y*w+x;
        world.material[idx]=CellMaterial.UNCLAIMED; world.buildingAt[idx]=-1; world.columnFloors[idx]=0;
        world.landCover[idx]=LandCover.RIVER; world.hp[idx]=world.maxHp[idx]=0;
      }
      world.grid.markAllDirty();
      const canvas=document.querySelector("canvas");
      const renderer=new VoidRenderer(canvas);
      renderer.resize(w,h);
      function shot(mode,zoom,focusY,now=1000,rain=false) {
        renderer.setTimeOfDay(mode,true);
        renderer.setWeather(rain?"rain":"clear",true);
        renderer.cam.s=zoom;
        const scale=renderer.pixelScale();
        renderer.cam.x=Math.round(canvas.width/2-(b.x+b.w*.5)*scale);
        renderer.cam.y=Math.round(canvas.height/2-focusY*scale);
        renderer.lightingQuality=renderer.effectiveLightingQuality="high";
        renderer.draw(sim,now,null,null,null,false);
      }
      function sampleLayer() {
        const pix=renderer.reflections.water.pixels;
        const res=[];
        for(let y=shore;y<shore+21;y++) for(let x=b.x-26;x<b.x+b.w+38;x++) res.push(pix[y*w+x]);
        return res;
      }
      shot("day",5,shore);
      const candidates=[];
      for(let y=shore;y<shore+21;y++) for(let x=b.x;x<b.x+b.w;x++) {
        const hit=sampleWaterMirror(x,y,w,renderer.spriteCache);
        if(hit>=0&&renderer.spriteCache.atlasBldId[hit]===b.id) candidates.push(y*w+x);
      }
      if(!candidates.length) throw Error("Expected atlas-backed mirrors on water");
      const day=sampleLayer();
      shot("night",5,shore,1016);
      if(!sampleLayer().some((p,i)=>p!==day[i])) throw Error("Preset transition left water unchanged");
      window.preview={sim,renderer,b,shore,shot,sampleLayer,candidates};
      return {hitCount:candidates.length, shore,bx:b.x, glasses:renderer.spriteCache.atlasSurface.filter(n=>n===2).length};
    });
    assert.ok(info.hitCount>10);
    assert.ok(info.glasses>0);
    if (!mobile) {
      for (const mode of ["day","sunset","night"]) {
        await page.evaluate(mode=>window.preview.shot(mode,7,window.preview.shore,1000,false),mode);
        await page.screenshot({path:`${output}/reflection-river-${mode}.png`});
        await page.evaluate(mode=>window.preview.shot(mode,7,window.preview.shore-14,1040,true),mode);
        await page.screenshot({path:`${output}/reflection-rain-${mode}.png`});
      }
      await page.evaluate(()=>window.preview.shot("sunset",13,window.preview.shore-10,1000,false));
      await page.screenshot({path:`${output}/reflection-glass-sunset.png`});
      const explosion=await page.evaluate(()=>{
        const {sim,b,shore,shot,sampleLayer}=window.preview;
        shot("night",7,shore);
        const before=sampleLayer();
        sim.physics.shockwaves.push({x:b.x+16,y:shore-2,life:.07,maxLife:.48,maxRadius:15,color:"#ff761e",secondaryColor:"#fff3b2"});
        shot("night",7,shore,1016);
        return sampleLayer().filter((p,i)=>p!==before[i]).length;
      });
      assert.ok(explosion>15);
      await page.screenshot({path:`${output}/reflection-explosion.png`});
    } else {
      for (const mode of ["day","sunset","night"]) {
        await page.evaluate(mode=>window.preview.shot(mode,6,window.preview.shore,1000,false),mode);
        await page.screenshot({path:`${output}/reflection-mobile-${mode}.png`});
        await page.evaluate(mode=>window.preview.shot(mode,6,window.preview.shore-12,1040,true),mode);
        await page.screenshot({path:`${output}/reflection-mobile-rain-${mode}.png`});
      }
    }
    const perf = await page.evaluate(async ()=>{
      const {sim,renderer,b,shore,shot,candidates}=window.preview;
      const {CellMaterial}=await import("/src/void/model.ts");
      const {sampleWaterMirror}=await import("/src/void/reflections.ts");
      sim.physics.shockwaves.length=0;
      const agent = {
        id: 734, kind: "jetpack", layer: "air", homeUid: -1, x: b.x - 5, y: shore - 1,
        vx: 0, vy: 0, hp: 30, maxHp: 30, carryingMatter: 0, state: "idle",
        targetCell: -1, targetNodeId: -1, cooldown: 0,
      };
      sim.combat.agents.push(agent);
      shot("night",5,shore);
      const agentPixel = (shore + 1) * sim.world.grid.w + agent.x;
      if (!renderer.reflections.actorPixels.has(agentPixel)) throw Error("High tier missed the airborne unit");
      const beforeMove = renderer.reflections.water.pixels[agentPixel];
      agent.x++;
      shot("night",5,shore,1016);
      if (renderer.reflections.actorPixels.has(agentPixel) ||
          renderer.reflections.water.pixels[agentPixel] === beforeMove) throw Error("Moving unit left a stale reflection");
      sim.combat.agents.pop();
      const times={};
      for (const rain of [false,true]) for (const zoom of [3,1]) for (const quality of ["high","medium","low"]) {
        if(zoom===1) {
          renderer.resetCam(sim.world.grid.w,sim.world.grid.h);
          renderer.setTimeOfDay("night",true);
          renderer.setWeather(rain?"rain":"clear",true);
        } else shot("night",zoom,shore,1000,rain);
        renderer.lightingQuality=quality;
        const refSamples=[];
        const lightSamples=[];
        const totalSamples=[];
        for(let i=0;i<62;i++){
          renderer.effectiveLightingQuality=quality;
          renderer.draw(sim,1600+i*16,null,null,null,false);
          if(i>=12) {
            refSamples.push(renderer.lastTimings.reflections);
            lightSamples.push(renderer.lastTimings.lighting);
            totalSamples.push(renderer.lastTimings.lighting + renderer.lastTimings.reflections);
          }
        }
        refSamples.sort((a,b)=>a-b);
        lightSamples.sort((a,b)=>a-b);
        totalSamples.sort((a,b)=>a-b);
        const tag = `${rain?"rain":"dry"} ${zoom}x ${quality}`;
        times[tag]={
          lightingP50:Number(lightSamples[25].toFixed(3)),
          reflectionsP50:Number(refSamples[25].toFixed(3)),
          combinedP50:Number(totalSamples[25].toFixed(3)),
          combinedP95:Number(totalSamples[47].toFixed(3)),
        };
      }
      shot("night",5,shore,2800);
      const prior = candidates.map(i=>renderer.reflections.water.pixels[i]);
      const w=sim.world.grid.w;
      const alteredTerrain=sim.world.material;
      for(const cell of b.cells){
        alteredTerrain[cell]=CellMaterial.VOID; sim.world.buildingAt[cell]=-1; sim.world.columnFloors[cell]=0;
        sim.world.hp[cell]=0;sim.world.grid.markIndexDirty(cell);
      }
      shot("night",5,shore,3000);
      const stillOwned=candidates.filter(i=>{
        const hit=sampleWaterMirror(i%w,(i/w)|0,w,renderer.spriteCache);
        return hit>=0&&renderer.spriteCache.atlasBldId[hit]===b.id;
      }).length;
      return {times,stillOwned,changed:candidates.filter((i,k)=>prior[k]!==renderer.reflections.water.pixels[i]).length};
    });
    assert.equal(perf.stillOwned,0);
    assert.ok(perf.changed>10);
    assert.deepEqual(errors,[]);
    console.log(mobile?"mobile":"desktop",JSON.stringify({info,perf}));
    await page.close();
  }
} finally {await browser.close();}
