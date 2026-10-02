import React from 'react';

export default function AtlasIcon({ type }) {
  const paths = {
    bird: <><path d="M3 25c9 2 13-2 17-7l7-9 5 1 3 4-6 1-2 13c-3 6-8 9-15 6l-9-9Z"/><path d="m15 34 2 9m6-9 1 9m-10 0h6m1 0h6"/></>,
    virus: <><circle cx="24" cy="24" r="13"/><path d="M24 3v8m0 26v8M3 24h8m26 0h8M9 9l6 6m18 18 6 6M9 39l6-6m18-18 6-6"/><circle cx="20" cy="20" r="1"/><circle cx="29" cy="26" r="1"/><circle cx="19" cy="29" r="1"/></>,
    globe: <><circle cx="24" cy="24" r="20"/><ellipse cx="24" cy="24" rx="9" ry="20"/><path d="M5 17h38M4 25h40M7 34h34M24 4v40"/></>,
    flight: <path d="m3 27 14-4L9 8l5 2 13 12 11-2 7 2-10 4-7 1-9 15-4 1 4-16-11 4Z"/>
  };
  return <svg viewBox="0 0 48 48" width="44" height="44" fill={type==='flight'?'currentColor':'none'} stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[type]}</svg>;
}
