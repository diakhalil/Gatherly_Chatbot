import db from "../config/db.js";

export const buildTransportationSummary = async (eventId, nbOfHosts = 0) => {
  if (!eventId) {
    return {
      available: false,
      trips: [],
      worstCaseSeats: Number(nbOfHosts) || 0,
      actualNeededSeats: 0,
      downgradeSuggested: false,
    };
  }

  const [tripRows] = await db.query(
    `SELECT transportationId,
            pickupLocation,
            departureTime,
            returnTime,
            payment
       FROM TRANSPORTATION
      WHERE eventId = ?
   ORDER BY departureTime`,
    [eventId]
  );

  const [needsRows] = await db.query(
    `SELECT COUNT(*) AS count
       FROM EVENT_APP
      WHERE eventId = ?
        AND status = 'accepted'
        AND needsRide = 1`,
    [eventId]
  );

  const worstCaseSeats = Number(nbOfHosts) || 0;
  const actualNeededSeats = Number(needsRows[0]?.count || 0);
  const downgradeSuggested =
    worstCaseSeats > 0 && actualNeededSeats <= Math.round(worstCaseSeats * 0.6);

  return {
    available: tripRows.length > 0,
    trips: tripRows,
    worstCaseSeats,
    actualNeededSeats,
    downgradeSuggested,
  };
};
