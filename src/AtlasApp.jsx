import React, { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { outbreakData, flyways } from './atlasData.js';
import useAtlasData from './useAtlasData.js';
import OutbreakExplorer from './OutbreakExplorer.jsx';
import { matchesSearch } from './explorer.js';
import { monthlyCounts } from './timeline.js';
import './orbital.css';
const OrbitalGlobe = lazy(() => import('./OrbitalGlobe.jsx'));
const monthLabel = value => new Date(`${value}-01T00:00:00Z`).toLocaleDateString('en-US',{month:'short',year:'numeric',timeZone:'UTC'});

export default function AtlasApp({ onOpenFlatMap }) {
  const data = useAtlasData();
  const allRows = data.liveOutbreakData.length ? data.liveOutbreakData : outbreakData;
  const [search,setSearch]=useState(''), [virus,setVirus]=useState('all'), [host,setHost]=useState('all');
  const [month,setMonth]=useState('all'),[playing,setPlaying]=useState(false);
  const [route,setRoute]=useState(null),[selected,setSelected]=useState(null);
  const [reducedMotion,setReducedMotion]=useState(()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [spin,setSpin]=useState(()=>!window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [mode,setMode]=useState('atlas'),[layers,setLayers]=useState({routes:true,outbreaks:true,grid:true});
  const [focus,setFocus]=useState(null),[zoomCommand,setZoomCommand]=useState(null),[cinema,setCinema]=useState(false);
  useEffect(()=>{const q=window.matchMedia('(prefers-reduced-motion: reduce)');const update=()=>{setReducedMotion(q.matches);if(q.matches){setSpin(false);setPlaying(false);}};q.addEventListener('change',update);return()=>q.removeEventListener('change',update);},[]);
  useEffect(()=>{const exit=e=>{if(e.key==='Escape')setCinema(false);};window.addEventListener('keydown',exit);return()=>window.removeEventListener('keydown',exit);},[]);
  const strains=useMemo(()=>[...new Set(allRows.map(r=>r.virus))].sort(),[allRows]);
  const hosts=useMemo(()=>[...new Set(allRows.map(r=>r.type))].sort(),[allRows]);
  useEffect(()=>{if(!strains.includes(virus))setVirus('all');if(!hosts.includes(host))setHost('all');},[strains,hosts,virus,host]);
  const baseRows=useMemo(()=>allRows.filter(r=>matchesSearch(r,search)&&(virus==='all'||r.virus===virus)&&(host==='all'||r.type===host)),[allRows,search,virus,host]);
  const counts=useMemo(()=>monthlyCounts(baseRows),[baseRows]);
  const months=useMemo(()=>Object.keys(counts),[counts]);
  useEffect(()=>{if(month!=='all'&&!months.includes(month))setMonth('all');},[months,month]);
  const rows=useMemo(()=>baseRows.filter(r=>month==='all'||String(r.date).startsWith(month)),[baseRows,month]);
  const maxCount=Math.max(1,...Object.values(counts));
  useEffect(()=>{if(!playing||!months.length)return;const timer=setInterval(()=>setMonth(m=>months[(months.indexOf(m)+1)%months.length]),1800);return()=>clearInterval(timer);},[playing,months]);
  useEffect(()=>{setSelected(null);},[search,virus,host,month,allRows]);
  const reset=()=>{setSearch('');setVirus('all');setHost('all');setMonth('all');setPlaying(false);setSelected(null);};
  const selectRecord=row=>{setCinema(false);setSelected(row);setSpin(false);setFocus({lat:Number(row.lat),lng:Number(row.lng),distance:2.9,key:Date.now()});setLayers(l=>({...l,outbreaks:true}));document.getElementById('orbital-stage')?.scrollIntoView({behavior:reducedMotion?'instant':'smooth',block:'start'});};
  const selectRoute=index=>{setRoute(route===index?null:index);setLayers(l=>({...l,routes:true}));if(route!==index){const points=flyways[index].points;const [lat,lng]=points[Math.floor(points.length/2)];setFocus({lat,lng,distance:3.65,key:Date.now()});setSpin(false);}};
  const toggleLayer=key=>setLayers(l=>({...l,[key]:!l[key]}));
  const locations=new Set(rows.map(r=>`${Number(r.lat).toFixed(2)},${Number(r.lng).toFixed(2)}`)).size;
  const activeRoute=route===null?null:flyways[route];
  return <main className={`observatory ${cinema?'cinema-mode':''}`}>
    <header className="orbital-header"><a className="orbital-brand" href="#orbital-stage"><span className="orbit-logo" aria-hidden="true">◯</span>FluGlobe<span className="brand-descriptor">BIRD INFLUENZA<br/>ORBITAL ATLAS</span></a><nav aria-label="Main navigation"><a className="active" href="#orbital-stage">Explore</a><a href="#records">Records <span>{allRows.length}</span></a><button onClick={onOpenFlatMap}>2D map ↗</button></nav><div className={`source-badge ${data.isUsingFallbackData?'sample':''}`}><i/><div><strong>{data.isUsingFallbackData?'Sample dataset':'Source dataset'}</strong><small>{data.isUsingFallbackData?'Illustrative · 2024–2025':data.dataUpdatedAt?`Fetched ${new Date(data.dataUpdatedAt).toLocaleDateString()}`:'Cached records'}</small></div></div></header>
    <section className="orbital-stage" id="orbital-stage" aria-label="Interactive orbital atlas">
      <div className="space-glow"/>
      <div className="stage-copy"><span className="overline">MIGRATORY BIRDS. SHARED WORLDS.</span><h1>One planet.<br/><em>Connected.</em></h1><p>Explore avian influenza reports<br className="desktop-break"/> across a world in motion.</p><div className="hero-metrics"><div><strong>{rows.length.toLocaleString()}</strong><span>RECORDS IN VIEW</span></div><div><strong>{locations}</strong><span>MAPPED LOCATIONS</span></div><div><strong>{flyways.length.toString().padStart(2,'0')}</strong><span>REFERENCE FLYWAYS</span></div></div><div className="visual-key"><span><i className="coral-dot"/>Outbreak records</span><span><i className="cyan-line"/>Migration reference paths</span></div><p className="science-note">Connections are geographic context,<br/>not evidence of transmission.</p></div>
      <div className="globe-viewport"><Suspense fallback={<div className="globe-loading">Opening the observatory…</div>}><OrbitalGlobe rows={rows} selected={selected} onSelect={selectRecord} route={route} layers={layers} spin={spin} mode={mode} focus={focus} zoomCommand={zoomCommand} reducedMotion={reducedMotion} onFallback={onOpenFlatMap}/></Suspense></div>
      <div className="orbital-coordinate" aria-hidden="true">EARTH / {mode==='night'?'NIGHT STUDY':'ORBITAL VIEW'}<span>DRAG TO ORBIT · SCROLL TO ZOOM</span></div>
      <aside className="route-panel"><div className="panel-title"><span className="overline">{selected?'RECORD SPOTLIGHT':'MIGRATION ATLAS'}</span><span className="tiny-orbit">✧</span></div>
        {selected ? <div className="spotlight"><button className="close-spotlight" aria-label="Close selected record" onClick={()=>setSelected(null)}>×</button><span className="spotlight-type">{selected.virus} / {selected.type}</span><h2>{selected.country}</h2><div className="spotlight-count">{Number(selected.cases||0).toLocaleString()}<small>reported count · source-specific units</small></div><dl><div><dt>Report date</dt><dd>{selected.date}</dd></div><div><dt>Source</dt><dd>{selected.source||(data.isUsingFallbackData?'Sample dataset':'Unavailable')}</dd></div><div><dt>Coordinates</dt><dd>{Number(selected.lat).toFixed(1)}°, {Number(selected.lng).toFixed(1)}°</dd></div></dl></div> : <><h2>{activeRoute?activeRoute.name:'Journeys without borders.'}</h2><p className="route-description">{activeRoute?activeRoute.description:'Follow eight reference flyways across a connected planet.'}</p><div className="route-art" aria-hidden="true"><svg viewBox="0 0 260 80"><path d="M10 70 Q90 -25 250 25 M10 70 Q110 10 250 25 M10 70 Q160 85 250 25" fill="none" stroke={activeRoute?.color||'#88cbed'} strokeWidth="1"/><circle cx="10" cy="70" r="3" fill="#98e8ee"/><circle cx="250" cy="25" r="3" fill="#98e8ee"/><path d="M119 33 l12 4 12 -7 -7 9 7 7 -13 -3 -9 7 3 -10z" fill="#bdedff"/></svg></div></>}
        <div className="route-list" aria-label="Migration flyways">{flyways.map((f,i)=><button key={f.name} aria-pressed={route===i} onClick={()=>selectRoute(i)} style={{'--route-color':f.color}}><span className="route-number">{String(i+1).padStart(2,'0')}</span><i/><span>{f.name}</span><span className="route-arrow">↗</span></button>)}</div>
        <div className="panel-foot">{activeRoute?<button onClick={()=>setRoute(null)}>Show all flyways ↗</button>:<span>Select a flyway to bring it into focus</span>}</div>
      </aside>
      <div className="globe-toolbar" aria-label="Globe controls"><div className="glass-dock"><button aria-pressed={mode==='atlas'} onClick={()=>setMode('atlas')}><span>◎</span> Atlas</button><button aria-pressed={mode==='night'} onClick={()=>setMode('night')}><span>☾</span> Night</button><span className="dock-divider"/><button aria-pressed={spin} onClick={()=>setSpin(!spin)} disabled={reducedMotion}><span>{spin?'Ⅱ':'▷'}</span> {spin?'Pause orbit':'Orbit'}</button><button aria-label="Toggle cinema view" aria-pressed={cinema} onClick={()=>setCinema(!cinema)}>⛶</button></div><div className="zoom-dock"><button aria-label="Zoom in" onClick={()=>setZoomCommand({factor:.8,key:Date.now()})}>+</button><button aria-label="Zoom out" onClick={()=>setZoomCommand({factor:1.25,key:Date.now()})}>−</button><button aria-label="Reset globe view" onClick={()=>{setFocus({lat:23,lng:12,distance:3.65,key:Date.now()});setRoute(null);}}>↺</button></div></div>
    </section>
    <section className="time-panel" aria-label="Record timeline"><div className="timeline-title"><span className="overline">THROUGH TIME</span><strong>{month==='all'?'All observations':monthLabel(month)}</strong><small>Record counts by report month</small></div><button className="play-timeline" aria-label={playing?'Pause timeline':'Play timeline'} disabled={!months.length} onClick={()=>setPlaying(!playing)}>{playing?'Ⅱ':'▷'}</button><div className="timeline-bars">{months.map(m=><button key={m} className={month===m?'selected':''} aria-pressed={month===m} aria-label={`${monthLabel(m)}: ${counts[m]} records`} onClick={()=>{setMonth(m===month?'all':m);setPlaying(false);}}><span className="bar-slot"><span style={{height:`${Math.max(8,counts[m]/maxCount*100)}%`}}/></span><small>{monthLabel(m)}</small></button>)}</div><button className={`all-time ${month==='all'?'chosen':''}`} onClick={()=>{setMonth('all');setPlaying(false);}}>All dates</button></section>
    <section className="atlas-workbench" id="records"><div className="workbench-heading"><div><span className="overline">LOOK A LITTLE CLOSER</span><h2>The stories in the data.</h2></div><button className="refresh-source" disabled={data.isRefreshingData} onClick={()=>data.loadLiveData(true)}>{data.isRefreshingData?'↻ Fetching sources…':'↻ Refresh source data'}</button></div>
      <div className="filter-dock"><label className="atlas-search"><span>⌕</span><input aria-label="Search the atlas" type="search" placeholder="Search a place, strain, or source…" value={search} onChange={e=>setSearch(e.target.value)}/></label><label>STRAIN<select value={virus} onChange={e=>setVirus(e.target.value)}><option value="all">All strains</option>{strains.map(v=><option key={v}>{v}</option>)}</select></label><label>HOST<select value={host} onChange={e=>setHost(e.target.value)}><option value="all">All hosts</option>{hosts.map(h=><option key={h}>{h}</option>)}</select></label><button onClick={reset}>Reset filters</button></div>
      <div className="layer-strip"><span className="overline">MAP LAYERS</span>{[['outbreaks','Outbreak beacons'],['routes','Migration paths'],['grid','Coordinate grid']].map(([key,label])=><button key={key} aria-pressed={layers[key]} onClick={()=>toggleLayer(key)}><i/>{label}</button>)}<span className="results-label" aria-live="polite">{rows.length} of {allRows.length} records</span></div>
      {data.dataError&&<div className="data-notice" role="status"><strong>Source refresh unavailable</strong><p>{data.dataError}</p><span>{data.isUsingFallbackData?'Showing the illustrative sample dataset.':'Keeping previously downloaded records.'}</span></div>}
      {!data.dataError&&data.dataWarnings.length>0&&<div className="data-notice">{data.dataWarnings.join(' ')}</div>}
      <OutbreakExplorer rows={rows} sample={data.isUsingFallbackData} onFocus={selectRecord} onReset={reset} selected={selected}/>
    </section>
    <footer className="orbital-footer"><span>PEOPLE · WILDLIFE · ONE PLANET</span><p>{data.isUsingFallbackData?'Illustrative sample records · Aug 2024–Jan 2025':'Source data: USDA & OWID (WHO)'} · Reference flyways: BirdLife International</p><span>FluGlobe / 2026</span></footer>
  </main>;
}
