export const actions = [[4,'Arriba','KeyW',12],[5,'Abajo','KeyS',13],[6,'Izquierda','KeyA',14],[7,'Derecha','KeyD',15],[0,'Cruz / A','Numpad2',0],[8,'Círculo / B','Numpad6',1],[1,'Cuadrado / X','Numpad4',2],[9,'Triángulo / Y','Numpad8',3],[3,'Start','Enter',9],[2,'Select','ShiftRight',8],[10,'L1 / LB','KeyQ',4],[11,'R1 / RB','KeyE',5],[12,'L2 / LT','KeyZ',6],[13,'R2 / RT','KeyC',7]];
export function setupControls(write) {
 const $=s=>document.querySelector(s),dialog=$('#controls-dialog'),device=$('#device');
 const arcadeLabels = new Map([[0, 'Disparo'], [8, 'Salto'], [1, 'Granada'], [9, 'Acción'], [2, 'Ficha']]);
 let arcade = false;
 window.addEventListener('nsm:arcade-controls', () => { arcade = true; render(); });
 let bindings=Object.fromEntries(actions.map(([id,,key,pad])=>[id,{key,pad}]));
 try {const saved=JSON.parse(localStorage.getItem('nsm.crash.controls.v1'));for(const [id] of actions)if(typeof saved?.[id]?.key==='string'&&Number.isInteger(saved[id].pad)&&saved[id].pad>=0&&saved[id].pad<32)bindings[id]=saved[id];}catch{}
 let touchMask=0;
 let pressed=new Set(),remap=null,oldButtons=[],lastMask=0,alive=true,padList='',frame;
 const release=()=>{pressed.clear();touchMask=0;window.dispatchEvent(new Event("nsm:release-touch"));lastMask=0;write(0);};
 const save=()=>{try{localStorage.setItem('nsm.crash.controls.v1',JSON.stringify(bindings));}catch{}render();};
 function render(){
  $('#bindings').replaceChildren(...actions.map(([id,label])=>{
   const row=document.createElement('label');row.className='binding';row.append(document.createTextNode(arcade ? arcadeLabels.get(id) ?? label : label));
   const button=document.createElement('button');button.textContent=remap===id?'Presioná…':device.value==='keyboard'?bindings[id].key.replace('Key','').replace('Numpad','Num '):'Botón '+bindings[id].pad;
   button.setAttribute('aria-label','Cambiar '+label);button.onclick=()=>{release();remap=id;render();};row.append(button);return row;
  }));
 }
 $('#settings').onclick=()=>{release();dialog.showModal();render();};
 dialog.addEventListener('close',()=>{remap=null;release();$('#game').focus();});
 device.onchange=()=>{remap=null;release();render();};
 $('#reset-controls').onclick=()=>{bindings=Object.fromEntries(actions.map(([id,,key,pad])=>[id,{key,pad}]));remap=null;release();save();};
 for(const type of ['keydown','keyup'])window.addEventListener(type,event=>{
  if(dialog.open&&remap!==null&&device.value==='keyboard'&&type==='keydown'){event.preventDefault();event.stopImmediatePropagation();bindings[remap].key=event.code;remap=null;save();return;}
  if(dialog.open||device.value!=='keyboard'||/INPUT|TEXTAREA|SELECT|BUTTON/.test(event.target.tagName))return;
  if(!Object.values(bindings).some(b=>b.key===event.code))return;
  event.preventDefault();event.stopImmediatePropagation();if(type==='keydown')pressed.add(event.code);else pressed.delete(event.code);update();
 },true);
 window.addEventListener('blur',release);
 document.addEventListener('visibilitychange',()=>{if(document.hidden)release();});
 $('#game').addEventListener('pointerdown',()=>$('#game').focus());
 function update(){
  if(!alive)return;
  const pads=navigator.getGamepads?Array.from(navigator.getGamepads()).filter(Boolean):[];
  const list=pads.map(p=>p.index+':'+p.id).join('|');
  if(list!==padList){padList=list;const previous=device.value;device.replaceChildren(new Option('Teclado','keyboard'),...pads.map(p=>new Option(p.id,String(p.index))));device.value=[...device.options].some(o=>o.value===previous)?previous:'keyboard';$('#pad-status').textContent=pads.length?'Mando detectado. Elegilo en Dispositivo.':'Presioná un botón del mando para detectarlo.';release();render();}
  const pad=pads.find(p=>String(p.index)===device.value);
  if(dialog.open&&remap!==null&&pad){const index=pad.buttons.findIndex((b,i)=>b.pressed&&!oldButtons[i]);if(index>=0){bindings[remap].pad=index;remap=null;save();}}
  oldButtons=pad?.buttons.map(b=>b.pressed)??[];
  let mask=0;
  if(!dialog.open&&document.hasFocus()&&!document.hidden){
   mask=touchMask;
   for(const [id] of actions)if(device.value==='keyboard'?pressed.has(bindings[id].key):pad?.buttons[bindings[id].pad]?.pressed)mask|=1<<id;
   if(pad){if(pad.axes[0]<-0.35)mask|=1<<6;if(pad.axes[0]>0.35)mask|=1<<7;if(pad.axes[1]<-0.35)mask|=1<<4;if(pad.axes[1]>0.35)mask|=1<<5;}
  }
  if(mask!==lastMask){lastMask=mask;write(mask);}
 }
 function tick(){if(!alive)return;update();frame=requestAnimationFrame(tick);}
 render();tick();return{setTouchMask(next){touchMask=next;update();},dispose(){release();alive=false;cancelAnimationFrame(frame);}};
}
