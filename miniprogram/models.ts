export type MemberRole = 'a' | 'b';

export interface HouseholdMember {
  role: MemberRole;
  name: string;
  isMe: boolean;
}

export interface Household {
  id: string;
  city: string;
  currency: string;
  /** 只有 1 人时有值；满 2 人后为空字符串。 */
  inviteCode: string;
  myRole: MemberRole;
  members: HouseholdMember[];
}

export interface ArchiveRsvp {
  guestName: string;
  attending: boolean;
  partySize: number;
  note: string;
  updatedAt: string;
}

export interface ArchiveMessage {
  signature: string;
  message: string;
  updatedAt: string;
}

export interface Archive {
  rsvps: ArchiveRsvp[];
  messages: ArchiveMessage[];
  summary: {
    responses: number;
    attending: number;
    declined: number;
    guests: number;
  };
}
