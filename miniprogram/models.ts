export interface Photo {
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
