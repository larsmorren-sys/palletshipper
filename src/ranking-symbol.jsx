import React from 'react';

export function RankingSymbol({ rank }) {
  if (![1, 2, 3].includes(rank)) return <>☆</>;
  return <svg className="ranking-vehicle" viewBox="0 0 64 64" aria-hidden="true" focusable="false" fill="none" stroke="#254d3d" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    {rank === 1 && <>
      <path d="M9 43V30h20v13h9V16H17v14M17 16V9h22" fill="#e7b63f"/>
      <path d="M22 17v12h12V17" fill="#d7eaf0"/>
      <path d="M44 10v37h13M49 10v31h10M38 33h6"/>
      <circle cx="17" cy="47" r="7" fill="#41574c"/><circle cx="35" cy="47" r="6" fill="#41574c"/>
      <circle cx="17" cy="47" r="2" fill="#fff" stroke="none"/><circle cx="35" cy="47" r="2" fill="#fff" stroke="none"/>
    </>}
    {rank === 2 && <>
      <path d="M20 42 14 15h-4M14 15h10v7H15"/>
      <path d="M19 39h10l9 7h20v5H34l-8-6h-7" fill="#e7b63f"/>
      <path d="m29 39 11 2h18v4"/>
      <circle cx="22" cy="49" r="6" fill="#41574c"/><circle cx="53" cy="50" r="3" fill="#41574c"/>
      <circle cx="22" cy="49" r="2" fill="#fff" stroke="none"/>
    </>}
    {rank === 3 && <>
      <path d="m9 23 6 15h24l11-15Z" fill="#85ae80"/>
      <path d="m45 25 10-8h5M24 39l-6 12h-7M32 39l11 9"/>
      <circle cx="46" cy="48" r="8" fill="#41574c"/><circle cx="46" cy="48" r="3" fill="#fff" stroke="none"/>
    </>}
  </svg>;
}
