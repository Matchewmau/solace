// Recipe source of truth, extracted faithfully from SOLACE-Brew Instructions.pdf
// (2025). One entry per menu item in menu-data.mjs (21 total: 20 active +
// inactive Dark Mocha). Quantities/units are verbatim from the PDF ingredient
// columns; `steps` follows the PDF's right-hand assembly order ending in Mix.
// Abbreviations are the PDF's own (S.C = salted caramel, H.N = hazelnut,
// F.V = French vanilla, B. = butterscotch, Mat. = matcha, S./B.B/M./BB/G.A =
// strawberry/blueberry/mango/mixed-berry/green-apple, btl = bottle).
// Ice appears in every drink's assembly order with no measured qty, so its
// line carries qty/unit null. Notes:
// - Milky Blueberry / Milky Mango: the PDF steps column repeats the strawberry
//   names (obvious copy slip); steps here use the drink's own ingredient-column
//   names, which are unambiguous.
// - Green Apple Soda: the PDF shows no "Mix" line; steps end at Sprite.
// - Cookies & Cream: PDF header reads "Cookies n Cream"; "Oreo (Crushed 2p)"
//   is verbatim from the PDF steps column.
// - French Vanilla / Salted Caramel syrups note "(2 pumps)" verbatim.
export const RECIPES = [
  {
    menu_item: "Spanish Latte",
    steps:
      "1. Condensed Milk\n2. Milk\n3. Ice\n4. Coffee\n5. Mix",
    lines: [
      { ingredient: "Condensed Milk", qty: 40, unit: "ml" },
      { ingredient: "Milk", qty: 70, unit: "ml" },
      { ingredient: "Coffee", qty: 120, unit: "ml" },
      { ingredient: "Ice", qty: null, unit: null },
    ],
  },
  {
    menu_item: "Salted Caramel",
    steps:
      "1. S.C syrup (2 pumps)\n2. Milk\n3. Ice\n4. Coffee\n5. S.C drizzle\n6. Mix",
    lines: [
      { ingredient: "S.C syrup", qty: 25, unit: "ml" },
      { ingredient: "Milk", qty: 70, unit: "ml" },
      { ingredient: "Coffee", qty: 110, unit: "ml" },
      { ingredient: "S.C drizzle", qty: 10, unit: "ml" },
      { ingredient: "Ice", qty: null, unit: null },
    ],
  },
  {
    menu_item: "Hazelnut Latte",
    steps: "1. H.N syrup\n2. Milk\n3. Ice\n4. Coffee\n5. Mix",
    lines: [
      { ingredient: "H.N syrup", qty: 30, unit: "ml" },
      { ingredient: "Milk", qty: 70, unit: "ml" },
      { ingredient: "Coffee", qty: 110, unit: "ml" },
      { ingredient: "Ice", qty: null, unit: null },
    ],
  },
  {
    menu_item: "French Vanilla Latte",
    steps:
      "1. F.V syrup (2 pumps)\n2. Milk\n3. Ice\n4. Coffee\n5. Mix",
    lines: [
      { ingredient: "F.V syrup", qty: 30, unit: "ml" },
      { ingredient: "Milk", qty: 70, unit: "ml" },
      { ingredient: "Coffee", qty: 110, unit: "ml" },
      { ingredient: "Ice", qty: null, unit: null },
    ],
  },
  {
    menu_item: "Caramel Macchiato",
    steps:
      "1. F. Vanilla syrup\n2. Milk\n3. Ice\n4. Coffee\n5. Caramel drizzle\n6. Mix",
    lines: [
      { ingredient: "F. Vanilla syrup", qty: 25, unit: "ml" },
      { ingredient: "Milk", qty: 70, unit: "ml" },
      { ingredient: "Coffee", qty: 110, unit: "ml" },
      { ingredient: "Caramel drizzle", qty: 10, unit: "ml" },
      { ingredient: "Ice", qty: null, unit: null },
    ],
  },
  {
    menu_item: "Dark Mocha",
    steps:
      "1. Condensed Milk\n2. Coffee\n3. Milk\n4. D. Mocha base\n5. Ice\n6. Choco drizzle\n7. Mix (frother)",
    lines: [
      { ingredient: "Condensed Milk", qty: 5, unit: "ml" },
      { ingredient: "Coffee", qty: 110, unit: "ml" },
      { ingredient: "Milk", qty: 70, unit: "ml" },
      { ingredient: "D. Mocha base", qty: 15, unit: "ml" },
      { ingredient: "Choco drizzle", qty: 10, unit: "ml" },
      { ingredient: "Ice", qty: null, unit: null },
    ],
  },
  {
    menu_item: "Milosaurus",
    steps:
      "1. Milo\n2. Condensed Milk\n3. Milk\n4. Ice\n5. Choco drizzle\n6. Mix (frother)",
    lines: [
      { ingredient: "Milo", qty: 2, unit: "scoop" },
      { ingredient: "Condensed Milk", qty: 20, unit: "ml" },
      { ingredient: "Milk", qty: 150, unit: "ml" },
      { ingredient: "Choco drizzle", qty: 10, unit: "ml" },
      { ingredient: "Ice", qty: null, unit: null },
    ],
  },
  {
    menu_item: "Spanish Caramel Latte",
    steps:
      "1. Condensed Milk\n2. Milk\n3. Ice\n4. Coffee\n5. Caramel drizzle\n6. Mix",
    lines: [
      { ingredient: "Condensed Milk", qty: 25, unit: "ml" },
      { ingredient: "Milk", qty: 70, unit: "ml" },
      { ingredient: "Coffee", qty: 120, unit: "ml" },
      { ingredient: "Caramel drizzle", qty: 15, unit: "ml" },
      { ingredient: "Ice", qty: null, unit: null },
    ],
  },
  {
    menu_item: "Butterscotch Latte",
    steps:
      "1. B. scotch syrup\n2. Milk\n3. Ice\n4. Coffee\n5. Caramel drizzle\n6. Mix",
    lines: [
      { ingredient: "B. scotch syrup", qty: 25, unit: "ml" },
      { ingredient: "Milk", qty: 70, unit: "ml" },
      { ingredient: "Coffee", qty: 110, unit: "ml" },
      { ingredient: "Caramel drizzle", qty: 10, unit: "ml" },
      { ingredient: "Ice", qty: null, unit: null },
    ],
  },
  {
    menu_item: "Matcha Latte",
    steps:
      "1. Condensed Milk\n2. Milk\n3. Ice\n4. Matcha (Mat. powder in 100 ml hot water)\n5. Mix",
    lines: [
      { ingredient: "Condensed Milk", qty: 30, unit: "ml" },
      { ingredient: "Milk", qty: 70, unit: "ml" },
      { ingredient: "Mat. powder", qty: 15, unit: "g" },
      { ingredient: "Hot water", qty: 100, unit: "ml" },
      { ingredient: "Ice", qty: null, unit: null },
    ],
  },
  {
    menu_item: "Matcha Berry",
    steps:
      "1. S. syrup\n2. S. jam\n3. Condensed Milk\n4. Milk\n5. Ice\n6. Matcha (Mat. powder in 100 ml hot water)\n7. Mix",
    lines: [
      { ingredient: "Condensed Milk", qty: 15, unit: "ml" },
      { ingredient: "Milk", qty: 70, unit: "ml" },
      { ingredient: "S. syrup", qty: 20, unit: "ml" },
      { ingredient: "S. jam", qty: 20, unit: "ml" },
      { ingredient: "Mat. powder", qty: 10, unit: "g" },
      { ingredient: "Hot water", qty: 100, unit: "ml" },
      { ingredient: "Ice", qty: null, unit: null },
    ],
  },
  {
    menu_item: "Cookies & Cream",
    steps:
      "1. Oreo, crushed (2p)\n2. Condensed Milk\n3. Milk\n4. Ice\n5. Mix",
    lines: [
      { ingredient: "Oreo", qty: 1, unit: "Pack" },
      { ingredient: "Milk", qty: 150, unit: "ml" },
      { ingredient: "Condensed Milk", qty: 30, unit: "ml" },
      { ingredient: "Ice", qty: null, unit: null },
    ],
  },
  {
    menu_item: "Milky Strawberry",
    steps:
      "1. S. syrup\n2. S. jam\n3. Condensed Milk\n4. Milk\n5. Ice\n6. Mix",
    lines: [
      { ingredient: "S. syrup", qty: 30, unit: "ml" },
      { ingredient: "S. jam", qty: 25, unit: "ml" },
      { ingredient: "Condensed Milk", qty: 20, unit: "ml" },
      { ingredient: "Milk", qty: 180, unit: "ml" },
      { ingredient: "Ice", qty: null, unit: null },
    ],
  },
  {
    menu_item: "Milky Blueberry",
    steps:
      "1. B.B syrup\n2. B.B jam\n3. Condensed Milk\n4. Milk\n5. Ice\n6. Mix",
    lines: [
      { ingredient: "B.B syrup", qty: 30, unit: "ml" },
      { ingredient: "B.B jam", qty: 25, unit: "ml" },
      { ingredient: "Condensed Milk", qty: 20, unit: "ml" },
      { ingredient: "Milk", qty: 180, unit: "ml" },
      { ingredient: "Ice", qty: null, unit: null },
    ],
  },
  {
    menu_item: "Milky Mango",
    steps:
      "1. M. syrup\n2. M. jam\n3. Condensed Milk\n4. Milk\n5. Ice\n6. Mix",
    lines: [
      { ingredient: "M. syrup", qty: 30, unit: "ml" },
      { ingredient: "M. jam", qty: 25, unit: "ml" },
      { ingredient: "Condensed Milk", qty: 20, unit: "ml" },
      { ingredient: "Milk", qty: 180, unit: "ml" },
      { ingredient: "Ice", qty: null, unit: null },
    ],
  },
  {
    menu_item: "Milky Mixed Berries",
    steps:
      "1. S. syrup\n2. BB syrup\n3. S. jam\n4. BB jam\n5. Condensed Milk\n6. Milk\n7. Ice\n8. Mix",
    lines: [
      { ingredient: "S. syrup", qty: 15, unit: "ml" },
      { ingredient: "BB syrup", qty: 15, unit: "ml" },
      { ingredient: "S. jam", qty: 10, unit: "ml" },
      { ingredient: "BB jam", qty: 10, unit: "ml" },
      { ingredient: "Condensed Milk", qty: 20, unit: "ml" },
      { ingredient: "Milk", qty: 180, unit: "ml" },
      { ingredient: "Ice", qty: null, unit: null },
    ],
  },
  {
    menu_item: "Strawberry Soda",
    steps: "1. S. syrup\n2. S. jam\n3. Sinkers\n4. Ice\n5. Sprite\n6. Mix",
    lines: [
      { ingredient: "S. syrup", qty: 30, unit: "ml" },
      { ingredient: "S. jam", qty: 15, unit: "ml" },
      { ingredient: "Sinkers", qty: 5, unit: "ml" },
      { ingredient: "Sprite", qty: 1, unit: "btl" },
      { ingredient: "Ice", qty: null, unit: null },
    ],
  },
  {
    menu_item: "Blueberry Soda",
    steps: "1. BB syrup\n2. BB jam\n3. Sinkers\n4. Ice\n5. Sprite\n6. Mix",
    lines: [
      { ingredient: "BB syrup", qty: 30, unit: "ml" },
      { ingredient: "BB jam", qty: 15, unit: "ml" },
      { ingredient: "Sinkers", qty: 5, unit: "ml" },
      { ingredient: "Sprite", qty: 1, unit: "btl" },
      { ingredient: "Ice", qty: null, unit: null },
    ],
  },
  {
    menu_item: "Green Apple Soda",
    steps: "1. G.A syrup\n2. Sinkers\n3. Ice\n4. Sprite",
    lines: [
      { ingredient: "G.A syrup", qty: 35, unit: "ml" },
      { ingredient: "Sinkers", qty: 10, unit: "ml" },
      { ingredient: "Sprite", qty: 1, unit: "btl" },
      { ingredient: "Ice", qty: null, unit: null },
    ],
  },
  {
    menu_item: "Mango Soda",
    steps: "1. M. syrup\n2. M. jam\n3. Sinkers\n4. Ice\n5. Sprite\n6. Mix",
    lines: [
      { ingredient: "M. syrup", qty: 30, unit: "ml" },
      { ingredient: "M. jam", qty: 15, unit: "ml" },
      { ingredient: "Sinkers", qty: 5, unit: "ml" },
      { ingredient: "Sprite", qty: 1, unit: "btl" },
      { ingredient: "Ice", qty: null, unit: null },
    ],
  },
  {
    menu_item: "Mixed Berries Soda",
    steps:
      "1. S. syrup\n2. BB. syrup\n3. S. jam\n4. BB jam\n5. Sinkers\n6. Ice\n7. Sprite\n8. Mix",
    lines: [
      { ingredient: "S. syrup", qty: 15, unit: "ml" },
      { ingredient: "BB. syrup", qty: 10, unit: "ml" },
      { ingredient: "S. jam", qty: 5, unit: "ml" },
      { ingredient: "BB jam", qty: 5, unit: "ml" },
      { ingredient: "Sinkers", qty: 5, unit: "ml" },
      { ingredient: "Sprite", qty: 1, unit: "btl" },
      { ingredient: "Ice", qty: null, unit: null },
    ],
  },
];
