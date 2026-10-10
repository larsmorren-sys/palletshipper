import React from 'react';

const badges = {
  1: '/badges/warehouse-league-1.webp',
  2: '/badges/warehouse-league-2.webp',
  3: '/badges/warehouse-league-3.webp',
};

export function RankingSymbol({ rank }) {
  if (!badges[rank]) return <>☆</>;
  return <img className="ranking-badge" src={badges[rank]} alt="" aria-hidden="true" width="96" height="96" decoding="async"/>;
}
