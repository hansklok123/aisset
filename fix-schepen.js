const fs = require("fs");
const path = require("path");

const DATA_PATH = path.join(__dirname, "public", "data", "schepen.json");

// Mapping MOET hierboven!
const SHIP_TYPE_NAMES = {
  0: "Onbekend",
  20: "Wisselverkeer",
  21: "Wisselverkeer",
  22: "Wisselverkeer",
  23: "Wisselverkeer",
  24: "Wisselverkeer",
  25: "Wisselverkeer",
  26: "Wisselverkeer",
  27: "Wisselverkeer",
  28: "Wisselverkeer",
  29: "Wisselverkeer",
  30: "Vissersvaartuig",
  31: "Sleepboot",
  32: "Sleepduwcombinatie",
  33: "Bagger",
  34: "Duik-support",
  35: "Marine",
  36: "Zeiljacht",
  37: "Pleziervaartuig",
  40: "HSC",
  50: "Pilotvaartuig",
  51: "SAR",
  52: "Sleepboot",
  53: "Haven-autoriteit",
  54: "Anti-pollution",
  55: "Patrouillevaartuig",
  56: "Spare",
  57: "Spare",
  58: "Medisch Transport",
  59: "Marine",
  60: "Passagiersschip",
  61: "Passagiersschip",
  62: "Passagiersschip",
  63: "Passagiersschip",
  64: "Passagiersschip",
  65: "Passagiersschip",
  66: "Passagiersschip",
  67: "Passagiersschip",
  68: "Passagiersschip",
  69: "Passagiersschip",
  70: "Cargo schip",
  71: "Cargo schip - Hazard X",
  72: "Cargo schip - Hazard Y",
  73: "Cargo schip - Hazard Z",
  74: "Cargo schip - Hazard OS",
  75: "Cargo schip",
  76: "Cargo schip",
  77: "Cargo schip",
  78: "Cargo schip",
  79: "Cargo schip",
  80: "Tanker",
  81: "Tanker - Hazard A",
  82: "Tanker - Hazard B",
  83: "Tanker - Hazard C",
  84: "Tanker - LNG - Hazard D",
  85: "Tanker",
  86: "Tanker",
  87: "Tanker",
  88: "Tanker",
  89: "Tanker",
  90: "Overig",
  91: "Overig",
  92: "Overig",
  93: "Overig",
  94: "Overig",
  95: "Overig",
  96: "Overig",
  97: "Overig",
  98: "Overig",
  99: "NA"
  // ...je mapping...
};

// Eerst checken of het bestand bestaat
if (!fs.existsSync(DATA_PATH)) {
  console.error("schepen.json niet gevonden!");
  process.exit(1);
}

// Eerst inladen!
const schepen = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));

// Nu kun je debuggen:
console.log('Mapping 52:', SHIP_TYPE_NAMES[52]);
console.log('Schip:', schepen['205188000']);
console.log('TypeNum:', Number(schepen['205188000'].type));
console.log('TypeNaam:', SHIP_TYPE_NAMES[Number(schepen['205188000'].type)]);

for (const mmsi in schepen) {
  const schip = schepen[mmsi];
  const typeRaw = schip.type;
  const typeNum = Number(typeRaw);
  const nieuweNaam = SHIP_TYPE_NAMES[typeNum] || "Onbekend";
  if (nieuweNaam === "Onbekend") {
    console.log(
      "DEBUG:",
      "MMSI:", mmsi,
      "naam:", schip.naam,
      "typeRaw:", JSON.stringify(typeRaw),
      "typeNum:", typeNum,
      "mapping?:", SHIP_TYPE_NAMES[typeNum]
    );
  }
}

// Daarna pas bijwerken
let gewijzigd = 0;
for (const mmsi in schepen) {
  const schip = schepen[mmsi];
  const typeNum = Number(schip.type);
  const nieuweNaam = SHIP_TYPE_NAMES[typeNum] || "Onbekend";
  if (schip.type_naam !== nieuweNaam) {
    schip.type_naam = nieuweNaam;
    gewijzigd++;
  }
}

let onbekend = 0;
for (const mmsi in schepen) {
  if (schepen[mmsi].type_naam === "Onbekend") {
    onbekend++;
    console.log(mmsi, schepen[mmsi].naam, schepen[mmsi].type);
  }
}
console.log(`Nog ${onbekend} records met type_naam Onbekend.`);

fs.writeFileSync(DATA_PATH, JSON.stringify(schepen, null, 2));
console.log(`✅ ${gewijzigd} records bijgewerkt in schepen.json`);
