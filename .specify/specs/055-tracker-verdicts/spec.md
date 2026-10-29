# Spec 055: Tracker alerts follow the vehicle, not a timetable

## Why
The Nagios checks for the CVSR train and Harbor Hopper trackers hit `/api/health/trackers`, which always answers 200, so they never caught a dead tracker. They were also limited to hand-kept operating-hour timeperiods, which go wrong whenever the timetable changes: winter CVSR hours, the water taxi closing for the season, charters. Asking the feeds whether the vehicle is in service removes the timetable entirely.

## Behavior
- Each tracker exposes a verdict, `{ok, state, reason?}`. `GET /api/health/trackers/train` and `/api/health/trackers/water-taxi` return 200 when `ok` and 503 otherwise. Nagios checks them around the clock with no timeperiod. `/api/health/trackers` stays always-200 and carries both verdicts for people.
- Train states, in order:
  - `disabled` (ok): turned off in admin, or no USFT token
  - `starting` (ok): no poll has succeeded yet, within 5 min of start
  - `unreachable` (alert): no successful USFT poll in 5 min
  - `no_vehicle` (ok): USFT lists no device. An empty list now counts as a successful poll.
  - `parked` (ok): ignition off, however old the fix. This covers nights and the off-season.
  - `silent` (alert): ignition on but the device's own fix is more than 15 min old
  - `in_service` (ok)
- Water taxi: `route-code-details` is polled every 2 min instead of only at startup. Its on-duty list is the schedule.
  - `disabled` (ok): turned off in admin, or `DISABLE_LIVE_BOAT_TRACKER`
  - `starting` (ok): no poll has succeeded yet, within 10 min of start
  - `unreachable` (alert): no successful duty poll in 10 min
  - `off_duty` (ok): nothing is on duty. This covers nights and the off-season.
  - `wrong_serial` (alert): a shuttle is on duty but not `TMS_SERIAL`
  - `silent` (alert): on duty with no socket event for 15 min, timed from the later of the last event or coming on duty
  - `in_service` (ok)
- The duty poll seeds the map position only when the socket has been quiet for a full poll interval, so a live socket fix is never overwritten by a snapshot. It logs a duty state once, when it changes.
- A DB error reading the boat's admin setting no longer stops the tracker; it starts, as the train already does.

## Tests
- Unit: `trainTracker.unit.test.js` and `waterTaxiTracker.unit.test.js` cover every state. Time is faked and socket.io is mocked.
- Image boot test: both endpoints return 200 with no network.

## Out of scope
- Map behavior (`/api/train/position`, `/api/water-taxi/position`) is unchanged.
- If the GPS unit dies while the vehicle is off duty, it looks the same as off duty. Riders see the same thing either way.
