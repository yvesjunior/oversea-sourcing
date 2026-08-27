// The category taxonomy — ADR-001 S1, the spine of the demand-pull design.
//
// One canonical in-house tree (~sectors → categories, two levels), mapped
// behind the scenes to HS headings so customs/BoL data (S5) and coverage
// measurement speak the same language. Every request normalizes to exactly
// one node (S2 form: category is required); capability profiles and
// activity-code mappings (S3) attach to the same ids.
//
// Deliberately a typed module, not a table: the tree is code-adjacent data
// (mappings + keywords feed matching), it evolves by commit, and staff
// editing is not a current need — move it to rows the day it is.
//
// Node ids are STABLE — they will live in request rows, cache keys and
// coverage stats. Rename labels freely; never reuse or repurpose an id.

import { tokens } from "@/lib/match-tokens";

export type CategoryNode = {
  /** Stable slug — persisted on requests; never reuse for something else. */
  id: string;
  /** Sector id, or null for the sector (root) nodes themselves. */
  parent: string | null;
  fr: string;
  en: string;
  /** HS heading prefixes (2/4-digit) this category maps to — the bridge to
   *  customs/BoL data and export-record checks. Sectors carry chapters. */
  hs: string[];
  /** Matching vocabulary (lowercase, unaccented) — feeds free-text →
   *  category suggestion and, later, activity-code retrieval (S3). */
  keywords: string[];
};

const SECTORS: Array<Omit<CategoryNode, "parent">> = [
  {
    id: "mechanical",
    fr: "Composants mécaniques",
    en: "Mechanical components",
    hs: ["84", "73"],
    keywords: ["mecanique", "mechanical", "composant", "component"],
  },
  {
    id: "fluid",
    fr: "Fluides & robinetterie",
    en: "Fluid handling",
    hs: ["8413", "8481"],
    keywords: ["fluide", "fluid", "hydraulique", "hydraulic", "pneumatique", "pneumatic"],
  },
  {
    id: "electrical",
    fr: "Électrique & électronique",
    en: "Electrical & electronics",
    hs: ["85"],
    keywords: ["electrique", "electrical", "electronique", "electronics"],
  },
  {
    id: "metals",
    fr: "Métaux & métallurgie",
    en: "Metals & metalworking",
    hs: ["72", "73", "74", "76"],
    keywords: ["metal", "acier", "steel", "aluminium", "aluminum", "metallurgie"],
  },
  {
    id: "plastics",
    fr: "Plastiques & caoutchouc",
    en: "Plastics & rubber",
    hs: ["39", "40"],
    keywords: ["plastique", "plastic", "caoutchouc", "rubber", "polymere", "polymer"],
  },
  {
    id: "packaging",
    fr: "Emballage",
    en: "Packaging",
    hs: ["3923", "4819", "7010"],
    keywords: ["emballage", "packaging", "conditionnement"],
  },
  {
    id: "textiles",
    fr: "Textiles & habillement",
    en: "Textiles & apparel",
    hs: ["50", "63"],
    keywords: ["textile", "tissu", "fabric", "vetement", "apparel", "garment"],
  },
  {
    id: "construction",
    fr: "Matériaux de construction",
    en: "Construction materials",
    hs: ["25", "68", "69", "70"],
    keywords: ["construction", "batiment", "building", "materiaux"],
  },
  {
    id: "chemicals",
    fr: "Chimie & matières premières",
    en: "Chemicals & raw materials",
    hs: ["28", "29", "32", "34", "38"],
    keywords: ["chimie", "chemical", "chimique", "additif", "additive"],
  },
  {
    id: "machinery",
    fr: "Machines & équipements",
    en: "Machinery & equipment",
    hs: ["84"],
    keywords: ["machine", "machinery", "equipement", "equipment", "ligne", "line"],
  },
  {
    id: "automotive",
    fr: "Pièces automobiles",
    en: "Automotive parts",
    hs: ["87"],
    keywords: ["automobile", "automotive", "vehicule", "vehicle", "auto"],
  },
  {
    id: "medical",
    fr: "Médical & laboratoire",
    en: "Medical & laboratory",
    hs: ["90", "3006"],
    keywords: ["medical", "laboratoire", "laboratory", "sante", "health"],
  },
  {
    id: "furniture",
    fr: "Mobilier & bois",
    en: "Furniture & wood",
    hs: ["94", "44"],
    keywords: ["meuble", "mobilier", "furniture", "bois", "wood"],
  },
  {
    id: "energy",
    fr: "Énergie & renouvelables",
    en: "Energy & renewables",
    hs: ["8501", "8541"],
    keywords: ["energie", "energy", "solaire", "solar", "renouvelable", "renewable"],
  },
  {
    id: "food-equipment",
    fr: "Agroalimentaire & équipements",
    en: "Food processing & equipment",
    hs: ["8438", "19", "20", "21"],
    keywords: ["agroalimentaire", "food", "alimentaire", "agro"],
  },
  {
    id: "consumer",
    fr: "Biens de consommation",
    en: "Consumer goods",
    hs: ["95", "96", "42"],
    keywords: ["consommation", "consumer", "produit", "goods"],
  },
];

