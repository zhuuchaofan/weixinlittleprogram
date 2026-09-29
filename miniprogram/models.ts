export interface Photo {
  type?: 'image' | 'video';
  placements?: Array<'cover' | 'story' | 'qiuqiu' | 'buding'>;
  category?: 'pending' | 'wedding' | 'daily' | 'baoji_0927' | 'lintong_0928';
  visibility?: 'public' | 'private';
  url?: string;
  coverUrl?: string;
  duration?: number;
  width?: number;
  height?: number;
  size?: number;
  id: string;
  thumbnail: string;
  original: string;
  caption: string;
  placeholder: boolean;
  ratio: 'portrait' | 'landscape' | 'square';
}
export interface StoryItem {
  id: string;
  date: string;
  title: string;
  description: string;
  photos: Photo[];
}
export interface Album {
  id: string;
  title: string;
  description: string;
  photos: Photo[];
}
export interface RsvpInput {
  guestName: string;
  attending: boolean;
  partySize: number;
  note: string;
  consent: boolean;
}
export interface RsvpRecord extends RsvpInput {
  id: string;
  updatedAt: string;
}
export interface Dashboard {
  records: RsvpRecord[];
  summary: {
    responses: number;
    attending: number;
    guests: number;
    declined: number;
  };
  nextCursor: string;
}
export interface RsvpService {
  getMine(): Promise<RsvpRecord | null>;
  save(input: RsvpInput): Promise<RsvpRecord>;
  removeMine(): Promise<void>;
  dashboard(cursor?: string): Promise<Dashboard>;
}
export interface GuestMessageInput {
  signature: string;
  message: string;
  consent: boolean;
}
export interface GuestMessageRecord extends GuestMessageInput {
  id: string;
  updatedAt: string;
}
export interface GuestMessageDashboard {
  records: GuestMessageRecord[];
  summary: { messages: number };
  nextCursor: string;
}
export interface GuestMessageService {
  getMine(): Promise<GuestMessageRecord | null>;
  save(input: GuestMessageInput): Promise<GuestMessageRecord>;
  removeMine(): Promise<void>;
  dashboard(cursor?: string): Promise<GuestMessageDashboard>;
}

export interface EventProgramItem {
  id: string;
  title: string;
  time: string;
  description: string;
  visible: boolean;
}

export interface PhotoBoothNotice {
  enabled: boolean;
  title: string;
  time: string;
  description: string;
}

export interface EventProgram {
  title: string;
  lead: string;
  items: EventProgramItem[];
  photoBooth: PhotoBoothNotice;
}
