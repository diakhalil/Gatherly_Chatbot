import { Router } from "express";
import db from "../config/db.js";

const router = Router();

// Get all available clothing items (public)
router.get("/", async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT c.clothesId, c.clothingLabel, c.picture, c.description,
             GROUP_CONCAT(CONCAT(cs.size, ':', cs.stockQty) SEPARATOR ', ') AS stockInfo
        FROM CLOTHING c
        LEFT JOIN CLOTHING_STOCK cs ON c.clothesId = cs.clothingId
       GROUP BY c.clothesId
       ORDER BY c.clothingLabel
    `);
    res.json(rows);
  } catch (err) {
    console.error("Failed to fetch clothing", err);
    res.status(500).json({ message: "Failed to fetch clothing" });
  }
});

export default router;