const CHILDREN: Array<Omit<CategoryNode, "parent"> & { parent: string }> = [
  // mechanical
  {
    id: "fasteners",
    parent: "mechanical",
    fr: "Visserie & fixations",
    en: "Fasteners",
    hs: ["7318"],
    keywords: ["vis", "boulon", "screw", "bolt", "fixation", "fastener", "ecrou", "nut", "rivet"],
  },
  {
    id: "bearings",
    parent: "mechanical",
    fr: "Roulements & paliers",
    en: "Bearings",
    hs: ["8482"],
    keywords: ["roulement", "bearing", "palier", "bille", "rouleau"],
  },
  {
    id: "gears-transmission",
    parent: "mechanical",
    fr: "Engrenages & transmission",
    en: "Gears & power transmission",
    hs: ["8483"],
    keywords: [
      "engrenage",
      "gear",
      "transmission",
      "reducteur",
      "gearbox",
      "courroie",
      "belt",
      "arbre",
      "shaft",
    ],
  },
  {
    id: "springs",
    parent: "mechanical",
    fr: "Ressorts",
    en: "Springs",
    hs: ["7320"],
    keywords: ["ressort", "spring"],
  },
  {
    id: "machined-parts",
    parent: "mechanical",
    fr: "Pièces usinées (CNC)",
    en: "Machined parts (CNC)",
    hs: ["8466", "7326"],
    keywords: [
      "usinage",
      "usine",
      "machining",
      "cnc",
      "tournage",
      "turning",
      "fraisage",
      "milling",
      "precision",
    ],
  },
  {
    id: "castings-forgings",
    parent: "mechanical",
    fr: "Fonderie & forge",
    en: "Castings & forgings",
    hs: ["7325", "7326"],
    keywords: ["fonderie", "casting", "moulage", "forge", "forging", "fonte"],
  },

  // fluid
  {
    id: "pumps",
    parent: "fluid",
    fr: "Pompes",
    en: "Pumps",
    hs: ["8413"],
    keywords: ["pompe", "pump", "centrifuge", "doseuse", "dosing"],
  },
  {
    id: "valves",
    parent: "fluid",
    fr: "Vannes & robinetterie",
    en: "Valves",
    hs: ["8481"],
    keywords: [
      "vanne",
      "valve",
      "robinet",
      "papillon",
      "butterfly",
      "boisseau",
      "ball",
      "clapet",
      "check",
    ],
  },
  {
    id: "hydraulics",
    parent: "fluid",
    fr: "Hydraulique",
    en: "Hydraulics",
    hs: ["8412"],
    keywords: ["hydraulique", "hydraulic", "verin", "cylinder", "distributeur"],
  },
  {
    id: "pneumatics",
    parent: "fluid",
    fr: "Pneumatique",
    en: "Pneumatics",
    hs: ["8412", "8414"],
    keywords: ["pneumatique", "pneumatic", "compresseur", "compressor", "air"],
  },
  {
    id: "hoses-fittings",
    parent: "fluid",
    fr: "Tuyaux & raccords",
    en: "Hoses & fittings",
    hs: ["3917", "7307", "4009"],
    keywords: ["tuyau", "hose", "raccord", "fitting", "flexible", "pipe", "tube"],
  },
  {
    id: "heat-exchangers",
    parent: "fluid",
    fr: "Échangeurs thermiques",
    en: "Heat exchangers",
    hs: ["8419"],
    keywords: ["echangeur", "exchanger", "thermique", "heat", "plaques", "plate"],
  },
  {
    id: "filtration",
    parent: "fluid",
    fr: "Filtration",
    en: "Filtration",
    hs: ["8421"],
    keywords: ["filtre", "filter", "filtration", "separateur", "separator"],
  },

  // electrical
  {
    id: "cables-wiring",
    parent: "electrical",
    fr: "Câbles & faisceaux",
    en: "Cables & wiring",
    hs: ["8544"],
    keywords: ["cable", "fil", "wire", "faisceau", "harness", "cablage"],
  },
  {
    id: "connectors",
    parent: "electrical",
    fr: "Connecteurs",
    en: "Connectors",
    hs: ["8536"],
    keywords: ["connecteur", "connector", "borne", "terminal", "cosse"],
  },
  {
    id: "pcb-assembly",
    parent: "electrical",
    fr: "Cartes électroniques (PCB)",
    en: "PCB & assembly",
    hs: ["8534", "8542"],
    keywords: ["pcb", "carte", "circuit", "electronique", "smt", "assemblage", "assembly"],
  },
  {
    id: "motors-drives",
    parent: "electrical",
    fr: "Moteurs & variateurs",
    en: "Motors & drives",
    hs: ["8501", "8504"],
    keywords: ["moteur", "motor", "variateur", "drive", "servomoteur", "servo"],
  },
  {
    id: "lighting",
    parent: "electrical",
    fr: "Éclairage",
    en: "Lighting",
    hs: ["9405", "8539"],
    keywords: ["eclairage", "lighting", "led", "lampe", "lamp", "luminaire"],
  },
  {
    id: "batteries",
    parent: "electrical",
    fr: "Batteries & accumulateurs",
    en: "Batteries",
    hs: ["8506", "8507"],
    keywords: ["batterie", "battery", "accumulateur", "lithium", "pile", "cell"],
  },
  {
    id: "sensors-instruments",
    parent: "electrical",
    fr: "Capteurs & instrumentation",
    en: "Sensors & instruments",
    hs: ["9026", "9031", "8533"],
    keywords: ["capteur", "sensor", "instrumentation", "mesure", "measurement", "sonde", "probe"],
  },

  // metals
  {
    id: "sheet-metal",
    parent: "metals",
    fr: "Tôlerie & découpe",
    en: "Sheet metal fabrication",
    hs: ["7308", "7326"],
    keywords: [
      "tole",
      "tolerie",
      "sheet",
      "decoupe",
      "laser",
      "pliage",
      "bending",
      "soudure",
      "welding",
      "mecano-soudure",
    ],
  },
  {
    id: "steel-products",
    parent: "metals",
    fr: "Produits sidérurgiques",
    en: "Steel products",
    hs: ["72"],
    keywords: ["acier", "steel", "poutre", "beam", "barre", "bar", "bobine", "coil", "inox"],
  },
  {
    id: "aluminum-extrusion",
    parent: "metals",
    fr: "Profilés & extrusion alu",
    en: "Aluminum extrusion",
    hs: ["7604", "7610"],
    keywords: ["aluminium", "aluminum", "profile", "extrusion", "alu"],
  },
  {
    id: "surface-treatment",
    parent: "metals",
    fr: "Traitement de surface",
    en: "Surface treatment",
    hs: ["8479"],
    keywords: [
      "traitement",
      "surface",
      "anodisation",
      "anodizing",
      "galvanisation",
      "galvanizing",
      "peinture",
      "coating",
      "zingage",
      "plating",
    ],
  },

  // plastics
  {
    id: "injection-molding",
    parent: "plastics",
    fr: "Injection plastique",
    en: "Plastic injection molding",
    hs: ["3926", "8480"],
    keywords: ["injection", "moulage", "molding", "moule", "mold", "plastique", "plastic"],
  },
  {
    id: "extrusion-plastics",
    parent: "plastics",
    fr: "Extrusion plastique",
    en: "Plastic extrusion",
    hs: ["3916", "3917"],
    keywords: ["extrusion", "profile", "gaine", "tube", "plastique"],
  },
  {
    id: "rubber-parts",
    parent: "plastics",
    fr: "Pièces caoutchouc & joints",
    en: "Rubber parts & seals",
    hs: ["4016"],
    keywords: ["caoutchouc", "rubber", "joint", "seal", "gasket", "silicone", "epdm", "o-ring"],
  },
  {
    id: "composites",
    parent: "plastics",
    fr: "Composites",
    en: "Composites",
    hs: ["3920", "7019"],
    keywords: ["composite", "fibre", "fiber", "carbone", "carbon", "verre", "fiberglass"],
  },

  // packaging
  {
    id: "corrugated-boxes",
    parent: "packaging",
    fr: "Carton & caisses",
    en: "Corrugated & boxes",
    hs: ["4819"],
    keywords: ["carton", "caisse", "box", "ondule", "corrugated", "etui"],
  },
  {
    id: "flexible-packaging",
    parent: "packaging",
    fr: "Emballage souple & films",
    en: "Flexible packaging & films",
    hs: ["3920", "3923"],
    keywords: ["film", "souple", "flexible", "sachet", "pouch", "sac", "bag"],
  },
  {
    id: "bottles-containers",
    parent: "packaging",
    fr: "Bouteilles & contenants",
    en: "Bottles & containers",
    hs: ["3923", "7010"],
    keywords: ["bouteille", "bottle", "flacon", "pot", "jar", "contenant", "container", "bidon"],
  },
  {
    id: "labels-printing",
    parent: "packaging",
    fr: "Étiquettes & impression",
    en: "Labels & printing",
    hs: ["4821", "4911"],
    keywords: ["etiquette", "label", "impression", "printing", "adhesif"],
  },

  // textiles
  {
    id: "fabrics",
    parent: "textiles",
    fr: "Tissus & non-tissés",
    en: "Fabrics & nonwovens",
    hs: ["52", "54", "56"],
    keywords: ["tissu", "fabric", "textile", "non-tisse", "nonwoven", "maille", "knit"],
  },
  {
    id: "garments",
    parent: "textiles",
    fr: "Confection & vêtements",
    en: "Garments",
    hs: ["61", "62"],
    keywords: ["vetement", "garment", "confection", "t-shirt", "uniforme", "uniform", "workwear"],
  },
  {
    id: "technical-textiles",
    parent: "textiles",
    fr: "Textiles techniques",
    en: "Technical textiles",
    hs: ["59", "6307"],
    keywords: ["technique", "technical", "sangle", "webbing", "bache", "tarpaulin", "geotextile"],
  },

  // construction
  {
    id: "tiles-stone",
    parent: "construction",
    fr: "Carrelage & pierre",
    en: "Tiles & stone",
    hs: ["6907", "6802"],
    keywords: ["carrelage", "tile", "pierre", "stone", "granit", "marbre", "marble", "ceramique"],
  },
  {
    id: "glass-products",
    parent: "construction",
    fr: "Verre",
    en: "Glass products",
    hs: ["70"],
    keywords: ["verre", "glass", "vitrage", "glazing", "miroir", "mirror"],
  },
  {
    id: "doors-windows",
    parent: "construction",
    fr: "Portes & fenêtres",
    en: "Doors & windows",
    hs: ["7610", "4418", "3925"],
    keywords: ["porte", "door", "fenetre", "window", "menuiserie"],
  },
  {
    id: "insulation",
    parent: "construction",
    fr: "Isolation",
    en: "Insulation",
    hs: ["6806", "3921"],
    keywords: ["isolation", "insulation", "isolant", "laine", "mousse", "foam"],
  },

  // chemicals
  {
    id: "industrial-chemicals",
    parent: "chemicals",
    fr: "Produits chimiques industriels",
    en: "Industrial chemicals",
    hs: ["28", "29"],
    keywords: ["chimique", "chemical", "solvant", "solvent", "acide", "acid", "resine", "resin"],
  },
  {
    id: "adhesives-coatings",
    parent: "chemicals",
    fr: "Colles & revêtements",
    en: "Adhesives & coatings",
    hs: ["3506", "32"],
    keywords: [
      "colle",
      "adhesive",
      "adhesif",
      "revetement",
      "coating",
      "peinture",
      "paint",
      "vernis",
    ],
  },
  {
    id: "lubricants",
    parent: "chemicals",
    fr: "Lubrifiants",
    en: "Lubricants",
    hs: ["2710", "3403"],
    keywords: ["lubrifiant", "lubricant", "graisse", "grease", "huile", "oil"],
  },

  // machinery
  {
    id: "production-machinery",
    parent: "machinery",
    fr: "Machines de production",
    en: "Production machinery",
    hs: ["8457", "8462", "8477"],
    keywords: [
      "machine",
      "production",
      "presse",
      "press",
      "ligne",
      "line",
      "automatisation",
      "automation",
    ],
  },
  {
    id: "packaging-machinery",
    parent: "machinery",
    fr: "Machines d'emballage",
    en: "Packaging machinery",
    hs: ["8422"],
    keywords: [
      "ensacheuse",
      "remplisseuse",
      "filling",
      "etiqueteuse",
      "labeling",
      "conditionnement",
      "emballage",
      "machine",
    ],
  },
  {
    id: "material-handling",
    parent: "machinery",
    fr: "Manutention & levage",
    en: "Material handling",
    hs: ["8425", "8428"],
    keywords: [
      "manutention",
      "handling",
      "convoyeur",
      "conveyor",
      "levage",
      "lifting",
      "palan",
      "hoist",
      "chariot",
    ],
  },
  {
    id: "tooling-molds",
    parent: "machinery",
    fr: "Outillage & moules",
    en: "Tooling & molds",
    hs: ["8207", "8480"],
    keywords: [
      "outillage",
      "tooling",
      "outil",
      "tool",
      "moule",
      "mold",
      "matrice",
      "die",
      "gabarit",
      "jig",
    ],
  },
  {
    id: "agricultural-machinery",
    parent: "machinery",
    fr: "Machines agricoles",
    en: "Agricultural machinery",
    hs: ["8432", "8436"],
    keywords: ["agricole", "agricultural", "tracteur", "ferme", "farm"],
  },

  // automotive
  {
    id: "auto-mechanical",
    parent: "automotive",
    fr: "Pièces mécaniques auto",
    en: "Automotive mechanical parts",
    hs: ["8708"],
    keywords: [
      "frein",
      "brake",
      "suspension",
      "embrayage",
      "clutch",
      "echappement",
      "exhaust",
      "automobile",
      "piece",
    ],
  },
  {
    id: "auto-electrical",
    parent: "automotive",
    fr: "Pièces électriques auto",
    en: "Automotive electrical parts",
    hs: ["8511", "8512"],
    keywords: [
      "alternateur",
      "alternator",
      "demarreur",
      "starter",
      "phare",
      "feu",
      "faisceau",
      "automobile",
    ],
  },
  {
    id: "wheels-tires",
    parent: "automotive",
    fr: "Roues & pneumatiques",
    en: "Wheels & tires",
    hs: ["4011", "8708"],
    keywords: ["pneu", "tire", "tyre", "roue", "wheel", "jante", "rim"],
  },

  // medical
  {
    id: "medical-devices",
    parent: "medical",
    fr: "Dispositifs médicaux",
    en: "Medical devices",
    hs: ["9018", "9021"],
    keywords: ["dispositif", "device", "medical", "chirurgical", "surgical", "implant"],
  },
  {
    id: "medical-consumables",
    parent: "medical",
    fr: "Consommables médicaux",
    en: "Medical consumables",
    hs: ["3005", "4015", "9018"],
    keywords: [
      "consommable",
      "consumable",
      "gant",
      "glove",
      "masque",
      "mask",
      "seringue",
      "syringe",
      "compresse",
    ],
  },
  {
    id: "lab-equipment",
    parent: "medical",
    fr: "Équipement de laboratoire",
    en: "Laboratory equipment",
    hs: ["9027"],
    keywords: ["laboratoire", "laboratory", "analyse", "analyzer", "microscope", "verrerie"],
  },

  // furniture
  {
    id: "office-furniture",
    parent: "furniture",
    fr: "Mobilier professionnel",
    en: "Commercial furniture",
    hs: ["9403"],
    keywords: [
      "mobilier",
      "furniture",
      "bureau",
      "office",
      "chaise",
      "chair",
      "table",
      "rayonnage",
      "shelving",
    ],
  },
  {
    id: "wood-products",
    parent: "furniture",
    fr: "Produits bois & panneaux",
    en: "Wood products & panels",
    hs: ["44"],
    keywords: [
      "bois",
      "wood",
      "panneau",
      "panel",
      "contreplaque",
      "plywood",
      "mdf",
      "palette",
      "pallet",
    ],
  },

  // energy
  {
    id: "solar-components",
    parent: "energy",
    fr: "Solaire (panneaux, onduleurs)",
    en: "Solar components",
    hs: ["8541", "8504"],
    keywords: [
      "solaire",
      "solar",
      "panneau",
      "panel",
      "photovoltaique",
      "pv",
      "onduleur",
      "inverter",
    ],
  },
  {
    id: "generators",
    parent: "energy",
    fr: "Groupes électrogènes",
    en: "Generators",
    hs: ["8502"],
    keywords: ["generateur", "generator", "groupe", "electrogene", "genset"],
  },

  // food-equipment
  {
    id: "food-ingredients",
    parent: "food-equipment",
    fr: "Ingrédients alimentaires",
    en: "Food ingredients",
    hs: ["19", "20", "21"],
    keywords: ["ingredient", "alimentaire", "food", "arome", "flavor", "epice", "spice", "additif"],
  },
  {
    id: "food-machinery",
    parent: "food-equipment",
    fr: "Machines agroalimentaires",
    en: "Food processing machinery",
    hs: ["8438"],
    keywords: [
      "agroalimentaire",
      "food",
      "processing",
      "boulangerie",
      "bakery",
      "laiterie",
      "dairy",
      "machine",
    ],
  },

  // consumer
  {
    id: "houseware",
    parent: "consumer",
    fr: "Articles ménagers",
    en: "Houseware",
    hs: ["3924", "7323"],
    keywords: ["menager", "houseware", "cuisine", "kitchen", "ustensile", "utensil"],
  },
  {
    id: "bags-leather",
    parent: "consumer",
    fr: "Sacs & maroquinerie",
    en: "Bags & leather goods",
    hs: ["42"],
    keywords: ["sac", "bag", "maroquinerie", "leather", "cuir", "bagage", "luggage"],
  },
  {
    id: "toys-sports",
    parent: "consumer",
    fr: "Jouets & sport",
    en: "Toys & sporting goods",
    hs: ["95"],
    keywords: ["jouet", "toy", "sport", "jeu", "game", "fitness"],
  },
];

