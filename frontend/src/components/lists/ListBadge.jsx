import React from 'react';

/**
 * The badge for one edition of a curated list (spec 050): a shield with the
 * year, in colour once it is earned.
 *
 * @param {object} props
 * @param {number|string} props.edition The year on the shield
 * @param {boolean} props.earned
 * @param {number} [props.size=56]
 * @param {string} props.title Read out in place of the picture
 */
export default function ListBadge({ edition, earned, size = 56, title }) {
  return (
    <svg
      className={`list-badge ${earned ? 'earned' : ''}`}
      viewBox="0 0 48 56"
      width={size}
      height={(size * 56) / 48}
      role="img"
      aria-label={title}
    >
      <path className="list-badge-shield" d="M24 2 44 8v20c0 12-8.5 20.500-20 26C12.500 48.500 4 40 4 28V8z" />
      <path className="list-badge-leaf" d="M24 13c-5 3.500-7 7.500-7 11.500 0 3 1.800 5.300 4.600 6.300L21 35h6l-.6-4.200c2.800-1 4.600-3.300 4.600-6.300 0-4-2-8-7-11.500z" />
      <text className="list-badge-year" x="24" y="46" textAnchor="middle">{edition}</text>
    </svg>
  );
}
