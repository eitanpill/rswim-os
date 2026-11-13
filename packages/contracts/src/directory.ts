/** Finding a school (store launch, stage 4): the app's school search and the join requests a school receives. */

/** Join the school as a family, or ask for a trial lesson first. */
export const JOIN_REQUEST_KINDS = ['join', 'trial'] as const;
export type JoinRequestKind = (typeof JOIN_REQUEST_KINDS)[number];

/** new → accepted (the family is created) | declined; the person may withdraw a new one. */
export const JOIN_REQUEST_STATUSES = ['new', 'accepted', 'declined', 'withdrawn'] as const;
export type JoinRequestStatus = (typeof JOIN_REQUEST_STATUSES)[number];

/** How many children one request may name (a bigger family talks to the office). */
export const JOIN_REQUEST_MAX_CHILDREN = 4;
