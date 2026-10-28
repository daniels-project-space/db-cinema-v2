/** Public, read-only enquiry evidence. A quote never creates a reservation. */
export type GafferEmailQuote = {
  start: string;
  end: string;
  pickupTime?: string;
  returnTime?: string;
  days: number;
  estimated: boolean;
  timed: boolean;
  stockVerified: boolean;
  requirementsComplete: boolean;
  complete: boolean;
  total: number | null;
  requests: {
    subject: string;
    quantity: number;
    quantityUnit?: string;
    fulfilled: number | null;
    lines: {
      listingId: string;
      title: string;
      slug: string;
      quantity: number;
      perDay: number;
      total: number;
      alternative: boolean;
    }[];
  }[];
};