/** Every node, sectors first — order is the display order. */
export const CATEGORIES: CategoryNode[] = [
  ...SECTORS.map((s) => ({ ...s, parent: null })),
  ...CHILDREN,
];

const byId = new Map(CATEGORIES.map((node) => [node.id, node]));

export function categoryById(id: string): CategoryNode | undefined {
  return byId.get(id);
}

export function rootCategories(): CategoryNode[] {
  return CATEGORIES.filter((node) => node.parent === null);
}

export function childrenOf(sectorId: string): CategoryNode[] {
  return CATEGORIES.filter((node) => node.parent === sectorId);
}

/** Localized label, with the sector prefixed for child nodes
 *  ("Fluides & robinetterie — Vannes"). */
export function categoryLabel(id: string, locale: string): string {
  const node = byId.get(id);
  if (!node) return id;
  const name = locale.startsWith("fr") ? node.fr : node.en;
  if (!node.parent) return name;
  const parent = byId.get(node.parent);
  const parentName = parent ? (locale.startsWith("fr") ? parent.fr : parent.en) : "";
  return parentName ? `${parentName} — ${name}` : name;
}

/** Best-effort category suggestion from free text (hero draft, S2 pre-fill).
 *  Pure keyword scoring over the SCORER'S OWN vocabulary (`tokens()` — noise
 *  and units dropped, aliases applied), so the suggestion agrees with what
 *  matching would later see. Child nodes win over sectors; ties resolve in
 *  declaration order (deterministic). No AI. */
export function suggestCategory(text: string): CategoryNode | null {
  const raw = tokens(text).filter((t) => t.length >= 3);
  // Naive singulars so "pompes"/"pumps" hit the keyword "pompe"/"pump".
  const words = new Set(raw.flatMap((w) => (w.endsWith("s") ? [w, w.slice(0, -1)] : [w])));
  if (words.size === 0) return null;

  let best: CategoryNode | null = null;
  let bestScore = 0;
  for (const node of CATEGORIES) {
    let score = 0;
    for (const keyword of node.keywords) {
      if (words.has(keyword)) score += 2;
      // Prefix credit: "usinage" matches the keyword "usine" and vice versa.
      else if ([...words].some((w) => w.startsWith(keyword) || keyword.startsWith(w))) score += 1;
    }
    if (node.parent) score *= 1.5; // specific beats sector on equal evidence
    if (score > bestScore) {
      bestScore = score;
      best = node;
    }
  }
  return bestScore >= 3 ? best : null;
}
