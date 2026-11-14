// Shapes from docs/contracts.md (Adam owns listing/API/SSE, Kevin owns Score).
// Read-only on our side: if something here needs to change, change the contract first.

export type Kind = 'sale' | 'rent';
export type Portal = 'etuovi' | 'vuokraovi' | 'mock';
export type Confidence = 'low' | 'medium' | 'high';

export interface Comp {
  id: string;
  url: string;
  address: string;
  m2: number;
  rooms: number;
  year: number | null;
  price_m2: number;
  distance_m: number;
}

export interface Score {
  fair_m2: number;
  fair_price: number;
  /** (asking − fair) / fair. Negative = cheaper than fair = good deal. */
  deal_pct: number;
  confidence: Confidence;
  model: { fair_m2: number; version: string; mae_pct: number } | null;
  comps: { fair_m2: number; n: number; radius_m: number; items: Comp[] } | null;
  baseline: { source: string; postcode: string; room_type: string; year: number; eur_m2: number } | null;
  yield_pct: number | null;
  scored_at: string;
}

export type FlagType =
  | 'renovation_upcoming' | 'pipe_renovation' | 'facade_balcony' | 'company_loan' | 'leased_plot'
  | 'high_fee' | 'street_works' | 'news' | 'landlord' | 'commute'
  /** Cloudinary AI Vision read the listing photos (lib/media). */
  | 'photo_condition';
export type Severity = 'info' | 'warn' | 'high';

export interface Flag {
  id: string;
  type: FlagType;
  severity: Severity;
  label: string;
  detail: string | null;
  est_cost_eur: number | null;
  year: number | null;
  source: { kind: 'listing' | 'pdf' | 'news' | 'open_data' | 'photo'; url: string | null; quote: string | null; page: number | null } | null;
  /** 'gemini' = the Gemini analyst found it; 'photos' = Cloudinary AI Vision found it in a listing photo. */
  origin?: 'gemini' | 'photos';
  /** photo_condition flags: index into `media.photos` of the photo that shows it. */
  photo?: number;
  /** Finnish label and detail (Gemini flags only). */
  label_fi?: string;
  detail_fi?: string | null;
  status: 'ok' | 'pending' | 'error';
}

/** Gemini analyst, docs/contracts.md §3b. Arrives a few seconds after the listing is `ready`. */
export type Insight =
  | { status: 'pending'; at?: string; run?: string }
  | { status: 'error'; error: string; at: string }
  | {
      status: 'ok';
      headline: string;
      summary: string;
      questions: string[];
      /** The same texts in Finnish, written by Gemini. */
      fi?: { headline: string | null; summary: string | null; questions: string[] };
      hidden_cost_eur: number | null;
      real_cost_eur: number | null;
      grounding: { checked: number; kept: number; skipped?: number; dropped: number };
      sources: number;
      model: string;
      tokens: number | null;
      ms: number;
      at: string;
    };

/** Room type from AI Vision; picks the "after renovation" preview prompt. */
export type PhotoRoom = 'kitchen' | 'bathroom' | 'exterior' | 'plan' | 'room';

export interface MediaPhoto {
  /** Cloudinary public id in the `cloud` below. */
  public_id: string;
  width: number;
  height: number;
  source_url: string;
  /** AI Vision tags, e.g. ['kitchen', 'dated_kitchen']. Empty when not analysed. */
  tags: string[];
  room: PhotoRoom;
}

/** lib/media: listing photos in Cloudinary. Arrives a few seconds after the listing is `ready`. */
export interface Media {
  status: 'pending' | 'ok' | 'error';
  cloud: string;
  photos: MediaPhoto[];
  analysed?: boolean;
  error?: string | null;
  ms?: number;
  at: string;
}

export interface PricePoint {
  at: string;
  price?: number | null;
  debt_free_price?: number | null;
  rent?: number | null;
}

export interface Listing {
  _id: string;
  portal: Portal;
  kind: Kind;
  url: string;
  address: string | null;
  postcode: string | null;
  district: string | null;
  loc: { type: 'Point'; coordinates: [number, number] } | null; // [lng, lat]
  building_type?: string | null;
  rooms: number | null;
  rooms_description?: string | null;
  m2: number | null;
  year: number | null;
  floor?: number | null;
  floors_total?: number | null;
  elevator?: boolean | null;
  sauna?: boolean | null;
  balcony?: boolean | null;
  condition?: string | null;
  plot?: 'own' | 'leased' | null;
  energy_class?: string | null;
  // sale
  price?: number | null;
  debt_free_price?: number | null;
  debt_share?: number | null;
  fee_month?: number | null;
  fee_m2?: number | null;
  housing_company?: string | null;
  // rent
  rent?: number | null;
  available_from?: string | null;
  agent_company?: string | null;
  renovations_done?: string | null;
  renovations_upcoming?: string | null;
  attachments?: { title: string; url: string }[];
  /** Gallery photo URLs from the listing page. */
  photos?: string[] | null;
  media?: Media | null;
  first_seen_at: string;
  last_seen_at?: string;
  price_history?: PricePoint[];
  score: Score | null;
  flags: Flag[];
  insight?: Insight | null;
  status: 'new' | 'enriching' | 'ready';
}

export interface CallStart {
  id: string;
  listing_id: string;
  endpoint: string;
  label: string;
  queued_at: string;
  started_at: string;
}
export interface CallEnd {
  id: string;
  listing_id: string;
  endpoint: string;
  label: string;
  started_at: string;
  ms: number;
  status: 'ok' | 'error';
  request_id: string | null;
  http_status?: number | null;
  error?: string;
}

export interface ListingDetail extends Listing {
  calls: CallEnd[];
}

export interface SavedSearch {
  kind: Kind;
  max_price: number | null;
  min_rooms: number | null;
  postcodes: string[];
  /** e.g. -0.10 = alert when at least 10% below fair */
  min_deal: number | null;
}

export interface Health {
  ok: boolean;
  public_url?: string | null;
  last_webhook_at: string | null;
  listings?: Partial<Record<Kind, number>>;
  sse_clients?: number;
}

/** SSE events, docs/contracts.md §5 */
export type StreamEvent =
  | { type: 'hello'; data: { server_time: string } }
  | { type: 'listing.new'; data: { listing: Listing } }
  | { type: 'listing.updated'; data: { id: string; patch: Partial<Listing> } }
  | { type: 'listing.price_drop'; data: { id: string; old_price: number; new_price: number; at: string } }
  | { type: 'call.start'; data: CallStart }
  | { type: 'call.end'; data: CallEnd }
  | { type: 'alert.sent'; data: { listing_id: string; to: string; at: string; status?: string } };

export type StreamEventType = StreamEvent['type'];
export const STREAM_EVENT_TYPES: StreamEventType[] = [
  'hello', 'listing.new', 'listing.updated', 'listing.price_drop', 'call.start', 'call.end', 'alert.sent',
];
