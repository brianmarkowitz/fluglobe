import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { geoEquirectangular, geoPath } from 'd3';
import { feature } from 'topojson-client';
import { globePoint as point } from './globeMath.js';
import { flyways } from './atlasData.js';

const dispose = object => object.traverse(child => {
  child.geometry?.dispose();
  const materials = Array.isArray(child.material) ? child.material : [child.material];
  materials.forEach(material => { material?.map?.dispose(); material?.dispose(); });
});
const severityColor = row => row.severity === 'high' ? '#ff8d86' : row.severity === 'medium' ? '#ffc981' : '#9bf1d4';

export default function OrbitalGlobe({ rows, selected, onSelect, route, layers, spin, mode, focus, zoomCommand, reducedMotion, onFallback }) {
  const host = useRef(null), sceneRef = useRef(null), latest = useRef({});
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const [hover, setHover] = useState(null);
  latest.current = { onSelect, spin, reducedMotion };

  useEffect(() => {
    if (failed) return;
    const container = host.current;
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' }); }
    catch { setFailed(true); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);
    renderer.domElement.setAttribute('aria-label', '3D Earth. Drag to orbit, scroll to zoom. Select records using the list below.');
    renderer.domElement.setAttribute('role', 'img');
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, .1, 100);
    camera.position.copy(point(23, 12, 3.65));
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false; controls.enableDamping = true; controls.dampingFactor = .065;
    controls.minDistance = 1.6; controls.maxDistance = 5.2; controls.autoRotateSpeed = .32;
    controls.rotateSpeed = .55;
    const earthGroup = new THREE.Group(); scene.add(earthGroup);
    const earthMaterial = new THREE.MeshPhongMaterial({ color: 0xffffff, shininess: 20, specular: 0x18444f });
    const earth = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), earthMaterial); earthGroup.add(earth);
    const ambient = new THREE.AmbientLight(0x779bcf, 2.1); scene.add(ambient);
    const sun = new THREE.DirectionalLight(0xc6eeff, 3); sun.position.set(3, 4, 5); scene.add(sun);
    const rim = new THREE.DirectionalLight(0x556bff, 2); rim.position.set(-4, 0, -3); scene.add(rim);
    const atmosphere = new THREE.Mesh(new THREE.SphereGeometry(1.055, 64, 48), new THREE.ShaderMaterial({
      vertexShader: 'varying vec3 vNormal; varying vec3 vPosition; void main(){ vNormal=normalize(normalMatrix*normal); vec4 p=modelViewMatrix*vec4(position,1.0); vPosition=p.xyz; gl_Position=projectionMatrix*p; }',
      fragmentShader: 'varying vec3 vNormal; varying vec3 vPosition; void main(){ float rim=pow(1.0-abs(dot(normalize(vNormal),normalize(-vPosition))),3.6); gl_FragColor=vec4(0.16,0.56,1.0,rim*0.65); }',
      side: THREE.FrontSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
    })); earthGroup.add(atmosphere);
    const grid = new THREE.Group(); earthGroup.add(grid);
    const gridMaterial = new THREE.LineBasicMaterial({ color: 0x729cda, transparent: true, opacity: .12 });
    for (let lat = -60; lat <= 60; lat += 30) grid.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(Array.from({length:181},(_,i)=>point(lat,i*2,1.003))),gridMaterial));
    for (let lng = 0; lng < 360; lng += 30) grid.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(Array.from({length:91},(_,i)=>point(i*2-90,lng,1.003))),gridMaterial));
    const starPositions = [];
    let seed = 42;
    const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for(let i=0;i<650;i++) { const v = point(rand()*180-90,rand()*360,12+rand()*10); starPositions.push(v.x,v.y,v.z); }
    const stars = new THREE.Points(new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(starPositions,3)),new THREE.PointsMaterial({color:0xa6b9e7,size:.04,transparent:true,opacity:.7,sizeAttenuation:true})); scene.add(stars);
    const routes = new THREE.Group(), markers = new THREE.Group(); earthGroup.add(routes, markers);
    const particles = [];
    flyways.forEach((flyway,index) => {
      const points = flyway.points.map(([lat,lng],i)=>point(lat,lng,1.025+Math.sin(i/(flyway.points.length-1)*Math.PI)*.14));
      const curve = new THREE.CatmullRomCurve3(points);
      const group = new THREE.Group(); group.userData.index = index;
      const line = new THREE.Mesh(new THREE.TubeGeometry(curve,110,.0018,4,false),new THREE.MeshBasicMaterial({color:flyway.color,transparent:true,opacity:.65})); group.add(line);
      group.add(new THREE.Mesh(new THREE.TubeGeometry(curve,110,.006,4,false),new THREE.MeshBasicMaterial({color:flyway.color,transparent:true,opacity:.08,blending:THREE.AdditiveBlending,depthWrite:false})));
      for(let p=0;p<3;p++) {
        const bead = new THREE.Mesh(new THREE.SphereGeometry(.007,8,6),new THREE.MeshBasicMaterial({color:flyway.color})); group.add(bead); particles.push({bead,curve,offset:p/3,index});
      }
      routes.add(group);
    });
    const state = { renderer, scene, camera, controls, earthMaterial, ambient, sun, rim, grid, routes, markers, particles, target: null, rings: [], pickables: [] };
    sceneRef.current = state;
    let alive = true;
    const abort = new AbortController();
    fetch('/data/countries-110m.json', {signal:abort.signal}).then(r=>{if(!r.ok) throw Error('Map unavailable');return r.json();}).then(topology => {
      if(!alive) return;
      const canvas = document.createElement('canvas'); canvas.width = 2048; canvas.height = 1024;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#071a30'; ctx.fillRect(0,0,2048,1024);
      const projection = geoEquirectangular().translate([1024,512]).scale(2048/(2*Math.PI));
      const path = geoPath(projection,ctx);
      const countries = feature(topology,topology.objects.countries);
      countries.features.forEach(country=> {ctx.beginPath();path(country);ctx.fillStyle='#23576b';ctx.fill();ctx.strokeStyle='#498393';ctx.lineWidth=.65;ctx.stroke();});
      // Subtle cartographic stipple gives the land texture without invented geography.
      ctx.globalAlpha=.12; ctx.fillStyle='#96c6d3';
      for(let y=0;y<1024;y+=4) for(let x=(y%8);x<2048;x+=6) ctx.fillRect(x,y,.8,.8);
      const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
      earthMaterial.map = texture; earthMaterial.needsUpdate = true; setReady(true);
    }).catch(error=> {if(error.name !== 'AbortError' && alive) setFailed(true);});
    const resize = () => { const w=container.clientWidth, h=container.clientHeight; if(!w||!h)return;renderer.setSize(w,h);camera.aspect=w/h;camera.fov=THREE.MathUtils.radToDeg(2*Math.atan(Math.tan(THREE.MathUtils.degToRad(38)/2)/Math.min(1,w/h)));camera.updateProjectionMatrix(); };
    const observer = new ResizeObserver(resize); observer.observe(container);resize();
    let visible=true;const visibilityObserver=new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;});visibilityObserver.observe(container);
    const raycaster = new THREE.Raycaster(); let pointerDown = null;
    const pick = event => {
      const rect=renderer.domElement.getBoundingClientRect();
      raycaster.setFromCamera(new THREE.Vector2((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1),camera);
      const hits=raycaster.intersectObjects([earth,...state.pickables],false);
      return hits[0]?.object.userData.row || null;
    };
    const down = e => { pointerDown = [e.clientX,e.clientY];state.target=null; };
    const up = e => { if(pointerDown && Math.hypot(e.clientX-pointerDown[0],e.clientY-pointerDown[1])<5) { const row=pick(e);if(row) latest.current.onSelect(row); } pointerDown=null; };
    const move = e => { const row=pick(e);container.style.cursor=row?'pointer':'grab';setHover(row ? {country:row.country,virus:row.virus} : null); };
    const leave = () => setHover(null);
    renderer.domElement.addEventListener('pointerdown',down);renderer.domElement.addEventListener('pointerup',up);renderer.domElement.addEventListener('pointermove',move);renderer.domElement.addEventListener('pointerleave',leave);
    const lost = e => {e.preventDefault();setFailed(true);};renderer.domElement.addEventListener('webglcontextlost',lost);
    let frame, last = 0;
    const draw = time => {
      frame=requestAnimationFrame(draw);
      if(document.hidden || !visible || time-last<32) return; last=time;
      controls.autoRotate=latest.current.spin && !latest.current.reducedMotion && !state.target;
      if(state.target) { camera.position.lerp(state.target,latest.current.reducedMotion?1:.075);if(camera.position.distanceTo(state.target)<.005)state.target=null; }
      controls.update();
      for(const p of particles) p.bead.position.copy(p.curve.getPointAt(latest.current.reducedMotion?p.offset:(time*.000035+p.offset)%1));
      state.rings.forEach((ring,i)=> {const t=latest.current.reducedMotion ? .35 : (time*.0005+i*.17)%1;ring.scale.setScalar(1+t*1.8);ring.material.opacity=(1-t)*.65;});
      renderer.render(scene,camera);
    };frame=requestAnimationFrame(draw);
    return () => {alive=false;abort.abort();cancelAnimationFrame(frame);observer.disconnect();visibilityObserver.disconnect();controls.dispose();renderer.domElement.removeEventListener('pointerdown',down);renderer.domElement.removeEventListener('pointerup',up);renderer.domElement.removeEventListener('pointermove',move);renderer.domElement.removeEventListener('pointerleave',leave);renderer.domElement.removeEventListener('webglcontextlost',lost);dispose(scene);renderer.dispose();renderer.domElement.remove();sceneRef.current=null;};
  }, [failed]);

  useEffect(()=> {
    const s=sceneRef.current;if(!s)return;
    dispose(s.markers);s.markers.clear();s.rings=[];s.pickables=[];
    const haloCanvas=document.createElement('canvas');haloCanvas.width=64;haloCanvas.height=64;
    const ctx=haloCanvas.getContext('2d'), gradient=ctx.createRadialGradient(32,32,0,32,32,32);
    gradient.addColorStop(0,'rgba(255,255,255,.85)');gradient.addColorStop(.15,'rgba(255,255,255,.35)');gradient.addColorStop(1,'rgba(255,255,255,0)');
    ctx.fillStyle=gradient;ctx.fillRect(0,0,64,64);const haloTexture=new THREE.CanvasTexture(haloCanvas);
    rows.filter(row=>Number.isFinite(Number(row.lat))&&Number.isFinite(Number(row.lng))).forEach((row,i)=> {
      const color=severityColor(row), group=new THREE.Group();
      group.position.copy(point(Number(row.lat),Number(row.lng),1.006));group.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),group.position.clone().normalize());
      const size=selected?.id===row.id ? .018 : .011;
      const dot=new THREE.Mesh(new THREE.SphereGeometry(size,10,8),new THREE.MeshBasicMaterial({color}));dot.userData.row=row;group.add(dot);s.pickables.push(dot);
      const halo=new THREE.Sprite(new THREE.SpriteMaterial({map:haloTexture,color,transparent:true,opacity:.7,blending:THREE.AdditiveBlending,depthWrite:false}));halo.scale.setScalar(selected?.id===row.id ? .1 : .065);group.add(halo);
      const ring=new THREE.Mesh(new THREE.RingGeometry(.017,.020,28),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.6,side:THREE.DoubleSide,depthWrite:false}));group.add(ring);if(i<100)s.rings.push(ring);
      const stem=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3(0,0,.025+Math.min(.10,Math.log10(Number(row.cases||1)+1)*.02))]),new THREE.LineBasicMaterial({color,transparent:true,opacity:.7}));group.add(stem);s.markers.add(group);
    });s.markers.visible=layers.outbreaks;
    return ()=>haloTexture.dispose();
  },[rows,selected,ready,layers.outbreaks]);
  useEffect(()=>{const s=sceneRef.current;if(!s)return;s.routes.visible=layers.routes;s.grid.visible=layers.grid;s.routes.children.forEach((group,i)=>{group.visible=route===null||route===i;});},[layers,route,ready]);
  useEffect(()=>{const s=sceneRef.current;if(!s)return;s.ambient.intensity=mode==='night' ? .5 : 2.1;s.sun.intensity=mode==='night'?1.2:3;s.earthMaterial.color.set(mode==='night'?'#658ab4':'#ffffff');},[mode,ready]);
  useEffect(()=>{const s=sceneRef.current;if(!s||!focus)return;s.target=point(focus.lat,focus.lng,focus.distance||3.2);},[focus,ready]);
  useEffect(()=>{const s=sceneRef.current;if(!s||!zoomCommand)return;s.target=s.camera.position.clone().normalize().multiplyScalar(THREE.MathUtils.clamp(s.camera.position.length()*zoomCommand.factor,1.6,5.2));},[zoomCommand]);
  if(failed) return <div className="globe-fallback"><span>◉</span><h3>3D view unavailable</h3><p>Your browser couldn’t load the globe. All records, filters, and timeline controls remain available below.</p><button onClick={onFallback}>Open the 2D atlas →</button></div>;
  return <><div className="webgl-mount" ref={host}/>{!ready&&<div className="globe-loading">Preparing your orbital view…</div>}{hover&&<div className="globe-hover"><strong>{hover.country}</strong><span>{hover.virus} · Click to inspect</span></div>}</>;
}
