// Menu source of truth (binding for seed + tests).
// Prices in INTEGER cents, PHP. All drinks 16 oz (display fact, not a column).
// Soda is 50 PHP (owner correction; the PDF shows 60).
// Dark Mocha is kept as an INACTIVE Coffee item (recipe lands in Task 9).
// cost_cents unknown — left 0, never invented.
export const MENU = [
  {
    category: "Coffee",
    items: [
      { name: "Spanish Latte", price_cents: 7000 },
      { name: "Spanish Caramel Latte", price_cents: 7000 },
      { name: "French Vanilla Latte", price_cents: 7000 },
      { name: "Hazelnut Latte", price_cents: 7000 },
      { name: "Salted Caramel", price_cents: 7000 },
      { name: "Caramel Macchiato", price_cents: 7000 },
      { name: "Butterscotch Latte", price_cents: 7000 },
      { name: "Dark Mocha", price_cents: 7000, active: 0 },
    ],
  },
  {
    category: "Matcha",
    items: [
      { name: "Matcha Latte", price_cents: 7000 },
      { name: "Matcha Berry", price_cents: 7000 },
    ],
  },
  {
    category: "Milk",
    items: [
      { name: "Milky Mixed Berries", price_cents: 8000 },
      { name: "Milky Strawberry", price_cents: 8000 },
      { name: "Milky Blueberry", price_cents: 8000 },
      { name: "Milky Mango", price_cents: 8000 },
      { name: "Cookies & Cream", price_cents: 8000 },
      { name: "Milosaurus", price_cents: 8000 },
    ],
  },
  {
    category: "Soda",
    items: [
      { name: "Strawberry Soda", price_cents: 5000 },
      { name: "Blueberry Soda", price_cents: 5000 },
      { name: "Mango Soda", price_cents: 5000 },
      { name: "Green Apple Soda", price_cents: 5000 },
      { name: "Mixed Berries Soda", price_cents: 5000 },
    ],
  },
];
