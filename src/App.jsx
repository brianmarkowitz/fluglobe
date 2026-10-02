import React, { lazy, Suspense, useState } from 'react';
import AtlasApp from './AtlasApp.jsx';
const ClassicAtlas = lazy(() => import('./FluGlobeVisualization.jsx'));
export default function App() {
  const [classic, setClassic] = useState(false);
  return classic ? <><div className="classic-return"><button onClick={() => setClassic(false)}>← Return to the orbital atlas</button><span>2D atlas / SVG rendering</span></div><Suspense fallback={<p>Loading 2D atlas…</p>}><ClassicAtlas /></Suspense></> : <AtlasApp onOpenFlatMap={() => setClassic(true)} />;
}
