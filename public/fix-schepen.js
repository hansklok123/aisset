const fs = require("fs");
const path = require("path");

const DATA_PATH = path.join(__dirname, "data", "schepen.json");


// Dezelfde mapping als in je hoofdcode
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
  33: "Passagiersschip",
  34: "Vrachtschip",
  35: "Tanker",
  36: "Pleziervaartuig",
  37: "Pleziervaartuig",
  40: "Hoogwaardig vaartuig",
  50: "Pilotvaartuig",
  51: "Sleepboot",
  52: "Vrachtschip (met gevaarlijke lading)",
  53: "Sleper",
  54: "Ontmijner",
  55: "Patrouillevaartuig",
  56: "Marineschip",
  57: "Zeilschip",
  58: "Pleziervaartuig",
  59: "Pleziervaartuig",
  60: "Passagiersschip",
  61: "Veerboot",
  62: "Cruiseschip",
  63: "Jacht",
  64: "Jacht",
  65: "Jacht",
  66: "Jacht",
  67: "Jacht",
  68: "Jacht",
  69: "Jacht",
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
};

if (!fs.existsSync(DATA_PATH)) {
  console.error("schepen.json niet gevonden!");
  process.exit(1);
}

const schepen = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
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
