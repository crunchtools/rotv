import React from 'react';
import { useActiveLists } from '../../hooks/useActiveLists';
import ListCheckinControl from './ListCheckinControl';

/**
 * The place card's check-in button (spec 050): shown when the place is a hike
 * on a curated list that is in season.
 *
 * @param {object} props
 * @param {object} props.poi The selected place; one picked from a list's row carries that row's item
 */
export default function ListCheckinAction({ poi }) {
  const lists = useActiveLists();
  for (const list of lists) {
    const item = list.items.find(i => i.id === poi._listItem?.id)
      || list.items.find(i => i.poi_id === poi.id);
    if (item) return <ListCheckinControl list={list} item={item} />;
  }
  return null;
}
