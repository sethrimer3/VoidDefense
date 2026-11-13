/** Seeded browser checks for raised farmhouses, living wheat, unit parting and real fire. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
const out = 'test-results/void-farms';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_EXECUTABLE || '/usr/bin/chromium', headless: true });
try {
  for (const [name,width,height] of [['desktop',1280,800],['phone',390,844]]) {
    const page = await browser.newPage({ viewport: { width,height } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(process.env.TEST_URL || 'http://127.0.0.1:5173/');
    const fixture = await page.evaluate(async () => {
      const { VoidSim } = await import('/src/void/sim.ts');
      const { VoidRenderer } = await import('/src/void/render.ts');
      const { emptyTechWallet } = await import('/src/void/tech/wallet.ts');
      const { CellMaterial, LandCover } = await import('/src/void/model.ts');
      const { elevationOf } = await import('/src/void/elevation.ts');
      const sim = new VoidSim('tutorialBreach','underSiege',emptyTechWallet(),true);
      const w = sim.world;
      const b = w.buildings.find(b => b.archStyle === 'homestead' && b.x > 10 && b.y > 10 && b.x < w.grid.w - 55 && b.y < w.grid.h - 35 && b.cells.every(i => w.buildingAt[i] === b.id));
      if (!b) throw new Error('No intact farmhouse');
      const fx=b.x+b.w+3, fy=b.y-3;
      for(let y=fy;y<fy+24;y++)for(let x=fx;x<fx+40;x++){
        const i=w.grid.index(x,y); w.material[i]=CellMaterial.PARK;w.landCover[i]=LandCover.FIELD_H;
        w.hp[i]=w.maxHp[i]=70;w.buildingAt[i]=-1;w.columnFloors[i]=0;w.wheatCells.add(i);w.grid.markIndexDirty(i);
      }
      sim.voidField.rebuildFrontier(w);
      const canvas=document.createElement('canvas');canvas.style.cssText='position:fixed;inset:0;width:100vw;height:100vh;z-index:99999';document.body.append(canvas);
      const renderer=new VoidRenderer(canvas);renderer.resize(w.grid.w,w.grid.h);renderer.cam.s=innerWidth<500?12:10;
      const scale=renderer.pixelScale();renderer.cam.x=Math.round(canvas.width/2-(fx+14)*scale);renderer.cam.y=Math.round(canvas.height/2-(fy+10)*scale);
      const draw=()=>renderer.draw(sim,1000,null,null,null,false);
      draw();
      window.farmFixture={sim,renderer,draw,canvas,b,fx,fy};
      return { elevation:elevationOf(b,'full'),style:b.archStyle };
    });
    assert.ok(fixture.elevation>=2);
    await page.screenshot({ path:`${out}/${name}-wheat.png` });
    const motion=await page.evaluate(()=>{
      const f=window.farmFixture;
      const first=f.canvas.toDataURL();f.sim.elapsedSeconds=1.5;f.draw();const wind=first!==f.canvas.toDataURL();
      f.sim.combat.agents.push({id:999,kind:'rifleman',homeUid:-1,x:f.fx+12,y:f.fy+12,vx:0,vy:0,hp:50,maxHp:50,layer:'ground',cooldown:0,carryingMatter:0,state:'patrol',targetCell:-1,targetNodeId:-1});
      f.draw();return {wind};
    });
    assert.ok(motion.wind,'wind changes the rendered scene');
    await page.screenshot({ path:`${out}/${name}-parted.png` });
    const burning=await page.evaluate(()=>{
      const f=window.farmFixture;
      f.sim.combat.lasers.push({x0:f.b.x,y0:f.b.y+1,x1:f.fx+35,y1:f.fy+12,ttl:0.2,color:'#ff6b2b',energy:true});
      f.sim.farms.step(1/30,f.sim.combat.lasers);f.draw();
      return {count:f.sim.farms.active.size,structure:f.b.cells.some(i=>f.sim.farms.active.has(i))};
    });
    assert.ok(burning.count>0 && burning.structure,'energy beam ignites both wheat and farmhouse');
    await page.screenshot({ path:`${out}/${name}-fire.png` });
    const burnt=await page.evaluate(()=>{
      const f=window.farmFixture;
      for(let i=0;i<250;i++)f.sim.farms.step(1/30,[]);
      f.draw();
      return [...f.sim.farms.scorch].filter(x=>x===2).length;
    });
    assert.ok(burnt>0);
    await page.screenshot({ path:`${out}/${name}-scorched.png` });
    assert.deepEqual(errors,[]);
    await writeFile(`${out}/${name}.json`,JSON.stringify({fixture,burning,burnt},null,2));
    await page.close();
  }
  console.log('Farm browser checks passed: desktop + phone, depth, wind, parting fixture, energy ignition, scorched aftermath.');
} finally { await browser.close(); }
